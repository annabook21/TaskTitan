/**
 * AppSync Handler: Generate Wireframe
 *
 * Generates HTML wireframe for UI components.
 */

import { generateWireframe } from '@/lib/ai/generators/wireframe-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@/lib/logger';

export interface GenerateWireframeInput {
  componentId: string;
}

export interface GenerateWireframeResult {
  html: string;
  componentName: string;
}

export async function handleAppSyncGenerateWireframe(input: GenerateWireframeInput): Promise<GenerateWireframeResult> {
  logger.info('Generating wireframe', { componentId: input.componentId });

  const client = getDynamoDBClient();
  const tableName = getTableName();

  // Fetch the component
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

  // Call the wireframe generator
  const result = await generateWireframe({
    componentName: component.name as string,
    description: (component.description as string) || '',
    type: component.type as string,
    dependencies: Array.isArray(component.dependencies) ? component.dependencies : undefined,
  });

  logger.info('Wireframe generated successfully', {
    htmlLength: result.html.length,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  return {
    html: result.html,
    componentName: component.name as string,
  };
}
