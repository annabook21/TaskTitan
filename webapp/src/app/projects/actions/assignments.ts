'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

/**
 * Assigns a user to a component
 */
export const assignComponent = authActionClient
  .schema(
    z.object({
      componentId: z.string().cuid(),
      assigneeId: z.string(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, assigneeId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'assignComponent', _input: { componentId, userId: assigneeId } };
    }

    // Verify user has access to project through team membership
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

    // Verify assignee is a member of the team
    const assigneeMembership = await prisma.membership.findFirst({
      where: {
        userId: assigneeId,
        teamId: component.Project.teamId,
      },
    });

    if (!assigneeMembership) {
      throw new MyCustomError('Assignee is not a member of this team');
    }

    const assignment = await prisma.assignment.create({
      data: {
        componentId,
        userId: assigneeId,
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'MEMBER_ASSIGNED',
        projectId: component.projectId,
        userId,
        metadata: {
          componentName: component.name,
          assigneeId,
        },
      },
    });

    // Create notification for assignee (unless self-assigning)
    if (assigneeId !== userId) {
      await prisma.notification.create({
        data: {
          userId: assigneeId,
          type: 'TASK_ASSIGNED',
          title: `You were assigned: ${component.name}`,
          message: `You have been assigned to work on "${component.name}" in ${component.Project.name}`,
          componentId,
          projectId: component.projectId,
        },
      });
    }

    revalidatePath(`/projects/${component.projectId}`);
    revalidatePath(`/my-tasks`);

    return { assignment };
  });

/**
 * Unassigns a user from a component
 */
export const unassignComponent = authActionClient
  .schema(
    z.object({
      componentId: z.string().cuid(),
      assigneeId: z.string(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, assigneeId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'unassignComponent', _input: { componentId, userId: assigneeId } };
    }

    // Verify user has access to project through team membership
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

    await prisma.assignment.delete({
      where: {
        componentId_userId: { componentId, userId: assigneeId },
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'MEMBER_UNASSIGNED',
        projectId: component.projectId,
        userId,
        metadata: {
          componentName: component.name,
          assigneeId,
        },
      },
    });

    revalidatePath(`/projects/${component.projectId}`);

    return { success: true };
  });
