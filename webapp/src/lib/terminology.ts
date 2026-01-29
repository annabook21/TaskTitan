/**
 * Terminology Utilities
 *
 * Helpers for dynamic workflow terminology based on team configuration.
 * Allows teams to use "Sprint", "Cycle", "Iteration", etc. based on their preference.
 */

import type { TeamWorkflowConfig } from '@/lib/prisma-compat';

export interface WorkflowTerminology {
  /** Singular form: "Sprint", "Cycle", "Iteration" */
  cycle: string;
  /** Plural form: "Sprints", "Cycles", "Iterations" */
  cycles: string;
  /** Backlog name: "Backlog", "Icebox", "Pitches" */
  backlog: string;
}

/**
 * Get terminology based on team's workflow configuration
 *
 * @param config - Team's workflow configuration (can be null for defaults)
 * @returns Object with cycle, cycles, and backlog terminology
 *
 * @example
 * const terms = getTerminology(workflowConfig);
 * // For Scrum: { cycle: "Sprint", cycles: "Sprints", backlog: "Backlog" }
 * // For Shape Up: { cycle: "Cycle", cycles: "Cycles", backlog: "Pitches" }
 */
export function getTerminology(config: TeamWorkflowConfig | null): WorkflowTerminology {
  const cycleName = config?.cycleName || 'Sprint';
  const backlogName = config?.backlogName || 'Backlog';

  return {
    cycle: cycleName,
    cycles: `${cycleName}s`,
    backlog: backlogName,
  };
}

/**
 * Available cycle name options for the settings form
 */
export const CYCLE_NAME_OPTIONS = [
  { value: 'Sprint', label: 'Sprint', description: 'Traditional Scrum terminology' },
  { value: 'Cycle', label: 'Cycle', description: 'Generic term for any methodology' },
  { value: 'Iteration', label: 'Iteration', description: 'SAFe and enterprise terminology' },
  { value: 'Batch', label: 'Batch', description: 'Shape Up terminology' },
] as const;

/**
 * Available backlog name options for the settings form
 */
export const BACKLOG_NAME_OPTIONS = [
  { value: 'Backlog', label: 'Backlog', description: 'Standard prioritized work list' },
  { value: 'Icebox', label: 'Icebox', description: 'Low priority or future ideas' },
  { value: 'Pitches', label: 'Pitches', description: 'Shape Up pitch documents' },
  { value: 'Ideas', label: 'Ideas', description: 'Informal idea collection' },
] as const;
