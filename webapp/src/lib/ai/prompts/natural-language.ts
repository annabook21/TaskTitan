/**
 * Natural Language Prompts
 *
 * System and user prompts for natural language component creation.
 */

import type { NaturalLanguageComponentInput } from '../types';

/**
 * System prompt for natural language component creation
 */
export const NATURAL_LANGUAGE_SYSTEM_PROMPT = `You are an expert software architect helping teams create well-structured work items.
Your job is to parse natural language descriptions and create properly structured components with:

1. Clear, concise name (3-6 words, Title Case)
2. Detailed description explaining scope and acceptance criteria
3. Correct type based on scope:
   - EPIC: Large initiative spanning multiple features (weeks/months)
   - FEATURE: Distinct functionality that delivers user value (days/weeks)
   - STORY: Specific user-facing change or requirement (hours/days)
   - TASK: Technical work item (implementation, refactor, setup)
   - BUG: Defect or issue to fix
4. Realistic estimate (2-80 hours for most items)
5. Priority (1-10, where 10 is critical/blocking)
6. Dependencies on existing components if applicable

Be practical and specific. Don't over-engineer or create unnecessary complexity.

Respond with ONLY valid JSON, no other text.`;

/**
 * Generates user prompt for natural language component creation
 */
export function buildNaturalLanguagePrompt(input: NaturalLanguageComponentInput): string {
  const contextInfo = input.projectContext
    ? `
Project: ${input.projectContext.projectName}
Description: ${input.projectContext.projectDescription}

Existing Components:
${input.projectContext.existingComponents.map((c) => `- ${c.name} (${c.type})`).join('\n')}`
    : '';

  const parentInfo = input.parentComponent
    ? `
Parent Component: ${input.parentComponent.name} (${input.parentComponent.type})
This component should be a child of the parent.`
    : '';

  return `User Request: "${input.userInput}"
${contextInfo}${parentInfo}

Parse this request and create a structured component.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "name": Clear component name (Title Case, 3-6 words)
- "description": Detailed description with acceptance criteria (2-4 sentences)
- "type": One of EPIC, FEATURE, STORY, TASK, BUG
- "estimatedHours": Realistic estimate (2-80 hours)
- "priority": Priority from 1-10
- "suggestedDependencies": Array of existing component names this depends on (empty if none)
- "reasoning": Brief explanation of your choices (1-2 sentences)

Example format:
<<<JSON
{
  "name": "User Login Form",
  "description": "...",
  "type": "STORY",
  "estimatedHours": 8,
  "priority": 9,
  "suggestedDependencies": [],
  "reasoning": "..."
}
JSON>>>`;
}
