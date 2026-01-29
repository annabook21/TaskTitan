'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { refineComponentWithChat, isAIConfigured } from '@/lib/ai';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyComponentAccess, verifyProjectAccess } from '@/lib/dynamodb/auth-helpers';

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
        }),
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
      const entities = getEntities();

      // Production mode - get component + project context from DynamoDB
      const access = await verifyComponentAccess(userId, componentId);
      if (!access) {
        throw new MyCustomError('Component not found or access denied');
      }

      const projectComponents = await entities.component.query.byProject({ projectId: access.component.projectId }).go();

      currentComponent = {
        name: access.component.name,
        description: (access.component as any).description || '',
        type: access.component.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
        estimatedHours: (access.component as any).estimatedHours || 8,
        priority: Math.floor(((access.component as any).priority || 0) / 10), // Convert 0-100 to 1-10 scale
        suggestedDependencies: [],
        acceptanceCriteria: [],
        reasoning: (access.component as any).description || '',
      };
      projectName = access.project.name;
      projectDescription = (access.project as any).description || '';
      existingComponents = projectComponents.data.map((c) => ({
        name: c.name,
        type: (c as any).type,
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

    const entities = getEntities();
    const activityId = randomUUID();

    // Production mode - apply changes to database
    const updatedResult = await dualWrite(
      'component',
      'update',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const updated = await entities.component
          .update({ id: componentId })
          .set({
            name: result.component.name,
            description: result.component.description || undefined,
            type: result.component.type,
            estimatedHours: result.component.estimatedHours,
            priority: Math.round(result.component.priority * 10),
          })
          .go({ response: 'all_new' });
        return updated.data;
      },
      { context: { action: 'refineExistingComponent', componentId, projectId } }
    );

    // Log activity
    await dualWrite(
      'activity',
      'create',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        const created = await entities.activity
          .create({
            id: activityId,
            type: 'COMPONENT_UPDATED',
            projectId,
            userId,
            metadata: {
              componentName: (updatedResult.data as any).name,
              componentId,
              aiRefined: true,
              changes: result.explanation,
            },
          })
          .go();
        return created.data;
      },
      { context: { action: 'refineExistingComponent', componentId, projectId } }
    );

    revalidatePath(`/projects/${projectId}`);

    return {
      component: updatedResult.data,
      explanation: result.explanation,
      suggestedFollowUps: result.suggestedFollowUps,
    };
  });
