'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities, getService } from '@/lib/dynamodb/service';
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

  // Verify access to both components via DynamoDB
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

  const projectId = depAccess.component.projectId;
  const dependentName = depAccess.component.name;
  const requiredName = reqAccess.component.name;

  // Check for existing dependency
  const { dependency: depEntity } = getEntities();
  const existing = await depEntity.get({ dependentComponentId, requiredComponentId }).go();
  if (existing.data) {
    throw new MyCustomError(`Dependency from "${dependentName}" to "${requiredName}" already exists`);
  }

  const dependencyId = randomUUID();
  const activityId = randomUUID();

  const result = await dualWrite(
    'dependency',
    'create',
    async () => null, // Prisma removed - DynamoDB only
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
  .schema(
    z.object({
      dependentComponentId: z.string().min(1),
      requiredComponentId: z.string().min(1),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { dependentComponentId, requiredComponentId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'removeDependency', _input: { dependentComponentId, requiredComponentId } };
    }

    // Verify access via DynamoDB
    const access = await verifyComponentAccess(userId, dependentComponentId);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }

    const projectId = access.component.projectId;
    const dependentName = access.component.name;

    // Get required component name for activity log
    const reqAccess = await verifyComponentAccess(userId, requiredComponentId);
    const requiredName = reqAccess?.component.name ?? 'Unknown';

    const activityId = randomUUID();

    await dualWrite(
      'dependency',
      'delete',
      async () => null, // Prisma removed - DynamoDB only
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
      { context: { action: 'removeDependency', dependentComponentId, requiredComponentId } }
    );

    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  });
