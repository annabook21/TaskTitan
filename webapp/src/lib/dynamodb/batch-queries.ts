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
import { getEntities, type UserItem, type AssignmentItem, type DependencyItem } from './service';

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
    const results = await batchGet(
      uniqueIds.map((id) => ({ pk: `USER#${id}`, sk: 'METADATA' }))
    );

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
 * Batch fetch assignments for multiple components
 * Returns a Map where key is componentId and value is array of assignments
 */
export async function batchFetchAssignmentsByComponents(
  componentIds: string[]
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
    uniqueIds.map((componentId) => assignment.query.primary({ componentId }).go())
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
      uniqueIds.map((componentId) => dependency.query.primary({ dependentComponentId: componentId }).go())
    ),
    // Dependencies where OTHER components depend ON these
    Promise.allSettled(
      uniqueIds.map((componentId) => dependency.query.byRequired({ requiredComponentId: componentId }).go())
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
  componentIds: string[]
): Promise<Map<string, Array<{ id: string; status: string; enteredAt: string; exitedAt?: string }>>> {
  const uniqueIds = [...new Set(componentIds.filter(Boolean))];
  const resultMap = new Map<string, Array<{ id: string; status: string; enteredAt: string; exitedAt?: string }>>();

  if (uniqueIds.length === 0) {
    return resultMap;
  }

  logger.debug('Batch fetching status history for components', { count: uniqueIds.length });

  const { componentStatusHistory } = getEntities();

  const results = await Promise.allSettled(
    uniqueIds.map((componentId) => componentStatusHistory.query.primary({ componentId }).go())
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
    status: string;
    type: string;
    description?: string;
    priority?: number;
    estimatedHours?: number;
    actualHours?: number;
    dueDate?: string;
    sprintId?: string;
    projectId: string;
  }>;
  assignmentsMap: Map<string, AssignmentItem[]>;
  dependenciesMap: { dependsOn: Map<string, DependencyItem[]>; requiredBy: Map<string, DependencyItem[]> };
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
      usersMap: new Map(),
    };
  }

  const componentIds = components.map((c) => c.id);

  // Step 2: Batch fetch assignments and dependencies in parallel
  const [assignmentsMap, dependenciesMap] = await Promise.all([
    batchFetchAssignmentsByComponents(componentIds),
    batchFetchDependencies(componentIds),
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
    usersMap,
  };
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
