/**
 * AppSync generateFullPlan Handler
 *
 * Generates a full project plan with workflow awareness (Scrum vs Kanban).
 * Fetches project context, team workflow config, and team capacity from DynamoDB,
 * then calls the AI generator with full context.
 *
 * AWS Best Practices:
 * - Direct DynamoDB queries (no ORM overhead in Lambda)
 * - Reuses existing AI generator logic
 * - Returns structured result (not raw string)
 */

import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { generateComponents } from '@/lib/ai/generators/component-generator';
import { logger } from '@/lib/logger';
import type { AIGenerationResult, TeamCapacityInfo } from '@/lib/ai/types';
import type { TeamWorkflowConfig } from '@/lib/prisma-compat';

export interface GenerateFullPlanInput {
  projectId: string;
  generateEpics?: boolean;
}

export interface FullPlanResult {
  components: Array<{
    name: string;
    description: string;
    type: string;
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
    parentName?: string;
    acceptanceCriteria?: string[];
  }>;
  summary: string;
  enhancedDescription?: string;
  sprints?: Array<{
    name: string;
    goal: string;
    durationWeeks: number;
    componentNames: string[];
    capacity?: number;
  }>;
  epics?: Array<{
    name: string;
    description: string;
    componentNames: string[];
  }>;
}

/**
 * Handles AppSync generateFullPlan mutation.
 * Fetches all necessary context from DynamoDB and generates a workflow-aware plan.
 */
export async function handleAppSyncGenerateFullPlan(
  input: GenerateFullPlanInput,
  identity?: { sub?: string }
): Promise<FullPlanResult> {
  const { projectId, generateEpics = false } = input;
  const client = getDynamoDBClient();
  const tableName = getTableName();

  logger.info('Generating full plan', { projectId, generateEpics, userId: identity?.sub });

  // Step 1: Fetch project
  const projectResult = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        pk: `PROJECT#${projectId}`,
        sk: 'METADATA',
      },
    })
  );

  if (!projectResult.Item) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const project = projectResult.Item;
  const projectName = project.name as string;
  const projectDescription = (project.description as string) || '';
  const teamId = project.teamId as string;

  logger.info('Project fetched', { projectId, projectName, teamId });

  // Step 2: Fetch team workflow config
  let workflowConfig: TeamWorkflowConfig | null = null;
  try {
    const workflowResult = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          pk: `TEAM#${teamId}`,
          sk: 'WORKFLOW_CONFIG',
        },
      })
    );

    if (workflowResult.Item) {
      workflowConfig = {
        teamId,
        cycleEnabled: workflowResult.Item.cycleEnabled as boolean ?? true,
        cycleName: workflowResult.Item.cycleName as string ?? 'Sprint',
        cycleDurationWeeks: workflowResult.Item.cycleDurationWeeks as number ?? 2,
        workflowTemplate: workflowResult.Item.workflowTemplate as string ?? 'SCRUM',
        statusWorkflow: workflowResult.Item.statusWorkflow as string[] | undefined ?? undefined,
        wipLimitPlanning: workflowResult.Item.wipLimitPlanning as number | null ?? null,
        wipLimitInProgress: workflowResult.Item.wipLimitInProgress as number | null ?? null,
        wipLimitBlocked: workflowResult.Item.wipLimitBlocked as number | null ?? null,
        wipLimitReview: workflowResult.Item.wipLimitReview as number | null ?? null,
      };
    }
  } catch (err) {
    logger.warn('Failed to fetch workflow config, using defaults', { teamId, error: err });
  }

  logger.info('Workflow config', { teamId, workflowConfig });

  // Step 3: Fetch team members for capacity calculation
  let teamCapacity: TeamCapacityInfo | undefined;
  try {
    const membersResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `TEAM#${teamId}`,
          ':sk': 'MEMBER#',
        },
      })
    );

    const members = membersResult.Items || [];
    if (members.length > 0) {
      const sprintDays = (workflowConfig?.cycleDurationWeeks ?? 2) * 5;
      const memberDetails = members.map((m) => ({
        name: (m.userName as string) || 'Team Member',
        title: m.title as string | undefined,
        hoursPerDay: (m.hoursPerDay as number) || 6,
        availability: (m.availability as number) || 100,
      }));

      const totalCapacityHours = memberDetails.reduce((acc, m) => {
        return acc + (m.hoursPerDay * sprintDays * (m.availability / 100));
      }, 0);

      teamCapacity = {
        memberCount: members.length,
        members: memberDetails,
        sprintDays,
        totalCapacityHours,
      };
    }
  } catch (err) {
    logger.warn('Failed to fetch team members, proceeding without capacity info', { teamId, error: err });
  }

  logger.info('Team capacity', { teamId, teamCapacity });

  // Step 4: Fetch existing components to avoid duplicates
  const existingComponents: string[] = [];
  try {
    const componentsResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `PROJECT#${projectId}`,
        },
        ProjectionExpression: '#n',
        ExpressionAttributeNames: {
          '#n': 'name',
        },
        Limit: 500,
      })
    );

    for (const item of componentsResult.Items || []) {
      if (item.name) {
        existingComponents.push(item.name as string);
      }
    }
  } catch (err) {
    logger.warn('Failed to fetch existing components', { projectId, error: err });
  }

  logger.info('Existing components', { projectId, count: existingComponents.length });

  // Step 5: Call the AI generator with full context
  const aiResult: AIGenerationResult = await generateComponents(
    projectName,
    projectDescription,
    existingComponents,
    generateEpics,
    workflowConfig,
    teamCapacity
  );

  logger.info('Bedrock token usage', {
    operation: 'generateFullPlan',
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    totalTokens: (aiResult.inputTokens || 0) + (aiResult.outputTokens || 0),
  });

  logger.info('AI generation complete', {
    projectId,
    componentCount: aiResult.components?.length ?? 0,
    sprintCount: aiResult.sprints?.length ?? 0,
    epicCount: aiResult.epics?.length ?? 0,
  });

  // Step 6: Transform to output format
  const result: FullPlanResult = {
    components: (aiResult.components || []).map((c) => ({
      name: c.name,
      description: c.description,
      type: c.type,
      estimatedHours: c.estimatedHours,
      priority: c.priority,
      suggestedDependencies: c.suggestedDependencies || [],
      parentName: c.parentName,
      acceptanceCriteria: c.acceptanceCriteria,
    })),
    summary: aiResult.summary || 'Plan generated successfully.',
    enhancedDescription: aiResult.enhancedDescription,
    sprints: aiResult.sprints?.map((s) => ({
      name: s.name,
      goal: s.goal,
      durationWeeks: s.durationWeeks,
      componentNames: s.componentNames || [],
      capacity: s.capacity,
    })),
    epics: aiResult.epics?.map((e) => ({
      name: e.name,
      description: e.description,
      componentNames: e.componentNames || [],
    })),
  };

  return result;
}
