'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
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
    const { userId } = ctx;

    const component = await prisma.component.findUnique({
      where: { id: componentId },
      include: { Project: true },
    });

    if (!component) {
      throw new Error('Component not found');
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

    revalidatePath(`/projects/${component.projectId}`);

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
    const { userId } = ctx;

    const component = await prisma.component.findUnique({
      where: { id: componentId },
    });

    if (!component) {
      throw new Error('Component not found');
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
