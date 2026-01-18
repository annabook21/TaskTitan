'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient, MyCustomError } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { generateComponents, isAIConfigured, type TeamCapacityInfo } from '@/lib/ai';

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

      return generateDemoComponents({
        projectName,
        projectDescription,
        existingNames,
        generateEpics,
        workflowConfig,
        teamCapacity,
      });
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
              // Include memberships for capacity calculation
              Membership: {
                include: {
                  User: { select: { name: true } },
                },
              },
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

      // Calculate team capacity for Scrum workflows
      if (project.Team.WorkflowConfig?.cycleEnabled) {
        const memberships = project.Team.Membership;
        const sprintDays = (project.Team.WorkflowConfig.cycleDurationWeeks ?? 2) * 5;

        const members = memberships.map((m) => ({
          name: m.User.name || 'Unknown',
          title: m.title ?? undefined,
          hoursPerDay: m.hoursPerDay ?? 6,
          availability: m.availability ?? 100,
        }));

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

    // Check if AI is configured (required for production)
    if (!isAIConfigured()) {
      throw new MyCustomError('AI features require Amazon Bedrock access in your AWS account.');
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

type DemoGenerationInput = {
  projectName: string;
  projectDescription: string;
  existingNames: string[];
  generateEpics: boolean;
  workflowConfig: Parameters<typeof generateComponents>[4];
  teamCapacity?: TeamCapacityInfo;
};

function generateDemoComponents({
  projectName,
  projectDescription,
  existingNames,
  generateEpics,
  workflowConfig,
  teamCapacity,
}: DemoGenerationInput) {
  const description = projectDescription.trim();
  const existingLookup = new Set(existingNames.map((name) => name.toLowerCase()));
  const isKanban = !workflowConfig?.cycleEnabled;

  const keywordTemplates = [
    {
      keywords: ['auth', 'login', 'signup', 'password'],
      name: 'Authentication flow',
      description: 'Enable secure sign-in, registration, and account recovery.',
    },
    {
      keywords: ['billing', 'payment', 'checkout', 'invoice', 'subscription'],
      name: 'Billing & subscriptions',
      description: 'Support billing flows, invoices, and subscription management.',
    },
    {
      keywords: ['notification', 'email', 'sms', 'alert'],
      name: 'Notification delivery',
      description: 'Send timely updates across email, in-app, and messaging channels.',
    },
    {
      keywords: ['analytics', 'report', 'insight', 'dashboard'],
      name: 'Analytics dashboard',
      description: 'Surface key metrics and project health in a unified view.',
    },
    {
      keywords: ['integration', 'webhook', 'api'],
      name: 'External integrations',
      description: 'Connect with third-party systems via APIs and webhooks.',
    },
  ];

  const defaultTemplates = [
    {
      name: 'Project setup & roles',
      description: 'Define project roles, permissions, and onboarding steps.',
    },
    {
      name: 'Core workflow management',
      description: 'Create the primary workflow for planning and delivery.',
    },
    {
      name: 'Task lifecycle updates',
      description: 'Track status changes, blockers, and completion signals.',
    },
    {
      name: 'Search & filtering',
      description: 'Help the team find work items quickly with filters.',
    },
    {
      name: 'Collaboration & comments',
      description: 'Enable team discussions and feedback loops on work items.',
    },
    {
      name: 'Release readiness checklist',
      description: 'Keep shipping criteria visible and actionable.',
    },
  ];

  const candidates: Array<{ name: string; description: string }> = [];
  const lowered = description.toLowerCase();
  for (const template of keywordTemplates) {
    if (template.keywords.some((keyword) => lowered.includes(keyword))) {
      candidates.push({ name: template.name, description: template.description });
    }
  }
  candidates.push(...defaultTemplates);

  const components = candidates
    .filter((template) => !existingLookup.has(template.name.toLowerCase()))
    .slice(0, 8)
    .map((template, index) => {
      const type = isKanban ? (index === 0 ? 'FEATURE' : 'TASK') : 'STORY';
      const baseHours = isKanban ? 10 : 8;
      return {
        name: template.name,
        description: template.description,
        type,
        estimatedHours: baseHours + (index % 3) * 2,
        priority: Math.max(1, 5 - index),
        suggestedDependencies: [],
        parentName: undefined,
      };
    });

  for (let i = 1; i < components.length; i++) {
    components[i].suggestedDependencies = [components[i - 1].name];
  }

  const sprints = !isKanban
    ? (() => {
        const durationWeeks = Math.max(1, workflowConfig?.cycleDurationWeeks ?? 2);
        const sprintCapacity = teamCapacity ? Math.round(teamCapacity.totalCapacityHours * 0.8) : undefined;
        const midpoint = Math.ceil(components.length / 2);
        const sprintOneComponents = components.slice(0, midpoint).map((c) => c.name);
        const sprintTwoComponents = components.slice(midpoint).map((c) => c.name);
        return [
          {
            name: 'Sprint 1',
            goal: `Kickstart ${projectName} with core foundations.`,
            durationWeeks,
            componentNames: sprintOneComponents,
            capacity: sprintCapacity,
          },
          {
            name: 'Sprint 2',
            goal: `Deliver key workflows and polish ${projectName}.`,
            durationWeeks,
            componentNames: sprintTwoComponents,
            capacity: sprintCapacity,
          },
        ].filter((sprint) => sprint.componentNames.length > 0);
      })()
    : undefined;

  const epics =
    !isKanban && generateEpics
      ? [
          {
            name: 'Foundation & core flows',
            description: 'Foundational work items that unlock delivery.',
            componentNames: components.slice(0, Math.ceil(components.length / 2)).map((c) => c.name),
          },
          {
            name: 'Experience & quality',
            description: 'Enhancements that improve usability and reliability.',
            componentNames: components.slice(Math.ceil(components.length / 2)).map((c) => c.name),
          },
        ].filter((epic) => epic.componentNames.length > 0)
      : undefined;

  const summary = `AI-generated ${components.length} work items for ${projectName}.`;
  const enhancedDescription = description
    ? `${description}\n\nAI suggestion: Focus on a clear core flow, then expand with collaboration and reporting.`
    : `Plan the core workflow and collaboration experience for ${projectName}.`;

  return {
    components,
    summary,
    enhancedDescription,
    sprints,
    epics,
  };
}

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
