/**
 * Distributed Tracing with AWS Powertools for Lambda
 *
 * This provides X-Ray tracing integration for request tracking across services.
 * Traces help identify performance bottlenecks and visualize request flow.
 *
 * @see https://docs.powertools.aws.dev/lambda/typescript/latest/core/tracer/
 */

import { Tracer } from '@aws-lambda-powertools/tracer';

const serviceName = process.env.POWERTOOLS_SERVICE_NAME || 'TaskTitan';

/**
 * Main tracer instance for X-Ray integration
 *
 * Usage:
 * ```typescript
 * import { tracer } from '@/lib/tracer';
 *
 * // Capture AWS SDK clients automatically
 * const client = tracer.captureAWSv3Client(new DynamoDBClient({}));
 *
 * // Add custom subsegments for detailed tracing
 * const subsegment = tracer.getSegment()?.addNewSubsegment('database-query');
 * try {
 *   // ... your code
 *   subsegment?.close();
 * } catch (err) {
 *   subsegment?.addError(err as Error);
 *   subsegment?.close();
 *   throw err;
 * }
 * ```
 */
export const tracer = new Tracer({
  serviceName,
  // Capture response data for debugging (disable in production if sensitive)
  captureHTTPsRequests: true,
});

/**
 * Decorator for tracing async functions
 *
 * @example
 * const tracedFunction = withTracing('fetchUserData', async (userId: string) => {
 *   // ... fetch user data
 * });
 */
export function withTracing<T extends (...args: unknown[]) => Promise<unknown>>(name: string, fn: T): T {
  return (async (...args: Parameters<T>) => {
    const segment = tracer.getSegment();
    const subsegment = segment?.addNewSubsegment(name);

    try {
      const result = await fn(...args);
      subsegment?.close();
      return result;
    } catch (error) {
      subsegment?.addError(error as Error);
      subsegment?.close();
      throw error;
    }
  }) as T;
}

/**
 * Add metadata to the current trace segment
 * Useful for adding business context to traces
 */
export function addTraceMetadata(key: string, value: unknown) {
  tracer.putMetadata(key, value);
}

/**
 * Add annotation to the current trace segment
 * Annotations are indexed and can be used for filtering in X-Ray
 */
export function addTraceAnnotation(key: string, value: string | number | boolean) {
  tracer.putAnnotation(key, value);
}

export default tracer;
