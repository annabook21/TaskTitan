'use server';

import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { MyCustomError } from '@/lib/safe-action';

// Zod schema for workflow configuration
const workflowConfigSchema = z.object({
  teamId: z.string().cuid(),
  wipLimitPlanning: z.number().int().positive().optional().nullable(),
  wipLimitInProgress: z.number().int().positive().optional().nullable(),
  wipLimitBlocked: z.number().int().positive().optional().nullable(),
  wipLimitReview: z.number().int().positive().optional().nullable(),
  cycleEnabled: z.boolean(),
  cycleDurationWeeks: z.number().int().min(1).max(6).optional().nullable(),
  cycleStartDayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
  // Workflow template and terminology
  workflowTemplate: z.enum(['SCRUM', 'KANBAN', 'SHAPE_UP', 'CUSTOM']).optional().nullable(),
  cycleName: z.string().min(1).max(20).optional().nullable(),
  backlogName: z.string().min(1).max(20).optional().nullable(),
  enforceEstimates: z.boolean(),
  autoArchiveCompleted: z.boolean(),
});

/**
 * Get workflow configuration for a team, creating default if not exists
 */
export const getWorkflowConfig = authActionClient
  .schema(z.object({ teamId: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { teamId } = parsedInput;
    const { userId } = ctx;

    // Check if user is a member of the team
    const membership = await prisma.membership.findFirst({
      where: { teamId, userId },
    });

    if (!membership) {
      throw new MyCustomError('You are not a member of this team');
    }

    // Get or create workflow config
    let config = await prisma.teamWorkflowConfig.findUnique({
      where: { teamId },
    });

    // Create default config if it doesn't exist
    if (!config) {
      config = await prisma.teamWorkflowConfig.create({
        data: {
          teamId,
          cycleEnabled: false, // Default to no cycles (workflow freedom)
          enforceEstimates: false,
          autoArchiveCompleted: false,
        },
      });
    }

    return { config };
  });

/**
 * Update workflow configuration for a team
 */
export const updateWorkflowConfig = authActionClient
  .schema(workflowConfigSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { teamId, ...configData } = parsedInput;
    const { userId, isDemo } = ctx;

    // Demo mode - return marker for client-side handling
    if (isDemo) {
      return {
        _demo: true,
        _action: 'updateWorkflowConfig',
        _input: { teamId, ...configData },
      };
    }

    // Check if user is owner or admin
    const membership = await prisma.membership.findFirst({
      where: {
        teamId,
        userId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
    });

    if (!membership) {
      throw new MyCustomError('You must be a team owner or admin to update workflow settings');
    }

    // Update or create config
    const config = await prisma.teamWorkflowConfig.upsert({
      where: { teamId },
      update: configData,
      create: {
        teamId,
        ...configData,
      },
    });

    revalidatePath(`/team/${teamId}`);
    revalidatePath(`/team/${teamId}/workflow`);

    // Revalidate all project pages for this team
    const projects = await prisma.project.findMany({
      where: { teamId },
      select: { id: true },
    });

    for (const project of projects) {
      revalidatePath(`/projects/${project.id}`);
    }

    return { config };
  });

/**
 * Get the current cycle information for a team
 */
export const getCurrentCycle = authActionClient
  .schema(z.object({ teamId: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { teamId } = parsedInput;
    const { userId } = ctx;

    // Check if user is a member of the team
    const membership = await prisma.membership.findFirst({
      where: { teamId, userId },
    });

    if (!membership) {
      throw new MyCustomError('You are not a member of this team');
    }

    // Get workflow config
    const config = await prisma.teamWorkflowConfig.findUnique({
      where: { teamId },
    });

    if (!config || !config.cycleEnabled || !config.cycleDurationWeeks || config.cycleStartDayOfWeek === null) {
      return { currentCycle: null };
    }

    // Calculate current cycle dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the most recent cycle start date
    const cycleStartDayOfWeek = config.cycleStartDayOfWeek;
    const cycleDurationDays = config.cycleDurationWeeks * 7;

    // Calculate the most recent cycle start date
    let cycleStartDate = new Date(today);
    const todayDayOfWeek = today.getDay();

    // Go back to the most recent cycle start day
    let daysToSubtract = (todayDayOfWeek - cycleStartDayOfWeek + 7) % 7;

    // Adjust to find the start of the current cycle period
    cycleStartDate.setDate(today.getDate() - daysToSubtract);

    // Check if we need to go back further to align with cycle periods
    // This ensures cycles are consistent (e.g., every 2 weeks starting from a reference date)
    const cycleEndDate = new Date(cycleStartDate);
    cycleEndDate.setDate(cycleStartDate.getDate() + cycleDurationDays);

    // If today is past the cycle end date, move to the next cycle
    if (today >= cycleEndDate) {
      cycleStartDate = new Date(cycleEndDate);
      cycleEndDate.setDate(cycleEndDate.getDate() + cycleDurationDays);
    }

    const daysElapsed = Math.ceil((today.getTime() - cycleStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.ceil((cycleEndDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    return {
      currentCycle: {
        startDate: cycleStartDate,
        endDate: cycleEndDate,
        daysElapsed,
        daysRemaining,
        durationWeeks: config.cycleDurationWeeks,
      },
    };
  });
