'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { generateComponents, isAIConfigured } from '@/lib/ai';

// Schemas
const generateComponentsSchema = z.object({
  projectId: z.string().min(1),
  // For Scrum: whether to create optional Epic groupings (sprints are always generated)
  generateEpics: z.boolean().optional(),
  // Demo mode data - passed from client since server can't access localStorage
  demoProjectData: z
    .object({
      name: z.string(),
      description: z.string(),
      existingComponentNames: z.array(z.string()),
      workflowConfig: z
        .object({
          cycleEnabled: z.boolean(),
          cycleDurationWeeks: z.number(),
          workflowTemplate: z.enum(['SCRUM', 'KANBAN', 'CUSTOM']).nullable(),
          cycleName: z.string().nullable(),
          backlogName: z.string().nullable(),
        })
        .nullable(),
    })
    .optional(),
});

const applyAIComponentsSchema = z.object({
  projectId: z.string().min(1),
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
  // Optional epic groupings for backlog organization
  epics: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        componentNames: z.array(z.string()),
      }),
    )
    .optional(),
});

/**
 * Generates AI component suggestions based on project description
 * Respects team workflow configuration for Scrum vs Kanban vs custom workflows
 * Uses real Bedrock AI for both demo and production modes
 *
 * For Scrum: Sprints are ALWAYS generated. Epics are OPTIONAL backlog groupings.
 * For Kanban: Flat work items, no sprints, no hierarchy.
 */
export const generateAIComponents = authActionClient
  .schema(generateComponentsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, generateEpics = false, demoProjectData } = parsedInput;
    const { userId, isDemo } = ctx;

    // Check if AI is configured (required for both demo and production)
    if (!isAIConfigured()) {
      throw new MyCustomError('AI features require Amazon Bedrock access in your AWS account.');
    }

    let projectName: string;
    let projectDescription: string;
    let existingNames: string[] = [];
    let workflowConfig: Parameters<typeof generateComponents>[4] = null;

    if (isDemo) {
      // Demo mode - use project data passed from client (server can't access localStorage)
      if (!demoProjectData) {
        throw new MyCustomError('Demo project data not provided');
      }

      if (!demoProjectData.description || demoProjectData.description.trim().length < 20) {
        throw new MyCustomError(
          'Please add a detailed project description (at least 20 characters) to generate components',
        );
      }

      projectName = demoProjectData.name;
      projectDescription = demoProjectData.description;
      existingNames = demoProjectData.existingComponentNames;

      // Convert demo workflow config to match Prisma type shape
      if (demoProjectData.workflowConfig) {
        workflowConfig = {
          id: 'demo-workflow',
          teamId: 'demo-team',
          wipLimitPlanning: null,
          wipLimitInProgress: null,
          wipLimitBlocked: null,
          wipLimitReview: null,
          cycleEnabled: demoProjectData.workflowConfig.cycleEnabled,
          cycleDurationWeeks: demoProjectData.workflowConfig.cycleDurationWeeks,
          cycleStartDayOfWeek: 1,
          workflowTemplate: demoProjectData.workflowConfig.workflowTemplate,
          cycleName: demoProjectData.workflowConfig.cycleName,
          backlogName: demoProjectData.workflowConfig.backlogName,
          enforceEstimates: false,
          autoArchiveCompleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
    } else {
      // Production mode - get project from database
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          Team: { Membership: { some: { userId } } },
        },
        include: {
          Component: {
            select: { name: true },
          },
          Team: {
            include: {
              WorkflowConfig: true,
            },
          },
        },
      });

      if (!project) {
        throw new MyCustomError('Project not found or access denied');
      }

      if (!project.description || project.description.trim().length < 20) {
        throw new MyCustomError(
          'Please add a detailed project description (at least 20 characters) to generate components',
        );
      }

      projectName = project.name;
      projectDescription = project.description;
      existingNames = project.Component.map((c: { name: string }) => c.name);
      workflowConfig = project.Team.WorkflowConfig;
    }

    // Generate components using real Bedrock AI
    // For Scrum: sprints are always generated, epics are optional
    // For Kanban: flat work items only
    const result = await generateComponents(
      projectName,
      projectDescription,
      existingNames,
      generateEpics,
      workflowConfig,
    );

    return {
      components: result.components,
      summary: result.summary,
      enhancedDescription: result.enhancedDescription,
      sprints: result.sprints,
      epics: result.epics,
    };
  });

/**
 * Applies AI-generated components to the project (creates them in database)
 * Creates work items (Stories/Tasks), assigns them to sprints, and optionally creates Epic groupings
 */
export const applyAIComponents = authActionClient
  .schema(applyAIComponentsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, components, enhancedDescription, sprints, epics } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'applyAIComponents',
        _input: { projectId, components, enhancedDescription, sprints, epics },
      };
    }

    // Verify access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        Team: { Membership: { some: { userId } } },
      },
    });

    if (!project) {
      throw new MyCustomError('Project not found or access denied');
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
    const createdComponents: Awaited<ReturnType<typeof prisma.component.create>>[] = [];

    // First pass: Create all components without parents (top-level EPICs/FEATUREs)
    // Use Promise.all for parallel creation to improve performance
    const topLevelComponents = components.filter((c) => !c.parentName);
    const topLevelResults = await Promise.all(
      topLevelComponents.map((c) =>
        prisma.component.create({
          data: {
            name: c.name,
            description: c.description,
            type: c.type,
            projectId,
            priority: c.priority,
            estimatedHours: c.estimatedHours,
            parentId: null,
          },
        }),
      ),
    );

    // Map names to IDs for parent references
    topLevelResults.forEach((component, index) => {
      nameToId.set(topLevelComponents[index].name, component.id);
      createdComponents.push(component);
    });

    // Second pass: Create components with parents (nested FEATUREs/STORies/TASKs)
    // Use Promise.all for parallel creation to improve performance
    const childComponents = components.filter((c) => c.parentName);
    if (childComponents.length > 0) {
      const childResults = await Promise.all(
        childComponents.map((c) => {
          const parentId = nameToId.get(c.parentName!);
          return prisma.component.create({
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
        }),
      );

      childResults.forEach((component, index) => {
        nameToId.set(childComponents[index].name, component.id);
        createdComponents.push(component);
      });
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
            .catch((error) => {
              // Only ignore unique constraint violations (P2002)
              // Log and re-throw other errors
              if (error.code === 'P2002') {
                // Duplicate dependency - safe to ignore
                return null;
              }
              console.error('Error creating dependency:', error);
              throw error;
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

        // Assign components to this sprint (batch update for performance)
        const componentIds = sprint.componentNames.map((name) => nameToId.get(name)).filter((id) => id != null);

        if (componentIds.length > 0) {
          await prisma.component.updateMany({
            where: {
              id: { in: componentIds as string[] },
              projectId,
            },
            data: { sprintId: createdSprint.id },
          });
        }

        createdSprints++;
      }
    }

    // Create epic groupings if provided (optional backlog organization)
    // Epics are created as EPIC type components that group related Stories/Tasks
    let createdEpics = 0;
    if (epics && epics.length > 0) {
      for (const epic of epics) {
        // Create the epic as a top-level component
        const createdEpic = await prisma.component.create({
          data: {
            name: epic.name,
            description: epic.description,
            type: 'EPIC',
            projectId,
            priority: 5, // Default priority for epics
            estimatedHours: 0, // Epics don't have direct estimates, sum of children
            parentId: null,
          },
        });

        // Update child components to have this epic as their parent
        const childIds = epic.componentNames.map((name) => nameToId.get(name)).filter((id) => id != null);

        if (childIds.length > 0) {
          await prisma.component.updateMany({
            where: {
              id: { in: childIds as string[] },
              projectId,
            },
            data: { parentId: createdEpic.id },
          });
        }

        createdEpics++;
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
          epicCount: createdEpics,
        },
      },
    });

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/team/${project.teamId}/sprints`);

    return {
      created: createdComponents.length,
      dependencies: dependenciesToCreate.length,
      sprints: createdSprints,
      epics: createdEpics,
    };
  });

/**
 * Checks if AI features are configured
 */
export const checkAIStatus = authActionClient.schema(z.object({})).action(async () => {
  return { configured: isAIConfigured() };
});
