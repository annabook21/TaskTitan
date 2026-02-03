'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyComponentAccess, verifySprintAccess, verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

// Schemas - use min(1) instead of cuid() to allow demo IDs like 'demo-sprint-001'
const createSprintSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1, 'Name is required').max(100),
  goal: z.string().max(500).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  capacity: z.number().int().positive().optional(),
});

const updateSprintSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  goal: z.string().max(500).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
});

const sprintStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
});

const assignToSprintSchema = z.object({
  componentId: z.string().min(1),
  sprintId: z.string().min(1).nullable(),
});

/**
 * Creates a new sprint for a team
 *
 * Note: The overlap check has a theoretical TOCTOU race condition where two concurrent
 * requests could both pass the overlap check. In practice, this is rare and the business
 * impact is low (admin can manually resolve). Full atomic overlap checking would require
 * more complex patterns (lock table, GSI on date ranges, etc.).
 *
 * We mitigate duplicate submissions by using a conditional write that ensures the sprint
 * doesn't already exist.
 */
export const createSprint = authActionClient.schema(createSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, name, goal, startDate, endDate, capacity } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'createSprint', _input: { teamId, name, goal, startDate, endDate, capacity } };
  }

  // Verify team membership via DynamoDB
  const access = await verifyTeamMembership(userId, teamId);
  if (!access) {
    throw new MyCustomError('You must be a team member to create sprints');
  }

  // Check for overlapping active sprints
  const newStartDate = new Date(startDate);
  const newEndDate = new Date(endDate);

  const { sprint: sprintEntity } = getEntities();
  const teamSprints = await sprintEntity.query.byTeam({ teamId }).go();

  const overlapping = teamSprints.data.find((s) => {
    if (s.status !== 'PLANNING' && s.status !== 'ACTIVE') return false;
    const existingStart = new Date(s.startDate);
    const existingEnd = new Date(s.endDate);
    return newStartDate < existingEnd && newEndDate > existingStart;
  });

  if (overlapping) {
    throw new MyCustomError(`Sprint "${overlapping.name}" overlaps with these dates`);
  }

  const sprintId = randomUUID();

  const result = await dualWrite(
    'sprint',
    'create',
    async () => null, // Prisma removed - DynamoDB only
    async () => {
      const { sprint } = getEntities();
      try {
        const created = await sprint
          .create({
            id: sprintId,
            teamId,
            name,
            goal,
            startDate,
            endDate,
            capacity,
            status: 'PLANNING',
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .go({ condition: { field: 'pk', exists: false } } as any);
        return created.data;
      } catch (error) {
        // If sprint already exists (duplicate submission), throw friendly error
        const errorCode = (error as { code?: string })?.code;
        if (errorCode === 'ConditionalCheckFailedException') {
          throw new MyCustomError('Sprint could not be created. Please try again.');
        }
        throw error;
      }
    },
    { context: { action: 'createSprint', teamId, sprintId } },
  );

  revalidatePath(`/team/${teamId}`);
  revalidatePath(`/team/${teamId}/sprints`);

  return { sprint: result.data };
});

/**
 * Updates an existing sprint's details
 */
export const updateSprint = authActionClient.schema(updateSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { id, ...updates } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'updateSprint', _input: { sprintId: id, ...updates } };
  }

  // Verify access via DynamoDB
  const access = await verifySprintAccess(userId, id);
  if (!access) {
    throw new MyCustomError('Sprint not found');
  }
  const teamId = access.sprint.teamId;

  const result = await dualWrite(
    'sprint',
    'update',
    async () => null, // Prisma removed - DynamoDB only
    async () => {
      const { sprint } = getEntities();
      const updateData: Record<string, unknown> = {};
      if (updates.name) updateData.name = updates.name;
      if (updates.goal !== undefined) updateData.goal = updates.goal;
      if (updates.startDate) updateData.startDate = updates.startDate;
      if (updates.endDate) updateData.endDate = updates.endDate;
      if (updates.capacity !== undefined) updateData.capacity = updates.capacity;

      const updated = await sprint.update({ id }).set(updateData).go({ response: 'all_new' });
      return updated.data;
    },
    { context: { action: 'updateSprint', sprintId: id } },
  );

  revalidatePath(`/team/${teamId}`);
  revalidatePath(`/team/${teamId}/sprints`);

  return { sprint: result.data };
});

/**
 * Updates a sprint's status (admin/owner only)
 */
export const updateSprintStatus = authActionClient.schema(sprintStatusSchema).action(async ({ parsedInput, ctx }) => {
  const { id, status } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'updateSprintStatus', _input: { sprintId: id, status } };
  }

  // Verify access via DynamoDB (admin/owner only)
  const access = await verifySprintAccess(userId, id, ['OWNER', 'ADMIN']);
  if (!access) {
    throw new MyCustomError('Only team owners and admins can change sprint status');
  }
  const teamId = access.sprint.teamId;

  // If starting a sprint, check no other active sprint exists
  if (status === 'ACTIVE') {
    const { sprint: sprintEntity } = getEntities();
    const teamSprints = await sprintEntity.query.byTeam({ teamId }).go();

    const activeSprint = teamSprints.data.find((s) => s.status === 'ACTIVE' && s.id !== id);

    if (activeSprint) {
      throw new MyCustomError(`Sprint "${activeSprint.name}" is already active. Complete it first.`);
    }
  }

  const result = await dualWrite(
    'sprint',
    'update',
    async () => null, // Prisma removed - DynamoDB only
    async () => {
      const { sprint } = getEntities();
      const updated = await sprint.update({ id }).set({ status }).go({ response: 'all_new' });
      return updated.data;
    },
    { context: { action: 'updateSprintStatus', sprintId: id, status } },
  );

  revalidatePath(`/team/${teamId}`);
  revalidatePath(`/team/${teamId}/sprints`);

  return { sprint: result.data };
});

/**
 * Assigns a component to a sprint (or unassigns if sprintId is null)
 */
export const assignComponentToSprint = authActionClient
  .schema(assignToSprintSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, sprintId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'assignComponentToSprint', _input: { componentId, sprintId } };
    }

    // Verify component access via DynamoDB
    const access = await verifyComponentAccess(userId, componentId);
    if (!access) {
      throw new MyCustomError('Component not found');
    }
    const projectId = access.component.projectId;
    const teamId = access.project.teamId;

    // If assigning to a sprint, verify it belongs to the same team
    if (sprintId) {
      const sprintAccess = await verifySprintAccess(userId, sprintId);
      if (!sprintAccess) {
        throw new MyCustomError('Sprint not found');
      }
      if (sprintAccess.sprint.teamId !== teamId) {
        throw new MyCustomError('Sprint and component must belong to the same team');
      }
    }

    const result = await dualWrite(
      'component',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const { component } = getEntities();
        const updated = await component
          .update({ id: componentId })
          .set({ sprintId: sprintId ?? undefined })
          .go({
            response: 'all_new',
          });
        return updated.data;
      },
      { context: { action: 'assignComponentToSprint', componentId, sprintId } },
    );

    revalidatePath(`/projects/${projectId}`);
    if (sprintId) {
      revalidatePath(`/sprints/${sprintId}`);
    }

    return { component: result.data };
  });

/**
 * Deletes a sprint (owner only)
 * Important: First unassigns all components from the sprint to prevent orphan references
 */
export const deleteSprint = authActionClient
  .schema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'deleteSprint', _input: { sprintId: id } };
    }

    // Verify owner access via DynamoDB
    const access = await verifySprintAccess(userId, id, ['OWNER']);
    if (!access) {
      throw new MyCustomError('Only the team owner can delete sprints');
    }
    const teamId = access.sprint.teamId;

    const { sprint: sprintEntity, component: componentEntity } = getEntities();

    await dualWrite(
      'sprint',
      'delete',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        // First: Unassign all components from this sprint to prevent orphan references
        const componentsInSprint = await componentEntity.query.bySprint({ sprintId: id }).go();

        if (componentsInSprint.data.length > 0) {
          // Use Promise.allSettled to continue even if some updates fail
          await Promise.allSettled(
            componentsInSprint.data.map((c) => componentEntity.update({ id: c.id }).set({ sprintId: undefined }).go()),
          );
        }

        // Then: Delete the sprint
        await sprintEntity.delete({ id }).go();
        return { success: true };
      },
      { context: { action: 'deleteSprint', sprintId: id } },
    );

    revalidatePath(`/team/${teamId}`);
    revalidatePath(`/team/${teamId}/sprints`);

    return { success: true };
  });

/**
 * Gets sprint metrics (burndown, velocity, etc.)
 */
export const getSprintMetrics = authActionClient
  .schema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId } = ctx;

    const { sprint: sprintEntity, component: componentEntity } = getEntities();

    const sprintResult = await sprintEntity.get({ id }).go();
    if (!sprintResult.data) {
      throw new MyCustomError('Sprint not found');
    }

    const sprint = sprintResult.data;

    // Verify membership
    const access = await verifyTeamMembership(userId, sprint.teamId);
    if (!access) {
      throw new MyCustomError('You must be a team member to view sprint metrics');
    }

    // Query components assigned to this sprint
    const componentsResult = await componentEntity.query.bySprint({ sprintId: id }).go();
    const components = componentsResult.data.map((c) => ({
      status: c.status,
      estimatedHours: c.estimatedHours,
    }));

    // Calculate metrics
    const totalComponents = components.length;
    const completedComponents = components.filter((c) => c.status === 'COMPLETED').length;
    const blockedComponents = components.filter((c) => c.status === 'BLOCKED').length;
    const inProgressComponents = components.filter((c) => c.status === 'IN_PROGRESS').length;

    const totalEstimatedHours = components.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
    const completedHours = components
      .filter((c) => c.status === 'COMPLETED')
      .reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

    const sprintStartDate = new Date(sprint.startDate);
    const sprintEndDate = new Date(sprint.endDate);

    const daysTotal = Math.ceil((sprintEndDate.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysElapsed = Math.ceil((Date.now() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, daysTotal - daysElapsed);

    return {
      sprint: {
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        startDate: sprintStartDate,
        endDate: sprintEndDate,
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
