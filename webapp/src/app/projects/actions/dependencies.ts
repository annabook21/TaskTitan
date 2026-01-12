'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

// Schemas
const addDependencySchema = z.object({
  dependentComponentId: z.string().cuid(),
  requiredComponentId: z.string().cuid(),
  description: z.string().max(500).optional(),
});

/**
 * Adds a dependency relationship between two components
 */
export const addDependency = authActionClient.schema(addDependencySchema).action(async ({ parsedInput, ctx }) => {
  const { dependentComponentId, requiredComponentId, description } = parsedInput;
  const { userId } = ctx;

  if (dependentComponentId === requiredComponentId) {
    throw new Error('A component cannot depend on itself');
  }

  // Verify both components exist and belong to the same project
  const [dependent, required] = await Promise.all([
    prisma.component.findUnique({ where: { id: dependentComponentId } }),
    prisma.component.findUnique({ where: { id: requiredComponentId } }),
  ]);

  if (!dependent || !required) {
    throw new Error('One or both components not found');
  }

  if (dependent.projectId !== required.projectId) {
    throw new Error('Components must be in the same project');
  }

  const dependency = await prisma.dependency.create({
    data: {
      dependentComponentId,
      requiredComponentId,
      description,
    },
  });

  // Log activity
  await prisma.activity.create({
    data: {
      type: 'DEPENDENCY_ADDED',
      projectId: dependent.projectId,
      userId,
      metadata: {
        dependentComponent: dependent.name,
        requiredComponent: required.name,
      },
    },
  });

  revalidatePath(`/projects/${dependent.projectId}`);

  return { dependency };
});

/**
 * Removes a dependency relationship between two components
 */
export const removeDependency = authActionClient
  .schema(z.object({ id: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId } = ctx;

    const dependency = await prisma.dependency.findUnique({
      where: { id },
      include: {
        Component_Dependency_dependentComponentIdToComponent: true,
        Component_Dependency_requiredComponentIdToComponent: true,
      },
    });

    if (!dependency) {
      throw new Error('Dependency not found');
    }

    const dependentComponent = dependency.Component_Dependency_dependentComponentIdToComponent;
    const requiredComponent = dependency.Component_Dependency_requiredComponentIdToComponent;

    await prisma.dependency.delete({ where: { id } });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'DEPENDENCY_REMOVED',
        projectId: dependentComponent.projectId,
        userId,
        metadata: {
          dependentComponent: dependentComponent.name,
          requiredComponent: requiredComponent.name,
        },
      },
    });

    revalidatePath(`/projects/${dependentComponent.projectId}`);

    return { success: true };
  });
