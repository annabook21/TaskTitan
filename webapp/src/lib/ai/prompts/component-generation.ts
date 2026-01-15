/**
 * Component Generation Prompts
 *
 * System and user prompts for AI-powered component generation.
 * Supports workflow-aware generation (Scrum vs Kanban vs custom workflows).
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

  // Default: Scrum/hierarchical workflow
  return `You are an expert software architect helping teams break down projects into components.
Your job is to analyze a project description and suggest logical components that can be developed independently.

This team uses time-boxed iterations. Create HIERARCHICAL component structures:
- EPIC for large initiatives spanning multiple features
- FEATURE within epics for significant functionality
- STORY for specific user-facing work
- TASK for technical work items

Component Types (use these for the "type" field):
- EPIC: Large initiative spanning multiple features (20-80+ hours, e.g., "User Management System", "Payment Processing")
- FEATURE: Significant feature within an epic (8-24 hours, e.g., "OAuth Integration", "Shopping Cart")
- STORY: Specific user-facing functionality (2-8 hours, e.g., "User Login Form", "Product Search")
- TASK: Technical work item (1-4 hours, e.g., "Setup Database Schema", "Configure AWS S3")
- BUG: Defect or issue to fix

For each component you suggest:
1. Give it a clear, concise name (e.g., "User Authentication", "Product Catalog", "Shopping Cart")
2. Write a brief description of what it does and its responsibilities
3. Assign the correct TYPE based on scope (EPIC for large initiatives, FEATURE for significant features, STORY for specific functionality)
4. Estimate the development hours (be realistic: TASK 1-4h, STORY 2-8h, FEATURE 8-24h, EPIC 20-80h)
5. Assign a priority from 1-10 (10 = highest priority, usually core/foundational components)
6. Identify which other suggested components this depends on (by name)
7. Optionally specify parentName to create hierarchy (e.g., STORY has parentName pointing to FEATURE)

Consider:
- Frontend components (UI, forms, pages) - usually STORY or FEATURE level
- Backend components (API endpoints, services) - usually FEATURE level
- Data layer components (models, database schemas) - usually TASK or FEATURE level
- Integration components (third-party services, auth) - usually FEATURE or EPIC level
- Infrastructure components (deployment, monitoring) - usually TASK level

Respond with ONLY valid JSON, no other text.`;
}

/**
 * Legacy system prompt for backward compatibility
 * @deprecated Use buildSystemPrompt(workflowConfig) instead
 */
export const COMPONENT_GENERATION_SYSTEM_PROMPT = buildSystemPrompt(null);

/**
 * Generates user prompt for component generation
 */
export function buildComponentGenerationPrompt(
  projectName: string,
  projectDescription: string,
  existingComponents: string[],
  generateCycles: boolean,
  workflowConfig?: TeamWorkflowConfig | null,
): string {
  const isKanban = workflowConfig ? !workflowConfig.cycleEnabled : false;
  const cycleName = workflowConfig?.cycleName || 'Sprint';

  // Don't generate cycles for Kanban teams
  const shouldGenerateCycles = generateCycles && !isKanban;

  const cycleInstructions = shouldGenerateCycles
    ? `
- "${cycleName.toLowerCase()}s": array of 2-4 ${cycleName.toLowerCase()} objects with { name, goal, durationWeeks, componentNames, capacity }
  * Group components logically by dependencies and priority
  * Early ${cycleName.toLowerCase()}s should focus on foundational/high-priority components
  * Later ${cycleName.toLowerCase()}s build on earlier work
  * Each ${cycleName.toLowerCase()} should be 1-2 weeks
  * IMPORTANT: Respect dependencies - a component cannot be in a ${cycleName.toLowerCase()} before its dependencies
  * IMPORTANT: Apply 80% capacity buffer - if ${cycleName.toLowerCase()} components total 50 hours, set capacity to 62 hours (50/0.8)
  * This buffer accounts for meetings, code review, testing, and unexpected issues
  * Capacity calculation: sum of component estimatedHours divided by 0.8 (80% utilization)
  * componentNames should reference the exact component names from the components array`
    : '';

  const structureGuidance = isKanban
    ? 'Create 8-15 independent work items that can flow through your board. Keep items small (1-8 hours) and minimize dependencies.'
    : 'Analyze this project and suggest 5-12 components that would be needed to build it.\nCreate a logical hierarchy where possible (EPIC → FEATURE → STORY).';

  return `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

${structureGuidance}

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of component objects with { name, description, type, estimatedHours, priority, suggestedDependencies${isKanban ? '' : ', parentName?'} }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)
- "enhancedDescription": an improved, detailed project description (3-4 sentences) that includes key features, tech stack suggestions, and target users${cycleInstructions}

Example format:
<<<JSON
{
  "components": [
    ${
      isKanban
        ? `{ "name": "Setup Project Structure", "description": "...", "type": "TASK", "estimatedHours": 2, "priority": 10, "suggestedDependencies": [] },
    { "name": "User Login", "description": "...", "type": "STORY", "estimatedHours": 6, "priority": 9, "suggestedDependencies": ["Setup Project Structure"] }`
        : `{ "name": "User Management", "description": "...", "type": "EPIC", "estimatedHours": 40, "priority": 9, "suggestedDependencies": [] },
    { "name": "User Registration", "description": "...", "type": "FEATURE", "estimatedHours": 12, "priority": 9, "suggestedDependencies": [], "parentName": "User Management" },
    { "name": "Email Verification", "description": "...", "type": "STORY", "estimatedHours": 4, "priority": 8, "suggestedDependencies": ["User Registration"], "parentName": "User Registration" }`
    }
  ],
  "summary": "...",
  "enhancedDescription": "..."
}
JSON>>>`;
}
