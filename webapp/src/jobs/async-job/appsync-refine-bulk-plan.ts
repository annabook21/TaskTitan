/**
 * AppSync Lambda Handler: refineBulkPlan
 *
 * Refines an entire project plan (components, sprints, epics) via conversational chat.
 * Uses the existing bulk-plan-refinement generator.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { refineBulkPlan } from '@/lib/ai/generators/bulk-plan-refinement';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { BulkPlanRefinementInput } from '@/lib/ai/generators/bulk-plan-refinement';

const logger = new Logger({ serviceName: 'AppSyncRefineBulkPlan' });

export interface RefineBulkPlanInput {
  projectId: string;
  currentPlan: {
    components: Array<{
      name: string;
      description: string;
      type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
      estimatedHours: number;
      priority: number;
      suggestedDependencies: string[];
      parentName?: string | null;
      acceptanceCriteria?: string[] | null;
    }>;
    sprints?: Array<{
      name: string;
      goal: string;
      durationWeeks: number;
      componentNames: string[];
      capacity?: number | null;
    }> | null;
    epics?: Array<{
      name: string;
      description: string;
      componentNames: string[];
    }> | null;
  };
  refinementRequest: string;
}

export interface RefineBulkPlanResult {
  components: Array<{
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
    parentName?: string | null;
    acceptanceCriteria?: string[] | null;
  }>;
  sprints?: Array<{
    name: string;
    goal: string;
    durationWeeks: number;
    componentNames: string[];
    capacity?: number | null;
  }> | null;
  epics?: Array<{
    name: string;
    description: string;
    componentNames: string[];
  }> | null;
  explanation: string;
  changedItems: Array<{
    type: string;
    name: string;
    change: string;
  }>;
  suggestedFollowUps: string[];
}

/**
 * Handler for refining an entire plan via chat
 */
export async function handleAppSyncRefineBulkPlan(
  input: RefineBulkPlanInput,
  identity?: { sub?: string },
): Promise<RefineBulkPlanResult> {
  logger.info('Refining bulk plan', {
    projectId: input.projectId,
    componentCount: input.currentPlan.components.length,
    sprintCount: input.currentPlan.sprints?.length || 0,
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
    }),
  );

  const project = projectResponse.Item;
  if (!project) {
    throw new Error('Project not found');
  }

  // Fetch team workflow config
  const workflowConfigResponse = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `TEAM#${project.teamId}`,
        sk: 'WORKFLOW_CONFIG',
      },
    }),
  );

  const workflowConfig = workflowConfigResponse.Item;
  const workflowType = workflowConfig?.cycleEnabled ? 'SCRUM' : 'KANBAN';
  const cycleName = (workflowConfig?.cycleName as string) || 'Sprint';

  // Prepare input for the bulk refinement generator
  const refinementInput: BulkPlanRefinementInput = {
    currentPlan: {
      components: input.currentPlan.components.map((c) => ({
        name: c.name,
        description: c.description,
        type: c.type,
        estimatedHours: c.estimatedHours,
        priority: c.priority,
        suggestedDependencies: c.suggestedDependencies,
        parentName: c.parentName || undefined,
      })),
      sprints: input.currentPlan.sprints?.map((s) => ({
        name: s.name,
        goal: s.goal,
        durationWeeks: s.durationWeeks,
        componentNames: s.componentNames,
        capacity: s.capacity || undefined,
      })),
      epics: input.currentPlan.epics?.map((e) => ({
        name: e.name,
        description: e.description,
        componentNames: e.componentNames,
      })),
    },
    refinementRequest: input.refinementRequest,
    projectContext: {
      projectName: project.name as string,
      projectDescription: (project.description as string) || '',
      workflowType: workflowType as 'SCRUM' | 'KANBAN' | 'CUSTOM',
      cycleName,
    },
  };

  // Call the AI refinement generator
  const result = await refineBulkPlan(refinementInput);

  logger.info('Bedrock token usage', {
    operation: 'refineBulkPlan',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: (result.inputTokens || 0) + (result.outputTokens || 0),
  });

  logger.info('Bulk plan refined successfully', {
    componentCount: result.components.length,
    sprintCount: result.sprints?.length || 0,
    changedCount: result.changedItems.length,
    explanation: result.explanation,
  });

  return {
    components: result.components.map((c) => ({
      name: c.name,
      description: c.description,
      type: c.type,
      estimatedHours: c.estimatedHours,
      priority: c.priority,
      suggestedDependencies: c.suggestedDependencies,
      parentName: c.parentName,
    })),
    sprints: result.sprints?.map((s) => ({
      name: s.name,
      goal: s.goal,
      durationWeeks: s.durationWeeks,
      componentNames: s.componentNames,
      capacity: s.capacity,
    })),
    epics: result.epics?.map((e) => ({
      name: e.name,
      description: e.description,
      componentNames: e.componentNames,
    })),
    explanation: result.explanation,
    changedItems: result.changedItems,
    suggestedFollowUps: result.suggestedFollowUps,
  };
}
