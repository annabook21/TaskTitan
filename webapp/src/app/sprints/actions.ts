'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { planSprint as aiPlanSprint, suggestSprintDetails } from '@/lib/ai';

const createSprintSchema = z.object({
  teamId: z.string().cuid(),
  name: z.string().min(1, 'Name is required').max(100),
  goal: z.string().max(500).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  capacity: z.number().int().positive().optional(),
});

const updateSprintSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  goal: z.string().max(500).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
});

const sprintStatusSchema = z.object({
  id: z.string().cuid(),
  status: z.enum(['PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
});

const assignToSprintSchema = z.object({
  componentId: z.string().cuid(),
  sprintId: z.string().cuid().nullable(),
});

export const createSprint = authActionClient.schema(createSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, name, goal, startDate, endDate, capacity } = parsedInput;
  const { userId } = ctx;

  // Verify user is member of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership) {
    throw new Error('You must be a team member to create sprints');
  }

  // Check for overlapping active sprints
  const overlapping = await prisma.sprint.findFirst({
    where: {
      teamId,
      status: { in: ['PLANNING', 'ACTIVE'] },
      OR: [
        {
          startDate: { lte: new Date(endDate) },
          endDate: { gte: new Date(startDate) },
        },
      ],
    },
  });

  if (overlapping) {
    throw new Error(`Sprint "${overlapping.name}" overlaps with these dates`);
  }

  const sprint = await prisma.sprint.create({
    data: {
      teamId,
      name,
      goal,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      capacity,
    },
  });

  revalidatePath(`/team/${teamId}`);
  revalidatePath(`/team/${teamId}/sprints`);

  return { sprint };
});

export const updateSprint = authActionClient.schema(updateSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { id, ...updates } = parsedInput;
  const { userId } = ctx;

  const sprint = await prisma.sprint.findUnique({
    where: { id },
    include: { Team: true },
  });

  if (!sprint) {
    throw new Error('Sprint not found');
  }

  // Verify user is member of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId: sprint.teamId } },
  });

  if (!membership) {
    throw new Error('You must be a team member to update sprints');
  }

  const updated = await prisma.sprint.update({
    where: { id },
    data: {
      ...(updates.name && { name: updates.name }),
      ...(updates.goal !== undefined && { goal: updates.goal }),
      ...(updates.startDate && { startDate: new Date(updates.startDate) }),
      ...(updates.endDate && { endDate: new Date(updates.endDate) }),
      ...(updates.capacity !== undefined && { capacity: updates.capacity }),
    },
  });

  revalidatePath(`/team/${sprint.teamId}`);
  revalidatePath(`/team/${sprint.teamId}/sprints`);

  return { sprint: updated };
});

export const updateSprintStatus = authActionClient.schema(sprintStatusSchema).action(async ({ parsedInput, ctx }) => {
  const { id, status } = parsedInput;
  const { userId } = ctx;

  const sprint = await prisma.sprint.findUnique({
    where: { id },
  });

  if (!sprint) {
    throw new Error('Sprint not found');
  }

  // Verify user is admin/owner of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId: sprint.teamId } },
  });

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    throw new Error('Only team owners and admins can change sprint status');
  }

  // If starting a sprint, check no other active sprint exists
  if (status === 'ACTIVE') {
    const activeSprint = await prisma.sprint.findFirst({
      where: {
        teamId: sprint.teamId,
        status: 'ACTIVE',
        id: { not: id },
      },
    });

    if (activeSprint) {
      throw new Error(`Sprint "${activeSprint.name}" is already active. Complete it first.`);
    }
  }

  const updated = await prisma.sprint.update({
    where: { id },
    data: { status },
  });

  revalidatePath(`/team/${sprint.teamId}`);
  revalidatePath(`/team/${sprint.teamId}/sprints`);

  return { sprint: updated };
});

export const assignComponentToSprint = authActionClient
  .schema(assignToSprintSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, sprintId } = parsedInput;
    const { userId } = ctx;

    const component = await prisma.component.findUnique({
      where: { id: componentId },
      include: { Project: true },
    });

    if (!component) {
      throw new Error('Component not found');
    }

    // Verify user is member of team
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId: component.Project.teamId } },
    });

    if (!membership) {
      throw new Error('You must be a team member to assign components to sprints');
    }

    // If assigning to a sprint, verify it belongs to the same team
    if (sprintId) {
      const sprint = await prisma.sprint.findUnique({
        where: { id: sprintId },
      });

      if (!sprint) {
        throw new Error('Sprint not found');
      }

      if (sprint.teamId !== component.Project.teamId) {
        throw new Error('Sprint and component must belong to the same team');
      }
    }

    const updated = await prisma.component.update({
      where: { id: componentId },
      data: { sprintId },
    });

    revalidatePath(`/projects/${component.projectId}`);
    if (sprintId) {
      revalidatePath(`/sprints/${sprintId}`);
    }

    return { component: updated };
  });

export const deleteSprint = authActionClient
  .schema(z.object({ id: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId } = ctx;

    const sprint = await prisma.sprint.findUnique({
      where: { id },
    });

    if (!sprint) {
      throw new Error('Sprint not found');
    }

    // Verify user is owner of team
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId: sprint.teamId } },
    });

    if (!membership || membership.role !== 'OWNER') {
      throw new Error('Only the team owner can delete sprints');
    }

    // Components will have sprintId set to null via onDelete: SetNull
    await prisma.sprint.delete({ where: { id } });

    revalidatePath(`/team/${sprint.teamId}`);
    revalidatePath(`/team/${sprint.teamId}/sprints`);

    return { success: true };
  });

// Get sprint metrics for burndown/velocity
export const getSprintMetrics = authActionClient
  .schema(z.object({ id: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId } = ctx;

    const sprint = await prisma.sprint.findUnique({
      where: { id },
      include: {
        Component: {
          include: {
            Assignment: true,
          },
        },
        Team: true,
      },
    });

    if (!sprint) {
      throw new Error('Sprint not found');
    }

    // Verify user is member of team
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId: sprint.teamId } },
    });

    if (!membership) {
      throw new Error('You must be a team member to view sprint metrics');
    }

    const totalComponents = sprint.Component.length;
    const completedComponents = sprint.Component.filter((c) => c.status === 'COMPLETED').length;
    const blockedComponents = sprint.Component.filter((c) => c.status === 'BLOCKED').length;
    const inProgressComponents = sprint.Component.filter((c) => c.status === 'IN_PROGRESS').length;

    const totalEstimatedHours = sprint.Component.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
    const completedHours = sprint.Component.filter((c) => c.status === 'COMPLETED').reduce(
      (sum, c) => sum + (c.estimatedHours || 0),
      0,
    );

    const daysTotal = Math.ceil((sprint.endDate.getTime() - sprint.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysElapsed = Math.ceil((Date.now() - sprint.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, daysTotal - daysElapsed);

    return {
      sprint: {
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      },
      metrics: {
        totalComponents,
        completedComponents,
        blockedComponents,
        inProgressComponents,
        completionRate: totalComponents > 0 ? Math.round((completedComponents / totalComponents) * 100) : 0,
        totalEstimatedHours,
        completedHours,
        hoursRemaining: totalEstimatedHours - completedHours,
        daysTotal,
        daysElapsed,
        daysRemaining,
        capacityUsed: sprint.capacity ? Math.round((totalEstimatedHours / sprint.capacity) * 100) : null,
      },
    };
  });

const aiPlanSprintSchema = z.object({
  sprintId: z.string().cuid(),
  capacityHours: z.number().int().positive(),
});

/**
 * AI-powered sprint planning: suggests which components to add to a sprint
 */
export const aiPlanSprintAction = authActionClient.schema(aiPlanSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { sprintId, capacityHours } = parsedInput;
  const { userId } = ctx;

  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    include: { Team: true },
  });

  if (!sprint) {
    throw new Error('Sprint not found');
  }

  // Verify user is member of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId: sprint.teamId } },
  });

  if (!membership) {
    throw new Error('You must be a team member to plan sprints');
  }

  // Get all components NOT in any active/planning sprint (the backlog)
  const availableComponents = await prisma.component.findMany({
    where: {
      Project: { teamId: sprint.teamId },
      sprintId: null,
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
    include: {
      Dependency_Dependency_dependentComponentIdToComponent: {
        include: { Component_Dependency_requiredComponentIdToComponent: true },
      },
    },
  });

  if (availableComponents.length === 0) {
    return {
      selectedComponentIds: [],
      totalHours: 0,
      reasoning: 'No components available in the backlog to add to this sprint.',
      warnings: ['All components are either completed, cancelled, or already in a sprint.'],
    };
  }

  // Map to AI planning format
  const componentsForAI = availableComponents.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    estimatedHours: c.estimatedHours,
    priority: c.priority,
    dependsOn: c.Dependency_Dependency_dependentComponentIdToComponent.map(
      (d) => d.Component_Dependency_requiredComponentIdToComponent.name,
    ),
  }));

  // Call AI to plan the sprint
  const plan = await aiPlanSprint(sprint.name, sprint.goal || undefined, capacityHours, componentsForAI);

  return plan;
});

const applySprintPlanSchema = z.object({
  sprintId: z.string().cuid(),
  componentIds: z.array(z.string().cuid()),
});

/**
 * Apply an AI-generated sprint plan by assigning components to the sprint
 */
export const applySprintPlan = authActionClient.schema(applySprintPlanSchema).action(async ({ parsedInput, ctx }) => {
  const { sprintId, componentIds } = parsedInput;
  const { userId } = ctx;

  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
  });

  if (!sprint) {
    throw new Error('Sprint not found');
  }

  // Verify user is member of team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId: sprint.teamId } },
  });

  if (!membership) {
    throw new Error('You must be a team member to assign components to sprints');
  }

  // Batch update all components
  await prisma.component.updateMany({
    where: {
      id: { in: componentIds },
      Project: { teamId: sprint.teamId },
    },
    data: { sprintId },
  });

  revalidatePath(`/team/${sprint.teamId}`);
  revalidatePath(`/team/${sprint.teamId}/sprints`);
  revalidatePath(`/team/${sprint.teamId}/sprints/${sprintId}`);

  return { success: true, assignedCount: componentIds.length };
});

const suggestSprintSchema = z.object({
  teamId: z.string().cuid(),
});

/**
 * AI-powered sprint suggestion: suggests name, goal, and capacity based on backlog
 */
export const aiSuggestSprint = authActionClient.schema(suggestSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId } = parsedInput;
  const { userId } = ctx;

  // Verify user is member of team
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      Membership: { where: { userId } },
      Sprint: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!team || team.Membership.length === 0) {
    throw new Error('Team not found or you are not a member');
  }

  // Get backlog components (not in any sprint, not completed)
  const backlogComponents = await prisma.component.findMany({
    where: {
      Project: { teamId },
      sprintId: null,
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    },
    orderBy: { priority: 'desc' },
    select: {
      name: true,
      description: true,
      priority: true,
      estimatedHours: true,
    },
  });

  if (backlogComponents.length === 0) {
    return {
      name: `Sprint ${team.Sprint.length + 1}`,
      goal: 'No backlog items available - add components to your projects first.',
      recommendedCapacity: 40,
      reasoning: 'No backlog items to analyze',
    };
  }

  const sprintNumber = team.Sprint.length + 1;
  const suggestion = await suggestSprintDetails(team.name, backlogComponents, sprintNumber);

  return suggestion;
});
