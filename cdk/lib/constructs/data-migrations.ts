/**
 * Data Migrations Construct
 *
 * AWS Best Practice: Use CDK Custom Resources for data migrations
 * - Automatic execution during deployment
 * - Idempotent (safe to run multiple times)
 * - No manual intervention required
 * - Tracks deployment state in CloudFormation
 *
 * Reference: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.custom_resources-readme.html
 */

import { Construct } from 'constructs';
import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { Architecture, DockerImageCode, DockerImageFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { TaskTitanTable } from './dynamodb';
import { join } from 'path';

export interface DataMigrationsProps {
  readonly dynamoTable: TaskTitanTable;
}

/**
 * Data Migrations construct
 *
 * Runs data migrations automatically during CDK deployment.
 * Each migration is idempotent and can be safely re-run.
 */
export class DataMigrations extends Construct {
  constructor(scope: Construct, id: string, props: DataMigrationsProps) {
    super(scope, id);

    const { dynamoTable } = props;

    // Lambda function for data migrations
    // Uses Docker image for consistent Node.js environment and dependencies
    const migrationLambda = new DockerImageFunction(this, 'MigrationHandler', {
      code: DockerImageCode.fromImageAsset(join('..', 'webapp'), {
        cmd: ['migrations/fix-team-member-counts.handler'],
        platform: Platform.LINUX_ARM64,
        file: 'job.Dockerfile',
      }),
      memorySize: 512,
      timeout: Duration.minutes(5), // Generous timeout for large datasets
      architecture: Architecture.ARM_64,
      environment: {
        DYNAMODB_TABLE_NAME: dynamoTable.tableName,
      },
      description: 'Data migration: Fix stale team memberCount values',
    });

    // Grant DynamoDB read/write access for migration
    dynamoTable.table.grantReadWriteData(migrationLambda);

    // Custom Resource Provider
    // AWS Best Practice: Use Provider construct for Custom Resources
    // Reference: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.custom_resources.Provider.html
    const provider = new Provider(this, 'MigrationProvider', {
      onEventHandler: migrationLambda,
    });

    // Custom Resource that triggers the migration
    // Runs on Create and Update (when properties change)
    new CustomResource(this, 'FixTeamMemberCountsMigration', {
      serviceToken: provider.serviceToken,
      properties: {
        // Change this version to force re-run of migration
        // AWS Best Practice: Version your migrations to control re-execution
        version: '1.0.0',
        // Timestamp ensures migration runs on every deploy (optional)
        // Uncomment the next line to run on every deploy:
        // timestamp: new Date().toISOString(),
      },
    });
  }
}
