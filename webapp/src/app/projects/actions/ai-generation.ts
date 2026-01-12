'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { generateComponents, isAIConfigured } from '@/lib/ai';

// Schemas
const generateComponentsSchema = z.object({
  projectId: z.string().cuid(),
  generateSprints: z.boolean().optional(),
});

const applyAIComponentsSchema = z.object({
  projectId: z.string().cuid(),
  components: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      type: z.enum(['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG']),
      estimatedHours: z.number(),
      priority: z.number(),
      suggestedDependencies: z.array(z.string()),
      parentName: z.string().optional(),
    }),
  ),
  enhancedDescription: z.string().optional(),
  sprints: z
    .array(
      z.object({
        name: z.string(),
        goal: z.string(),
        durationWeeks: z.number(),
        componentNames: z.array(z.string()),
        capacity: z.number().optional(),
      }),
    )
    .optional(),
});

/**
 * Generates AI component suggestions based on project description
 */
export const generateAIComponents = authActionClient
  .schema(generateComponentsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, generateSprints = false } = parsedInput;
    const { userId } = ctx;

    // Check if AI is configured
    if (!isAIConfigured()) {
      throw new Error('AI features require an OpenAI API key. Please configure OPENAI_API_KEY in your environment.');
    }

    // Get the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        Team: { Membership: { some: { userId } } },
      },
      include: {
        Component: {
          select: { name: true },
        },
      },
    });

    if (!project) {
      throw new Error('Project not found or access denied');
    }

    if (!project.description || project.description.trim().length < 20) {
      throw new Error('Please add a detailed project description (at least 20 characters) to generate components');
    }

    const existingNames = project.Component.map((c: { name: string }) => c.name);

    // Generate components using AI (optionally with sprints)
    const result = await generateComponents(project.name, project.description, existingNames, generateSprints);

    return {
      components: result.components,
      summary: result.summary,
      enhancedDescription: result.enhancedDescription,
      sprints: result.sprints,
    };
  });

/**
 * Applies AI-generated components to the project (creates them in database)
 */
export const applyAIComponents = authActionClient
  .schema(applyAIComponentsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, components, enhancedDescription, sprints } = parsedInput;
    const { userId } = ctx;

    // Verify access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        Team: { Membership: { some: { userId } } },
      },
    });

    if (!project) {
      throw new Error('Project not found or access denied');
    }

    // Update project description if enhanced description provided
    if (enhancedDescription && (!project.description || project.description.length < enhancedDescription.length)) {
      await prisma.project.update({
        where: { id: projectId },
        data: { description: enhancedDescription },
      });
    }

    // Create components hierarchically: parents first, then children
    // This ensures parentId references are valid when creating child components
    const nameToId = new Map<string, string>();
    const createdComponents: any[] = [];

    // First pass: Create all components without parents (top-level EPICs/FEATUREs)
    for (const c of components) {
      if (!c.parentName) {
        const component = await prisma.component.create({
          data: {
            name: c.name,
            description: c.description,
            type: c.type,
            projectId,
            priority: c.priority,
            estimatedHours: c.estimatedHours,
            parentId: null,
          },
        });
        nameToId.set(c.name, component.id);
        createdComponents.push(component);
      }
    }

    // Second pass: Create components with parents (nested FEATUREs/STORies/TASKs)
    for (const c of components) {
      if (c.parentName) {
        const parentId = nameToId.get(c.parentName);
        const component = await prisma.component.create({
          data: {
            name: c.name,
            description: c.description,
            type: c.type,
            projectId,
            priority: c.priority,
            estimatedHours: c.estimatedHours,
            parentId: parentId || null, // If parent not found, create as top-level
          },
        });
        nameToId.set(c.name, component.id);
        createdComponents.push(component);
      }
    }

    // Create dependencies based on suggestions
    const dependenciesToCreate: { dependentId: string; requiredId: string }[] = [];

    for (const comp of components) {
      const dependentId = nameToId.get(comp.name);
      if (!dependentId) continue;

      for (const depName of comp.suggestedDependencies) {
        const requiredId = nameToId.get(depName);
        if (requiredId && requiredId !== dependentId) {
          dependenciesToCreate.push({ dependentId, requiredId });
        }
      }
    }

    // Create dependencies
    if (dependenciesToCreate.length > 0) {
      await Promise.all(
        dependenciesToCreate.map(({ dependentId, requiredId }) =>
          prisma.dependency
            .create({
              data: {
                dependentComponentId: dependentId,
                requiredComponentId: requiredId,
              },
            })
            .catch(() => {
              // Ignore duplicate dependencies
            }),
        ),
      );
    }

    // Create sprints if provided
    let createdSprints = 0;
    if (sprints && sprints.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < sprints.length; i++) {
        const sprint = sprints[i];
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() + i * sprint.durationWeeks * 7);

        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + sprint.durationWeeks * 7);

        // Create the sprint
        const createdSprint = await prisma.sprint.create({
          data: {
            name: sprint.name,
            goal: sprint.goal,
            teamId: project.teamId,
            startDate,
            endDate,
            status: 'PLANNING',
            capacity: sprint.capacity,
          },
        });

        // Assign components to this sprint
        const componentIds = sprint.componentNames.map((name) => nameToId.get(name)).filter((id) => id != null);

        if (componentIds.length > 0) {
          await Promise.all(
            componentIds.map((componentId) =>
              prisma.component.update({
                where: { id: componentId },
                data: { sprintId: createdSprint.id },
              }),
            ),
          );
        }

        createdSprints++;
      }
    }

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'COMPONENT_CREATED',
        projectId,
        userId,
        metadata: {
          aiGenerated: true,
          componentCount: createdComponents.length,
          sprintCount: createdSprints,
        },
      },
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/team/${project.teamId}/sprints`);

    return {
      created: createdComponents.length,
      dependencies: dependenciesToCreate.length,
      sprints: createdSprints,
    };
  });

/**
 * Checks if AI features are configured
 */
export const checkAIStatus = authActionClient.schema(z.object({})).action(async () => {
  return { configured: isAIConfigured() };
});
