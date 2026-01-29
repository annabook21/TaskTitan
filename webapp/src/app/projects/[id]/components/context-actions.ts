'use server';

import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { z } from 'zod';
import { summarizeComponentContext } from '@/lib/ai';
import { revalidatePath } from 'next/cache';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyComponentAccess } from '@/lib/dynamodb/auth-helpers';

/**
 * Update component context (manual fields)
 */
const updateContextSchema = z.object({
  componentId: z.string().cuid(),
  contextDecision: z.string().min(10).max(5000),
  contextRationale: z.string().min(10).max(5000),
  contextAlternatives: z.string().max(5000).optional(),
  contextLinks: z.array(z.string().url()).optional(),
});

export const updateComponentContextAction = authActionClient
  .schema(updateContextSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, contextDecision, contextRationale, contextAlternatives, contextLinks } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'updateComponentContext',
        _input: {
          componentId,
          contextDecision,
          contextRationale,
          contextAlternatives,
          contextLinks,
          updatedBy: userId,
        },
      };
    }

    // Verify user has access to this component via DynamoDB
    const access = await verifyComponentAccess(userId, componentId);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }
    const projectId = access.component.projectId;

    const entities = getEntities();

    // Update component context using dual-write
    const result = await dualWrite(
      'component',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const nowIso = new Date().toISOString();
        const updated = await entities.component
          .update({ id: componentId })
          .set({
            contextDecision,
            contextRationale,
            contextAlternatives: contextAlternatives || undefined,
            contextLinks: contextLinks || [],
            contextUpdatedAt: nowIso,
            contextUpdatedBy: userId,
          })
          .go({ response: 'all_new' });
        return updated.data;
      },
      { context: { action: 'updateComponentContext', componentId } }
    );

    revalidatePath(`/projects/${projectId}`);

    return { component: result.data };
  });

/**
 * Generate AI summary for component context
 */
const generateContextSummarySchema = z.object({
  componentId: z.string().cuid(),
});

export const generateContextSummaryAction = authActionClient
  .schema(generateContextSummarySchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'generateContextSummary', _input: { componentId } };
    }

    const entities = getEntities();

    // Fetch component with access check via DynamoDB
    const access = await verifyComponentAccess(userId, componentId);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }
    const componentData = {
      id: access.component.id,
      name: access.component.name,
      type: access.component.type,
      projectId: access.component.projectId,
      contextDecision: access.component.contextDecision ?? null,
      contextRationale: access.component.contextRationale ?? null,
      contextAlternatives: access.component.contextAlternatives ?? null,
    };

    if (!componentData.contextDecision || !componentData.contextRationale) {
      throw new MyCustomError('Component must have decision and rationale before generating summary');
    }

    // Generate AI summary
    const { summary, keyPoints, inputTokens, outputTokens } = await summarizeComponentContext({
      decision: componentData.contextDecision,
      rationale: componentData.contextRationale,
      alternatives: componentData.contextAlternatives || undefined,
      componentName: componentData.name,
      componentType: componentData.type,
    });

    // Update component with AI summary using dual-write
    const result = await dualWrite(
      'component',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const updated = await entities.component
          .update({ id: componentId })
          .set({ contextAiSummary: summary })
          .go({ response: 'all_new' });
        return updated.data;
      },
      { context: { action: 'generateContextSummary', componentId } }
    );

    revalidatePath(`/projects/${componentData.projectId}`);

    return {
      component: result.data,
      keyPoints,
      tokensUsed: { inputTokens, outputTokens },
    };
  });

/**
 * Clear component context
 */
const clearContextSchema = z.object({
  componentId: z.string().cuid(),
});

export const clearComponentContextAction = authActionClient
  .schema(clearContextSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'clearComponentContext', _input: { componentId } };
    }

    // Verify user has access via DynamoDB
    const access = await verifyComponentAccess(userId, componentId);
    if (!access) {
      throw new MyCustomError('Component not found or access denied');
    }
    const projectId = access.component.projectId;

    const entities = getEntities();

    // Clear all context fields using dual-write
    const result = await dualWrite(
      'component',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        // DynamoDB: Remove context fields (set to undefined removes the attribute)
        const updated = await entities.component
          .update({ id: componentId })
          .remove([
            'contextDecision',
            'contextRationale',
            'contextAlternatives',
            'contextAiSummary',
            'contextUpdatedAt',
            'contextUpdatedBy',
          ])
          .set({ contextLinks: [] })
          .go({ response: 'all_new' });
        return updated.data;
      },
      { context: { action: 'clearComponentContext', componentId } }
    );

    revalidatePath(`/projects/${projectId}`);

    return { component: result.data };
  });
