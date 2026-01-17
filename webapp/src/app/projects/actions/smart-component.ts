'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { createComponentFromNaturalLanguage, isAIConfigured } from '@/lib/ai';
import { refineComponentWithChat } from '@/lib/ai/generators/chat-refinement-generator';

// Schema for the component result from AI
const componentResultSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.enum(['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG']),
  estimatedHours: z.number(),
  priority: z.number(),
  suggestedDependencies: z.array(z.string()),
  reasoning: z.string(),
});

// Schemas for actions
const generateSmartComponentSchema = z.object({
  projectId: z.string().min(1),
  userInput: z.string().min(3, 'Please provide more detail').max(500),
  // Demo mode data - passed from client since server can't access localStorage
  demoProjectData: z
    .object({
      name: z.string(),
      description: z.string(),
      existingComponents: z.array(
        z.object({
          name: z.string(),
          type: z.enum(['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG']),
        }),
      ),
    })
    .optional(),
});

const refineSmartComponentSchema = z.object({
  projectId: z.string().min(1),
  currentComponent: componentResultSchema,
  refinementRequest: z.string().min(1, 'Please enter a refinement').max(500),
  // Demo mode data - passed from client since server can't access localStorage
  demoProjectData: z
    .object({
      name: z.string(),
      description: z.string(),
      existingComponents: z.array(
        z.object({
          name: z.string(),
          type: z.enum(['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG']),
        }),
      ),
    })
    .optional(),
});

const createFromPreviewSchema = z.object({
  projectId: z.string().min(1),
  component: componentResultSchema,
});

/**
 * Generate a component from natural language input
 * Uses real Bedrock AI for both demo and production modes
 */
export const generateSmartComponent = authActionClient
  .schema(generateSmartComponentSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, userInput, demoProjectData } = parsedInput;
    const { userId, isDemo } = ctx;

    // Check if AI is configured (required for both demo and production)
    if (!isAIConfigured()) {
      throw new MyCustomError('AI features require Amazon Bedrock access. Please use manual mode.');
    }

    let projectName: string;
    let projectDescription: string;
    let existingComponents: Array<{ name: string; type: string }> = [];

    if (isDemo) {
      // Demo mode - use project data passed from client (server can't access localStorage)
      if (!demoProjectData) {
        throw new MyCustomError('Demo project data not provided');
      }
      projectName = demoProjectData.name;
      projectDescription = demoProjectData.description;
      existingComponents = demoProjectData.existingComponents;
    } else {
      // Production mode - get project from database
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          Team: { Membership: { some: { userId } } },
        },
        include: {
          Component: {
            select: { name: true, type: true },
          },
        },
      });

      if (!project) {
        throw new MyCustomError('Project not found or access denied');
      }

      projectName = project.name;
      projectDescription = project.description || '';
      existingComponents = project.Component.map((c) => ({
        name: c.name,
        type: c.type,
      }));
    }

    // Generate component using real Bedrock AI
    const result = await createComponentFromNaturalLanguage({
      userInput,
      projectContext: {
        projectName,
        projectDescription,
        existingComponents,
      },
    });

    // Generate initial suggestions based on the result
    const { generateInitialSuggestions } = await import('@/lib/ai/generators/chat-refinement-generator');
    const suggestedFollowUps = generateInitialSuggestions(result);

    return {
      component: result,
      suggestedFollowUps,
    };
  });

/**
 * Refine a generated component using chat
 * Uses real Bedrock AI for both demo and production modes
 */
export const refineSmartComponent = authActionClient
  .schema(refineSmartComponentSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, currentComponent, refinementRequest, demoProjectData } = parsedInput;
    const { userId, isDemo } = ctx;

    // Check if AI is configured (required for both demo and production)
    if (!isAIConfigured()) {
      throw new MyCustomError('AI features require Amazon Bedrock access.');
    }

    let projectName: string;
    let projectDescription: string;
    let existingComponents: Array<{ name: string; type: string }> = [];

    if (isDemo) {
      // Demo mode - use project data passed from client (server can't access localStorage)
      if (!demoProjectData) {
        throw new MyCustomError('Demo project data not provided');
      }
      projectName = demoProjectData.name;
      projectDescription = demoProjectData.description;
      existingComponents = demoProjectData.existingComponents;
    } else {
      // Production mode - get project from database
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          Team: { Membership: { some: { userId } } },
        },
        include: {
          Component: {
            select: { name: true, type: true },
          },
        },
      });

      if (!project) {
        throw new MyCustomError('Project not found or access denied');
      }

      projectName = project.name;
      projectDescription = project.description || '';
      existingComponents = project.Component.map((c) => ({
        name: c.name,
        type: c.type,
      }));
    }

    // Refine component using real Bedrock AI
    const result = await refineComponentWithChat({
      currentComponent,
      refinementRequest,
      projectContext: {
        projectName,
        projectDescription,
        existingComponents,
      },
    });

    return result;
  });

/**
 * Create a component from the preview (after AI generation/refinement)
 */
export const createFromPreview = authActionClient
  .schema(createFromPreviewSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, component } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'createComponent',
        _input: {
          projectId,
          name: component.name,
          description: component.description,
          type: component.type,
          priority: Math.round(component.priority * 10), // Convert 1-10 to 0-100 scale
          estimatedHours: component.estimatedHours,
        },
      };
    }

    // Verify user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        Team: { Membership: { some: { userId } } },
      },
    });

    if (!project) {
      throw new MyCustomError('Project not found or access denied');
    }

    // Create the component
    const created = await prisma.component.create({
      data: {
        name: component.name,
        description: component.description,
        type: component.type,
        projectId,
        priority: Math.round(component.priority * 10), // Convert 1-10 to 0-100 scale
        estimatedHours: component.estimatedHours,
      },
    });

    // Create initial status history record
    await prisma.componentStatusHistory.create({
      data: {
        componentId: created.id,
        status: created.status,
        enteredAt: new Date(),
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'COMPONENT_CREATED',
        projectId,
        userId,
        metadata: {
          componentName: component.name,
          componentId: created.id,
          aiGenerated: true,
        },
      },
    });

    revalidatePath(`/projects/${projectId}`);

    return { component: created };
  });
