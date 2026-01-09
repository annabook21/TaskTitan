'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { generateComponents, isAIConfigured } from '@/lib/ai';

// Schemas - Use cuid() validation since Prisma generates CUIDs, not UUIDs
const createProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(1000).optional(),
  teamId: z.string().cuid('Invalid team ID'),
});

const updateProjectSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
});

const deleteProjectSchema = z.object({
  id: z.string().cuid(),
});

const createComponentSchema = z.object({
  projectId: z.string().cuid(),
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(2000).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  estimatedHours: z.number().min(0).max(1000).optional(),
  dueDate: z.string().optional(),
});

const updateComponentSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  estimatedHours: z.number().min(0).max(1000).optional(),
  dueDate: z.string().optional(),
});

const addDependencySchema = z.object({
  dependentComponentId: z.string().cuid(),
  requiredComponentId: z.string().cuid(),
  description: z.string().max(500).optional(),
});

// Actions
export const createProject = authActionClient.schema(createProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { name, description, teamId } = parsedInput;
  const { userId } = ctx;

  // Verify user is a member of the team
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership) {
    throw new Error('You are not a member of this team');
  }

  const project = await prisma.project.create({
    data: {
      name,
      description,
      teamId,
      ownerId: userId,
    },
  });

  // Log activity
  await prisma.activity.create({
    data: {
      type: 'PROJECT_CREATED',
      projectId: project.id,
      userId,
      metadata: { projectName: name },
    },
  });

  revalidatePath('/');
  revalidatePath('/projects');

  return { project };
});

export const updateProject = authActionClient.schema(updateProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description } = parsedInput;
  const { userId } = ctx;

  // Verify user has access to the project
  const project = await prisma.project.findFirst({
    where: {
      id,
      Team: { Membership: { some: { userId } } },
    },
  });

  if (!project) {
    throw new Error('Project not found or access denied');
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
    },
  });

  revalidatePath(`/projects/${id}`);
  revalidatePath('/projects');

  return { project: updated };
});

export const deleteProject = authActionClient.schema(deleteProjectSchema).action(async ({ parsedInput, ctx }) => {
  const { id } = parsedInput;
  const { userId } = ctx;

  // Verify user is owner
  const project = await prisma.project.findFirst({
    where: { id, ownerId: userId },
  });

  if (!project) {
    throw new Error('Only the project owner can delete it');
  }

  await prisma.project.delete({ where: { id } });

  revalidatePath('/');
  revalidatePath('/projects');

  return { success: true };
});

export const createComponent = authActionClient.schema(createComponentSchema).action(async ({ parsedInput, ctx }) => {
  const { projectId, name, description, priority, estimatedHours, dueDate } = parsedInput;
  const { userId } = ctx;

  // Verify user has access
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      Team: { Membership: { some: { userId } } },
    },
  });

  if (!project) {
    throw new Error('Project not found or access denied');
  }

  const component = await prisma.component.create({
    data: {
      name,
      description,
      projectId,
      priority: priority ?? 0,
      estimatedHours,
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  });

  // Log activity
  await prisma.activity.create({
    data: {
      type: 'COMPONENT_CREATED',
      projectId,
      userId,
      metadata: { componentName: name, componentId: component.id },
    },
  });

  revalidatePath(`/projects/${projectId}`);

  return { component };
});

export const updateComponent = authActionClient.schema(updateComponentSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description, status, priority, estimatedHours, dueDate } = parsedInput;
  const { userId } = ctx;

  // Verify access through project
  const component = await prisma.component.findFirst({
    where: {
      id,
      Project: { Team: { Membership: { some: { userId } } } },
    },
    include: { Project: true },
  });

  if (!component) {
    throw new Error('Component not found or access denied');
  }

  const oldStatus = component.status;

  const updated = await prisma.component.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(status && { status }),
      ...(priority !== undefined && { priority }),
      ...(estimatedHours !== undefined && { estimatedHours }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
    },
  });

  // Log status change
  if (status && status !== oldStatus) {
    await prisma.activity.create({
      data: {
        type: 'COMPONENT_STATUS_CHANGED',
        projectId: component.projectId,
        userId,
        metadata: {
          componentName: updated.name,
          componentId: id,
          oldStatus,
          newStatus: status,
        },
      },
    });
  }

  revalidatePath(`/projects/${component.projectId}`);

  return { component: updated };
});

export const addDependency = authActionClient.schema(addDependencySchema).action(async ({ parsedInput, ctx }) => {
  const { dependentComponentId, requiredComponentId, description } = parsedInput;
  const { userId } = ctx;

  if (dependentComponentId === requiredComponentId) {
    throw new Error('A component cannot depend on itself');
  }

  // Verify both components exist and belong to the same project
  const [dependent, required] = await Promise.all([
    prisma.component.findUnique({ where: { id: dependentComponentId } }),
    prisma.component.findUnique({ where: { id: requiredComponentId } }),
  ]);

  if (!dependent || !required) {
    throw new Error('One or both components not found');
  }

  if (dependent.projectId !== required.projectId) {
    throw new Error('Components must be in the same project');
  }

  const dependency = await prisma.dependency.create({
    data: {
      dependentComponentId,
      requiredComponentId,
      description,
    },
  });

  // Log activity
  await prisma.activity.create({
    data: {
      type: 'DEPENDENCY_ADDED',
      projectId: dependent.projectId,
      userId,
      metadata: {
        dependentComponent: dependent.name,
        requiredComponent: required.name,
      },
    },
  });

  revalidatePath(`/projects/${dependent.projectId}`);

  return { dependency };
});

export const removeDependency = authActionClient
  .schema(z.object({ id: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId } = ctx;

    const dependency = await prisma.dependency.findUnique({
      where: { id },
      include: {
        Component_Dependency_dependentComponentIdToComponent: true,
        Component_Dependency_requiredComponentIdToComponent: true,
      },
    });

    if (!dependency) {
      throw new Error('Dependency not found');
    }

    const dependentComponent = dependency.Component_Dependency_dependentComponentIdToComponent;
    const requiredComponent = dependency.Component_Dependency_requiredComponentIdToComponent;

    await prisma.dependency.delete({ where: { id } });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'DEPENDENCY_REMOVED',
        projectId: dependentComponent.projectId,
        userId,
        metadata: {
          dependentComponent: dependentComponent.name,
          requiredComponent: requiredComponent.name,
        },
      },
    });

    revalidatePath(`/projects/${dependentComponent.projectId}`);

    return { success: true };
  });

export const assignComponent = authActionClient
  .schema(
    z.object({
      componentId: z.string().cuid(),
      assigneeId: z.string(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, assigneeId } = parsedInput;
    const { userId } = ctx;

    const component = await prisma.component.findUnique({
      where: { id: componentId },
      include: { Project: true },
    });

    if (!component) {
      throw new Error('Component not found');
    }

    const assignment = await prisma.assignment.create({
      data: {
        componentId,
        userId: assigneeId,
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'MEMBER_ASSIGNED',
        projectId: component.projectId,
        userId,
        metadata: {
          componentName: component.name,
          assigneeId,
        },
      },
    });

    revalidatePath(`/projects/${component.projectId}`);

    return { assignment };
  });

export const unassignComponent = authActionClient
  .schema(
    z.object({
      componentId: z.string().cuid(),
      assigneeId: z.string(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const { componentId, assigneeId } = parsedInput;
    const { userId } = ctx;

    const component = await prisma.component.findUnique({
      where: { id: componentId },
    });

    if (!component) {
      throw new Error('Component not found');
    }

    await prisma.assignment.delete({
      where: {
        componentId_userId: { componentId, userId: assigneeId },
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'MEMBER_UNASSIGNED',
        projectId: component.projectId,
        userId,
        metadata: {
          componentName: component.name,
          assigneeId,
        },
      },
    });

    revalidatePath(`/projects/${component.projectId}`);

    return { success: true };
  });

// AI Component Generation
const generateComponentsSchema = z.object({
  projectId: z.string().cuid(),
});

export const generateAIComponents = authActionClient
  .schema(generateComponentsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId } = parsedInput;
    const { userId } = ctx;

    // Check if AI is configured
    if (!isAIConfigured()) {
      throw new Error('AI is not configured. Please add your OPENAI_API_KEY to .env.local');
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

    // Generate components using AI
    const result = await generateComponents(project.name, project.description, existingNames);

    return {
      components: result.components,
      summary: result.summary,
    };
  });

const applyAIComponentsSchema = z.object({
  projectId: z.string().cuid(),
  components: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      estimatedHours: z.number(),
      priority: z.number(),
      suggestedDependencies: z.array(z.string()),
    }),
  ),
});

export const applyAIComponents = authActionClient
  .schema(applyAIComponentsSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { projectId, components } = parsedInput;
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

    // Create all components
    const createdComponents = await Promise.all(
      components.map(async (c) => {
        return prisma.component.create({
          data: {
            name: c.name,
            description: c.description,
            projectId,
            priority: c.priority,
            estimatedHours: c.estimatedHours,
          },
        });
      }),
    );

    // Create a map of name to ID for dependency resolution
    const nameToId = new Map(createdComponents.map((c) => [c.name, c.id]));

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

    // Log activity
    await prisma.activity.create({
      data: {
        type: 'COMPONENT_CREATED',
        projectId,
        userId,
        metadata: {
          aiGenerated: true,
          componentCount: createdComponents.length,
        },
      },
    });

    revalidatePath(`/projects/${projectId}`);

    return {
      created: createdComponents.length,
      dependencies: dependenciesToCreate.length,
    };
  });

export const checkAIStatus = authActionClient.schema(z.object({})).action(async () => {
  return { configured: isAIConfigured() };
});
