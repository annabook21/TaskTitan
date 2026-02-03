/**
 * AppSync Handler: Apply Template
 *
 * Applies a predefined component template to generate a structured breakdown.
 * Uses AI to customize the template based on entity name and requirements.
 */

import { applyComponentTemplate } from '@/lib/ai/generators/template-generator';
import { ComponentTemplate } from '@/lib/ai/types';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@/lib/logger';

export interface ApplyTemplateAppSyncInput {
  template: string;
  entityName: string;
  projectName: string;
  projectId: string;
  additionalRequirements?: string;
}

export interface ApplyTemplateAppSyncResult {
  components: Array<{
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
  }>;
  implementationNotes: string;
  techStackRecommendations?: string;
}

export async function handleAppSyncApplyTemplate(
  input: ApplyTemplateAppSyncInput,
): Promise<ApplyTemplateAppSyncResult> {
  logger.info('Applying template', {
    template: input.template,
    entityName: input.entityName,
    projectId: input.projectId,
  });

  // Fetch existing components for context
  const client = getDynamoDBClient();
  const tableName = getTableName();

  let existingComponents: Array<{ name: string; type: string }> = [];

  try {
    const queryResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `PROJECT#${input.projectId}`,
        },
        ProjectionExpression: '#n, #t',
        ExpressionAttributeNames: {
          '#n': 'name',
          '#t': 'type',
        },
      }),
    );

    existingComponents = (queryResult.Items || [])
      .filter((item) => item.name && item.type)
      .map((item) => ({
        name: item.name as string,
        type: item.type as string,
      }));
  } catch (err) {
    logger.warn('Failed to fetch existing components for context', { error: err });
    // Continue without context - not a critical failure
  }

  // Convert string template to enum
  const templateEnum = input.template as ComponentTemplate;

  // Call the template generator
  const result = await applyComponentTemplate({
    template: templateEnum,
    customization: {
      entityName: input.entityName,
      projectName: input.projectName,
      additionalRequirements: input.additionalRequirements,
    },
    projectContext: existingComponents.length > 0 ? { existingComponents } : undefined,
  });

  logger.info('Template applied successfully', {
    componentCount: result.components.length,
  });

  return result;
}
