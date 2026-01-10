import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { runJob } from '@/lib/jobs';
import type { ComponentStatus, Component, Assignment } from '@prisma/client';

/**
 * Extract component IDs from PR title and body
 * Supports formats: #COMP-clxxx, COMP-clxxx, #clxxx, [clxxx]
 */
export function extractComponentIds(text: string): string[] {
  const componentIds = new Set<string>();

  // Pattern 1: #COMP-clxxx or COMP-clxxx
  const compPattern = /#?COMP-([a-z0-9]{25})/gi;
  let match;
  while ((match = compPattern.exec(text)) !== null) {
    componentIds.add(match[1]);
  }

  // Pattern 2: Direct CUID references #clxxx or [clxxx]
  const cuidPattern = /[#\[]([a-z0-9]{25})[\]|\s]/gi;
  while ((match = cuidPattern.exec(text)) !== null) {
    componentIds.add(match[1]);
  }

  return Array.from(componentIds);
}

/**
 * Find components by ID or PR URL within a project
 */
export async function findComponentsForPR(
  projectId: string,
  componentIds: string[],
  prUrl: string,
): Promise<(Component & { Assignment: Assignment[] })[]> {
  return await prisma.component.findMany({
    where: {
      projectId,
      OR: [{ id: { in: componentIds } }, { githubPrUrl: prUrl }],
    },
    include: {
      Assignment: {
        select: { userId: true, id: true, componentId: true, assignedAt: true },
      },
    },
  });
}

interface PullRequestPayload {
  action: string;
  pull_request: {
    html_url: string;
    title: string;
    body: string | null;
    merged: boolean;
    merged_by: { login: string } | null;
    merged_at: string | null;
  };
}

interface ProjectWithSettings {
  id: string;
  ownerId: string;
  githubPrTargetStatus: ComponentStatus | null;
}

/**
 * Handle pull_request webhook event from GitHub
 */
export async function handlePullRequestEvent(
  payload: PullRequestPayload,
  project: ProjectWithSettings,
): Promise<void> {
  // Only process closed PRs that were merged
  if (payload.action !== 'closed' || !payload.pull_request.merged) {
    logger.info('Ignoring non-merged PR event', {
      extra: {
        action: payload.action,
        merged: payload.pull_request.merged,
        prUrl: payload.pull_request.html_url,
      },
    });
    return;
  }

  const pr = payload.pull_request;
  const searchText = `${pr.title}\n${pr.body || ''}`;
  const componentIds = extractComponentIds(searchText);

  logger.info('Processing merged PR', {
    extra: {
      prUrl: pr.html_url,
      prTitle: pr.title,
      componentIds,
      projectId: project.id,
    },
  });

  // Find matching components
  const components = await findComponentsForPR(project.id, componentIds, pr.html_url);

  if (components.length === 0) {
    logger.info('No components found for PR', {
      extra: { prUrl: pr.html_url, componentIds },
    });
    return;
  }

  // Determine target status (default to REVIEW if not configured)
  const targetStatus = project.githubPrTargetStatus || 'REVIEW';

  // Update each component
  for (const component of components) {
    await updateComponentFromPR(component, pr, targetStatus, project.ownerId);
  }

  logger.info('GitHub webhook processed successfully', {
    extra: {
      event: 'pull_request',
      action: 'closed',
      merged: true,
      componentsUpdated: components.length,
      prUrl: pr.html_url,
    },
  });
}

/**
 * Update component status from merged PR
 * Creates activity log and sends notifications
 */
async function updateComponentFromPR(
  component: Component & { Assignment: Assignment[] },
  pr: PullRequestPayload['pull_request'],
  targetStatus: ComponentStatus,
  projectOwnerId: string,
): Promise<void> {
  const oldStatus = component.status;

  // Update component
  const updated = await prisma.component.update({
    where: { id: component.id },
    data: {
      status: targetStatus,
      githubPrUrl: pr.html_url, // Store PR URL if not already set
    },
  });

  // Create activity log with PR metadata
  await prisma.activity.create({
    data: {
      type: 'COMPONENT_STATUS_CHANGED',
      projectId: component.projectId,
      userId: projectOwnerId, // Use project owner since webhook doesn't have user context
      metadata: {
        componentName: component.name,
        componentId: component.id,
        oldStatus,
        newStatus: targetStatus,
        triggeredBy: 'github_pr_merge',
        prUrl: pr.html_url,
        prTitle: pr.title,
        mergedBy: pr.merged_by?.login,
        mergedAt: pr.merged_at,
      },
    },
  });

  // Send notifications to assigned users
  const assignedUserIds = component.Assignment.map((a) => a.userId);
  if (assignedUserIds.length > 0) {
    await Promise.all(
      assignedUserIds.map((userId) =>
        runJob({
          type: 'notify',
          notificationType: 'component_status_changed',
          userId,
          componentId: component.id,
          metadata: {
            triggeredBy: 'github_pr_merge',
            prUrl: pr.html_url,
            prTitle: pr.title,
          },
        }),
      ),
    );
  }

  logger.info('Component updated from GitHub PR', {
    extra: {
      componentId: component.id,
      componentName: component.name,
      oldStatus,
      newStatus: targetStatus,
      prUrl: pr.html_url,
      assignedUsersNotified: assignedUserIds.length,
    },
  });
}
