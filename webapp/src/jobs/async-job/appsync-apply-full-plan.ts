/**
 * AppSync applyFullPlan Handler
 *
 * Atomically applies a generated plan to the database.
 * Creates components, dependencies, sprints, and assigns sprint membership.
 *
 * AWS Best Practices:
 * - Uses saga pattern for operations exceeding 25-item transaction limit
 * - Pre-generates UUIDs for name→ID resolution
 * - Handles UnprocessedItems with exponential backoff (AWS DynamoDB docs)
 * - Compensating actions for rollback on failure
 *
 * AWS Documentation References:
 * - BatchWriteItem: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/batch-operation-document-api-java.html
 * - Error handling: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html
 */

import { UpdateCommand, GetCommand, BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient, getTableName } from '@/lib/dynamodb';
import { executeSaga, chunkItems, type SagaStep } from '@/lib/dynamodb/transactions';
import { withRetry } from '@/lib/dynamodb/batch-ops';
import { logger } from '@/lib/logger';

export interface GeneratedComponentInput {
  name: string;
  description: string;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  parentName?: string;
  acceptanceCriteria?: string[];
}

export interface GeneratedSprintInput {
  name: string;
  goal: string;
  durationWeeks: number;
  componentNames: string[];
  capacity?: number;
}

export interface GeneratedEpicInput {
  name: string;
  description: string;
  componentNames: string[];
}

export interface ApplyFullPlanInput {
  projectId: string;
  components: GeneratedComponentInput[];
  enhancedDescription?: string;
  sprints?: GeneratedSprintInput[];
  epics?: GeneratedEpicInput[];
}

export interface ApplyPlanResult {
  created: number;
  dependencies: number;
  sprints: number;
  epics: number;
  componentIds: string[];
  sprintIds: string[];
}

interface ComponentWithId extends GeneratedComponentInput {
  id: string;
}

interface SprintWithId extends GeneratedSprintInput {
  id: string;
}

/**
 * AWS Best Practice: Execute BatchWriteItem with proper retry handling for UnprocessedItems
 *
 * Per AWS documentation: "If DynamoDB returns any unprocessed items, you should retry
 * the batch operation on those items. However, we strongly recommend that you use an
 * exponential backoff algorithm."
 *
 * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html
 */
async function batchWriteWithUnprocessedRetry(
  client: ReturnType<typeof getDynamoDBClient>,
  tableName: string,
  requests: Array<{ PutRequest?: { Item: Record<string, unknown> }; DeleteRequest?: { Key: Record<string, unknown> } }>,
  maxRetries = 5,
): Promise<void> {
  let unprocessed = requests;
  let retries = 0;

  while (unprocessed.length > 0 && retries < maxRetries) {
    const command = new BatchWriteCommand({
      RequestItems: {
        [tableName]: unprocessed,
      },
    });

    const response = await client.send(command);
    const unprocessedItems = response.UnprocessedItems?.[tableName] || [];

    if (unprocessedItems.length > 0) {
      // Filter to ensure Item/Key are defined (AWS guarantees this for valid responses)
      unprocessed = unprocessedItems.filter(
        (item): item is (typeof requests)[number] =>
          (item.PutRequest !== undefined && item.PutRequest.Item !== undefined) ||
          (item.DeleteRequest !== undefined && item.DeleteRequest.Key !== undefined),
      );
      retries++;

      if (retries < maxRetries) {
        // AWS Best Practice: Exponential backoff with jitter
        const baseDelay = 50;
        const maxDelay = 2000;
        const jitter = Math.random() * 100;
        const delay = Math.min(baseDelay * Math.pow(2, retries) + jitter, maxDelay);

        logger.warn('BatchWriteItem has unprocessed items, retrying with backoff', {
          unprocessedCount: unprocessed.length,
          retry: retries,
          delayMs: Math.round(delay),
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } else {
      // All items processed successfully
      unprocessed = [];
    }
  }

  if (unprocessed.length > 0) {
    logger.error('BatchWriteItem failed after max retries', {
      unprocessedCount: unprocessed.length,
      maxRetries,
    });
    throw new Error(
      `BatchWriteItem failed: ${unprocessed.length} items could not be processed after ${maxRetries} retries`,
    );
  }
}

/**
 * Handles AppSync applyFullPlan mutation.
 * Atomically creates all plan items in DynamoDB using saga pattern.
 */
export async function handleAppSyncApplyFullPlan(
  input: ApplyFullPlanInput,
  identity?: { sub?: string },
): Promise<ApplyPlanResult> {
  const { projectId, components, enhancedDescription, sprints = [], epics = [] } = input;
  const client = getDynamoDBClient();
  const tableName = getTableName();

  logger.info('Applying full plan', {
    projectId,
    componentCount: components.length,
    sprintCount: sprints.length,
    epicCount: epics.length,
    userId: identity?.sub,
  });

  // Step 0: Fetch project to get teamId (with retry for transient errors)
  const projectResult = await withRetry(
    async () =>
      client.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: `PROJECT#${projectId}`,
            sk: 'METADATA',
          },
        }),
      ),
    { maxRetries: 3 },
  );

  if (!projectResult.Item) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const teamId = projectResult.Item.teamId as string;

  // Step 0.5: Verify user has access to the team (authorization check)
  // AWS Best Practice: Always verify authorization before modifying resources
  if (identity?.sub) {
    const membershipResult = await withRetry(
      async () =>
        client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: 'gsi1',
            KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :sk)',
            ExpressionAttributeValues: {
              ':pk': `TEAM#${teamId}`,
              ':sk': `MEMBER#${identity.sub}`,
            },
            Limit: 1,
          }),
        ),
      { maxRetries: 3 },
    );

    if (!membershipResult.Items || membershipResult.Items.length === 0) {
      logger.warn('Unauthorized access attempt', { userId: identity.sub, teamId, projectId });
      throw new Error('Unauthorized: You do not have access to this project');
    }

    logger.info('Authorization check passed', { userId: identity.sub, teamId });
  }

  const now = new Date().toISOString();

  // Step 1: Pre-generate UUIDs and create name→ID mappings
  const nameToId = new Map<string, string>();
  const componentsWithIds: ComponentWithId[] = components.map((c) => {
    const id = crypto.randomUUID();
    nameToId.set(c.name, id);
    return { ...c, id };
  });

  const sprintsWithIds: SprintWithId[] = sprints.map((s) => {
    const id = crypto.randomUUID();
    return { ...s, id };
  });

  logger.info('Pre-generated IDs', {
    componentIds: componentsWithIds.length,
    sprintIds: sprintsWithIds.length,
  });

  // Track created items for rollback
  const createdComponentIds: string[] = [];
  const createdSprintIds: string[] = [];
  const createdDependencyPairs: Array<{ fromId: string; toId: string }> = [];

  // Define saga steps
  const sagaSteps: SagaStep<unknown>[] = [];

  // Step 2: Create components (without parentId first)
  const componentChunks = chunkItems(componentsWithIds, 25);
  for (let i = 0; i < componentChunks.length; i++) {
    const chunk = componentChunks[i];
    sagaSteps.push({
      name: `CreateComponents_Chunk_${i + 1}`,
      execute: async () => {
        const putRequests = chunk.map((c) => ({
          PutRequest: {
            Item: {
              pk: `COMPONENT#${c.id}`,
              sk: 'METADATA',
              id: c.id,
              projectId,
              name: c.name,
              description: c.description,
              type: c.type,
              status: 'PLANNING',
              estimatedHours: c.estimatedHours,
              priority: c.priority * 10, // Convert 1-10 to 10-100
              acceptanceCriteria: c.acceptanceCriteria || [],
              createdAt: now,
              updatedAt: now,
              // GSI1: Project → Components
              gsi1pk: `PROJECT#${projectId}`,
              gsi1sk: `COMPONENT#${c.id}`,
            },
          },
        }));

        // AWS Best Practice: Handle UnprocessedItems with exponential backoff
        await batchWriteWithUnprocessedRetry(client, tableName, putRequests);

        chunk.forEach((c) => createdComponentIds.push(c.id));
        logger.info('Created component chunk', { chunkIndex: i, count: chunk.length });
      },
      compensate: async () => {
        // Delete created components
        const idsToDelete = chunk.map((c) => c.id).filter((id) => createdComponentIds.includes(id));
        if (idsToDelete.length === 0) return;

        const deleteRequests = idsToDelete.map((id) => ({
          DeleteRequest: {
            Key: {
              pk: `COMPONENT#${id}`,
              sk: 'METADATA',
            },
          },
        }));

        // AWS Best Practice: Handle UnprocessedItems in compensate as well
        await batchWriteWithUnprocessedRetry(client, tableName, deleteRequests);
        logger.info('Compensated: deleted components', { count: idsToDelete.length });
      },
    });
  }

  // Step 3: Update components with parentId (resolve parentName to ID)
  const componentsWithParent = componentsWithIds.filter((c) => c.parentName && nameToId.has(c.parentName));
  if (componentsWithParent.length > 0) {
    const parentChunks = chunkItems(componentsWithParent, 25);
    for (let i = 0; i < parentChunks.length; i++) {
      const chunk = parentChunks[i];
      sagaSteps.push({
        name: `UpdateParentIds_Chunk_${i + 1}`,
        execute: async () => {
          // AWS Best Practice: Parallel updates with retry
          await Promise.all(
            chunk.map((c) => {
              const parentId = nameToId.get(c.parentName!);
              if (!parentId) return Promise.resolve();

              return withRetry(
                () =>
                  client.send(
                    new UpdateCommand({
                      TableName: tableName,
                      Key: {
                        pk: `COMPONENT#${c.id}`,
                        sk: 'METADATA',
                      },
                      UpdateExpression: 'SET parentId = :parentId, updatedAt = :now',
                      ExpressionAttributeValues: {
                        ':parentId': parentId,
                        ':now': now,
                      },
                    }),
                  ),
                { maxRetries: 3 },
              );
            }),
          );
          logger.info('Updated parent IDs', { chunkIndex: i, count: chunk.length });
        },
        compensate: async () => {
          // Clear parentId on these components
          // AWS Best Practice: Use Promise.allSettled to ensure all compensations are attempted
          const results = await Promise.allSettled(
            chunk.map((c) =>
              withRetry(
                () =>
                  client.send(
                    new UpdateCommand({
                      TableName: tableName,
                      Key: {
                        pk: `COMPONENT#${c.id}`,
                        sk: 'METADATA',
                      },
                      UpdateExpression: 'REMOVE parentId SET updatedAt = :now',
                      ExpressionAttributeValues: {
                        ':now': now,
                      },
                    }),
                  ),
                { maxRetries: 3 },
              ),
            ),
          );
          const failures = results.filter((r) => r.status === 'rejected');
          if (failures.length > 0) {
            logger.warn('Some compensation actions failed', { failedCount: failures.length, total: chunk.length });
          }
          logger.info('Compensated: cleared parent IDs', { count: chunk.length });
        },
      });
    }
  }

  // Step 4: Create dependencies
  const dependencyPairs: Array<{ fromId: string; toId: string; fromName: string; toName: string }> = [];
  for (const c of componentsWithIds) {
    for (const depName of c.suggestedDependencies) {
      const depId = nameToId.get(depName);
      if (depId && depId !== c.id) {
        dependencyPairs.push({
          fromId: c.id,
          toId: depId,
          fromName: c.name,
          toName: depName,
        });
      }
    }
  }

  if (dependencyPairs.length > 0) {
    // Each dependency is 1 item (forward direction only in this model)
    const depChunks = chunkItems(dependencyPairs, 25);
    for (let i = 0; i < depChunks.length; i++) {
      const chunk = depChunks[i];
      sagaSteps.push({
        name: `CreateDependencies_Chunk_${i + 1}`,
        execute: async () => {
          const putRequests = chunk.map((dep) => ({
            PutRequest: {
              Item: {
                pk: `COMPONENT#${dep.fromId}`,
                sk: `DEPENDS_ON#${dep.toId}`,
                dependsOnId: dep.toId,
                createdAt: now,
                // GSI1: Reverse lookup (who depends on me)
                gsi1pk: `REQUIRED_BY#${dep.toId}`,
                gsi1sk: `COMPONENT#${dep.fromId}`,
              },
            },
          }));

          // AWS Best Practice: Handle UnprocessedItems
          await batchWriteWithUnprocessedRetry(client, tableName, putRequests);

          chunk.forEach((dep) => createdDependencyPairs.push({ fromId: dep.fromId, toId: dep.toId }));
          logger.info('Created dependencies', { chunkIndex: i, count: chunk.length });
        },
        compensate: async () => {
          const pairsToDelete = chunk.filter((dep) =>
            createdDependencyPairs.some((p) => p.fromId === dep.fromId && p.toId === dep.toId),
          );
          if (pairsToDelete.length === 0) return;

          const deleteRequests = pairsToDelete.map((dep) => ({
            DeleteRequest: {
              Key: {
                pk: `COMPONENT#${dep.fromId}`,
                sk: `DEPENDS_ON#${dep.toId}`,
              },
            },
          }));

          // AWS Best Practice: Handle UnprocessedItems
          await batchWriteWithUnprocessedRetry(client, tableName, deleteRequests);
          logger.info('Compensated: deleted dependencies', { count: pairsToDelete.length });
        },
      });
    }
  }

  // Step 5: Create sprints
  if (sprintsWithIds.length > 0) {
    const sprintChunks = chunkItems(sprintsWithIds, 25);
    for (let i = 0; i < sprintChunks.length; i++) {
      const chunk = sprintChunks[i];
      sagaSteps.push({
        name: `CreateSprints_Chunk_${i + 1}`,
        execute: async () => {
          const putRequests = chunk.map((s, idx) => ({
            PutRequest: {
              Item: {
                pk: `SPRINT#${s.id}`,
                sk: 'METADATA',
                id: s.id,
                teamId,
                projectId,
                name: s.name,
                goal: s.goal,
                durationWeeks: s.durationWeeks,
                status: 'PLANNING',
                capacity: s.capacity,
                sprintNumber: idx + 1,
                createdAt: now,
                updatedAt: now,
                // GSI1: Team → Sprints
                gsi1pk: `TEAM#${teamId}`,
                gsi1sk: `SPRINT#${s.id}`,
                // GSI2: Project → Sprints
                gsi2pk: `PROJECT#${projectId}`,
                gsi2sk: `SPRINT#${s.id}`,
              },
            },
          }));

          // AWS Best Practice: Handle UnprocessedItems
          await batchWriteWithUnprocessedRetry(client, tableName, putRequests);

          chunk.forEach((s) => createdSprintIds.push(s.id));
          logger.info('Created sprints', { chunkIndex: i, count: chunk.length });
        },
        compensate: async () => {
          const idsToDelete = chunk.map((s) => s.id).filter((id) => createdSprintIds.includes(id));
          if (idsToDelete.length === 0) return;

          const deleteRequests = idsToDelete.map((id) => ({
            DeleteRequest: {
              Key: {
                pk: `SPRINT#${id}`,
                sk: 'METADATA',
              },
            },
          }));

          // AWS Best Practice: Handle UnprocessedItems
          await batchWriteWithUnprocessedRetry(client, tableName, deleteRequests);
          logger.info('Compensated: deleted sprints', { count: idsToDelete.length });
        },
      });
    }
  }

  // Step 6: Assign components to sprints
  for (const sprint of sprintsWithIds) {
    const componentIdsForSprint = sprint.componentNames
      .map((name) => nameToId.get(name))
      .filter((id): id is string => id !== undefined);

    if (componentIdsForSprint.length > 0) {
      const assignChunks = chunkItems(componentIdsForSprint, 25);
      for (let i = 0; i < assignChunks.length; i++) {
        const chunk = assignChunks[i];
        sagaSteps.push({
          name: `AssignToSprint_${sprint.name}_Chunk_${i + 1}`,
          execute: async () => {
            // AWS Best Practice: Parallel updates with retry
            await Promise.all(
              chunk.map((componentId) =>
                withRetry(
                  () =>
                    client.send(
                      new UpdateCommand({
                        TableName: tableName,
                        Key: {
                          pk: `COMPONENT#${componentId}`,
                          sk: 'METADATA',
                        },
                        UpdateExpression:
                          'SET sprintId = :sprintId, gsi2pk = :gsi2pk, gsi2sk = :gsi2sk, updatedAt = :now',
                        ExpressionAttributeValues: {
                          ':sprintId': sprint.id,
                          ':gsi2pk': `SPRINT#${sprint.id}`,
                          ':gsi2sk': `COMPONENT#${componentId}`,
                          ':now': now,
                        },
                      }),
                    ),
                  { maxRetries: 3 },
                ),
              ),
            );
            logger.info('Assigned components to sprint', {
              sprintName: sprint.name,
              chunkIndex: i,
              count: chunk.length,
            });
          },
          compensate: async () => {
            // AWS Best Practice: Use Promise.allSettled to ensure all compensations are attempted
            const results = await Promise.allSettled(
              chunk.map((componentId) =>
                withRetry(
                  () =>
                    client.send(
                      new UpdateCommand({
                        TableName: tableName,
                        Key: {
                          pk: `COMPONENT#${componentId}`,
                          sk: 'METADATA',
                        },
                        UpdateExpression: 'REMOVE sprintId, gsi2pk, gsi2sk SET updatedAt = :now',
                        ExpressionAttributeValues: {
                          ':now': now,
                        },
                      }),
                    ),
                  { maxRetries: 3 },
                ),
              ),
            );
            const failures = results.filter((r) => r.status === 'rejected');
            if (failures.length > 0) {
              logger.warn('Some compensation actions failed', { failedCount: failures.length, total: chunk.length });
            }
            logger.info('Compensated: unassigned components from sprint', {
              sprintName: sprint.name,
              count: chunk.length,
            });
          },
        });
      }
    }
  }

  // Step 7: Update project description if enhanced
  if (enhancedDescription) {
    sagaSteps.push({
      name: 'UpdateProjectDescription',
      execute: async () => {
        await withRetry(
          () =>
            client.send(
              new UpdateCommand({
                TableName: tableName,
                Key: {
                  pk: `PROJECT#${projectId}`,
                  sk: 'METADATA',
                },
                UpdateExpression: 'SET description = :desc, updatedAt = :now',
                ExpressionAttributeValues: {
                  ':desc': enhancedDescription,
                  ':now': now,
                },
              }),
            ),
          { maxRetries: 3 },
        );
        logger.info('Updated project description');
      },
      compensate: async () => {
        // Note: We don't store original description, so we skip compensate
        // In production, consider storing original value first
        logger.info('Compensated: project description update skipped (no original stored)');
      },
    });
  }

  // Execute the saga
  logger.info('Executing saga', { stepCount: sagaSteps.length });
  const sagaResult = await executeSaga(sagaSteps);

  if (!sagaResult.success) {
    logger.error('Saga failed', {
      failedStep: sagaResult.failedStepName,
      error: sagaResult.error?.message,
      compensationErrors: sagaResult.compensationErrors?.map((e) => e.message),
    });
    throw new Error(`Failed to apply plan at step: ${sagaResult.failedStepName}`);
  }

  logger.info('Plan applied successfully', {
    created: createdComponentIds.length,
    dependencies: createdDependencyPairs.length,
    sprints: createdSprintIds.length,
    epics: epics.length,
  });

  return {
    created: createdComponentIds.length,
    dependencies: createdDependencyPairs.length,
    sprints: createdSprintIds.length,
    epics: epics.length,
    componentIds: createdComponentIds,
    sprintIds: createdSprintIds,
  };
}
