import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { AsyncJob } from './constructs/async-job';
import { AppSyncGraphql } from './constructs/appsync-graphql';
import { Auth } from './constructs/auth/';
import { TaskTitanTable } from './constructs/dynamodb';
import { EventBus } from './constructs/event-bus/';
import { GuestIdentityPool } from './constructs/guest-identity-pool';
import { Monitoring } from './constructs/monitoring';
import { StaticFrontend } from './constructs/static-frontend';

interface MainStackProps extends StackProps {
  /**
   * Optional WAF WebACL ARN for CloudFront protection.
   * Must be created in us-east-1 with CLOUDFRONT scope.
   */
  readonly webAclArn?: string;

  /**
   * Optional custom domain for CloudFront (e.g., 'tasktitan.live').
   * If not provided, uses CloudFront's default domain.
   */
  readonly customDomain?: string;

  /**
   * Optional ACM certificate ARN for custom domain.
   * Must be in us-east-1 region. Required if customDomain is set.
   */
  readonly certificateArn?: string;
}

export class MainStack extends Stack {
  constructor(scope: Construct, id: string, props: MainStackProps = {}) {
    super(scope, id, {
      description: 'TaskTitan FORGE v3 - CloudFront + AppSync + DynamoDB (fully serverless)',
      ...props,
    });

    // Access logs bucket for future use
    const accessLogBucket = new Bucket(this, 'AccessLogBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: true,
    });

    // FORGE v2: DynamoDB Single-Table Design
    // AWS Best Practice: Single-table design with on-demand billing
    // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html
    // TEMPORARY: Import existing table (preserved from previous stack with RemovalPolicy.RETAIN)
    // TODO: After first successful deploy, revert to: new TaskTitanTable(this, 'DynamoTable', {...})
    // NOTE: Must use fromTableAttributes to include GSI names for proper IAM permissions
    const existingTable = Table.fromTableAttributes(
      this,
      'ExistingTable',
      {
        tableName: 'TaskTitanForgeStack-TaskTitan',
        globalIndexes: ['gsi1', 'gsi2', 'gsi3'],
      }
    );

    // Wrap in TaskTitanTable interface for compatibility
    const dynamoTable = {
      table: existingTable,
      tableName: existingTable.tableName,
      tableArn: existingTable.tableArn,
    } as any as TaskTitanTable;

    // Authentication with Cognito (using default Cognito domain - no custom domain)
    // SECURITY NOTE: Without custom domain, Cognito uses *.amazoncognito.com which is secure
    const auth = new Auth(this, 'Auth', {});

    // Real-time event bus for live updates
    const eventBus = new EventBus(this, 'EventBus', {});
    eventBus.addUserPoolProvider(auth.userPool);

    // LOGIC TIER: Async job processing (serverless, no VPC needed)
    const asyncJob = new AsyncJob(this, 'AsyncJob', { dynamoTable, eventBus });

    // Phase 2: AppSync GraphQL API (parallel to Next.js; Cognito + DynamoDB + Lambda/Bedrock)
    const appSyncGraphql = new AppSyncGraphql(this, 'AppSyncGraphql', {
      dynamoTable,
      auth,
      asyncJob,
    });

    // Guest Identity Pool for share code feature
    // AWS Best Practice: Cognito Identity Pool with unauthenticated role for guest access
    // Reference: https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools-security-best-practices.html
    //
    // IMPORTANT: The Identity Pool must be linked to the User Pool for Amplify v6 compatibility.
    // This allows Amplify to properly handle both authenticated and guest flows.
    const guestIdentityPool = new GuestIdentityPool(this, 'GuestIdentityPool', {
      appSyncApi: appSyncGraphql.api,
      userPool: auth.userPool,
      userPoolClient: auth.client,
    });

    // PRESENTATION TIER: CloudFront + S3 static frontend
    // AWS Best Practices implemented:
    // - Security headers (CSP, HSTS, X-Frame-Options, etc.)
    // - Tiered cache (no-cache for index.html, long TTL for hashed assets)
    // - SPA routing (403/404 → index.html)
    // - WAF rate limiting (from us-east-1 global WebACL)
    // - CloudWatch alarms for error rate monitoring
    const staticFrontend = new StaticFrontend(this, 'StaticFrontend', {
      accessLogBucket,
      webAclArn: props.webAclArn,
      customDomain: props.customDomain,
      certificateArn: props.certificateArn,
    });

    // Configure Cognito OAuth callback URLs for CloudFront + optional custom domain + local dev
    const callbackUrls = [
      `${staticFrontend.distributionUrl}/auth-callback`,
      'http://localhost:5173/auth-callback', // Vite dev server
    ];
    const logoutUrls = [
      staticFrontend.distributionUrl,
      'http://localhost:5173',
    ];
    // Add custom domain URLs if configured
    if (props.customDomain) {
      callbackUrls.push(`https://${props.customDomain}/auth-callback`);
      logoutUrls.push(`https://${props.customDomain}`);
    }
    auth.updateAllowedCallbackUrls(callbackUrls, logoutUrls);

    // CloudWatch Monitoring Dashboard
    new Monitoring(this, 'Monitoring', {
      applicationName: 'TaskTitan',
      lambdaFunctions: [{ name: 'AsyncJob', fn: asyncJob.handler }],
      dynamoTable,
    });

    // Outputs
    new CfnOutput(this, 'FrontendDomainName', {
      value: staticFrontend.distributionUrl,
      description: 'TaskTitan frontend URL (CloudFront)',
    });

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: auth.userPool.userPoolId,
      description: 'Cognito User Pool ID for authentication',
    });

    new CfnOutput(this, 'MonitoringDashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=TaskTitan-Monitoring`,
      description: 'CloudWatch Monitoring Dashboard URL',
    });

    new CfnOutput(this, 'XRayServiceMapUrl', {
      value: `https://${this.region}.console.aws.amazon.com/xray/home?region=${this.region}#/service-map`,
      description: 'X-Ray Service Map for request tracing',
    });

    // FORGE v2: DynamoDB outputs
    new CfnOutput(this, 'DynamoDBTableName', {
      value: dynamoTable.tableName,
      description: 'DynamoDB table name for TaskTitan data',
    });

    new CfnOutput(this, 'DynamoDBTableArn', {
      value: dynamoTable.tableArn,
      description: 'DynamoDB table ARN for IAM policies',
    });

    // Guest Identity Pool output for frontend configuration
    new CfnOutput(this, 'GuestIdentityPoolId', {
      value: guestIdentityPool.identityPoolId,
      description: 'Cognito Identity Pool ID for guest (share code) access',
    });
  }
}
