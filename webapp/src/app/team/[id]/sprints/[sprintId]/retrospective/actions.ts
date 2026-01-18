'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { generateRetrospective, isAIConfigured } from '@/lib/ai';

const generateRetrospectiveSchema = z.object({
  sprintId: z.string().min(1),
});

const applyRetrospectiveEstimatesSchema = z.object({
  adjustments: z.array(
    z.object({
      componentId: z.string(),
      adjustedEstimate: z.number().min(1).max(200),
    }),
  ),
});

/**
 * Generate AI retrospective analysis based on actual vs estimated time
 */
export const generateSprintRetrospective = authActionClient
  .schema(generateRetrospectiveSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { sprintId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode not supported for retrospective (requires real time tracking)
    if (isDemo) {
      throw new MyCustomError('Retrospective feature not available in demo mode');
    }

    // Check if AI is configured
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
            type: true,
            status: true,
            estimatedHours: true,
            actualHours: true,
            description: true,
          },
        },
        Team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!sprint) {
      throw new MyCustomError('Sprint not found or access denied');
    }

    // Get completed components with time tracking
    const completedComponents = sprint.Component.filter(
      (c) => c.status === 'COMPLETED' && c.estimatedHours && c.actualHours,
    ).map((c) => ({
      name: c.name,
      type: c.type,
      estimatedHours: c.estimatedHours!,
      actualHours: c.actualHours!,
      status: 'COMPLETED' as const,
    }));

    if (completedComponents.length === 0) {
      throw new MyCustomError('No completed components with time tracking found. Add actual hours to components first.');
    }

    // Get upcoming components from backlog (for estimate adjustment suggestions)
    const upcomingComponents = await prisma.component.findMany({
      where: {
        projectId: { in: sprint.Component.map((c) => c.projectId) },
        sprintId: null,
        status: 'PLANNING',
        estimatedHours: { not: null },
      },
      select: {
        id: true,
        name: true,
        type: true,
        estimatedHours: true,
        description: true,
      },
      take: 10,
      orderBy: { priority: 'desc' },
    });

    // Calculate team velocity
    const totalEstimated = completedComponents.reduce((sum, c) => sum + c.estimatedHours, 0);
    const totalActual = completedComponents.reduce((sum, c) => sum + c.actualHours, 0);

    const result = await generateRetrospective({
      sprintName: sprint.name,
      sprintGoal: sprint.goal || '',
      completedComponents,
      upcomingComponents: upcomingComponents.map((c) => ({
        name: c.name,
        type: c.type,
        estimatedHours: c.estimatedHours!,
        description: c.description || '',
      })),
      teamVelocity: {
        lastSprintCapacity: sprint.capacity || totalEstimated,
        actualDelivered: totalActual,
      },
    });

    // Map component names to IDs for the adjusted estimates
    const nameToId = new Map(upcomingComponents.map((c) => [c.name, c.id]));
    const adjustedWithIds = result.adjustedEstimates
      .map((adj) => ({
        ...adj,
        componentId: nameToId.get(adj.componentName),
      }))
      .filter((adj) => adj.componentId);

    return {
      ...result,
      adjustedEstimates: adjustedWithIds,
    };
  });

/**
 * Apply adjusted estimates from retrospective to components
 */
export const applyRetrospectiveEstimates = authActionClient
  .schema(applyRetrospectiveEstimatesSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { adjustments } = parsedInput;
    const { userId, isDemo } = ctx;

    if (isDemo) {
      throw new MyCustomError('Not available in demo mode');
    }

    // Update components with adjusted estimates
    await Promise.all(
      adjustments.map((adj) =>
        prisma.component.update({
          where: { id: adj.componentId },
          data: { estimatedHours: adj.adjustedEstimate },
        }),
      ),
    );

    return { updated: adjustments.length };
  });
