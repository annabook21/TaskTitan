/**
 * Bedrock Client Singleton
 *
 * Provides a lazy-initialized Bedrock client for AI operations with retry configuration.
 */

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// Lazy-initialize Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Gets or creates the singleton Bedrock client instance.
 * Client is initialized with the AWS region from environment or defaults to us-west-2.
 * Includes retry configuration for better resilience against throttling and transient errors.
 *
 * @returns Bedrock runtime client instance
 */
export function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    const region = process.env.AWS_REGION || 'us-west-2';

    bedrockClient = new BedrockRuntimeClient({
      region,
      // Configure retry strategy for better resilience
      maxAttempts: 3, // Retry up to 3 times
      retryMode: 'adaptive', // Use adaptive retry mode for better handling of throttling
    });
  }
  return bedrockClient;
}
