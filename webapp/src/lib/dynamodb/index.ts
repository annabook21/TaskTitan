/**
 * DynamoDB Client Configuration for TaskTitan
 *
 * FORGE v2: ElectroDB-based data layer for DynamoDB single-table design
 * Reference: https://electrodb.dev/en/core-concepts/introduction/
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Singleton client instance
let client: DynamoDBDocumentClient | null = null;

/**
 * Get the DynamoDB Document Client singleton
 * Uses AWS SDK v3 with automatic marshalling/unmarshalling
 */
export function getDynamoDBClient(): DynamoDBDocumentClient {
  if (!client) {
    const ddbClient = new DynamoDBClient({
      // Region is auto-detected from AWS_REGION env var in Lambda/ECS
      // or can be explicitly set for local development
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
      }),
    });

    client = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: {
        // Convert empty strings to null (DynamoDB doesn't support empty strings)
        convertEmptyValues: true,
        // Remove undefined values from items
        removeUndefinedValues: true,
      },
      unmarshallOptions: {
        // Return numbers as strings to avoid precision issues with large numbers
        wrapNumbers: false,
      },
    });
  }

  return client;
}

/**
 * Table name from environment variable
 * Set by CDK infrastructure: DYNAMODB_TABLE_NAME
 */
export function getTableName(): string {
  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (!tableName) {
    throw new Error('DYNAMODB_TABLE_NAME environment variable is not set');
  }
  return tableName;
}

/**
 * Reset client (useful for testing)
 */
export function resetClient(): void {
  client = null;
}

export { getDynamoDBClient as getClient };
