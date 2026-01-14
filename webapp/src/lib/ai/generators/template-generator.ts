/**
 * Template Generator
 *
 * AI-powered component template application.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import {
  COMPONENT_TEMPLATES,
  TEMPLATE_APPLICATION_SYSTEM_PROMPT,
  buildTemplateApplicationPrompt,
} from '../prompts/template';
import { logger } from '@/lib/logger';
import type { ApplyTemplateInput, ApplyTemplateResult } from '../types';

/**
 * Component templates for common software patterns
 * Provides pre-defined structures for CRUD, APIs, forms, authentication, etc.
 */
export async function applyComponentTemplate(input: ApplyTemplateInput): Promise<ApplyTemplateResult> {
  const client = getBedrockClient();

  const templateInfo = COMPONENT_TEMPLATES.find((t) => t.id === input.template);
  if (!templateInfo) {
    throw new Error(`Unknown template: ${input.template}`);
  }

  const userPrompt = buildTemplateApplicationPrompt(input, templateInfo);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: TEMPLATE_APPLICATION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.4, // Balance creativity with consistency
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
    const result = JSON.parse(jsonContent) as ApplyTemplateResult;

    // Validate and sanitize
    if (!Array.isArray(result.components)) {
      result.components = [];
    }

    const validTypes = ['EPIC', 'FEATURE', 'STORY', 'TASK'];
    result.components = result.components.map((c) => ({
      name: c.name || 'Unnamed Component',
      description: c.description || '',
      type: validTypes.includes(c.type) ? c.type : 'TASK',
      estimatedHours: Math.max(1, Math.min(200, Number(c.estimatedHours) || 8)),
      priority: Math.max(1, Math.min(10, Number(c.priority) || 5)),
      suggestedDependencies: Array.isArray(c.suggestedDependencies) ? c.suggestedDependencies : [],
    }));

    return result;
  } catch (error) {
    logger.error('Template application error', { error });
    if (error instanceof Error) {
      throw new Error(`Template application failed: ${error.message}`);
    }
    throw new Error('Template application failed');
  }
}

// Re-export template metadata for convenience
export { COMPONENT_TEMPLATES };
