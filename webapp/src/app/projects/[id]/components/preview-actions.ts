'use server';

import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { generateWireframe } from '@/lib/ai';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { MyCustomError } from '@/lib/safe-action';
import { logger } from '@/lib/logger';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Lazy-initialized S3 client (best practice from research)
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      // Lambda execution role provides credentials automatically via default provider chain
    });
  }
  return s3Client;
}

const generatePreviewSchema = z.object({
  componentId: z.string().cuid(),
});

const exportWireframeSchema = z.object({
  previewId: z.string().cuid(),
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

/**
 * Export wireframe to S3 and return signed download URL
 */
export const exportWireframeAction = authActionClient
  .schema(exportWireframeSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { previewId } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return { _demo: true, _action: 'exportWireframe', _input: { previewId } };
    }

    try {
      // Fetch preview with access check
      const preview = await prisma.componentPreview.findFirst({
        where: {
          id: previewId,
          Component: {
            Project: {
              Team: { Membership: { some: { userId } } },
            },
          },
        },
        include: {
          Component: {
            include: {
              Project: true,
            },
          },
        },
      });

      if (!preview) {
        throw new MyCustomError('Preview not found or access denied');
      }

      const bucketName = process.env.WIREFRAME_BUCKET_NAME;
      if (!bucketName) {
        logger.error('WIREFRAME_BUCKET_NAME environment variable not set');
        throw new MyCustomError('Wireframe export is not configured');
      }

      // Upload to S3
      const key = `wireframes/${preview.componentId}/${previewId}.html`;
      const client = getS3Client();

      logger.info('Uploading wireframe to S3', {
        previewId,
        componentId: preview.componentId,
        bucket: bucketName,
        key,
      });

      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: preview.htmlContent,
          ContentType: 'text/html',
          Metadata: {
            componentId: preview.componentId,
            componentName: preview.Component.name,
            previewId: preview.id,
            generatedBy: preview.generatedBy,
          },
        }),
      );

      // Generate signed URL (expires in 1 hour - best practice from research)
      const downloadUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
        { expiresIn: 3600 }, // 1 hour
      );

      logger.info('Wireframe exported successfully', {
        previewId,
        bucket: bucketName,
        key,
      });

      return {
        downloadUrl,
        fileName: `${preview.Component.name.replace(/[^a-z0-9]/gi, '-')}-wireframe.html`,
      };
    } catch (error) {
      logger.error('Failed to export wireframe', {
        error,
        previewId,
        userId,
      });

      if (error instanceof MyCustomError) {
        throw error;
      }

      throw new MyCustomError('Failed to export wireframe. Please try again.');
    }
  });
