/**
 * Natural Language Prompts
 *
 * System and user prompts for natural language component creation.
 */

import type { NaturalLanguageComponentInput } from '../types';

/**
 * System prompt for natural language component creation
 */
export const NATURAL_LANGUAGE_SYSTEM_PROMPT = `You are an expert software architect helping teams create well-structured work items following agile best practices.

Your job is to parse natural language descriptions and create properly structured components that follow the INVEST criteria:
- Independent: Can be developed without waiting for other items
- Negotiable: Details can be refined through discussion
- Valuable: Delivers clear value to users or business
- Estimable: Effort can be reasonably estimated
- Small: Completable within appropriate timeframe for the type
- Testable: Has clear acceptance criteria with pass/fail outcomes

Component Structure:
1. Name: Action-oriented, clear (3-7 words)
   - For STORY/TASK: Start with verb (e.g., "Enable User Login", "Configure Database Connection")
   - For EPIC/FEATURE: Can be noun-based (e.g., "User Authentication System")

2. Description: Include WHAT and WHY
   - WHAT: Brief explanation of the functionality
   - WHY: The user or business value this delivers

3. Acceptance Criteria: 2-4 specific, testable conditions
   - Each criterion should have a clear pass/fail outcome
   - Written from user perspective when applicable

4. Type based on scope:
   - EPIC: Large initiative (40-200 hours, spans months)
   - FEATURE: Distinct capability (16-40 hours, 1-3 sprints)
   - STORY: User-facing change (2-16 hours, fits in one sprint)
   - TASK: Technical work item (1-8 hours)
   - BUG: Defect to fix (1-16 hours)

5. Priority: 1-10 scale (10 = critical/blocking)

6. Dependencies: Only when truly necessary

Be practical and specific. Don't over-engineer.

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
- "name": Action-oriented component name (verb-first for STORY/TASK, 3-7 words)
- "description": Include WHAT it does and WHY it matters (2-3 sentences)
- "type": One of EPIC, FEATURE, STORY, TASK, BUG
- "estimatedHours": Based on type (TASK: 1-8, STORY: 2-16, FEATURE: 16-40, EPIC: 40-200)
- "priority": Priority from 1-10
- "suggestedDependencies": Array of existing component names this depends on (empty if none)
- "acceptanceCriteria": Array of 2-4 specific, testable conditions
- "reasoning": Brief explanation of your choices (1-2 sentences)

Example format:
<<<JSON
{
  "name": "Enable User Login",
  "description": "Allow users to authenticate with email and password. This provides secure access to personal data and enables personalized features.",
  "type": "STORY",
  "estimatedHours": 8,
  "priority": 9,
  "suggestedDependencies": [],
  "acceptanceCriteria": [
    "User can log in with valid email and password",
    "Invalid credentials display clear error message",
    "Successful login redirects to dashboard",
    "Session persists for 24 hours"
  ],
  "reasoning": "Classified as STORY because it's a user-facing feature completable in one sprint."
}
JSON>>>`;
}
