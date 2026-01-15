import { IgnoreMode, Duration, CfnOutput, Stack, RemovalPolicy } from 'aws-cdk-lib';
import { Platform, DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { DockerImageFunction, DockerImageCode, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Database } from './database';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Auth } from './auth/';
import { join } from 'path';
import { EventBus } from './event-bus/';
import { AsyncJob } from './async-job';
import { Trigger } from 'aws-cdk-lib/triggers';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ContainerImage, CpuArchitecture, OperatingSystemFamily } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import {
  Distribution,
  OriginProtocolPolicy,
  ViewerProtocolPolicy,
  AllowedMethods,
  CachePolicy,
  OriginRequestPolicy,
  SecurityPolicyProtocol,
} from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Port } from 'aws-cdk-lib/aws-ec2';

export interface WebappProps {
  database: Database;
  accessLogBucket: Bucket;
  wireframeBucket: Bucket;
  auth: Auth;
  eventBus: EventBus;
  asyncJob: AsyncJob;

  /**
   * Route 53 hosted zone for custom domain.
   *
   * @default No custom domain. The webapp will use CloudFront's default domain (e.g., d1234567890.cloudfront.net).
   */
  hostedZone?: IHostedZone;
  /**
   * ACM certificate for custom domain (must be in us-east-1 for CloudFront).
   *
   * @default No custom domain.
   */
  certificate?: ICertificate;
  /**
   * Subdomain name for the webapp. If not specified, the root domain will be used.
   *
   * @default Use root domain
   */
  subDomain?: string;
}

export class Webapp extends Construct {
  public readonly baseUrl: string;
  public readonly fargateService: ApplicationLoadBalancedFargateService;
  /**
   * The Route53 A record for the webapp domain.
   * Only set when using a custom domain.
   */
  public readonly aRecord?: ARecord;

  constructor(scope: Construct, id: string, props: WebappProps) {
    super(scope, id);

    const { database, hostedZone, auth, subDomain, eventBus, asyncJob, wireframeBucket } = props;
    const vpc = database.cluster.vpc;

    // Build Docker image for ECS Fargate
    // ECS Fargate eliminates cold starts - containers stay warm and ready
    // Note: NEXT_PUBLIC_* environment variables are passed at runtime, not build time
    // because DockerImageAsset doesn't support token-based buildArgs
    const image = new DockerImageAsset(this, 'Image', {
      directory: join('..', 'webapp'),
      platform: Platform.LINUX_ARM64,
      ignoreMode: IgnoreMode.DOCKER,
      exclude: readFileSync(join('..', 'webapp', '.dockerignore'))
        .toString()
        .split('\n'),
      buildArgs: {
        ALLOWED_ORIGIN_HOST: hostedZone ? `${hostedZone.zoneName},*.${hostedZone.zoneName}` : '*.cloudfront.net',
        SKIP_TS_BUILD: 'true',
        BUILD_TIMESTAMP: new Date().toISOString(),
      },
    });

    // CloudWatch Log Group for container logs
    const logGroup = new LogGroup(this, 'LogGroup', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Get database connection info for container environment
    const dbEnv = database.getLambdaEnvironment('main');

    // Compute the domain name for AMPLIFY_APP_ORIGIN
    // For custom domain: use the domain name directly
    // For CloudFront default: we'll set it after distribution is created
    let domainName = '';
    if (hostedZone) {
      domainName = subDomain ? `${subDomain}.${hostedZone.zoneName}` : hostedZone.zoneName;
    }

    // AWS Best Practice: Use ApplicationLoadBalancedFargateService pattern
    // Reference: https://docs.aws.amazon.com/cdk/v2/guide/ecs-example.html
    // This high-level construct automatically:
    // - Configures load balancer
    // - Manages security groups
    // - Handles dependency ordering
    // - Validates parameters early
    // Note: Using 'Fargate' ID to avoid conflict with CloudFront 'Service' construct (legacy ID compatibility)
    const fargateService = new ApplicationLoadBalancedFargateService(this, 'Fargate', {
      // Use existing VPC where database lives
      vpc,
      // Task configuration - ARM64 for cost efficiency (~20% savings)
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
      // High availability - start with 2 tasks
      desiredCount: 2,
      // Container configuration
      taskImageOptions: {
        image: ContainerImage.fromDockerImageAsset(image),
        containerPort: 3000,
        enableLogging: true,
        logDriver: logGroup
          ? undefined // Let the pattern create one with our settings applied separately
          : undefined,
        environment: {
          // Database configuration
          DATABASE_HOST: dbEnv.DATABASE_HOST,
          DATABASE_NAME: dbEnv.DATABASE_NAME,
          DATABASE_USER: dbEnv.DATABASE_USER,
          DATABASE_PASSWORD: dbEnv.DATABASE_PASSWORD,
          DATABASE_ENGINE: dbEnv.DATABASE_ENGINE,
          DATABASE_PORT: dbEnv.DATABASE_PORT,
          DATABASE_OPTION: dbEnv.DATABASE_OPTION,
          DATABASE_URL: dbEnv.DATABASE_URL,
          // Auth configuration
          COGNITO_DOMAIN: auth.domainName,
          USER_POOL_ID: auth.userPool.userPoolId,
          USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
          // Service configuration
          ASYNC_JOB_HANDLER_ARN: asyncJob.handler.functionArn,
          WIREFRAME_BUCKET_NAME: wireframeBucket.bucketName,
          // Logging
          POWERTOOLS_SERVICE_NAME: 'TaskTitanWebapp',
          LOG_LEVEL: 'INFO',
          // Next.js configuration
          PORT: '3000',
          HOSTNAME: '0.0.0.0',
          // AMPLIFY_APP_ORIGIN for auth callback URLs
          ...(domainName ? { AMPLIFY_APP_ORIGIN: `https://${domainName}` } : {}),
        },
      },
      // ALB is internal - CloudFront will be the public endpoint
      publicLoadBalancer: true,
      // AWS Best Practice: Enable circuit breaker for safe deployments
      // Reference: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html
      circuitBreaker: {
        rollback: true,
      },
      // Health check configuration
      healthCheckGracePeriod: Duration.seconds(60),
      // Deployment configuration - keep minimum 100% healthy during deployments
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      // Enable Container Insights for monitoring
      enableECSManagedTags: true,
    });
    this.fargateService = fargateService;

    // Allow Fargate to connect to database
    database.connections.allowFrom(
      fargateService.service,
      Port.tcp(5432),
      'Allow Fargate to access Aurora PostgreSQL',
    );

    // Configure ALB target group health check
    fargateService.targetGroup.configureHealthCheck({
      path: '/api/health',
      interval: Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // AWS Best Practice: Auto-scaling based on CPU and memory utilization
    // Reference: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html
    const scaling = fargateService.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(1),
    });
    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(1),
    });

    // Grant Bedrock permissions for AI component generation
    // Note: Global inference profiles use a different ARN format without account ID
    // See: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference-support.html
    fargateService.taskDefinition.taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          // Global inference profiles (cross-region) - no account ID in ARN
          'arn:aws:bedrock:*::foundation-model/anthropic.claude-*',
          // US inference profiles
          `arn:aws:bedrock:us-*:${Stack.of(this).account}:inference-profile/us.anthropic.claude-*`,
          // Global inference profiles in specific regions
          `arn:aws:bedrock:*:${Stack.of(this).account}:inference-profile/global.anthropic.claude-*`,
        ],
      }),
    );

    // Grant S3 permissions for wireframe exports
    wireframeBucket.grantReadWrite(fargateService.taskDefinition.taskRole);

    // Grant Lambda invoke for async jobs
    asyncJob.handler.grantInvoke(fargateService.taskDefinition.taskRole);

    // CloudFront Distribution for global edge caching and HTTPS
    // IMPORTANT: Uses nested construct 'Resource/Resource' to match old CloudFormation logical ID
    // (old CloudFrontLambdaFunctionUrlService used ID 'Resource' inside Webapp).
    // This allows CloudFormation to UPDATE the existing distribution instead of creating a new one,
    // avoiding "CNAME already associated" errors when migrating from Lambda to ECS Fargate.
    const cloudFrontConstruct = new Construct(this, 'Resource');
    const distribution = new Distribution(cloudFrontConstruct, 'Resource', {
      comment: 'CloudFront for TaskTitan Webapp (ECS Fargate)',
      defaultBehavior: {
        origin: new LoadBalancerV2Origin(fargateService.loadBalancer, {
          protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED, // SSR - no caching by default
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
      },
      ...(hostedZone && props.certificate
        ? {
            domainNames: [domainName],
            certificate: props.certificate,
          }
        : {}),
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      logBucket: props.accessLogBucket,
      logFilePrefix: 'webapp/',
    });

    // Set baseUrl based on domain configuration
    if (hostedZone) {
      this.baseUrl = `https://${domainName}`;
      // Use 'Record' inside cloudFrontConstruct to match old CloudFormation logical ID (Resource/Record)
      this.aRecord = new ARecord(cloudFrontConstruct, 'Record', {
        zone: hostedZone,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        recordName: subDomain,
      });
    } else {
      this.baseUrl = `https://${distribution.domainName}`;
      // For CloudFront default domain, the container will use the Host header
    }

    // Configure auth callback URLs
    if (hostedZone) {
      auth.addAllowedCallbackUrls(
        `http://localhost:3010/api/auth/sign-in-callback`,
        `http://localhost:3010/api/auth/sign-out-callback`,
      );
      auth.addAllowedCallbackUrls(
        `${this.baseUrl}/api/auth/sign-in-callback`,
        `${this.baseUrl}/api/auth/sign-out-callback`,
      );
    } else {
      auth.updateAllowedCallbackUrls(
        [`${this.baseUrl}/api/auth/sign-in-callback`, `http://localhost:3010/api/auth/sign-in-callback`],
        [`${this.baseUrl}/api/auth/sign-out-callback`, `http://localhost:3010/api/auth/sign-out-callback`],
      );
    }

    // Database Migration Runner (still Lambda for simplicity)
    const migrationRunner = new DockerImageFunction(this, 'MigrationRunner', {
      code: DockerImageCode.fromImageAsset(join('..', 'webapp'), {
        platform: Platform.LINUX_ARM64,
        cmd: ['migration-runner.handler'],
        file: 'job.Dockerfile',
      }),
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      environment: {
        ...database.getLambdaEnvironment('main'),
        POWERTOOLS_SERVICE_NAME: 'TaskTitanMigration',
        LOG_LEVEL: 'INFO',
      },
      vpc: database.cluster.vpc,
      memorySize: 256,
      tracing: Tracing.ACTIVE,
    });
    migrationRunner.connections.allowToDefaultPort(database);

    // Run database migration during CDK deployment
    const trigger = new Trigger(this, 'MigrationTrigger', {
      handler: migrationRunner,
    });
    trigger.node.addDependency(database.cluster);

    // Outputs
    new CfnOutput(Stack.of(this), 'MigrationFunctionName', { value: migrationRunner.functionName });
    new CfnOutput(Stack.of(this), 'MigrationCommand', {
      value: `aws lambda invoke --function-name ${migrationRunner.functionName} --payload '{"command":"deploy"}' --cli-binary-format raw-in-base64-out /dev/stdout`,
    });
    new CfnOutput(Stack.of(this), 'ALBDnsName', { value: fargateService.loadBalancer.loadBalancerDnsName });
  }
}
