import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AsyncJob } from './constructs/async-job';
import { Auth } from './constructs/auth/';
import { Database } from './constructs/database';
import { TaskTitanTable } from './constructs/dynamodb';
import {
  GatewayVpcEndpointAwsService,
  InstanceClass,
  InstanceSize,
  InstanceType,
  NatProvider,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { AppRunnerService } from './constructs/app-runner';
import { EventBus } from './constructs/event-bus/';
import { Monitoring } from './constructs/monitoring';

interface MainStackProps extends StackProps {
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
      description: 'TaskTitan FORGE v2 - App Runner + DynamoDB (us-east-2)',
      ...props,
    });

    // NAT Gateway is production best practice (managed, HA, auto-scaling)
    // Set useNatInstance=true for dev/test environments to save costs
    // AWS Best Practice: 30-day backup retention for production compliance
    // Reference: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html
    const { useNatInstance = false, backupRetentionDays = 30 } = props;

    // Access logs bucket - kept for future CloudFront integration if needed
    const accessLogBucket = new Bucket(this, 'AccessLogBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      autoDeleteObjects: true,
    });

    // VPC Configuration - Still needed for:
    // 1. Aurora PostgreSQL (during dual-write migration)
    // 2. App Runner VPC Connector (to reach Aurora)
    // After DynamoDB-only migration, VPC can be simplified or removed
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

    // FORGE v2: DynamoDB Single-Table Design
    // Phase 1 of migration: Run alongside Aurora during dual-write period
    // AWS Best Practice: Single-table design with on-demand billing
    // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html
    const dynamoTable = new TaskTitanTable(this, 'DynamoTable', {
      pointInTimeRecovery: true, // 35-day backup retention
      removalPolicy: RemovalPolicy.RETAIN, // Prevent accidental data loss
      enableStreams: true, // For real-time updates and migration validation
    });

    // DATA TIER: Aurora PostgreSQL Serverless with automated backups
    // NOTE: Kept during dual-write migration period - will be removed in Phase 6
    const database = new Database(this, 'Database', {
      vpc,
      backupRetentionDays, // Stretch goal: Regular backups
    });

    // Authentication with Cognito (using default Cognito domain - no custom domain)
    // SECURITY NOTE: Without custom domain, Cognito uses *.amazoncognito.com which is secure
    const auth = new Auth(this, 'Auth', {});

    // Real-time event bus for live updates
    const eventBus = new EventBus(this, 'EventBus', {});
    eventBus.addUserPoolProvider(auth.userPool);

    // LOGIC TIER: Async job processing
    const asyncJob = new AsyncJob(this, 'AsyncJob', { database: database, eventBus });

    // PRESENTATION TIER: FORGE v2 - App Runner replaces ECS Fargate + ALB
    // App Runner provides:
    // - Zero cold starts (containers stay warm)
    // - Automatic scaling based on traffic
    // - Built-in HTTPS on *.awsapprunner.com
    // - No ALB or NAT Gateway needed for DynamoDB
    // - ~50-70% cost savings
    //
    // VPC Connector enables Aurora access during dual-write migration period
    const webapp = new AppRunnerService(this, 'Webapp', {
      auth,
      dynamoTable,
      eventBus,
      asyncJob,
      database, // Dual-write migration: VPC Connector for Aurora access
    });

    // CloudWatch Monitoring Dashboard
    new Monitoring(this, 'Monitoring', {
      applicationName: 'TaskTitan',
      lambdaFunctions: [{ name: 'AsyncJob', fn: asyncJob.handler }],
      databaseCluster: database.cluster,
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
