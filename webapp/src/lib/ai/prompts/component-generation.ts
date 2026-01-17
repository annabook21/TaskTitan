/**
 * Component Generation Prompts
 *
 * System and user prompts for AI-powered component generation.
 * Supports workflow-aware generation (Scrum vs Kanban vs custom workflows).
 *
 * KEY DESIGN PRINCIPLE (matches Jira/Linear):
 * - SCRUM: Sprints are PRIMARY. Generate Stories/Tasks that go ON the sprint board.
 *          Epics are OPTIONAL backlog organization (like Jira's Epic panel).
 * - KANBAN: Flat work items with continuous flow. No sprints, no hierarchy.
 */

import type { TeamWorkflowConfig } from '@prisma/client';

/**
 * Build system prompt based on workflow configuration
 */
export function buildSystemPrompt(workflowConfig: TeamWorkflowConfig | null): string {
  const isKanban = !workflowConfig?.cycleEnabled;

  if (isKanban) {
    return `You are an expert software architect helping teams break down projects into components.
Your job is to analyze a project description and suggest logical components that can be developed independently.

This team uses a KANBAN / continuous flow workflow. Create FLAT component structures:
- Focus on independent, deliverable work items
- Avoid deep hierarchies - prefer flatter structures
- Each item should be completable in 1-5 days
- Minimize dependencies between items where possible

Component Types (use these for the "type" field):
- TASK: Independent technical work item (1-4 hours, e.g., "Setup Database Schema", "Configure CI/CD")
- STORY: User-facing functionality (2-8 hours, e.g., "User Login Form", "Product Search")
- BUG: Defect or issue to fix
- FEATURE: Only use for larger items that genuinely need 8+ hours (avoid when possible)

For each component you suggest:
1. Give it a clear, concise name
2. Write a brief description of what it does
3. Assign the correct TYPE (prefer TASK and STORY for most items)
4. Estimate the development hours (keep items small: 1-8 hours ideally)
5. Assign a priority from 1-10 (10 = highest priority)
6. Identify dependencies only when truly necessary

Respond with ONLY valid JSON, no other text.`;
  }

  // SCRUM workflow: Sprint-first approach (like Jira/Linear)
  const cycleName = workflowConfig?.cycleName || 'Sprint';

  return `You are an expert software architect helping teams plan sprint-based development.
Your job is to analyze a project description and create a sprint plan with work items.

This team uses SCRUM with time-boxed ${cycleName.toLowerCase()}s. Your PRIMARY output is ${cycleName.toLowerCase()}s containing work items:

CORE CONCEPT (like Jira):
- ${cycleName.toUpperCase()}S are the primary unit - work is organized INTO ${cycleName.toLowerCase()}s
- STORIES and TASKS go ON the ${cycleName.toLowerCase()} board - these are the actual work
- EPICS are optional backlog organization - they group related Stories but do NOT go in ${cycleName.toLowerCase()}s

Work Item Types (for the "type" field):
- STORY: User-facing functionality (2-8 hours, e.g., "User Login Form", "Product Search Page")
- TASK: Technical work item (1-4 hours, e.g., "Setup Database Schema", "Configure CI/CD")
- BUG: Defect or issue to fix (1-8 hours)

For each work item:
1. Clear, actionable name describing deliverable work
2. Brief description of what needs to be built
3. TYPE: STORY for user-facing, TASK for technical
4. Estimated hours (STORY: 2-8h, TASK: 1-4h)
5. Priority 1-10 (10 = highest)
6. Dependencies on other items (by name)

${cycleName} Planning:
- Create 2-4 ${cycleName.toLowerCase()}s covering the project scope
- Each ${cycleName.toLowerCase()} should have a clear goal
- Group related work items logically
- Respect dependencies - items cannot be in a ${cycleName.toLowerCase()} before their dependencies
- Apply 80% capacity buffer for realistic planning

Respond with ONLY valid JSON, no other text.`;
}

/**
 * Legacy system prompt for backward compatibility
 * @deprecated Use buildSystemPrompt(workflowConfig) instead
 */
export const COMPONENT_GENERATION_SYSTEM_PROMPT = buildSystemPrompt(null);

/**
 * Generates user prompt for component generation
 *
 * @param generateEpics - For Scrum: whether to create optional Epic groupings for backlog organization
 */
export function buildComponentGenerationPrompt(
  projectName: string,
  projectDescription: string,
  existingComponents: string[],
  generateEpics: boolean,
  workflowConfig?: TeamWorkflowConfig | null,
): string {
  const isKanban = workflowConfig ? !workflowConfig.cycleEnabled : false;
  const cycleName = workflowConfig?.cycleName || 'Sprint';

  if (isKanban) {
    // KANBAN: Flat work items, no sprints, no hierarchy
    return `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Create 8-15 independent work items that can flow through your board. Keep items small (1-8 hours) and minimize dependencies.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of work items with { name, description, type, estimatedHours, priority, suggestedDependencies }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)
- "enhancedDescription": an improved, detailed project description (3-4 sentences)

Example format:
<<<JSON
{
  "components": [
    { "name": "Setup Project Structure", "description": "Initialize project with build tools and folder structure", "type": "TASK", "estimatedHours": 2, "priority": 10, "suggestedDependencies": [] },
    { "name": "User Login Form", "description": "Create login page with email/password fields and validation", "type": "STORY", "estimatedHours": 6, "priority": 9, "suggestedDependencies": ["Setup Project Structure"] }
  ],
  "summary": "...",
  "enhancedDescription": "..."
}
JSON>>>`;
  }

  // SCRUM: Sprint-first approach - sprints are ALWAYS generated
  const epicInstructions = generateEpics
    ? `
- "epics": array of epic groupings with { name, description, componentNames }
  * Epics are for BACKLOG ORGANIZATION only (like Jira's Epic panel)
  * Group related Stories/Tasks under thematic Epics
  * componentNames should reference exact names from the components array
  * Epics do NOT go in ${cycleName.toLowerCase()}s - only Stories/Tasks do`
    : '';

  const epicExample = generateEpics
    ? `,
  "epics": [
    { "name": "User Authentication", "description": "All auth-related functionality", "componentNames": ["User Login Form", "User Registration", "Password Reset"] }
  ]`
    : '';

  return `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Create a ${cycleName.toLowerCase()} plan with 8-15 work items organized into 2-4 ${cycleName.toLowerCase()}s.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of work items (Stories/Tasks) with { name, description, type, estimatedHours, priority, suggestedDependencies }
  * Use STORY for user-facing work (2-8 hours)
  * Use TASK for technical work (1-4 hours)
  * Do NOT create EPICs or FEATUREs as components - those are optional groupings
- "sprints": array of 2-4 ${cycleName.toLowerCase()}s with { name, goal, durationWeeks, componentNames, capacity }
  * ${cycleName}s contain the actual work items (Stories/Tasks)
  * Group logically by dependencies and priority
  * Each ${cycleName.toLowerCase()} should be 1-2 weeks
  * Respect dependencies - items cannot be in a ${cycleName.toLowerCase()} before their dependencies
  * Apply 80% capacity buffer: if items total 50 hours, set capacity to 62 (50/0.8)
  * componentNames should reference exact names from the components array
- "summary": brief architecture summary (2-3 sentences)
- "enhancedDescription": improved project description (3-4 sentences)${epicInstructions}

Example format:
<<<JSON
{
  "components": [
    { "name": "User Login Form", "description": "Login page with email/password fields, validation, and error handling", "type": "STORY", "estimatedHours": 6, "priority": 10, "suggestedDependencies": [] },
    { "name": "Setup Database Schema", "description": "Create user tables and indexes for authentication", "type": "TASK", "estimatedHours": 3, "priority": 10, "suggestedDependencies": [] },
    { "name": "User Registration", "description": "Registration form with email verification flow", "type": "STORY", "estimatedHours": 8, "priority": 9, "suggestedDependencies": ["Setup Database Schema"] }
  ],
  "sprints": [
    { "name": "Foundation", "goal": "Set up core infrastructure and authentication", "durationWeeks": 2, "componentNames": ["Setup Database Schema", "User Login Form"], "capacity": 12 },
    { "name": "User Onboarding", "goal": "Complete user registration and onboarding flow", "durationWeeks": 2, "componentNames": ["User Registration"], "capacity": 10 }
  ],
  "summary": "...",
  "enhancedDescription": "..."${epicExample}
}
JSON>>>`;
}
