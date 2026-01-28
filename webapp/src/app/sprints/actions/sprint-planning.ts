'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { planSprint as aiPlanSprint, suggestSprintDetails } from '@/lib/ai';

// DynamoDB migration imports
import { dualRead, dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifySprintAccess, verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

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

  const entities = getEntities();

  const sprint = await dualRead(
    'sprint',
    async () => {
      return prisma.sprint.findUnique({
        where: { id: sprintId },
        include: { Team: true },
      });
    },
    async () => {
      const access = await verifySprintAccess(userId, sprintId);
      if (!access) return null;
      return {
        id: access.sprint.id,
        name: access.sprint.name,
        goal: (access.sprint as any).goal ?? null,
        teamId: access.sprint.teamId,
        Team: { id: access.sprint.teamId, name: access.team.name },
      } as unknown;
    },
    { context: { action: 'aiPlanSprint', sprintId } }
  );

  if (!sprint) {
    throw new Error('Sprint not found');
  }

  // verifySprintAccess already verified membership for dynamo phases; keep Prisma check for prisma phases
  await dualRead(
    'membership',
    async () => {
      const membership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId, teamId: (sprint as any).teamId } },
      });
      if (!membership) throw new Error('You must be a team member to plan sprints');
      return true;
    },
    async () => {
      const access = await verifyTeamMembership(userId, (sprint as any).teamId);
      if (!access) throw new Error('You must be a team member to plan sprints');
      return true;
    },
    { context: { action: 'aiPlanSprint', sprintId } }
  );

  // Get all components NOT in any active/planning sprint (the backlog)
  const availableComponents = await dualRead(
    'component',
    async () => {
      return prisma.component.findMany({
        where: {
          Project: { teamId: (sprint as any).teamId },
          sprintId: null,
          status: { not: 'COMPLETED' },
        },
        include: {
          Dependency_Dependency_dependentComponentIdToComponent: {
            include: { Component_Dependency_requiredComponentIdToComponent: true },
          },
        },
      });
    },
    async () => {
      // DynamoDB: get projects for team, then components for each project, then dependencies for each component
      const projects = await entities.project.query.byTeam({ teamId: (sprint as any).teamId }).go();
      const projectIds = projects.data.map((p) => p.id);
      if (projectIds.length === 0) return [];

      const componentResults = await Promise.all(
        projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go())
      );
      const allComponents = componentResults.flatMap((r) => r.data);

      const backlogComponents = allComponents.filter((c) => !c.sprintId && c.status !== 'COMPLETED');

      const depsByComponent = await Promise.all(
        backlogComponents.map((c) => entities.dependency.query.primary({ dependentComponentId: c.id }).go())
      );

      const requiredNameCache = new Map<string, string>();

      const getComponentName = async (id: string) => {
        if (requiredNameCache.has(id)) return requiredNameCache.get(id)!;
        const comp = await entities.component.get({ id }).go();
        const name = comp.data?.name ?? id;
        requiredNameCache.set(id, name);
        return name;
      };

      const hydrated = await Promise.all(
        backlogComponents.map(async (c, idx) => {
          const deps = depsByComponent[idx].data;
          const dependsOn = await Promise.all(deps.map((d) => getComponentName(d.requiredComponentId)));
          return {
            id: c.id,
            name: c.name,
            description: (c as any).description ?? null,
            status: c.status,
            estimatedHours: (c as any).estimatedHours ?? null,
            priority: (c as any).priority ?? 0,
            Dependency_Dependency_dependentComponentIdToComponent: dependsOn.map((name) => ({
              Component_Dependency_requiredComponentIdToComponent: { name },
            })),
          };
        })
      );

      return hydrated as unknown;
    },
    { context: { action: 'aiPlanSprint', sprintId, teamId: (sprint as any).teamId } }
  );

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

  const entities = getEntities();
  const sprint = await dualRead(
    'sprint',
    async () => prisma.sprint.findUnique({ where: { id: sprintId } }),
    async () => {
      const access = await verifySprintAccess(userId, sprintId);
      if (!access) return null;
      return { id: access.sprint.id, teamId: access.sprint.teamId } as unknown;
    },
    { context: { action: 'applySprintPlan', sprintId } }
  );

  if (!sprint) {
    throw new Error('Sprint not found');
  }

  await dualRead(
    'membership',
    async () => {
      const membership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId, teamId: (sprint as any).teamId } },
      });
      if (!membership) throw new Error('You must be a team member to assign components to sprints');
      return true;
    },
    async () => {
      const access = await verifyTeamMembership(userId, (sprint as any).teamId);
      if (!access) throw new Error('You must be a team member to assign components to sprints');
      return true;
    },
    { context: { action: 'applySprintPlan', sprintId } }
  );

  // Batch update all components (dual-write, best-effort in Dynamo)
  await dualWrite(
    'component',
    'update',
    async () => {
      await prisma.component.updateMany({
        where: {
          id: { in: componentIds },
          Project: { teamId: (sprint as any).teamId },
        },
        data: { sprintId },
      });
      return { success: true };
    },
    async () => {
      await Promise.all(
        componentIds.map((id) =>
          entities.component.update({ id }).set({ sprintId }).go()
        )
      );
      return { success: true };
    },
    { context: { action: 'applySprintPlan', sprintId, componentCount: componentIds.length } }
  );

  revalidatePath(`/team/${(sprint as any).teamId}`);
  revalidatePath(`/team/${(sprint as any).teamId}/sprints`);
  revalidatePath(`/team/${(sprint as any).teamId}/sprints/${sprintId}`);

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

  const entities = getEntities();

  // Verify user is member of team + fetch sprint count (dualRead)
  const team = await dualRead(
    'team',
    async () => {
      return prisma.team.findUnique({
        where: { id: teamId },
        include: {
          Membership: { where: { userId } },
          Sprint: { orderBy: { createdAt: 'desc' } },
        },
      });
    },
    async () => {
      const access = await verifyTeamMembership(userId, teamId);
      if (!access) return null;

      const sprints = await entities.sprint.query.byTeam({ teamId }).go();
      return {
        id: teamId,
        name: access.team.name,
        Membership: [{ userId }],
        Sprint: sprints.data.map((s) => ({ id: s.id })),
      } as unknown;
    },
    { context: { action: 'aiSuggestSprint', teamId } }
  );

  if (!team || team.Membership.length === 0) {
    throw new Error('Team not found or you are not a member');
  }

  const backlogComponents = await dualRead(
    'component',
    async () => {
      return prisma.component.findMany({
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
    },
    async () => {
      const projects = await entities.project.query.byTeam({ teamId }).go();
      const projectIds = projects.data.map((p) => p.id);
      if (projectIds.length === 0) return [];

      const componentResults = await Promise.all(
        projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go())
      );
      const allComponents = componentResults.flatMap((r) => r.data);
      const backlog = allComponents
        .filter((c) => !c.sprintId && c.status !== 'COMPLETED')
        .sort((a, b) => ((b as any).priority ?? 0) - ((a as any).priority ?? 0))
        .map((c) => ({
          name: c.name,
          description: (c as any).description ?? null,
          priority: (c as any).priority ?? 0,
          estimatedHours: (c as any).estimatedHours ?? null,
        }));
      return backlog as unknown;
    },
    { context: { action: 'aiSuggestSprint', teamId } }
  );

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
