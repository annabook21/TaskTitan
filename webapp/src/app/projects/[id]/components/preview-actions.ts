'use server';

import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { generateWireframe } from '@/lib/ai';
import { revalidatePath } from 'next/cache';
import { MyCustomError } from '@/lib/safe-action';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyComponentAccess } from '@/lib/dynamodb/auth-helpers';

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

    const entities = getEntities();

    try {
      // DynamoDB: Verify access and fetch component
      const access = await verifyComponentAccess(userId, componentId);
      if (!access) {
        throw new MyCustomError('Component not found or access denied');
      }

      // Fetch dependencies for this component
      const dependencies = await entities.dependency.query.primary({ dependentComponentId: componentId }).go();

      // Fetch required component names
      const dependencyNames: string[] = [];
      for (const dep of dependencies.data) {
        const requiredComponent = await entities.component.get({ id: dep.requiredComponentId }).go();
        if (requiredComponent.data) {
          dependencyNames.push(requiredComponent.data.name);
        }
      }

      const componentData = {
        id: access.component.id,
        name: access.component.name,
        description: access.component.description ?? null,
        type: access.component.type,
        projectId: access.component.projectId,
        dependencyNames,
      };

      logger.info('Generating wireframe preview', {
        componentId,
        componentName: componentData.name,
        userId,
      });

      // Generate wireframe using Bedrock
      const { html, inputTokens, outputTokens } = await generateWireframe({
        componentName: componentData.name,
        description: componentData.description || '',
        type: componentData.type,
        dependencies: componentData.dependencyNames,
      });

      // Generate preview ID for dual-write consistency
      const previewId = randomUUID();

      // Save preview to database using dual-write
      const result = await dualWrite(
        'componentPreview',
        'create',
        async () => null, // Prisma removed - DynamoDB only
        async () => {
          const preview = await entities.componentPreview
            .create({
              id: previewId,
              componentId,
              htmlContent: html,
              prompt: `${componentData.name}: ${componentData.description || 'No description'}`,
              modelUsed: 'claude-sonnet-4-5',
              inputTokens,
              outputTokens,
              status: 'COMPLETED',
              generatedBy: userId,
            })
            .go();
          return preview.data;
        },
        { context: { action: 'generatePreview', componentId, previewId } }
      );

      logger.info('Wireframe preview generated successfully', {
        previewId,
        componentId,
        inputTokens,
        outputTokens,
        cost: ((inputTokens * 3 + outputTokens * 15) / 1_000_000).toFixed(4), // Rough cost estimate
      });

      revalidatePath(`/projects/${componentData.projectId}`);

      return {
        preview: {
          id: previewId,
          htmlContent: html,
          createdAt: new Date(),
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
