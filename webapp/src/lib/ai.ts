/**
 * AI Service for TaskTitan
 *
 * Uses OpenAI's GPT-4o to generate component suggestions based on project descriptions.
 * This helps teams quickly break down their projects into manageable pieces.
 */

import OpenAI from 'openai';

// Lazy-initialize OpenAI client to avoid crashes when API key is not set
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set. AI features are disabled.');
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export interface GeneratedComponent {
  name: string;
  description: string;
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[]; // Names of other components this depends on
}

export interface AIGenerationResult {
  components: GeneratedComponent[];
  summary: string;
}

/**
 * Generates component suggestions for a project based on its description.
 *
 * @param projectName - Name of the project
 * @param projectDescription - Detailed description of the project
 * @param existingComponents - Optional array of existing component names to avoid duplicates
 */
export async function generateComponents(
  projectName: string,
  projectDescription: string,
  existingComponents: string[] = [],
): Promise<AIGenerationResult> {
  // Check if AI is configured first
  if (!isAIConfigured()) {
    throw new Error('AI features are not available. OPENAI_API_KEY is not configured.');
  }

  const openai = getOpenAIClient();

  const systemPrompt = `You are an expert software architect helping teams break down projects into components.
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

Respond in JSON format only.`;

  const userPrompt = `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Analyze this project and suggest 5-12 components that would be needed to build it. Return a JSON object with:
- "components": array of component objects with { name, description, estimatedHours, priority, suggestedDependencies }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const result = JSON.parse(content) as AIGenerationResult;

    // Validate and sanitize the response
    if (!result.components || !Array.isArray(result.components)) {
      throw new Error('Invalid response format: missing components array');
    }

    // Ensure all components have required fields
    result.components = result.components.map((c, index) => ({
      name: c.name || `Component ${index + 1}`,
      description: c.description || '',
      estimatedHours: Math.max(1, Math.min(200, Number(c.estimatedHours) || 8)),
      priority: Math.max(1, Math.min(10, Number(c.priority) || 5)),
      suggestedDependencies: Array.isArray(c.suggestedDependencies) ? c.suggestedDependencies : [],
    }));

    result.summary = result.summary || 'AI-generated component breakdown for your project.';

    return result;
  } catch (error) {
    console.error('AI generation error:', error);
    throw new Error(error instanceof Error ? `AI generation failed: ${error.message}` : 'AI generation failed');
  }
}

/**
 * Checks if the OpenAI API key is configured
 */
export function isAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0;
}
