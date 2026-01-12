/**
 * Wireframe Generator
 *
 * AI-powered HTML wireframe generation for components.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractHtmlFromResponse } from '../utils/response-parsing';
import { buildWireframePrompt } from '../prompts/wireframe-generation';
import type { GenerateWireframeInput, GenerateWireframeResult } from '../types';

/**
 * Generate HTML wireframe for a component
 */
export async function generateWireframe(input: GenerateWireframeInput): Promise<GenerateWireframeResult> {
  const client = getBedrockClient();

  const prompt = buildWireframePrompt(input);

  try {
    const response = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          temperature: 0.5,
          messages: [{ role: 'user', content: prompt }],
        }),
      }),
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const htmlContent = responseBody.content[0].text;

    // Extract HTML from markdown code blocks if present
    const html = extractHtmlFromResponse(htmlContent);

    return {
      html,
      inputTokens: responseBody.usage.input_tokens,
      outputTokens: responseBody.usage.output_tokens,
    };
  } catch (error) {
    console.error('AI wireframe generation error:', error);
    if (error instanceof Error) {
      throw new Error(`Wireframe generation failed: ${error.message}`);
    }
    throw new Error('Wireframe generation failed');
  }
}
