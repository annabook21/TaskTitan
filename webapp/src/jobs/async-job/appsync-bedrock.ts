/**
 * Phase 2: AppSync mutation generateComponentViaAI – sync Bedrock invoke.
 * Called when the AsyncJob Lambda is invoked by AppSync with { projectId, prompt }.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '@/lib/ai/bedrock-client';
import { MODEL_ID } from '@/lib/ai/config';
import { logger } from '@/lib/logger';

/**
 * Invokes Bedrock with the given prompt and returns the generated text.
 * Used by AppSync mutation generateComponentViaAI(projectId, prompt).
 */
export async function handleAppSyncGenerateComponentViaAI(projectId: string, prompt: string): Promise<string> {
  logger.info('AppSync generateComponentViaAI', { projectId, promptLength: prompt.length });

  const client = getBedrockClient();

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });

  const response = await client.send(command);
  const body = JSON.parse(new TextDecoder().decode(response.body));

  const text = body.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Bedrock returned no text');
  }

  return text;
}
