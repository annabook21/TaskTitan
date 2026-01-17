/**
 * Breakdown Generator
 *
 * AI-powered component breakdown suggestions for hierarchical work decomposition.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import { buildBreakdownSystemPrompt, getBreakdownSystemPrompt, buildBreakdownPrompt } from '../prompts/breakdown';
import { logger } from '@/lib/logger';
import type { ComponentBreakdownInput, ComponentBreakdownResult } from '../types';

/**
 * Smart breakdown suggestions
 * When viewing an Epic, suggests Feature breakdowns
 * When viewing a Feature, suggests Story implementations
 */
export async function suggestComponentBreakdown(input: ComponentBreakdownInput): Promise<ComponentBreakdownResult> {
  const client = getBedrockClient();

  // Determine target type based on parent
  const { targetType, guidance } = buildBreakdownSystemPrompt(input.component.type);
  const systemPrompt = getBreakdownSystemPrompt(targetType, guidance);
  const userPrompt = buildBreakdownPrompt(input, targetType);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 3072,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.5,
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse JSON
    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as ComponentBreakdownResult;

    // Validate and sanitize
    if (!Array.isArray(result.suggestions)) {
      result.suggestions = [];
    }

    result.suggestions = result.suggestions.map((s) => ({
      name: s.name || 'Unnamed Component',
      description: s.description || '',
      type: s.type || targetType,
      estimatedHours: Math.max(1, Math.min(200, Number(s.estimatedHours) || 8)),
      priority: Math.max(1, Math.min(10, Number(s.priority) || 5)),
      suggestedDependencies: Array.isArray(s.suggestedDependencies) ? s.suggestedDependencies : [],
      acceptanceCriteria: Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria.slice(0, 4) : [],
    }));

    return result;
  } catch (error) {
    logger.error('Component breakdown suggestion error', { error });
    if (error instanceof Error) {
      throw new Error(`Breakdown suggestion failed: ${error.message}`);
    }
    throw new Error('Breakdown suggestion failed');
  }
}
