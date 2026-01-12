/**
 * AI Service for TaskTitan
 *
 * Uses Amazon Bedrock with Claude to generate component suggestions based on project descriptions.
 * This keeps everything within AWS - no external API keys needed!
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Lazy-initialize Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });
  }
  return bedrockClient;
}

/**
 * Bedrock model ID for all AI generation functions.
 * Using global inference profile for ~10% cost savings vs geographic profile.
 * Override via BEDROCK_MODEL_ID environment variable.
 *
 * Cost comparison (per 1M input tokens):
 * - us.anthropic.claude-sonnet-4-5: $3.30
 * - global.anthropic.claude-sonnet-4-5: ~$3.00 (estimated 10% savings)
 *
 * Supports: US West (Oregon), US East (N. Virginia), US East (Ohio), Europe (Ireland), Asia Pacific (Tokyo)
 */
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

/**
 * Extracts JSON from Bedrock response with 3-tier fallback strategy:
 * 1. Sentinel delimiters (<<<JSON / JSON>>>) - most reliable
 * 2. Markdown code block (```json) - common format
 * 3. Raw content - last resort
 *
 * This approach prevents parsing failures when Claude adds explanatory text
 * before/after the JSON response.
 *
 * @param content - Raw text response from Bedrock API
 * @returns Extracted JSON string ready for parsing
 */
function extractJsonFromResponse(content: string): string {
  // First try sentinel delimiters (most reliable)
  const startMarker = '<<<JSON';
  const endMarker = 'JSON>>>';
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.lastIndexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return content.slice(startIdx + startMarker.length, endIdx).trim();
  }

  // Fallback: try markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Last resort: assume entire content is JSON
  return content.trim();
}

/**
 * Extracts HTML from Bedrock response, handling markdown code blocks.
 * Used by generateWireframe() which returns HTML instead of JSON.
 *
 * @param content - Raw text response from Bedrock API
 * @returns Extracted HTML string
 */
function extractHtmlFromResponse(content: string): string {
  // Try HTML code block first
  const htmlMatch = content.match(/```(?:html)?\s*([\s\S]*?)\s*```/);
  if (htmlMatch) {
    return htmlMatch[1].trim();
  }

  // Assume entire content is HTML
  return content.trim();
}

export interface GeneratedComponent {
  name: string;
  description: string;
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[]; // Names of other components this depends on
}

export interface AIGenerationResult {
  components: GeneratedComponent[];
  summary: string;
  enhancedDescription?: string; // Optional enhanced project description
  sprints?: GeneratedSprint[]; // Optional sprint plan
}

export interface GeneratedSprint {
  name: string;
  goal: string;
  durationWeeks: number;
  componentNames: string[]; // Names of components to include in this sprint
  capacity?: number; // Suggested capacity in hours
}

/**
 * Generates component suggestions for a project based on its description.
 *
 * @param projectName - Name of the project
 * @param projectDescription - Detailed description of the project
 * @param existingComponents - Optional array of existing component names to avoid duplicates
 * @param generateSprints - Whether to also generate a sprint plan (default: false)
 */
export async function generateComponents(
  projectName: string,
  projectDescription: string,
  existingComponents: string[] = [],
  generateSprints: boolean = false,
): Promise<AIGenerationResult> {
  const client = getBedrockClient();

  const systemPrompt = `You are an expert software architect helping teams break down projects into components.
Your job is to analyze a project description and suggest logical components that can be developed independently.

For each component you suggest:
1. Give it a clear, concise name (e.g., "User Authentication", "Product Catalog", "Shopping Cart")
2. Write a brief description of what it does and its responsibilities
3. Estimate the development hours (be realistic: simple components 2-8 hours, medium 8-24 hours, complex 24-80 hours)
4. Assign a priority from 1-10 (10 = highest priority, usually core/foundational components)
5. Identify which other suggested components this depends on (by name)

Consider:
- Frontend components (UI, forms, pages)
- Backend components (API endpoints, services)
- Data layer components (models, database schemas)
- Integration components (third-party services, auth)
- Infrastructure components (deployment, monitoring)

Respond with ONLY valid JSON, no other text.`;

  const sprintInstructions = generateSprints
    ? `
- "sprints": array of 2-4 sprint objects with { name, goal, durationWeeks, componentNames, capacity }
  * Group components logically by dependencies and priority
  * Early sprints should focus on foundational/high-priority components
  * Later sprints build on earlier work
  * Each sprint should be 1-2 weeks
  * IMPORTANT: Respect dependencies - a component cannot be in a sprint before its dependencies
  * IMPORTANT: Apply 80% capacity buffer - if sprint components total 50 hours, set capacity to 62 hours (50/0.8)
  * This buffer accounts for meetings, code review, testing, and unexpected issues
  * Capacity calculation: sum of component estimatedHours divided by 0.8 (80% utilization)
  * componentNames should reference the exact component names from the components array`
    : '';

  const userPrompt = `Project Name: ${projectName}

Project Description:
${projectDescription}

${existingComponents.length > 0 ? `Existing Components (do not suggest these again): ${existingComponents.join(', ')}` : ''}

Analyze this project and suggest 5-12 components that would be needed to build it.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": array of component objects with { name, description, estimatedHours, priority, suggestedDependencies }
- "summary": a brief summary of the overall architecture approach (2-3 sentences)
- "enhancedDescription": an improved, detailed project description (3-4 sentences) that includes key features, tech stack suggestions, and target users${sprintInstructions}

Example format:
<<<JSON
{
  "components": [...],
  "summary": "...",
  "enhancedDescription": "..."
}
JSON>>>`;

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

    // Ensure all components have required fields
    result.components = result.components.map((c, index) => ({
      name: c.name || `Component ${index + 1}`,
      description: c.description || '',
      estimatedHours: Math.max(1, Math.min(200, Number(c.estimatedHours) || 8)),
      priority: Math.max(1, Math.min(10, Number(c.priority) || 5)),
      suggestedDependencies: Array.isArray(c.suggestedDependencies) ? c.suggestedDependencies : [],
    }));

    result.summary = result.summary || 'AI-generated component breakdown for your project.';

    return result;
  } catch (error) {
    console.error('AI generation error:', error);
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

/**
 * Checks if AI is available (Bedrock is always available if we have AWS credentials)
 * In Lambda, we always have credentials via the execution role
 */
export function isAIConfigured(): boolean {
  // In Lambda, we always have AWS credentials
  // The real check is whether we have Bedrock model access (handled at runtime)
  return true;
}

export interface CleanedRow {
  original: Record<string, string>;
  cleaned: Record<string, string>;
  changes: string[];
}

export interface CleanupResult {
  rows: CleanedRow[];
  summary: string;
  totalChanges: number;
}

/**
 * AI-powered data cleanup for imports
 * Normalizes, enhances, and fixes messy data
 */
export async function cleanupImportData(
  rows: Record<string, string>[],
  mappings: { sourceColumn: string; targetField: string | null }[],
): Promise<CleanupResult> {
  const client = getBedrockClient();

  // Build field map
  const fieldMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.targetField) {
      fieldMap.set(m.sourceColumn, m.targetField);
    }
  }

  const systemPrompt = `You are a data cleanup expert. Your job is to clean and enhance project management data for import.

For each row, you should:
1. Fix typos and normalize casing in names (Title Case for names)
2. Normalize status values to: PLANNING, IN_PROGRESS, BLOCKED, REVIEW, COMPLETED
3. Normalize type values to: EPIC, FEATURE, STORY, TASK, BUG
4. Normalize priority to: 0-5 (0=lowest, 5=critical)
5. If description is empty but name is long, split into name + description
6. Detect hierarchy from naming patterns (e.g., "Epic: Auth" → type=EPIC, name="Auth")
7. Clean up estimates (convert "2d" to "16", "1w" to "40", etc.)
8. Add missing descriptions based on context (brief, 1 sentence)

Return ONLY valid JSON with the cleaned data.`;

  // Process in batches of 10
  const batchSize = 10;
  const allResults: CleanedRow[] = [];
  let totalChanges = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const userPrompt = `Clean up these ${batch.length} rows.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY a valid JSON array of objects with:
- "original": the original row data
- "cleaned": the cleaned/enhanced row data (same keys)
- "changes": array of strings describing what was changed

Example format:
<<<JSON
[
  {
    "original": {...},
    "cleaned": {...},
    "changes": ["..."]
  }
]
JSON>>>

Field mappings (sourceColumn → targetField):
${Array.from(fieldMap.entries())
  .map(([s, t]) => `  "${s}" → ${t}`)
  .join('\n')}

Data to clean:
${JSON.stringify(batch, null, 2)}`;

    try {
      const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0.2,
        }),
      });

      const response = await client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const content = responseBody.content?.[0]?.text;

      if (content) {
        const jsonContent = extractJsonFromResponse(content);
        const batchResults = JSON.parse(jsonContent) as CleanedRow[];
        for (const r of batchResults) {
          allResults.push(r);
          totalChanges += r.changes?.length || 0;
        }
      } else {
        // If AI fails, keep original
        for (const row of batch) {
          allResults.push({ original: row, cleaned: row, changes: [] });
        }
      }
    } catch (error) {
      console.error('AI cleanup batch error:', error);
      // Keep original on error
      for (const row of batch) {
        allResults.push({ original: row, cleaned: row, changes: [] });
      }
    }
  }

  return {
    rows: allResults,
    summary: `Cleaned ${rows.length} rows with ${totalChanges} improvements`,
    totalChanges,
  };
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: number;
}

export interface ImportMappingResult {
  mappings: ColumnMapping[];
  detectedFormat: string;
  suggestions: string[];
  warnings: string[];
}

/**
 * AI-powered column mapping for CSV/JSON imports
 * Analyzes headers and sample data to suggest field mappings
 */
export async function analyzeImportData(
  headers: string[],
  sampleRows: Record<string, string>[],
  existingProjects: string[],
  existingSprints: string[],
): Promise<ImportMappingResult> {
  const client = getBedrockClient();

  const targetFields = [
    'name',
    'description',
    'type',
    'parentName',
    'owner',
    'status',
    'priority',
    'estimatedHours',
    'sprint',
    'tags',
    'externalId',
    'dependencies',
  ];

  const systemPrompt = `You are an expert at analyzing spreadsheet data for project management imports.
Your job is to map source columns to target fields for a work item import.

Target fields available:
- name: The title/summary of the work item (REQUIRED)
- description: Detailed description
- type: One of EPIC, FEATURE, STORY, TASK, BUG
- parentName: Name of parent item (for hierarchy)
- owner: Person assigned
- status: PLANNING, IN_PROGRESS, BLOCKED, REVIEW, COMPLETED
- priority: 0-5 (0=lowest, 5=critical)
- estimatedHours: Numeric estimate
- sprint: Sprint name to assign to
- tags: Comma-separated tags
- externalId: External system ID (e.g., Jira key)
- dependencies: Comma-separated names of items this depends on

Respond with ONLY valid JSON.`;

  const userPrompt = `Analyze these column headers and sample data to suggest mappings:

Headers: ${JSON.stringify(headers)}

Sample data (first 3 rows):
${JSON.stringify(sampleRows.slice(0, 3), null, 2)}

Existing projects: ${existingProjects.join(', ') || 'None'}
Existing sprints: ${existingSprints.join(', ') || 'None'}

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "mappings": array of { sourceColumn, targetField (or null if no match), confidence (0-1) }
- "detectedFormat": brief description of the data format (e.g., "Jira export", "Simple task list", "Roadmap spreadsheet")
- "suggestions": array of helpful tips for this import
- "warnings": array of potential issues detected

Example format:
<<<JSON
{
  "mappings": [...],
  "detectedFormat": "...",
  "suggestions": [...],
  "warnings": [...]
}
JSON>>>`;

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.2,
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as ImportMappingResult;

    // Validate mappings
    result.mappings = result.mappings.map((m) => ({
      sourceColumn: m.sourceColumn,
      targetField: targetFields.includes(m.targetField || '') ? m.targetField : null,
      confidence: typeof m.confidence === 'number' ? m.confidence : 0.5,
    }));

    return result;
  } catch (error) {
    console.error('AI import analysis error:', error);
    // Return basic mappings based on common patterns
    return {
      mappings: headers.map((h) => {
        const lower = h.toLowerCase();
        let targetField: string | null = null;
        if (lower.includes('name') || lower.includes('title') || lower.includes('summary')) targetField = 'name';
        else if (lower.includes('desc')) targetField = 'description';
        else if (lower.includes('type') || lower.includes('issue')) targetField = 'type';
        else if (lower.includes('parent') || lower.includes('epic')) targetField = 'parentName';
        else if (lower.includes('owner') || lower.includes('assign')) targetField = 'owner';
        else if (lower.includes('status') || lower.includes('state')) targetField = 'status';
        else if (lower.includes('priority') || lower.includes('prio')) targetField = 'priority';
        else if (lower.includes('estimate') || lower.includes('hours') || lower.includes('points'))
          targetField = 'estimatedHours';
        else if (lower.includes('sprint') || lower.includes('iteration')) targetField = 'sprint';
        else if (lower.includes('tag') || lower.includes('label')) targetField = 'tags';
        else if (lower.includes('key') || lower.includes('id') || lower.includes('jira')) targetField = 'externalId';
        else if (lower.includes('depend') || lower.includes('block')) targetField = 'dependencies';

        return { sourceColumn: h, targetField, confidence: targetField ? 0.7 : 0 };
      }),
      detectedFormat: 'Unknown format',
      suggestions: ['Review mappings carefully before importing'],
      warnings: ['AI analysis unavailable - using pattern matching'],
    };
  }
}

export interface SprintPlanningComponent {
  id: string;
  name: string;
  description: string | null;
  status: string;
  estimatedHours: number | null;
  priority: number;
  dependsOn: string[]; // Component names it depends on
}

export interface SprintPlanningResult {
  selectedComponentIds: string[];
  totalHours: number;
  reasoning: string;
  warnings: string[];
}

/**
 * AI-powered sprint planning: suggests which components to include in a sprint
 * based on capacity, priorities, and dependencies.
 */
export interface SprintSuggestion {
  name: string;
  goal: string;
  recommendedCapacity: number;
  reasoning: string;
}

/**
 * AI-powered sprint suggestion: analyzes backlog to suggest sprint name, goal, and capacity
 */
export async function suggestSprintDetails(
  teamName: string,
  backlogComponents: { name: string; description: string | null; priority: number; estimatedHours: number | null }[],
  sprintNumber: number,
): Promise<SprintSuggestion> {
  const client = getBedrockClient();

  const systemPrompt = `You are a helpful sprint planning assistant. Based on the team's backlog, suggest a meaningful sprint name, goal, and capacity.
Be practical and focused. Sprint names should be memorable and reflect the work (e.g., "Auth & Security Sprint", "UI Polish Week", "API Integration Cycle").
Sprint goals should be specific and achievable (1-2 sentences).
Recommend capacity based on the total estimated hours in the backlog, aiming for 70-80% of available work to fit in a 2-week sprint.

Respond with ONLY valid JSON, no other text.`;

  const backlogSummary = backlogComponents.slice(0, 15).map((c) => ({
    name: c.name,
    description: c.description || '',
    priority: c.priority,
    hours: c.estimatedHours || 0,
  }));

  const totalHours = backlogComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

  const userPrompt = `Team: ${teamName}
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

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.7,
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as SprintSuggestion;

    return {
      name: result.name || `Sprint ${sprintNumber}`,
      goal: result.goal || '',
      recommendedCapacity: result.recommendedCapacity || 80,
      reasoning: result.reasoning || 'AI-generated suggestion',
    };
  } catch (error) {
    console.error('AI sprint suggestion error:', error);
    // Return sensible defaults on error
    return {
      name: `Sprint ${sprintNumber}`,
      goal: 'Complete high-priority backlog items',
      recommendedCapacity: Math.min(80, totalHours),
      reasoning: 'Default suggestion (AI unavailable)',
    };
  }
}

export async function planSprint(
  sprintName: string,
  sprintGoal: string | undefined,
  capacityHours: number,
  availableComponents: SprintPlanningComponent[],
): Promise<SprintPlanningResult> {
  const client = getBedrockClient();

  const systemPrompt = `You are an expert sprint planning assistant helping teams select the right work items for their sprint.
Your job is to analyze available components and select the best subset that:
1. Fits within the sprint capacity (hours)
2. Respects dependencies (don't include something if its dependencies aren't done or included)
3. Prioritizes high-priority items
4. Aligns with the sprint goal if provided

Be practical: aim for 70-80% capacity utilization to leave room for unexpected work.
Flag any risks or concerns as warnings.

Respond with ONLY valid JSON, no other text.`;

  const componentsList = availableComponents.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description || '',
    status: c.status,
    hours: c.estimatedHours || 0,
    priority: c.priority,
    dependsOn: c.dependsOn,
  }));

  const userPrompt = `Sprint: ${sprintName}
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

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3, // Lower temperature for more deterministic planning
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse the JSON from Claude's response
    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as SprintPlanningResult;

    // Validate the result
    if (!Array.isArray(result.selectedComponentIds)) {
      result.selectedComponentIds = [];
    }
    if (typeof result.totalHours !== 'number') {
      result.totalHours = 0;
    }
    if (!result.reasoning) {
      result.reasoning = 'AI-generated sprint plan.';
    }
    if (!Array.isArray(result.warnings)) {
      result.warnings = [];
    }

    // Filter to only valid component IDs
    const validIds = new Set(availableComponents.map((c) => c.id));
    result.selectedComponentIds = result.selectedComponentIds.filter((id) => validIds.has(id));

    return result;
  } catch (error) {
    console.error('AI sprint planning error:', error);
    if (error instanceof Error) {
      throw new Error(`AI sprint planning failed: ${error.message}`);
    }
    throw new Error('AI sprint planning failed');
  }
}

/**
 * Natural language component creation
 * Parses user intent like "Create a login form with email and password"
 * and generates a structured component with proper type, description, and dependencies
 */
export interface NaturalLanguageComponentInput {
  userInput: string;
  projectContext?: {
    projectName: string;
    projectDescription: string;
    existingComponents: Array<{ name: string; type: string }>;
  };
  parentComponent?: {
    id: string;
    name: string;
    type: string;
  };
}

export interface NaturalLanguageComponentResult {
  name: string;
  description: string;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  reasoning: string; // Why the AI chose this structure
}

export async function createComponentFromNaturalLanguage(
  input: NaturalLanguageComponentInput,
): Promise<NaturalLanguageComponentResult> {
  const client = getBedrockClient();

  const systemPrompt = `You are an expert software architect helping teams create well-structured work items.
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

  const userPrompt = `User Request: "${input.userInput}"
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

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3, // Lower for more deterministic parsing
      }),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const content = responseBody.content?.[0]?.text;
    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse JSON from response
    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent) as NaturalLanguageComponentResult;

    // Validate and sanitize
    const validTypes = ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'];
    if (!validTypes.includes(result.type)) {
      result.type = 'TASK'; // Default fallback
    }

    result.estimatedHours = Math.max(1, Math.min(200, Number(result.estimatedHours) || 8));
    result.priority = Math.max(1, Math.min(10, Number(result.priority) || 5));
    result.suggestedDependencies = Array.isArray(result.suggestedDependencies) ? result.suggestedDependencies : [];

    return result;
  } catch (error) {
    console.error('Natural language component creation error:', error);
    if (error instanceof Error) {
      throw new Error(`Component creation failed: ${error.message}`);
    }
    throw new Error('Component creation failed');
  }
}

/**
 * Smart breakdown suggestions
 * When viewing an Epic, suggests Feature breakdowns
 * When viewing a Feature, suggests Story implementations
 */
export interface ComponentBreakdownInput {
  component: {
    id: string;
    name: string;
    description: string | null;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  };
  projectContext?: {
    projectName: string;
    relatedComponents: Array<{ name: string; type: string; description: string | null }>;
  };
}

export interface SuggestedChildComponent {
  name: string;
  description: string;
  type: 'FEATURE' | 'STORY' | 'TASK';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
}

export interface ComponentBreakdownResult {
  suggestions: SuggestedChildComponent[];
  reasoning: string;
  recommendedApproach: string; // Overall strategy for breaking down the work
}

export async function suggestComponentBreakdown(
  input: ComponentBreakdownInput,
): Promise<ComponentBreakdownResult> {
  const client = getBedrockClient();

  // Determine target type based on parent
  let targetType: string;
  let guidance: string;

  if (input.component.type === 'EPIC') {
    targetType = 'FEATURE';
    guidance = `Suggest 3-6 FEATURES that break down this Epic into distinct, valuable deliverables.
Each Feature should be independently deliverable and provide user value.
Think in terms of "What can we ship?" not "What tasks need doing?"`;
  } else if (input.component.type === 'FEATURE') {
    targetType = 'STORY';
    guidance = `Suggest 4-8 STORIES that implement this Feature.
Each Story should be a specific user-facing change or requirement.
Think in terms of "As a user, I want to..." scenarios.`;
  } else {
    // STORY can break down into TASKs
    targetType = 'TASK';
    guidance = `Suggest 3-5 TASKS that implement this Story.
Each Task should be a technical work item (API endpoint, database schema, UI component, tests).
Think in terms of "What needs to be built?" from an engineering perspective.`;
  }

  const systemPrompt = `You are an expert software architect helping teams break down work hierarchically.
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

  const contextInfo = input.projectContext
    ? `
Project: ${input.projectContext.projectName}

Related Components in Project:
${input.projectContext.relatedComponents.map((c) => `- ${c.name} (${c.type}): ${c.description || 'No description'}`).join('\n')}`
    : '';

  const userPrompt = `Parent Component to Break Down:
Name: ${input.component.name}
Type: ${input.component.type}
Description: ${input.component.description || 'No description provided'}
${contextInfo}

Analyze this ${input.component.type} and suggest child ${targetType}s.

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "suggestions": Array of child components with { name, description, type, estimatedHours, priority, suggestedDependencies }
- "reasoning": Why you chose this breakdown approach (2-3 sentences)
- "recommendedApproach": Overall strategy for implementing this work (1-2 sentences)

Example format:
<<<JSON
{
  "suggestions": [{
    "name": "...",
    "description": "...",
    "type": "${targetType}",
    "estimatedHours": 16,
    "priority": 8,
    "suggestedDependencies": []
  }],
  "reasoning": "...",
  "recommendedApproach": "..."
}
JSON>>>`;

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 3072,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.5,
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
    const result = JSON.parse(jsonContent) as ComponentBreakdownResult;

    // Validate and sanitize
    if (!Array.isArray(result.suggestions)) {
      result.suggestions = [];
    }

    result.suggestions = result.suggestions.map((s) => ({
      name: s.name || 'Unnamed Component',
      description: s.description || '',
      type: s.type || targetType,
      estimatedHours: Math.max(1, Math.min(200, Number(s.estimatedHours) || 8)),
      priority: Math.max(1, Math.min(10, Number(s.priority) || 5)),
      suggestedDependencies: Array.isArray(s.suggestedDependencies) ? s.suggestedDependencies : [],
    }));

    return result;
  } catch (error) {
    console.error('Component breakdown suggestion error:', error);
    if (error instanceof Error) {
      throw new Error(`Breakdown suggestion failed: ${error.message}`);
    }
    throw new Error('Breakdown suggestion failed');
  }
}

/**
 * Component templates for common software patterns
 * Provides pre-defined structures for CRUD, APIs, forms, authentication, etc.
 */
export enum ComponentTemplate {
  CRUD_FEATURE = 'crud_feature',
  REST_API = 'rest_api',
  USER_AUTH = 'user_auth',
  FORM_WITH_VALIDATION = 'form_with_validation',
  DATA_DASHBOARD = 'data_dashboard',
  FILE_UPLOAD = 'file_upload',
  SEARCH_FILTER = 'search_filter',
  NOTIFICATION_SYSTEM = 'notification_system',
  PAYMENT_INTEGRATION = 'payment_integration',
  ADMIN_PANEL = 'admin_panel',
}

export interface ComponentTemplateMetadata {
  id: ComponentTemplate;
  name: string;
  description: string;
  category: 'Backend' | 'Frontend' | 'Full Stack' | 'Integration';
  estimatedHours: number;
  commonUseCase: string;
}

// Template metadata for UI display
export const COMPONENT_TEMPLATES: ComponentTemplateMetadata[] = [
  {
    id: ComponentTemplate.CRUD_FEATURE,
    name: 'CRUD Feature',
    description: 'Complete create, read, update, delete functionality for an entity',
    category: 'Full Stack',
    estimatedHours: 40,
    commonUseCase: 'User management, product catalog, blog posts',
  },
  {
    id: ComponentTemplate.REST_API,
    name: 'REST API Endpoints',
    description: 'Set of RESTful API endpoints with authentication and validation',
    category: 'Backend',
    estimatedHours: 24,
    commonUseCase: 'Mobile app backend, third-party integrations',
  },
  {
    id: ComponentTemplate.USER_AUTH,
    name: 'User Authentication',
    description: 'Complete auth flow: signup, login, password reset, session management',
    category: 'Full Stack',
    estimatedHours: 48,
    commonUseCase: 'Any application requiring user accounts',
  },
  {
    id: ComponentTemplate.FORM_WITH_VALIDATION,
    name: 'Form with Validation',
    description: 'Multi-step form with client and server validation',
    category: 'Frontend',
    estimatedHours: 16,
    commonUseCase: 'Registration forms, checkout flows, surveys',
  },
  {
    id: ComponentTemplate.DATA_DASHBOARD,
    name: 'Analytics Dashboard',
    description: 'Dashboard with charts, filters, and data visualization',
    category: 'Frontend',
    estimatedHours: 32,
    commonUseCase: 'Admin dashboards, reporting tools, metrics display',
  },
  {
    id: ComponentTemplate.FILE_UPLOAD,
    name: 'File Upload System',
    description: 'File upload with progress, validation, and cloud storage',
    category: 'Full Stack',
    estimatedHours: 24,
    commonUseCase: 'Document management, image galleries, attachments',
  },
  {
    id: ComponentTemplate.SEARCH_FILTER,
    name: 'Search & Filter',
    description: 'Advanced search with filters, sorting, and pagination',
    category: 'Full Stack',
    estimatedHours: 20,
    commonUseCase: 'Product catalogs, content libraries, user directories',
  },
  {
    id: ComponentTemplate.NOTIFICATION_SYSTEM,
    name: 'Notification System',
    description: 'Real-time notifications (email, in-app, push)',
    category: 'Full Stack',
    estimatedHours: 32,
    commonUseCase: 'Alerts, messaging, activity feeds',
  },
  {
    id: ComponentTemplate.PAYMENT_INTEGRATION,
    name: 'Payment Integration',
    description: 'Payment processing with Stripe/PayPal (checkout, webhooks, receipts)',
    category: 'Integration',
    estimatedHours: 40,
    commonUseCase: 'E-commerce, subscriptions, donations',
  },
  {
    id: ComponentTemplate.ADMIN_PANEL,
    name: 'Admin Panel',
    description: 'Admin interface for managing users, content, and settings',
    category: 'Full Stack',
    estimatedHours: 48,
    commonUseCase: 'Content management, user moderation, system configuration',
  },
];

export interface ApplyTemplateInput {
  template: ComponentTemplate;
  customization: {
    entityName: string; // e.g., "Product", "User", "Order"
    projectName: string;
    additionalRequirements?: string; // Optional custom needs
  };
  projectContext?: {
    existingComponents: Array<{ name: string; type: string }>;
    techStack?: string; // e.g., "React + Node.js + PostgreSQL"
  };
}

export interface ApplyTemplateResult {
  components: Array<{
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
  }>;
  implementationNotes: string;
  techStackRecommendations?: string;
}

export async function applyComponentTemplate(input: ApplyTemplateInput): Promise<ApplyTemplateResult> {
  const client = getBedrockClient();

  const templateInfo = COMPONENT_TEMPLATES.find((t) => t.id === input.template);
  if (!templateInfo) {
    throw new Error(`Unknown template: ${input.template}`);
  }

  const systemPrompt = `You are an expert software architect creating component breakdowns from templates.
Your job is to take a standard template pattern and adapt it to the user's specific needs.

Create a complete, production-ready breakdown with:
1. Proper hierarchy (Epic → Features → Stories → Tasks)
2. Realistic estimates
3. Correct dependencies
4. Implementation guidance

Be specific and practical. Include:
- Database schema considerations
- API endpoint specifications
- UI component structure
- Testing requirements
- Security considerations

Respond with ONLY valid JSON, no other text.`;

  const techStackInfo = input.projectContext?.techStack
    ? `Tech Stack: ${input.projectContext.techStack}`
    : 'Tech Stack: Not specified (use modern best practices)';

  const existingInfo = input.projectContext?.existingComponents?.length
    ? `
Existing Components (consider integration):
${input.projectContext.existingComponents.map((c) => `- ${c.name} (${c.type})`).join('\n')}`
    : '';

  const userPrompt = `Template: ${templateInfo.name}
Template Description: ${templateInfo.description}
Entity/Focus: ${input.customization.entityName}
Project: ${input.customization.projectName}
${input.customization.additionalRequirements ? `Additional Requirements: ${input.customization.additionalRequirements}` : ''}
${techStackInfo}${existingInfo}

Generate a complete component breakdown for this ${templateInfo.name} focused on "${input.customization.entityName}".

Return your response between <<<JSON and JSON>>> markers. Between these markers, provide ONLY valid JSON with:
- "components": Array of components with { name, description, type, estimatedHours, priority, suggestedDependencies }
  * Include proper hierarchy: 1 EPIC → 2-4 FEATURES → 3-6 STORIES/TASKS per feature
  * Each component should have detailed description with acceptance criteria
  * Use the entity name in component names (e.g., "Product List API", "${input.customization.entityName} Form Validation")
- "implementationNotes": Detailed implementation guidance (3-5 paragraphs covering database, API, UI, security, testing)
- "techStackRecommendations": Specific libraries/tools to use (optional, 2-3 sentences)

Example format:
<<<JSON
{
  "components": [...],
  "implementationNotes": "...",
  "techStackRecommendations": "..."
}
JSON>>>`;

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: systemPrompt,
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
    console.error('Template application error:', error);
    if (error instanceof Error) {
      throw new Error(`Template application failed: ${error.message}`);
    }
    throw new Error('Template application failed');
  }
}

/**
 * Component Context Summarization
 * Takes user-written context and generates a clear, concise "future reader" summary
 */
export interface ComponentContextInput {
  decision: string; // What was decided
  rationale: string; // Why this approach
  alternatives?: string; // Alternatives considered
  componentName: string;
  componentType: string;
}

export interface ComponentContextResult {
  summary: string; // AI-generated summary for future readers
  keyPoints: string[]; // 3-5 key takeaways
  inputTokens: number;
  outputTokens: number;
}

export async function summarizeComponentContext(
  input: ComponentContextInput,
): Promise<ComponentContextResult> {
  const client = getBedrockClient();

  const systemPrompt = `You are an expert technical writer helping teams document decisions clearly.
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

  const userPrompt = `Component: ${input.componentName} (${input.componentType})

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

  try {
    const response = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          temperature: 0.3, // Lower temperature for consistency
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      }),
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content[0].text;

    // Extract JSON from response
    const jsonContent = extractJsonFromResponse(content);
    const result = JSON.parse(jsonContent);

    // Validate and sanitize
    const summary = String(result.summary || '').trim();
    const keyPoints = Array.isArray(result.keyPoints)
      ? result.keyPoints.slice(0, 5).map((p: unknown) => String(p).trim())
      : [];

    if (!summary) {
      throw new Error('AI did not generate a valid summary');
    }

    return {
      summary,
      keyPoints,
      inputTokens: responseBody.usage.input_tokens,
      outputTokens: responseBody.usage.output_tokens,
    };
  } catch (error) {
    console.error('Context summarization error:', error);
    if (error instanceof Error) {
      throw new Error(`Context summarization failed: ${error.message}`);
    }
    throw new Error('Context summarization failed');
  }
}

/**
 * Generate HTML wireframe for a component
 */
export interface GenerateWireframeInput {
  componentName: string;
  description: string;
  type: string;
  dependencies?: string[];
}

export interface GenerateWireframeResult {
  html: string;
  inputTokens: number;
  outputTokens: number;
}

export async function generateWireframe(input: GenerateWireframeInput): Promise<GenerateWireframeResult> {
  const client = getBedrockClient();

  const prompt = `Generate a lightweight HTML wireframe for this component:

Component: ${input.componentName}
Type: ${input.type}
Description: ${input.description}
${input.dependencies?.length ? `Dependencies: ${input.dependencies.join(', ')}` : ''}

Requirements:
- Single HTML file with inline CSS (Tailwind CDN is acceptable)
- Use semantic HTML5 elements
- Include placeholder content and labels
- Show all major UI sections and interactions
- Keep it simple - this is a wireframe, not production code
- Use neutral colors (grays, whites, blacks)
- Responsive layout (mobile-first)
- Add placeholder data where relevant
- Include basic interactivity hints (buttons, forms, etc.)

Return ONLY the complete HTML document, no explanation or markdown formatting.`;

  try {
    const response = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          temperature: 0.5,
          messages: [{ role: 'user', content: prompt }],
        }),
      }),
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const htmlContent = responseBody.content[0].text;

    // Extract HTML from markdown code blocks if present
    const html = extractHtmlFromResponse(htmlContent);

    return {
      html,
      inputTokens: responseBody.usage.input_tokens,
      outputTokens: responseBody.usage.output_tokens,
    };
  } catch (error) {
    console.error('AI wireframe generation error:', error);
    if (error instanceof Error) {
      throw new Error(`Wireframe generation failed: ${error.message}`);
    }
    throw new Error('Wireframe generation failed');
  }
}
