/**
 * Bulk Plan Refinement Generator
 *
 * AI-powered conversational refinement for entire sprint plans.
 * Allows users to iteratively modify components, sprints, and assignments through chat.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import { logger } from '@/lib/logger';

export interface BulkPlanRefinementInput {
  currentPlan: {
    components: Array<{
      name: string;
      description: string;
      type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
      estimatedHours: number;
      priority: number;
      suggestedDependencies: string[];
      parentName?: string;
    }>;
    sprints?: Array<{
      name: string;
      goal: string;
      durationWeeks: number;
      componentNames: string[];
      capacity?: number;
    }>;
    epics?: Array<{
      name: string;
      description: string;
      componentNames: string[];
    }>;
  };
  refinementRequest: string;
  projectContext: {
    projectName: string;
    projectDescription: string;
    workflowType: 'SCRUM' | 'KANBAN' | 'CUSTOM';
    cycleName?: string;
  };
}

export interface BulkPlanRefinementResult {
  components: BulkPlanRefinementInput['currentPlan']['components'];
  sprints?: BulkPlanRefinementInput['currentPlan']['sprints'];
  epics?: BulkPlanRefinementInput['currentPlan']['epics'];
  explanation: string;
  changedItems: Array<{
    type: 'component' | 'sprint' | 'epic';
    name: string;
    change: string;
  }>;
  suggestedFollowUps: string[];
}

const BULK_REFINEMENT_SYSTEM_PROMPT = `You are an expert agile coach helping refine sprint plans and component breakdowns through conversation.

You're given a complete project plan (components, sprints, epics) and the user wants to modify it.

Your job is to:
1. Understand what the user wants to change (move items between sprints, adjust scope, break down components, change priorities, etc.)
2. Apply those changes following agile best practices:
   - Sprints should be balanced in capacity (70-80% utilization ideal)
   - Dependencies should be respected (required items in earlier sprints)
   - Component estimates should be realistic (STORY: 2-16h, TASK: 1-8h)
   - High priority items should be in earlier sprints
3. Clearly explain what you changed
4. List which specific items were modified
5. Suggest 2-3 follow-up refinements

Common refinement patterns:
- "Move [component] to [sprint]" - reassign components between sprints
- "Reduce scope by X%" - remove lower priority items or reduce estimates
- "Split [component] into tasks" - break large items into smaller ones
- "Swap priority of [A] and [B]" - adjust priorities
- "Add sprint" or "Remove sprint" - adjust sprint count
- "Balance sprint load" - redistribute to even out capacity

Be direct and helpful. Make reasonable interpretations if the request is ambiguous.`;

function buildBulkRefinementPrompt(input: BulkPlanRefinementInput): string {
  const { currentPlan, refinementRequest, projectContext } = input;

  const componentSummary = currentPlan.components
    .map(
      (c) =>
        `- ${c.name} (${c.type}, ${c.estimatedHours}h, P${c.priority})${c.suggestedDependencies.length > 0 ? ` [depends: ${c.suggestedDependencies.join(', ')}]` : ''}`,
    )
    .join('\n');

  const sprintSummary = currentPlan.sprints
    ? currentPlan.sprints
        .map((s, idx) => {
          const sprintComponents = s.componentNames.join(', ');
          const totalHours = currentPlan.components
            .filter((c) => s.componentNames.includes(c.name))
            .reduce((sum, c) => sum + c.estimatedHours, 0);
          return `${projectContext.cycleName || 'Sprint'} ${idx + 1}: ${s.name} (${s.durationWeeks}w, ${totalHours}h${s.capacity ? `/${s.capacity}h capacity` : ''})
  Goal: ${s.goal}
  Components: ${sprintComponents}`;
        })
        .join('\n\n')
    : 'No sprints defined (Kanban workflow)';

  const epicSummary = currentPlan.epics
    ? '\n\nEpics:\n' +
      currentPlan.epics
        .map((e) => `- ${e.name}: ${e.componentNames.join(', ')}`)
        .join('\n')
    : '';

  return `Project: ${projectContext.projectName}
Workflow: ${projectContext.workflowType}

Current Components:
${componentSummary}

Current ${projectContext.cycleName || 'Sprint'} Plan:
${sprintSummary}${epicSummary}

User's refinement request: "${refinementRequest}"

Apply the requested changes and return the updated plan.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": Updated array of all components (same structure as input)
- "sprints": Updated sprints array (if applicable)
- "epics": Updated epics array (if applicable)
- "explanation": Brief explanation of what you changed (2-3 sentences)
- "changedItems": Array of { type, name, change } describing each modification
- "suggestedFollowUps": Array of 2-3 suggested follow-up refinements

Example format:
<<<JSON
{
  "components": [...],
  "sprints": [...],
  "epics": [...],
  "explanation": "I moved the authentication components to Sprint 1 and reduced the scope of Sprint 2 by removing lower priority items.",
  "changedItems": [
    { "type": "component", "name": "User Login", "change": "Moved to Sprint 1" },
    { "type": "sprint", "name": "Sprint 2", "change": "Removed 2 items, reduced to 32h" }
  ],
  "suggestedFollowUps": [
    "Add buffer time to Sprint 1",
    "Break down User Profile into tasks",
    "Increase priority of Security items"
  ]
}
JSON>>>`;
}

/**
 * Refine a bulk AI-generated plan through conversational chat
 */
export async function refineBulkPlan(input: BulkPlanRefinementInput): Promise<BulkPlanRefinementResult> {
  const client = getBedrockClient();

  const userPrompt = buildBulkRefinementPrompt(input);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: BULK_REFINEMENT_SYSTEM_PROMPT,
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
    const result = JSON.parse(jsonContent) as BulkPlanRefinementResult;

    // Validate and sanitize
    if (!result.components || !Array.isArray(result.components)) {
      throw new Error('Invalid response: missing components array');
    }

    // Ensure all components have required fields
    result.components = result.components.map((c, index) => ({
      name: c.name || `Component ${index + 1}`,
      description: c.description || '',
      type: ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'].includes(c.type) ? c.type : 'TASK',
      estimatedHours: Math.max(1, Math.min(200, Number(c.estimatedHours) || 8)),
      priority: Math.max(1, Math.min(10, Number(c.priority) || 5)),
      suggestedDependencies: Array.isArray(c.suggestedDependencies) ? c.suggestedDependencies : [],
      parentName: c.parentName,
    }));

    // Validate sprints if present
    if (result.sprints && Array.isArray(result.sprints)) {
      result.sprints = result.sprints.map((s, index) => ({
        name: s.name || `Sprint ${index + 1}`,
        goal: s.goal || '',
        durationWeeks: Math.max(1, Math.min(6, Number(s.durationWeeks) || 2)),
        componentNames: Array.isArray(s.componentNames) ? s.componentNames : [],
        capacity: s.capacity ? Math.max(1, Number(s.capacity)) : undefined,
      }));
    }

    // Validate epics if present
    if (result.epics && Array.isArray(result.epics)) {
      result.epics = result.epics.map((e) => ({
        name: e.name || 'Unnamed Epic',
        description: e.description || '',
        componentNames: Array.isArray(e.componentNames) ? e.componentNames : [],
      }));
    }

    // Ensure we have an explanation
    result.explanation = result.explanation || 'Plan updated based on your request.';
    result.changedItems = Array.isArray(result.changedItems) ? result.changedItems : [];
    result.suggestedFollowUps = Array.isArray(result.suggestedFollowUps) ? result.suggestedFollowUps.slice(0, 3) : [];

    return result;
  } catch (error) {
    logger.error('Bulk plan refinement error', { error });
    if (error instanceof Error) {
      throw new Error(`Plan refinement failed: ${error.message}`);
    }
    throw new Error('Plan refinement failed');
  }
}

/**
 * Generate suggested follow-up prompts based on the current plan
 */
export function generateBulkRefinementSuggestions(plan: BulkPlanRefinementInput['currentPlan']): string[] {
  const suggestions: string[] = [];

  // Sprint-based suggestions
  if (plan.sprints && plan.sprints.length > 0) {
    const firstSprint = plan.sprints[0];
    const firstSprintHours = plan.components
      .filter((c) => firstSprint.componentNames.includes(c.name))
      .reduce((sum, c) => sum + c.estimatedHours, 0);

    if (firstSprint.capacity && firstSprintHours > firstSprint.capacity * 0.9) {
      suggestions.push('Reduce Sprint 1 scope');
    }

    if (plan.sprints.length > 1) {
      suggestions.push('Move items between sprints');
    }
  }

  // Component-based suggestions
  const largeComponents = plan.components.filter((c) => c.estimatedHours > 20);
  if (largeComponents.length > 0) {
    suggestions.push(`Break down ${largeComponents[0].name} into smaller tasks`);
  }

  // Priority-based suggestions
  const lowPriorityCount = plan.components.filter((c) => c.priority < 3).length;
  if (lowPriorityCount > 2) {
    suggestions.push('Remove lower priority items');
  }

  // Generic suggestions
  const genericSuggestions = [
    'Adjust component estimates',
    'Reorder sprint priorities',
    'Add dependencies between items',
    'Balance sprint capacity',
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
