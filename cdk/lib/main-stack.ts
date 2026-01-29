import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AsyncJob } from './constructs/async-job';
import { AppSyncGraphql } from './constructs/appsync-graphql';
import { Auth } from './constructs/auth/';
import { TaskTitanTable } from './constructs/dynamodb';
import { AppRunnerService } from './constructs/app-runner';
import { EventBus } from './constructs/event-bus/';
import { Monitoring } from './constructs/monitoring';
import { StaticFrontend } from './constructs/static-frontend';

interface MainStackProps extends StackProps {
  // No special props needed - fully serverless with DynamoDB
}

export class MainStack extends Stack {
  constructor(scope: Construct, id: string, props: MainStackProps = {}) {
    super(scope, id, {
      description: 'TaskTitan FORGE v2 - App Runner + DynamoDB (us-east-2)',
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
    const dynamoTable = new TaskTitanTable(this, 'DynamoTable', {
      pointInTimeRecovery: true, // 35-day backup retention
      removalPolicy: RemovalPolicy.RETAIN, // Prevent accidental data loss
      enableStreams: true, // For real-time updates
    });

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

    // Phase 3: CloudFront + S3 static frontend (client architecture entry point)
    // Deploy static build to the bucket; then remove App Runner and switch Cognito callbacks to this URL
    const staticFrontend = new StaticFrontend(this, 'StaticFrontend', {
      accessLogBucket,
    });

    // PRESENTATION TIER: FORGE v2 - App Runner (fully serverless) – remove when static build is live on CloudFront
    // App Runner provides:
    // - Zero cold starts (containers stay warm)
    // - Automatic scaling based on traffic
    // - Built-in HTTPS on *.awsapprunner.com
    // - No VPC/NAT Gateway needed for DynamoDB (public HTTPS endpoint)
    // - ~70% cost savings vs ECS Fargate + ALB + NAT + Aurora
    const webapp = new AppRunnerService(this, 'Webapp', {
      auth,
      dynamoTable,
      eventBus,
      asyncJob,
    });

    // CloudWatch Monitoring Dashboard
    new Monitoring(this, 'Monitoring', {
      applicationName: 'TaskTitan',
      lambdaFunctions: [{ name: 'AsyncJob', fn: asyncJob.handler }],
      dynamoTable,
    });

    // Outputs
    new CfnOutput(this, 'FrontendDomainName', {
      value: `https://${webapp.serviceUrl}`,
      description: 'TaskTitan frontend URL (App Runner HTTPS)',
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
  }
}
