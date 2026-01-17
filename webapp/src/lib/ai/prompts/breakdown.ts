/**
 * Component Breakdown Prompts
 *
 * System and user prompts for AI-powered component breakdown suggestions.
 */

import type { ComponentBreakdownInput } from '../types';

/**
 * Builds system prompt for component breakdown based on parent type
 */
export function buildBreakdownSystemPrompt(parentType: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG'): {
  targetType: string;
  guidance: string;
} {
  let targetType: string;
  let guidance: string;

  if (parentType === 'EPIC') {
    targetType = 'FEATURE';
    guidance = `Suggest 3-6 FEATURES that break down this Epic into distinct, valuable deliverables.
Each Feature should:
- Be independently deliverable and provide user value
- Have a clear name describing the capability
- Include 2-3 acceptance criteria for completion
- Estimate 16-40 hours (1-3 sprints)
Think in terms of "What can we ship?" not "What tasks need doing?"`;
  } else if (parentType === 'FEATURE') {
    targetType = 'STORY';
    guidance = `Suggest 4-8 STORIES that implement this Feature.
Each Story should:
- Be a specific user-facing change or requirement
- Have an action-oriented name (verb-first: "Enable...", "Display...", "Allow...")
- Include 2-4 testable acceptance criteria
- Estimate 2-16 hours (fits in one sprint)
- Follow INVEST: Independent, Negotiable, Valuable, Estimable, Small, Testable
Think in terms of "As a user, I want to..." scenarios.`;
  } else {
    // STORY can break down into TASKs
    targetType = 'TASK';
    guidance = `Suggest 3-5 TASKS that implement this Story.
Each Task should:
- Be a technical work item (API endpoint, database schema, UI component, tests)
- Have a verb-first name ("Create...", "Configure...", "Implement...", "Add...")
- Include 2-3 technical acceptance criteria
- Estimate 1-8 hours
Think in terms of "What needs to be built?" from an engineering perspective.`;
  }

  return { targetType, guidance };
}

/**
 * Creates full system prompt for component breakdown
 */
export function getBreakdownSystemPrompt(targetType: string, guidance: string): string {
  return `You are an expert software architect helping teams break down work hierarchically.
Your job is to analyze a component and suggest logical child components that break it into smaller pieces.

${guidance}

For each suggestion:
1. Name: Clear, concise (3-6 words)
2. Description: Specific scope and acceptance criteria (2-3 sentences)
3. Type: ${targetType}
4. EstimatedHours: Realistic estimate
5. Priority: 1-10 (based on dependencies and criticality)
6. Dependencies: Other suggested components this depends on

Be practical. Don't over-engineer. Focus on value delivery.

Respond with ONLY valid JSON, no other text.`;
}

/**
 * Generates user prompt for component breakdown
 */
export function buildBreakdownPrompt(input: ComponentBreakdownInput, targetType: string): string {
  const contextInfo = input.projectContext
    ? `
Project: ${input.projectContext.projectName}

Related Components in Project:
${input.projectContext.relatedComponents.map((c) => `- ${c.name} (${c.type}): ${c.description || 'No description'}`).join('\n')}`
    : '';

  return `Parent Component to Break Down:
Name: ${input.component.name}
Type: ${input.component.type}
Description: ${input.component.description || 'No description provided'}
${contextInfo}

Analyze this ${input.component.type} and suggest child ${targetType}s.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "suggestions": Array of child components with { name, description, type, estimatedHours, priority, suggestedDependencies, acceptanceCriteria }
- "reasoning": Why you chose this breakdown approach (2-3 sentences)
- "recommendedApproach": Overall strategy for implementing this work (1-2 sentences)

Example format:
<<<JSON
{
  "suggestions": [{
    "name": "Enable User Authentication",
    "description": "Allow users to log in securely. This provides access control and personalization capabilities.",
    "type": "${targetType}",
    "estimatedHours": 16,
    "priority": 8,
    "suggestedDependencies": [],
    "acceptanceCriteria": [
      "User can log in with valid credentials",
      "Invalid login attempts show error message",
      "Session expires after 24 hours of inactivity"
    ]
  }],
  "reasoning": "...",
  "recommendedApproach": "..."
}
JSON>>>`;
}
