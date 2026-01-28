'use server';

import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { generateWireframe } from '@/lib/ai';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { MyCustomError } from '@/lib/safe-action';
import { logger } from '@/lib/logger';

// FORGE: S3 client and export functionality removed - wireframe bucket not available

const generatePreviewSchema = z.object({
  componentId: z.string().cuid(),
});

/**
 * Generate AI wireframe preview for a component
 */
export const generatePreviewAction = authActionClient
  .schema(generatePreviewSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'generatePreview', _input: { componentId } };
    }

    try {
      // Fetch component with project access check
      const component = await prisma.component.findFirst({
        where: {
          id: componentId,
          Project: {
            Team: { Membership: { some: { userId } } },
          },
        },
        include: {
          Project: true,
          Dependency_Dependency_dependentComponentIdToComponent: {
            include: {
              Component_Dependency_requiredComponentIdToComponent: true,
            },
          },
        },
      });

      if (!component) {
        throw new MyCustomError('Component not found or access denied');
      }

      logger.info('Generating wireframe preview', {
        componentId,
        componentName: component.name,
        userId,
      });

      // Generate wireframe using Bedrock
      const { html, inputTokens, outputTokens } = await generateWireframe({
        componentName: component.name,
        description: component.description || '',
        type: component.type,
        dependencies: component.Dependency_Dependency_dependentComponentIdToComponent.map(
          (d) => d.Component_Dependency_requiredComponentIdToComponent.name,
        ),
      });

      // Save preview to database
      const preview = await prisma.componentPreview.create({
        data: {
          componentId,
          htmlContent: html,
          prompt: `${component.name}: ${component.description || 'No description'}`,
          modelUsed: 'claude-sonnet-4-5',
          inputTokens,
          outputTokens,
          status: 'COMPLETED',
          generatedBy: userId,
        },
      });

      logger.info('Wireframe preview generated successfully', {
        previewId: preview.id,
        componentId,
        inputTokens,
        outputTokens,
        cost: ((inputTokens * 3 + outputTokens * 15) / 1_000_000).toFixed(4), // Rough cost estimate
      });

      revalidatePath(`/projects/${component.projectId}`);

      return {
        preview: {
          id: preview.id,
          htmlContent: preview.htmlContent,
          createdAt: preview.createdAt,
        },
      };
    } catch (error) {
      logger.error('Failed to generate wireframe preview', {
        error,
        componentId,
        userId,
      });

      if (error instanceof MyCustomError) {
        throw error;
      }

      throw new MyCustomError('Failed to generate wireframe. Please try again.');
    }
  });

// FORGE: exportWireframeAction removed - wireframe bucket not available in cost-optimized deployment
