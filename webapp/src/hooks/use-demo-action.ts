'use client';

// Demo-aware action utilities
// Provides helper functions for handling demo mode in client components

import { useAction, useOptimisticAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { demoStore, isDemoMode } from '@/lib/demo';

type DemoActionResult = {
  _demo: true;
  _action: string;
  _input: Record<string, unknown>;
};

/**
 * Check if a result is a demo mode marker
 */
export function isDemoResult(data: unknown): data is DemoActionResult {
  return typeof data === 'object' && data !== null && '_demo' in data && (data as DemoActionResult)._demo === true;
}

/**
 * Execute a demo action locally using the demo store
 */
export function executeDemoAction(action: string, input: Record<string, unknown>): unknown {
  switch (action) {
    // Team actions
    case 'createTeam':
      return { team: demoStore.createTeam(input as Parameters<typeof demoStore.createTeam>[0]) };
    case 'updateTeam':
      return { team: demoStore.updateTeam(input.teamId as string, input) };
    case 'deleteTeam':
      return { success: demoStore.deleteTeam(input.teamId as string) };

    // Project actions
    case 'createProject':
      return { project: demoStore.createProject(input as Parameters<typeof demoStore.createProject>[0]) };
    case 'updateProject':
      return { project: demoStore.updateProject(input.projectId as string, input) };
    case 'deleteProject':
      return { success: demoStore.deleteProject(input.projectId as string) };

    // Component actions
    case 'createComponent':
      return { component: demoStore.createComponent(input as Parameters<typeof demoStore.createComponent>[0]) };
    case 'updateComponent':
      return { component: demoStore.updateComponent(input.componentId as string, input) };
    case 'deleteComponent':
      return { success: demoStore.deleteComponent(input.componentId as string) };

    // Sprint actions
    case 'createSprint':
      return { sprint: demoStore.createSprint(input as Parameters<typeof demoStore.createSprint>[0]) };
    case 'updateSprint':
      return { sprint: demoStore.updateSprint(input.sprintId as string, input) };
    case 'deleteSprint':
      return { success: demoStore.deleteSprint(input.sprintId as string) };
    case 'assignComponentToSprint':
      return {
        component: demoStore.assignComponentToSprint(input.componentId as string, (input.sprintId as string) || null),
      };

    // Assignment actions
    case 'assignComponent':
      return {
        assignment: demoStore.addAssignment(input.componentId as string, input.userId as string),
      };
    case 'unassignComponent':
      return {
        success: demoStore.removeAssignment(input.componentId as string, input.userId as string),
      };

    // Dependency actions
    case 'addDependency':
      return {
        dependency: demoStore.addDependency(
          input.dependentComponentId as string,
          input.requiredComponentId as string,
          input.description as string | undefined,
        ),
      };
    case 'removeDependency':
      return {
        success: demoStore.removeDependency(input.dependentComponentId as string, input.requiredComponentId as string),
      };

    // Workflow config actions
    case 'updateWorkflowConfig':
      return {
        config: demoStore.updateWorkflowConfig(input.teamId as string, input),
      };

    // Import actions
    case 'executeImport':
      return executeImportInDemo(input as unknown as ExecuteImportInput);

    default:
      console.warn(`Unknown demo action: ${action}`);
      return { success: true };
  }
}

/**
 * Input type for executeImport demo action
 */
interface ExecuteImportInput {
  teamId: string;
  projectId?: string;
  projectName?: string;
  mappings: Array<{ sourceColumn: string; targetField: string | null }>;
  rows: Record<string, string>[];
  createMissingParents?: boolean;
  autoAssignSprint?: string;
}

/**
 * Execute import in demo mode - creates components in demo store
 */
function executeImportInDemo(input: ExecuteImportInput) {
  const { teamId, projectId, projectName, mappings, rows, createMissingParents, autoAssignSprint } = input;

  // Create or get project
  let targetProjectId = projectId;
  if (!targetProjectId && projectName) {
    const project = demoStore.createProject({
      name: projectName,
      teamId,
      ownerId: 'demo-user',
    });
    targetProjectId = project.id;
  }

  if (!targetProjectId) {
    return { projectId: null, stats: { created: 0, skipped: 0, errors: ['No project specified'], warnings: [] } };
  }

  // Build mapping lookup
  const fieldMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.targetField) {
      fieldMap.set(m.sourceColumn, m.targetField);
    }
  }

  // Helper to get mapped value
  const getValue = (row: Record<string, string>, field: string): string | undefined => {
    for (const [col, target] of fieldMap.entries()) {
      if (target === field && row[col]) {
        return row[col].trim();
      }
    }
    return undefined;
  };

  // Helper to parse type
  const parseType = (value?: string): 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG' => {
    if (!value) return 'TASK';
    const lower = value.toLowerCase();
    if (lower.includes('epic')) return 'EPIC';
    if (lower.includes('feature')) return 'FEATURE';
    if (lower.includes('story')) return 'STORY';
    if (lower.includes('bug')) return 'BUG';
    return 'TASK';
  };

  // Helper to parse status
  const parseStatus = (value?: string): 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED' => {
    if (!value) return 'PLANNING';
    const lower = value.toLowerCase();
    if (lower.includes('progress') || lower.includes('doing')) return 'IN_PROGRESS';
    if (lower.includes('block')) return 'BLOCKED';
    if (lower.includes('review') || lower.includes('testing')) return 'REVIEW';
    if (lower.includes('done') || lower.includes('complete')) return 'COMPLETED';
    return 'PLANNING';
  };

  // Helper to parse priority
  const parsePriority = (value?: string): number => {
    if (!value) return 0;
    const lower = value.toLowerCase();
    if (lower.includes('critical') || lower.includes('highest')) return 5;
    if (lower.includes('high')) return 4;
    if (lower.includes('medium')) return 3;
    if (lower.includes('low')) return 2;
    if (lower.includes('lowest')) return 1;
    const num = parseInt(value, 10);
    if (!isNaN(num)) return Math.min(5, Math.max(0, num));
    return 0;
  };

  const stats = { created: 0, skipped: 0, errors: [] as string[], warnings: [] as string[] };
  const createdItems = new Map<string, string>(); // name -> id
  const seenNames = new Set<string>();

  // First pass: create components without parents
  for (const row of rows) {
    const name = getValue(row, 'name');
    if (!name || seenNames.has(name)) {
      if (!name) stats.warnings.push('Skipped row with no name');
      else stats.warnings.push(`Skipped duplicate: ${name}`);
      stats.skipped++;
      continue;
    }
    seenNames.add(name);

    const parentName = getValue(row, 'parentName');
    if (parentName) continue; // Handle in second pass

    const component = demoStore.createComponent({
      name,
      description: getValue(row, 'description'),
      type: parseType(getValue(row, 'type')),
      status: parseStatus(getValue(row, 'status')),
      priority: parsePriority(getValue(row, 'priority')),
      estimatedHours: getValue(row, 'estimatedHours') ? parseFloat(getValue(row, 'estimatedHours')!) : undefined,
      projectId: targetProjectId!,
      sprintId: autoAssignSprint,
    });

    createdItems.set(name, component.id);
    stats.created++;
  }

  // Create missing parents if needed
  const missingParents = new Set<string>();
  for (const row of rows) {
    const parentName = getValue(row, 'parentName');
    if (parentName && !createdItems.has(parentName)) {
      missingParents.add(parentName);
    }
  }

  if (createMissingParents) {
    for (const parentName of missingParents) {
      const component = demoStore.createComponent({
        name: parentName,
        type: 'EPIC',
        projectId: targetProjectId!,
        sprintId: autoAssignSprint,
      });
      createdItems.set(parentName, component.id);
      stats.created++;
      stats.warnings.push(`Auto-created parent Epic: "${parentName}"`);
    }
  }

  // Second pass: create components with parents
  seenNames.clear();
  for (const row of rows) {
    const name = getValue(row, 'name');
    if (!name || createdItems.has(name)) continue;

    const parentName = getValue(row, 'parentName');
    if (!parentName) continue;

    const parentId = createdItems.get(parentName);

    const component = demoStore.createComponent({
      name,
      description: getValue(row, 'description'),
      type: parseType(getValue(row, 'type')),
      status: parseStatus(getValue(row, 'status')),
      priority: parsePriority(getValue(row, 'priority')),
      estimatedHours: getValue(row, 'estimatedHours') ? parseFloat(getValue(row, 'estimatedHours')!) : undefined,
      projectId: targetProjectId!,
      parentId,
      sprintId: autoAssignSprint,
    });

    createdItems.set(name, component.id);
    stats.created++;
  }

  return { projectId: targetProjectId, stats };
}

/**
 * Custom event name for demo store updates
 * Client components can listen for this to refresh their data
 */
export const DEMO_STORE_UPDATE_EVENT = 'demo-store-update';

/**
 * Dispatch a demo store update event
 * This is called after executeDemoAction to notify listeners
 */
function dispatchDemoStoreUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DEMO_STORE_UPDATE_EVENT));
  }
}

/**
 * Hook to handle demo action results
 * Use this in onSuccess callbacks to process demo markers
 */
export function useDemoActionHandler() {
  const router = useRouter();

  return {
    handleResult: <T>(data: T | DemoActionResult): T => {
      if (isDemoResult(data)) {
        const localResult = executeDemoAction(data._action, data._input);
        // Notify listeners and refresh
        if (isDemoMode()) {
          dispatchDemoStoreUpdate();
          router.refresh();
        }
        return localResult as T;
      }
      return data;
    },
    isDemoMode: isDemoMode(),
  };
}

// Re-export useAction for convenience
export { useAction, useOptimisticAction };
