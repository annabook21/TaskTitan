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

    const phase = getMigrationPhase('assignment');

    // Verify access + derive project/team context
    let projectId: string;
    let teamId: string;
    let componentName: string;
    let projectName: string | undefined;

    if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
      const access = await verifyComponentAccess(userId, componentId);
      if (!access) {
        throw new MyCustomError('Component not found or access denied');
      }
      projectId = access.component.projectId;
      teamId = access.project.teamId;
      componentName = access.component.name;
      projectName = access.project.name;

      const assigneeAccess = await verifyTeamMembership(assigneeId, teamId);
      if (!assigneeAccess) {
        throw new MyCustomError('Assignee is not a member of this team');
      }
    } else {
      const component = await prisma.component.findFirst({
        where: {
          id: componentId,
          Project: {
            Team: {
              Membership: {
                some: { userId },
              },
            },
          },
        },
        include: { Project: true },
      });

      if (!component) {
        throw new MyCustomError('Component not found or access denied');
      }

      projectId = component.projectId;
      teamId = component.Project.teamId;
      componentName = component.name;
      projectName = component.Project.name;

      const assigneeMembership = await prisma.membership.findFirst({
        where: {
          userId: assigneeId,
          teamId,
        },
      });

      if (!assigneeMembership) {
        throw new MyCustomError('Assignee is not a member of this team');
      }
    }

    const assignmentId = randomUUID();
    const activityId = randomUUID();
    const notificationId = randomUUID();

    const result = await dualWrite(
      'assignment',
      'create',
      async () => {
        const assignment = await prisma.assignment.create({
          data: {
            id: assignmentId,
            componentId,
            userId: assigneeId,
          },
        });

        await prisma.activity.create({
          data: {
            id: activityId,
            type: 'MEMBER_ASSIGNED',
            projectId,
            userId,
            metadata: {
              componentName,
              assigneeId,
            },
          },
        });

        if (assigneeId !== userId) {
          await prisma.notification.create({
            data: {
              id: notificationId,
              userId: assigneeId,
              type: 'TASK_ASSIGNED',
              title: `You were assigned: ${componentName}`,
              message: `You have been assigned to work on "${componentName}" in ${projectName ?? 'this project'}`,
              componentId,
              projectId,
            },
          });
        }

        return assignment;
      },
      async () => {
        // DynamoDB: transactionally create Assignment + Activity (+ Notification when needed)
        const service = getService();

        // TypeScript-friendly: build writes in callback directly
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
                  .commit()
              );
            }

            return ops;
          })
          .go();

        return { id: assignmentId, componentId, userId: assigneeId };
      },
      { context: { action: 'assignComponent', componentId, assigneeId } }
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

    const phase = getMigrationPhase('assignment');

    let projectId: string;
    let componentName: string;

    if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
      const access = await verifyComponentAccess(userId, componentId);
      if (!access) {
        throw new MyCustomError('Component not found or access denied');
      }
      projectId = access.component.projectId;
      componentName = access.component.name;
    } else {
      const component = await prisma.component.findFirst({
        where: {
          id: componentId,
          Project: {
            Team: {
              Membership: {
                some: { userId },
              },
            },
          },
        },
      });

      if (!component) {
        throw new MyCustomError('Component not found or access denied');
      }

      projectId = component.projectId;
      componentName = component.name;
    }

    const activityId = randomUUID();

    await dualWrite(
      'assignment',
      'delete',
      async () => {
        await prisma.assignment.delete({
          where: {
            componentId_userId: { componentId, userId: assigneeId },
          },
        });

        await prisma.activity.create({
          data: {
            id: activityId,
            type: 'MEMBER_UNASSIGNED',
            projectId,
            userId,
            metadata: {
              componentName,
              assigneeId,
            },
          },
        });

        return { success: true };
      },
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
      { context: { action: 'unassignComponent', componentId, assigneeId } }
    );

    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  });
