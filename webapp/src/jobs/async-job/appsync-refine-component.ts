/**
 * AppSync Lambda Handler: refineComponent
 *
 * Refines a single component via conversational chat using AI.
 * Uses the existing chat-refinement-generator.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { refineComponentWithChat } from '@/lib/ai/generators/chat-refinement-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ChatRefinementInput, NaturalLanguageComponentResult } from '@/lib/ai/types';

const logger = new Logger({ serviceName: 'AppSyncRefineComponent' });

export interface RefineComponentInput {
  projectId: string;
  currentComponent: {
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
    reasoning: string;
    acceptanceCriteria?: string[] | null;
  };
  refinementRequest: string;
}

export interface RefineComponentResult {
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
  explanation: string;
  suggestedFollowUps: string[];
}

/**
 * Handler for refining a single component via chat
 */
export async function handleAppSyncRefineComponent(
  input: RefineComponentInput,
  identity?: { sub?: string }
): Promise<RefineComponentResult> {
  logger.info('Refining component', {
    projectId: input.projectId,
    componentName: input.currentComponent.name,
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

  // Prepare input for the chat refinement generator
  const currentComponent: NaturalLanguageComponentResult = {
    name: input.currentComponent.name,
    description: input.currentComponent.description,
    type: input.currentComponent.type,
    estimatedHours: input.currentComponent.estimatedHours,
    priority: input.currentComponent.priority,
    suggestedDependencies: input.currentComponent.suggestedDependencies,
    reasoning: input.currentComponent.reasoning,
    acceptanceCriteria: input.currentComponent.acceptanceCriteria || undefined,
  };

  const refinementInput: ChatRefinementInput = {
    currentComponent,
    refinementRequest: input.refinementRequest,
    projectContext: {
      projectName: project.name as string,
      projectDescription: (project.description as string) || '',
      existingComponents,
    },
  };

  // Call the AI refinement generator
  const result = await refineComponentWithChat(refinementInput);

  logger.info('Bedrock token usage', {
    operation: 'refineComponent',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: (result.inputTokens || 0) + (result.outputTokens || 0),
  });

  logger.info('Component refined successfully', {
    originalName: input.currentComponent.name,
    newName: result.component.name,
    explanation: result.explanation,
  });

  return {
    component: {
      name: result.component.name,
      description: result.component.description,
      type: result.component.type,
      estimatedHours: result.component.estimatedHours,
      priority: result.component.priority,
      suggestedDependencies: result.component.suggestedDependencies,
      acceptanceCriteria: result.component.acceptanceCriteria,
    },
    explanation: result.explanation,
    suggestedFollowUps: result.suggestedFollowUps,
  };
}
