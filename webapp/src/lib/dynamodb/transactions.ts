/**
 * DynamoDB Transaction Manager
 *
 * Handles atomic transactions with DynamoDB's 25-item limit.
 * For operations exceeding 25 items, uses a saga pattern with compensating actions.
 *
 * Usage:
 * ```typescript
 * // Small transaction (≤25 items)
 * await executeTransaction([
 *   { operation: 'Put', params: component.create({...}).params() },
 *   { operation: 'Update', params: activity.update({...}).params() },
 * ]);
 *
 * // Large operation (saga pattern)
 * await executeSaga([
 *   { execute: () => step1(), compensate: () => undoStep1() },
 *   { execute: () => step2(), compensate: () => undoStep2() },
 * ]);
 * ```
 */

import {
  TransactWriteCommand,
  TransactGetCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDynamoDBClient, getTableName } from './index';

type TransactWriteItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

const logger = new Logger({ serviceName: 'Transactions' });

export const DYNAMODB_TRANSACTION_LIMIT = 25;

export type TransactionOperation = 'Put' | 'Update' | 'Delete' | 'ConditionCheck';

export interface TransactionItem {
  operation: TransactionOperation;
  params: Record<string, unknown>;
}

export interface TransactionOptions {
  /**
   * Client request token for idempotency
   */
  clientRequestToken?: string;

  /**
   * Return consumed capacity info
   */
  returnConsumedCapacity?: 'INDEXES' | 'TOTAL' | 'NONE';
}

export interface TransactionResult {
  success: boolean;
  consumedCapacity?: unknown;
}

/**
 * Execute a DynamoDB transaction (≤25 items)
 *
 * @param items - Array of transaction items
 * @param options - Transaction options
 * @throws Error if transaction fails or exceeds 25 items
 */
export async function executeTransaction(
  items: TransactionItem[],
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  if (items.length === 0) {
    return { success: true };
  }

  if (items.length > DYNAMODB_TRANSACTION_LIMIT) {
    throw new Error(
      `Transaction exceeds ${DYNAMODB_TRANSACTION_LIMIT} item limit (got ${items.length}). Use executeSaga for larger operations.`
    );
  }

  const client = getDynamoDBClient();
  const tableName = getTableName();

  const transactItems: TransactWriteItem[] = items.map((item) => {
    const { operation, params } = item;

    // Ensure TableName is set
    const paramsWithTable = {
      ...params,
      TableName: (params as Record<string, unknown>).TableName || tableName,
    } as Record<string, unknown>;

    switch (operation) {
      case 'Put':
        return { Put: paramsWithTable } as TransactWriteItem;
      case 'Update':
        return { Update: paramsWithTable } as TransactWriteItem;
      case 'Delete':
        return { Delete: paramsWithTable } as TransactWriteItem;
      case 'ConditionCheck':
        return { ConditionCheck: paramsWithTable } as TransactWriteItem;
      default:
        throw new Error(`Unknown transaction operation: ${operation}`);
    }
  });

  logger.debug('Executing transaction', { itemCount: items.length });

  try {
    const command = new TransactWriteCommand({
      TransactItems: transactItems,
      ClientRequestToken: options.clientRequestToken,
      ReturnConsumedCapacity: options.returnConsumedCapacity,
    });

    const result = await client.send(command);

    logger.debug('Transaction successful', { itemCount: items.length });

    return {
      success: true,
      consumedCapacity: result.ConsumedCapacity,
    };
  } catch (error) {
    logger.error('Transaction failed', { itemCount: items.length, error });
    throw error;
  }
}

export interface SagaStep<T = unknown> {
  /**
   * Name of the step for logging
   */
  name?: string;

  /**
   * Execute the forward action
   */
  execute: () => Promise<T>;

  /**
   * Compensate (undo) the action if a later step fails
   * Should be idempotent and safe to retry
   */
  compensate: () => Promise<void>;
}

export interface SagaResult<T = unknown> {
  success: boolean;
  results: T[];
  failedStep?: number;
  failedStepName?: string;
  error?: Error;
  compensationErrors?: Error[];
}

/**
 * Execute a saga (series of steps with compensating actions)
 *
 * If any step fails, all previous steps are compensated in reverse order.
 * Use this for operations that exceed the 25-item transaction limit.
 *
 * @param steps - Array of saga steps with execute and compensate functions
 * @returns Result including success status and any errors
 */
export async function executeSaga<T = unknown>(steps: SagaStep<T>[]): Promise<SagaResult<T>> {
  const results: T[] = [];
  const completedSteps: SagaStep<T>[] = [];

  logger.debug('Starting saga', { stepCount: steps.length });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepName = step.name || `Step ${i + 1}`;

    try {
      logger.debug('Executing saga step', { stepIndex: i, stepName });
      const result = await step.execute();
      results.push(result);
      completedSteps.push(step);
    } catch (error) {
      logger.error('Saga step failed, initiating compensation', {
        stepIndex: i,
        stepName,
        error,
      });

      // Compensate all completed steps in reverse order
      const compensationErrors = await compensateSteps(completedSteps);

      return {
        success: false,
        results,
        failedStep: i,
        failedStepName: stepName,
        error: error as Error,
        compensationErrors: compensationErrors.length > 0 ? compensationErrors : undefined,
      };
    }
  }

  logger.debug('Saga completed successfully', { stepCount: steps.length });

  return {
    success: true,
    results,
  };
}

/**
 * Compensate steps in reverse order
 */
async function compensateSteps<T>(steps: SagaStep<T>[]): Promise<Error[]> {
  const errors: Error[] = [];

  // Compensate in reverse order
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const stepName = step.name || `Step ${i + 1}`;

    try {
      logger.debug('Compensating step', { stepIndex: i, stepName });
      await step.compensate();
    } catch (error) {
      logger.error('Compensation failed', { stepIndex: i, stepName, error });
      errors.push(error as Error);
      // Continue compensating other steps even if one fails
    }
  }

  if (errors.length > 0) {
    logger.error('Some compensations failed', { errorCount: errors.length });
  }

  return errors;
}

/**
 * Create a transaction item from ElectroDB params
 *
 * Usage:
 * ```typescript
 * const item = createTransactionItem('Put', entity.create({...}).params());
 * ```
 */
export function createTransactionItem(
  operation: TransactionOperation,
  params: Record<string, unknown>
): TransactionItem {
  return { operation, params };
}

/**
 * Execute a transactional get (read multiple items atomically)
 */
export async function transactGet(
  keys: Array<{ pk: string; sk: string }>
): Promise<Record<string, unknown>[]> {
  if (keys.length === 0) {
    return [];
  }

  if (keys.length > DYNAMODB_TRANSACTION_LIMIT) {
    throw new Error(
      `TransactGet exceeds ${DYNAMODB_TRANSACTION_LIMIT} item limit (got ${keys.length}).`
    );
  }

  const client = getDynamoDBClient();
  const tableName = getTableName();

  const transactItems = keys.map(({ pk, sk }) => ({
    Get: {
      TableName: tableName,
      Key: { pk, sk },
    },
  }));

  try {
    const command = new TransactGetCommand({
      TransactItems: transactItems,
    });

    const result = await client.send(command);

    return (result.Responses || []).map((r) => r.Item || {});
  } catch (error) {
    logger.error('TransactGet failed', { keyCount: keys.length, error });
    throw error;
  }
}

/**
 * Helper to chunk items for batch processing outside transactions
 */
export function chunkItems<T>(items: T[], chunkSize: number = DYNAMODB_TRANSACTION_LIMIT): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Create a saga step with automatic retry on transient failures
 */
export function createRetryingSagaStep<T>(
  name: string,
  execute: () => Promise<T>,
  compensate: () => Promise<void>,
  maxRetries: number = 3
): SagaStep<T> {
  return {
    name,
    execute: async () => {
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await execute();
        } catch (error) {
          lastError = error as Error;
          const isRetryable = isTransientError(error);

          if (!isRetryable || attempt === maxRetries) {
            throw error;
          }

          const backoff = Math.min(100 * Math.pow(2, attempt), 1000);
          logger.warn('Retrying saga step', { name, attempt, backoff });
          await sleep(backoff);
        }
      }

      throw lastError;
    },
    compensate,
  };
}

/**
 * Check if an error is transient and can be retried
 */
function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const name = (error as { name?: string }).name;
  const code = (error as { code?: string }).code;

  const transientErrors = [
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'RequestLimitExceeded',
    'InternalServerError',
    'ServiceUnavailable',
  ];

  return transientErrors.includes(name || '') || transientErrors.includes(code || '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
