'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB migration imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';
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
 */
export const createSprint = authActionClient.schema(createSprintSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, name, goal, startDate, endDate, capacity } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'createSprint', _input: { teamId, name, goal, startDate, endDate, capacity } };
  }

  const phase = getMigrationPhase('sprint');
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) {
      throw new Error('You must be a team member to create sprints');
    }
  } else {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (!membership) {
      throw new Error('You must be a team member to create sprints');
    }
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

  const sprintId = randomUUID();

  const result = await dualWrite(
    'sprint',
    'create',
    async () => {
      return prisma.sprint.create({
        data: {
          id: sprintId,
          teamId,
          name,
          goal,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          capacity,
        },
      });
    },
    async () => {
      const { sprint } = getEntities();
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
        .go();
      return created.data;
    },
    { context: { action: 'createSprint', teamId, sprintId } }
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

  const phase = getMigrationPhase('sprint');

  let teamId: string;
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifySprintAccess(userId, id);
    if (!access) {
      throw new Error('Sprint not found');
    }
    teamId = access.sprint.teamId;
  } else {
    const sprint = await prisma.sprint.findUnique({
      where: { id },
      include: { Team: true },
    });

    if (!sprint) {
      throw new Error('Sprint not found');
    }

    teamId = sprint.teamId;

    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });

    if (!membership) {
      throw new Error('You must be a team member to update sprints');
    }
  }

  const result = await dualWrite(
    'sprint',
    'update',
    async () => {
      return prisma.sprint.update({
        where: { id },
        data: {
          ...(updates.name && { name: updates.name }),
          ...(updates.goal !== undefined && { goal: updates.goal }),
          ...(updates.startDate && { startDate: new Date(updates.startDate) }),
          ...(updates.endDate && { endDate: new Date(updates.endDate) }),
          ...(updates.capacity !== undefined && { capacity: updates.capacity }),
        },
      });
    },
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
    { context: { action: 'updateSprint', sprintId: id } }
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

  const phase = getMigrationPhase('sprint');
  let teamId: string;

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifySprintAccess(userId, id, ['OWNER', 'ADMIN']);
    if (!access) {
      throw new Error('Only team owners and admins can change sprint status');
    }
    teamId = access.sprint.teamId;
  } else {
    const sprint = await prisma.sprint.findUnique({
      where: { id },
    });

    if (!sprint) {
      throw new Error('Sprint not found');
    }

    teamId = sprint.teamId;

    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new Error('Only team owners and admins can change sprint status');
    }
  }

  // If starting a sprint, check no other active sprint exists
  if (status === 'ACTIVE') {
    const activeSprint = await prisma.sprint.findFirst({
      where: {
        teamId,
        status: 'ACTIVE',
        id: { not: id },
      },
    });

    if (activeSprint) {
      throw new Error(`Sprint "${activeSprint.name}" is already active. Complete it first.`);
    }
  }

  const result = await dualWrite(
    'sprint',
    'update',
    async () => {
      return prisma.sprint.update({
        where: { id },
        data: { status },
      });
    },
    async () => {
      const { sprint } = getEntities();
      const updated = await sprint.update({ id }).set({ status }).go({ response: 'all_new' });
      return updated.data;
    },
    { context: { action: 'updateSprintStatus', sprintId: id, status } }
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

    const phase = getMigrationPhase('component');

    let projectId: string;
    let teamId: string;

    if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
      const access = await verifyComponentAccess(userId, componentId);
      if (!access) {
        throw new Error('Component not found');
      }
      projectId = access.component.projectId;
      teamId = access.project.teamId;
    } else {
      const component = await prisma.component.findUnique({
        where: { id: componentId },
        include: { Project: true },
      });

      if (!component) {
        throw new Error('Component not found');
      }

      projectId = component.projectId;
      teamId = component.Project.teamId;

      const membership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });

      if (!membership) {
        throw new Error('You must be a team member to assign components to sprints');
      }
    }

    // If assigning to a sprint, verify it belongs to the same team
    if (sprintId) {
      const sprintAccess =
        getMigrationPhase('sprint') === 'dynamo_primary' || getMigrationPhase('sprint') === 'dynamo_only'
          ? await verifySprintAccess(userId, sprintId)
          : null;

      if (sprintAccess) {
        if (sprintAccess.sprint.teamId !== teamId) {
          throw new Error('Sprint and component must belong to the same team');
        }
      } else {
        const sprint = await prisma.sprint.findUnique({
          where: { id: sprintId },
        });

        if (!sprint) {
          throw new Error('Sprint not found');
        }

        if (sprint.teamId !== teamId) {
          throw new Error('Sprint and component must belong to the same team');
        }
      }
    }

    const result = await dualWrite(
      'component',
      'update',
      async () => {
        return prisma.component.update({
          where: { id: componentId },
          data: { sprintId },
        });
      },
      async () => {
        const { component } = getEntities();
        const updated = await component.update({ id: componentId }).set({ sprintId: sprintId ?? undefined }).go({
          response: 'all_new',
        });
        return updated.data;
      },
      { context: { action: 'assignComponentToSprint', componentId, sprintId } }
    );

    revalidatePath(`/projects/${projectId}`);
    if (sprintId) {
      revalidatePath(`/sprints/${sprintId}`);
    }

    return { component: result.data };
  });

/**
 * Deletes a sprint (owner only)
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

    const phase = getMigrationPhase('sprint');
    let teamId: string;

    if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
      const access = await verifySprintAccess(userId, id, ['OWNER']);
      if (!access) {
        throw new Error('Only the team owner can delete sprints');
      }
      teamId = access.sprint.teamId;
    } else {
      const sprint = await prisma.sprint.findUnique({
        where: { id },
      });

      if (!sprint) {
        throw new Error('Sprint not found');
      }

      teamId = sprint.teamId;

      const membership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });

      if (!membership || membership.role !== 'OWNER') {
        throw new Error('Only the team owner can delete sprints');
      }
    }

    await dualWrite(
      'sprint',
      'delete',
      async () => {
        // Components will have sprintId set to null via onDelete: SetNull
        await prisma.sprint.delete({ where: { id } });
        return { success: true };
      },
      async () => {
        const { sprint } = getEntities();
        await sprint.delete({ id }).go();
        return { success: true };
      },
      { context: { action: 'deleteSprint', sprintId: id } }
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
