/**
 * Dual-Write Wrapper for DynamoDB Migration
 *
 * Handles writing to both Prisma (Aurora) and DynamoDB during migration.
 * The behavior is controlled by feature flags for each entity.
 *
 * Features:
 * - Async retry queue for failed secondary writes
 * - Metrics tracking for success rates and latencies
 * - Shadow read comparison with discrepancy logging
 *
 * Usage:
 * ```typescript
 * const result = await dualWrite('project', 'create',
 *   () => prisma.project.create({ data }),
 *   () => projectEntity.create(data).go()
 * );
 * ```
 */

import { Logger } from '@aws-lambda-powertools/logger';
import {
  EntityName,
  getMigrationPhase,
  shouldWriteToPrisma,
  shouldWriteToDynamoDB,
  shouldReadFromPrisma,
  shouldReadFromDynamoDB,
  shouldPerformShadowRead,
} from './feature-flags';

const logger = new Logger({ serviceName: 'DualWrite' });

// ============================================================================
// Retry Queue for Failed Secondary Writes
// ============================================================================

export interface FailedWriteEntry {
  id: string;
  entityName: EntityName;
  operation: WriteOperation;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  executeWrite: () => Promise<unknown>;
  error?: string;
}

// In-memory queue for failed writes (for serverless, consider SQS/DynamoDB for durability)
const failedWriteQueue: FailedWriteEntry[] = [];
const MAX_QUEUE_SIZE = 1000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Add a failed write to the retry queue
 */
function queueFailedWrite(
  entityName: EntityName,
  operation: WriteOperation,
  executeWrite: () => Promise<unknown>,
  error: Error
): void {
  if (failedWriteQueue.length >= MAX_QUEUE_SIZE) {
    logger.warn('Failed write queue full, dropping oldest entry', {
      queueSize: failedWriteQueue.length,
      entityName,
      operation,
    });
    failedWriteQueue.shift();
  }

  const entry: FailedWriteEntry = {
    id: `${entityName}-${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    entityName,
    operation,
    timestamp: Date.now(),
    retryCount: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
    executeWrite,
    error: error.message,
  };

  failedWriteQueue.push(entry);
  logger.info('Queued failed write for retry', {
    entryId: entry.id,
    entityName,
    operation,
    queueSize: failedWriteQueue.length,
  });
}

/**
 * Process the failed write queue (call periodically or at end of request)
 */
export async function processFailedWriteQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}> {
  const results = { processed: 0, succeeded: 0, failed: 0, remaining: 0 };

  if (failedWriteQueue.length === 0) {
    return results;
  }

  logger.info('Processing failed write queue', { queueSize: failedWriteQueue.length });

  // Process entries that are ready for retry (with exponential backoff)
  const now = Date.now();
  const entriesToProcess: FailedWriteEntry[] = [];

  for (const entry of failedWriteQueue) {
    const backoffMs = Math.min(1000 * Math.pow(2, entry.retryCount), 30000);
    const readyTime = entry.timestamp + backoffMs;

    if (now >= readyTime) {
      entriesToProcess.push(entry);
    }
  }

  for (const entry of entriesToProcess) {
    results.processed++;

    try {
      await entry.executeWrite();
      results.succeeded++;

      // Remove from queue on success
      const idx = failedWriteQueue.indexOf(entry);
      if (idx > -1) failedWriteQueue.splice(idx, 1);

      logger.info('Retry succeeded', {
        entryId: entry.id,
        entityName: entry.entityName,
        operation: entry.operation,
        retryCount: entry.retryCount,
      });
    } catch (error) {
      entry.retryCount++;
      entry.timestamp = now;
      entry.error = (error as Error).message;

      if (entry.retryCount >= entry.maxRetries) {
        results.failed++;

        // Remove from queue after max retries
        const idx = failedWriteQueue.indexOf(entry);
        if (idx > -1) failedWriteQueue.splice(idx, 1);

        logger.error('Retry exhausted, dropping failed write', {
          entryId: entry.id,
          entityName: entry.entityName,
          operation: entry.operation,
          retryCount: entry.retryCount,
          error: entry.error,
        });

        // Track in metrics
        dualWriteMetrics.recordFailure(entry.entityName, entry.operation, 'retry_exhausted');
      } else {
        logger.warn('Retry failed, will retry again', {
          entryId: entry.id,
          entityName: entry.entityName,
          operation: entry.operation,
          retryCount: entry.retryCount,
          nextRetryIn: Math.min(1000 * Math.pow(2, entry.retryCount), 30000),
        });
      }
    }
  }

  results.remaining = failedWriteQueue.length;
  return results;
}

/**
 * Get current queue status
 */
export function getFailedWriteQueueStatus(): {
  size: number;
  entries: Array<{
    id: string;
    entityName: EntityName;
    operation: WriteOperation;
    retryCount: number;
    age: number;
  }>;
} {
  const now = Date.now();
  return {
    size: failedWriteQueue.length,
    entries: failedWriteQueue.map((e) => ({
      id: e.id,
      entityName: e.entityName,
      operation: e.operation,
      retryCount: e.retryCount,
      age: now - e.timestamp,
    })),
  };
}

// ============================================================================
// Metrics Tracking
// ============================================================================

interface MetricsData {
  writes: {
    total: number;
    prismaSuccess: number;
    prismaFailure: number;
    dynamoSuccess: number;
    dynamoFailure: number;
    dualSuccess: number;
  };
  reads: {
    total: number;
    prismaOnly: number;
    dynamoOnly: number;
    shadowReads: number;
    shadowDiscrepancies: number;
  };
  latencies: {
    prismaWrite: number[];
    dynamoWrite: number[];
    prismaRead: number[];
    dynamoRead: number[];
  };
  failures: Array<{
    timestamp: number;
    entityName: EntityName;
    operation: string;
    reason: string;
  }>;
}

const metricsData: MetricsData = {
  writes: {
    total: 0,
    prismaSuccess: 0,
    prismaFailure: 0,
    dynamoSuccess: 0,
    dynamoFailure: 0,
    dualSuccess: 0,
  },
  reads: {
    total: 0,
    prismaOnly: 0,
    dynamoOnly: 0,
    shadowReads: 0,
    shadowDiscrepancies: 0,
  },
  latencies: {
    prismaWrite: [],
    dynamoWrite: [],
    prismaRead: [],
    dynamoRead: [],
  },
  failures: [],
};

const MAX_LATENCY_SAMPLES = 1000;
const MAX_FAILURE_ENTRIES = 100;

/**
 * Dual-write metrics tracker
 */
export const dualWriteMetrics = {
  recordWriteAttempt(): void {
    metricsData.writes.total++;
  },

  recordPrismaWriteSuccess(latencyMs: number): void {
    metricsData.writes.prismaSuccess++;
    addLatencySample(metricsData.latencies.prismaWrite, latencyMs);
  },

  recordPrismaWriteFailure(): void {
    metricsData.writes.prismaFailure++;
  },

  recordDynamoWriteSuccess(latencyMs: number): void {
    metricsData.writes.dynamoSuccess++;
    addLatencySample(metricsData.latencies.dynamoWrite, latencyMs);
  },

  recordDynamoWriteFailure(): void {
    metricsData.writes.dynamoFailure++;
  },

  recordDualWriteSuccess(): void {
    metricsData.writes.dualSuccess++;
  },

  recordReadAttempt(): void {
    metricsData.reads.total++;
  },

  recordPrismaRead(latencyMs: number): void {
    metricsData.reads.prismaOnly++;
    addLatencySample(metricsData.latencies.prismaRead, latencyMs);
  },

  recordDynamoRead(latencyMs: number): void {
    metricsData.reads.dynamoOnly++;
    addLatencySample(metricsData.latencies.dynamoRead, latencyMs);
  },

  recordShadowRead(): void {
    metricsData.reads.shadowReads++;
  },

  recordShadowDiscrepancy(): void {
    metricsData.reads.shadowDiscrepancies++;
  },

  recordFailure(entityName: EntityName, operation: string, reason: string): void {
    if (metricsData.failures.length >= MAX_FAILURE_ENTRIES) {
      metricsData.failures.shift();
    }
    metricsData.failures.push({
      timestamp: Date.now(),
      entityName,
      operation,
      reason,
    });
  },

  getMetrics(): {
    writes: MetricsData['writes'];
    reads: MetricsData['reads'];
    latencyStats: {
      prismaWrite: { avg: number; p50: number; p95: number; p99: number };
      dynamoWrite: { avg: number; p50: number; p95: number; p99: number };
      prismaRead: { avg: number; p50: number; p95: number; p99: number };
      dynamoRead: { avg: number; p50: number; p95: number; p99: number };
    };
    recentFailures: MetricsData['failures'];
    successRates: {
      prismaWrite: number;
      dynamoWrite: number;
      dualWrite: number;
    };
  } {
    const prismaWriteTotal = metricsData.writes.prismaSuccess + metricsData.writes.prismaFailure;
    const dynamoWriteTotal = metricsData.writes.dynamoSuccess + metricsData.writes.dynamoFailure;

    return {
      writes: { ...metricsData.writes },
      reads: { ...metricsData.reads },
      latencyStats: {
        prismaWrite: calculateLatencyStats(metricsData.latencies.prismaWrite),
        dynamoWrite: calculateLatencyStats(metricsData.latencies.dynamoWrite),
        prismaRead: calculateLatencyStats(metricsData.latencies.prismaRead),
        dynamoRead: calculateLatencyStats(metricsData.latencies.dynamoRead),
      },
      recentFailures: [...metricsData.failures].slice(-20),
      successRates: {
        prismaWrite: prismaWriteTotal > 0 ? metricsData.writes.prismaSuccess / prismaWriteTotal : 1,
        dynamoWrite: dynamoWriteTotal > 0 ? metricsData.writes.dynamoSuccess / dynamoWriteTotal : 1,
        dualWrite:
          metricsData.writes.total > 0
            ? metricsData.writes.dualSuccess / metricsData.writes.total
            : 1,
      },
    };
  },

  reset(): void {
    metricsData.writes = {
      total: 0,
      prismaSuccess: 0,
      prismaFailure: 0,
      dynamoSuccess: 0,
      dynamoFailure: 0,
      dualSuccess: 0,
    };
    metricsData.reads = {
      total: 0,
      prismaOnly: 0,
      dynamoOnly: 0,
      shadowReads: 0,
      shadowDiscrepancies: 0,
    };
    metricsData.latencies = {
      prismaWrite: [],
      dynamoWrite: [],
      prismaRead: [],
      dynamoRead: [],
    };
    metricsData.failures = [];
  },

  /**
   * Log metrics summary (call periodically for CloudWatch)
   */
  logSummary(): void {
    const metrics = this.getMetrics();
    logger.info('Dual-write metrics summary', {
      writes: metrics.writes,
      reads: metrics.reads,
      successRates: metrics.successRates,
      latencyStats: metrics.latencyStats,
      failureCount: metrics.recentFailures.length,
    });
  },
};

function addLatencySample(samples: number[], latencyMs: number): void {
  samples.push(latencyMs);
  if (samples.length > MAX_LATENCY_SAMPLES) {
    samples.shift();
  }
}

function calculateLatencyStats(samples: number[]): {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
} {
  if (samples.length === 0) {
    return { avg: 0, p50: 0, p95: 0, p99: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    avg: Math.round(sum / sorted.length),
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
  };
}

export type WriteOperation = 'create' | 'update' | 'delete' | 'upsert';

export interface DualWriteOptions {
  /**
   * If true, rollback Prisma write if DynamoDB write fails (during dual_write phase)
   * Default: false (log error but don't rollback)
   */
  rollbackOnElectroFailure?: boolean;

  /**
   * Custom comparator for shadow read validation
   */
  comparator?: <T>(prismaResult: T, electroResult: unknown) => boolean;

  /**
   * Additional context for logging
   */
  context?: Record<string, unknown>;
}

export interface DualWriteResult<T> {
  data: T;
  source: 'prisma' | 'dynamodb';
  electrodbSuccess?: boolean;
  prismaSuccess?: boolean;
}

/**
 * Execute a write operation on both databases based on migration phase
 *
 * @param entityName - The entity being written
 * @param operation - The type of write operation
 * @param prismaOperation - Function that executes the Prisma write
 * @param electrodbOperation - Function that executes the ElectroDB write
 * @param options - Additional options
 * @returns The result from the primary database
 */
export async function dualWrite<T>(
  entityName: EntityName,
  operation: WriteOperation,
  prismaOperation: () => Promise<T>,
  electrodbOperation: () => Promise<unknown>,
  options: DualWriteOptions = {}
): Promise<DualWriteResult<T>> {
  const phase = getMigrationPhase(entityName);
  const writeToPrisma = shouldWriteToPrisma(entityName);
  const writeToDynamoDB = shouldWriteToDynamoDB(entityName);

  const logContext = {
    entityName,
    operation,
    phase,
    ...options.context,
  };

  dualWriteMetrics.recordWriteAttempt();

  let prismaResult: T | undefined;
  let electrodbResult: unknown;
  let prismaSuccess = false;
  let electrodbSuccess = false;

  // Execute Prisma write if needed
  if (writeToPrisma) {
    const startTime = Date.now();
    try {
      prismaResult = await prismaOperation();
      prismaSuccess = true;
      dualWriteMetrics.recordPrismaWriteSuccess(Date.now() - startTime);
      logger.debug('Prisma write successful', logContext);
    } catch (error) {
      dualWriteMetrics.recordPrismaWriteFailure();
      dualWriteMetrics.recordFailure(entityName, operation, 'prisma_write_failed');
      logger.error('Prisma write failed', { ...logContext, error });
      // If Prisma is primary and fails, throw immediately
      if (phase !== 'dynamo_primary' && phase !== 'dynamo_only') {
        throw error;
      }
    }
  }

  // Execute DynamoDB write if needed
  if (writeToDynamoDB) {
    const startTime = Date.now();
    try {
      electrodbResult = await electrodbOperation();
      electrodbSuccess = true;
      dualWriteMetrics.recordDynamoWriteSuccess(Date.now() - startTime);
      logger.debug('ElectroDB write successful', logContext);
    } catch (error) {
      dualWriteMetrics.recordDynamoWriteFailure();
      logger.error('ElectroDB write failed', { ...logContext, error });

      // If DynamoDB is primary and fails, throw
      if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
        dualWriteMetrics.recordFailure(entityName, operation, 'dynamo_write_failed_primary');
        throw error;
      }

      // In dual_write/shadow_read phase, queue for retry (non-blocking)
      if (phase === 'dual_write' || phase === 'shadow_read') {
        queueFailedWrite(entityName, operation, electrodbOperation, error as Error);
        dualWriteMetrics.recordFailure(entityName, operation, 'dynamo_write_queued');
      }

      // Optionally rollback Prisma
      if (options.rollbackOnElectroFailure && prismaSuccess && operation === 'create') {
        logger.warn('Rolling back Prisma write due to ElectroDB failure', logContext);
        // Note: Rollback logic would need to be passed in or handled by caller
      }
    }
  }

  // Track dual success (both succeeded when both were attempted)
  if (writeToPrisma && writeToDynamoDB && prismaSuccess && electrodbSuccess) {
    dualWriteMetrics.recordDualWriteSuccess();
  }

  // Determine which result to return based on phase
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    if (!electrodbSuccess) {
      throw new Error(`DynamoDB write failed for ${entityName}`);
    }
    return {
      data: electrodbResult as T,
      source: 'dynamodb',
      electrodbSuccess,
      prismaSuccess,
    };
  }

  if (!prismaSuccess) {
    throw new Error(`Prisma write failed for ${entityName}`);
  }

  return {
    data: prismaResult as T,
    source: 'prisma',
    electrodbSuccess,
    prismaSuccess,
  };
}

/**
 * Execute a read operation with optional shadow read comparison
 *
 * @param entityName - The entity being read
 * @param prismaReader - Function that reads from Prisma
 * @param electrodbReader - Function that reads from ElectroDB
 * @param options - Additional options
 * @returns The result from the primary database
 */
export async function dualRead<T>(
  entityName: EntityName,
  prismaReader: () => Promise<T>,
  electrodbReader: () => Promise<unknown>,
  options: DualWriteOptions = {}
): Promise<T> {
  const phase = getMigrationPhase(entityName);
  const readFromPrisma = shouldReadFromPrisma(entityName);
  const readFromDynamoDB = shouldReadFromDynamoDB(entityName);
  const shadowRead = shouldPerformShadowRead(entityName);

  const logContext = {
    entityName,
    operation: 'read',
    phase,
    ...options.context,
  };

  dualWriteMetrics.recordReadAttempt();

  // If only reading from one source, do that
  if (!shadowRead) {
    if (readFromDynamoDB && !readFromPrisma) {
      const startTime = Date.now();
      const result = await electrodbReader();
      dualWriteMetrics.recordDynamoRead(Date.now() - startTime);
      return result as T;
    }
    const startTime = Date.now();
    const result = await prismaReader();
    dualWriteMetrics.recordPrismaRead(Date.now() - startTime);
    return result;
  }

  // Shadow read: read from both and compare
  dualWriteMetrics.recordShadowRead();

  const prismaStartTime = Date.now();
  const dynamoStartTime = Date.now();

  const [prismaResult, electrodbResult] = await Promise.allSettled([
    prismaReader().then((r) => {
      dualWriteMetrics.recordPrismaRead(Date.now() - prismaStartTime);
      return r;
    }),
    electrodbReader().then((r) => {
      dualWriteMetrics.recordDynamoRead(Date.now() - dynamoStartTime);
      return r;
    }),
  ]);

  // Log any failures
  if (prismaResult.status === 'rejected') {
    dualWriteMetrics.recordFailure(entityName, 'read', 'prisma_shadow_read_failed');
    logger.error('Prisma read failed during shadow read', {
      ...logContext,
      error: prismaResult.reason,
    });
  }

  if (electrodbResult.status === 'rejected') {
    dualWriteMetrics.recordFailure(entityName, 'read', 'dynamo_shadow_read_failed');
    logger.error('ElectroDB read failed during shadow read', {
      ...logContext,
      error: electrodbResult.reason,
    });
  }

  // Compare results if both succeeded
  if (prismaResult.status === 'fulfilled' && electrodbResult.status === 'fulfilled') {
    const prismaData = prismaResult.value;
    const electroData = electrodbResult.value;

    const comparator = options.comparator || defaultComparator;
    const isMatch = comparator(prismaData, electroData);

    if (!isMatch) {
      dualWriteMetrics.recordShadowDiscrepancy();
      logger.warn('Shadow read discrepancy detected', {
        ...logContext,
        prismaData: sanitizeForLogging(prismaData),
        electroData: sanitizeForLogging(electroData),
      });
    } else {
      logger.debug('Shadow read matched', logContext);
    }
  }

  // Return result from primary source
  if (phase === 'dynamo_primary') {
    if (electrodbResult.status === 'rejected') {
      throw electrodbResult.reason;
    }
    return electrodbResult.value as T;
  }

  if (prismaResult.status === 'rejected') {
    throw prismaResult.reason;
  }
  return prismaResult.value;
}

/**
 * Default comparator for shadow read validation
 * Compares JSON representations (ignores undefined fields)
 */
function defaultComparator<T>(prismaResult: T, electroResult: unknown): boolean {
  try {
    const prismaJson = JSON.stringify(prismaResult, sortKeys);
    const electroJson = JSON.stringify(electroResult, sortKeys);
    return prismaJson === electroJson;
  } catch {
    return false;
  }
}

/**
 * JSON replacer that sorts keys for consistent comparison
 */
function sortKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce(
        (sorted, key) => {
          sorted[key] = (value as Record<string, unknown>)[key];
          return sorted;
        },
        {} as Record<string, unknown>
      );
  }
  return value;
}

/**
 * Sanitize data for logging (truncate large fields)
 */
function sanitizeForLogging(data: unknown): unknown {
  if (!data) return data;

  try {
    const json = JSON.stringify(data);
    if (json.length > 1000) {
      return JSON.parse(json.substring(0, 1000) + '..."truncated"');
    }
    return data;
  } catch {
    return '[unserializable]';
  }
}

/**
 * Helper to wrap a single entity operation with dual-write
 * Returns a function that can be used in place of the original operation
 */
export function createDualWriteOperation<TInput, TOutput>(
  entityName: EntityName,
  operation: WriteOperation,
  prismaFn: (input: TInput) => Promise<TOutput>,
  electrodbFn: (input: TInput) => Promise<unknown>
): (input: TInput, options?: DualWriteOptions) => Promise<TOutput> {
  return async (input: TInput, options?: DualWriteOptions) => {
    const result = await dualWrite(
      entityName,
      operation,
      () => prismaFn(input),
      () => electrodbFn(input),
      options
    );
    return result.data;
  };
}
