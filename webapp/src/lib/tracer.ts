/**
 * Distributed Tracing with AWS Powertools for Lambda
 *
 * This provides X-Ray tracing integration for request tracking across services.
 * Traces help identify performance bottlenecks and visualize request flow.
 *
 * Note: Powertools Tracer is designed for Lambda. In ECS/Fargate environments,
 * tracing operations are no-ops to prevent errors.
 *
 * @see https://docs.powertools.aws.dev/lambda/typescript/latest/core/tracer/
 */

import { Tracer } from '@aws-lambda-powertools/tracer';

const serviceName = process.env.POWERTOOLS_SERVICE_NAME || 'TaskTitan';

// Detect if we're running in a Lambda environment
// Lambda sets AWS_LAMBDA_FUNCTION_NAME, ECS/Fargate does not
const isLambdaEnvironment = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/**
 * Main tracer instance for X-Ray integration
 *
 * In non-Lambda environments (ECS/Fargate), tracing is disabled to prevent errors.
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
  captureHTTPsRequests: isLambdaEnvironment,
  // Disable tracing in non-Lambda environments
  enabled: isLambdaEnvironment,
});

/**
 * Decorator for tracing async functions
 * No-op in non-Lambda environments.
 *
 * @example
 * const tracedFunction = withTracing('fetchUserData', async (userId: string) => {
 *   // ... fetch user data
 * });
 */
export function withTracing<T extends (...args: unknown[]) => Promise<unknown>>(name: string, fn: T): T {
  // Skip tracing in non-Lambda environments
  if (!isLambdaEnvironment) {
    return fn;
  }

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
 * Useful for adding business context to traces.
 * No-op in non-Lambda environments.
 */
export function addTraceMetadata(key: string, value: unknown) {
  if (!isLambdaEnvironment) return;
  tracer.putMetadata(key, value);
}

/**
 * Add annotation to the current trace segment
 * Annotations are indexed and can be used for filtering in X-Ray.
 * No-op in non-Lambda environments.
 */
export function addTraceAnnotation(key: string, value: string | number | boolean) {
  if (!isLambdaEnvironment) return;
  tracer.putAnnotation(key, value);
}

export default tracer;
