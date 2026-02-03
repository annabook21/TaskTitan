/**
 * Database Operations for DynamoDB
 *
 * FORGE branch: DynamoDB-only mode
 * Simplified wrappers that execute DynamoDB operations directly.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { EntityName } from './feature-flags';

const logger = new Logger({ serviceName: 'DynamoDB' });

export type WriteOperation = 'create' | 'update' | 'delete' | 'upsert';

export interface WriteOptions {
  /**
   * Additional context for logging
   */
  context?: Record<string, unknown>;
}

export interface WriteResult<T> {
  data: T;
  source: 'dynamodb';
}

/**
 * Execute a write operation on DynamoDB
 *
 * @param entityName - The entity being written
 * @param operation - The type of write operation
 * @param _prismaOperation - DEPRECATED: Not used in DynamoDB-only mode
 * @param dynamoOperation - Function that executes the DynamoDB write
 * @param options - Additional options
 * @returns The result from DynamoDB
 */
export async function dualWrite<T>(
  entityName: EntityName,
  operation: WriteOperation,
  _prismaOperation: () => Promise<unknown>,
  dynamoOperation: () => Promise<T>,
  options: WriteOptions = {},
): Promise<WriteResult<T>> {
  const logContext = {
    entityName,
    operation,
    ...options.context,
  };

  try {
    const result = await dynamoOperation();
    logger.debug('DynamoDB write successful', logContext);
    return {
      data: result,
      source: 'dynamodb',
    };
  } catch (error) {
    logger.error('DynamoDB write failed', { ...logContext, error });
    throw error;
  }
}

/**
 * Execute a read operation on DynamoDB
 *
 * @param entityName - The entity being read
 * @param _prismaReader - DEPRECATED: Not used in DynamoDB-only mode
 * @param dynamoReader - Function that reads from DynamoDB
 * @param options - Additional options
 * @returns The result from DynamoDB
 */
export async function dualRead<T>(
  entityName: EntityName,
  _prismaReader: () => Promise<unknown>,
  dynamoReader: () => Promise<T>,
  options: WriteOptions = {},
): Promise<T> {
  const logContext = {
    entityName,
    operation: 'read',
    ...options.context,
  };

  try {
    const result = await dynamoReader();
    logger.debug('DynamoDB read successful', logContext);
    return result;
  } catch (error) {
    logger.error('DynamoDB read failed', { ...logContext, error });
    throw error;
  }
}

/**
 * Metrics tracking (simplified for DynamoDB-only)
 */
export const dualWriteMetrics = {
  getMetrics() {
    return {
      writes: { total: 0, dynamoSuccess: 0, dynamoFailure: 0 },
      reads: { total: 0, dynamoOnly: 0 },
    };
  },
  logSummary() {
    logger.info('DynamoDB-only mode active');
  },
  reset() {},
};
