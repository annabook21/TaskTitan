'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities, getService } from '@/lib/dynamodb/service';
import { verifyComponentAccess } from '@/lib/dynamodb/auth-helpers';

// Schema for linking a PR to a component
const linkComponentToPRSchema = z.object({
  componentId: z.string().cuid(),
  prUrl: z.string().url().nullable(),
  prNumber: z.number().int().positive().nullable(),
  prTitle: z.string().optional(),
  prStatus: z.enum(['open', 'draft', 'merged', 'closed']).optional(),
});

/**
 * Links a GitHub PR to a component (or unlinks if prUrl is null)
 */
export const linkComponentToPR = authActionClient
  .schema(linkComponentToPRSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, prUrl, prNumber, prTitle, prStatus } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'linkComponentToPR',
        _input: { componentId, prUrl, prNumber, prTitle, prStatus },
      };
    }

    const entities = getEntities();

    // Verify user has access to the component's project via DynamoDB
    const access = await verifyComponentAccess(userId, componentId);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }

    const projectId = access.component.projectId;
    const componentName = access.component.name;
    const activityId = randomUUID();

    // Update the component with PR info (dual-write)
    const result = await dualWrite(
      'component',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const updateData: Record<string, unknown> = {};
        updateData.githubPrUrl = prUrl || undefined;
        updateData.githubPrNumber = prNumber ?? undefined;
        updateData.githubPrTitle = prTitle || undefined;
        updateData.githubPrStatus = prStatus || (prUrl ? 'open' : undefined);
        updateData.githubPrUpdatedAt = prUrl ? new Date().toISOString() : undefined;

        const updated = await entities.component
          .update({ id: componentId })
          .set(updateData)
          .go({ response: 'all_new' });
        return updated.data;
      },
      { context: { action: 'linkComponentToPR', componentId } },
    );

    // Create activity log for PR linking
    if (prUrl) {
      await dualWrite(
        'activity',
        'create',
        async () => null, // Prisma removed - DynamoDB only
        async () => {
          const service = getService();
          await service.transaction
            .write(({ activity }) => [
              activity
                .create({
                  id: activityId,
                  type: 'GITHUB_PR_LINKED',
                  projectId,
                  userId,
                  metadata: { componentId, componentName, prUrl, prNumber },
                })
                .commit(),
            ])
            .go();
          return { id: activityId };
        },
        { context: { action: 'linkComponentToPR', componentId } },
      );
    }

    revalidatePath(`/projects/${projectId}`);

    return { component: result.data };
  });

// Schema for updating PR status (called from webhook)
const updateComponentPRStatusSchema = z.object({
  componentId: z.string().cuid(),
  prStatus: z.enum(['open', 'draft', 'merged', 'closed']),
  prTitle: z.string().optional(),
});

/**
 * Updates the PR status on a component (internal use from webhooks)
 */
export async function updateComponentPRStatus(
  componentId: string,
  prStatus: 'open' | 'draft' | 'merged' | 'closed',
  prTitle?: string,
) {
  const entities = getEntities();
  return dualWrite(
    'component',
    'update',
    async () => null, // Prisma removed - DynamoDB only
    async () => {
      const updated = await entities.component
        .update({ id: componentId })
        .set({
          githubPrStatus: prStatus,
          githubPrTitle: prTitle || undefined,
          githubPrUpdatedAt: new Date().toISOString(),
        })
        .go({ response: 'all_new' });
      return updated.data;
    },
    { context: { action: 'updateComponentPRStatus', componentId, prStatus } },
  );
}
