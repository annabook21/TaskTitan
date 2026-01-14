/**
 * Import Generator
 *
 * AI-powered import data analysis and cleanup.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getBedrockClient } from '../bedrock-client';
import { MODEL_ID } from '../config';
import { extractJsonFromResponse } from '../utils/response-parsing';
import {
  IMPORT_CLEANUP_SYSTEM_PROMPT,
  IMPORT_MAPPING_SYSTEM_PROMPT,
  buildImportCleanupPrompt,
  buildImportMappingPrompt,
} from '../prompts/import-analysis';
import { logger } from '@/lib/logger';
import type { CleanupResult, CleanedRow, ImportMappingResult, ColumnMapping } from '../types';

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

  // Process in batches of 10
  const batchSize = 10;
  const allResults: CleanedRow[] = [];
  let totalChanges = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const userPrompt = buildImportCleanupPrompt(batch, fieldMap);

    try {
      const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          system: IMPORT_CLEANUP_SYSTEM_PROMPT,
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
      logger.error('AI cleanup batch error', { error });
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

  const userPrompt = buildImportMappingPrompt(headers, sampleRows, existingProjects, existingSprints);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        system: IMPORT_MAPPING_SYSTEM_PROMPT,
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
    logger.error('AI import analysis error', { error });
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
