/**
 * Context Generator
 *
 * AI-powered context summarization for component decisions.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import { CONTEXT_SUMMARY_SYSTEM_PROMPT, buildContextSummaryPrompt } from '../prompts/context-summary';
import { logger } from '@/lib/logger';
import type { ComponentContextInput, ComponentContextResult } from '../types';

/**
 * Component Context Summarization
 * Takes user-written context and generates a clear, concise "future reader" summary
 */
export async function summarizeComponentContext(
  input: ComponentContextInput,
): Promise<ComponentContextResult> {
  const client = getBedrockClient();

  const userPrompt = buildContextSummaryPrompt(input);

  try {
    const response = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          temperature: 0.3, // Lower temperature for consistency
          system: CONTEXT_SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      }),
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content[0].text;

    // Extract JSON from response
    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent);

    // Validate and sanitize
    const summary = String(result.summary || '').trim();
    const keyPoints = Array.isArray(result.keyPoints)
      ? result.keyPoints.slice(0, 5).map((p: unknown) => String(p).trim())
      : [];

    if (!summary) {
      throw new Error('AI did not generate a valid summary');
    }

    return {
      summary,
      keyPoints,
      inputTokens: responseBody.usage.input_tokens,
      outputTokens: responseBody.usage.output_tokens,
    };
  } catch (error) {
    logger.error('Context summarization error', { error });
    if (error instanceof Error) {
      throw new Error(`Context summarization failed: ${error.message}`);
    }
    throw new Error('Context summarization failed');
  }
}
