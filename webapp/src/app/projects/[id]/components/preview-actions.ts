'use server';

import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { generateWireframe } from '@/lib/ai';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { MyCustomError } from '@/lib/safe-action';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';

// DynamoDB migration imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';
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

    const phase = getMigrationPhase('component');
    const entities = getEntities();

    try {
      // Data structure for component info needed for wireframe generation
      let componentData: {
        id: string;
        name: string;
        description: string | null;
        type: string;
        projectId: string;
        dependencyNames: string[];
      };

      if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
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

        componentData = {
          id: access.component.id,
          name: access.component.name,
          description: access.component.description ?? null,
          type: access.component.type,
          projectId: access.component.projectId,
          dependencyNames,
        };
      } else {
        // Prisma: Fetch component with project access check
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

        componentData = {
          id: component.id,
          name: component.name,
          description: component.description,
          type: component.type,
          projectId: component.projectId,
          dependencyNames: component.Dependency_Dependency_dependentComponentIdToComponent.map(
            (d) => d.Component_Dependency_requiredComponentIdToComponent.name
          ),
        };
      }

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
        async () => {
          return prisma.componentPreview.create({
            data: {
              id: previewId,
              componentId,
              htmlContent: html,
              prompt: `${componentData.name}: ${componentData.description || 'No description'}`,
              modelUsed: 'claude-sonnet-4-5',
              inputTokens,
              outputTokens,
              status: 'COMPLETED',
              generatedBy: userId,
            },
          });
        },
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
