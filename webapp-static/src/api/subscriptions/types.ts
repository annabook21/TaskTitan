/**
 * Types for real-time component subscriptions.
 */
import type { Component } from '../appsync';

export type ComponentChangeAction = 'CREATED' | 'UPDATED' | 'DELETED';

export type ComponentChange = {
  projectId: string;
  componentId: string;
  action: ComponentChangeAction;
  /** Full component data (null for DELETED action) */
  component: Component | null;
};
