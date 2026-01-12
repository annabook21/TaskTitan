/**
 * AI Service for TaskTitan
 *
 * Uses Amazon Bedrock with Claude to generate component suggestions based on project descriptions.
 * This keeps everything within AWS - no external API keys needed!
 *
 * This is the main barrel export file that maintains backward compatibility
 * with the original monolithic ai.ts file.
 */

// Configuration
export { MODEL_ID, isAIConfigured } from './config';

// Type Exports
export type {
  GeneratedComponent,
  GeneratedSprint,
  AIGenerationResult,
  CleanedRow,
  CleanupResult,
  ColumnMapping,
  ImportMappingResult,
  SprintPlanningComponent,
  SprintPlanningResult,
  SprintSuggestion,
  NaturalLanguageComponentInput,
  NaturalLanguageComponentResult,
  ComponentBreakdownInput,
  SuggestedChildComponent,
  ComponentBreakdownResult,
  ApplyTemplateInput,
  ApplyTemplateResult,
  ComponentContextInput,
  ComponentContextResult,
  GenerateWireframeInput,
  GenerateWireframeResult,
  ComponentTemplateMetadata,
} from './types';

// Enum Exports
export { ComponentTemplate } from './types';

// Generator Functions
export { generateComponents } from './generators/component-generator';
export { suggestSprintDetails, planSprint } from './generators/sprint-generator';
export { summarizeComponentContext } from './generators/context-generator';
export { generateWireframe } from './generators/wireframe-generator';
export { cleanupImportData, analyzeImportData } from './generators/import-generator';
export { suggestComponentBreakdown } from './generators/breakdown-generator';
export { createComponentFromNaturalLanguage } from './generators/natural-language-generator';
export { applyComponentTemplate, COMPONENT_TEMPLATES } from './generators/template-generator';
