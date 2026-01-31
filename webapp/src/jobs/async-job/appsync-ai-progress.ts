/**
 * AppSync AI Progress Handler
 *
 * Handles async AI generation with progress updates via AppSync subscriptions.
 * Pattern: startAIGeneration -> async Lambda -> publishAIProgress -> client subscription
 *
 * Progress stages (realistic pacing):
 * - 10%: "Fetching project context..."
 * - 25%: "Analyzing requirements..."
 * - 50%: "Generating components..."
 * - 75%: "Creating sprint plan..."
 * - 90%: "Organizing dependencies..."
 * - 100%: "Complete!"
 */

import { Sha256 } from '@aws-crypto/sha256-js';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { fromEnv } from '@aws-sdk/credential-providers';
import { handleAppSyncGenerateFullPlan, type FullPlanResult } from './appsync-generate-full-plan';
import { handleAppSyncApplyFullPlan, type GeneratedComponentInput } from './appsync-apply-full-plan';
import { logger } from '@/lib/logger';

export interface StartAIGenerationInput {
  type: 'startAIGeneration';
  sessionId: string;
  projectId: string;
  generateEpics?: boolean;
  graphqlUrl: string;
}

type AIJobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

interface PublishProgressInput {
  sessionId: string;
  progress: number;
  message: string;
  status: AIJobStatus;
  result?: FullPlanResult;
  error?: string;
}

/**
 * Calls AppSync publishAIProgress mutation via IAM auth.
 * This triggers the onAIProgress subscription for connected clients.
 */
async function publishProgress(
  graphqlUrl: string,
  input: PublishProgressInput
): Promise<void> {
  const { sessionId, progress, message, status, result, error } = input;

  const mutation = `
    mutation PublishAIProgress(
      $sessionId: ID!
      $progress: Int!
      $message: String!
      $status: AIJobStatus!
      $result: FullPlanResultInput
      $error: String
    ) {
      publishAIProgress(
        sessionId: $sessionId
        progress: $progress
        message: $message
        status: $status
        result: $result
        error: $error
      ) {
        sessionId
        progress
        message
        status
      }
    }
  `;

  const variables: Record<string, unknown> = {
    sessionId,
    progress,
    message,
    status,
  };

  // Only include result/error if present (avoid null in GraphQL)
  if (result) {
    variables.result = {
      components: result.components.map((c) => ({
        name: c.name,
        description: c.description,
        type: c.type,
        estimatedHours: c.estimatedHours,
        priority: c.priority,
        suggestedDependencies: c.suggestedDependencies || [],
        parentName: c.parentName,
        acceptanceCriteria: c.acceptanceCriteria,
      })),
      summary: result.summary,
      enhancedDescription: result.enhancedDescription,
      sprints: result.sprints?.map((s) => ({
        name: s.name,
        goal: s.goal,
        durationWeeks: s.durationWeeks,
        componentNames: s.componentNames || [],
        capacity: s.capacity,
      })),
      epics: result.epics?.map((e) => ({
        name: e.name,
        description: e.description,
        componentNames: e.componentNames || [],
      })),
    };
  }
  if (error) {
    variables.error = error;
  }

  const body = JSON.stringify({
    query: mutation,
    variables,
  });

  // Parse URL for signing
  const url = new URL(graphqlUrl);
  const request = new HttpRequest({
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    body,
  });

  // Sign request with IAM credentials using SDK credential chain
  // AWS Best Practice: Use credential providers instead of explicit env vars
  const signer = new SignatureV4({
    credentials: fromEnv(),
    region: process.env.AWS_REGION || 'us-east-2',
    service: 'appsync',
    sha256: Sha256,
  });

  const signedRequest = await signer.sign(request);

  // Execute request with timeout
  // AWS Best Practice: All external API calls must have explicit timeouts
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: signedRequest.headers as Record<string, string>,
    body,
    signal: AbortSignal.timeout(30000), // 30 second timeout
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error('Failed to publish progress', { status: response.status, body: text });
    throw new Error(`Failed to publish progress: ${response.status}`);
  }

  // Parse response with error handling for invalid JSON
  let responseBody: { errors?: Array<{ message: string }> };
  try {
    responseBody = await response.json();
  } catch (parseError) {
    logger.error('Failed to parse AppSync response', { parseError });
    throw new Error('Invalid response from AppSync');
  }

  if (responseBody.errors) {
    logger.error('GraphQL errors in publishProgress', { errors: responseBody.errors });
    // Sanitize error message for client - don't expose internal details
    throw new Error('Failed to publish progress update');
  }

  logger.info('Progress published', { sessionId, progress, status });
}

/**
 * Handles async startAIGeneration event.
 * Publishes progress updates at each stage, then final result.
 */
export async function handleStartAIGeneration(
  input: StartAIGenerationInput
): Promise<void> {
  const { sessionId, projectId, generateEpics, graphqlUrl } = input;

  logger.info('Starting async AI generation', { sessionId, projectId, generateEpics });

  try {
    // Stage 1: Starting (10%)
    await publishProgress(graphqlUrl, {
      sessionId,
      progress: 10,
      message: 'Fetching project context...',
      status: 'IN_PROGRESS',
    });

    // Small delay for realistic progress feeling
    await sleep(500);

    // Stage 2: Analyzing (25%)
    await publishProgress(graphqlUrl, {
      sessionId,
      progress: 25,
      message: 'Analyzing requirements...',
      status: 'IN_PROGRESS',
    });

    // Stage 3: Generating (50%) - this is where the actual Bedrock call starts
    await publishProgress(graphqlUrl, {
      sessionId,
      progress: 50,
      message: 'Generating components with AI...',
      status: 'IN_PROGRESS',
    });

    // Execute the actual AI generation (this takes ~20-30 seconds)
    const result = await handleAppSyncGenerateFullPlan({
      projectId,
      generateEpics,
    });

    logger.info('AI generation completed, now applying plan directly', {
      sessionId,
      componentCount: result.components?.length ?? 0,
      sprintCount: result.sprints?.length ?? 0,
      epicCount: result.epics?.length ?? 0,
    });

    // Stage 4: Sprint planning (75%)
    await publishProgress(graphqlUrl, {
      sessionId,
      progress: 75,
      message: 'Creating sprint plan...',
      status: 'IN_PROGRESS',
    });

    // Apply the plan directly to DynamoDB (instead of passing through subscription)
    // This fixes the issue where large result objects don't reliably pass through WebSocket
    const applyResult = await handleAppSyncApplyFullPlan({
      projectId,
      components: result.components as GeneratedComponentInput[],
      enhancedDescription: result.enhancedDescription,
      sprints: result.sprints,
      epics: result.epics,
    });

    logger.info('Plan applied directly to DynamoDB', {
      sessionId,
      created: applyResult.created,
      dependencies: applyResult.dependencies,
      sprints: applyResult.sprints,
    });

    // Stage 5: Organizing (90%)
    await publishProgress(graphqlUrl, {
      sessionId,
      progress: 90,
      message: 'Organizing dependencies...',
      status: 'IN_PROGRESS',
    });

    await sleep(300);

    // Stage 6: Complete (100%) - NO result passed, plan already applied
    await publishProgress(graphqlUrl, {
      sessionId,
      progress: 100,
      message: 'Generation complete!',
      status: 'COMPLETED',
      // Note: result intentionally omitted - plan already applied to DynamoDB
    });

    logger.info('Async AI generation completed successfully', {
      sessionId,
      componentCount: result.components?.length ?? 0,
      sprintCount: result.sprints?.length ?? 0,
      appliedComponents: applyResult.created,
      appliedDependencies: applyResult.dependencies,
    });
  } catch (error) {
    logger.error('Async AI generation failed', { sessionId, error });

    // Sanitize error message for client - don't expose internal details
    // Log full error for debugging, but only send safe message to client
    const internalMessage = error instanceof Error ? error.message : 'Unknown error';
    const clientMessage = internalMessage.includes('Unauthorized')
      ? 'You do not have permission to perform this action.'
      : internalMessage.includes('timeout') || internalMessage.includes('Timeout')
        ? 'The request timed out. Please try again.'
        : internalMessage.includes('not found') || internalMessage.includes('Not found')
          ? 'The requested resource was not found.'
          : 'AI generation failed. Please try again or contact support.';

    await publishProgress(graphqlUrl, {
      sessionId,
      progress: 0,
      message: clientMessage,
      status: 'FAILED',
      error: clientMessage,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
