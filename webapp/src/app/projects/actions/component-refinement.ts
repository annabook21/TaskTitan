'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { refineComponentWithChat, isAIConfigured } from '@/lib/ai';

const refineExistingComponentSchema = z.object({
  componentId: z.string().min(1),
  projectId: z.string().min(1),
  refinementRequest: z.string().min(1).max(500),
});

/**
 * Refine an existing component using AI chat
 */
export const refineExistingComponent = authActionClient
  .schema(refineExistingComponentSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, projectId, refinementRequest } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode not fully supported for existing component refinement yet
    if (isDemo) {
      throw new MyCustomError('Feature not available in demo mode');
    }

    // Check if AI is configured
    if (!isAIConfigured()) {
      throw new MyCustomError('AI features require Amazon Bedrock access.');
    }

    // Get component with project context
    const component = await prisma.component.findFirst({
      where: {
        id: componentId,
        Project: { Team: { Membership: { some: { userId } } } },
      },
      include: {
        Project: {
          include: {
            Component: {
              select: { name: true, type: true },
            },
          },
        },
      },
    });

    if (!component) {
      throw new MyCustomError('Component not found or access denied');
    }

    // Convert to format expected by refineComponentWithChat
    const currentComponent = {
      name: component.name,
      description: component.description || '',
      type: component.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
      estimatedHours: component.estimatedHours || 8,
      priority: Math.floor(component.priority / 10), // Convert 0-100 to 1-10 scale
      suggestedDependencies: [],
      acceptanceCriteria: [],
      reasoning: component.description || '',
    };

    // Call AI to refine
    const result = await refineComponentWithChat({
      currentComponent,
      refinementRequest,
      projectContext: {
        projectName: component.Project.name,
        projectDescription: component.Project.description || '',
        existingComponents: component.Project.Component.map((c) => ({
          name: c.name,
          type: c.type,
        })),
      },
    });

    // Apply changes to database
    const updated = await prisma.component.update({
      where: { id: componentId },
      data: {
        name: result.component.name,
        description: result.component.description,
        type: result.component.type,
        estimatedHours: result.component.estimatedHours,
        priority: Math.round(result.component.priority * 10), // Convert 1-10 back to 0-100
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'COMPONENT_UPDATED',
        projectId,
        userId,
        metadata: {
          componentName: updated.name,
          componentId,
          aiRefined: true,
          changes: result.explanation,
        },
      },
    });

    revalidatePath(`/projects/${projectId}`);

    return {
      component: updated,
      explanation: result.explanation,
      suggestedFollowUps: result.suggestedFollowUps,
    };
  });
