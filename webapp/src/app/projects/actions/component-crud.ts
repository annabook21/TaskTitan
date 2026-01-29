'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities, getService } from '@/lib/dynamodb/service';
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

  // Verify access via DynamoDB
  const access = await verifyProjectAccess(userId, projectId);
  if (!access) {
    throw new MyCustomError('Project not found or access denied');
  }

  // Generate IDs
  const componentId = randomUUID();
  const statusHistoryId = randomUUID();
  const activityId = randomUUID();

  const result = await dualWrite(
    'component',
    'create',
    async () => null, // Prisma removed - DynamoDB only
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

  // Verify access via DynamoDB
  const access = await verifyComponentAccess(userId, id);
  if (!access) {
    throw new MyCustomError('Component not found or access denied');
  }
  const projectId = access.component.projectId;
  const oldStatus = access.component.status as ComponentStatus;

  const entities = getEntities();

  const result = await dualWrite(
    'component',
    'update',
    async () => null, // Prisma removed - DynamoDB only
    async () => {
      // DynamoDB: Atomic status change with transaction
      // Best practice: Use transaction for component + history + activity + notifications
      // If notifications exceed transaction limit (20), use saga pattern with best-effort notifications

      const service = getService();
      const updateData: Record<string, unknown> = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (status) updateData.status = status;
      if (priority !== undefined) updateData.priority = priority;
      if (estimatedHours !== undefined) updateData.estimatedHours = estimatedHours;
      if (actualHours !== undefined) updateData.actualHours = actualHours;
      if (dueDate !== undefined) updateData.dueDate = dueDate || undefined;

      // Simple update without status change - no transaction needed
      if (!status || status === oldStatus) {
        const updatedComponent = await entities.component.update({ id }).set(updateData).go({ response: 'all_new' });
        return updatedComponent.data;
      }

      // Status change: gather data needed for transaction BEFORE starting it
      const nowIso = new Date().toISOString();
      const newHistoryId = randomUUID();
      const activityId = randomUUID();

      // Query open status history entry and assignments in parallel
      const [historyResult, assignmentsResult] = await Promise.all([
        entities.componentStatusHistory.query.primary({ componentId: id }).go(),
        entities.assignment.query.primary({ componentId: id }).go(),
      ]);

      const openEntry =
        historyResult.data.find((h) => !h.exitedAt) ?? historyResult.data[historyResult.data.length - 1];
      const assigneeIds = assignmentsResult.data.map((a) => a.userId).filter((uid) => uid !== userId);

      // Calculate transaction size: component(1) + close history(0-1) + new history(1) + activity(1) + notifications(N)
      const coreOpsCount = 3 + (openEntry ? 1 : 0); // component + new history + activity + optional close history
      const totalOpsCount = coreOpsCount + assigneeIds.length;

      // Transaction limit is 25; use 20 as threshold to leave margin
      const NOTIFICATION_THRESHOLD = 20;

      if (totalOpsCount <= NOTIFICATION_THRESHOLD + coreOpsCount) {
        // All operations fit in one transaction - atomic update
        await service.transaction
          .write(({ component, componentStatusHistory, activity, notification }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ops: any[] = [];

            // 1. Update component
            ops.push(component.update({ id }).set(updateData).commit());

            // 2. Close previous status history entry (if exists)
            if (openEntry) {
              ops.push(
                componentStatusHistory
                  .update({ componentId: id, enteredAt: openEntry.enteredAt, id: openEntry.id })
                  .set({ exitedAt: nowIso })
                  .commit()
              );
            }

            // 3. Create new status history entry
            ops.push(
              componentStatusHistory
                .create({
                  id: newHistoryId,
                  componentId: id,
                  status,
                  enteredAt: nowIso,
                  exitedAt: undefined,
                })
                .commit()
            );

            // 4. Create activity log
            ops.push(
              activity
                .create({
                  id: activityId,
                  type: 'COMPONENT_STATUS_CHANGED',
                  projectId,
                  userId,
                  metadata: {
                    componentName: name ?? '',
                    componentId: id,
                    oldStatus,
                    newStatus: status,
                  },
                })
                .commit()
            );

            // 5. Create notifications for assignees
            for (const assigneeId of assigneeIds) {
              ops.push(
                notification
                  .create({
                    id: randomUUID(),
                    userId: assigneeId,
                    type: 'TASK_STATUS_CHANGED',
                    title: `Status changed: ${name ?? 'Component'}`,
                    message: `Changed from ${oldStatus} to ${status}`,
                    componentId: id,
                    projectId,
                    read: false,
                  })
                  .commit()
              );
            }

            return ops;
          })
          .go();

        // Fetch the updated component to return
        const updatedComponent = await entities.component.get({ id }).go();
        return updatedComponent.data;
      } else {
        // Large assignee list: use saga pattern
        // Step 1 (Critical): Atomic transaction for core operations
        // Step 2 (Best-effort): Batch notifications separately

        // Step 1: Core transaction
        await service.transaction
          .write(({ component, componentStatusHistory, activity }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ops: any[] = [];

            ops.push(component.update({ id }).set(updateData).commit());

            if (openEntry) {
              ops.push(
                componentStatusHistory
                  .update({ componentId: id, enteredAt: openEntry.enteredAt, id: openEntry.id })
                  .set({ exitedAt: nowIso })
                  .commit()
              );
            }

            ops.push(
              componentStatusHistory
                .create({
                  id: newHistoryId,
                  componentId: id,
                  status,
                  enteredAt: nowIso,
                  exitedAt: undefined,
                })
                .commit()
            );

            ops.push(
              activity
                .create({
                  id: activityId,
                  type: 'COMPONENT_STATUS_CHANGED',
                  projectId,
                  userId,
                  metadata: {
                    componentName: name ?? '',
                    componentId: id,
                    oldStatus,
                    newStatus: status,
                  },
                })
                .commit()
            );

            return ops;
          })
          .go();

        // Step 2: Best-effort notifications (non-critical, can tolerate partial failure)
        // Use Promise.allSettled to continue even if some fail
        await Promise.allSettled(
          assigneeIds.map((assigneeId) =>
            entities.notification
              .create({
                id: randomUUID(),
                userId: assigneeId,
                type: 'TASK_STATUS_CHANGED',
                title: `Status changed: ${name ?? 'Component'}`,
                message: `Changed from ${oldStatus} to ${status}`,
                componentId: id,
                projectId,
                read: false,
              })
              .go()
          )
        );

        const updatedComponent = await entities.component.get({ id }).go();
        return updatedComponent.data;
      }
    },
    { context: { action: 'updateComponent', componentId: id, projectId } }
  );

  revalidatePath(`/projects/${projectId}`);

  return { component: result.data };
});
