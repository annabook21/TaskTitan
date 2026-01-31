/**
 * TypeScript Type Definitions for AI Services
 *
 * Shared interfaces and types used across AI generation functions.
 */

// Component Generation Types
export interface GeneratedComponent {
  name: string;
  description: string;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[]; // Names of other components this depends on
  parentName?: string; // Optional name of parent component for hierarchy
  acceptanceCriteria?: string[]; // Testable conditions for completion
}

export interface GeneratedSprint {
  name: string;
  goal: string;
  durationWeeks: number;
  componentNames: string[]; // Names of components to include in this sprint
  capacity?: number; // Suggested capacity in hours
}

// Epic groupings for backlog organization (optional, like Jira's Epic panel)
export interface GeneratedEpic {
  name: string;
  description: string;
  componentNames: string[]; // Names of Stories/Tasks that belong to this epic
}

export interface AIGenerationResult {
  components: GeneratedComponent[];
  summary: string;
  enhancedDescription?: string; // Optional enhanced project description
  sprints?: GeneratedSprint[]; // Sprint plan (required for Scrum, absent for Kanban)
  epics?: GeneratedEpic[]; // Optional epic groupings for backlog organization
  inputTokens?: number;
  outputTokens?: number;
}

// Import Analysis Types
export interface CleanedRow {
  original: Record<string, string>;
  cleaned: Record<string, string>;
  changes: string[];
}

export interface CleanupResult {
  rows: CleanedRow[];
  summary: string;
  totalChanges: number;
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: number;
}

export interface ImportMappingResult {
  mappings: ColumnMapping[];
  detectedFormat: string;
  suggestions: string[];
  warnings: string[];
}

// Sprint Planning Types
export interface SprintPlanningComponent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  estimatedHours: number | null;
  priority: number;
  dependsOn: string[]; // Component names it depends on
}

export interface SprintPlanningResult {
  selectedComponentIds: string[];
  totalHours: number;
  reasoning: string;
  warnings: string[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface SprintSuggestion {
  name: string;
  goal: string;
  recommendedCapacity: number;
  reasoning: string;
}

// Team Capacity Types (industry-standard formula)
export interface TeamCapacityInfo {
  memberCount: number;
  members: Array<{
    name: string;
    title?: string;
    hoursPerDay: number;
    availability: number;
  }>;
  sprintDays: number;
  totalCapacityHours: number;
  // Experience level affects focus factor: NEW=0.6, MODERATE=0.7, EXPERIENCED=0.8
  teamExperience?: 'NEW' | 'MODERATE' | 'EXPERIENCED';
}

// Shape Up Types (Basecamp methodology)
// See: https://basecamp.com/shapeup
export type ShapeUpAppetite = 'SMALL_BATCH' | 'BIG_BATCH';

export interface GeneratedScope {
  name: string;
  description: string;
  // Appetite replaces hour estimates in Shape Up
  // SMALL_BATCH: 1-2 weeks, BIG_BATCH: full 6-week cycle
  appetite: ShapeUpAppetite;
  // Hill chart phase: 0-50 = figuring out, 51-100 = making it happen
  hillPhase?: number;
  priority: number;
  suggestedDependencies?: string[];
}

// Kanban Metrics Types (Little's Law based)
// See: https://getnave.com/blog/kanban-metrics/
export interface KanbanMetrics {
  // Cycle Time = time from started to completed (team perspective)
  averageCycleTimeDays: number;
  // Throughput = items completed per time period
  throughputPerWeek: number;
  // Current WIP = items in progress
  currentWIP: number;
  // Percentile-based forecasting (more accurate than averages)
  percentileEstimates: {
    p50: number; // 50% confidence - half complete faster
    p85: number; // 85% confidence - good planning target
    p95: number; // 95% confidence - worst case buffer
  };
  // Little's Law: Cycle Time = WIP / Throughput
  littlesLawValid: boolean;
}

// Natural Language Types
export interface NaturalLanguageComponentInput {
  userInput: string;
  projectContext?: {
    projectName: string;
    projectDescription: string;
    existingComponents: Array<{ name: string; type: string }>;
  };
  parentComponent?: {
    id: string;
    name: string;
    type: string;
  };
}

export interface NaturalLanguageComponentResult {
  name: string;
  description: string;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  reasoning: string; // Why the AI chose this structure
  acceptanceCriteria?: string[]; // Testable conditions for completion
  inputTokens?: number;
  outputTokens?: number;
}

// Component Breakdown Types
export interface ComponentBreakdownInput {
  component: {
    id: string;
    name: string;
    description: string | null;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  };
  projectContext?: {
    projectName: string;
    relatedComponents: Array<{ name: string; type: string; description: string | null }>;
  };
}

export interface SuggestedChildComponent {
  name: string;
  description: string;
  type: 'FEATURE' | 'STORY' | 'TASK';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  acceptanceCriteria?: string[]; // Testable conditions for completion
}

export interface ComponentBreakdownResult {
  suggestions: SuggestedChildComponent[];
  reasoning: string;
  recommendedApproach: string; // Overall strategy for breaking down the work
}

// Component Template Types
export enum ComponentTemplate {
  CRUD_FEATURE = 'crud_feature',
  REST_API = 'rest_api',
  USER_AUTH = 'user_auth',
  FORM_WITH_VALIDATION = 'form_with_validation',
  DATA_DASHBOARD = 'data_dashboard',
  FILE_UPLOAD = 'file_upload',
  SEARCH_FILTER = 'search_filter',
  NOTIFICATION_SYSTEM = 'notification_system',
  PAYMENT_INTEGRATION = 'payment_integration',
  ADMIN_PANEL = 'admin_panel',
}

export interface ComponentTemplateMetadata {
  id: ComponentTemplate;
  name: string;
  description: string;
  category: 'Backend' | 'Frontend' | 'Full Stack' | 'Integration';
  estimatedHours: number;
  commonUseCase: string;
}

export interface ApplyTemplateInput {
  template: ComponentTemplate;
  customization: {
    entityName: string; // e.g., "Product", "User", "Order"
    projectName: string;
    additionalRequirements?: string; // Optional custom needs
  };
  projectContext?: {
    existingComponents: Array<{ name: string; type: string }>;
    techStack?: string; // e.g., "React + Node.js + PostgreSQL"
  };
}

export interface ApplyTemplateResult {
  components: Array<{
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
  }>;
  implementationNotes: string;
  techStackRecommendations?: string;
}

// Context Summary Types
export interface ComponentContextInput {
  decision: string; // What was decided
  rationale: string; // Why this approach
  alternatives?: string; // Alternatives considered
  componentName: string;
  componentType: string;
}

export interface ComponentContextResult {
  summary: string; // AI-generated summary for future readers
  keyPoints: string[]; // 3-5 key takeaways
  inputTokens: number;
  outputTokens: number;
}

// Wireframe Generation Types
export interface GenerateWireframeInput {
  componentName: string;
  description: string;
  type: string;
  dependencies?: string[];
}

export interface GenerateWireframeResult {
  html: string;
  inputTokens: number;
  outputTokens: number;
}

// Chat Refinement Types
export interface ChatRefinementInput {
  currentComponent: NaturalLanguageComponentResult;
  refinementRequest: string;
  projectContext?: {
    projectName: string;
    projectDescription: string;
    existingComponents: Array<{ name: string; type: string }>;
  };
}

export interface ChatRefinementResult {
  component: NaturalLanguageComponentResult;
  explanation: string;
  suggestedFollowUps: string[];
  inputTokens?: number;
  outputTokens?: number;
}
