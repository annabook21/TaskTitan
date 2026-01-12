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

For each component you suggest:
1. Give it a clear, concise name (e.g., "User Authentication", "Product Catalog", "Shopping Cart")
2. Write a brief description of what it does and its responsibilities
3. Estimate the development hours (be realistic: simple components 2-8 hours, medium 8-24 hours, complex 24-80 hours)
4. Assign a priority from 1-10 (10 = highest priority, usually core/foundational components)
5. Identify which other suggested components this depends on (by name)

Consider:
- Frontend components (UI, forms, pages)
- Backend components (API endpoints, services)
- Data layer components (models, database schemas)
- Integration components (third-party services, auth)
- Infrastructure components (deployment, monitoring)

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

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of component objects with { name, description, estimatedHours, priority, suggestedDependencies }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)
- "enhancedDescription": an improved, detailed project description (3-4 sentences) that includes key features, tech stack suggestions, and target users${sprintInstructions}

Example format:
<<<JSON
{
  "components": [...],
  "summary": "...",
  "enhancedDescription": "..."
}
JSON>>>`;
}
