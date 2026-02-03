/**
 * React hook for real-time component subscription.
 * Encapsulates subscription logic and provides a publish function for notifying other users.
 */
import { useEffect, useRef, useCallback } from 'react';
import {
  subscribeToComponentChanges,
  publishComponentChange,
  type ComponentChange,
  type ComponentChangeAction,
} from '../api/subscriptions';
import type { Component } from '../api/appsync';

interface UseComponentSubscriptionOptions {
  /** Project ID to subscribe to (subscription won't start if undefined) */
  projectId: string | undefined;
  /** Whether to enable the subscription (e.g., only when authenticated) */
  enabled: boolean;
  /** Called when a component is created by another user */
  onCreated?: (component: Component) => void;
  /** Called when a component is updated by another user */
  onUpdated?: (component: Component) => void;
  /** Called when a component is deleted by another user */
  onDeleted?: (componentId: string) => void;
  /** Called on subscription error */
  onError?: (error: Error) => void;
}

interface UseComponentSubscriptionResult {
  /** Publish a component change to notify other users */
  publish: (componentId: string, action: ComponentChangeAction, component: Component | null) => void;
}

/**
 * Hook for subscribing to real-time component updates.
 *
 * Usage:
 * ```tsx
 * const { publish } = useComponentSubscription({
 *   projectId: id,
 *   enabled: isAuthenticated,
 *   onCreated: (component) => setComponents(prev => [...prev, component]),
 *   onUpdated: (component) => setComponents(prev => prev.map(c => c.id === component.id ? component : c)),
 *   onDeleted: (componentId) => setComponents(prev => prev.filter(c => c.id !== componentId)),
 * });
 *
 * // After mutations:
 * const newComponent = await createComponent(...);
 * publish(newComponent.id, 'CREATED', newComponent);
 * ```
 */
export function useComponentSubscription({
  projectId,
  enabled,
  onCreated,
  onUpdated,
  onDeleted,
  onError,
}: UseComponentSubscriptionOptions): UseComponentSubscriptionResult {
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Store callbacks in refs to avoid re-subscribing on callback changes
  const onCreatedRef = useRef(onCreated);
  const onUpdatedRef = useRef(onUpdated);
  const onDeletedRef = useRef(onDeleted);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onCreatedRef.current = onCreated;
    onUpdatedRef.current = onUpdated;
    onDeletedRef.current = onDeleted;
    onErrorRef.current = onError;
  }, [onCreated, onUpdated, onDeleted, onError]);

  useEffect(() => {
    if (!enabled || !projectId) {
      return;
    }

    console.log('[useComponentSubscription] Subscribing to project:', projectId);

    subscriptionRef.current = subscribeToComponentChanges(
      projectId,
      (change: ComponentChange) => {
        console.log('[useComponentSubscription] Received change:', change);

        switch (change.action) {
          case 'CREATED':
            if (change.component) {
              onCreatedRef.current?.(change.component);
            }
            break;
          case 'UPDATED':
            if (change.component) {
              onUpdatedRef.current?.(change.component);
            }
            break;
          case 'DELETED':
            onDeletedRef.current?.(change.componentId);
            break;
        }
      },
      (error) => {
        console.error('[useComponentSubscription] Error:', error);
        onErrorRef.current?.(error);
      }
    );

    return () => {
      console.log('[useComponentSubscription] Unsubscribing from project:', projectId);
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [projectId, enabled]);

  const publish = useCallback(
    (componentId: string, action: ComponentChangeAction, component: Component | null) => {
      if (projectId) {
        // Fire and forget - don't wait for the publish to complete
        publishComponentChange(projectId, componentId, action, component).catch((err) => {
          console.error('[useComponentSubscription] Failed to publish change:', err);
        });
      }
    },
    [projectId]
  );

  return { publish };
}
