/**
 * Batch Query Utilities for TaskTitan
 *
 * High-level functions for efficiently fetching related data in bulk,
 * designed to eliminate N+1 query patterns.
 *
 * These utilities use the low-level batch operations from batch-ops.ts
 * and provide type-safe, domain-specific batch fetching.
 *
 * Usage:
 * ```typescript
 * // Fetch all users for a list of assignments
 * const userIds = assignments.map(a => a.userId);
 * const usersMap = await batchFetchUsers(userIds);
 * const user = usersMap.get(assignment.userId);
 * ```
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { batchGet } from './batch-ops';
import {
  getEntities,
  type UserItem,
  type TeamItem,
  type AssignmentItem,
  type DependencyItem,
  type ComponentItem,
  type ProjectItem,
  type SprintItem,
} from './service';

const logger = new Logger({ serviceName: 'BatchQueries' });

/**
 * Batch fetch users by their IDs
 * Returns a Map for O(1) lookup by user ID
 */
export async function batchFetchUsers(userIds: string[]): Promise<Map<string, UserItem>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  logger.debug('Batch fetching users', { count: uniqueIds.length });

  try {
    const results = await batchGet(uniqueIds.map((id) => ({ pk: `USER#${id}`, sk: 'METADATA' })));

    const userMap = new Map<string, UserItem>();
    for (const result of results) {
      if (result.id) {
        userMap.set(result.id as string, result as unknown as UserItem);
      }
    }

    logger.debug('Batch fetch users complete', {
      requested: uniqueIds.length,
      found: userMap.size,
    });

    return userMap;
  } catch (error) {
    logger.error('Batch fetch users failed', { error });
    throw error;
  }
}

/**
 * Batch fetch teams by their IDs
 * Returns a Map for O(1) lookup by team ID
 */
export async function batchFetchTeams(teamIds: string[]): Promise<Map<string, TeamItem>> {
  const uniqueIds = [...new Set(teamIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  logger.debug('Batch fetching teams', { count: uniqueIds.length });

  try {
    const results = await batchGet(uniqueIds.map((id) => ({ pk: `TEAM#${id}`, sk: 'METADATA' })));

    const teamMap = new Map<string, TeamItem>();
    for (const result of results) {
      if (result.id) {
        teamMap.set(result.id as string, result as unknown as TeamItem);
      }
    }

    logger.debug('Batch fetch teams complete', {
      requested: uniqueIds.length,
      found: teamMap.size,
    });

    return teamMap;
  } catch (error) {
    logger.error('Batch fetch teams failed', { error });
    throw error;
  }
}

/**
 * Batch fetch components by their IDs
 * Returns a Map for O(1) lookup by component ID
 */
export async function batchFetchComponents(componentIds: string[]): Promise<Map<string, ComponentItem>> {
  const uniqueIds = [...new Set(componentIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  logger.debug('Batch fetching components', { count: uniqueIds.length });
  try {
    const results = await batchGet(uniqueIds.map((id) => ({ pk: `COMPONENT#${id}`, sk: 'METADATA' })));
    const map = new Map<string, ComponentItem>();
    for (const r of results) {
      if (r.id) map.set(r.id as string, r as unknown as ComponentItem);
    }
    return map;
  } catch (error) {
    logger.error('Batch fetch components failed', { error });
    throw error;
  }
}

/**
 * Batch fetch projects by their IDs
 * Returns a Map for O(1) lookup by project ID
 */
export async function batchFetchProjects(projectIds: string[]): Promise<Map<string, ProjectItem>> {
  const uniqueIds = [...new Set(projectIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  logger.debug('Batch fetching projects', { count: uniqueIds.length });
  try {
    const results = await batchGet(uniqueIds.map((id) => ({ pk: `PROJECT#${id}`, sk: 'METADATA' })));
    const map = new Map<string, ProjectItem>();
    for (const r of results) {
      if (r.id) map.set(r.id as string, r as unknown as ProjectItem);
    }
    return map;
  } catch (error) {
    logger.error('Batch fetch projects failed', { error });
    throw error;
  }
}

/**
 * Batch fetch sprints by their IDs (primary key is SPRINT#id)
 * Returns a Map for O(1) lookup by sprint ID
 */
export async function batchFetchSprints(sprintIds: string[]): Promise<Map<string, SprintItem>> {
  const uniqueIds = [...new Set(sprintIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  logger.debug('Batch fetching sprints', { count: uniqueIds.length });
  try {
    const results = await batchGet(uniqueIds.map((id) => ({ pk: `SPRINT#${id}`, sk: 'METADATA' })));
    const map = new Map<string, SprintItem>();
    for (const r of results) {
      if (r.id) map.set(r.id as string, r as unknown as SprintItem);
    }
    return map;
  } catch (error) {
    logger.error('Batch fetch sprints failed', { error });
    throw error;
  }
}

/**
 * Batch fetch assignments for multiple components
 * Returns a Map where key is componentId and value is array of assignments
 */
export async function batchFetchAssignmentsByComponents(
  componentIds: string[],
): Promise<Map<string, AssignmentItem[]>> {
  const uniqueIds = [...new Set(componentIds.filter(Boolean))];
  const resultMap = new Map<string, AssignmentItem[]>();

  if (uniqueIds.length === 0) {
    return resultMap;
  }

  logger.debug('Batch fetching assignments for components', { count: uniqueIds.length });

  const { assignment } = getEntities();

  // Query assignments for each component in parallel with error handling
  const results = await Promise.allSettled(
    uniqueIds.map((componentId) => assignment.query.primary({ componentId }).go()),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const componentId = uniqueIds[i];

    if (result.status === 'fulfilled') {
      resultMap.set(componentId, result.value.data);
    } else {
      logger.warn('Failed to fetch assignments for component', {
        componentId,
        error: result.reason,
      });
      resultMap.set(componentId, []); // Empty array for failed queries
    }
  }

  logger.debug('Batch fetch assignments complete', {
    components: uniqueIds.length,
    totalAssignments: Array.from(resultMap.values()).reduce((sum, arr) => sum + arr.length, 0),
  });

  return resultMap;
}

/**
 * Batch fetch dependencies for multiple components (both directions)
 * Returns two Maps:
 * - dependsOn: componentId -> array of component IDs this component depends on
 * - requiredBy: componentId -> array of component IDs that depend on this component
 */
export async function batchFetchDependencies(componentIds: string[]): Promise<{
  dependsOn: Map<string, DependencyItem[]>;
  requiredBy: Map<string, DependencyItem[]>;
}> {
  const uniqueIds = [...new Set(componentIds.filter(Boolean))];
  const dependsOn = new Map<string, DependencyItem[]>();
  const requiredBy = new Map<string, DependencyItem[]>();

  if (uniqueIds.length === 0) {
    return { dependsOn, requiredBy };
  }

  logger.debug('Batch fetching dependencies for components', { count: uniqueIds.length });

  const { dependency } = getEntities();

  // Query both directions in parallel
  const [dependsOnResults, requiredByResults] = await Promise.all([
    // Dependencies where these components DEPEND ON others
    Promise.allSettled(
      uniqueIds.map((componentId) => dependency.query.primary({ dependentComponentId: componentId }).go()),
    ),
    // Dependencies where OTHER components depend ON these
    Promise.allSettled(
      uniqueIds.map((componentId) => dependency.query.byRequired({ requiredComponentId: componentId }).go()),
    ),
  ]);

  // Process dependsOn results
  for (let i = 0; i < dependsOnResults.length; i++) {
    const result = dependsOnResults[i];
    const componentId = uniqueIds[i];

    if (result.status === 'fulfilled') {
      dependsOn.set(componentId, result.value.data);
    } else {
      logger.warn('Failed to fetch dependsOn for component', { componentId, error: result.reason });
      dependsOn.set(componentId, []);
    }
  }

  // Process requiredBy results
  for (let i = 0; i < requiredByResults.length; i++) {
    const result = requiredByResults[i];
    const componentId = uniqueIds[i];

    if (result.status === 'fulfilled') {
      requiredBy.set(componentId, result.value.data);
    } else {
      logger.warn('Failed to fetch requiredBy for component', { componentId, error: result.reason });
      requiredBy.set(componentId, []);
    }
  }

  logger.debug('Batch fetch dependencies complete', {
    components: uniqueIds.length,
    totalDependsOn: Array.from(dependsOn.values()).reduce((sum, arr) => sum + arr.length, 0),
    totalRequiredBy: Array.from(requiredBy.values()).reduce((sum, arr) => sum + arr.length, 0),
  });

  return { dependsOn, requiredBy };
}

/**
 * Batch fetch status history for multiple components
 * Returns a Map where key is componentId and value is array of history entries
 */
export async function batchFetchStatusHistory(
  componentIds: string[],
): Promise<Map<string, Array<{ id: string; status: string; enteredAt: string; exitedAt?: string }>>> {
  const uniqueIds = [...new Set(componentIds.filter(Boolean))];
  const resultMap = new Map<string, Array<{ id: string; status: string; enteredAt: string; exitedAt?: string }>>();

  if (uniqueIds.length === 0) {
    return resultMap;
  }

  logger.debug('Batch fetching status history for components', { count: uniqueIds.length });

  const { componentStatusHistory } = getEntities();

  const results = await Promise.allSettled(
    uniqueIds.map((componentId) => componentStatusHistory.query.primary({ componentId }).go()),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const componentId = uniqueIds[i];

    if (result.status === 'fulfilled') {
      resultMap.set(componentId, result.value.data);
    } else {
      logger.warn('Failed to fetch status history for component', { componentId, error: result.reason });
      resultMap.set(componentId, []);
    }
  }

  return resultMap;
}

/**
 * Fetch all data needed for a project detail page in optimized batches
 * This replaces the N+1 pattern where each component triggers multiple queries
 */
export async function fetchProjectDetailData(projectId: string): Promise<{
  components: Array<{
    id: string;
    name: string;
    status: 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    description?: string;
    priority?: number;
    estimatedHours?: number;
    actualHours?: number;
    dueDate?: string;
    sprintId?: string;
    projectId: string;
    parentId?: string;
    owner?: string;
    tags?: string[];
    externalId?: string;
    githubPrUrl?: string;
    githubPrStatus?: string;
    githubPrNumber?: number;
    githubPrTitle?: string;
    githubPrUpdatedAt?: string;
    contextDecision?: string;
    contextRationale?: string;
    contextAlternatives?: string;
    contextLinks?: string[];
    contextAiSummary?: string;
    contextUpdatedAt?: string;
    contextUpdatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  assignmentsMap: Map<string, AssignmentItem[]>;
  dependenciesMap: { dependsOn: Map<string, DependencyItem[]>; requiredBy: Map<string, DependencyItem[]> };
  statusHistoryMap: Map<string, Array<{ id: string; status: string; enteredAt: string; exitedAt?: string }>>;
  usersMap: Map<string, UserItem>;
}> {
  logger.debug('Fetching project detail data', { projectId });

  const { component } = getEntities();

  // Step 1: Fetch all components for the project
  const componentsResult = await component.query.byProject({ projectId }).go();
  const components = componentsResult.data;

  if (components.length === 0) {
    return {
      components: [],
      assignmentsMap: new Map(),
      dependenciesMap: { dependsOn: new Map(), requiredBy: new Map() },
      statusHistoryMap: new Map(),
      usersMap: new Map(),
    };
  }

  const componentIds = components.map((c) => c.id);

  // Step 2: Batch fetch assignments, dependencies, and status history in parallel
  const [assignmentsMap, dependenciesMap, statusHistoryMap] = await Promise.all([
    batchFetchAssignmentsByComponents(componentIds),
    batchFetchDependencies(componentIds),
    batchFetchStatusHistory(componentIds),
  ]);

  // Step 3: Collect unique user IDs from assignments and batch fetch users
  const userIdsSet = new Set<string>();
  for (const assignments of assignmentsMap.values()) {
    for (const assignment of assignments) {
      userIdsSet.add(assignment.userId);
    }
  }

  const usersMap = await batchFetchUsers([...userIdsSet]);

  logger.debug('Project detail data fetched', {
    projectId,
    componentCount: components.length,
    assignmentCount: Array.from(assignmentsMap.values()).reduce((sum, arr) => sum + arr.length, 0),
    userCount: usersMap.size,
  });

  return {
    components,
    assignmentsMap,
    dependenciesMap,
    statusHistoryMap,
    usersMap,
  };
}

/**
 * Get component counts and status breakdown for multiple projects in parallel.
 * Returns a Map: projectId -> { count, componentsByStatus }.
 */
export async function getComponentCountsByProjectIds(
  projectIds: string[],
): Promise<Map<string, { count: number; componentsByStatus: Record<string, number> }>> {
  const uniqueIds = [...new Set(projectIds.filter(Boolean))];
  const resultMap = new Map<string, { count: number; componentsByStatus: Record<string, number> }>();

  if (uniqueIds.length === 0) {
    return resultMap;
  }

  const { component } = getEntities();

  const results = await Promise.allSettled(uniqueIds.map((projectId) => component.query.byProject({ projectId }).go()));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const projectId = uniqueIds[i];
    const componentsByStatus: Record<string, number> = {};

    if (result.status === 'fulfilled') {
      for (const c of result.value.data) {
        const status = c.status || 'PLANNING';
        componentsByStatus[status] = (componentsByStatus[status] || 0) + 1;
      }
      resultMap.set(projectId, {
        count: result.value.data.length,
        componentsByStatus,
      });
    } else {
      logger.warn('Failed to fetch components for project', { projectId, error: result.reason });
      resultMap.set(projectId, { count: 0, componentsByStatus: {} });
    }
  }

  return resultMap;
}

/**
 * Batch fetch previews for multiple components.
 * Returns a Map: componentId -> array of preview items.
 */
export async function batchFetchPreviewsByComponents(
  componentIds: string[],
): Promise<
  Map<string, Array<{ id: string; componentId: string; htmlContent: string; createdAt: string; status: string }>>
> {
  const uniqueIds = [...new Set(componentIds.filter(Boolean))];
  const resultMap = new Map<
    string,
    Array<{ id: string; componentId: string; htmlContent: string; createdAt: string; status: string }>
  >();

  if (uniqueIds.length === 0) {
    return resultMap;
  }

  const { componentPreview } = getEntities();

  const results = await Promise.allSettled(
    uniqueIds.map((componentId) => componentPreview.query.primary({ componentId }).go()),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const componentId = uniqueIds[i];

    if (result.status === 'fulfilled') {
      resultMap.set(
        componentId,
        result.value.data.map((p) => ({
          id: p.id,
          componentId: p.componentId,
          htmlContent: p.htmlContent,
          createdAt: p.createdAt,
          status: p.status,
        })),
      );
    } else {
      logger.warn('Failed to fetch previews for component', { componentId, error: result.reason });
      resultMap.set(componentId, []);
    }
  }

  return resultMap;
}

/**
 * Fetch components with their assignments for a sprint
 * Optimized batch query for sprint pages
 */
export async function fetchSprintComponents(sprintId: string): Promise<{
  components: Array<{
    id: string;
    name: string;
    status: string;
    type: string;
    priority?: number;
    estimatedHours?: number;
    actualHours?: number;
    projectId: string;
  }>;
  assignmentsMap: Map<string, AssignmentItem[]>;
  usersMap: Map<string, UserItem>;
}> {
  logger.debug('Fetching sprint components', { sprintId });

  const { component } = getEntities();

  // Step 1: Fetch all components for the sprint
  const componentsResult = await component.query.bySprint({ sprintId }).go();
  const components = componentsResult.data;

  if (components.length === 0) {
    return {
      components: [],
      assignmentsMap: new Map(),
      usersMap: new Map(),
    };
  }

  const componentIds = components.map((c) => c.id);

  // Step 2: Batch fetch assignments
  const assignmentsMap = await batchFetchAssignmentsByComponents(componentIds);

  // Step 3: Collect unique user IDs and batch fetch users
  const userIdsSet = new Set<string>();
  for (const assignments of assignmentsMap.values()) {
    for (const assignment of assignments) {
      userIdsSet.add(assignment.userId);
    }
  }

  const usersMap = await batchFetchUsers([...userIdsSet]);

  logger.debug('Sprint components fetched', {
    sprintId,
    componentCount: components.length,
    userCount: usersMap.size,
  });

  return {
    components,
    assignmentsMap,
    usersMap,
  };
}
