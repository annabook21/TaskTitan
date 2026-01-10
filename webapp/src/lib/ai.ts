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
    // Use Claude Sonnet 4.5 via inference profile (cross-region)
    // Inference profiles use "us." prefix for cross-region routing
    const command = new InvokeModelCommand({
      modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
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
        throw new Error('AI features require Bedrock model access. Please enable Claude in the AWS Bedrock console.');
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

/**
 * AI-powered sprint planning: suggests which components to include in a sprint
 * based on capacity, priorities, and dependencies.
 */
export interface SprintSuggestion {
  name: string;
  goal: string;
  recommendedCapacity: number;
  reasoning: string;
}

/**
 * AI-powered sprint suggestion: analyzes backlog to suggest sprint name, goal, and capacity
 */
export async function suggestSprintDetails(
  teamName: string,
  backlogComponents: { name: string; description: string | null; priority: number; estimatedHours: number | null }[],
  sprintNumber: number,
): Promise<SprintSuggestion> {
  const client = getBedrockClient();

  const systemPrompt = `You are a helpful sprint planning assistant. Based on the team's backlog, suggest a meaningful sprint name, goal, and capacity.
Be practical and focused. Sprint names should be memorable and reflect the work (e.g., "Auth & Security Sprint", "UI Polish Week", "API Integration Cycle").
Sprint goals should be specific and achievable (1-2 sentences).
Recommend capacity based on the total estimated hours in the backlog, aiming for 70-80% of available work to fit in a 2-week sprint.

Respond with ONLY valid JSON, no other text.`;

  const backlogSummary = backlogComponents.slice(0, 15).map((c) => ({
    name: c.name,
    description: c.description || '',
    priority: c.priority,
    hours: c.estimatedHours || 0,
  }));

  const totalHours = backlogComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

  const userPrompt = `Team: ${teamName}
Sprint Number: ${sprintNumber}
Total backlog items: ${backlogComponents.length}
Total estimated hours: ${totalHours}

Top priority backlog items:
${JSON.stringify(backlogSummary, null, 2)}

Based on this backlog, suggest:
- "name": A meaningful sprint name (not just "Sprint ${sprintNumber}")
- "goal": A specific, achievable sprint goal (1-2 sentences)
- "recommendedCapacity": Suggested team capacity in hours for a 2-week sprint
- "reasoning": Brief explanation of your suggestions (1 sentence)`;

  try {
    const command = new InvokeModelCommand({
      modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.7,
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    let jsonContent = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1];
    }

    const result = JSON.parse(jsonContent) as SprintSuggestion;

    return {
      name: result.name || `Sprint ${sprintNumber}`,
      goal: result.goal || '',
      recommendedCapacity: result.recommendedCapacity || 80,
      reasoning: result.reasoning || 'AI-generated suggestion',
    };
  } catch (error) {
    console.error('AI sprint suggestion error:', error);
    // Return sensible defaults on error
    return {
      name: `Sprint ${sprintNumber}`,
      goal: 'Complete high-priority backlog items',
      recommendedCapacity: Math.min(80, totalHours),
      reasoning: 'Default suggestion (AI unavailable)',
    };
  }
}

export async function planSprint(
  sprintName: string,
  sprintGoal: string | undefined,
  capacityHours: number,
  availableComponents: SprintPlanningComponent[],
): Promise<SprintPlanningResult> {
  const client = getBedrockClient();

  const systemPrompt = `You are an expert sprint planning assistant helping teams select the right work items for their sprint.
Your job is to analyze available components and select the best subset that:
1. Fits within the sprint capacity (hours)
2. Respects dependencies (don't include something if its dependencies aren't done or included)
3. Prioritizes high-priority items
4. Aligns with the sprint goal if provided

Be practical: aim for 70-80% capacity utilization to leave room for unexpected work.
Flag any risks or concerns as warnings.

Respond with ONLY valid JSON, no other text.`;

  const componentsList = availableComponents.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description || '',
    status: c.status,
    hours: c.estimatedHours || 0,
    priority: c.priority,
    dependsOn: c.dependsOn,
  }));

  const userPrompt = `Sprint: ${sprintName}
${sprintGoal ? `Sprint Goal: ${sprintGoal}` : ''}
Capacity: ${capacityHours} hours

Available Components (not yet in a sprint):
${JSON.stringify(componentsList, null, 2)}

Analyze these components and select which ones should be included in this sprint. Return a JSON object with:
- "selectedComponentIds": array of component IDs to include
- "totalHours": sum of estimated hours for selected components
- "reasoning": brief explanation of your selection strategy (2-3 sentences)
- "warnings": array of any concerns (overcommitment, missing dependencies, blocked items, etc.)`;

  try {
    const command = new InvokeModelCommand({
      modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3, // Lower temperature for more deterministic planning
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse the JSON from Claude's response
    let jsonContent = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1];
    }

    const result = JSON.parse(jsonContent) as SprintPlanningResult;

    // Validate the result
    if (!Array.isArray(result.selectedComponentIds)) {
      result.selectedComponentIds = [];
    }
    if (typeof result.totalHours !== 'number') {
      result.totalHours = 0;
    }
    if (!result.reasoning) {
      result.reasoning = 'AI-generated sprint plan.';
    }
    if (!Array.isArray(result.warnings)) {
      result.warnings = [];
    }

    // Filter to only valid component IDs
    const validIds = new Set(availableComponents.map((c) => c.id));
    result.selectedComponentIds = result.selectedComponentIds.filter((id) => validIds.has(id));

    return result;
  } catch (error) {
    console.error('AI sprint planning error:', error);
    if (error instanceof Error) {
      throw new Error(`AI sprint planning failed: ${error.message}`);
    }
    throw new Error('AI sprint planning failed');
  }
}
