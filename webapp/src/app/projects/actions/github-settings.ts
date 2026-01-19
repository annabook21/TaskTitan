'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

// Schema for basic settings
const updateProjectGitHubSettingsSchema = z.object({
  id: z.string().cuid(),
  githubRepoUrl: z.string().url().nullable(),
  githubWebhookSecret: z.string().min(10).nullable(),
  githubPrTargetStatus: z.enum(['REVIEW', 'COMPLETED']).nullable(),
});

// Schema for transition configuration
const updateGitHubTransitionConfigSchema = z.object({
  projectId: z.string().cuid(),
  transitions: z.array(
    z.object({
      event: z.enum(['PR_OPENED', 'PR_READY_FOR_REVIEW', 'PR_APPROVED', 'PR_MERGED', 'PR_CLOSED']),
      targetStatus: z.enum(['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']),
      enabled: z.boolean(),
    }),
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
      throw new MyCustomError('Project not found or insufficient permissions');
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

    // Verify user has access and is owner or admin
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
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
      throw new MyCustomError('Project not found or insufficient permissions');
    }

    // Upsert all transition configs
    const results = await Promise.all(
      transitions.map((transition) =>
        prisma.gitHubTransitionConfig.upsert({
          where: {
            projectId_event: {
              projectId,
              event: transition.event,
            },
          },
          create: {
            projectId,
            event: transition.event,
            targetStatus: transition.targetStatus,
            enabled: transition.enabled,
          },
          update: {
            targetStatus: transition.targetStatus,
            enabled: transition.enabled,
          },
        }),
      ),
    );

    revalidatePath(`/projects/${projectId}`);

    return { configs: results };
  });
