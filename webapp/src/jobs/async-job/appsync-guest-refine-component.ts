/**
 * AppSync Lambda Handler: guestRefineComponent
 *
 * Refines a single component via conversational chat using AI.
 * Uses the existing chat-refinement-generator.
 *
 * COPIED FROM appsync-refine-component.ts with guest assignment verification added.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { refineComponentWithChat } from '@/lib/ai/generators/chat-refinement-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ChatRefinementInput, NaturalLanguageComponentResult } from '@/lib/ai/types';

const logger = new Logger({ serviceName: 'AppSyncGuestRefineComponent' });

export interface GuestRefineComponentInput {
  guestId: string;
  componentId: string;
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
 * Handler for guest refining a component via chat
 * EXACT COPY of handleAppSyncRefineComponent with guest assignment check
 */
export async function handleAppSyncGuestRefineComponent(
  input: GuestRefineComponentInput,
  identity?: { cognitoIdentityId?: string }
): Promise<RefineComponentResult> {
  logger.info('Guest refining component', {
    guestId: input.guestId,
    componentId: input.componentId,
    cognitoIdentityId: identity?.cognitoIdentityId,
  });

  const client = getDynamoDBClient();
  const tableName = getTableName();

  // GUEST-SPECIFIC: Verify guest is assigned to this component
  const assignmentResponse = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `COMPONENT#${input.componentId}`,
        sk: `ASSIGNEE#GUEST#${input.guestId}`,
      },
    })
  );

  if (!assignmentResponse.Item) {
    throw new Error('You must be assigned to this component to refine it');
  }

  // Fetch the component details
  const componentResponse = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `COMPONENT#${input.componentId}`,
        sk: 'METADATA',
      },
    })
  );

  const component = componentResponse.Item;
  if (!component) {
    throw new Error('Component not found');
  }

  const projectId = component.projectId as string;

  // Fetch project for context (SAME AS AUTHENTICATED)
  const projectResponse = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `PROJECT#${projectId}`,
        sk: 'METADATA',
      },
    })
  );

  const project = projectResponse.Item;
  if (!project) {
    throw new Error('Project not found');
  }

  // Fetch existing components for context (SAME AS AUTHENTICATED)
  const componentsResponse = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': `PROJECT#${projectId}`,
      },
    })
  );

  const existingComponents = (componentsResponse.Items || [])
    .filter((item) => item.sk?.startsWith('METADATA') && item.pk?.startsWith('COMPONENT#'))
    .map((item) => ({
      name: item.name as string,
      type: item.type as string,
    }));

  // Prepare input for the chat refinement generator (SAME AS AUTHENTICATED)
  const currentComponent: NaturalLanguageComponentResult = {
    name: component.name as string,
    description: (component.description as string) || '',
    type: component.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
    estimatedHours: (component.estimatedHours as number) || 0,
    priority: (component.priority as number) || 5,
    suggestedDependencies: (component.suggestedDependencies as string[]) || [],
    reasoning: 'Existing component being refined',
    acceptanceCriteria: (component.acceptanceCriteria as string[]) || undefined,
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

  // Call the AI refinement generator (SAME AS AUTHENTICATED)
  const result = await refineComponentWithChat(refinementInput);

  logger.info('Bedrock token usage', {
    operation: 'guestRefineComponent',
    guestId: input.guestId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: (result.inputTokens || 0) + (result.outputTokens || 0),
  });

  logger.info('Component refined successfully', {
    originalName: component.name,
    newName: result.component.name,
    explanation: result.explanation,
  });

  // EXACT SAME RETURN AS AUTHENTICATED
  return {
    component: {
      name: result.component.name,
      description: result.component.description,
      type: result.component.type,
      estimatedHours: result.component.estimatedHours,
      priority: result.component.priority,
      suggestedDependencies: result.component.suggestedDependencies || [],
      parentName: null, // Required by GraphQL GeneratedComponentOutput
      acceptanceCriteria: result.component.acceptanceCriteria || [],
    },
    explanation: result.explanation,
    suggestedFollowUps: result.suggestedFollowUps || [],
  };
}
