'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

// Schemas
const createComponentSchema = z.object({
  projectId: z.string().cuid(),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(2000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  estimatedHours: z.number().min(0).max(1000).optional(),
  dueDate: z.string().optional(),
});

const updateComponentSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  estimatedHours: z.number().min(0).max(1000).optional(),
  dueDate: z.string().optional(),
});

/**
 * Creates a new component within a project
 */
export const createComponent = authActionClient.schema(createComponentSchema).action(async ({ parsedInput, ctx }) => {
  const { projectId, name, description, priority, estimatedHours, dueDate } = parsedInput;
  const { userId } = ctx;

  // Verify user has access
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      Team: { Membership: { some: { userId } } },
    },
  });

  if (!project) {
    throw new MyCustomError('Project not found or access denied');
  }

  const component = await prisma.component.create({
    data: {
      name,
      description,
      projectId,
      priority: priority ?? 0,
      estimatedHours,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  });

  // Create initial status history record
  await prisma.componentStatusHistory.create({
    data: {
      componentId: component.id,
      status: component.status, // PLANNING by default
      enteredAt: new Date(),
    },
  });

  // Log activity
  await prisma.activity.create({
    data: {
      type: 'COMPONENT_CREATED',
      projectId,
      userId,
      metadata: { componentName: name, componentId: component.id },
    },
  });

  revalidatePath(`/projects/${projectId}`);

  return { component };
});

/**
 * Updates an existing component's details
 */
export const updateComponent = authActionClient.schema(updateComponentSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description, status, priority, estimatedHours, dueDate } = parsedInput;
  const { userId } = ctx;

  // Verify access through project
  const component = await prisma.component.findFirst({
    where: {
      id,
      Project: { Team: { Membership: { some: { userId } } } },
    },
    include: { Project: true },
  });

  if (!component) {
    throw new MyCustomError('Component not found or access denied');
  }

  const oldStatus = component.status;

  // Use transaction for atomic status updates with history tracking
  // This prevents race conditions when multiple status changes occur
  const updated = await prisma.$transaction(async (tx) => {
    const updatedComponent = await tx.component.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(status && { status }),
        ...(priority !== undefined && { priority }),
        ...(estimatedHours !== undefined && { estimatedHours }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      },
    });

    // Log status change within transaction
    if (status && status !== oldStatus) {
      const now = new Date();

      // Close previous status history record
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

      // Create new status history record
      await tx.componentStatusHistory.create({
        data: {
          componentId: id,
          status,
          enteredAt: now,
        },
      });

      // Log activity
      await tx.activity.create({
        data: {
          type: 'COMPONENT_STATUS_CHANGED',
          projectId: component.projectId,
          userId,
          metadata: {
            componentName: updatedComponent.name,
            componentId: id,
            oldStatus,
            newStatus: status,
          },
        },
      });
    }

    return updatedComponent;
  });

  revalidatePath(`/projects/${component.projectId}`);

  return { component: updated };
});
