/**
 * Aurora/PostgreSQL Export Script
 *
 * Paginated export from Aurora PostgreSQL (via Prisma) to JSON files.
 * Following AWS best practices:
 * - Paginated queries to avoid memory issues
 * - Streaming writes to handle large datasets
 * - Progress tracking for resumability
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/export-aurora.ts
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/export-aurora.ts --entity User
 */

import { prisma } from '@/lib/prisma';
import { Logger } from '@aws-lambda-powertools/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger({ serviceName: 'DataMigration-Export' });

const PAGE_SIZE = 1000;

// Entity definitions with their Prisma model names and sort keys
const ENTITY_CONFIGS = {
  User: {
    model: 'user' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  Team: {
    model: 'team' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  Membership: {
    model: 'membership' as const,
    orderBy: { joinedAt: 'asc' as const },
  },
  Project: {
    model: 'project' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  Component: {
    model: 'component' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  Sprint: {
    model: 'sprint' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  Assignment: {
    model: 'assignment' as const,
    orderBy: { assignedAt: 'asc' as const },
  },
  Dependency: {
    model: 'dependency' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  Activity: {
    model: 'activity' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  Notification: {
    model: 'notification' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  ComponentStatusHistory: {
    model: 'componentStatusHistory' as const,
    orderBy: { enteredAt: 'asc' as const },
  },
  ComponentPreview: {
    model: 'componentPreview' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  TeamWorkflowConfig: {
    model: 'teamWorkflowConfig' as const,
    orderBy: { createdAt: 'asc' as const },
  },
  GitHubTransitionConfig: {
    model: 'gitHubTransitionConfig' as const,
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

type EntityName = keyof typeof ENTITY_CONFIGS;

export interface ExportResult {
  entity: string;
  totalRecords: number;
  outputPath: string;
  durationMs: number;
}

export interface ExportOptions {
  outputDir?: string;
  pageSize?: number;
  entities?: EntityName[];
}

/**
 * Export a single entity with pagination
 */
async function exportEntity(
  entityName: EntityName,
  outputDir: string,
  pageSize: number
): Promise<ExportResult> {
  const startTime = Date.now();
  const config = ENTITY_CONFIGS[entityName];
  const outputPath = path.join(outputDir, `${entityName}.json`);

  logger.info('Starting entity export', { entity: entityName, outputPath });

  // Open file stream for writing
  const writeStream = fs.createWriteStream(outputPath);
  writeStream.write('[\n');

  let totalRecords = 0;
  let page = 0;
  let isFirst = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = prisma[config.model] as any;

  while (true) {
    const records = await model.findMany({
      skip: page * pageSize,
      take: pageSize,
      orderBy: config.orderBy,
    });

    if (records.length === 0) {
      break;
    }

    for (const record of records) {
      if (!isFirst) {
        writeStream.write(',\n');
      }
      writeStream.write(JSON.stringify(record, null, 2));
      isFirst = false;
      totalRecords++;
    }

    page++;
    logger.debug('Page exported', {
      entity: entityName,
      page,
      recordsInPage: records.length,
      totalSoFar: totalRecords,
    });

    if (records.length < pageSize) {
      break;
    }
  }

  writeStream.write('\n]\n');
  writeStream.end();

  // Wait for stream to finish
  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  const durationMs = Date.now() - startTime;
  logger.info('Entity export complete', {
    entity: entityName,
    totalRecords,
    durationMs,
  });

  return {
    entity: entityName,
    totalRecords,
    outputPath,
    durationMs,
  };
}

/**
 * Export all entities from Aurora to JSON files
 */
export async function exportAllEntities(options: ExportOptions = {}): Promise<ExportResult[]> {
  const {
    outputDir = path.join(process.cwd(), 'migration-data'),
    pageSize = PAGE_SIZE,
    entities = Object.keys(ENTITY_CONFIGS) as EntityName[],
  } = options;

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  logger.info('Starting full export', {
    outputDir,
    pageSize,
    entityCount: entities.length,
  });

  const results: ExportResult[] = [];

  // Export entities in dependency order (parents before children)
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
  ].filter((e) => entities.includes(e as EntityName)) as EntityName[];

  for (const entityName of orderedEntities) {
    try {
      const result = await exportEntity(entityName, outputDir, pageSize);
      results.push(result);
    } catch (error) {
      logger.error('Entity export failed', { entity: entityName, error });
      throw error;
    }
  }

  // Write manifest file
  const manifest = {
    exportedAt: new Date().toISOString(),
    pageSize,
    results,
    totalRecords: results.reduce((sum, r) => sum + r.totalRecords, 0),
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
  };

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  logger.info('Full export complete', manifest);

  return results;
}

/**
 * Get count of records for each entity (for validation)
 */
export async function getEntityCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const [entityName, config] of Object.entries(ENTITY_CONFIGS)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = prisma[config.model] as any;
    counts[entityName] = await model.count();
  }

  return counts;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const entityIndex = args.indexOf('--entity');
  const entities = entityIndex !== -1 ? [args[entityIndex + 1] as EntityName] : undefined;

  exportAllEntities({ entities })
    .then((results) => {
      console.log('\nExport Summary:');
      console.log('================');
      for (const result of results) {
        console.log(`${result.entity}: ${result.totalRecords} records (${result.durationMs}ms)`);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('Export failed:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}
