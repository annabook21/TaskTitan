import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
  TableEncryption,
  StreamViewType,
} from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * DynamoDB Single-Table Design for TaskTitan
 *
 * AWS Best Practice: Single-table design reduces costs and improves performance
 * Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html
 *
 * Table Schema:
 * | PK Pattern            | SK Pattern                      | Entity                    |
 * |-----------------------|---------------------------------|---------------------------|
 * | USER#<id>             | METADATA                        | User                      |
 * | TEAM#<id>             | METADATA                        | Team                      |
 * | TEAM#<id>             | MEMBER#<userId>                 | Membership                |
 * | TEAM#<id>             | PROJECT#<projectId>             | Project                   |
 * | TEAM#<id>             | SPRINT#<sprintId>               | Sprint                    |
 * | PROJECT#<id>          | COMPONENT#<componentId>         | Component                 |
 * | PROJECT#<id>          | ACTIVITY#<timestamp>#<id>       | Activity                  |
 * | COMPONENT#<id>        | METADATA                        | Component (for direct access) |
 * | COMPONENT#<id>        | ASSIGNEE#<userId>               | Assignment                |
 * | COMPONENT#<id>        | DEPENDS_ON#<requiredId>         | Dependency                |
 * | COMPONENT#<id>        | PREVIEW#<previewId>             | ComponentPreview          |
 * | COMPONENT#<id>        | STATUS_HISTORY#<timestamp>#<id> | ComponentStatusHistory    |
 * | USER#<id>             | NOTIFICATION#<timestamp>#<id>   | Notification              |
 * | TEAM#<id>             | WORKFLOW_CONFIG                 | TeamWorkflowConfig        |
 * | PROJECT#<id>          | GITHUB_CONFIG#<event>           | GitHubTransitionConfig    |
 *
 * GSI1 (gsi1pk, gsi1sk): Cross-entity lookups
 * - User email lookup: gsi1pk=EMAIL#<email>, gsi1sk=USER
 * - User's teams: gsi1pk=USER#<id>, gsi1sk=TEAM#<teamId>
 * - User's assignments: gsi1pk=USER#<id>, gsi1sk=ASSIGNMENT#<componentId>
 * - Project owner lookup: gsi1pk=OWNER#<userId>, gsi1sk=PROJECT#<projectId>
 *
 * GSI2 (gsi2pk, gsi2sk): Sprint and status queries
 * - Sprint components: gsi2pk=SPRINT#<sprintId>, gsi2sk=COMPONENT#<componentId>
 * - Components by status: gsi2pk=PROJECT#<id>#STATUS#<status>, gsi2sk=COMPONENT#<componentId>
 * - Component parent lookup: gsi2pk=PARENT#<parentId>, gsi2sk=COMPONENT#<componentId>
 */

export interface TaskTitanTableProps {
  /**
   * Enable point-in-time recovery for data protection
   * @default true
   */
  readonly pointInTimeRecovery?: boolean;

  /**
   * Removal policy for the table
   * @default RemovalPolicy.RETAIN for production safety
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Enable DynamoDB Streams for change data capture
   * Useful for real-time updates and migration validation
   * @default true
   */
  readonly enableStreams?: boolean;
}

export class TaskTitanTable extends Construct {
  public readonly table: Table;
  public readonly tableName: string;
  public readonly tableArn: string;

  constructor(scope: Construct, id: string, props: TaskTitanTableProps = {}) {
    super(scope, id);

    const {
      pointInTimeRecovery = true,
      removalPolicy = RemovalPolicy.RETAIN,
      enableStreams = true,
    } = props;

    // AWS Best Practice: Single table with on-demand billing
    // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
    this.table = new Table(this, 'Table', {
      tableName: `${Stack.of(this).stackName}-TaskTitan`,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },

      // On-demand billing: Pay per request, scales automatically
      // Best for unpredictable workloads and cost optimization at low volumes
      billingMode: BillingMode.PAY_PER_REQUEST,

      // AWS Best Practice: Point-in-time recovery for 35-day backup retention
      // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: pointInTimeRecovery },

      // AWS-managed encryption (default, free, automatic key rotation)
      encryption: TableEncryption.AWS_MANAGED,

      // Enable streams for real-time updates and migration validation
      ...(enableStreams && {
        stream: StreamViewType.NEW_AND_OLD_IMAGES,
      }),

      // Retain table by default to prevent accidental data loss
      removalPolicy,

      // Enable Contributor Insights for identifying hot keys
      // Reference: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/contributorinsights.html
      contributorInsightsEnabled: true,
    });

    // GSI1: Cross-entity lookups (user email, user's teams, assignments)
    // AWS Best Practice: Use sparse indexes to reduce costs
    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI2: Sprint and status queries
    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi2',
      partitionKey: { name: 'gsi2pk', type: AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.tableName = this.table.tableName;
    this.tableArn = this.table.tableArn;
  }

  /**
   * Get environment variables for Lambda/ECS tasks
   */
  public getEnvironment(): Record<string, string> {
    return {
      DYNAMODB_TABLE_NAME: this.tableName,
    };
  }
}
