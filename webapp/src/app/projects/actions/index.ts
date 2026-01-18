/**
 * Projects actions barrel export
 *
 * This file provides backward compatibility by re-exporting all actions
 * from their modular locations. Consumer code can continue to import from
 * '@/app/projects/actions' without any changes.
 */

// Project CRUD operations
export { createProject, updateProject, deleteProject } from './project-crud';

// Component CRUD operations
export { createComponent, updateComponent } from './component-crud';

// Dependency management
export { addDependency, removeDependency } from './dependencies';

// Assignment management
export { assignComponent, unassignComponent } from './assignments';

// AI component generation
export { generateAIComponents, applyAIComponents, checkAIStatus, refineBulkAIPlan } from './ai-generation';

// Smart component creation (natural language + refinement)
export { generateSmartComponent, refineSmartComponent, createFromPreview } from './smart-component';

// GitHub integration settings
export { updateProjectGitHubSettings } from './github-settings';
