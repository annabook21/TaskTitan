/**
 * Batch Operations for DynamoDB
 *
 * Handles batch writes and deletes with automatic chunking to respect
 * DynamoDB's 25-item limit per batch request.
 *
 * Usage:
 * ```typescript
 * // Batch write with custom writer
 * await batchWrite(items, (item) => entity.create(item).go());
 *
 * // Batch delete
 * await batchDelete([
 *   { pk: 'COMPONENT#123', sk: 'METADATA' },
 *   { pk: 'COMPONENT#456', sk: 'METADATA' },
 * ]);
 * ```
 */

import { BatchWriteCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDynamoDBClient, getTableName } from './index';

const logger = new Logger({ serviceName: 'BatchOps' });

export const DYNAMODB_BATCH_LIMIT = 25;

export interface BatchWriteOptions {
  /**
   * Number of items per batch (default: 25)
   */
  batchSize?: number;

  /**
   * Continue processing remaining items even if some fail
   */
  continueOnError?: boolean;

  /**
   * Delay between batches in ms (for throttling prevention)
   */
  batchDelayMs?: number;

  /**
   * Maximum retries for unprocessed items
   */
  maxRetries?: number;
}

export interface BatchWriteResult<T> {
  succeeded: number;
  failed: Array<{ item: T; error: Error }>;
  totalProcessed: number;
}

/**
 * Execute batch writes with automatic chunking
 *
 * @param items - Items to write
 * @param writer - Function that writes a single item
 * @param options - Batch options
 */
export async function batchWrite<T>(
  items: T[],
  writer: (item: T) => Promise<unknown>,
  options: BatchWriteOptions = {}
): Promise<BatchWriteResult<T>> {
  const { batchSize = DYNAMODB_BATCH_LIMIT, continueOnError = false, batchDelayMs = 0 } = options;

  const result: BatchWriteResult<T> = {
    succeeded: 0,
    failed: [],
    totalProcessed: 0,
  };

  if (items.length === 0) {
    return result;
  }

  logger.debug('Starting batch write', { itemCount: items.length, batchSize });

  // Process in batches
  const batches = chunkArray(items, batchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    if (batchIndex > 0 && batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }

    // Process items in parallel within batch
    const batchResults = await Promise.allSettled(batch.map((item) => writer(item)));

    for (let i = 0; i < batchResults.length; i++) {
      const itemResult = batchResults[i];
      result.totalProcessed++;

      if (itemResult.status === 'fulfilled') {
        result.succeeded++;
      } else {
        const error = itemResult.reason as Error;
        result.failed.push({ item: batch[i], error });

        logger.warn('Batch item failed', {
          batchIndex,
          itemIndex: i,
          error: error.message,
        });

        if (!continueOnError) {
          logger.error('Stopping batch write due to error', {
            succeeded: result.succeeded,
            failed: result.failed.length,
          });
          throw error;
        }
      }
    }
  }

  logger.debug('Batch write complete', {
    succeeded: result.succeeded,
    failed: result.failed.length,
  });

  return result;
}

export interface BatchDeleteOptions {
  /**
   * Number of items per batch (default: 25)
   */
  batchSize?: number;

  /**
   * Delay between batches in ms
   */
  batchDelayMs?: number;

  /**
   * Maximum retries for unprocessed items
   */
  maxRetries?: number;
}

export interface BatchDeleteResult {
  deleted: number;
  unprocessed: Array<{ pk: string; sk: string }>;
}

/**
 * Batch delete items from DynamoDB
 *
 * @param keys - Array of primary keys to delete
 * @param options - Delete options
 */
export async function batchDelete(
  keys: Array<{ pk: string; sk: string }>,
  options: BatchDeleteOptions = {}
): Promise<BatchDeleteResult> {
  const { batchSize = DYNAMODB_BATCH_LIMIT, batchDelayMs = 0, maxRetries = 3 } = options;

  const result: BatchDeleteResult = {
    deleted: 0,
    unprocessed: [],
  };

  if (keys.length === 0) {
    return result;
  }

  const client = getDynamoDBClient();
  const tableName = getTableName();

  logger.debug('Starting batch delete', { keyCount: keys.length, batchSize });

  const batches = chunkArray(keys, batchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    if (batchIndex > 0 && batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }

    let unprocessed = batch;
    let retries = 0;

    while (unprocessed.length > 0 && retries <= maxRetries) {
      const deleteRequests = unprocessed.map(({ pk, sk }) => ({
        DeleteRequest: {
          Key: { pk, sk },
        },
      }));

      try {
        const command = new BatchWriteCommand({
          RequestItems: {
            [tableName]: deleteRequests,
          },
        });

        const response = await client.send(command);

        // Check for unprocessed items
        const unprocessedItems = response.UnprocessedItems?.[tableName] || [];

        if (unprocessedItems.length > 0) {
          unprocessed = unprocessedItems.map((item) => {
            const key = item.DeleteRequest?.Key as { pk: string; sk: string };
            return key;
          });

          retries++;
          if (retries <= maxRetries) {
            const backoff = Math.min(100 * Math.pow(2, retries), 1000);
            logger.warn('Retrying unprocessed deletes', {
              count: unprocessed.length,
              retry: retries,
              backoff,
            });
            await sleep(backoff);
          }
        } else {
          result.deleted += batch.length - unprocessed.length;
          unprocessed = [];
        }
      } catch (error) {
        logger.error('Batch delete failed', { batchIndex, error });
        throw error;
      }
    }

    // Add any remaining unprocessed items to result
    if (unprocessed.length > 0) {
      result.unprocessed.push(...unprocessed);
    }
  }

  logger.debug('Batch delete complete', {
    deleted: result.deleted,
    unprocessed: result.unprocessed.length,
  });

  return result;
}

export interface BatchGetOptions {
  /**
   * Number of items per batch (default: 100 for BatchGetItem)
   */
  batchSize?: number;

  /**
   * Attributes to project (optional)
   */
  projectionExpression?: string;

  /**
   * Expression attribute names for projection
   */
  expressionAttributeNames?: Record<string, string>;
}

/**
 * Batch get items from DynamoDB
 *
 * @param keys - Array of primary keys to get
 * @param options - Get options
 */
export async function batchGet(
  keys: Array<{ pk: string; sk: string }>,
  options: BatchGetOptions = {}
): Promise<Record<string, unknown>[]> {
  const { batchSize = 100, projectionExpression, expressionAttributeNames } = options;

  if (keys.length === 0) {
    return [];
  }

  const client = getDynamoDBClient();
  const tableName = getTableName();

  logger.debug('Starting batch get', { keyCount: keys.length, batchSize });

  const results: Record<string, unknown>[] = [];
  const batches = chunkArray(keys, batchSize);

  for (const batch of batches) {
    const keysToGet = batch.map(({ pk, sk }) => ({ pk, sk }));

    try {
      const command = new BatchGetCommand({
        RequestItems: {
          [tableName]: {
            Keys: keysToGet,
            ...(projectionExpression && { ProjectionExpression: projectionExpression }),
            ...(expressionAttributeNames && {
              ExpressionAttributeNames: expressionAttributeNames,
            }),
          },
        },
      });

      const response = await client.send(command);
      const items = response.Responses?.[tableName] || [];
      results.push(...items);

      // Handle unprocessed keys (retry with exponential backoff)
      let unprocessed = response.UnprocessedKeys?.[tableName]?.Keys || [];
      let retries = 0;

      while (unprocessed.length > 0 && retries < 3) {
        retries++;
        const backoff = Math.min(100 * Math.pow(2, retries), 1000);
        await sleep(backoff);

        const retryCommand = new BatchGetCommand({
          RequestItems: {
            [tableName]: {
              Keys: unprocessed,
              ...(projectionExpression && { ProjectionExpression: projectionExpression }),
              ...(expressionAttributeNames && {
                ExpressionAttributeNames: expressionAttributeNames,
              }),
            },
          },
        });

        const retryResponse = await client.send(retryCommand);
        const retryItems = retryResponse.Responses?.[tableName] || [];
        results.push(...retryItems);
        unprocessed = retryResponse.UnprocessedKeys?.[tableName]?.Keys || [];
      }
    } catch (error) {
      logger.error('Batch get failed', { error });
      throw error;
    }
  }

  logger.debug('Batch get complete', { resultCount: results.length });

  return results;
}

/**
 * Parallel batch update using individual update operations
 *
 * Unlike BatchWriteItem, this uses individual UpdateItem calls in parallel
 * which allows for more complex update expressions.
 *
 * @param items - Items with their update data
 * @param updater - Function that updates a single item
 * @param options - Batch options
 */
export async function parallelUpdate<T>(
  items: T[],
  updater: (item: T) => Promise<unknown>,
  options: BatchWriteOptions = {}
): Promise<BatchWriteResult<T>> {
  const { batchSize = DYNAMODB_BATCH_LIMIT, continueOnError = false, batchDelayMs = 50 } = options;

  return batchWrite(items, updater, { batchSize, continueOnError, batchDelayMs });
}

/**
 * Helper to chunk an array into smaller arrays
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry helper with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 1000,
    shouldRetry = isRetryableError,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (!shouldRetry(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
      logger.debug('Retrying operation', { attempt: attempt + 1, delay });
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const name = (error as { name?: string }).name;
  const code = (error as { code?: string }).code;

  const retryableErrors = [
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'RequestLimitExceeded',
    'InternalServerError',
    'ServiceUnavailable',
  ];

  return retryableErrors.includes(name || '') || retryableErrors.includes(code || '');
}
