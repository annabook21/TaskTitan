import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import { runJob } from '@/lib/jobs';
import { getEntities } from '@/lib/dynamodb/service';

// Type definitions (previously from @prisma/client)
type ComponentStatus = 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';
type GitHubEvent = 'PR_OPENED' | 'PR_READY_FOR_REVIEW' | 'PR_APPROVED' | 'PR_MERGED' | 'PR_CLOSED';

interface ComponentData {
  id: string;
  name: string;
  status: string;
  projectId: string;
  assignments: { userId: string }[];
}

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
): Promise<ComponentData[]> {
  const entities = getEntities();
  
  // Get all components for the project
  const componentsResult = await entities.component.query.byProject({ projectId }).go();
  
  // Filter by componentIds or prUrl
  const matchingComponents = componentsResult.data.filter(
    (c) => componentIds.includes(c.id) || (c as any).githubPrUrl === prUrl
  );
  
  // Fetch assignments for each component
  const componentsWithAssignments = await Promise.all(
    matchingComponents.map(async (c) => {
      const assignmentsResult = await entities.assignment.query.primary({ componentId: c.id }).go();
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        projectId: c.projectId,
        assignments: assignmentsResult.data.map((a) => ({ userId: a.userId })),
      };
    })
  );
  
  return componentsWithAssignments;
}

interface TransitionConfig {
  event: GitHubEvent;
  targetStatus: ComponentStatus;
  enabled: boolean;
}

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    html_url: string;
    number: number;
    title: string;
    body: string | null;
    state: string;
    draft: boolean;
    merged: boolean;
    merged_by: { login: string } | null;
    merged_at: string | null;
    user: { login: string };
  };
}

interface PullRequestReviewPayload {
  action: string;
  review: {
    state: string; // "approved", "changes_requested", "commented"
    user: { login: string };
  };
  pull_request: {
    html_url: string;
    number: number;
    title: string;
    body: string | null;
  };
}

interface ProjectWithSettings {
  id: string;
  ownerId: string;
  githubPrTargetStatus: ComponentStatus | null;
  transitionConfigs: TransitionConfig[];
}

/**
 * Get the target status for a GitHub event from project configuration
 */
function getTargetStatusForEvent(
  event: GitHubEvent,
  transitionConfigs: TransitionConfig[],
  fallbackStatus?: ComponentStatus | null,
): ComponentStatus | null {
  const config = transitionConfigs.find((c) => c.event === event && c.enabled);
  if (config) {
    return config.targetStatus;
  }

  // Fallback for legacy PR_MERGED behavior
  if (event === 'PR_MERGED' && fallbackStatus) {
    return fallbackStatus;
  }

  return null;
}

/**
 * Map GitHub pull_request action to our GitHubEvent type
 */
function mapPRActionToEvent(action: string, pr: PullRequestPayload['pull_request']): GitHubEvent | null {
  switch (action) {
    case 'opened':
      return pr.draft ? null : 'PR_OPENED';
    case 'ready_for_review':
      return 'PR_READY_FOR_REVIEW';
    case 'closed':
      return pr.merged ? 'PR_MERGED' : 'PR_CLOSED';
    default:
      return null;
  }
}

/**
 * Map PR state to our status string
 */
function mapPRStateToStatus(pr: PullRequestPayload['pull_request']): 'open' | 'draft' | 'merged' | 'closed' {
  if (pr.merged) return 'merged';
  if (pr.draft) return 'draft';
  if (pr.state === 'closed') return 'closed';
  return 'open';
}

/**
 * Handle pull_request webhook event from GitHub
 */
export async function handlePullRequestEvent(payload: PullRequestPayload, project: ProjectWithSettings): Promise<void> {
  const pr = payload.pull_request;
  const event = mapPRActionToEvent(payload.action, pr);
  const entities = getEntities();

  logger.info('Processing pull_request event', {
    extra: {
      action: payload.action,
      event,
      prUrl: pr.html_url,
      prNumber: pr.number,
      projectId: project.id,
    },
  });

  // Extract component IDs from PR title and body
  const searchText = `${pr.title}\n${pr.body || ''}`;
  const componentIds = extractComponentIds(searchText);

  // Find matching components
  const components = await findComponentsForPR(project.id, componentIds, pr.html_url);

  if (components.length === 0) {
    logger.info('No components found for PR', {
      extra: { prUrl: pr.html_url, componentIds },
    });
    return;
  }

  // Update PR metadata on all linked components
  const prStatus = mapPRStateToStatus(pr);
  await Promise.all(
    components.map((component) =>
      entities.component.update({ id: component.id }).set({
        githubPrUrl: pr.html_url,
        githubPrNumber: pr.number,
        githubPrTitle: pr.title,
        githubPrStatus: prStatus,
        githubPrUpdatedAt: new Date().toISOString(),
      }).go()
    ),
  );

  // If we have a mappable event, check for status transition
  if (event) {
    const targetStatus = getTargetStatusForEvent(event, project.transitionConfigs, project.githubPrTargetStatus);

    if (targetStatus) {
      for (const component of components) {
        await updateComponentStatus(component, targetStatus, project.ownerId, {
          event,
          prUrl: pr.html_url,
          prTitle: pr.title,
          prNumber: pr.number,
          triggeredBy: pr.user.login,
          mergedBy: pr.merged_by?.login,
          mergedAt: pr.merged_at,
        });
      }
    }
  }

  logger.info('GitHub pull_request event processed', {
    extra: {
      action: payload.action,
      event,
      componentsUpdated: components.length,
      prUrl: pr.html_url,
    },
  });
}

/**
 * Handle pull_request_review webhook event from GitHub
 */
export async function handlePullRequestReviewEvent(
  payload: PullRequestReviewPayload,
  project: Omit<ProjectWithSettings, 'githubPrTargetStatus'>,
): Promise<void> {
  // Only process approved reviews
  if (payload.action !== 'submitted' || payload.review.state !== 'approved') {
    logger.info('Ignoring non-approval review event', {
      extra: {
        action: payload.action,
        reviewState: payload.review.state,
      },
    });
    return;
  }

  const pr = payload.pull_request;
  const searchText = `${pr.title}\n${pr.body || ''}`;
  const componentIds = extractComponentIds(searchText);

  // Find matching components
  const components = await findComponentsForPR(project.id, componentIds, pr.html_url);

  if (components.length === 0) {
    logger.info('No components found for PR review', {
      extra: { prUrl: pr.html_url, componentIds },
    });
    return;
  }

  // Check for status transition on approval
  const targetStatus = getTargetStatusForEvent('PR_APPROVED', project.transitionConfigs, null);

  if (targetStatus) {
    for (const component of components) {
      await updateComponentStatus(component, targetStatus, project.ownerId, {
        event: 'PR_APPROVED',
        prUrl: pr.html_url,
        prTitle: pr.title,
        prNumber: pr.number,
        approvedBy: payload.review.user.login,
      });
    }
  }

  logger.info('GitHub pull_request_review event processed', {
    extra: {
      reviewState: payload.review.state,
      componentsUpdated: components.length,
      prUrl: pr.html_url,
    },
  });
}

/**
 * Update component status and create activity/notifications
 */
async function updateComponentStatus(
  component: ComponentData,
  targetStatus: ComponentStatus,
  projectOwnerId: string,
  metadata: {
    event: GitHubEvent;
    prUrl: string;
    prTitle: string;
    prNumber: number;
    triggeredBy?: string;
    mergedBy?: string | null;
    mergedAt?: string | null;
    approvedBy?: string;
  },
): Promise<void> {
  const entities = getEntities();
  const oldStatus = component.status;

  // Skip if already at target status
  if (oldStatus === targetStatus) {
    logger.info('Component already at target status', {
      extra: {
        componentId: component.id,
        status: targetStatus,
      },
    });
    return;
  }

  // Update component status
  await entities.component.update({ id: component.id }).set({
    status: targetStatus,
  }).go();

  // Map event to activity type
  const activityType =
    metadata.event === 'PR_MERGED'
      ? 'GITHUB_PR_MERGED'
      : metadata.event === 'PR_CLOSED'
        ? 'GITHUB_PR_CLOSED'
        : 'GITHUB_PR_OPENED';

  // Create activity log
  await entities.activity.create({
    id: randomUUID(),
    type: activityType,
    projectId: component.projectId,
    userId: projectOwnerId,
    metadata: {
      componentName: component.name,
      componentId: component.id,
      oldStatus,
      newStatus: targetStatus,
      ...metadata,
    },
  }).go();

  // Send notifications to assigned users
  const assignedUserIds = component.assignments.map((a) => a.userId);
  if (assignedUserIds.length > 0) {
    await Promise.all(
      assignedUserIds.map((userId) =>
        runJob({
          type: 'notify',
          userId,
          message: `Component "${component.name}" status changed to ${targetStatus} via GitHub (${metadata.event})`,
          channel: 'in-app',
        }),
      ),
    );
  }

  logger.info('Component status updated from GitHub event', {
    extra: {
      componentId: component.id,
      componentName: component.name,
      event: metadata.event,
      oldStatus,
      newStatus: targetStatus,
      prUrl: metadata.prUrl,
      assignedUsersNotified: assignedUserIds.length,
    },
  });
}
