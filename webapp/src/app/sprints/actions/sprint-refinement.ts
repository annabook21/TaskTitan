'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { isAIConfigured } from '@/lib/ai';
import { refineBulkPlan } from '@/lib/ai/generators/bulk-plan-refinement';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifySprintAccess } from '@/lib/dynamodb/auth-helpers';

const refineSprintSchema = z.object({
  sprintId: z.string().min(1),
  refinementRequest: z.string().min(1).max(500),
  // Demo mode data - passed from client since server can't access localStorage
  demoSprintData: z
    .object({
      name: z.string(),
      goal: z.string(),
      durationWeeks: z.number(),
      capacity: z.number().optional(),
      components: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          type: z.enum(['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG']),
          estimatedHours: z.number(),
          priority: z.number(),
        }),
      ),
      projectName: z.string(),
      projectDescription: z.string(),
      workflowType: z.enum(['SCRUM', 'KANBAN', 'CUSTOM']),
      cycleName: z.string().optional(),
      teamId: z.string(),
    })
    .optional(),
});

/**
 * Refine an existing sprint using AI
 * Can adjust sprint goal, move components, change capacity, etc.
 * Uses real Bedrock AI for both demo and production modes
 */
export const refineExistingSprint = authActionClient.schema(refineSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { sprintId, refinementRequest, demoSprintData } = parsedInput;
  const { userId, isDemo } = ctx;

  // Check if AI is configured (required for both demo and production)
  if (!isAIConfigured()) {
    throw new MyCustomError('AI features require Amazon Bedrock access.');
  }

  let components: {
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
  }[];
  let currentSprint: {
    name: string;
    goal: string;
    durationWeeks: number;
    componentNames: string[];
    capacity?: number;
  };
  let projectName: string;
  let projectDescription: string;
  let workflowType: 'SCRUM' | 'KANBAN' | 'CUSTOM';
  let cycleName: string;
  let teamId: string;
  let componentIdMap: Map<string, string>;

  if (isDemo) {
    // Demo mode - use sprint data passed from client
    if (!demoSprintData) {
      throw new MyCustomError('Demo sprint data not provided');
    }

    components = demoSprintData.components.map((c) => ({
      name: c.name,
      description: c.description,
      type: c.type,
      estimatedHours: c.estimatedHours,
      priority: c.priority,
      suggestedDependencies: [],
    }));

    currentSprint = {
      name: demoSprintData.name,
      goal: demoSprintData.goal,
      durationWeeks: demoSprintData.durationWeeks,
      componentNames: components.map((c) => c.name),
      capacity: demoSprintData.capacity,
    };

    projectName = demoSprintData.projectName;
    projectDescription = demoSprintData.projectDescription;
    workflowType = demoSprintData.workflowType;
    cycleName = demoSprintData.cycleName || 'Sprint';
    teamId = demoSprintData.teamId;
    componentIdMap = new Map(demoSprintData.components.map((c) => [c.name, c.id]));
  } else {
    const entities = getEntities();

    // Production mode - get sprint from DynamoDB
    const access = await verifySprintAccess(userId, sprintId);
    if (!access) {
      throw new MyCustomError('Sprint not found or access denied');
    }

    // Get components currently assigned to sprint
    const projects = await entities.project.query.byTeam({ teamId: access.sprint.teamId }).go();
    const projectIds = projects.data.map((p) => p.id);
    const componentResults = await Promise.all(
      projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go())
    );
    const allComponents = componentResults.flatMap((r) => r.data);
    const sprintComponents = allComponents
      .filter((c) => c.sprintId === sprintId)
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: (c as any).description ?? null,
        type: (c as any).type,
        estimatedHours: (c as any).estimatedHours ?? null,
        priority: (c as any).priority ?? 0,
      }));

    const workflowConfig = await entities.teamWorkflowConfig.get({ teamId: access.sprint.teamId }).go();

    const sprint = {
      id: access.sprint.id,
      teamId: access.sprint.teamId,
      name: access.sprint.name,
      goal: (access.sprint as any).goal ?? null,
      startDate: (access.sprint as any).startDate,
      endDate: (access.sprint as any).endDate,
      capacity: (access.sprint as any).capacity ?? null,
      Component: sprintComponents,
      Team: {
        Project: projects.data.map((p) => ({ id: p.id, name: p.name, description: (p as any).description ?? null })),
        WorkflowConfig: workflowConfig.data ?? null,
      },
    };

    components = sprint.Component.map((c) => ({
      name: c.name,
      description: c.description || '',
      type: c.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
      estimatedHours: c.estimatedHours || 8,
      priority: Math.floor(c.priority / 10),
      suggestedDependencies: [],
    }));

    currentSprint = {
      name: sprint.name,
      goal: sprint.goal || '',
      durationWeeks: Math.floor(
        (new Date(sprint.endDate).getTime() - new Date(sprint.startDate).getTime()) / (1000 * 60 * 60 * 24 * 7),
      ),
      componentNames: components.map((c) => c.name),
      capacity: sprint.capacity || undefined,
    };

    const sprintWorkflowConfig = sprint.Team.WorkflowConfig;
    const projectContext = sprint.Team.Project[0] || { name: 'Unknown', description: '' };

    projectName = projectContext.name;
    projectDescription = projectContext.description || '';
    workflowType = (sprintWorkflowConfig?.workflowTemplate as 'SCRUM' | 'KANBAN' | 'CUSTOM') || 'SCRUM';
    cycleName = sprintWorkflowConfig?.cycleName || 'Sprint';
    teamId = sprint.teamId;
    componentIdMap = new Map(sprint.Component.map((c) => [c.name, c.id]));
  }

  // Call AI to refine (works for both demo and production)
  const result = await refineBulkPlan({
    currentPlan: {
      components,
      sprints: [currentSprint],
    },
    refinementRequest,
    projectContext: {
      projectName,
      projectDescription,
      workflowType,
      cycleName,
    },
  });

  // Demo mode - return result for client-side handling
  if (isDemo) {
    // Build component updates with IDs for client-side application
    const componentUpdates = result.components.map((c) => ({
      id: componentIdMap.get(c.name) || '',
      name: c.name,
      description: c.description,
      estimatedHours: c.estimatedHours,
      priority: Math.round(c.priority * 10),
    }));

    return {
      _demo: true,
      _action: 'refineExistingSprint',
      _input: { sprintId, teamId },
      sprint: result.sprints?.[0],
      componentUpdates,
      explanation: result.explanation,
      changedItems: result.changedItems,
      suggestedFollowUps: result.suggestedFollowUps,
    };
  }

  // Production mode - apply changes to database
  if (result.sprints && result.sprints[0]) {
    const updatedSprint = result.sprints[0];

    await dualWrite(
      'sprint',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const { sprint } = getEntities();
        const updated = await sprint
          .update({ id: sprintId })
          .set({ name: updatedSprint.name, goal: updatedSprint.goal, capacity: updatedSprint.capacity })
          .go({ response: 'all_new' });
        return updated.data;
      },
      { context: { action: 'refineExistingSprint', sprintId } }
    );
  }

  // Update components if changed
  const entities = getEntities();
  for (const updatedComp of result.components) {
    const componentId = componentIdMap.get(updatedComp.name);
    if (componentId) {
      await dualWrite(
        'component',
        'update',
        async () => null, // Prisma removed - DynamoDB only
        async () => {
          const updated = await entities.component
            .update({ id: componentId })
            .set({
              description: updatedComp.description || undefined,
              estimatedHours: updatedComp.estimatedHours,
              priority: Math.round(updatedComp.priority * 10),
            })
            .go({ response: 'all_new' });
          return updated.data;
        },
        { context: { action: 'refineExistingSprint', sprintId, componentId } }
      );
    }
  }

  revalidatePath(`/team/${teamId}/sprints/${sprintId}`);
  revalidatePath(`/team/${teamId}/sprints`);

  return {
    sprint: result.sprints?.[0],
    explanation: result.explanation,
    changedItems: result.changedItems,
    suggestedFollowUps: result.suggestedFollowUps,
  };
});
