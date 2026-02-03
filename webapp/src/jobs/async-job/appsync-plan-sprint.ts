/**
 * AppSync Lambda Handler: planSprint
 *
 * AI-powered sprint planning - suggests which components to include
 * based on capacity, priorities, and dependencies.
 * Uses the existing sprint-generator.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { planSprint } from '@/lib/ai/generators/sprint-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { SprintPlanningComponent } from '@/lib/ai/types';

const logger = new Logger({ serviceName: 'AppSyncPlanSprint' });

export interface PlanSprintInput {
  teamId: string;
  sprintId?: string | null;
  capacityHours: number;
}

export interface SprintPlanResult {
  selectedComponentIds: string[];
  totalHours: number;
  reasoning: string;
  warnings: string[];
}

/**
 * Handler for AI sprint planning
 */
export async function handleAppSyncPlanSprint(
  input: PlanSprintInput,
  identity?: { sub?: string },
): Promise<SprintPlanResult> {
  logger.info('Planning sprint', {
    teamId: input.teamId,
    sprintId: input.sprintId,
    capacityHours: input.capacityHours,
    userId: identity?.sub,
  });

  const client = getDynamoDBClient();
  const tableName = getTableName();

  // Fetch the sprint if specified
  let sprintName = 'New Sprint';
  let sprintGoal: string | undefined;

  if (input.sprintId) {
    const sprintResponse = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: `SPRINT#${input.sprintId}`,
          sk: 'METADATA',
        },
      }),
    );

    if (sprintResponse.Item) {
      sprintName = sprintResponse.Item.name as string;
      sprintGoal = sprintResponse.Item.goal as string | undefined;
    }
  }

  // Fetch all projects for the team
  const projectsResponse = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'gsi2',
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${input.teamId}`,
      },
    }),
  );

  const projectIds = (projectsResponse.Items || [])
    .filter((item) => item.pk?.startsWith('PROJECT#'))
    .map((item) => (item.pk as string).replace('PROJECT#', ''));

  if (projectIds.length === 0) {
    return {
      selectedComponentIds: [],
      totalHours: 0,
      reasoning: 'No projects found for this team.',
      warnings: ['No projects available for sprint planning.'],
    };
  }

  // Fetch all backlog components (not assigned to a sprint, not completed)
  const availableComponents: SprintPlanningComponent[] = [];

  for (const projectId of projectIds) {
    const componentsResponse = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `PROJECT#${projectId}`,
        },
      }),
    );

    const projectComponents = (componentsResponse.Items || [])
      .filter((item) => {
        if (!item.pk?.startsWith('COMPONENT#')) return false;
        if (!item.sk?.startsWith('METADATA')) return false;
        // Only include backlog items (not assigned to sprint, not completed)
        if (item.sprintId) return false;
        if (item.status === 'COMPLETED') return false;
        return true;
      })
      .map((item) => ({
        id: (item.pk as string).replace('COMPONENT#', ''),
        name: item.name as string,
        description: (item.description as string) || null,
        status: item.status as string,
        estimatedHours: (item.estimatedHours as number) || null,
        priority: (item.priority as number) || 5,
        dependsOn: [] as string[], // Would need to fetch dependencies
      }));

    availableComponents.push(...projectComponents);
  }

  if (availableComponents.length === 0) {
    return {
      selectedComponentIds: [],
      totalHours: 0,
      reasoning: 'No backlog components available for sprint planning.',
      warnings: ['All components are either completed or already assigned to a sprint.'],
    };
  }

  // Fetch dependencies for all components
  for (const component of availableComponents) {
    const depsResponse = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `COMPONENT#${component.id}`,
          ':sk': 'DEPENDS_ON#',
        },
      }),
    );

    const deps = (depsResponse.Items || []).map((item) => {
      // Find the component name for the dependency
      const depId = (item.sk as string).replace('DEPENDS_ON#', '');
      const depComponent = availableComponents.find((c) => c.id === depId);
      return depComponent?.name || depId;
    });

    component.dependsOn = deps;
  }

  logger.info('Found available components for planning', {
    componentCount: availableComponents.length,
    totalEstimatedHours: availableComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0),
  });

  // Call the AI sprint planner
  const result = await planSprint(sprintName, sprintGoal, input.capacityHours, availableComponents);

  logger.info('Bedrock token usage', {
    operation: 'planSprint',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: (result.inputTokens || 0) + (result.outputTokens || 0),
  });

  logger.info('Sprint planning complete', {
    selectedCount: result.selectedComponentIds.length,
    totalHours: result.totalHours,
    warningCount: result.warnings.length,
  });

  return {
    selectedComponentIds: result.selectedComponentIds,
    totalHours: result.totalHours,
    reasoning: result.reasoning,
    warnings: result.warnings,
  };
}
