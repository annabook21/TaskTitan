'use server';

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities, getService } from '@/lib/dynamodb/service';
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';
import { batchDelete } from '@/lib/dynamodb/batch-ops';
import { executeSaga } from '@/lib/dynamodb/transactions';

// Schemas
const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(1000).optional(),
  teamId: z.string().min(1, 'Invalid team ID'),
  // Optional idempotency key so retries don't duplicate createProject.
  // If omitted, we still pass a best-effort token derived from the generated ids.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const updateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
});

const deleteProjectSchema = z.object({
  id: z.string().min(1),
});

/**
 * Creates a new project for a team
 * Uses Service transaction to atomically create Project + Activity in DynamoDB
 */
export const createProject = authActionClient.schema(createProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { name, description, teamId, idempotencyKey } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'createProject', _input: { name, description, teamId, ownerId: userId } };
  }

  // Verify user is a member of the team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership) {
    throw new MyCustomError('You are not a member of this team');
  }

  const projectId = randomUUID();
  const activityId = randomUUID();
  const token = idempotencyKey ?? `createProject#${teamId}#${userId}#${projectId}#${activityId}`;

  // Use dual-write pattern
  const result = await dualWrite(
    'project',
    'create',
    async () => {
      // Prisma: Create project and activity in sequence
      const project = await prisma.project.create({
        data: {
          id: projectId,
          name,
          description,
          teamId,
          ownerId: userId,
        },
      });

      // Log activity
      await prisma.activity.create({
        data: {
          id: activityId,
          type: 'PROJECT_CREATED',
          projectId: project.id,
          userId,
          metadata: { projectName: name },
        },
      });

      return project;
    },
    async () => {
      // ElectroDB: Use Service transaction for atomic Project + Activity creation
      const service = getService();

      await service.transaction
        .write(({ project, activity }) => [
          project
            .create({
              id: projectId,
              name,
              description,
              teamId,
              ownerId: userId,
            })
            .commit(),
          activity
            .create({
              id: activityId,
              type: 'PROJECT_CREATED',
              projectId,
              userId,
              metadata: { projectName: name },
            })
            .commit(),
        ])
        .go({ token });

      // Return project data (transaction doesn't return created items)
      return { id: projectId, name, description, teamId, ownerId: userId };
    },
    { context: { action: 'createProject', projectId, teamId } }
  );

  revalidatePath('/');
  revalidatePath('/projects');

  return { project: result.data };
});

/**
 * Updates an existing project's details
 */
export const updateProject = authActionClient.schema(updateProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'updateProject', _input: { projectId: id, name, description } };
  }

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

  const entities = getEntities();

  // Build update data
  const updateData: { name?: string; description?: string } = {};
  if (name) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  // Use dual-write for update
  const result = await dualWrite(
    'project',
    'update',
    async () => {
      return prisma.project.update({
        where: { id },
        data: updateData,
      });
    },
    async () => {
      // ElectroDB update
      const updated = await entities.project.update({ id }).set(updateData).go();
      return updated.data;
    },
    { context: { action: 'updateProject', projectId: id } }
  );

  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');

  return { project: result.data };
});

/**
 * Deletes a project (owner only)
 * DynamoDB requires manual cascade delete of related entities
 */
export const deleteProject = authActionClient.schema(deleteProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { id } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'deleteProject', _input: { projectId: id } };
  }

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

  const entities = getEntities();

  try {
    // Use dual-write for delete
    await dualWrite(
      'project',
      'delete',
      async () => {
        // Prisma schema has onDelete: Cascade configured for all related models,
        // so we just need to delete the project and related records are cleaned up automatically
        await prisma.project.delete({ where: { id } });
        return { success: true };
      },
      async () => {
        // DynamoDB: Manual cascade delete using saga pattern for safety
        // Order: children -> parent (activities, components, then project)

        await executeSaga([
          {
            name: 'Delete activities',
            execute: async () => {
              const activities = await entities.activity.query.primary({ projectId: id }).go();
              if (activities.data.length > 0) {
                await batchDelete(
                  activities.data.map((a) => ({
                    pk: `PROJECT#${id}`,
                    sk: `ACTIVITY#${a.createdAt}#${a.id}`,
                  }))
                );
              }
              return activities.data.length;
            },
            compensate: async () => {
              // Activities are append-only, no compensate needed if project delete fails
            },
          },
          {
            name: 'Delete components and related',
            execute: async () => {
              const components = await entities.component.query.byProject({ projectId: id }).go();

              for (const comp of components.data) {
                // Delete assignments for this component (primary index uses componentId)
                const assignments = await entities.assignment.query.primary({ componentId: comp.id }).go();
                if (assignments.data.length > 0) {
                  await batchDelete(
                    assignments.data.map((a) => ({
                      pk: `COMPONENT#${comp.id}`,
                      sk: `ASSIGNEE#${a.userId}`,
                    }))
                  );
                }

                // Delete dependencies where this component is the dependent (primary uses dependentComponentId)
                const dependencies = await entities.dependency.query.primary({ dependentComponentId: comp.id }).go();
                if (dependencies.data.length > 0) {
                  await batchDelete(
                    dependencies.data.map((d) => ({
                      pk: `COMPONENT#${comp.id}`,
                      sk: `DEPENDS_ON#${d.requiredComponentId}`,
                    }))
                  );
                }

                // Delete status history (primary index uses componentId)
                const history = await entities.componentStatusHistory.query.primary({ componentId: comp.id }).go();
                if (history.data.length > 0) {
                  await batchDelete(
                    history.data.map((h) => ({
                      pk: `COMPONENT#${comp.id}`,
                      sk: `STATUS_HISTORY#${h.enteredAt}#${h.id}`,
                    }))
                  );
                }

                // Delete component previews (primary index uses componentId)
                const previews = await entities.componentPreview.query.primary({ componentId: comp.id }).go();
                if (previews.data.length > 0) {
                  await batchDelete(
                    previews.data.map((p) => ({
                      pk: `COMPONENT#${comp.id}`,
                      sk: `PREVIEW#${p.createdAt}#${p.id}`,
                    }))
                  );
                }
              }

              // Delete all components
              if (components.data.length > 0) {
                await batchDelete(
                  components.data.map((c) => ({
                    pk: `PROJECT#${id}`,
                    sk: `COMPONENT#${c.id}`,
                  }))
                );
              }

              return components.data.length;
            },
            compensate: async () => {
              // Complex compensation - in practice, may need to restore from backup
              // For now, log the failure for manual intervention
            },
          },
          {
            name: 'Delete project',
            execute: async () => {
              await entities.project.delete({ id }).go();
              return 1;
            },
            compensate: async () => {
              // Cannot easily restore deleted project without original data
              // In production, consider soft-delete pattern
            },
          },
        ]);

        return { success: true };
      },
      { context: { action: 'deleteProject', projectId: id } }
    );
  } catch (error) {
    console.error('Failed to delete project:', error);
    throw new MyCustomError('Failed to delete project. Please try again.');
  }

  revalidatePath('/');
  revalidatePath('/projects');

  return { success: true };
});
