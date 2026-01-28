/**
 * Feature Flags for DynamoDB Migration
 *
 * Controls the migration phase for each entity, enabling gradual rollout:
 * 1. prisma_only: Only Prisma (default, pre-migration)
 * 2. dual_write: Write to both, read from Prisma
 * 3. shadow_read: Write to both, read from both, compare and log discrepancies
 * 4. dynamo_primary: Write to both, read from DynamoDB
 * 5. dynamo_only: Only DynamoDB (post-migration)
 *
 * Environment variables:
 * - MIGRATION_PHASE_USER, MIGRATION_PHASE_TEAM, MIGRATION_PHASE_PROJECT, etc.
 * - MIGRATION_PHASE_DEFAULT: Fallback for entities without specific config
 */

import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'MigrationFlags' });

export type MigrationPhase =
  | 'prisma_only'
  | 'dual_write'
  | 'shadow_read'
  | 'dynamo_primary'
  | 'dynamo_only';

export type EntityName =
  | 'user'
  | 'team'
  | 'membership'
  | 'project'
  | 'component'
  | 'sprint'
  | 'assignment'
  | 'dependency'
  | 'activity'
  | 'notification'
  | 'componentStatusHistory'
  | 'componentPreview'
  | 'teamWorkflowConfig'
  | 'githubTransitionConfig';

const VALID_PHASES: MigrationPhase[] = [
  'prisma_only',
  'dual_write',
  'shadow_read',
  'dynamo_primary',
  'dynamo_only',
];

/**
 * Get the migration phase for a specific entity
 */
export function getMigrationPhase(entityName: EntityName): MigrationPhase {
  const envVarName = `MIGRATION_PHASE_${entityName.toUpperCase()}`;
  const entityPhase = process.env[envVarName];

  if (entityPhase && VALID_PHASES.includes(entityPhase as MigrationPhase)) {
    return entityPhase as MigrationPhase;
  }

  const defaultPhase = process.env.MIGRATION_PHASE_DEFAULT;
  if (defaultPhase && VALID_PHASES.includes(defaultPhase as MigrationPhase)) {
    return defaultPhase as MigrationPhase;
  }

  return 'prisma_only';
}

/**
 * Check if writes should go to Prisma
 */
export function shouldWriteToPrisma(entityName: EntityName): boolean {
  const phase = getMigrationPhase(entityName);
  return phase !== 'dynamo_only';
}

/**
 * Check if writes should go to DynamoDB
 */
export function shouldWriteToDynamoDB(entityName: EntityName): boolean {
  const phase = getMigrationPhase(entityName);
  return phase !== 'prisma_only';
}

/**
 * Check if reads should come from Prisma
 */
export function shouldReadFromPrisma(entityName: EntityName): boolean {
  const phase = getMigrationPhase(entityName);
  return phase === 'prisma_only' || phase === 'dual_write' || phase === 'shadow_read';
}

/**
 * Check if reads should come from DynamoDB
 */
export function shouldReadFromDynamoDB(entityName: EntityName): boolean {
  const phase = getMigrationPhase(entityName);
  return phase === 'shadow_read' || phase === 'dynamo_primary' || phase === 'dynamo_only';
}

/**
 * Check if shadow reads should be performed (read from both and compare)
 */
export function shouldPerformShadowRead(entityName: EntityName): boolean {
  return getMigrationPhase(entityName) === 'shadow_read';
}

/**
 * Get the primary read source for an entity
 */
export function getPrimaryReadSource(entityName: EntityName): 'prisma' | 'dynamodb' {
  const phase = getMigrationPhase(entityName);
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    return 'dynamodb';
  }
  return 'prisma';
}

/**
 * Log migration phase configuration for debugging
 */
export function logMigrationConfig(): void {
  const entities: EntityName[] = [
    'user',
    'team',
    'membership',
    'project',
    'component',
    'sprint',
    'assignment',
    'dependency',
    'activity',
    'notification',
    'componentStatusHistory',
    'componentPreview',
    'teamWorkflowConfig',
    'githubTransitionConfig',
  ];

  const config: Record<string, MigrationPhase> = {};
  for (const entity of entities) {
    config[entity] = getMigrationPhase(entity);
  }

  logger.info('Migration phase configuration', { config });
}

/**
 * Migration phase utilities for use in server actions
 */
export const MigrationFlags = {
  getPhase: getMigrationPhase,
  shouldWriteToPrisma,
  shouldWriteToDynamoDB,
  shouldReadFromPrisma,
  shouldReadFromDynamoDB,
  shouldPerformShadowRead,
  getPrimaryReadSource,
  logConfig: logMigrationConfig,
} as const;
