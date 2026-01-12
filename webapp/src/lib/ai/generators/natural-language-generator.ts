/**
 * Natural Language Generator
 *
 * AI-powered natural language component creation.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import {
  NATURAL_LANGUAGE_SYSTEM_PROMPT,
  buildNaturalLanguagePrompt,
} from '../prompts/natural-language';
import type { NaturalLanguageComponentInput, NaturalLanguageComponentResult } from '../types';

/**
 * Natural language component creation
 * Parses user intent like "Create a login form with email and password"
 * and generates a structured component with proper type, description, and dependencies
 */
export async function createComponentFromNaturalLanguage(
  input: NaturalLanguageComponentInput,
): Promise<NaturalLanguageComponentResult> {
  const client = getBedrockClient();

  const userPrompt = buildNaturalLanguagePrompt(input);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: NATURAL_LANGUAGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3, // Lower for more deterministic parsing
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse JSON from response
    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as NaturalLanguageComponentResult;

    // Validate and sanitize
    const validTypes = ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'];
    if (!validTypes.includes(result.type)) {
      result.type = 'TASK'; // Default fallback
    }

    result.estimatedHours = Math.max(1, Math.min(200, Number(result.estimatedHours) || 8));
    result.priority = Math.max(1, Math.min(10, Number(result.priority) || 5));
    result.suggestedDependencies = Array.isArray(result.suggestedDependencies) ? result.suggestedDependencies : [];

    return result;
  } catch (error) {
    console.error('Natural language component creation error:', error);
    if (error instanceof Error) {
      throw new Error(`Component creation failed: ${error.message}`);
    }
    throw new Error('Component creation failed');
  }
}
