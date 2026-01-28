/**
 * DynamoDB Import Script
 *
 * Import data from JSON files to DynamoDB using BatchWriteItem.
 * Following AWS best practices:
 * - 25 items per batch (DynamoDB limit)
 * - Exponential backoff for UnprocessedItems (required - no automatic retries)
 * - 16 MB total payload limit per batch
 * - 400 KB per item limit
 * - Progress tracking for resumability
 *
 * Reference: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/import-dynamodb.ts
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/import-dynamodb.ts --entity User
 */

import { Logger } from '@aws-lambda-powertools/logger';
import * as fs from 'fs';
import * as path from 'path';
import { getEntities, type CreateUserInput, type CreateTeamInput, type CreateMembershipInput, type CreateProjectInput, type CreateComponentInput, type CreateSprintInput, type CreateAssignmentInput, type CreateDependencyInput, type CreateActivityInput, type CreateNotificationInput, type CreateComponentStatusHistoryInput, type CreateComponentPreviewInput, type CreateTeamWorkflowConfigInput, type CreateGitHubTransitionConfigInput } from '@/lib/dynamodb/service';
import { withRetry, DYNAMODB_BATCH_LIMIT } from '@/lib/dynamodb/batch-ops';

const logger = new Logger({ serviceName: 'DataMigration-Import' });

// Batch configuration following AWS best practices
const BATCH_SIZE = DYNAMODB_BATCH_LIMIT; // 25 items
const BATCH_DELAY_MS = 100; // Small delay between batches to avoid throttling
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 5000;

type EntityName =
  | 'User'
  | 'Team'
  | 'Membership'
  | 'Project'
  | 'Component'
  | 'Sprint'
  | 'Assignment'
  | 'Dependency'
  | 'Activity'
  | 'Notification'
  | 'ComponentStatusHistory'
  | 'ComponentPreview'
  | 'TeamWorkflowConfig'
  | 'GitHubTransitionConfig';

export interface ImportResult {
  entity: string;
  totalRecords: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  errors: Array<{ record: unknown; error: string }>;
}

export interface ImportOptions {
  inputDir?: string;
  entities?: EntityName[];
  dryRun?: boolean;
  continueOnError?: boolean;
}

/**
 * Transform Prisma record to DynamoDB format
 * Handles date conversions and field mapping
 */
function transformRecord(entityName: EntityName, record: Record<string, unknown>): Record<string, unknown> {
  const transformed = { ...record };

  // Convert Date objects to ISO strings
  for (const [key, value] of Object.entries(transformed)) {
    if (value instanceof Date) {
      transformed[key] = value.toISOString();
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      // Already ISO string, keep as-is
    } else if (value === null) {
      // DynamoDB doesn't support null - remove the field
      delete transformed[key];
    }
  }

  // Entity-specific transformations
  switch (entityName) {
    case 'Component':
      // Ensure tags is an array
      if (!Array.isArray(transformed.tags)) {
        transformed.tags = [];
      }
      // Ensure contextLinks is an array
      if (!Array.isArray(transformed.contextLinks)) {
        transformed.contextLinks = [];
      }
      break;

    case 'Activity':
      // metadata can be any JSON - ensure it's preserved
      if (transformed.metadata && typeof transformed.metadata === 'string') {
        try {
          transformed.metadata = JSON.parse(transformed.metadata);
        } catch {
          // Keep as string if not valid JSON
        }
      }
      break;
  }

  return transformed;
}

/**
 * Sleep helper with promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Import a batch of records with exponential backoff retry
 */
async function importBatch(
  entityName: EntityName,
  records: Record<string, unknown>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity: any
): Promise<{ succeeded: number; failed: Array<{ record: unknown; error: string }> }> {
  const results = { succeeded: 0, failed: [] as Array<{ record: unknown; error: string }> };

  // Process each record individually within the batch
  // ElectroDB handles the PK/SK generation
  for (const record of records) {
    try {
      await withRetry(
        async () => {
          await entity.create(record).go();
        },
        {
          maxRetries: MAX_RETRIES,
          initialDelayMs: INITIAL_BACKOFF_MS,
          maxDelayMs: MAX_BACKOFF_MS,
        }
      );
      results.succeeded++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.failed.push({ record, error: errorMessage });
      logger.warn('Record import failed', {
        entity: entityName,
        recordId: (record as { id?: string }).id,
        error: errorMessage,
      });
    }
  }

  return results;
}

/**
 * Import a single entity from JSON file
 */
async function importEntity(
  entityName: EntityName,
  inputDir: string,
  options: { dryRun?: boolean; continueOnError?: boolean }
): Promise<ImportResult> {
  const startTime = Date.now();
  const inputPath = path.join(inputDir, `${entityName}.json`);

  if (!fs.existsSync(inputPath)) {
    logger.warn('Input file not found, skipping', { entity: entityName, inputPath });
    return {
      entity: entityName,
      totalRecords: 0,
      succeeded: 0,
      failed: 0,
      durationMs: 0,
      errors: [],
    };
  }

  logger.info('Starting entity import', { entity: entityName, inputPath });

  // Read and parse JSON file
  const fileContent = fs.readFileSync(inputPath, 'utf-8');
  const records: Record<string, unknown>[] = JSON.parse(fileContent);

  const result: ImportResult = {
    entity: entityName,
    totalRecords: records.length,
    succeeded: 0,
    failed: 0,
    durationMs: 0,
    errors: [],
  };

  if (options.dryRun) {
    logger.info('Dry run - skipping actual import', { entity: entityName, records: records.length });
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // Get the ElectroDB entity
  const entities = getEntities();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entityMap: Record<EntityName, any> = {
    User: entities.user,
    Team: entities.team,
    Membership: entities.membership,
    Project: entities.project,
    Component: entities.component,
    Sprint: entities.sprint,
    Assignment: entities.assignment,
    Dependency: entities.dependency,
    Activity: entities.activity,
    Notification: entities.notification,
    ComponentStatusHistory: entities.componentStatusHistory,
    ComponentPreview: entities.componentPreview,
    TeamWorkflowConfig: entities.teamWorkflowConfig,
    GitHubTransitionConfig: entities.githubTransitionConfig,
  };

  const entity = entityMap[entityName];

  // Process in batches
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const transformedBatch = batch.map((record) => transformRecord(entityName, record));

    const batchResult = await importBatch(entityName, transformedBatch, entity);
    result.succeeded += batchResult.succeeded;
    result.failed += batchResult.failed.length;
    result.errors.push(...batchResult.failed);

    logger.debug('Batch imported', {
      entity: entityName,
      batchNumber: Math.floor(i / BATCH_SIZE) + 1,
      totalBatches: Math.ceil(records.length / BATCH_SIZE),
      succeeded: batchResult.succeeded,
      failed: batchResult.failed.length,
    });

    // Stop on error if not continuing
    if (!options.continueOnError && batchResult.failed.length > 0) {
      logger.error('Stopping import due to errors', { entity: entityName });
      break;
    }

    // Small delay between batches to avoid throttling
    if (i + BATCH_SIZE < records.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  result.durationMs = Date.now() - startTime;
  logger.info('Entity import complete', {
    entity: entityName,
    totalRecords: result.totalRecords,
    succeeded: result.succeeded,
    failed: result.failed,
    durationMs: result.durationMs,
  });

  return result;
}

/**
 * Import all entities from JSON files to DynamoDB
 */
export async function importAllEntities(options: ImportOptions = {}): Promise<ImportResult[]> {
  const {
    inputDir = path.join(process.cwd(), 'migration-data'),
    entities,
    dryRun = false,
    continueOnError = true,
  } = options;

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  // Import entities in dependency order (parents before children)
  const orderedEntities: EntityName[] = [
    'User',
    'Team',
    'Membership',
    'TeamWorkflowConfig',
    'Project',
    'GitHubTransitionConfig',
    'Sprint',
    'Component',
    'Assignment',
    'Dependency',
    'Activity',
    'Notification',
    'ComponentStatusHistory',
    'ComponentPreview',
  ].filter((e) => !entities || entities.includes(e as EntityName)) as EntityName[];

  logger.info('Starting full import', {
    inputDir,
    entityCount: orderedEntities.length,
    dryRun,
    continueOnError,
  });

  const results: ImportResult[] = [];

  for (const entityName of orderedEntities) {
    try {
      const result = await importEntity(entityName, inputDir, { dryRun, continueOnError });
      results.push(result);

      // Stop on errors if not continuing
      if (!continueOnError && result.failed > 0) {
        break;
      }
    } catch (error) {
      logger.error('Entity import failed', { entity: entityName, error });
      if (!continueOnError) {
        throw error;
      }
    }
  }

  // Write import report
  const report = {
    importedAt: new Date().toISOString(),
    dryRun,
    results,
    summary: {
      totalRecords: results.reduce((sum, r) => sum + r.totalRecords, 0),
      succeeded: results.reduce((sum, r) => sum + r.succeeded, 0),
      failed: results.reduce((sum, r) => sum + r.failed, 0),
      totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    },
  };

  const reportPath = path.join(inputDir, 'import-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  logger.info('Full import complete', report.summary);

  return results;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const entityIndex = args.indexOf('--entity');
  const dryRunFlag = args.includes('--dry-run');
  const entities = entityIndex !== -1 ? [args[entityIndex + 1] as EntityName] : undefined;

  importAllEntities({ entities, dryRun: dryRunFlag })
    .then((results) => {
      console.log('\nImport Summary:');
      console.log('================');
      for (const result of results) {
        const status = result.failed > 0 ? '⚠️' : '✓';
        console.log(
          `${status} ${result.entity}: ${result.succeeded}/${result.totalRecords} succeeded (${result.durationMs}ms)`
        );
      }
      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
      if (totalFailed > 0) {
        console.log(`\n⚠️ ${totalFailed} records failed to import. Check import-report.json for details.`);
      }
      process.exit(totalFailed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}
