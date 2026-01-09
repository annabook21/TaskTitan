/**
 * AI Service for TaskTitan
 *
 * Uses Amazon Bedrock with Claude to generate component suggestions based on project descriptions.
 * This keeps everything within AWS - no external API keys needed!
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Lazy-initialize Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });
  }
  return bedrockClient;
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
  const client = getBedrockClient();

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

Respond with ONLY valid JSON, no other text.`;

  const userPrompt = `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Analyze this project and suggest 5-12 components that would be needed to build it. Return a JSON object with:
- "components": array of component objects with { name, description, estimatedHours, priority, suggestedDependencies }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)`;

  try {
    // Use Claude Sonnet 4.5 on Bedrock (latest as of Jan 2026)
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.7,
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Extract text content from Claude's response
    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse the JSON from Claude's response
    // Claude might wrap JSON in markdown code blocks, so we need to extract it
    let jsonContent = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1];
    }

    const result = JSON.parse(jsonContent) as AIGenerationResult;

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
    if (error instanceof Error) {
      // Check for common Bedrock errors
      if (error.name === 'AccessDeniedException') {
        throw new Error(
          'AI features require Bedrock model access. Please enable Claude in the AWS Bedrock console.',
        );
      }
      if (error.name === 'ValidationException') {
        throw new Error('AI request validation failed. Please try again with a shorter description.');
      }
      throw new Error(`AI generation failed: ${error.message}`);
    }
    throw new Error('AI generation failed');
  }
}

/**
 * Checks if AI is available (Bedrock is always available if we have AWS credentials)
 * In Lambda, we always have credentials via the execution role
 */
export function isAIConfigured(): boolean {
  // In Lambda, we always have AWS credentials
  // The real check is whether we have Bedrock model access (handled at runtime)
  return true;
}
