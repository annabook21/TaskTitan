import { notifyJobHandler, notifyJobSchema } from '@/jobs/async-job/notify';
import { Handler } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { handleAppSyncGenerateComponentViaAI } from '@/jobs/async-job/appsync-bedrock';
import { handleAppSyncGetTeamMetrics } from '@/jobs/async-job/appsync-metrics';
import {
  handleAppSyncGenerateFullPlan,
  type GenerateFullPlanInput,
} from '@/jobs/async-job/appsync-generate-full-plan';
import {
  handleAppSyncApplyFullPlan,
  type ApplyFullPlanInput,
} from '@/jobs/async-job/appsync-apply-full-plan';
import {
  handleAppSyncRefineComponent,
  type RefineComponentInput,
} from '@/jobs/async-job/appsync-refine-component';
import {
  handleAppSyncGuestRefineComponent,
  type GuestRefineComponentInput,
} from '@/jobs/async-job/appsync-guest-refine-component';
import {
  handleAppSyncRefineBulkPlan,
  type RefineBulkPlanInput,
} from '@/jobs/async-job/appsync-refine-bulk-plan';
import {
  handleAppSyncSmartComponent,
  type SmartComponentInput,
} from '@/jobs/async-job/appsync-smart-component';
import {
  handleAppSyncPlanSprint,
  type PlanSprintInput,
} from '@/jobs/async-job/appsync-plan-sprint';
import {
  handleAppSyncApplyTemplate,
  type ApplyTemplateAppSyncInput,
} from '@/jobs/async-job/appsync-apply-template';
import {
  handleAppSyncSuggestBreakdown,
  type SuggestBreakdownInput,
} from '@/jobs/async-job/appsync-suggest-breakdown';
import {
  handleAppSyncGenerateWireframe,
  type GenerateWireframeInput,
} from '@/jobs/async-job/appsync-generate-wireframe';
import {
  handleAppSyncAnalyzeImport,
  handleAppSyncCleanupImport,
  type AnalyzeImportInput,
  type CleanupImportInput,
} from '@/jobs/async-job/appsync-import-analysis';
import {
  handleAppSyncGenerateRetrospective,
  type GenerateRetrospectiveInput,
} from '@/jobs/async-job/appsync-generate-retrospective';
import {
  handleStartAIGeneration,
  type StartAIGenerationInput,
} from '@/jobs/async-job/appsync-ai-progress';

const jobPayloadPropsSchema = z.discriminatedUnion('type', [
  notifyJobSchema,
  z.object({
    type: z.literal('example'),
  }),
]);

export type JobPayloadProps = z.infer<typeof jobPayloadPropsSchema>;

/** AppSync invokes with { projectId, prompt }; async jobs use { type, ... } */
function isAppSyncGenerateComponentViaAI(event: unknown): event is { projectId: string; prompt: string } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'projectId' in event &&
    'prompt' in event &&
    typeof (event as { projectId: unknown }).projectId === 'string' &&
    typeof (event as { prompt: unknown }).prompt === 'string'
  );
}

/** AppSync invokes getTeamMetrics with { teamId } */
function isAppSyncGetTeamMetrics(event: unknown): event is { teamId: string } {
  return (
    typeof event === 'object' &&
    event !== null &&
    'teamId' in event &&
    typeof (event as { teamId: unknown }).teamId === 'string' &&
    !('projectId' in event) &&
    !('prompt' in event) &&
    !('type' in event)
  );
}

/** AppSync invokes generateFullPlan with { projectId, generateEpics? } - no prompt, no components */
function isAppSyncGenerateFullPlan(event: unknown): event is GenerateFullPlanInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'projectId' in event &&
    typeof (event as { projectId: unknown }).projectId === 'string' &&
    // Exclude fields that indicate other handlers
    !('prompt' in event) &&
    !('type' in event) &&
    !('teamId' in event) &&
    !('components' in event) &&
    !('userInput' in event) &&           // SmartComponent
    !('currentComponent' in event) &&    // RefineComponent
    !('currentPlan' in event) &&         // RefineBulkPlan
    !('template' in event) &&            // ApplyTemplate
    !('componentId' in event) &&         // SuggestBreakdown, GenerateWireframe
    !('refinementRequest' in event) &&   // RefineComponent, RefineBulkPlan
    !('headers' in event) &&             // AnalyzeImport
    !('rows' in event) &&                // CleanupImport
    !('sprintId' in event) &&            // GenerateRetrospective
    !('applyAdjustments' in event)       // GenerateRetrospective
  );
}

/** AppSync invokes applyFullPlan with { projectId, components, ... } */
function isAppSyncApplyFullPlan(event: unknown): event is ApplyFullPlanInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'projectId' in event &&
    'components' in event &&
    typeof (event as { projectId: unknown }).projectId === 'string' &&
    Array.isArray((event as { components: unknown }).components)
  );
}

/** AppSync invokes refineComponent with { projectId, currentComponent, refinementRequest } */
function isAppSyncRefineComponent(event: unknown): event is RefineComponentInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'projectId' in event &&
    'currentComponent' in event &&
    'refinementRequest' in event &&
    typeof (event as { refinementRequest: unknown }).refinementRequest === 'string'
  );
}

/** AppSync invokes guestRefineComponent with { guestId, componentId, refinementRequest } */
function isAppSyncGuestRefineComponent(event: unknown): event is GuestRefineComponentInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'guestId' in event &&
    'componentId' in event &&
    'refinementRequest' in event &&
    typeof (event as { guestId: unknown }).guestId === 'string' &&
    typeof (event as { componentId: unknown }).componentId === 'string' &&
    !('currentComponent' in event) // Distinguish from regular refineComponent
  );
}

/** AppSync invokes refineBulkPlan with { projectId, currentPlan, refinementRequest } */
function isAppSyncRefineBulkPlan(event: unknown): event is RefineBulkPlanInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'projectId' in event &&
    'currentPlan' in event &&
    'refinementRequest' in event &&
    typeof (event as { currentPlan: unknown }).currentPlan === 'object'
  );
}

/** AppSync invokes createSmartComponent with { projectId, userInput, parentComponentId? } */
function isAppSyncSmartComponent(event: unknown): event is SmartComponentInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'projectId' in event &&
    'userInput' in event &&
    typeof (event as { userInput: unknown }).userInput === 'string'
  );
}

/** AppSync invokes planSprint with { teamId, sprintId?, capacityHours } */
function isAppSyncPlanSprint(event: unknown): event is PlanSprintInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'teamId' in event &&
    'capacityHours' in event &&
    typeof (event as { capacityHours: unknown }).capacityHours === 'number'
  );
}

// ============================================
// Phase 1-5: New AI Feature Type Guards
// ============================================

/** AppSync invokes applyTemplate with { template, entityName, projectName, projectId } */
function isAppSyncApplyTemplate(event: unknown): event is ApplyTemplateAppSyncInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'template' in event &&
    'entityName' in event &&
    'projectName' in event &&
    'projectId' in event &&
    typeof (event as { template: unknown }).template === 'string'
  );
}

/** AppSync invokes suggestBreakdown with { componentId, projectId } */
function isAppSyncSuggestBreakdown(event: unknown): event is SuggestBreakdownInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'componentId' in event &&
    'projectId' in event &&
    typeof (event as { componentId: unknown }).componentId === 'string' &&
    !('template' in event)
  );
}

/** AppSync invokes generateWireframe with { componentId } */
function isAppSyncGenerateWireframe(event: unknown): event is GenerateWireframeInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'componentId' in event &&
    typeof (event as { componentId: unknown }).componentId === 'string' &&
    !('projectId' in event) &&
    !('template' in event)
  );
}

/** AppSync invokes analyzeImportData with { headers, sampleRows, projectId } */
function isAppSyncAnalyzeImport(event: unknown): event is AnalyzeImportInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'headers' in event &&
    'sampleRows' in event &&
    Array.isArray((event as { headers: unknown }).headers)
  );
}

/** AppSync invokes cleanupImportData with { rows, mappings } */
function isAppSyncCleanupImport(event: unknown): event is CleanupImportInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'rows' in event &&
    'mappings' in event &&
    Array.isArray((event as { rows: unknown }).rows) &&
    Array.isArray((event as { mappings: unknown }).mappings)
  );
}

/** AppSync invokes generateRetrospective with { sprintId, applyAdjustments? } */
function isAppSyncGenerateRetrospective(event: unknown): event is GenerateRetrospectiveInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'sprintId' in event &&
    typeof (event as { sprintId: unknown }).sprintId === 'string' &&
    !('teamId' in event) &&
    !('capacityHours' in event)
  );
}

/** AppSync invokes startAIGeneration async with { type: 'startAIGeneration', sessionId, projectId, graphqlUrl } */
function isAppSyncStartAIGeneration(event: unknown): event is StartAIGenerationInput {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    (event as { type: unknown }).type === 'startAIGeneration' &&
    'sessionId' in event &&
    'projectId' in event &&
    'graphqlUrl' in event
  );
}

export const handler: Handler<unknown> = async (event, context) => {
  logger.info('Async job received', { event });

  // Async AI Generation: startAIGeneration (invoked async, publishes progress via subscription)
  // Must check first since it has explicit type field
  if (isAppSyncStartAIGeneration(event)) {
    await handleStartAIGeneration(event);
    return { success: true };
  }

  // Phase 2: AppSync mutation generateComponentViaAI (sync Bedrock)
  if (isAppSyncGenerateComponentViaAI(event)) {
    const result = await handleAppSyncGenerateComponentViaAI(event.projectId, event.prompt);
    return result;
  }

  // Phase 9: AppSync query getTeamMetrics (DynamoDB aggregation)
  if (isAppSyncGetTeamMetrics(event)) {
    const result = await handleAppSyncGetTeamMetrics(event.teamId);
    return result;
  }

  // Phase 10: AppSync mutation generateFullPlan (workflow-aware AI generation)
  if (isAppSyncGenerateFullPlan(event)) {
    const result = await handleAppSyncGenerateFullPlan(event);
    return result;
  }

  // Phase 10: AppSync mutation applyFullPlan (atomic plan application)
  if (isAppSyncApplyFullPlan(event)) {
    const result = await handleAppSyncApplyFullPlan(event);
    return result;
  }

  // Phase 10.3: AppSync mutation refineComponent (chat-based single component refinement)
  if (isAppSyncRefineComponent(event)) {
    const result = await handleAppSyncRefineComponent(event);
    return result;
  }

  // Guest: AppSync mutation guestRefineComponent (chat-based component refinement for guests)
  if (isAppSyncGuestRefineComponent(event)) {
    const result = await handleAppSyncGuestRefineComponent(event);
    return result;
  }

  // Phase 10.3: AppSync mutation refineBulkPlan (chat-based bulk plan refinement)
  if (isAppSyncRefineBulkPlan(event)) {
    const result = await handleAppSyncRefineBulkPlan(event);
    return result;
  }

  // Phase 10.4: AppSync mutation createSmartComponent (natural language component)
  if (isAppSyncSmartComponent(event)) {
    const result = await handleAppSyncSmartComponent(event);
    return result;
  }

  // Phase 10.4: AppSync mutation planSprint (AI sprint planning)
  if (isAppSyncPlanSprint(event)) {
    const result = await handleAppSyncPlanSprint(event);
    return result;
  }

  // ============================================
  // Phase 1-5: New AI Feature Dispatchers
  // ============================================

  // Phase 1: AppSync mutation applyTemplate (template application)
  if (isAppSyncApplyTemplate(event)) {
    const result = await handleAppSyncApplyTemplate(event);
    return result;
  }

  // Phase 2: AppSync mutation suggestBreakdown (component breakdown)
  if (isAppSyncSuggestBreakdown(event)) {
    const result = await handleAppSyncSuggestBreakdown(event);
    return result;
  }

  // Phase 3: AppSync mutation generateWireframe (wireframe generation)
  if (isAppSyncGenerateWireframe(event)) {
    const result = await handleAppSyncGenerateWireframe(event);
    return result;
  }

  // Phase 4: AppSync mutation analyzeImportData (import analysis)
  if (isAppSyncAnalyzeImport(event)) {
    const result = await handleAppSyncAnalyzeImport(event);
    return result;
  }

  // Phase 4: AppSync mutation cleanupImportData (import cleanup)
  if (isAppSyncCleanupImport(event)) {
    const result = await handleAppSyncCleanupImport(event);
    return result;
  }

  // Phase 5: AppSync mutation generateRetrospective (retrospective generation)
  if (isAppSyncGenerateRetrospective(event)) {
    const result = await handleAppSyncGenerateRetrospective(event);
    return result;
  }

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
