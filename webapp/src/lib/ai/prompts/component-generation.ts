/**
 * Component Generation Prompts
 *
 * System and user prompts for AI-powered component generation.
 */

/**
 * System prompt for component generation
 */
export const COMPONENT_GENERATION_SYSTEM_PROMPT = `You are an expert software architect helping teams break down projects into components.
Your job is to analyze a project description and suggest logical components that can be developed independently.

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

/**
 * Generates user prompt for component generation
 */
export function buildComponentGenerationPrompt(
  projectName: string,
  projectDescription: string,
  existingComponents: string[],
  generateSprints: boolean,
): string {
  const sprintInstructions = generateSprints
    ? `
- "sprints": array of 2-4 sprint objects with { name, goal, durationWeeks, componentNames, capacity }
  * Group components logically by dependencies and priority
  * Early sprints should focus on foundational/high-priority components
  * Later sprints build on earlier work
  * Each sprint should be 1-2 weeks
  * IMPORTANT: Respect dependencies - a component cannot be in a sprint before its dependencies
  * IMPORTANT: Apply 80% capacity buffer - if sprint components total 50 hours, set capacity to 62 hours (50/0.8)
  * This buffer accounts for meetings, code review, testing, and unexpected issues
  * Capacity calculation: sum of component estimatedHours divided by 0.8 (80% utilization)
  * componentNames should reference the exact component names from the components array`
    : '';

  return `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Analyze this project and suggest 5-12 components that would be needed to build it.
Create a logical hierarchy where possible (EPIC → FEATURE → STORY).

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of component objects with { name, description, type, estimatedHours, priority, suggestedDependencies, parentName? }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)
- "enhancedDescription": an improved, detailed project description (3-4 sentences) that includes key features, tech stack suggestions, and target users${sprintInstructions}

Example format:
<<<JSON
{
  "components": [
    { "name": "User Management", "description": "...", "type": "EPIC", "estimatedHours": 40, "priority": 9, "suggestedDependencies": [] },
    { "name": "User Registration", "description": "...", "type": "FEATURE", "estimatedHours": 12, "priority": 9, "suggestedDependencies": [], "parentName": "User Management" },
    { "name": "Email Verification", "description": "...", "type": "STORY", "estimatedHours": 4, "priority": 8, "suggestedDependencies": ["User Registration"], "parentName": "User Registration" }
  ],
  "summary": "...",
  "enhancedDescription": "..."
}
JSON>>>`;
}
