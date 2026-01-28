/**
 * Data Migration Orchestrator
 *
 * Coordinates the full Aurora to DynamoDB migration process:
 * 1. Export from Aurora (PostgreSQL via Prisma)
 * 2. Import to DynamoDB (via ElectroDB)
 * 3. Validate migration completeness
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/index.ts export
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/index.ts import
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/index.ts validate
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/index.ts full
 */

import { Logger } from '@aws-lambda-powertools/logger';
import * as path from 'path';
import { exportAllEntities, getEntityCounts, type ExportResult } from './export-aurora';
import { importAllEntities, type ImportResult } from './import-dynamodb';
import { validateMigration, type ValidationResult } from './validate';

const logger = new Logger({ serviceName: 'DataMigration' });

export interface MigrationOptions {
  outputDir?: string;
  dryRun?: boolean;
  skipValidation?: boolean;
  continueOnError?: boolean;
}

export interface MigrationResult {
  exportResults?: ExportResult[];
  importResults?: ImportResult[];
  validationResults?: ValidationResult;
  summary: {
    phase: string;
    success: boolean;
    message: string;
    durationMs: number;
  };
}

/**
 * Run full migration: export -> import -> validate
 */
export async function runFullMigration(options: MigrationOptions = {}): Promise<MigrationResult> {
  const startTime = Date.now();
  const {
    outputDir = path.join(process.cwd(), 'migration-data'),
    dryRun = false,
    skipValidation = false,
    continueOnError = true,
  } = options;

  logger.info('Starting full migration', { outputDir, dryRun, skipValidation });

  const result: MigrationResult = {
    summary: {
      phase: 'starting',
      success: false,
      message: '',
      durationMs: 0,
    },
  };

  try {
    // Phase 1: Export from Aurora
    logger.info('Phase 1: Exporting from Aurora');
    result.summary.phase = 'export';
    result.exportResults = await exportAllEntities({ outputDir });

    const totalExported = result.exportResults.reduce((sum, r) => sum + r.totalRecords, 0);
    logger.info('Export complete', { totalRecords: totalExported });

    // Phase 2: Import to DynamoDB
    logger.info('Phase 2: Importing to DynamoDB');
    result.summary.phase = 'import';
    result.importResults = await importAllEntities({
      inputDir: outputDir,
      dryRun,
      continueOnError,
    });

    const totalImported = result.importResults.reduce((sum, r) => sum + r.succeeded, 0);
    const totalFailed = result.importResults.reduce((sum, r) => sum + r.failed, 0);
    logger.info('Import complete', { totalImported, totalFailed });

    // Phase 3: Validate
    if (!skipValidation && !dryRun) {
      logger.info('Phase 3: Validating migration');
      result.summary.phase = 'validate';
      result.validationResults = await validateMigration({ outputDir });

      if (!result.validationResults.summary.allCountsMatch) {
        throw new Error('Validation failed: count mismatch detected');
      }

      if (result.validationResults.summary.totalMissing > 0) {
        throw new Error(`Validation failed: ${result.validationResults.summary.totalMissing} records missing`);
      }
    }

    // Success
    result.summary = {
      phase: 'complete',
      success: true,
      message: dryRun
        ? 'Dry run completed successfully'
        : `Migration completed: ${totalImported} records imported`,
      durationMs: Date.now() - startTime,
    };

    logger.info('Migration successful', result.summary);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.summary = {
      phase: result.summary.phase,
      success: false,
      message: `Migration failed at ${result.summary.phase}: ${errorMessage}`,
      durationMs: Date.now() - startTime,
    };

    logger.error('Migration failed', { phase: result.summary.phase, error: errorMessage });
  }

  return result;
}

/**
 * Run export only
 */
export async function runExport(options: MigrationOptions = {}): Promise<MigrationResult> {
  const startTime = Date.now();
  const { outputDir = path.join(process.cwd(), 'migration-data') } = options;

  const result: MigrationResult = {
    summary: {
      phase: 'export',
      success: false,
      message: '',
      durationMs: 0,
    },
  };

  try {
    result.exportResults = await exportAllEntities({ outputDir });
    const totalExported = result.exportResults.reduce((sum, r) => sum + r.totalRecords, 0);

    result.summary = {
      phase: 'export',
      success: true,
      message: `Exported ${totalExported} records to ${outputDir}`,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    result.summary = {
      phase: 'export',
      success: false,
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }

  return result;
}

/**
 * Run import only
 */
export async function runImport(options: MigrationOptions = {}): Promise<MigrationResult> {
  const startTime = Date.now();
  const {
    outputDir = path.join(process.cwd(), 'migration-data'),
    dryRun = false,
    continueOnError = true,
  } = options;

  const result: MigrationResult = {
    summary: {
      phase: 'import',
      success: false,
      message: '',
      durationMs: 0,
    },
  };

  try {
    result.importResults = await importAllEntities({
      inputDir: outputDir,
      dryRun,
      continueOnError,
    });

    const totalImported = result.importResults.reduce((sum, r) => sum + r.succeeded, 0);
    const totalFailed = result.importResults.reduce((sum, r) => sum + r.failed, 0);

    result.summary = {
      phase: 'import',
      success: totalFailed === 0,
      message: dryRun
        ? 'Dry run completed'
        : `Imported ${totalImported} records (${totalFailed} failed)`,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    result.summary = {
      phase: 'import',
      success: false,
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }

  return result;
}

/**
 * Run validation only
 */
export async function runValidation(options: MigrationOptions = {}): Promise<MigrationResult> {
  const startTime = Date.now();
  const { outputDir = path.join(process.cwd(), 'migration-data') } = options;

  const result: MigrationResult = {
    summary: {
      phase: 'validate',
      success: false,
      message: '',
      durationMs: 0,
    },
  };

  try {
    result.validationResults = await validateMigration({ outputDir });

    const isValid =
      result.validationResults.summary.allCountsMatch &&
      result.validationResults.summary.totalDiscrepancies === 0 &&
      result.validationResults.summary.totalMissing === 0;

    result.summary = {
      phase: 'validate',
      success: isValid,
      message: isValid
        ? 'Validation passed: all counts match, no discrepancies'
        : `Validation failed: ${result.validationResults.summary.totalDiscrepancies} discrepancies, ${result.validationResults.summary.totalMissing} missing`,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    result.summary = {
      phase: 'validate',
      success: false,
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }

  return result;
}

/**
 * Get pre-migration counts (useful for planning)
 */
export async function getPreMigrationCounts(): Promise<Record<string, number>> {
  return getEntityCounts();
}

// Re-export types
export type { ExportResult } from './export-aurora';
export type { ImportResult } from './import-dynamodb';
export type { ValidationResult } from './validate';

// CLI entry point
if (require.main === module) {
  const command = process.argv[2] || 'help';
  const dryRun = process.argv.includes('--dry-run');

  const migrationCommands: Record<string, () => Promise<MigrationResult>> = {
    export: () => runExport(),
    import: () => runImport({ dryRun }),
    validate: () => runValidation(),
    full: () => runFullMigration({ dryRun }),
  };

  if (command === 'help') {
    console.log(`
Data Migration CLI

Usage:
  npx ts-node -r tsconfig-paths/register src/jobs/data-migration/index.ts <command> [options]

Commands:
  export     Export all data from Aurora to JSON files
  import     Import data from JSON files to DynamoDB
  validate   Validate migration (compare counts and sample records)
  full       Run full migration (export -> import -> validate)
  counts     Show record counts in Aurora (for planning)

Options:
  --dry-run  For import/full: skip actual writes, just validate data
`);
    process.exit(0);
  }

  if (command === 'counts') {
    getPreMigrationCounts()
      .then((counts) => {
        console.log('\nEntity Counts:');
        for (const [entity, count] of Object.entries(counts)) {
          console.log(`  ${entity}: ${count}`);
        }
        process.exit(0);
      })
      .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
      });
  } else if (migrationCommands[command]) {
    migrationCommands[command]()
      .then((result) => {
        console.log('\nResult:', result.summary);
        process.exit(result.summary.success ? 0 : 1);
      })
      .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
      });
  } else {
    console.error(`Unknown command: ${command}`);
    console.log('Run with "help" for usage information.');
    process.exit(1);
  }
}
