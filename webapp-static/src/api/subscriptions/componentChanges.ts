/**
 * API functions for real-time component subscriptions.
 * Follows the same pattern as subscribeToAIProgress in appsync.ts.
 */
import { generateClient } from 'aws-amplify/api';
import type { Component } from '../appsync';
import type { ComponentChange, ComponentChangeAction } from './types';
import { PublishComponentChange, OnComponentChange } from './graphql';

// Lazy-initialize client to avoid "Amplify not configured" warning
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
function getClient() {
  if (!_client) {
    _client = generateClient();
  }
  return _client;
}

/**
 * Publish a component change event to notify other users viewing the project.
 * Call this after successful createComponent, updateComponent, or deleteComponent mutations.
 */
export async function publishComponentChange(
  projectId: string,
  componentId: string,
  action: ComponentChangeAction,
  component: Component | null
): Promise<void> {
  // Convert Component to ComponentInput format (remove __typename if present)
  const componentInput = component ? {
    id: component.id,
    name: component.name,
    description: component.description,
    type: component.type,
    projectId: component.projectId,
    parentId: component.parentId,
    sprintId: component.sprintId,
    status: component.status,
    priority: component.priority,
    estimatedHours: component.estimatedHours,
    actualHours: component.actualHours,
    dueDate: component.dueDate,
    owner: component.owner,
    tags: component.tags,
    acceptanceCriteria: component.acceptanceCriteria,
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
    startedAt: component.startedAt,
    hillPhase: component.hillPhase,
  } : null;

  await getClient().graphql({
    query: PublishComponentChange,
    variables: {
      projectId,
      componentId,
      action,
      component: componentInput,
    },
  });
}

/**
 * Subscribe to component changes for a specific project.
 * Returns an object with unsubscribe() method for cleanup.
 */
export function subscribeToComponentChanges(
  projectId: string,
  onComponentChange: (change: ComponentChange) => void,
  onError?: (error: Error) => void
): { unsubscribe: () => void } {
  const subscription = getClient().graphql({
    query: OnComponentChange,
    variables: { projectId },
  });

  // Amplify v6 returns an observable-like object
  const sub = (subscription as {
    subscribe: (opts: {
      next: (data: { data: { onComponentChange: ComponentChange } }) => void;
      error: (err: Error) => void;
    }) => { unsubscribe: () => void };
  }).subscribe({
    next: (data) => {
      const change = data?.data?.onComponentChange;
      if (change) {
        onComponentChange(change);
      }
    },
    error: (err) => {
      console.error('[subscribeToComponentChanges] Subscription error:', err);
      onError?.(err);
    },
  });

  return { unsubscribe: () => sub.unsubscribe() };
}
