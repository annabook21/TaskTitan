/**
 * Feature Flags for DynamoDB
 *
 * FORGE branch: DynamoDB-only mode (Prisma removed)
 * All entities use DynamoDB exclusively.
 */

import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'DynamoDB' });

export type MigrationPhase = 'dynamo_only';

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

/**
 * Get the migration phase for a specific entity
 * Always returns 'dynamo_only' in FORGE branch
 */
export function getMigrationPhase(_entityName: EntityName): MigrationPhase {
  return 'dynamo_only';
}

/**
 * Check if writes should go to DynamoDB (always true)
 */
export function shouldWriteToDynamoDB(_entityName: EntityName): boolean {
  return true;
}

/**
 * Check if reads should come from DynamoDB (always true)
 */
export function shouldReadFromDynamoDB(_entityName: EntityName): boolean {
  return true;
}

/**
 * Get the primary read source (always dynamodb)
 */
export function getPrimaryReadSource(_entityName: EntityName): 'dynamodb' {
  return 'dynamodb';
}

/**
 * Log configuration for debugging
 */
export function logMigrationConfig(): void {
  logger.info('DynamoDB-only mode active (FORGE branch)');
}

/**
 * Utility exports
 */
export const MigrationFlags = {
  getPhase: getMigrationPhase,
  shouldWriteToDynamoDB,
  shouldReadFromDynamoDB,
  getPrimaryReadSource,
  logConfig: logMigrationConfig,
} as const;
