'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { isAIConfigured } from '@/lib/ai';
import { refineBulkPlan } from '@/lib/ai/generators/bulk-plan-refinement';

const refineSprintSchema = z.object({
  sprintId: z.string().min(1),
  refinementRequest: z.string().min(1).max(500),
});

/**
 * Refine an existing sprint using AI
 * Can adjust sprint goal, move components, change capacity, etc.
 */
export const refineExistingSprint = authActionClient
  .schema(refineSprintSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { sprintId, refinementRequest } = parsedInput;
    const { userId, isDemo } = ctx;

    if (isDemo) {
      throw new MyCustomError('Feature not available in demo mode');
    }

    if (!isAIConfigured()) {
      throw new MyCustomError('AI features require Amazon Bedrock access.');
    }

    // Get sprint with components
    const sprint = await prisma.sprint.findFirst({
      where: {
        id: sprintId,
        Team: { Membership: { some: { userId } } },
      },
      include: {
        Component: {
          select: {
            id: true,
            name: true,
            description: true,
            type: true,
            estimatedHours: true,
            priority: true,
          },
        },
        Team: {
          include: {
            Project: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
            WorkflowConfig: true,
          },
        },
      },
    });

    if (!sprint) {
      throw new MyCustomError('Sprint not found or access denied');
    }

    // Build current plan
    const components = sprint.Component.map((c) => ({
      name: c.name,
      description: c.description || '',
      type: c.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
      estimatedHours: c.estimatedHours || 8,
      priority: Math.floor(c.priority / 10),
      suggestedDependencies: [],
    }));

    const currentSprint = {
      name: sprint.name,
      goal: sprint.goal || '',
      durationWeeks: Math.floor((new Date(sprint.endDate).getTime() - new Date(sprint.startDate).getTime()) / (1000 * 60 * 60 * 24 * 7)),
      componentNames: components.map((c) => c.name),
      capacity: sprint.capacity || undefined,
    };

    const workflowConfig = sprint.Team.WorkflowConfig;
    const projectContext = sprint.Team.Project[0] || { name: 'Unknown', description: '' };

    // Call AI to refine
    const result = await refineBulkPlan({
      currentPlan: {
        components,
        sprints: [currentSprint],
      },
      refinementRequest,
      projectContext: {
        projectName: projectContext.name,
        projectDescription: projectContext.description || '',
        workflowType: workflowConfig?.workflowTemplate as 'SCRUM' | 'KANBAN' | 'CUSTOM' || 'SCRUM',
        cycleName: workflowConfig?.cycleName || 'Sprint',
      },
    });

    // Apply changes
    if (result.sprints && result.sprints[0]) {
      const updatedSprint = result.sprints[0];
      
      await prisma.sprint.update({
        where: { id: sprintId },
        data: {
          name: updatedSprint.name,
          goal: updatedSprint.goal,
          capacity: updatedSprint.capacity,
        },
      });
    }

    // Update components if changed
    const nameToId = new Map(sprint.Component.map((c) => [c.name, c.id]));
    for (const updatedComp of result.components) {
      const componentId = nameToId.get(updatedComp.name);
      if (componentId) {
        await prisma.component.update({
          where: { id: componentId },
          data: {
            description: updatedComp.description,
            estimatedHours: updatedComp.estimatedHours,
            priority: Math.round(updatedComp.priority * 10),
          },
        });
      }
    }

    revalidatePath(`/team/${sprint.teamId}/sprints/${sprintId}`);
    revalidatePath(`/team/${sprint.teamId}/sprints`);

    return {
      sprint: result.sprints?.[0],
      explanation: result.explanation,
      changedItems: result.changedItems,
      suggestedFollowUps: result.suggestedFollowUps,
    };
  });
