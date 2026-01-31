/**
 * AppSync Lambda Handler: createSmartComponent
 *
 * Creates a structured component from natural language input.
 * Uses the existing natural-language-generator.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { createComponentFromNaturalLanguage } from '@/lib/ai/generators/natural-language-generator';
import { generateInitialSuggestions } from '@/lib/ai/generators/chat-refinement-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { NaturalLanguageComponentInput } from '@/lib/ai/types';

const logger = new Logger({ serviceName: 'AppSyncSmartComponent' });

export interface SmartComponentInput {
  projectId: string;
  userInput: string;
  parentComponentId?: string | null;
}

export interface SmartComponentResult {
  component: {
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
    parentName?: string | null;
    acceptanceCriteria?: string[] | null;
  };
  reasoning: string;
  suggestedFollowUps: string[];
}

/**
 * Handler for creating a smart component from natural language
 */
export async function handleAppSyncSmartComponent(
  input: SmartComponentInput,
  identity?: { sub?: string }
): Promise<SmartComponentResult> {
  logger.info('Creating smart component', {
    projectId: input.projectId,
    userInputLength: input.userInput.length,
    parentComponentId: input.parentComponentId,
    userId: identity?.sub,
  });

  const client = getDynamoDBClient();
  const tableName = getTableName();

  // Fetch project for context
  const projectResponse = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `PROJECT#${input.projectId}`,
        sk: 'METADATA',
      },
    })
  );

  const project = projectResponse.Item;
  if (!project) {
    throw new Error('Project not found');
  }

  // Fetch existing components for context
  const componentsResponse = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `PROJECT#${input.projectId}`,
      },
    })
  );

  const existingComponents = (componentsResponse.Items || [])
    .filter((item) => item.sk?.startsWith('METADATA') && item.pk?.startsWith('COMPONENT#'))
    .map((item) => ({
      name: item.name as string,
      type: item.type as string,
    }));

  // Fetch parent component if specified
  let parentComponent: { id: string; name: string; type: string } | undefined;
  if (input.parentComponentId) {
    const parentResponse = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: `COMPONENT#${input.parentComponentId}`,
          sk: 'METADATA',
        },
      })
    );

    if (parentResponse.Item) {
      parentComponent = {
        id: input.parentComponentId,
        name: parentResponse.Item.name as string,
        type: parentResponse.Item.type as string,
      };
    }
  }

  // Prepare input for the natural language generator
  const nlInput: NaturalLanguageComponentInput = {
    userInput: input.userInput,
    projectContext: {
      projectName: project.name as string,
      projectDescription: (project.description as string) || '',
      existingComponents,
    },
    parentComponent,
  };

  // Call the AI generator
  const result = await createComponentFromNaturalLanguage(nlInput);

  logger.info('Bedrock token usage', {
    operation: 'createSmartComponent',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: (result.inputTokens || 0) + (result.outputTokens || 0),
  });

  // Generate follow-up suggestions
  const suggestedFollowUps = generateInitialSuggestions(result);

  logger.info('Smart component created successfully', {
    componentName: result.name,
    componentType: result.type,
    estimatedHours: result.estimatedHours,
  });

  return {
    component: {
      name: result.name,
      description: result.description,
      type: result.type,
      estimatedHours: result.estimatedHours,
      priority: result.priority,
      suggestedDependencies: result.suggestedDependencies,
      parentName: parentComponent?.name,
      acceptanceCriteria: result.acceptanceCriteria,
    },
    reasoning: result.reasoning,
    suggestedFollowUps,
  };
}
