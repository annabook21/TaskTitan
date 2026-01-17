'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { planSprint as aiPlanSprint, suggestSprintDetails } from '@/lib/ai';

// Schemas
const aiPlanSprintSchema = z.object({
  sprintId: z.string().cuid(),
  capacityHours: z.number().int().positive(),
});

const applySprintPlanSchema = z.object({
  sprintId: z.string().cuid(),
  componentIds: z.array(z.string().cuid()),
});

const suggestSprintSchema = z.object({
  teamId: z.string().cuid(),
});

/**
 * AI-powered sprint planning: suggests which components to add to a sprint
 */
export const aiPlanSprintAction = authActionClient.schema(aiPlanSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { sprintId, capacityHours } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'aiPlanSprint', _input: { sprintId, capacityHours } };
  }

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
      status: { not: 'COMPLETED' },
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

/**
 * Apply an AI-generated sprint plan by assigning components to the sprint
 */
export const applySprintPlan = authActionClient.schema(applySprintPlanSchema).action(async ({ parsedInput, ctx }) => {
  const { sprintId, componentIds } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'applySprintPlan', _input: { sprintId, componentIds } };
  }

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

/**
 * AI-powered sprint suggestion: suggests name, goal, and capacity based on backlog
 */
export const aiSuggestSprint = authActionClient.schema(suggestSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'aiSuggestSprint', _input: { teamId } };
  }

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
      status: { not: 'COMPLETED' },
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
