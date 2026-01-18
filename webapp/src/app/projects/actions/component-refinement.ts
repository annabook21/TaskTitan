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
  // Demo mode data - passed from client since server can't access localStorage
  demoComponentData: z
    .object({
      name: z.string(),
      description: z.string(),
      type: z.enum(['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG']),
      estimatedHours: z.number(),
      priority: z.number(),
      projectName: z.string(),
      projectDescription: z.string(),
      existingComponents: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
        })
      ),
    })
    .optional(),
});

/**
 * Refine an existing component using AI chat
 * Uses real Bedrock AI for both demo and production modes
 */
export const refineExistingComponent = authActionClient
  .schema(refineExistingComponentSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, projectId, refinementRequest, demoComponentData } = parsedInput;
    const { userId, isDemo } = ctx;

    // Check if AI is configured (required for both demo and production)
    if (!isAIConfigured()) {
      throw new MyCustomError('AI features require Amazon Bedrock access.');
    }

    let currentComponent: {
      name: string;
      description: string;
      type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
      estimatedHours: number;
      priority: number;
      suggestedDependencies: string[];
      acceptanceCriteria: string[];
      reasoning: string;
    };
    let projectName: string;
    let projectDescription: string;
    let existingComponents: { name: string; type: string }[];

    if (isDemo) {
      // Demo mode - use component data passed from client
      if (!demoComponentData) {
        throw new MyCustomError('Demo component data not provided');
      }

      currentComponent = {
        name: demoComponentData.name,
        description: demoComponentData.description,
        type: demoComponentData.type,
        estimatedHours: demoComponentData.estimatedHours,
        priority: demoComponentData.priority,
        suggestedDependencies: [],
        acceptanceCriteria: [],
        reasoning: demoComponentData.description,
      };
      projectName = demoComponentData.projectName;
      projectDescription = demoComponentData.projectDescription;
      existingComponents = demoComponentData.existingComponents;
    } else {
      // Production mode - get component from database
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

      currentComponent = {
        name: component.name,
        description: component.description || '',
        type: component.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
        estimatedHours: component.estimatedHours || 8,
        priority: Math.floor(component.priority / 10), // Convert 0-100 to 1-10 scale
        suggestedDependencies: [],
        acceptanceCriteria: [],
        reasoning: component.description || '',
      };
      projectName = component.Project.name;
      projectDescription = component.Project.description || '';
      existingComponents = component.Project.Component.map((c) => ({
        name: c.name,
        type: c.type,
      }));
    }

    // Call AI to refine (works for both demo and production)
    const result = await refineComponentWithChat({
      currentComponent,
      refinementRequest,
      projectContext: {
        projectName,
        projectDescription,
        existingComponents,
      },
    });

    // Demo mode - return result for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'refineExistingComponent',
        _input: { componentId, projectId },
        component: {
          id: componentId,
          name: result.component.name,
          description: result.component.description,
          type: result.component.type,
          estimatedHours: result.component.estimatedHours,
          priority: Math.round(result.component.priority * 10),
        },
        explanation: result.explanation,
        suggestedFollowUps: result.suggestedFollowUps,
      };
    }

    // Production mode - apply changes to database
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
