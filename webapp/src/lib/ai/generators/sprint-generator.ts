/**
 * Sprint Generator
 *
 * AI-powered sprint planning and suggestions.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import {
  SPRINT_SUGGESTION_SYSTEM_PROMPT,
  SPRINT_PLANNING_SYSTEM_PROMPT,
  buildSprintSuggestionPrompt,
  buildSprintPlanningPrompt,
} from '../prompts/sprint-planning';
import type { SprintSuggestion, SprintPlanningResult, SprintPlanningComponent } from '../types';

/**
 * AI-powered sprint suggestion: analyzes backlog to suggest sprint name, goal, and capacity
 */
export async function suggestSprintDetails(
  teamName: string,
  backlogComponents: { name: string; description: string | null; priority: number; estimatedHours: number | null }[],
  sprintNumber: number,
): Promise<SprintSuggestion> {
  const client = getBedrockClient();

  const userPrompt = buildSprintSuggestionPrompt(teamName, backlogComponents, sprintNumber);
  const totalHours = backlogComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: SPRINT_SUGGESTION_SYSTEM_PROMPT,
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

    const jsonContent = extractJsonFromResponse(content);
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

/**
 * AI-powered sprint planning: suggests which components to include in a sprint
 * based on capacity, priorities, and dependencies.
 */
export async function planSprint(
  sprintName: string,
  sprintGoal: string | undefined,
  capacityHours: number,
  availableComponents: SprintPlanningComponent[],
): Promise<SprintPlanningResult> {
  const client = getBedrockClient();

  const userPrompt = buildSprintPlanningPrompt(sprintName, sprintGoal, capacityHours, availableComponents);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: SPRINT_PLANNING_SYSTEM_PROMPT,
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
    const jsonContent = extractJsonFromResponse(content);
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
