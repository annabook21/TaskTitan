/**
 * Bedrock Client Singleton
 *
 * Provides a lazy-initialized Bedrock client for AI operations.
 */

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// Lazy-initialize Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Gets or creates the singleton Bedrock client instance.
 * Client is initialized with the AWS region from environment or defaults to us-west-2.
 *
 * @returns Bedrock runtime client instance
 */
export function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'us-west-2',
    });
  }
  return bedrockClient;
}
