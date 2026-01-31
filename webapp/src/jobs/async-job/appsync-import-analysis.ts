/**
 * AppSync Handler: Import Analysis
 *
 * AI-powered CSV/JSON import mapping and data cleanup.
 * Includes Bedrock retry logic for transient errors (AWS best practice).
 */

import { analyzeImportData, cleanupImportData } from '@/lib/ai/generators/import-generator';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@/lib/logger';

export interface AnalyzeImportInput {
  headers: string[];
  sampleRows: string[]; // JSON stringified rows
  projectId: string;
}

export interface AnalyzeImportResult {
  mappings: Array<{
    sourceColumn: string;
    targetField: string | null;
    confidence: number;
  }>;
  detectedFormat: string;
  suggestions: string[];
  warnings: string[];
}

export interface CleanupImportInput {
  rows: string[]; // JSON stringified rows
  mappings: Array<{
    sourceColumn: string;
    targetField: string | null;
  }>;
}

export interface CleanupImportResult {
  rows: Array<{
    original: string;
    cleaned: string;
    changes: string[];
  }>;
  summary: string;
  totalChanges: number;
}

/**
 * Retry wrapper for transient Bedrock errors (AWS best practice).
 * Only retries: ThrottlingException (429), ServiceUnavailable (503), InternalServerError (500)
 */
async function withBedrockRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const name = (error as Error).name;
      const isRetryable = ['ThrottlingException', 'ServiceUnavailable', 'InternalServerError'].includes(name);

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff with jitter (AWS recommended)
      const delay = Math.min(1000, 100 * Math.pow(2, attempt)) + Math.random() * 100;
      logger.warn('Bedrock transient error, retrying', { error: name, attempt, delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

export async function handleAppSyncAnalyzeImport(input: AnalyzeImportInput): Promise<AnalyzeImportResult> {
  logger.info('Analyzing import data', {
    headerCount: input.headers.length,
    sampleCount: input.sampleRows.length,
    projectId: input.projectId,
  });

  const client = getDynamoDBClient();
  const tableName = getTableName();

  // Fetch existing projects and sprints for context
  let existingProjects: string[] = [];
  let existingSprints: string[] = [];

  try {
    // This is a simplified context fetch - in production you'd query more specifically
    const queryResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `PROJECT#${input.projectId}`,
        },
        ProjectionExpression: '#n',
        ExpressionAttributeNames: {
          '#n': 'name',
        },
        Limit: 20,
      })
    );
    existingProjects = (queryResult.Items || []).map((item) => item.name as string).filter(Boolean);
  } catch (err) {
    logger.warn('Failed to fetch context for import analysis', { error: err });
  }

  // Parse sample rows from JSON strings
  const parsedSampleRows = input.sampleRows.map((row) => {
    try {
      return JSON.parse(row) as Record<string, string>;
    } catch {
      return {};
    }
  });

  // Call the import analyzer with retry
  const result = await withBedrockRetry(() =>
    analyzeImportData(input.headers, parsedSampleRows, existingProjects, existingSprints)
  );

  logger.info('Import analysis complete', {
    mappingCount: result.mappings.length,
    detectedFormat: result.detectedFormat,
  });

  return result;
}

export async function handleAppSyncCleanupImport(input: CleanupImportInput): Promise<CleanupImportResult> {
  logger.info('Cleaning import data', {
    rowCount: input.rows.length,
    mappingCount: input.mappings.length,
  });

  // Parse rows from JSON strings
  const parsedRows = input.rows.map((row) => {
    try {
      return JSON.parse(row) as Record<string, string>;
    } catch {
      return {};
    }
  });

  // Call the cleanup function with retry
  const result = await withBedrockRetry(() => cleanupImportData(parsedRows, input.mappings));

  logger.info('Import cleanup complete', {
    totalChanges: result.totalChanges,
  });

  // Convert back to JSON strings for GraphQL response
  return {
    rows: result.rows.map((row) => ({
      original: JSON.stringify(row.original),
      cleaned: JSON.stringify(row.cleaned),
      changes: row.changes,
    })),
    summary: result.summary,
    totalChanges: result.totalChanges,
  };
}
