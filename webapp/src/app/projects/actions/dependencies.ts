'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

// Schemas - use min(1) instead of cuid() to allow demo IDs
const addDependencySchema = z.object({
  dependentComponentId: z.string().min(1),
  requiredComponentId: z.string().min(1),
  description: z.string().max(500).optional(),
});

/**
 * Adds a dependency relationship between two components
 */
export const addDependency = authActionClient.schema(addDependencySchema).action(async ({ parsedInput, ctx }) => {
  const { dependentComponentId, requiredComponentId, description } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return {
      _demo: true,
      _action: 'addDependency',
      _input: { dependentComponentId, requiredComponentId, description },
    };
  }

  if (dependentComponentId === requiredComponentId) {
    throw new MyCustomError('A component cannot depend on itself');
  }

  // Verify both components exist AND user has access through team membership
  const [dependent, required] = await Promise.all([
    prisma.component.findFirst({
      where: {
        id: dependentComponentId,
        Project: {
          Team: {
            Membership: {
              some: { userId },
            },
          },
        },
      },
    }),
    prisma.component.findFirst({
      where: {
        id: requiredComponentId,
        Project: {
          Team: {
            Membership: {
              some: { userId },
            },
          },
        },
      },
    }),
  ]);

  if (!dependent || !required) {
    throw new MyCustomError('One or both components not found or access denied');
  }

  if (dependent.projectId !== required.projectId) {
    throw new MyCustomError('Components must be in the same project');
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
  .schema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'removeDependency', _input: { id } };
    }

    // Verify dependency exists AND user has access to the project
    const dependency = await prisma.dependency.findFirst({
      where: {
        id,
        Component_Dependency_dependentComponentIdToComponent: {
          Project: {
            Team: {
              Membership: {
                some: { userId },
              },
            },
          },
        },
      },
      include: {
        Component_Dependency_dependentComponentIdToComponent: true,
        Component_Dependency_requiredComponentIdToComponent: true,
      },
    });

    if (!dependency) {
      throw new MyCustomError('Dependency not found or access denied');
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
