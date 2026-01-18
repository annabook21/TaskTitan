/**
 * Retrospective Generator
 *
 * AI-powered sprint retrospective that learns from actual vs estimated time
 * and adjusts future estimates accordingly.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import { logger } from '@/lib/logger';

export interface RetrospectiveInput {
  sprintName: string;
  sprintGoal: string;
  completedComponents: Array<{
    name: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    estimatedHours: number;
    actualHours: number;
    status: 'COMPLETED' | 'INCOMPLETE';
  }>;
  upcomingComponents: Array<{
    name: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    estimatedHours: number;
    description: string;
  }>;
  teamVelocity?: {
    lastSprintCapacity: number;
    actualDelivered: number;
  };
}

export interface RetrospectiveResult {
  summary: string;
  insights: {
    estimationAccuracy: string;
    velocityTrend: string;
    recommendations: string[];
  };
  adjustedEstimates: Array<{
    componentName: string;
    originalEstimate: number;
    adjustedEstimate: number;
    reasoning: string;
  }>;
  suggestedActions: string[];
}

const RETROSPECTIVE_SYSTEM_PROMPT = `You are an expert agile coach analyzing sprint retrospective data to improve future planning.

Your job is to:
1. Analyze actual vs estimated time to identify patterns
2. Calculate estimation accuracy and velocity trends
3. Adjust future estimates for similar work based on historical data
4. Provide actionable recommendations for the team

Guidelines:
- If actual time consistently exceeds estimates by >30%, adjust upward
- If actual time is consistently under estimates by >30%, adjust downward
- Consider component type patterns (e.g., STORY vs TASK estimation accuracy)
- Account for team velocity trends (improving vs declining)
- Provide specific, actionable recommendations

Be data-driven and honest about what the numbers show.`;

function buildRetrospectivePrompt(input: RetrospectiveInput): string {
  const completedSummary = input.completedComponents
    .map(
      (c) =>
        `- ${c.name} (${c.type}): Estimated ${c.estimatedHours}h → Actual ${c.actualHours}h [${((c.actualHours / c.estimatedHours - 1) * 100).toFixed(0)}% variance]`,
    )
    .join('\n');

  const upcomingSummary = input.upcomingComponents
    .map((c) => `- ${c.name} (${c.type}): ${c.estimatedHours}h - ${c.description}`)
    .join('\n');

  const velocityInfo = input.teamVelocity
    ? `\nTeam Velocity:\n- Sprint capacity: ${input.teamVelocity.lastSprintCapacity}h\n- Actual delivered: ${input.teamVelocity.actualDelivered}h (${((input.teamVelocity.actualDelivered / input.teamVelocity.lastSprintCapacity) * 100).toFixed(0)}% utilization)`
    : '';

  return `Sprint: ${input.sprintName}
Goal: ${input.sprintGoal}${velocityInfo}

Completed Components:
${completedSummary}

Upcoming Components (need estimate adjustments):
${upcomingSummary}

Analyze the completed work and adjust estimates for upcoming components based on patterns you observe.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "summary": Brief 2-3 sentence summary of the sprint
- "insights": {
    "estimationAccuracy": String describing how accurate estimates were
    "velocityTrend": String describing team velocity trend
    "recommendations": Array of 3-4 specific recommendations
  }
- "adjustedEstimates": Array of { componentName, originalEstimate, adjustedEstimate, reasoning }
- "suggestedActions": Array of 2-3 action items for next sprint

Example format:
<<<JSON
{
  "summary": "Sprint delivered 80% of planned work with estimates 20% under actual time.",
  "insights": {
    "estimationAccuracy": "Estimates were consistently 20% under for STORY items",
    "velocityTrend": "Team velocity stable at 32h/week",
    "recommendations": [
      "Add 25% buffer to STORY estimates",
      "Break down items >16h",
      "Include testing time in estimates"
    ]
  },
  "adjustedEstimates": [
    {
      "componentName": "User Dashboard",
      "originalEstimate": 8,
      "adjustedEstimate": 10,
      "reasoning": "Similar STORY items took 25% longer than estimated"
    }
  ],
  "suggestedActions": [
    "Review estimation during refinement",
    "Track time more consistently"
  ]
}
JSON>>>`;
}

/**
 * Generate retrospective insights and adjust future estimates based on actual time
 */
export async function generateRetrospective(input: RetrospectiveInput): Promise<RetrospectiveResult> {
  const client = getBedrockClient();

  const userPrompt = buildRetrospectivePrompt(input);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: RETROSPECTIVE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3,
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as RetrospectiveResult;

    // Validate and sanitize
    result.summary = result.summary || 'Sprint retrospective analysis completed.';
    result.insights = result.insights || {
      estimationAccuracy: 'Unable to determine',
      velocityTrend: 'Insufficient data',
      recommendations: [],
    };
    result.adjustedEstimates = Array.isArray(result.adjustedEstimates) ? result.adjustedEstimates : [];
    result.suggestedActions = Array.isArray(result.suggestedActions) ? result.suggestedActions.slice(0, 3) : [];

    // Validate adjusted estimates
    result.adjustedEstimates = result.adjustedEstimates.map((adj) => ({
      componentName: adj.componentName,
      originalEstimate: Math.max(0, Number(adj.originalEstimate) || 0),
      adjustedEstimate: Math.max(1, Math.min(200, Number(adj.adjustedEstimate) || adj.originalEstimate)),
      reasoning: adj.reasoning || 'Adjusted based on historical data',
    }));

    return result;
  } catch (error) {
    logger.error('Retrospective generation error', { error });
    if (error instanceof Error) {
      throw new Error(`Retrospective failed: ${error.message}`);
    }
    throw new Error('Retrospective generation failed');
  }
}
