'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

// Schema
const updateProjectGitHubSettingsSchema = z.object({
  id: z.string().cuid(),
  githubRepoUrl: z.string().url().nullable(),
  githubWebhookSecret: z.string().min(10).nullable(),
  githubPrTargetStatus: z.enum(['REVIEW', 'COMPLETED']).nullable(),
});

/**
 * Updates GitHub integration settings for a project (admin/owner only)
 */
export const updateProjectGitHubSettings = authActionClient
  .schema(updateProjectGitHubSettingsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id, githubRepoUrl, githubWebhookSecret, githubPrTargetStatus } = parsedInput;
    const { userId } = ctx;

    // Verify user has access and is owner or admin
    const project = await prisma.project.findFirst({
      where: {
        id,
        Team: {
          Membership: {
            some: {
              userId,
              role: { in: ['OWNER', 'ADMIN'] },
            },
          },
        },
      },
    });

    if (!project) {
      throw new Error('Project not found or insufficient permissions');
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        githubRepoUrl,
        githubWebhookSecret,
        githubPrTargetStatus,
      },
    });

    revalidatePath(`/projects/${id}`);

    return { project: updated };
  });
