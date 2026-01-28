/**
 * Data Migration Validation Script
 *
 * Validates data migration by comparing:
 * 1. Record counts between Aurora and DynamoDB
 * 2. Random sampling of records for content comparison
 *
 * Following AWS best practices:
 * - Count verification ensures no records lost
 * - Sampling catches data transformation errors
 * - Detailed reporting for audit trail
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/validate.ts
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/validate.ts --entity User
 *   npx ts-node -r tsconfig-paths/register src/jobs/data-migration/validate.ts --sample-size 100
 */

import { prisma } from '@/lib/prisma';
import { Logger } from '@aws-lambda-powertools/logger';
import { getEntities } from '@/lib/dynamodb/service';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger({ serviceName: 'DataMigration-Validate' });

const DEFAULT_SAMPLE_SIZE = 50;

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

interface CountValidationResult {
  entity: string;
  auroraCount: number;
  dynamoCount: number;
  match: boolean;
  difference: number;
}

interface SampleValidationResult {
  entity: string;
  sampleSize: number;
  matched: number;
  mismatched: number;
  missing: number;
  discrepancies: Array<{
    id: string;
    field: string;
    auroraValue: unknown;
    dynamoValue: unknown;
  }>;
}

export interface ValidationResult {
  validatedAt: string;
  countValidation: CountValidationResult[];
  sampleValidation: SampleValidationResult[];
  summary: {
    allCountsMatch: boolean;
    totalDiscrepancies: number;
    totalMissing: number;
  };
}

export interface ValidationOptions {
  entities?: EntityName[];
  sampleSize?: number;
  outputDir?: string;
}

/**
 * Get count from Aurora via Prisma
 */
async function getAuroraCount(entityName: EntityName): Promise<number> {
  const modelMap: Record<EntityName, string> = {
    User: 'user',
    Team: 'team',
    Membership: 'membership',
    Project: 'project',
    Component: 'component',
    Sprint: 'sprint',
    Assignment: 'assignment',
    Dependency: 'dependency',
    Activity: 'activity',
    Notification: 'notification',
    ComponentStatusHistory: 'componentStatusHistory',
    ComponentPreview: 'componentPreview',
    TeamWorkflowConfig: 'teamWorkflowConfig',
    GitHubTransitionConfig: 'gitHubTransitionConfig',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[modelMap[entityName]];
  return model.count();
}

/**
 * Get count from DynamoDB via ElectroDB
 */
async function getDynamoCount(entityName: EntityName): Promise<number> {
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

  // Use scan to count all items (paginated)
  let count = 0;
  let cursor: unknown = undefined;

  do {
    const result = await entity.scan.go({ cursor });
    count += result.data.length;
    cursor = result.cursor;
  } while (cursor);

  return count;
}

/**
 * Validate counts for all entities
 */
async function validateCounts(entities: EntityName[]): Promise<CountValidationResult[]> {
  const results: CountValidationResult[] = [];

  for (const entityName of entities) {
    logger.info('Validating count', { entity: entityName });

    try {
      const [auroraCount, dynamoCount] = await Promise.all([
        getAuroraCount(entityName),
        getDynamoCount(entityName),
      ]);

      const result: CountValidationResult = {
        entity: entityName,
        auroraCount,
        dynamoCount,
        match: auroraCount === dynamoCount,
        difference: dynamoCount - auroraCount,
      };

      results.push(result);

      if (!result.match) {
        logger.warn('Count mismatch', { extra: result });
      } else {
        logger.info('Count validated', { extra: result });
      }
    } catch (error) {
      logger.error('Count validation failed', { entity: entityName, error });
      results.push({
        entity: entityName,
        auroraCount: -1,
        dynamoCount: -1,
        match: false,
        difference: 0,
      });
    }
  }

  return results;
}

/**
 * Get random sample of IDs from Aurora
 */
async function getSampleIds(entityName: EntityName, sampleSize: number): Promise<string[]> {
  const modelMap: Record<EntityName, string> = {
    User: 'user',
    Team: 'team',
    Membership: 'membership',
    Project: 'project',
    Component: 'component',
    Sprint: 'sprint',
    Assignment: 'assignment',
    Dependency: 'dependency',
    Activity: 'activity',
    Notification: 'notification',
    ComponentStatusHistory: 'componentStatusHistory',
    ComponentPreview: 'componentPreview',
    TeamWorkflowConfig: 'teamWorkflowConfig',
    GitHubTransitionConfig: 'gitHubTransitionConfig',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[modelMap[entityName]];

  // Get total count first
  const totalCount = await model.count();
  if (totalCount === 0) return [];

  // Get random records
  const records = await model.findMany({
    select: { id: true },
    take: Math.min(sampleSize, totalCount),
    skip: Math.max(0, Math.floor(Math.random() * (totalCount - sampleSize))),
  });

  return records.map((r: { id: string }) => r.id);
}

/**
 * Get record from Aurora
 */
async function getAuroraRecord(entityName: EntityName, id: string): Promise<Record<string, unknown> | null> {
  const modelMap: Record<EntityName, string> = {
    User: 'user',
    Team: 'team',
    Membership: 'membership',
    Project: 'project',
    Component: 'component',
    Sprint: 'sprint',
    Assignment: 'assignment',
    Dependency: 'dependency',
    Activity: 'activity',
    Notification: 'notification',
    ComponentStatusHistory: 'componentStatusHistory',
    ComponentPreview: 'componentPreview',
    TeamWorkflowConfig: 'teamWorkflowConfig',
    GitHubTransitionConfig: 'gitHubTransitionConfig',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[modelMap[entityName]];
  return model.findUnique({ where: { id } });
}

/**
 * Get record from DynamoDB
 */
async function getDynamoRecord(entityName: EntityName, id: string): Promise<Record<string, unknown> | null> {
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
  const result = await entity.get({ id }).go();
  return result.data;
}

/**
 * Compare two values for equality (with date normalization)
 */
function valuesMatch(auroraValue: unknown, dynamoValue: unknown): boolean {
  // Handle null/undefined
  if (auroraValue === null || auroraValue === undefined) {
    return dynamoValue === null || dynamoValue === undefined;
  }

  // Handle dates
  if (auroraValue instanceof Date) {
    return auroraValue.toISOString() === dynamoValue;
  }

  // Handle arrays
  if (Array.isArray(auroraValue) && Array.isArray(dynamoValue)) {
    if (auroraValue.length !== dynamoValue.length) return false;
    return auroraValue.every((v, i) => valuesMatch(v, dynamoValue[i]));
  }

  // Handle objects
  if (typeof auroraValue === 'object' && typeof dynamoValue === 'object') {
    const aKeys = Object.keys(auroraValue as object);
    const dKeys = Object.keys(dynamoValue as object);
    if (aKeys.length !== dKeys.length) return false;
    return aKeys.every((key) =>
      valuesMatch(
        (auroraValue as Record<string, unknown>)[key],
        (dynamoValue as Record<string, unknown>)[key]
      )
    );
  }

  // Direct comparison
  return auroraValue === dynamoValue;
}

/**
 * Compare two records and return discrepancies
 */
function compareRecords(
  id: string,
  auroraRecord: Record<string, unknown>,
  dynamoRecord: Record<string, unknown>
): Array<{ id: string; field: string; auroraValue: unknown; dynamoValue: unknown }> {
  const discrepancies: Array<{ id: string; field: string; auroraValue: unknown; dynamoValue: unknown }> = [];

  // Fields to skip in comparison (internal fields)
  const skipFields = ['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk', '__edb_e__', '__edb_v__'];

  for (const [key, auroraValue] of Object.entries(auroraRecord)) {
    if (skipFields.includes(key)) continue;

    const dynamoValue = dynamoRecord[key];

    if (!valuesMatch(auroraValue, dynamoValue)) {
      discrepancies.push({
        id,
        field: key,
        auroraValue,
        dynamoValue,
      });
    }
  }

  return discrepancies;
}

/**
 * Validate samples for an entity
 */
async function validateSamples(
  entityName: EntityName,
  sampleSize: number
): Promise<SampleValidationResult> {
  logger.info('Validating samples', { entity: entityName, sampleSize });

  const result: SampleValidationResult = {
    entity: entityName,
    sampleSize: 0,
    matched: 0,
    mismatched: 0,
    missing: 0,
    discrepancies: [],
  };

  try {
    // Get sample IDs from Aurora
    const sampleIds = await getSampleIds(entityName, sampleSize);
    result.sampleSize = sampleIds.length;

    for (const id of sampleIds) {
      const [auroraRecord, dynamoRecord] = await Promise.all([
        getAuroraRecord(entityName, id),
        getDynamoRecord(entityName, id),
      ]);

      if (!auroraRecord) {
        // Shouldn't happen, but handle it
        continue;
      }

      if (!dynamoRecord) {
        result.missing++;
        logger.warn('Record missing in DynamoDB', { entity: entityName, id });
        continue;
      }

      const discrepancies = compareRecords(id, auroraRecord, dynamoRecord);

      if (discrepancies.length > 0) {
        result.mismatched++;
        result.discrepancies.push(...discrepancies);
        logger.warn('Record mismatch', {
          entity: entityName,
          id,
          discrepancyCount: discrepancies.length,
        });
      } else {
        result.matched++;
      }
    }

    logger.info('Sample validation complete', {
      entity: entityName,
      matched: result.matched,
      mismatched: result.mismatched,
      missing: result.missing,
    });
  } catch (error) {
    logger.error('Sample validation failed', { entity: entityName, error });
  }

  return result;
}

/**
 * Run full validation
 */
export async function validateMigration(options: ValidationOptions = {}): Promise<ValidationResult> {
  const {
    entities = [
      'User',
      'Team',
      'Membership',
      'Project',
      'Component',
      'Sprint',
      'Assignment',
      'Dependency',
      'Activity',
      'Notification',
      'ComponentStatusHistory',
      'ComponentPreview',
      'TeamWorkflowConfig',
      'GitHubTransitionConfig',
    ] as EntityName[],
    sampleSize = DEFAULT_SAMPLE_SIZE,
    outputDir = path.join(process.cwd(), 'migration-data'),
  } = options;

  logger.info('Starting migration validation', {
    entityCount: entities.length,
    sampleSize,
  });

  // Run count validation
  const countValidation = await validateCounts(entities);

  // Run sample validation
  const sampleValidation: SampleValidationResult[] = [];
  for (const entityName of entities) {
    const result = await validateSamples(entityName, sampleSize);
    sampleValidation.push(result);
  }

  // Build result
  const result: ValidationResult = {
    validatedAt: new Date().toISOString(),
    countValidation,
    sampleValidation,
    summary: {
      allCountsMatch: countValidation.every((c) => c.match),
      totalDiscrepancies: sampleValidation.reduce((sum, s) => sum + s.discrepancies.length, 0),
      totalMissing: sampleValidation.reduce((sum, s) => sum + s.missing, 0),
    },
  };

  // Write validation report
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const reportPath = path.join(outputDir, 'validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

  logger.info('Validation complete', result.summary);

  return result;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const entityIndex = args.indexOf('--entity');
  const sampleSizeIndex = args.indexOf('--sample-size');

  const entities = entityIndex !== -1 ? [args[entityIndex + 1] as EntityName] : undefined;
  const sampleSize = sampleSizeIndex !== -1 ? parseInt(args[sampleSizeIndex + 1], 10) : undefined;

  validateMigration({ entities, sampleSize })
    .then((result) => {
      console.log('\nValidation Summary:');
      console.log('===================');

      console.log('\nCount Validation:');
      for (const count of result.countValidation) {
        const status = count.match ? '✓' : '✗';
        console.log(
          `${status} ${count.entity}: Aurora=${count.auroraCount}, DynamoDB=${count.dynamoCount}` +
            (count.match ? '' : ` (diff: ${count.difference})`)
        );
      }

      console.log('\nSample Validation:');
      for (const sample of result.sampleValidation) {
        const status = sample.mismatched === 0 && sample.missing === 0 ? '✓' : '⚠️';
        console.log(
          `${status} ${sample.entity}: ${sample.matched}/${sample.sampleSize} matched` +
            (sample.mismatched > 0 ? `, ${sample.mismatched} mismatched` : '') +
            (sample.missing > 0 ? `, ${sample.missing} missing` : '')
        );
      }

      console.log('\nOverall:');
      console.log(`  All counts match: ${result.summary.allCountsMatch ? 'Yes' : 'No'}`);
      console.log(`  Total discrepancies: ${result.summary.totalDiscrepancies}`);
      console.log(`  Total missing: ${result.summary.totalMissing}`);

      const isValid = result.summary.allCountsMatch &&
                      result.summary.totalDiscrepancies === 0 &&
                      result.summary.totalMissing === 0;

      process.exit(isValid ? 0 : 1);
    })
    .catch((error) => {
      console.error('Validation failed:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}
