/**
 * AppSync getTeamMetrics Handler
 *
 * Computes aggregated metrics for a team by querying:
 * 1. Projects for the team (GSI2: gsi2pk=TEAM#teamId)
 * 2. Components for each project (GSI1: gsi1pk=PROJECT#projectId)
 * 3. Sprints for the team (GSI1: gsi1pk=TEAM#teamId, gsi1sk begins_with SPRINT#)
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { logger } from '@/lib/logger';

interface TeamMetrics {
  teamId: string;
  totalComponents: number;
  statusDistribution: Array<{ status: string; count: number }>;
  epicCount: number;
  featureCount: number;
  storyCount: number;
  taskCount: number;
  bugCount: number;
  totalSprints: number;
  activeSprints: number;
  completedSprints: number;
}

const COMPONENT_TYPES = ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'] as const;
const COMPONENT_STATUSES = ['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'] as const;

export async function handleAppSyncGetTeamMetrics(teamId: string): Promise<TeamMetrics> {
  const client = getDynamoDBClient();
  const tableName = getTableName();

  logger.info('Computing team metrics', { teamId });

  // Step 1: Query projects for the team using GSI2
  const projectsResult = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'gsi2',
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
      },
    }),
  );

  const projects = projectsResult.Items || [];
  const projectIds = projects.map((p) => p.id as string);

  logger.info('Found projects for team', { teamId, projectCount: projectIds.length });

  // Step 2: Query components for all projects
  // For simplicity, we query components for each project and aggregate
  const allComponents: Array<{ type: string; status: string }> = [];

  for (const projectId of projectIds) {
    const componentsResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `PROJECT#${projectId}`,
        },
        Limit: 500,
      }),
    );

    const items = componentsResult.Items || [];
    // Filter to only COMPONENT entities (those with type in COMPONENT_TYPES)
    for (const item of items) {
      if (item.type && COMPONENT_TYPES.includes(item.type as (typeof COMPONENT_TYPES)[number])) {
        allComponents.push({
          type: item.type as string,
          status: item.status as string,
        });
      }
    }
  }

  logger.info('Found components for team', { teamId, componentCount: allComponents.length });

  // Step 3: Query sprints for the team using GSI1
  const sprintsResult = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${teamId}`,
        ':sk': 'SPRINT#',
      },
    }),
  );

  const sprints = sprintsResult.Items || [];

  logger.info('Found sprints for team', { teamId, sprintCount: sprints.length });

  // Step 4: Compute metrics
  const statusCounts: Record<string, number> = {
    PLANNING: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    REVIEW: 0,
    COMPLETED: 0,
  };

  const typeCounts: Record<string, number> = {
    EPIC: 0,
    FEATURE: 0,
    STORY: 0,
    TASK: 0,
    BUG: 0,
  };

  for (const component of allComponents) {
    if (component.status && component.status in statusCounts) {
      statusCounts[component.status]++;
    }
    if (component.type && component.type in typeCounts) {
      typeCounts[component.type]++;
    }
  }

  const statusDistribution = COMPONENT_STATUSES.map((status) => ({
    status,
    count: statusCounts[status],
  }));

  let activeSprints = 0;
  let completedSprints = 0;
  for (const sprint of sprints) {
    if (sprint.status === 'ACTIVE') activeSprints++;
    else if (sprint.status === 'COMPLETED') completedSprints++;
  }

  const metrics: TeamMetrics = {
    teamId,
    totalComponents: allComponents.length,
    statusDistribution,
    epicCount: typeCounts.EPIC,
    featureCount: typeCounts.FEATURE,
    storyCount: typeCounts.STORY,
    taskCount: typeCounts.TASK,
    bugCount: typeCounts.BUG,
    totalSprints: sprints.length,
    activeSprints,
    completedSprints,
  };

  logger.info('Team metrics computed', { teamId, metrics });

  return metrics;
}
