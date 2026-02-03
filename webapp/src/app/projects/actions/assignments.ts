'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities, getService } from '@/lib/dynamodb/service';
import { verifyComponentAccess, verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

/**
 * Assigns a user to a component
 */
export const assignComponent = authActionClient
  .schema(
    z.object({
      // Use min(1) instead of cuid() to allow demo IDs like 'demo-component-001'
      componentId: z.string().min(1),
      assigneeId: z.string().min(1),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, assigneeId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'assignComponent', _input: { componentId, userId: assigneeId } };
    }

    // Verify access via DynamoDB
    const access = await verifyComponentAccess(userId, componentId);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }
    const projectId = access.component.projectId;
    const teamId = access.project.teamId;
    const componentName = access.component.name;
    const projectName = access.project.name;

    // Verify assignee is a team member
    const assigneeAccess = await verifyTeamMembership(assigneeId, teamId);
    if (!assigneeAccess) {
      throw new MyCustomError('Assignee is not a member of this team');
    }

    const assignmentId = randomUUID();
    const activityId = randomUUID();
    const notificationId = randomUUID();

    const result = await dualWrite(
      'assignment',
      'create',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        // DynamoDB: transactionally create Assignment + Activity (+ Notification when needed)
        const service = getService();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await service.transaction
          .write(({ assignment, activity, notification }) => {
            const ops: any[] = [
              assignment.create({ id: assignmentId, componentId, userId: assigneeId }).commit(),
              activity
                .create({
                  id: activityId,
                  type: 'MEMBER_ASSIGNED',
                  projectId,
                  userId,
                  metadata: { componentName, assigneeId },
                })
                .commit(),
            ];

            if (assigneeId !== userId) {
              ops.push(
                notification
                  .create({
                    id: notificationId,
                    userId: assigneeId,
                    type: 'TASK_ASSIGNED',
                    title: `You were assigned: ${componentName}`,
                    message: `You have been assigned to work on "${componentName}" in ${projectName ?? 'this project'}`,
                    componentId,
                    projectId,
                    read: false,
                  })
                  .commit(),
              );
            }

            return ops;
          })
          .go();

        return { id: assignmentId, componentId, userId: assigneeId };
      },
      { context: { action: 'assignComponent', componentId, assigneeId } },
    );

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/my-tasks`);

    return { assignment: result.data };
  });

/**
 * Unassigns a user from a component
 */
export const unassignComponent = authActionClient
  .schema(
    z.object({
      // Use min(1) instead of cuid() to allow demo IDs like 'demo-component-001'
      componentId: z.string().min(1),
      assigneeId: z.string().min(1),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, assigneeId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'unassignComponent', _input: { componentId, userId: assigneeId } };
    }

    // Verify access via DynamoDB
    const access = await verifyComponentAccess(userId, componentId);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }
    const projectId = access.component.projectId;
    const componentName = access.component.name;

    const activityId = randomUUID();

    await dualWrite(
      'assignment',
      'delete',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const service = getService();

        await service.transaction
          .write(({ assignment, activity }) => [
            assignment.delete({ componentId, userId: assigneeId }).commit(),
            activity
              .create({
                id: activityId,
                type: 'MEMBER_UNASSIGNED',
                projectId,
                userId,
                metadata: { componentName, assigneeId },
              })
              .commit(),
          ])
          .go();

        return { success: true };
      },
      { context: { action: 'unassignComponent', componentId, assigneeId } },
    );

    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  });
