/**
 * AppSync Handler: Generate Retrospective
 *
 * AI-powered sprint retrospective with estimate adjustment.
 * Includes DynamoDB transaction pattern for atomic updates (AWS best practice).
 */

import { generateRetrospective } from '@/lib/ai/generators/retrospective-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@/lib/logger';

export interface GenerateRetrospectiveInput {
  sprintId: string;
  applyAdjustments?: boolean;
}

export interface GenerateRetrospectiveResult {
  summary: string;
  insights: {
    estimationAccuracy: string;
    velocityTrend: string;
    recommendations: string[];
  };
  adjustedEstimates: Array<{
    componentId: string;
    componentName: string;
    originalEstimate: number;
    adjustedEstimate: number;
    reasoning: string;
  }>;
  suggestedActions: string[];
  adjustmentsApplied: boolean;
}

export async function handleAppSyncGenerateRetrospective(
  input: GenerateRetrospectiveInput
): Promise<GenerateRetrospectiveResult> {
  logger.info('Generating retrospective', {
    sprintId: input.sprintId,
    applyAdjustments: input.applyAdjustments,
  });

  const client = getDynamoDBClient();
  const tableName = getTableName();

  // Fetch the sprint
  const sprintResult = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `SPRINT#${input.sprintId}`,
        sk: 'METADATA',
      },
    })
  );

  if (!sprintResult.Item) {
    throw new Error(`Sprint not found: ${input.sprintId}`);
  }

  const sprint = sprintResult.Item;

  // Fetch components assigned to this sprint (via GSI2)
  const componentsResult = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'gsi2',
      KeyConditionExpression: 'gsi2pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `SPRINT#${input.sprintId}`,
      },
    })
  );

  const sprintComponents = componentsResult.Items || [];

  // Separate completed vs in-progress
  const completedComponents = sprintComponents
    .filter((c) => c.status === 'DONE' || c.status === 'COMPLETED')
    .map((c) => ({
      name: c.name as string,
      type: c.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
      estimatedHours: (c.estimatedHours as number) || 0,
      actualHours: (c.actualHours as number) || (c.estimatedHours as number) || 0,
      status: (c.status === 'DONE' || c.status === 'COMPLETED' ? 'COMPLETED' : 'INCOMPLETE') as 'COMPLETED' | 'INCOMPLETE',
    }));

  // Get upcoming components (backlog items not in sprint)
  const upcomingResult = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      FilterExpression: 'attribute_not_exists(sprintId) OR sprintId = :null',
      ExpressionAttributeValues: {
        ':pk': `TEAM#${sprint.teamId}`,
        ':null': null,
      },
      Limit: 20,
    })
  );

  // Build a map of component name -> component ID for later lookup
  const upcomingComponentMap = new Map<string, string>();
  const upcomingComponents = (upcomingResult.Items || []).map((c) => {
    const name = c.name as string;
    const componentId = c.id as string;
    upcomingComponentMap.set(name, componentId);
    return {
      name,
      type: c.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
      estimatedHours: (c.estimatedHours as number) || 0,
      description: (c.description as string) || '',
    };
  });

  // Call the retrospective generator
  const result = await generateRetrospective({
    sprintName: sprint.name as string,
    sprintGoal: (sprint.goal as string) || '',
    completedComponents,
    upcomingComponents,
    teamVelocity: sprint.capacity
      ? {
          lastSprintCapacity: sprint.capacity as number,
          actualDelivered: completedComponents.reduce((sum, c) => sum + c.actualHours, 0),
        }
      : undefined,
  });

  let adjustmentsApplied = false;

  // Apply estimate adjustments if requested (DynamoDB transaction pattern)
  if (input.applyAdjustments && result.adjustedEstimates && result.adjustedEstimates.length > 0) {
    // Map adjustments to include componentId from our lookup, filtering out any without valid IDs
    const updatesWithIds = result.adjustedEstimates
      .map((adj) => ({
        ...adj,
        componentId: upcomingComponentMap.get(adj.componentName) || '',
      }))
      .filter((adj) => adj.componentId) // Only include items with valid componentId
      .slice(0, 25); // TransactWrite limit is 100, but we'll be conservative

    if (updatesWithIds.length > 0) {
      try {
        const transactItems = updatesWithIds.map((adj) => ({
          Update: {
            TableName: tableName,
            Key: {
              pk: `COMPONENT#${adj.componentId}`,
              sk: 'METADATA',
            },
            UpdateExpression: 'SET estimatedHours = :est, updatedAt = :now',
            ExpressionAttributeValues: {
              ':est': adj.adjustedEstimate,
              ':now': new Date().toISOString(),
            },
          },
        }));

        await client.send(
          new TransactWriteCommand({
            TransactItems: transactItems,
            ClientRequestToken: `retro-${input.sprintId}-${Date.now()}`, // Idempotency
          })
        );

        adjustmentsApplied = true;
        logger.info('Estimate adjustments applied', { count: updatesWithIds.length });
      } catch (err) {
        logger.error('Failed to apply estimate adjustments', { error: err });
        // Don't fail the whole operation - just report adjustments weren't applied
      }
    }
  }

  logger.info('Retrospective generated successfully', {
    adjustmentCount: result.adjustedEstimates?.length || 0,
    adjustmentsApplied,
  });

  // Map adjusted estimates to include componentId from our lookup
  const adjustedEstimatesWithIds = (result.adjustedEstimates || []).map((adj) => ({
    componentId: upcomingComponentMap.get(adj.componentName) || '',
    componentName: adj.componentName,
    originalEstimate: adj.originalEstimate,
    adjustedEstimate: adj.adjustedEstimate,
    reasoning: adj.reasoning,
  }));

  return {
    summary: result.summary,
    insights: result.insights,
    adjustedEstimates: adjustedEstimatesWithIds,
    suggestedActions: result.suggestedActions || [],
    adjustmentsApplied,
  };
}
