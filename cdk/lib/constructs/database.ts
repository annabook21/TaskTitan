import { CfnOutput, Duration, Stack, Token } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Secret as AppRunnerSecret } from '@aws-cdk/aws-apprunner-alpha';
import { Construct } from 'constructs';

interface DatabaseProps {
  vpc: ec2.IVpc;
  /**
   * Backup retention period in days.
   * @default 7 days
   */
  backupRetentionDays?: number;
}

export class Database extends Construct implements ec2.IConnectable {
  readonly cluster: rds.DatabaseCluster;
  readonly secret: secretsmanager.ISecret;
  readonly connections: ec2.Connections;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const vpc = props.vpc;
    const backupRetentionDays = props.backupRetentionDays ?? 7;

    const engine = rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 });
    const cluster = new rds.DatabaseCluster(this, 'Cluster', {
      engine,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        enablePerformanceInsights: true,
        autoMinorVersionUpgrade: true,
      }),
      serverlessV2MinCapacity: 0,
      // AWS Best Practice: Set max capacity for production workloads
      // 16 ACU provides headroom for traffic spikes while maintaining cost efficiency
      // Cost: $0 idle, $1.92/hour at peak, realistic $35-70/month
      // Reference: https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.setting-capacity.html
      serverlessV2MaxCapacity: 16,
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnets: vpc.isolatedSubnets.concat(vpc.privateSubnets) }),
      storageEncrypted: true,
      // Automated backups - STRETCH GOAL: Data store is regularly backed up
      backup: {
        retention: Duration.days(backupRetentionDays),
        preferredWindow: '03:00-04:00', // 3-4 AM UTC
      },
      // Enable deletion protection for production
      deletionProtection: true,
      // Exclude some more special characters from password string to avoid from URI encoding issue
      // see: https://www.prisma.io/docs/orm/reference/connection-urls#special-characters
      credentials: rds.Credentials.fromUsername(engine.defaultUsername ?? 'admin', {
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\,=^',
      }),
      parameterGroup: new rds.ParameterGroup(this, 'ParameterGroup', {
        engine,
        parameters: {
          // Close idle connection after 60 seconds for Aurora auto-pause
          idle_session_timeout: '60000',
          // Log only data modifications (not all statements) for production
          // Use 'all' for development/debugging, 'mod' or 'ddl' for production
          log_statement: 'mod',
          log_min_duration_statement: '1000', // Log queries taking > 1 second
        },
      }),
      // CloudWatch Logs export for searchable logs
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: 30, // Retain logs for 30 days
    });

    this.cluster = cluster;
    this.secret = cluster.secret!;
    this.connections = this.cluster.connections;

    // FORGE: Bastion host removed for cost optimization
    // Database access is via:
    // 1. ECS Fargate tasks (same VPC)
    // 2. Lambda functions (same VPC)
    // For manual access, use AWS Session Manager with an EC2 instance if needed

    new CfnOutput(this, 'DatabaseSecretsCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${cluster.secret!.secretName} --region ${
        Stack.of(this).region
      }`,
    });
  }

  public getConnectionInfo() {
    return {
      // We use direct reference for host and port because using only secret here results in failure of refreshing values.
      // Also refer to: https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/369
      host: this.cluster.clusterEndpoint.hostname,
      port: Token.asString(this.cluster.clusterEndpoint.port),
      engine: this.secret.secretValueFromJson('engine').unsafeUnwrap(),
      username: this.secret.secretValueFromJson('username').unsafeUnwrap(),
      password: this.secret.secretValueFromJson('password').unsafeUnwrap(),
    };
  }

  public getLambdaEnvironment(databaseName: string) {
    const conn = this.getConnectionInfo();
    // Optimized for Aurora Serverless v2 cold start (up to 15s) + connection overhead
    // AWS Best Practice: 1 connection per Lambda for serverless workloads
    // Reference: https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-aws-lambda
    const option = [
      'connection_limit=1', // 1 connection per Lambda (critical for serverless)
      'pool_timeout=30', // > 15s cold start + 5s connection
      'connect_timeout=30', // Same rationale
      'socket_timeout=60', // For long AI operations
    ].join('&');
    return {
      DATABASE_HOST: conn.host,
      DATABASE_NAME: databaseName,
      DATABASE_USER: conn.username,
      DATABASE_PASSWORD: conn.password,
      DATABASE_ENGINE: conn.engine,
      DATABASE_PORT: conn.port,
      DATABASE_OPTION: option,
      DATABASE_URL: `${conn.engine}://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${databaseName}?${option}`,
    };
  }

  /**
   * Returns ECS secret references for secure credential injection.
   * AWS Best Practice: Use Secrets Manager with ECS secret injection instead of plain environment variables.
   * Secrets are injected at container startup and not visible in task definitions or CloudWatch logs.
   */
  public getEcsSecrets(): { [key: string]: ecs.Secret } {
    return {
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(this.secret, 'password'),
      DATABASE_USER: ecs.Secret.fromSecretsManager(this.secret, 'username'),
    };
  }

  /**
   * Returns non-sensitive database environment variables for ECS tasks.
   * Use with getEcsSecrets() for complete database configuration.
   */
  public getEcsEnvironment(databaseName: string) {
    const option = [
      'connection_limit=10', // ECS can handle more connections than Lambda
      'pool_timeout=30',
      'connect_timeout=30',
      'socket_timeout=60',
    ].join('&');
    return {
      DATABASE_HOST: this.cluster.clusterEndpoint.hostname,
      DATABASE_NAME: databaseName,
      DATABASE_ENGINE: 'postgresql',
      DATABASE_PORT: Token.asString(this.cluster.clusterEndpoint.port),
      DATABASE_OPTION: option,
    };
  }

  /**
   * Returns App Runner secret references for secure credential injection.
   * Used by AppRunnerService construct for dual-write migration period.
   */
  public getAppRunnerSecrets(): { [key: string]: AppRunnerSecret } {
    return {
      DATABASE_PASSWORD: AppRunnerSecret.fromSecretsManager(this.secret, 'password'),
      DATABASE_USER: AppRunnerSecret.fromSecretsManager(this.secret, 'username'),
    };
  }
}
