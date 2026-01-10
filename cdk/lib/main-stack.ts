import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AsyncJob } from './constructs/async-job';
import { Auth } from './constructs/auth/';
import { Database } from './constructs/database';
import {
  GatewayVpcEndpointAwsService,
  InstanceClass,
  InstanceSize,
  InstanceType,
  NatProvider,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Webapp } from './constructs/webapp';
import { EdgeFunction } from './constructs/cf-lambda-furl-service/edge-function';
import { EventBus } from './constructs/event-bus/';
import { Monitoring } from './constructs/monitoring';

interface MainStackProps extends StackProps {
  readonly signPayloadHandler: EdgeFunction;

  /**
   * Custom domain name for the webapp and Cognito.
   *
   * @default No custom domain. CloudFront and Cognito will use their default domains.
   */
  readonly domainName?: string;
  /**
   * Route53 hosted zone for the custom domain (created in us-east-1 stack).
   *
   * @default No custom domain.
   */
  readonly hostedZone?: IHostedZone;
  /**
   * ACM certificate for custom domain (must be in us-east-1).
   *
   * @default No custom domain.
   */
  readonly sharedCertificate?: ICertificate;

  /**
   * Use a NAT instance instead of NAT Gateways for cost optimization.
   *
   * NAT Gateway is the AWS best practice for production (managed, HA, auto-scaling).
   * NAT Instance is cheaper (~$5/month vs ~$35/month) but requires management.
   *
   * @default false (use NAT Gateway for production best practice)
   */
  readonly useNatInstance?: boolean;

  /**
   * Database backup retention period in days.
   *
   * @default 7
   */
  readonly backupRetentionDays?: number;
}

export class MainStack extends Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, {
      description: 'TaskTitan - Serverless 3-Tier Application for Component-Based Project Planning',
      ...props,
    });

    // NAT Gateway is production best practice (managed, HA, auto-scaling)
    // Set useNatInstance=true for dev/test environments to save costs
    const { useNatInstance = false, backupRetentionDays = 7 } = props;

    // Use the hosted zone from us-east-1 stack
    // CDK cross-stack references (with crossRegionReferences: true) will handle the Route53 reference
    // Route53 hosted zones are global, so this works across regions
    const hostedZone = props.hostedZone;

    // Access logs bucket for CloudFront - Security best practice
    const accessLogBucket = new Bucket(this, 'AccessLogBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: true,
    });

    // VPC Configuration
    // - Default: NAT Gateway (production best practice - managed, HA, auto-scaling)
    // - Optional: NAT Instance for dev/test cost savings
    const vpc = new Vpc(this, `Vpc`, {
      ...(useNatInstance
        ? {
            // Cost optimization: ~$5/month vs ~$35/month for NAT Gateway
            natGatewayProvider: NatProvider.instanceV2({
              instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
              associatePublicIpAddress: true,
            }),
            natGateways: 1,
          }
        : {
            // Production best practice: NAT Gateway per AZ for high availability
            natGateways: 2, // Deploy in 2 AZs for redundancy
          }),
    });

    // VPC Gateway Endpoints - Best practice to reduce NAT costs and improve security
    // Traffic to S3/DynamoDB stays within AWS network (no NAT charges)
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: GatewayVpcEndpointAwsService.S3,
    });
    vpc.addGatewayEndpoint('DynamoDBEndpoint', {
      service: GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // DATA TIER: Aurora PostgreSQL Serverless with automated backups
    const database = new Database(this, 'Database', {
      vpc,
      backupRetentionDays, // Stretch goal: Regular backups
    });

    // Authentication with Cognito
    const auth = new Auth(this, 'Auth', {
      hostedZone,
      sharedCertificate: props.sharedCertificate,
    });

    // Real-time event bus for live updates
    const eventBus = new EventBus(this, 'EventBus', {});
    eventBus.addUserPoolProvider(auth.userPool);

    // LOGIC TIER: Async job processing
    const asyncJob = new AsyncJob(this, 'AsyncJob', { database: database, eventBus });

    // PRESENTATION TIER: Next.js webapp on Lambda + CloudFront (HTTPS by default)
    // AI component generation uses Amazon Bedrock (Claude) - no API keys needed!
    const webapp = new Webapp(this, 'Webapp', {
      database,
      hostedZone,
      certificate: props.sharedCertificate,
      signPayloadHandler: props.signPayloadHandler,
      accessLogBucket,
      auth,
      eventBus,
      asyncJob,
      // Use root domain (tasktitan.live) - remove subDomain property or set to undefined
      // subDomain: 'web', // Uncomment if you want web.tasktitan.live instead
    });

    // CloudWatch Monitoring Dashboard
    new Monitoring(this, 'Monitoring', {
      applicationName: 'TaskTitan',
      lambdaFunctions: [
        { name: 'Webapp', fn: webapp.handler },
        { name: 'AsyncJob', fn: asyncJob.handler },
      ],
      databaseCluster: database.cluster,
    });

    // Outputs
    new CfnOutput(this, 'FrontendDomainName', {
      value: webapp.baseUrl,
      description: 'TaskTitan frontend URL (HTTPS)',
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
  }
}
