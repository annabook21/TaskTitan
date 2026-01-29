'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyProjectAccess } from '@/lib/dynamodb/auth-helpers';

// Schema for basic settings
const updateProjectGitHubSettingsSchema = z.object({
  id: z.string().min(1),
  githubRepoUrl: z.string().url().nullable(),
  githubWebhookSecret: z.string().min(10).nullable(),
  githubPrTargetStatus: z.enum(['REVIEW', 'COMPLETED']).nullable(),
});

// Schema for transition configuration
const updateGitHubTransitionConfigSchema = z.object({
  projectId: z.string().min(1),
  transitions: z.array(
    z.object({
      event: z.enum(['PR_OPENED', 'PR_READY_FOR_REVIEW', 'PR_APPROVED', 'PR_MERGED', 'PR_CLOSED']),
      targetStatus: z.enum(['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']),
      enabled: z.boolean(),
    })
  ),
});

/**
 * Updates GitHub integration settings for a project (admin/owner only)
 */
export const updateProjectGitHubSettings = authActionClient
  .schema(updateProjectGitHubSettingsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id, githubRepoUrl, githubWebhookSecret, githubPrTargetStatus } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'updateProjectGitHubSettings',
        _input: { projectId: id, githubRepoUrl, githubWebhookSecret, githubPrTargetStatus },
      };
    }

    const entities = getEntities();

    // Verify user has access and is owner or admin via DynamoDB
    const access = await verifyProjectAccess(userId, id, ['OWNER', 'ADMIN']);
    if (!access) {
      throw new MyCustomError('Project not found or insufficient permissions');
    }

    // Update project GitHub settings
    const result = await dualWrite(
      'project',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const updated = await entities.project
          .update({ id })
          .set({
            githubRepoUrl: githubRepoUrl || undefined,
            githubWebhookSecret: githubWebhookSecret || undefined,
            githubPrTargetStatus: githubPrTargetStatus || undefined,
          })
          .go({ response: 'all_new' });
        return updated.data;
      },
      { context: { action: 'updateProjectGitHubSettings', projectId: id } }
    );

    revalidatePath(`/projects/${id}`);

    return { project: result.data };
  });

/**
 * Updates GitHub transition configuration for a project
 */
export const updateGitHubTransitionConfig = authActionClient
  .schema(updateGitHubTransitionConfigSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, transitions } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'updateGitHubTransitionConfig',
        _input: { projectId, transitions },
      };
    }

    const entities = getEntities();

    // Verify user has access and is owner or admin via DynamoDB
    const access = await verifyProjectAccess(userId, projectId, ['OWNER', 'ADMIN']);
    if (!access) {
      throw new MyCustomError('Project not found or insufficient permissions');
    }

    // Upsert all transition configs
    const configIds = transitions.map(() => randomUUID());
    const results = await Promise.all(
      transitions.map(async (transition, idx) => {
        const configId = configIds[idx];
        return dualWrite(
          'githubTransitionConfig',
          'upsert',
          async () => null, // Prisma removed - DynamoDB only
          async () => {
            // ElectroDB upsert pattern
            const existing = await entities.githubTransitionConfig.get({ projectId, event: transition.event }).go();
            const upsertData = {
              id: existing.data?.id || configId,
              projectId,
              event: transition.event,
              targetStatus: transition.targetStatus,
              enabled: transition.enabled,
            };
            const result = await entities.githubTransitionConfig.upsert(upsertData).go();
            return result.data;
          },
          { context: { action: 'updateGitHubTransitionConfig', projectId, event: transition.event } }
        );
      })
    );

    revalidatePath(`/projects/${projectId}`);

    return { configs: results.map((r) => r.data) };
  });
