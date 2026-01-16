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
}

export interface GeneratedSprint {
  name: string;
  goal: string;
  durationWeeks: number;
  componentNames: string[]; // Names of components to include in this sprint
  capacity?: number; // Suggested capacity in hours
}

export interface AIGenerationResult {
  components: GeneratedComponent[];
  summary: string;
  enhancedDescription?: string; // Optional enhanced project description
  sprints?: GeneratedSprint[]; // Optional sprint plan
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
}

export interface SprintSuggestion {
  name: string;
  goal: string;
  recommendedCapacity: number;
  reasoning: string;
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
}
