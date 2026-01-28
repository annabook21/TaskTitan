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
import { verifyComponentAccess } from '@/lib/dynamodb/auth-helpers';

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

  const phase = getMigrationPhase('dependency');

  let projectId: string;
  let dependentName: string;
  let requiredName: string;

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const [depAccess, reqAccess] = await Promise.all([
      verifyComponentAccess(userId, dependentComponentId),
      verifyComponentAccess(userId, requiredComponentId),
    ]);

    if (!depAccess || !reqAccess) {
      throw new MyCustomError('One or both components not found or access denied');
    }

    if (depAccess.component.projectId !== reqAccess.component.projectId) {
      throw new MyCustomError('Components must be in the same project');
    }

    projectId = depAccess.component.projectId;
    dependentName = depAccess.component.name;
    requiredName = reqAccess.component.name;
  } else {
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

    projectId = dependent.projectId;
    dependentName = dependent.name;
    requiredName = required.name;
  }

  // Check for existing dependency (unique constraint: dependentComponentId + requiredComponentId)
  // Best practice: Use conditional write or query-first pattern to enforce uniqueness
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    // DynamoDB: Query using primary key (dependentComponentId, requiredComponentId)
    const { dependency: depEntity } = getEntities();
    const existing = await depEntity.get({ dependentComponentId, requiredComponentId }).go();
    if (existing.data) {
      throw new MyCustomError(`Dependency from "${dependentName}" to "${requiredName}" already exists`);
    }
  } else {
    // Prisma: Check unique constraint
    const existing = await prisma.dependency.findUnique({
      where: {
        dependentComponentId_requiredComponentId: { dependentComponentId, requiredComponentId },
      },
    });
    if (existing) {
      throw new MyCustomError(`Dependency from "${dependentName}" to "${requiredName}" already exists`);
    }
  }

  const dependencyId = randomUUID();
  const activityId = randomUUID();

  const result = await dualWrite(
    'dependency',
    'create',
    async () => {
      const dependency = await prisma.dependency.create({
        data: {
          id: dependencyId,
          dependentComponentId,
          requiredComponentId,
          description,
        },
      });

      await prisma.activity.create({
        data: {
          id: activityId,
          type: 'DEPENDENCY_ADDED',
          projectId,
          userId,
          metadata: {
            dependentComponent: dependentName,
            requiredComponent: requiredName,
          },
        },
      });

      return dependency;
    },
    async () => {
      const service = getService();

      await service.transaction
        .write(({ dependency, activity }) => [
          dependency
            .create({
              id: dependencyId,
              dependentComponentId,
              requiredComponentId,
              description,
            })
            .commit(),
          activity
            .create({
              id: activityId,
              type: 'DEPENDENCY_ADDED',
              projectId,
              userId,
              metadata: {
                dependentComponent: dependentName,
                requiredComponent: requiredName,
              },
            })
            .commit(),
        ])
        .go();

      return { id: dependencyId, dependentComponentId, requiredComponentId, description };
    },
    { context: { action: 'addDependency', dependentComponentId, requiredComponentId } }
  );

  revalidatePath(`/projects/${projectId}`);

  return { dependency: result.data };
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

    // NOTE: Dependency items in DynamoDB are keyed by (dependentComponentId, requiredComponentId),
    // but this action currently receives only the Prisma dependency `id`. During migration,
    // we keep the authoritative lookup in Prisma and use the derived keys for the DynamoDB delete.
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

    const dependentComponentId = dependentComponent.id;
    const requiredComponentId = requiredComponent.id;
    const projectId = dependentComponent.projectId;
    const dependentName = dependentComponent.name;
    const requiredName = requiredComponent.name;

    const activityId = randomUUID();

    await dualWrite(
      'dependency',
      'delete',
      async () => {
        await prisma.dependency.delete({ where: { id } });
        await prisma.activity.create({
          data: {
            id: activityId,
            type: 'DEPENDENCY_REMOVED',
            projectId,
            userId,
            metadata: {
              dependentComponent: dependentName,
              requiredComponent: requiredName,
            },
          },
        });
        return { success: true };
      },
      async () => {
        const service = getService();
        await service.transaction
          .write(({ dependency, activity }) => [
            dependency.delete({ dependentComponentId, requiredComponentId }).commit(),
            activity
              .create({
                id: activityId,
                type: 'DEPENDENCY_REMOVED',
                projectId,
                userId,
                metadata: { dependentComponent: dependentName, requiredComponent: requiredName },
              })
              .commit(),
          ])
          .go();

        return { success: true };
      },
      { context: { action: 'removeDependency', dependencyId: id } }
    );

    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  });
