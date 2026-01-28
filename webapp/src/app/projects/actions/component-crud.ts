'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB migration imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities, getService } from '@/lib/dynamodb/service';
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';
import { verifyComponentAccess, verifyProjectAccess } from '@/lib/dynamodb/auth-helpers';

type ComponentStatus = 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';

// Schemas
const createComponentSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(2000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  estimatedHours: z.number().min(0).max(1000).optional(),
  dueDate: z.string().optional(),
});

const updateComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  estimatedHours: z.number().min(0).max(1000).optional(),
  actualHours: z.number().min(0).max(1000).optional(),
  dueDate: z.string().optional(),
});

/**
 * Creates a new component within a project
 */
export const createComponent = authActionClient.schema(createComponentSchema).action(async ({ parsedInput, ctx }) => {
  const { projectId, name, description, priority, estimatedHours, dueDate } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return {
      _demo: true,
      _action: 'createComponent',
      _input: { projectId, name, description, type: 'TASK', priority, estimatedHours, dueDate },
    };
  }

  // Verify access using primary store (phase-aware)
  const phase = getMigrationPhase('component');
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyProjectAccess(userId, projectId);
    if (!access) {
      throw new MyCustomError('Project not found or access denied');
    }
  } else {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        Team: { Membership: { some: { userId } } },
      },
    });
    if (!project) {
      throw new MyCustomError('Project not found or access denied');
    }
  }

  // Generate IDs for dual-write consistency (Prisma otherwise auto-generates)
  const componentId = randomUUID();
  const statusHistoryId = randomUUID();
  const activityId = randomUUID();

  const result = await dualWrite(
    'component',
    'create',
    async () => {
      // Prisma: create component + initial status history + activity
      const component = await prisma.component.create({
        data: {
          id: componentId,
          name,
          description,
          projectId,
          priority: priority ?? 0,
          estimatedHours,
          dueDate: dueDate ? new Date(dueDate) : null,
        },
      });

      await prisma.componentStatusHistory.create({
        data: {
          id: statusHistoryId,
          componentId: component.id,
          status: component.status, // PLANNING by default
          enteredAt: new Date(),
        },
      });

      await prisma.activity.create({
        data: {
          id: activityId,
          type: 'COMPONENT_CREATED',
          projectId,
          userId,
          metadata: { componentName: name, componentId: component.id },
        },
      });

      return component;
    },
    async () => {
      // DynamoDB: transactionally create Component + StatusHistory + Activity
      const service = getService();

      const enteredAt = new Date().toISOString();

      await service.transaction
        .write(({ component, componentStatusHistory, activity }) => [
          component
            .create({
              id: componentId,
              name,
              description,
              projectId,
              type: 'TASK',
              priority: priority ?? 0,
              estimatedHours,
              dueDate: dueDate || undefined,
              status: 'PLANNING',
            })
            .commit(),
          componentStatusHistory
            .create({
              id: statusHistoryId,
              componentId,
              status: 'PLANNING',
              enteredAt,
              exitedAt: undefined,
            })
            .commit(),
          activity
            .create({
              id: activityId,
              type: 'COMPONENT_CREATED',
              projectId,
              userId,
              metadata: { componentName: name, componentId },
            })
            .commit(),
        ])
        .go();

      return {
        id: componentId,
        name,
        description,
        projectId,
        type: 'TASK',
        priority: priority ?? 0,
        estimatedHours,
        dueDate: dueDate || undefined,
        status: 'PLANNING',
      };
    },
    { context: { action: 'createComponent', projectId, componentId } }
  );

  revalidatePath(`/projects/${projectId}`);

  return { component: result.data };
});

/**
 * Updates an existing component's details
 */
export const updateComponent = authActionClient.schema(updateComponentSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description, status, priority, estimatedHours, actualHours, dueDate } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return {
      _demo: true,
      _action: 'updateComponent',
      _input: { componentId: id, name, description, status, priority, estimatedHours, actualHours, dueDate },
    };
  }

  const phase = getMigrationPhase('component');

  // Verify access and collect necessary context
  let projectId: string;
  let oldStatus: ComponentStatus;

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyComponentAccess(userId, id);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }
    projectId = access.component.projectId;
    oldStatus = access.component.status as ComponentStatus;
  } else {
    const component = await prisma.component.findFirst({
      where: {
        id,
        Project: { Team: { Membership: { some: { userId } } } },
      },
      include: {
        Project: true,
        Assignment: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!component) {
      throw new MyCustomError('Component not found or access denied');
    }

    projectId = component.projectId;
    oldStatus = component.status as ComponentStatus;
  }

  const entities = getEntities();

  const result = await dualWrite(
    'component',
    'update',
    async () => {
      // Prisma: keep existing strong guarantees for exitedAt-based metrics
      return prisma.$transaction(async (tx) => {
        const updatedComponent = await tx.component.update({
          where: { id },
          data: {
            ...(name && { name }),
            ...(description !== undefined && { description }),
            ...(status && { status }),
            ...(priority !== undefined && { priority }),
            ...(estimatedHours !== undefined && { estimatedHours }),
            ...(actualHours !== undefined && { actualHours }),
            ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
          },
        });

        if (status && status !== oldStatus) {
          const now = new Date();

          await tx.componentStatusHistory.updateMany({
            where: {
              componentId: id,
              status: oldStatus,
              exitedAt: null,
            },
            data: {
              exitedAt: now,
            },
          });

          await tx.componentStatusHistory.create({
            data: {
              id: randomUUID(),
              componentId: id,
              status,
              enteredAt: now,
            },
          });

          await tx.activity.create({
            data: {
              id: randomUUID(),
              type: 'COMPONENT_STATUS_CHANGED',
              projectId,
              userId,
              metadata: {
                componentName: updatedComponent.name,
                componentId: id,
                oldStatus,
                newStatus: status,
              },
            },
          });

          const assignees = await tx.assignment.findMany({
            where: { componentId: id },
            select: { userId: true },
          });
          const assigneeIds = assignees.map((a) => a.userId).filter((uid) => uid !== userId);
          if (assigneeIds.length > 0) {
            await tx.notification.createMany({
              data: assigneeIds.map((assigneeId) => ({
                id: randomUUID(),
                userId: assigneeId,
                type: 'TASK_STATUS_CHANGED',
                title: `Status changed: ${updatedComponent.name}`,
                message: `Changed from ${oldStatus} to ${status}`,
                componentId: id,
                projectId,
              })),
            });
          }
        }

        return updatedComponent;
      });
    },
    async () => {
      // DynamoDB: update component; if status changes, update status history (exitedAt) + create new history + activity + notifications
      const updateData: Record<string, unknown> = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (status) updateData.status = status;
      if (priority !== undefined) updateData.priority = priority;
      if (estimatedHours !== undefined) updateData.estimatedHours = estimatedHours;
      if (actualHours !== undefined) updateData.actualHours = actualHours;
      if (dueDate !== undefined) updateData.dueDate = dueDate || undefined;

      const updatedComponent = await entities.component.update({ id }).set(updateData).go({ response: 'all_new' });

      if (status && status !== oldStatus) {
        const nowIso = new Date().toISOString();

        // Find the current/open status record (exitedAt not set) so metrics (WIP/aging/CFD) keep working.
        const historyResult = await entities.componentStatusHistory.query.primary({ componentId: id }).go();
        const openEntry =
          historyResult.data.find((h) => !h.exitedAt) ?? historyResult.data[historyResult.data.length - 1];

        if (openEntry) {
          await entities.componentStatusHistory
            .update({ componentId: id, enteredAt: openEntry.enteredAt, id: openEntry.id })
            .set({ exitedAt: nowIso })
            .go();
        }

        await entities.componentStatusHistory
          .create({
            id: randomUUID(),
            componentId: id,
            status,
            enteredAt: nowIso,
            exitedAt: undefined,
          })
          .go();

        await entities.activity
          .create({
            id: randomUUID(),
            type: 'COMPONENT_STATUS_CHANGED',
            projectId,
            userId,
            metadata: {
              componentName: updatedComponent.data?.name ?? name ?? '',
              componentId: id,
              oldStatus,
              newStatus: status,
            },
          })
          .go();

        // Notify assignees (best-effort; not transactional due to variable count)
        const assignments = await entities.assignment.query.primary({ componentId: id }).go();
        const assigneeIds = assignments.data.map((a) => a.userId).filter((uid) => uid !== userId);

        for (const assigneeId of assigneeIds) {
          await entities.notification
            .create({
              id: randomUUID(),
              userId: assigneeId,
              type: 'TASK_STATUS_CHANGED',
              title: `Status changed: ${updatedComponent.data?.name ?? name ?? ''}`,
              message: `Changed from ${oldStatus} to ${status}`,
              componentId: id,
              projectId,
              read: false,
            })
            .go();
        }
      }

      return updatedComponent.data;
    },
    { context: { action: 'updateComponent', componentId: id, projectId } }
  );

  revalidatePath(`/projects/${projectId}`);

  return { component: result.data };
});
