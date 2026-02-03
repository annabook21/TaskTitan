/**
 * Chat Refinement Generator
 *
 * AI-powered conversational refinement for component creation.
 * Allows users to iteratively improve a generated component through chat.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import { logger } from '@/lib/logger';
import type { ChatRefinementInput, ChatRefinementResult, NaturalLanguageComponentResult } from '../types';

const CHAT_REFINEMENT_SYSTEM_PROMPT = `You are an expert software architect helping refine work items through conversation, following agile best practices.

You're given a component that was generated from a user's natural language input, and the user wants to modify it.

Your job is to:
1. Understand what the user wants to change
2. Apply those changes following INVEST criteria (Independent, Negotiable, Valuable, Estimable, Small, Testable)
3. Ensure the component has clear acceptance criteria
4. Explain what you changed and why (1-2 sentences)
5. Suggest 2-3 follow-up refinements they might want

Component types and sizing:
- EPIC: Large initiative (40-200 hours, spans months)
- FEATURE: Distinct capability (16-40 hours, 1-3 sprints)
- STORY: User-facing change (2-16 hours, fits in one sprint)
- TASK: Technical work item (1-8 hours)
- BUG: Defect to fix (1-16 hours)

Naming conventions:
- STORY/TASK: Verb-first, action-oriented (e.g., "Enable User Login", "Configure Database")
- EPIC/FEATURE: Can be noun-based (e.g., "User Authentication System")

Be helpful and direct. If the request is unclear, make your best interpretation and explain your reasoning.`;

function buildChatRefinementPrompt(input: ChatRefinementInput): string {
  const contextInfo = input.projectContext
    ? `
Project: ${input.projectContext.projectName}
Description: ${input.projectContext.projectDescription}

Existing Components:
${input.projectContext.existingComponents.map((c) => `- ${c.name} (${c.type})`).join('\n')}`
    : '';

  const acceptanceCriteriaInfo = input.currentComponent.acceptanceCriteria?.length
    ? `Acceptance Criteria: ${input.currentComponent.acceptanceCriteria.join('; ')}`
    : 'Acceptance Criteria: None defined';

  return `Current Component:
Name: ${input.currentComponent.name}
Type: ${input.currentComponent.type}
Description: ${input.currentComponent.description}
Estimated Hours: ${input.currentComponent.estimatedHours}
Priority: ${input.currentComponent.priority}
Dependencies: ${input.currentComponent.suggestedDependencies.length > 0 ? input.currentComponent.suggestedDependencies.join(', ') : 'None'}
${acceptanceCriteriaInfo}
Original Reasoning: ${input.currentComponent.reasoning}
${contextInfo}

User's refinement request: "${input.refinementRequest}"

Apply the requested changes and return the updated component.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "component": The updated component object with all fields (name, description, type, estimatedHours, priority, suggestedDependencies, acceptanceCriteria, reasoning)
- "explanation": A brief explanation of what you changed (1-2 sentences)
- "suggestedFollowUps": Array of 2-3 suggested follow-up refinements as short phrases

Example format:
<<<JSON
{
  "component": {
    "name": "Enable User Login with OAuth",
    "description": "Implements user authentication supporting email/password and OAuth providers (Google, GitHub). Provides secure access to personal data and enables personalized features.",
    "type": "FEATURE",
    "estimatedHours": 16,
    "priority": 8,
    "suggestedDependencies": [],
    "acceptanceCriteria": [
      "User can log in with email/password",
      "User can log in with Google OAuth",
      "User can log in with GitHub OAuth",
      "Invalid credentials show clear error message"
    ],
    "reasoning": "Updated to include OAuth integration per user request, increasing scope to FEATURE."
  },
  "explanation": "I added OAuth provider support and increased the estimate from 8 to 16 hours.",
  "suggestedFollowUps": [
    "Add two-factor authentication",
    "Include password reset flow",
    "Add remember me functionality"
  ]
}
JSON>>>`;
}

/**
 * Refine a component through conversational chat
 */
export async function refineComponentWithChat(input: ChatRefinementInput): Promise<ChatRefinementResult> {
  const client = getBedrockClient();

  const userPrompt = buildChatRefinementPrompt(input);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1500,
        system: CHAT_REFINEMENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.4,
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as ChatRefinementResult;

    // Validate and sanitize the component
    const validTypes = ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'];
    if (!validTypes.includes(result.component.type)) {
      result.component.type = 'TASK';
    }

    result.component.estimatedHours = Math.max(1, Math.min(200, Number(result.component.estimatedHours) || 8));
    result.component.priority = Math.max(1, Math.min(10, Number(result.component.priority) || 5));
    // Filter out null/undefined values - GraphQL [String!] requires non-null elements
    result.component.suggestedDependencies = (
      Array.isArray(result.component.suggestedDependencies) ? result.component.suggestedDependencies : []
    ).filter((s): s is string => typeof s === 'string' && s.length > 0);
    result.component.acceptanceCriteria = (
      Array.isArray(result.component.acceptanceCriteria) ? result.component.acceptanceCriteria.slice(0, 4) : []
    ).filter((s): s is string => typeof s === 'string' && s.length > 0);
    result.suggestedFollowUps = (
      Array.isArray(result.suggestedFollowUps) ? result.suggestedFollowUps.slice(0, 3) : []
    ).filter((s): s is string => typeof s === 'string' && s.length > 0);

    // Ensure we have an explanation
    if (!result.explanation) {
      result.explanation = 'Component updated based on your request.';
    }

    return result;
  } catch (error) {
    logger.error('Chat refinement error', { error });
    if (error instanceof Error) {
      throw new Error(`Refinement failed: ${error.message}`);
    }
    throw new Error('Refinement failed');
  }
}

/**
 * Generate initial suggested follow-ups for a newly created component
 * This is used when showing the preview for the first time
 */
export function generateInitialSuggestions(component: NaturalLanguageComponentResult): string[] {
  const suggestions: string[] = [];

  // Type-based suggestions
  if (component.type === 'EPIC' || component.type === 'FEATURE') {
    suggestions.push('Break this down into smaller tasks');
  }

  // Estimate-based suggestions
  if (component.estimatedHours > 40) {
    suggestions.push('Reduce the scope');
  } else if (component.estimatedHours < 4) {
    suggestions.push('Add more detail');
  }

  // Priority-based suggestions
  if (component.priority < 5) {
    suggestions.push('Increase priority');
  }

  // Generic suggestions if we don't have enough
  const genericSuggestions = [
    'Add acceptance criteria',
    'Clarify the requirements',
    'Change the component type',
    'Adjust the estimate',
    'Add dependencies',
  ];

  while (suggestions.length < 3) {
    const next = genericSuggestions.shift();
    if (next && !suggestions.includes(next)) {
      suggestions.push(next);
    } else {
      break;
    }
  }

  return suggestions.slice(0, 3);
}
