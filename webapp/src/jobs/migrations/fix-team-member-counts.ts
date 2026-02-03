/**
 * Data Migration: Fix stale team memberCount values
 *
 * AWS Best Practice: Data migrations run via CDK Custom Resource
 * - Automatic execution during deployment
 * - Idempotent (safe to run multiple times)
 * - No manual intervention required
 *
 * Reference: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.custom_resources-readme.html
 */

import { DynamoDBClient, ScanCommand, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';

const client = new DynamoDBClient({});

interface MigrationResult {
  teamsProcessed: number;
  teamsUpdated: number;
  errors: string[];
}

/**
 * Scan all teams from DynamoDB
 * Uses pagination to handle tables of any size
 */
async function getAllTeams(tableName: string): Promise<Array<{ id: string; memberCount?: number }>> {
  const teams: Array<{ id: string; memberCount?: number }> = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(pk, :teamPrefix) AND sk = :metadata',
      ExpressionAttributeValues: marshall({
        ':teamPrefix': 'TEAM#',
        ':metadata': 'METADATA',
      }),
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const response = await client.send(command);

    if (response.Items) {
      for (const item of response.Items) {
        const unmarshalled = unmarshall(item);
        teams.push({
          id: unmarshalled.id,
          memberCount: unmarshalled.memberCount,
        });
      }
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return teams;
}

/**
 * Count actual members for a team by querying membership records
 * Counts both regular members (MEMBER#) and guests
 */
async function countTeamMembers(tableName: string, teamId: string): Promise<number> {
  let count = 0;
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :memberPrefix)',
      ExpressionAttributeValues: marshall({
        ':pk': `TEAM#${teamId}`,
        ':memberPrefix': 'MEMBER#',
      }),
      Select: 'COUNT',
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const response = await client.send(command);
    count += response.Count || 0;
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return count;
}

/**
 * Update team's memberCount to the correct value
 */
async function updateTeamMemberCount(tableName: string, teamId: string, correctCount: number): Promise<void> {
  const command = new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({
      pk: `TEAM#${teamId}`,
      sk: 'METADATA',
    }),
    UpdateExpression: 'SET memberCount = :count, updatedAt = :now',
    ExpressionAttributeValues: marshall({
      ':count': correctCount,
      ':now': new Date().toISOString(),
    }),
  });

  await client.send(command);
}

/**
 * Main migration function
 * Processes all teams and fixes any incorrect memberCount values
 */
export async function runMigration(tableName: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    teamsProcessed: 0,
    teamsUpdated: 0,
    errors: [],
  };

  console.log('[Migration] Starting team memberCount fix...');
  console.log(`[Migration] Table: ${tableName}`);

  try {
    const teams = await getAllTeams(tableName);
    console.log(`[Migration] Found ${teams.length} teams to process`);

    for (const team of teams) {
      result.teamsProcessed++;

      try {
        const actualCount = await countTeamMembers(tableName, team.id);
        const storedCount = team.memberCount ?? 0;

        if (actualCount !== storedCount) {
          console.log(`[Migration] Team ${team.id}: memberCount ${storedCount} -> ${actualCount}`);
          await updateTeamMemberCount(tableName, team.id, actualCount);
          result.teamsUpdated++;
        } else {
          console.log(`[Migration] Team ${team.id}: memberCount correct (${actualCount})`);
        }
      } catch (err) {
        const errorMsg = `Team ${team.id}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[Migration] Error processing ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log('[Migration] Complete!');
    console.log(`[Migration] Teams processed: ${result.teamsProcessed}`);
    console.log(`[Migration] Teams updated: ${result.teamsUpdated}`);
    if (result.errors.length > 0) {
      console.log(`[Migration] Errors: ${result.errors.length}`);
    }
  } catch (err) {
    const errorMsg = `Fatal error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[Migration] ${errorMsg}`);
    result.errors.push(errorMsg);
  }

  return result;
}

/**
 * Lambda handler for CDK Custom Resource
 * Handles Create/Update/Delete events from CloudFormation
 */
export async function handler(event: any): Promise<any> {
  console.log('[Migration Handler] Event:', JSON.stringify(event, null, 2));

  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (!tableName) {
    throw new Error('DYNAMODB_TABLE_NAME environment variable is required');
  }

  // For Delete events, nothing to do
  if (event.RequestType === 'Delete') {
    return {
      PhysicalResourceId: event.PhysicalResourceId || 'team-member-count-migration',
      Data: { message: 'Delete - no action required' },
    };
  }

  // For Create/Update, run the migration
  const result = await runMigration(tableName);

  // If there were errors, log them but don't fail the deployment
  // This allows the stack to complete even if some teams couldn't be processed
  if (result.errors.length > 0) {
    console.warn('[Migration Handler] Migration completed with errors:', result.errors);
  }

  return {
    PhysicalResourceId: 'team-member-count-migration',
    Data: {
      teamsProcessed: result.teamsProcessed,
      teamsUpdated: result.teamsUpdated,
      errorCount: result.errors.length,
    },
  };
}
