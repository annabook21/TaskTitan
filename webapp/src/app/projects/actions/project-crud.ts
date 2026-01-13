'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

// Schemas
const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(1000).optional(),
  teamId: z.string().cuid('Invalid team ID'),
});

const updateProjectSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
});

const deleteProjectSchema = z.object({
  id: z.string().cuid(),
});

/**
 * Creates a new project for a team
 */
export const createProject = authActionClient.schema(createProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { name, description, teamId } = parsedInput;
  const { userId } = ctx;

  // Verify user is a member of the team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership) {
    throw new MyCustomError('You are not a member of this team');
  }

  const project = await prisma.project.create({
    data: {
      name,
      description,
      teamId,
      ownerId: userId,
    },
  });

  // Log activity
  await prisma.activity.create({
    data: {
      type: 'PROJECT_CREATED',
      projectId: project.id,
      userId,
      metadata: { projectName: name },
    },
  });

  revalidatePath('/');
  revalidatePath('/projects');

  return { project };
});

/**
 * Updates an existing project's details
 */
export const updateProject = authActionClient.schema(updateProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description } = parsedInput;
  const { userId } = ctx;

  // Verify user has access to the project
  const project = await prisma.project.findFirst({
    where: {
      id,
      Team: { Membership: { some: { userId } } },
    },
  });

  if (!project) {
    throw new MyCustomError('Project not found or access denied');
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
    },
  });

  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');

  return { project: updated };
});

/**
 * Deletes a project (owner only)
 */
export const deleteProject = authActionClient.schema(deleteProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { id } = parsedInput;
  const { userId } = ctx;

  // Verify user is owner (using String comparison to avoid type mismatch)
  const project = await prisma.project.findFirst({
    where: {
      id,
      Team: { Membership: { some: { userId } } },
    },
    select: { id: true, ownerId: true, name: true },
  });

  if (!project) {
    throw new MyCustomError('Project not found');
  }

  if (String(project.ownerId) !== String(userId)) {
    throw new MyCustomError('Only the project owner can delete it');
  }

  try {
    // Prisma schema has onDelete: Cascade configured for all related models,
    // so we just need to delete the project and related records are cleaned up automatically
    await prisma.project.delete({ where: { id } });
  } catch (error) {
    console.error('Failed to delete project:', error);
    throw new MyCustomError('Failed to delete project. Please try again.');
  }

  revalidatePath('/');
  revalidatePath('/projects');

  return { success: true };
});
