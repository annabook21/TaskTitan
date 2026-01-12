/**
 * Import Analysis Prompts
 *
 * System and user prompts for AI-powered import data analysis and cleanup.
 */

/**
 * System prompt for import data cleanup
 */
export const IMPORT_CLEANUP_SYSTEM_PROMPT = `You are a data cleanup expert. Your job is to clean and enhance project management data for import.

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

/**
 * Generates user prompt for import data cleanup
 */
export function buildImportCleanupPrompt(
  batch: Record<string, string>[],
  fieldMap: Map<string, string>,
): string {
  return `Clean up these ${batch.length} rows.

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
}

/**
 * System prompt for import mapping analysis
 */
export const IMPORT_MAPPING_SYSTEM_PROMPT = `You are an expert at analyzing spreadsheet data for project management imports.
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

/**
 * Generates user prompt for import mapping analysis
 */
export function buildImportMappingPrompt(
  headers: string[],
  sampleRows: Record<string, string>[],
  existingProjects: string[],
  existingSprints: string[],
): string {
  return `Analyze these column headers and sample data to suggest mappings:

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
}
