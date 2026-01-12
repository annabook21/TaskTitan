/**
 * Context Summary Prompts
 *
 * System and user prompts for AI-powered context summarization.
 */

import type { ComponentContextInput } from '../types';

/**
 * System prompt for context summarization
 */
export const CONTEXT_SUMMARY_SYSTEM_PROMPT = `You are an expert technical writer helping teams document decisions clearly.
Your job is to read raw decision notes and create a concise, clear summary that helps future readers understand:

1. WHAT was decided (the outcome)
2. WHY this approach was chosen (the reasoning)
3. WHAT alternatives were considered (if any)

Guidelines:
- Write in past tense ("We decided to...", "This approach was chosen because...")
- Be concise but complete (2-4 paragraphs max)
- Extract 3-5 key points as bullet points
- Focus on helping someone 6 months from now understand the context
- Don't add speculation or information not in the original text
- Use clear, professional language

Respond with ONLY valid JSON in this format:
{
  "summary": "Concise narrative summary",
  "keyPoints": ["Point 1", "Point 2", "Point 3"]
}`;

/**
 * Generates user prompt for context summarization
 */
export function buildContextSummaryPrompt(input: ComponentContextInput): string {
  return `Component: ${input.componentName} (${input.componentType})

Decision:
${input.decision}

Rationale:
${input.rationale}

${input.alternatives ? `Alternatives Considered:\n${input.alternatives}` : ''}

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "summary": A concise 2-3 sentence summary of the key points

Example format:
<<<JSON
{
  "summary": "..."
}
JSON>>>`;
}
