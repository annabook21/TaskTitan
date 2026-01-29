'use server';

import { z } from 'zod';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { generateComponents, isAIConfigured, type TeamCapacityInfo, refineBulkPlan } from '@/lib/ai';
import { randomUUID } from 'crypto';

// DynamoDB imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { getEntities, getService } from '@/lib/dynamodb/service';
import { verifyProjectAccess, verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

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
      // Team capacity for realistic sprint sizing
      teamCapacity: z
        .object({
          memberCount: z.number(),
          members: z.array(
            z.object({
              name: z.string(),
              title: z.string().optional(),
              hoursPerDay: z.number(),
              availability: z.number(),
            }),
          ),
          sprintDays: z.number(),
          totalCapacityHours: z.number(),
        })
        .optional(),
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
    let teamCapacity: TeamCapacityInfo | undefined;

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

      // Use team capacity from demo data if provided
      if (demoProjectData.teamCapacity) {
        teamCapacity = demoProjectData.teamCapacity;
      }
    } else {
      // Production mode - get project from DynamoDB
      const entities = getEntities();

      // DynamoDB: Verify access and fetch project data
      const access = await verifyProjectAccess(userId, projectId);
      if (!access) {
        throw new MyCustomError('Project not found or access denied');
      }

      const project = access.project;
      if (!project.description || project.description.trim().length < 20) {
        throw new MyCustomError(
          'Please add a detailed project description (at least 20 characters) to generate components'
        );
      }

      projectName = project.name;
      projectDescription = project.description;

      // Fetch components for this project
      const componentsResult = await entities.component.query.byProject({ projectId }).go();
      existingNames = componentsResult.data.map((c) => c.name);

      // Fetch workflow config
      const workflowConfigResult = await entities.teamWorkflowConfig.query.primary({ teamId: project.teamId }).go();
      const config = workflowConfigResult.data[0];

      if (config) {
        workflowConfig = {
          id: config.id,
          teamId: config.teamId,
          wipLimitPlanning: config.wipLimitPlanning ?? null,
          wipLimitInProgress: config.wipLimitInProgress ?? null,
          wipLimitBlocked: config.wipLimitBlocked ?? null,
          wipLimitReview: config.wipLimitReview ?? null,
          cycleEnabled: config.cycleEnabled ?? false,
          cycleDurationWeeks: config.cycleDurationWeeks ?? 2,
          cycleStartDayOfWeek: config.cycleStartDayOfWeek ?? 1,
          workflowTemplate: config.workflowTemplate as 'SCRUM' | 'KANBAN' | 'CUSTOM' | null,
          cycleName: config.cycleName ?? null,
          backlogName: config.backlogName ?? null,
          enforceEstimates: config.enforceEstimates ?? false,
          autoArchiveCompleted: config.autoArchiveCompleted ?? false,
          createdAt: new Date(config.createdAt || Date.now()),
          updatedAt: new Date(config.updatedAt || Date.now()),
        };

        // Calculate team capacity for Scrum workflows
        if (config.cycleEnabled) {
          const membershipsResult = await entities.membership.query.primary({ teamId: project.teamId }).go();
          const sprintDays = (config.cycleDurationWeeks ?? 2) * 5;

          // Fetch user names for members
          const members = await Promise.all(
            membershipsResult.data.map(async (m) => {
              const userResult = await entities.user.get({ id: m.userId }).go();
              return {
                name: userResult.data?.name || 'Unknown',
                title: m.title ?? undefined,
                hoursPerDay: m.hoursPerDay ?? 6,
                availability: m.availability ?? 100,
              };
            })
          );

          const totalCapacityHours = members.reduce((total, member) => {
            return total + member.hoursPerDay * (member.availability / 100) * sprintDays;
          }, 0);

          teamCapacity = {
            memberCount: members.length,
            members,
            sprintDays,
            totalCapacityHours,
          };
        }
      }
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
      teamCapacity,
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

    const entities = getEntities();

    // Verify access via DynamoDB
    const access = await verifyProjectAccess(userId, projectId);
    if (!access) {
      throw new MyCustomError('Project not found or access denied');
    }
    const teamId = access.project.teamId;
    const currentDescription = access.project.description ?? null;

    // Update project description if enhanced description provided
    if (enhancedDescription && (!currentDescription || currentDescription.length < enhancedDescription.length)) {
      await dualWrite(
        'project',
        'update',
        async () => null, // Prisma removed - DynamoDB only
        async () => {
          await entities.project.update({ id: projectId }).set({ description: enhancedDescription }).go();
          return { id: projectId };
        },
        { context: { action: 'applyAIComponents-updateDescription', projectId } }
      );
    }

    // Pre-generate UUIDs for all components to enable name→ID mapping before creation
    const nameToId = new Map<string, string>();
    for (const c of components) {
      nameToId.set(c.name, randomUUID());
    }

    // Separate top-level and child components
    const topLevelComponents = components.filter((c) => !c.parentName);
    const childComponents = components.filter((c) => c.parentName);

    // Build component data arrays for batch operations
    const allComponentData = components.map((c) => ({
      id: nameToId.get(c.name)!,
      name: c.name,
      description: c.description,
      type: c.type,
      projectId,
      priority: c.priority,
      estimatedHours: c.estimatedHours,
      parentId: c.parentName ? nameToId.get(c.parentName) || null : null,
      status: 'PLANNING' as const,
    }));

    // Build dependency data
    const dependenciesToCreate: { id: string; dependentId: string; requiredId: string }[] = [];
    for (const comp of components) {
      const dependentId = nameToId.get(comp.name);
      if (!dependentId) continue;

      for (const depName of comp.suggestedDependencies) {
        const requiredId = nameToId.get(depName);
        if (requiredId && requiredId !== dependentId) {
          dependenciesToCreate.push({ id: randomUUID(), dependentId, requiredId });
        }
      }
    }

    // Build sprint data with pre-generated IDs
    const sprintData: Array<{
      id: string;
      name: string;
      goal: string;
      teamId: string;
      startDate: Date;
      endDate: Date;
      capacity?: number;
      componentIds: string[];
    }> = [];

    if (sprints && sprints.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < sprints.length; i++) {
        const sprint = sprints[i];
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() + i * sprint.durationWeeks * 7);

        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + sprint.durationWeeks * 7);

        const componentIds = sprint.componentNames.map((name) => nameToId.get(name)).filter((id) => id != null) as string[];

        sprintData.push({
          id: randomUUID(),
          name: sprint.name,
          goal: sprint.goal,
          teamId,
          startDate,
          endDate,
          capacity: sprint.capacity,
          componentIds,
        });
      }
    }

    // Build epic data with pre-generated IDs
    const epicData: Array<{
      id: string;
      name: string;
      description: string;
      childIds: string[];
    }> = [];

    if (epics && epics.length > 0) {
      for (const epic of epics) {
        const childIds = epic.componentNames.map((name) => nameToId.get(name)).filter((id) => id != null) as string[];
        epicData.push({
          id: randomUUID(),
          name: epic.name,
          description: epic.description,
          childIds,
        });
      }
    }

    // Activity ID for logging
    const activityId = randomUUID();

    // Execute dual-write for all operations
    await dualWrite(
      'component',
      'create',
      async () => null, // Prisma removed - DynamoDB only
      async () => {
        // DynamoDB: Batch create with chunking (25 items per batch)
        const BATCH_SIZE = 25;

        // Helper to batch write components
        const batchWriteComponents = async (items: typeof allComponentData) => {
          for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            await Promise.all(
              batch.map((c) =>
                entities.component
                  .create({
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    type: c.type,
                    projectId: c.projectId,
                    priority: c.priority,
                    estimatedHours: c.estimatedHours,
                    parentId: c.parentId || undefined,
                    status: c.status,
                  })
                  .go()
              )
            );
          }
        };

        // First pass: Create top-level components
        const topLevelData = allComponentData.filter((c) => !c.parentId);
        await batchWriteComponents(topLevelData);

        // Second pass: Create child components
        const childData = allComponentData.filter((c) => c.parentId);
        await batchWriteComponents(childData);

        // Batch create dependencies
        for (let i = 0; i < dependenciesToCreate.length; i += BATCH_SIZE) {
          const batch = dependenciesToCreate.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(({ id, dependentId, requiredId }) =>
              entities.dependency
                .create({
                  id,
                  dependentComponentId: dependentId,
                  requiredComponentId: requiredId,
                })
                .go()
                .catch(() => null) // Ignore duplicates
            )
          );
        }

        // Create sprints and update component assignments
        for (const sprint of sprintData) {
          await entities.sprint
            .create({
              id: sprint.id,
              name: sprint.name,
              goal: sprint.goal,
              teamId: sprint.teamId,
              startDate: sprint.startDate.toISOString(),
              endDate: sprint.endDate.toISOString(),
              status: 'PLANNING',
              capacity: sprint.capacity,
            })
            .go();

          // Batch update components with sprintId
          for (let i = 0; i < sprint.componentIds.length; i += BATCH_SIZE) {
            const batch = sprint.componentIds.slice(i, i + BATCH_SIZE);
            await Promise.all(
              batch.map((componentId) =>
                entities.component.update({ id: componentId }).set({ sprintId: sprint.id }).go()
              )
            );
          }
        }

        // Create epics and update children
        for (const epic of epicData) {
          await entities.component
            .create({
              id: epic.id,
              name: epic.name,
              description: epic.description,
              type: 'EPIC',
              projectId,
              priority: 5,
              estimatedHours: 0,
              status: 'PLANNING',
            })
            .go();

          // Batch update children with parentId
          for (let i = 0; i < epic.childIds.length; i += BATCH_SIZE) {
            const batch = epic.childIds.slice(i, i + BATCH_SIZE);
            await Promise.all(
              batch.map((childId) => entities.component.update({ id: childId }).set({ parentId: epic.id }).go())
            );
          }
        }

        // Log activity
        await entities.activity
          .create({
            id: activityId,
            type: 'COMPONENT_CREATED',
            projectId,
            userId,
            metadata: {
              aiGenerated: true,
              componentCount: components.length,
              sprintCount: sprintData.length,
              epicCount: epicData.length,
            },
          })
          .go();

        return { count: components.length };
      },
      { context: { action: 'applyAIComponents', projectId, componentCount: components.length } }
    );

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/team/${teamId}/sprints`);

    return {
      created: components.length,
      dependencies: dependenciesToCreate.length,
      sprints: sprintData.length,
      epics: epicData.length,
    };
  });

/**
 * Checks if AI features are configured
 */
export const checkAIStatus = authActionClient.schema(z.object({})).action(async () => {
  return { configured: isAIConfigured() };
});

// Schema for bulk plan refinement
const refineBulkPlanSchema = z.object({
  projectId: z.string().min(1),
  currentPlan: z.object({
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
    epics: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          componentNames: z.array(z.string()),
        }),
      )
      .optional(),
  }),
  refinementRequest: z.string().min(1, 'Please enter a refinement request').max(500),
  // Demo mode data
  demoProjectData: z
    .object({
      name: z.string(),
      description: z.string(),
      workflowType: z.enum(['SCRUM', 'KANBAN', 'CUSTOM']),
      cycleName: z.string().optional(),
    })
    .optional(),
});

/**
 * Refine a bulk AI-generated plan using conversational chat
 * Uses real Bedrock AI for both demo and production modes
 */
export const refineBulkAIPlan = authActionClient.schema(refineBulkPlanSchema).action(async ({ parsedInput, ctx }) => {
  const { projectId, currentPlan, refinementRequest, demoProjectData } = parsedInput;
  const { userId, isDemo } = ctx;

  // Check if AI is configured (required for both demo and production)
  if (!isAIConfigured()) {
    throw new MyCustomError('AI features require Amazon Bedrock access.');
  }

  let projectName: string;
  let projectDescription: string;
  let workflowType: 'SCRUM' | 'KANBAN' | 'CUSTOM';
  let cycleName: string | undefined;

  if (isDemo) {
    if (!demoProjectData) {
      throw new MyCustomError('Demo project data not provided');
    }
    projectName = demoProjectData.name;
    projectDescription = demoProjectData.description;
    workflowType = demoProjectData.workflowType;
    cycleName = demoProjectData.cycleName;
  } else {
    // Production mode - get project from DynamoDB
    const entities = getEntities();

    const access = await verifyProjectAccess(userId, projectId);
    if (!access) {
      throw new MyCustomError('Project not found or access denied');
    }

    projectName = access.project.name;
    projectDescription = access.project.description || '';

    // Fetch workflow config
    const workflowConfigResult = await entities.teamWorkflowConfig.query
      .primary({ teamId: access.project.teamId })
      .go();
    const config = workflowConfigResult.data[0];

    workflowType = (config?.workflowTemplate as 'SCRUM' | 'KANBAN' | 'CUSTOM') || 'CUSTOM';
    cycleName = config?.cycleName || undefined;
  }

  // Refine the plan using Bedrock AI
  const result = await refineBulkPlan({
    currentPlan,
    refinementRequest,
    projectContext: {
      projectName,
      projectDescription,
      workflowType,
      cycleName,
    },
  });

  return result;
});
