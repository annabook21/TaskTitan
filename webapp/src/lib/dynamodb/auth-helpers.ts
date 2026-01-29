/**
 * Authorization Helpers for ElectroDB
 *
 * Replaces Prisma's nested authorization filters with explicit ElectroDB queries.
 *
 * Prisma pattern (replaced):
 * ```typescript
 * prisma.project.findFirst({
 *   where: { id, Team: { Membership: { some: { userId } } } }
 * });
 * ```
 *
 * ElectroDB pattern (new):
 * ```typescript
 * const access = await verifyProjectAccess(userId, projectId);
 * if (!access) throw new MyCustomError('Access denied');
 * ```
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { getEntities } from './service';
import type {
  MembershipItem,
  ProjectItem,
  ComponentItem,
  TeamItem,
  SprintItem,
} from './service';

const logger = new Logger({ serviceName: 'AuthHelpers' });

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface TeamAccessResult {
  team: TeamItem;
  membership: MembershipItem;
}

export interface ProjectAccessResult {
  project: ProjectItem;
  team: TeamItem;
  membership: MembershipItem;
}

export interface ComponentAccessResult {
  component: ComponentItem;
  project: ProjectItem;
  team: TeamItem;
  membership: MembershipItem;
}

export interface SprintAccessResult {
  sprint: SprintItem;
  team: TeamItem;
  membership: MembershipItem;
}

/**
 * Verify user has access to a team
 *
 * @param userId - The user's ID
 * @param teamId - The team ID
 * @param requiredRoles - Optional array of roles that grant access
 * @returns Team and membership if access granted, null otherwise
 */
export async function verifyTeamMembership(
  userId: string,
  teamId: string,
  requiredRoles?: MemberRole[]
): Promise<TeamAccessResult | null> {
  const { team, membership } = getEntities();

  try {
    // Query membership by team and user
    const membershipResult = await membership.query
      .primary({ teamId })
      .where(({ userId: memberId }, { eq }) => eq(memberId, userId))
      .go();

    if (!membershipResult.data || membershipResult.data.length === 0) {
      logger.debug('No membership found', { userId, teamId });
      return null;
    }

    const userMembership = membershipResult.data[0];

    // Check role if required
    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(userMembership.role as MemberRole)) {
        logger.debug('Insufficient role', {
          userId,
          teamId,
          userRole: userMembership.role,
          requiredRoles,
        });
        return null;
      }
    }

    // Fetch team data
    const teamResult = await team.get({ id: teamId }).go();
    if (!teamResult.data) {
      logger.debug('Team not found', { teamId });
      return null;
    }

    return {
      team: teamResult.data,
      membership: userMembership,
    };
  } catch (error) {
    logger.error('Error verifying team membership', { userId, teamId, error });
    throw error;
  }
}

/**
 * Verify user has access to a project through team membership
 *
 * @param userId - The user's ID
 * @param projectId - The project ID
 * @param requiredRoles - Optional array of roles that grant access
 * @returns Project, team, and membership if access granted, null otherwise
 */
export async function verifyProjectAccess(
  userId: string,
  projectId: string,
  requiredRoles?: MemberRole[]
): Promise<ProjectAccessResult | null> {
  const { project } = getEntities();

  try {
    // First, get the project to find its team
    const projectResult = await project.get({ id: projectId }).go();
    if (!projectResult.data) {
      logger.debug('Project not found', { projectId });
      return null;
    }

    const projectData = projectResult.data;

    // Verify team membership
    const teamAccess = await verifyTeamMembership(userId, projectData.teamId, requiredRoles);
    if (!teamAccess) {
      return null;
    }

    return {
      project: projectData,
      team: teamAccess.team,
      membership: teamAccess.membership,
    };
  } catch (error) {
    logger.error('Error verifying project access', { userId, projectId, error });
    throw error;
  }
}

/**
 * Verify user has access to a component through project and team membership
 *
 * @param userId - The user's ID
 * @param componentId - The component ID
 * @param requiredRoles - Optional array of roles that grant access
 * @returns Component, project, team, and membership if access granted, null otherwise
 */
export async function verifyComponentAccess(
  userId: string,
  componentId: string,
  requiredRoles?: MemberRole[]
): Promise<ComponentAccessResult | null> {
  const { component } = getEntities();

  try {
    // First, get the component to find its project
    const componentResult = await component.get({ id: componentId }).go();
    if (!componentResult.data) {
      logger.debug('Component not found', { componentId });
      return null;
    }

    const componentData = componentResult.data;

    // Verify project access (which verifies team membership)
    const projectAccess = await verifyProjectAccess(userId, componentData.projectId, requiredRoles);
    if (!projectAccess) {
      return null;
    }

    return {
      component: componentData,
      project: projectAccess.project,
      team: projectAccess.team,
      membership: projectAccess.membership,
    };
  } catch (error) {
    logger.error('Error verifying component access', { userId, componentId, error });
    throw error;
  }
}

/**
 * Verify user has access to a sprint through team membership
 *
 * @param userId - The user's ID
 * @param sprintId - The sprint ID
 * @param requiredRoles - Optional array of roles that grant access
 * @returns Sprint, team, and membership if access granted, null otherwise
 */
export async function verifySprintAccess(
  userId: string,
  sprintId: string,
  requiredRoles?: MemberRole[]
): Promise<SprintAccessResult | null> {
  const { sprint } = getEntities();

  try {
    // First, get the sprint to find its team
    const sprintResult = await sprint.get({ id: sprintId }).go();
    if (!sprintResult.data) {
      logger.debug('Sprint not found', { sprintId });
      return null;
    }

    const sprintData = sprintResult.data;

    // Verify team membership
    const teamAccess = await verifyTeamMembership(userId, sprintData.teamId, requiredRoles);
    if (!teamAccess) {
      return null;
    }

    return {
      sprint: sprintData,
      team: teamAccess.team,
      membership: teamAccess.membership,
    };
  } catch (error) {
    logger.error('Error verifying sprint access', { userId, sprintId, error });
    throw error;
  }
}

/**
 * Check if user is team owner
 */
export async function isTeamOwner(userId: string, teamId: string): Promise<boolean> {
  const access = await verifyTeamMembership(userId, teamId, ['OWNER']);
  return access !== null;
}

/**
 * Check if user is team admin or owner
 */
export async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const access = await verifyTeamMembership(userId, teamId, ['OWNER', 'ADMIN']);
  return access !== null;
}

/**
 * Check if user can edit in team (owner, admin, or member)
 */
export async function canEditInTeam(userId: string, teamId: string): Promise<boolean> {
  const access = await verifyTeamMembership(userId, teamId, ['OWNER', 'ADMIN', 'MEMBER']);
  return access !== null;
}

/**
 * Get all team IDs a user has access to
 */
export async function getUserTeamIds(userId: string): Promise<string[]> {
  const { membership } = getEntities();

  try {
    const result = await membership.query.byUser({ userId }).go();
    return result.data.map((m) => m.teamId);
  } catch (error) {
    logger.error('Error getting user team IDs', { userId, error });
    throw error;
  }
}

/**
 * Get all project IDs a user has access to
 * Uses Promise.allSettled to handle partial failures gracefully
 */
export async function getUserProjectIds(userId: string): Promise<string[]> {
  const { project } = getEntities();

  // First get all team IDs
  const teamIds = await getUserTeamIds(userId);

  if (teamIds.length === 0) {
    return [];
  }

  // Query projects for each team - use allSettled to continue if some fail
  const projectPromises = teamIds.map((teamId) => project.query.byTeam({ teamId }).go());

  const results = await Promise.allSettled(projectPromises);
  const projectIds: string[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      projectIds.push(...result.value.data.map((p) => p.id));
    } else {
      // Log failure but continue with other teams
      logger.warn('Failed to fetch projects for team', { userId, error: result.reason });
    }
  }

  return projectIds;
}

/**
 * Batch verify access to multiple components
 * More efficient than calling verifyComponentAccess for each
 */
export async function batchVerifyComponentAccess(
  userId: string,
  componentIds: string[],
  requiredRoles?: MemberRole[]
): Promise<Map<string, ComponentAccessResult>> {
  const { component, project } = getEntities();
  const results = new Map<string, ComponentAccessResult>();

  if (componentIds.length === 0) {
    return results;
  }

  // Get all components - use allSettled to handle partial failures gracefully
  const componentResults = await Promise.allSettled(componentIds.map((id) => component.get({ id }).go()));

  // Group by project
  const projectComponentMap = new Map<string, ComponentItem[]>();
  for (let i = 0; i < componentResults.length; i++) {
    const result = componentResults[i];
    if (result.status === 'fulfilled' && result.value.data) {
      const comp = result.value.data;
      const existing = projectComponentMap.get(comp.projectId) || [];
      existing.push(comp);
      projectComponentMap.set(comp.projectId, existing);
    } else if (result.status === 'rejected') {
      logger.warn('Failed to fetch component', { componentId: componentIds[i], error: result.reason });
    }
  }

  // Verify access to each project
  for (const [projectId, components] of projectComponentMap) {
    const access = await verifyProjectAccess(userId, projectId, requiredRoles);
    if (access) {
      for (const comp of components) {
        results.set(comp.id, {
          component: comp,
          project: access.project,
          team: access.team,
          membership: access.membership,
        });
      }
    }
  }

  return results;
}
