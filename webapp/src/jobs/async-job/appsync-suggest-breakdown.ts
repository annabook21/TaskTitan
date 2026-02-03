/**
 * AppSync Handler: Suggest Breakdown
 *
 * Suggests hierarchical breakdown of components (Epic → Feature → Story → Task).
 */

import { suggestComponentBreakdown } from '@/lib/ai/generators/breakdown-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@/lib/logger';

export interface SuggestBreakdownInput {
  componentId: string;
  projectId: string;
}

export interface SuggestBreakdownResult {
  suggestions: Array<{
    name: string;
    description: string;
    type: 'FEATURE' | 'STORY' | 'TASK';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
    acceptanceCriteria?: string[];
  }>;
  reasoning: string;
  recommendedApproach: string;
}

export async function handleAppSyncSuggestBreakdown(input: SuggestBreakdownInput): Promise<SuggestBreakdownResult> {
  logger.info('Suggesting breakdown', {
    componentId: input.componentId,
    projectId: input.projectId,
  });

  const client = getDynamoDBClient();
  const tableName = getTableName();

  // Fetch the component to break down
  const componentResult = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `COMPONENT#${input.componentId}`,
        sk: 'METADATA',
      },
    }),
  );

  if (!componentResult.Item) {
    throw new Error(`Component not found: ${input.componentId}`);
  }

  const component = componentResult.Item;

  // Fetch related components for context
  let relatedComponents: Array<{ name: string; type: string; description: string | null }> = [];

  try {
    const queryResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `PROJECT#${input.projectId}`,
        },
        ProjectionExpression: '#n, #t, description',
        ExpressionAttributeNames: {
          '#n': 'name',
          '#t': 'type',
        },
        Limit: 50,
      }),
    );

    relatedComponents = (queryResult.Items || [])
      .filter((item) => item.name && item.type)
      .map((item) => ({
        name: item.name as string,
        type: item.type as string,
        description: (item.description as string) || null,
      }));
  } catch (err) {
    logger.warn('Failed to fetch related components', { error: err });
  }

  // Call the breakdown generator
  const result = await suggestComponentBreakdown({
    component: {
      id: input.componentId,
      name: component.name as string,
      description: (component.description as string) || null,
      type: component.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
    },
    projectContext:
      relatedComponents.length > 0
        ? {
            projectName: (component.projectName as string) || 'Project',
            relatedComponents,
          }
        : undefined,
  });

  logger.info('Breakdown suggested successfully', {
    suggestionCount: result.suggestions.length,
  });

  return result;
}
