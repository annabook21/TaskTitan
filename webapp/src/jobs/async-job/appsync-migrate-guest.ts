/**
 * Handler for migrateGuestToUser AppSync mutation.
 *
 * Migrates guest data to authenticated user atomically using DynamoDB transactions:
 * 1. Verifies guest record exists
 * 2. Atomically: deletes guest membership, creates user membership, deletes guest record
 *
 * Uses transactions to ensure all-or-nothing execution with idempotency protection.
 */

import { logger } from '@/lib/logger';
import {
  executeTransaction,
  createTransactionItem,
  transactGet,
} from '@/lib/dynamodb/transactions';
import { getTableName } from '@/lib/dynamodb';

const TABLE_NAME = getTableName();

export interface MigrateGuestInput {
  guestId: string;
  teamId: string;
  userId: string; // The authenticated user ID
}

export interface MigrationResult {
  success: boolean;
  migratedAssignments: number;
  migratedComments: number;
  message: string | null;
}

export async function handleAppSyncMigrateGuestToUser(
  input: MigrateGuestInput
): Promise<MigrationResult> {
  const { guestId, teamId, userId } = input;

  logger.info('Starting guest migration', { guestId, teamId, userId });

  try {
    // Step 1: Read guest record and memberships atomically
    const [guestRecord, guestMembership, userMembership] = await transactGet([
      { pk: `GUEST#${guestId}`, sk: 'METADATA' },
      { pk: `TEAM#${teamId}`, sk: `MEMBER#${guestId}` },
      { pk: `TEAM#${teamId}`, sk: `MEMBER#${userId}` },
    ]);

    // Verify guest record exists
    if (!guestRecord || Object.keys(guestRecord).length === 0) {
      logger.warn('Guest record not found', { guestId });
      return {
        success: false,
        migratedAssignments: 0,
        migratedComments: 0,
        message: 'Guest record not found. You may have already migrated.',
      };
    }

    const guestName = (guestRecord as Record<string, unknown>).displayName as string || 'Guest';
    const hasGuestMembership = guestMembership && Object.keys(guestMembership).length > 0;
    const hasUserMembership = userMembership && Object.keys(userMembership).length > 0;

    // Build transaction items based on what needs to be done
    const transactionItems = [];
    const now = new Date().toISOString();

    // Always delete the guest record
    transactionItems.push(
      createTransactionItem('Delete', {
        TableName: TABLE_NAME,
        Key: {
          pk: `GUEST#${guestId}`,
          sk: 'METADATA',
        },
        // Condition: guest record must still exist (prevents race conditions)
        ConditionExpression: 'attribute_exists(pk)',
      })
    );

    // If guest membership exists, delete it
    if (hasGuestMembership) {
      transactionItems.push(
        createTransactionItem('Delete', {
          TableName: TABLE_NAME,
          Key: {
            pk: `TEAM#${teamId}`,
            sk: `MEMBER#${guestId}`,
          },
        })
      );
    }

    // If user membership doesn't exist, create it
    if (!hasUserMembership) {
      transactionItems.push(
        createTransactionItem('Put', {
          TableName: TABLE_NAME,
          Item: {
            pk: `TEAM#${teamId}`,
            sk: `MEMBER#${userId}`,
            id: `${teamId}#${userId}`,
            teamId: teamId,
            userId: userId,
            role: 'MEMBER',
            joinedAt: now,
            createdAt: now,
            updatedAt: now,
            gsi1pk: `USER#${userId}`,
            gsi1sk: `TEAM#${teamId}`,
          },
          // Condition: user membership must not exist (prevents duplicates)
          ConditionExpression: 'attribute_not_exists(pk)',
        })
      );

      logger.info('Will create user membership from guest', {
        teamId,
        userId,
        guestName,
      });
    } else {
      logger.info('User already has membership in team', { teamId, userId });
    }

    // Step 2: Execute transaction atomically with idempotency token
    // The token prevents duplicate execution if this Lambda is retried
    const idempotencyToken = `migrate-${guestId}-${teamId}-${userId}`;

    await executeTransaction(transactionItems, {
      clientRequestToken: idempotencyToken,
    });

    logger.info('Guest migration completed', {
      guestId,
      teamId,
      userId,
      transactionItemCount: transactionItems.length,
    });

    return {
      success: true,
      migratedAssignments: 0, // Future: count actual migrated assignments
      migratedComments: 0, // Future: count actual migrated comments
      message: `Successfully migrated from guest "${guestName}" to authenticated user.`,
    };
  } catch (error) {
    // Check for transaction cancellation due to condition failures
    const errorName = (error as { name?: string }).name;
    if (errorName === 'TransactionCanceledException') {
      logger.warn('Transaction cancelled - possible concurrent migration', {
        guestId,
        teamId,
        userId,
      });
      return {
        success: false,
        migratedAssignments: 0,
        migratedComments: 0,
        message: 'Migration failed - the guest may have already been migrated.',
      };
    }

    logger.error('Guest migration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      guestId,
      teamId,
      userId,
    });

    return {
      success: false,
      migratedAssignments: 0,
      migratedComments: 0,
      message: error instanceof Error ? error.message : 'Migration failed',
    };
  }
}
