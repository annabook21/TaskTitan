import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Service, Source, Cpu, Memory, HealthCheck, AutoScalingConfiguration, Secret as AppRunnerSecret } from '@aws-cdk/aws-apprunner-alpha';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { join } from 'path';
import { readFileSync } from 'fs';
import { Auth } from './auth/';
import { TaskTitanTable } from './dynamodb';
import { EventBus } from './event-bus/';
import { AsyncJob } from './async-job';

/**
 * FORGE v2: App Runner Service for TaskTitan
 *
 * AWS App Runner provides:
 * - Zero cold starts (containers stay warm)
 * - Automatic scaling based on traffic
 * - Built-in HTTPS
 * - No VPC required for DynamoDB (HTTPS endpoint)
 * - ~50-70% cost savings vs ECS Fargate + ALB + NAT Gateway
 *
 * Reference: https://docs.aws.amazon.com/apprunner/latest/dg/what-is-apprunner.html
 */

export interface AppRunnerServiceProps {
  auth: Auth;
  dynamoTable: TaskTitanTable;
  eventBus: EventBus;
  asyncJob: AsyncJob;
}

export class AppRunnerService extends Construct {
  public readonly service: Service;
  public readonly serviceUrl: string;

  constructor(scope: Construct, id: string, props: AppRunnerServiceProps) {
    super(scope, id);

    const { auth, dynamoTable, eventBus, asyncJob } = props;

    // Build Docker image for App Runner
    // Same image as ECS Fargate - App Runner pulls from ECR
    const image = new DockerImageAsset(this, 'Image', {
      directory: join('..', 'webapp'),
      platform: Platform.LINUX_AMD64, // App Runner currently only supports x86_64
      exclude: readFileSync(join('..', 'webapp', '.dockerignore'))
        .toString()
        .split('\n'),
      buildArgs: {
        ALLOWED_ORIGIN_HOST: '*.awsapprunner.com',
        SKIP_TS_BUILD: 'true',
        BUILD_TIMESTAMP: new Date().toISOString(),
      },
    });

    // Create or reference secret for Next.js Server Actions encryption key
    const secretName = `/${Stack.of(this).stackName}/next-server-actions-encryption-key`;
    const serverActionsKeySecret = new Secret(this, 'ServerActionsEncryptionKey', {
      secretName,
      description: 'Encryption key for Next.js Server Actions - must be consistent across deployments',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'encryptionKey',
        passwordLength: 32,
        excludeCharacters: '"@/\\',
      },
    });

    // Instance role for the App Runner service
    // This role is assumed by the container to access AWS services
    const instanceRole = new Role(this, 'InstanceRole', {
      assumedBy: new ServicePrincipal('tasks.apprunner.amazonaws.com'),
      description: 'Role for TaskTitan App Runner service to access AWS services',
    });

    // Grant DynamoDB permissions
    dynamoTable.table.grantReadWriteData(instanceRole);

    // Grant Bedrock permissions for AI features
    instanceRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
          `arn:aws:bedrock:us-*:${Stack.of(this).account}:inference-profile/us.anthropic.claude-*`,
          `arn:aws:bedrock:*:${Stack.of(this).account}:inference-profile/global.anthropic.claude-*`,
        ],
      }),
    );

    // Grant async job invoke permission
    asyncJob.handler.grantInvoke(instanceRole);

    // Grant Secrets Manager read for encryption key
    serverActionsKeySecret.grantRead(instanceRole);

    // Auto-scaling configuration
    // AWS Best Practice: Start with conservative scaling, adjust based on traffic patterns
    const autoScaling = new AutoScalingConfiguration(this, 'AutoScaling', {
      autoScalingConfigurationName: `${Stack.of(this).stackName}-autoscaling`,
      minSize: 1, // Cost optimization: scale to zero would require custom implementation
      maxSize: 10,
      maxConcurrency: 100, // Requests per instance before scaling
    });

    // Create App Runner service
    // Reference: https://docs.aws.amazon.com/cdk/api/v2/docs/@aws-cdk_aws-apprunner-alpha.Service.html
    this.service = new Service(this, 'Service', {
      serviceName: `${Stack.of(this).stackName}-webapp`,
      source: Source.fromAsset({
        imageConfiguration: {
          port: 3000,
          environmentVariables: {
            // DynamoDB configuration
            DYNAMODB_TABLE_NAME: dynamoTable.tableName,
            // Auth configuration
            COGNITO_DOMAIN: auth.domainName,
            USER_POOL_ID: auth.userPool.userPoolId,
            USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
            // Service configuration
            ASYNC_JOB_HANDLER_ARN: asyncJob.handler.functionArn,
            // Logging
            POWERTOOLS_SERVICE_NAME: 'TaskTitanWebapp',
            LOG_LEVEL: 'INFO',
            // Next.js configuration
            PORT: '3000',
            HOSTNAME: '0.0.0.0',
          },
          environmentSecrets: {
            NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: AppRunnerSecret.fromSecretsManager(
              serverActionsKeySecret,
              'encryptionKey',
            ),
          },
        },
        asset: image,
      }),
      cpu: Cpu.ONE_VCPU,
      memory: Memory.TWO_GB,
      instanceRole,
      autoScalingConfiguration: autoScaling,
      healthCheck: HealthCheck.http({
        path: '/api/health',
        interval: Duration.seconds(10),
        timeout: Duration.seconds(5),
        healthyThreshold: 1,
        unhealthyThreshold: 5,
      }),
    });

    this.serviceUrl = this.service.serviceUrl;

    // Configure auth callback URLs
    auth.updateAllowedCallbackUrls(
      [`https://${this.serviceUrl}/api/auth/sign-in-callback`, `http://localhost:3010/api/auth/sign-in-callback`],
      [`https://${this.serviceUrl}/api/auth/sign-out-callback`, `http://localhost:3010/api/auth/sign-out-callback`],
    );

    // Outputs
    new CfnOutput(Stack.of(this), 'AppRunnerServiceUrl', {
      value: `https://${this.serviceUrl}`,
      description: 'App Runner service URL (HTTPS)',
    });

    new CfnOutput(Stack.of(this), 'AppRunnerServiceArn', {
      value: this.service.serviceArn,
      description: 'App Runner service ARN',
    });
  }
}
