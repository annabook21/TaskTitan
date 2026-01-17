/**
 * Component Generator
 *
 * AI-powered component generation based on project descriptions.
 * Supports workflow-aware generation (Scrum vs Kanban vs custom workflows).
 *
 * KEY DESIGN (matches Jira/Linear):
 * - SCRUM: Sprints are ALWAYS generated. Epics are OPTIONAL backlog groupings.
 * - KANBAN: Flat work items, no sprints, no hierarchy.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import { buildSystemPrompt, buildComponentGenerationPrompt } from '../prompts/component-generation';
import { logger } from '@/lib/logger';
import type { AIGenerationResult } from '../types';
import type { TeamWorkflowConfig } from '@prisma/client';

/**
 * Generates component suggestions for a project based on its description.
 *
 * @param projectName - Name of the project
 * @param projectDescription - Detailed description of the project
 * @param existingComponents - Optional array of existing component names to avoid duplicates
 * @param generateEpics - For Scrum: whether to create optional Epic groupings (default: false)
 * @param workflowConfig - Optional team workflow configuration for workflow-aware generation
 */
export async function generateComponents(
  projectName: string,
  projectDescription: string,
  existingComponents: string[] = [],
  generateEpics: boolean = false,
  workflowConfig?: TeamWorkflowConfig | null,
): Promise<AIGenerationResult> {
  const client = getBedrockClient();

  // Build workflow-aware prompts
  const systemPrompt = buildSystemPrompt(workflowConfig ?? null);
  const userPrompt = buildComponentGenerationPrompt(
    projectName,
    projectDescription,
    existingComponents,
    generateEpics,
    workflowConfig,
  );

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
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

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    // Use robust JSON extraction with sentinel delimiters
    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as AIGenerationResult;

    // Validate and sanitize the response
    if (!result.components || !Array.isArray(result.components)) {
      throw new Error('Invalid response format: missing components array');
    }

    const isKanban = !workflowConfig?.cycleEnabled;

    // Ensure all components have required fields
    result.components = result.components.map((c, index) => ({
      name: c.name || `Component ${index + 1}`,
      description: c.description || '',
      type: c.type || 'STORY', // Default to STORY if not provided
      estimatedHours: Math.max(1, Math.min(200, Number(c.estimatedHours) || 8)),
      priority: Math.max(1, Math.min(10, Number(c.priority) || 5)),
      suggestedDependencies: Array.isArray(c.suggestedDependencies) ? c.suggestedDependencies : [],
      parentName: c.parentName,
    }));

    // Validate sprints (required for Scrum, absent for Kanban)
    if (!isKanban && result.sprints && Array.isArray(result.sprints)) {
      result.sprints = result.sprints.map((s, index) => ({
        name: s.name || `Sprint ${index + 1}`,
        goal: s.goal || '',
        durationWeeks: Math.max(1, Math.min(6, Number(s.durationWeeks) || 2)),
        componentNames: Array.isArray(s.componentNames) ? s.componentNames : [],
        capacity: s.capacity ? Math.max(1, Number(s.capacity)) : undefined,
      }));
    }

    // Validate epics (optional backlog organization)
    if (result.epics && Array.isArray(result.epics)) {
      result.epics = result.epics.map((e) => ({
        name: e.name || 'Unnamed Epic',
        description: e.description || '',
        componentNames: Array.isArray(e.componentNames) ? e.componentNames : [],
      }));
    }

    result.summary = result.summary || 'AI-generated component breakdown for your project.';

    return result;
  } catch (error) {
    logger.error('AI generation error', { error });
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
