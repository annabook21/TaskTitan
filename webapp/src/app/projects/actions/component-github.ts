'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

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

    // Verify user has access to the component's project
    const component = await prisma.component.findFirst({
      where: {
        id: componentId,
        Project: {
          Team: {
            Membership: {
              some: { userId },
            },
          },
        },
      },
      include: {
        Project: {
          select: { id: true },
        },
      },
    });

    if (!component) {
      throw new MyCustomError('Component not found or access denied');
    }

    // Update the component with PR info
    const updated = await prisma.component.update({
      where: { id: componentId },
      data: {
        githubPrUrl: prUrl,
        githubPrNumber: prNumber,
        githubPrTitle: prTitle || null,
        githubPrStatus: prStatus || (prUrl ? 'open' : null),
        githubPrUpdatedAt: prUrl ? new Date() : null,
      },
    });

    // Create activity log for PR linking
    if (prUrl) {
      await prisma.activity.create({
        data: {
          type: 'GITHUB_PR_LINKED',
          projectId: component.Project.id,
          userId,
          metadata: {
            componentId,
            componentName: component.name,
            prUrl,
            prNumber,
          },
        },
      });
    }

    revalidatePath(`/projects/${component.Project.id}`);

    return { component: updated };
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
  prTitle?: string
) {
  return prisma.component.update({
    where: { id: componentId },
    data: {
      githubPrStatus: prStatus,
      githubPrTitle: prTitle,
      githubPrUpdatedAt: new Date(),
    },
  });
}
