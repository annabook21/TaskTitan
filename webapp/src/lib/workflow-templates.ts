/**
 * Workflow Templates
 *
 * Preset configurations for common project management methodologies.
 * Teams can select a template to auto-configure their workflow settings.
 */

export type WorkflowTemplateKey = 'SCRUM' | 'KANBAN' | 'SHAPE_UP' | 'CUSTOM';

export interface WorkflowTemplateSettings {
  cycleEnabled: boolean;
  cycleDurationWeeks?: number;
  cycleStartDayOfWeek?: number;
  cycleName: string;
  backlogName: string;
  enforceEstimates: boolean;
  wipLimitPlanning?: number | null;
  wipLimitInProgress?: number | null;
  wipLimitBlocked?: number | null;
  wipLimitReview?: number | null;
  autoArchiveCompleted: boolean;
}

export interface WorkflowTemplate {
  name: string;
  description: string;
  settings: WorkflowTemplateSettings | null;
}

export const WORKFLOW_TEMPLATES: Record<WorkflowTemplateKey, WorkflowTemplate> = {
  SCRUM: {
    name: 'Scrum',
    description: '2-week sprints with planning and retrospectives',
    settings: {
      cycleEnabled: true,
      cycleDurationWeeks: 2,
      cycleStartDayOfWeek: 1, // Monday
      cycleName: 'Sprint',
      backlogName: 'Backlog',
      enforceEstimates: true,
      wipLimitPlanning: null,
      wipLimitInProgress: null,
      wipLimitBlocked: null,
      wipLimitReview: null,
      autoArchiveCompleted: false,
    },
  },
  KANBAN: {
    name: 'Kanban',
    description: 'Continuous flow with WIP limits, no time-boxed iterations',
    settings: {
      cycleEnabled: false,
      cycleName: 'Cycle',
      backlogName: 'Backlog',
      enforceEstimates: false,
      wipLimitPlanning: null,
      wipLimitInProgress: 3,
      wipLimitBlocked: 2,
      wipLimitReview: 2,
      autoArchiveCompleted: true,
    },
  },
  SHAPE_UP: {
    name: 'Shape Up',
    description: '6-week cycles with 2-week cooldown periods',
    settings: {
      cycleEnabled: true,
      cycleDurationWeeks: 6,
      cycleStartDayOfWeek: 1, // Monday
      cycleName: 'Cycle',
      backlogName: 'Pitches',
      enforceEstimates: false,
      wipLimitPlanning: null,
      wipLimitInProgress: null,
      wipLimitBlocked: null,
      wipLimitReview: null,
      autoArchiveCompleted: false,
    },
  },
  CUSTOM: {
    name: 'Custom',
    description: 'Configure your own workflow settings',
    settings: null, // User configures manually
  },
};

/**
 * Get template settings, returning null for CUSTOM template
 */
export function getTemplateSettings(templateKey: WorkflowTemplateKey): WorkflowTemplateSettings | null {
  return WORKFLOW_TEMPLATES[templateKey]?.settings ?? null;
}
