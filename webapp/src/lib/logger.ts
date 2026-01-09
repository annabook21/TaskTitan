/**
 * Structured Logging with AWS Powertools for Lambda
 *
 * This provides structured JSON logging that integrates with CloudWatch Logs Insights
 * for easy searching and analysis. The logger automatically includes:
 * - Correlation IDs for request tracing
 * - Lambda context (function name, memory, cold start detection)
 * - Custom attributes for business context
 *
 * @see https://docs.powertools.aws.dev/lambda/typescript/latest/core/logger/
 */

import { Logger } from '@aws-lambda-powertools/logger';

// Environment-based configuration
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const serviceName = process.env.POWERTOOLS_SERVICE_NAME || 'TaskTitan';
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');

/**
 * Main application logger instance
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/lib/logger';
 *
 * logger.info('User created project', { projectId: '123', userId: 'abc' });
 * logger.error('Failed to save component', { error: err.message, componentId: '456' });
 * ```
 */
export const logger = new Logger({
  serviceName,
  logLevel: logLevel as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  // Include Lambda context automatically when running in Lambda
  persistentLogAttributes: {
    environment: process.env.NODE_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
  },
});

/**
 * Create a child logger with additional persistent attributes
 * Useful for adding request-specific context
 *
 * @example
 * const requestLogger = createChildLogger({ requestId: 'abc-123', userId: 'user-456' });
 * requestLogger.info('Processing request');
 */
export function createChildLogger(attributes: Record<string, unknown>) {
  return logger.createChild({
    persistentLogAttributes: attributes,
  });
}

/**
 * Log levels for structured logging:
 *
 * - DEBUG: Detailed information for debugging (local dev)
 * - INFO: General operational information (production)
 * - WARN: Warning conditions that should be addressed
 * - ERROR: Error conditions that need immediate attention
 *
 * CloudWatch Logs Insights query examples:
 *
 * Find all errors:
 * fields @timestamp, @message | filter level = "ERROR" | sort @timestamp desc
 *
 * Find requests for a specific user:
 * fields @timestamp, @message | filter userId = "user-123" | sort @timestamp desc
 *
 * Find slow operations (>1s):
 * fields @timestamp, @message, duration | filter duration > 1000 | sort duration desc
 */

// For local development, provide a simpler console-based fallback
export const log = {
  debug: (message: string, attributes?: Record<string, unknown>) => {
    if (isLambda) {
      logger.debug(message, { extra: attributes });
    } else if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG] ${message}`, attributes || '');
    }
  },
  info: (message: string, attributes?: Record<string, unknown>) => {
    if (isLambda) {
      logger.info(message, { extra: attributes });
    } else {
      console.info(`[INFO] ${message}`, attributes || '');
    }
  },
  warn: (message: string, attributes?: Record<string, unknown>) => {
    if (isLambda) {
      logger.warn(message, { extra: attributes });
    } else {
      console.warn(`[WARN] ${message}`, attributes || '');
    }
  },
  error: (message: string, attributes?: Record<string, unknown>) => {
    if (isLambda) {
      logger.error(message, { extra: attributes });
    } else {
      console.error(`[ERROR] ${message}`, attributes || '');
    }
  },
};

export default logger;
