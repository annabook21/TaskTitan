import { notifyJobHandler, notifyJobSchema } from '@/jobs/async-job/notify';
import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { handleAppSyncGenerateComponentViaAI } from '@/jobs/async-job/appsync-bedrock';
import { handleAppSyncGetTeamMetrics } from '@/jobs/async-job/appsync-metrics';
import { handleAppSyncGenerateFullPlan } from '@/jobs/async-job/appsync-generate-full-plan';
import { handleAppSyncApplyFullPlan } from '@/jobs/async-job/appsync-apply-full-plan';
import { handleAppSyncRefineComponent } from '@/jobs/async-job/appsync-refine-component';
import { handleAppSyncGuestRefineComponent } from '@/jobs/async-job/appsync-guest-refine-component';
import { handleAppSyncRefineBulkPlan } from '@/jobs/async-job/appsync-refine-bulk-plan';
import { handleAppSyncSmartComponent } from '@/jobs/async-job/appsync-smart-component';
import { handleAppSyncPlanSprint } from '@/jobs/async-job/appsync-plan-sprint';
import { handleAppSyncApplyTemplate } from '@/jobs/async-job/appsync-apply-template';
import { handleAppSyncSuggestBreakdown } from '@/jobs/async-job/appsync-suggest-breakdown';
import { handleAppSyncGenerateWireframe } from '@/jobs/async-job/appsync-generate-wireframe';
import { handleAppSyncAnalyzeImport, handleAppSyncCleanupImport } from '@/jobs/async-job/appsync-import-analysis';
import { handleAppSyncGenerateRetrospective } from '@/jobs/async-job/appsync-generate-retrospective';
import { handleStartAIGeneration } from '@/jobs/async-job/appsync-ai-progress';
import { handleAppSyncMigrateGuestToUser } from '@/jobs/async-job/appsync-migrate-guest';

const jobPayloadPropsSchema = z.discriminatedUnion('type', [
  notifyJobSchema,
  z.object({
    type: z.literal('example'),
  }),
]);

export type JobPayloadProps = z.infer<typeof jobPayloadPropsSchema>;

// ============================================
// AWS Best Practice: AppSync Operation Router
// Route by explicit __operation field instead of fragile shape-based type guards
// ============================================

type AppSyncEvent = {
  __operation: string;
  [key: string]: unknown;
};

function isAppSyncEvent(event: unknown): event is AppSyncEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    '__operation' in event &&
    typeof (event as AppSyncEvent).__operation === 'string'
  );
}

// Map of GraphQL field names to their handlers
const appSyncOperationHandlers: Record<string, (event: AppSyncEvent) => Promise<unknown>> = {
  // Query
  getTeamMetrics: (event) => handleAppSyncGetTeamMetrics(event.teamId as string),

  // Mutations
  generateComponentViaAI: (event) =>
    handleAppSyncGenerateComponentViaAI(event.projectId as string, event.prompt as string),
  generateFullPlan: (event) => handleAppSyncGenerateFullPlan(event as any),
  applyFullPlan: (event) => handleAppSyncApplyFullPlan(event as any),
  refineComponent: (event) => handleAppSyncRefineComponent(event as any),
  guestRefineComponent: (event) => handleAppSyncGuestRefineComponent(event as any),
  refineBulkPlan: (event) => handleAppSyncRefineBulkPlan(event as any),
  createSmartComponent: (event) => handleAppSyncSmartComponent(event as any),
  planSprint: (event) => handleAppSyncPlanSprint(event as any),
  applyTemplate: (event) => handleAppSyncApplyTemplate(event as any),
  suggestBreakdown: (event) => handleAppSyncSuggestBreakdown(event as any),
  generateWireframe: (event) => handleAppSyncGenerateWireframe(event as any),
  analyzeImportData: (event) => handleAppSyncAnalyzeImport(event as any),
  cleanupImportData: (event) => handleAppSyncCleanupImport(event as any),
  generateRetrospective: (event) => handleAppSyncGenerateRetrospective(event as any),
  migrateGuestToUser: (event) => handleAppSyncMigrateGuestToUser(event as any),
};

export const handler: Handler<unknown> = async (event, context) => {
  logger.info('Async job received', { event });

  // ============================================
  // AWS Best Practice: Explicit Operation Routing
  // Route by __operation field injected by AppSync VTL template
  // ============================================

  if (isAppSyncEvent(event)) {
    const { __operation } = event;
    logger.info('AppSync operation', { operation: __operation });

    const handler = appSyncOperationHandlers[__operation];
    if (handler) {
      return await handler(event);
    }

    // Unknown operation - log warning and fall through
    logger.warn('Unknown AppSync operation', { operation: __operation });
  }

  // ============================================
  // Legacy Support: startAIGeneration uses explicit type field
  // This is invoked via Lambda.invokeAsync, not AppSync resolver
  // ============================================

  if (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    (event as { type: unknown }).type === 'startAIGeneration'
  ) {
    await handleStartAIGeneration(event as any);
    return { success: true };
  }

  // ============================================
  // Background Jobs: SQS-triggered async jobs
  // ============================================

  const { data: payload, error } = jobPayloadPropsSchema.safeParse(event);
  if (error) {
    logger.error('Invalid job payload', { error: error.toString() });
    throw new Error(error.toString());
  }

  switch (payload.type) {
    case 'notify':
      await notifyJobHandler(payload);
      break;
    case 'example':
      logger.info('Example job processed');
      break;
  }
};
