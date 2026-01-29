'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { planSprint as aiPlanSprint, suggestSprintDetails } from '@/lib/ai';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
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
  const { userId } = ctx;

  const entities = getEntities();

  // Verify access to sprint via DynamoDB
  const sprintAccess = await verifySprintAccess(userId, sprintId);
  if (!sprintAccess) {
    throw new MyCustomError('Sprint not found or access denied');
  }

  const sprint = {
    id: sprintAccess.sprint.id,
    name: sprintAccess.sprint.name,
    goal: (sprintAccess.sprint as any).goal ?? null,
    teamId: sprintAccess.sprint.teamId,
  };

  // Get all components NOT in any active/planning sprint (the backlog)
  const projects = await entities.project.query.byTeam({ teamId: sprint.teamId }).go();
  const projectIds = projects.data.map((p) => p.id);
  
  if (projectIds.length === 0) {
    return {
      selectedComponentIds: [],
      totalHours: 0,
      reasoning: 'No components available in the backlog to add to this sprint.',
      warnings: ['All components are either completed, cancelled, or already in a sprint.'],
    };
  }

  const componentResults = await Promise.all(
    projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go())
  );
  const allComponents = componentResults.flatMap((r) => r.data);
  const backlogComponents = allComponents.filter((c) => !c.sprintId && c.status !== 'COMPLETED');

  if (backlogComponents.length === 0) {
    return {
      selectedComponentIds: [],
      totalHours: 0,
      reasoning: 'No components available in the backlog to add to this sprint.',
      warnings: ['All components are either completed, cancelled, or already in a sprint.'],
    };
  }

  // Fetch dependencies for each backlog component
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

  const availableComponents = await Promise.all(
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
  const { userId } = ctx;

  const entities = getEntities();

  // Verify access to sprint via DynamoDB
  const sprintAccess = await verifySprintAccess(userId, sprintId);
  if (!sprintAccess) {
    throw new MyCustomError('Sprint not found or access denied');
  }

  const teamId = sprintAccess.sprint.teamId;

  // Batch update all components
  await dualWrite(
    'component',
    'update',
    async () => null, // Prisma removed - DynamoDB only
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

  revalidatePath(`/team/${teamId}`);
  revalidatePath(`/team/${teamId}/sprints`);
  revalidatePath(`/team/${teamId}/sprints/${sprintId}`);

  return { success: true, assignedCount: componentIds.length };
});

/**
 * AI-powered sprint suggestion: suggests name, goal, and capacity based on backlog
 */
export const aiSuggestSprint = authActionClient.schema(suggestSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId } = parsedInput;
  const { userId } = ctx;

  const entities = getEntities();

  // Verify user is member of team via DynamoDB
  const teamAccess = await verifyTeamMembership(userId, teamId);
  if (!teamAccess) {
    throw new MyCustomError('Team not found or you are not a member');
  }

  // Fetch sprints for count
  const sprints = await entities.sprint.query.byTeam({ teamId }).go();

  // Fetch backlog components
  const projects = await entities.project.query.byTeam({ teamId }).go();
  const projectIds = projects.data.map((p) => p.id);

  let backlogComponents: Array<{
    name: string;
    description: string | null;
    priority: number;
    estimatedHours: number | null;
  }> = [];

  if (projectIds.length > 0) {
    const componentResults = await Promise.all(
      projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go())
    );
    const allComponents = componentResults.flatMap((r) => r.data);
    backlogComponents = allComponents
      .filter((c) => !c.sprintId && c.status !== 'COMPLETED')
      .sort((a, b) => ((b as any).priority ?? 0) - ((a as any).priority ?? 0))
      .map((c) => ({
        name: c.name,
        description: (c as any).description ?? null,
        priority: (c as any).priority ?? 0,
        estimatedHours: (c as any).estimatedHours ?? null,
      }));
  }

  if (backlogComponents.length === 0) {
    return {
      name: `Sprint ${sprints.data.length + 1}`,
      goal: 'No backlog items available - add components to your projects first.',
      recommendedCapacity: 40,
      reasoning: 'No backlog items to analyze',
    };
  }

  const sprintNumber = sprints.data.length + 1;
  const suggestion = await suggestSprintDetails(teamAccess.team.name, backlogComponents, sprintNumber);

  return suggestion;
});
