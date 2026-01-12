/**
 * Sprint Planning Prompts
 *
 * System and user prompts for AI-powered sprint planning and suggestions.
 */

import type { SprintPlanningComponent } from '../types';

/**
 * System prompt for sprint detail suggestions
 */
export const SPRINT_SUGGESTION_SYSTEM_PROMPT = `You are a helpful sprint planning assistant. Based on the team's backlog, suggest a meaningful sprint name, goal, and capacity.
Be practical and focused. Sprint names should be memorable and reflect the work (e.g., "Auth & Security Sprint", "UI Polish Week", "API Integration Cycle").
Sprint goals should be specific and achievable (1-2 sentences).
Recommend capacity based on the total estimated hours in the backlog, aiming for 70-80% of available work to fit in a 2-week sprint.

Respond with ONLY valid JSON, no other text.`;

/**
 * Generates user prompt for sprint detail suggestion
 */
export function buildSprintSuggestionPrompt(
  teamName: string,
  backlogComponents: { name: string; description: string | null; priority: number; estimatedHours: number | null }[],
  sprintNumber: number,
): string {
  const backlogSummary = backlogComponents.slice(0, 15).map((c) => ({
    name: c.name,
    description: c.description || '',
    priority: c.priority,
    hours: c.estimatedHours || 0,
  }));

  const totalHours = backlogComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

  return `Team: ${teamName}
Sprint Number: ${sprintNumber}
Total backlog items: ${backlogComponents.length}
Total estimated hours: ${totalHours}

Top priority backlog items:
${JSON.stringify(backlogSummary, null, 2)}

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "name": A meaningful sprint name (not just "Sprint ${sprintNumber}")
- "goal": A specific, achievable sprint goal (1-2 sentences)
- "recommendedCapacity": Suggested team capacity in hours for a 2-week sprint
- "reasoning": Brief explanation of your suggestions (1 sentence)

Example format:
<<<JSON
{
  "name": "Auth & Security Sprint",
  "goal": "...",
  "recommendedCapacity": 80,
  "reasoning": "..."
}
JSON>>>`;
}

/**
 * System prompt for sprint planning
 */
export const SPRINT_PLANNING_SYSTEM_PROMPT = `You are an expert sprint planning assistant helping teams select the right work items for their sprint.
Your job is to analyze available components and select the best subset that:
1. Fits within the sprint capacity (hours)
2. Respects dependencies (don't include something if its dependencies aren't done or included)
3. Prioritizes high-priority items
4. Aligns with the sprint goal if provided

Be practical: aim for 70-80% capacity utilization to leave room for unexpected work.
Flag any risks or concerns as warnings.

Respond with ONLY valid JSON, no other text.`;

/**
 * Generates user prompt for sprint planning
 */
export function buildSprintPlanningPrompt(
  sprintName: string,
  sprintGoal: string | undefined,
  capacityHours: number,
  availableComponents: SprintPlanningComponent[],
): string {
  const componentsList = availableComponents.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description || '',
    status: c.status,
    hours: c.estimatedHours || 0,
    priority: c.priority,
    dependsOn: c.dependsOn,
  }));

  return `Sprint: ${sprintName}
${sprintGoal ? `Sprint Goal: ${sprintGoal}` : ''}
Capacity: ${capacityHours} hours

Available Components (not yet in a sprint):
${JSON.stringify(componentsList, null, 2)}

Analyze these components and select which ones should be included in this sprint.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "selectedComponentIds": array of component IDs to include
- "totalHours": sum of estimated hours for selected components
- "reasoning": brief explanation of your selection strategy (2-3 sentences)
- "warnings": array of any concerns (overcommitment, missing dependencies, blocked items, etc.)

Example format:
<<<JSON
{
  "selectedComponentIds": ["id1", "id2"],
  "totalHours": 38,
  "reasoning": "...",
  "warnings": []
}
JSON>>>`;
}
