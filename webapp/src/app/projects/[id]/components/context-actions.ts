'use server';

import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { summarizeComponentContext } from '@/lib/ai';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

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
    const { componentId, contextDecision, contextRationale, contextAlternatives, contextLinks } =
      parsedInput;
    const { userId } = ctx;

    // Verify user has access to this component
    const component = await prisma.component.findFirst({
      where: {
        id: componentId,
        Project: {
          Team: {
            Membership: {
              some: { userId },
            },
          },
        },
      },
    });

    if (!component) {
      throw new Error('Component not found or access denied');
    }

    // Update component context
    const updated = await prisma.component.update({
      where: { id: componentId },
      data: {
        contextDecision,
        contextRationale,
        contextAlternatives: contextAlternatives || null,
        contextLinks: contextLinks || [],
        contextUpdatedAt: new Date(),
        contextUpdatedBy: userId,
      },
    });

    revalidatePath(`/projects/${component.projectId}`);

    return { component: updated };
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
    const { userId } = ctx;

    // Fetch component with access check
    const component = await prisma.component.findFirst({
      where: {
        id: componentId,
        Project: {
          Team: {
            Membership: {
              some: { userId },
            },
          },
        },
      },
    });

    if (!component) {
      throw new Error('Component not found or access denied');
    }

    if (!component.contextDecision || !component.contextRationale) {
      throw new Error('Component must have decision and rationale before generating summary');
    }

    // Generate AI summary
    const { summary, keyPoints, inputTokens, outputTokens } = await summarizeComponentContext({
      decision: component.contextDecision,
      rationale: component.contextRationale,
      alternatives: component.contextAlternatives || undefined,
      componentName: component.name,
      componentType: component.type,
    });

    // Update component with AI summary
    const updated = await prisma.component.update({
      where: { id: componentId },
      data: {
        contextAiSummary: summary,
      },
    });

    revalidatePath(`/projects/${component.projectId}`);

    return {
      component: updated,
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
    const { userId } = ctx;

    // Verify user has access
    const component = await prisma.component.findFirst({
      where: {
        id: componentId,
        Project: {
          Team: {
            Membership: {
              some: { userId },
            },
          },
        },
      },
    });

    if (!component) {
      throw new Error('Component not found or access denied');
    }

    // Clear all context fields
    const updated = await prisma.component.update({
      where: { id: componentId },
      data: {
        contextDecision: null,
        contextRationale: null,
        contextAlternatives: null,
        contextLinks: [],
        contextAiSummary: null,
        contextUpdatedAt: null,
        contextUpdatedBy: null,
      },
    });

    revalidatePath(`/projects/${component.projectId}`);

    return { component: updated };
  });
