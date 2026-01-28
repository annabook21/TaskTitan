'use server';

import { randomUUID } from 'crypto';
import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { MyCustomError } from '@/lib/safe-action';
import { getEntities } from '@/lib/dynamodb/service';
import { dualWrite, dualRead } from '@/lib/dynamodb/dual-write';
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';

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

    const phase = getMigrationPhase('teamWorkflowConfig');
    const entities = getEntities();

    // Get or create workflow config using dual-read pattern
    const config = await dualRead(
      'teamWorkflowConfig',
      async () => {
        // Prisma read with create-if-not-exists
        let prismaConfig = await prisma.teamWorkflowConfig.findUnique({
          where: { teamId },
        });

        if (!prismaConfig) {
          prismaConfig = await prisma.teamWorkflowConfig.create({
            data: {
              teamId,
              cycleEnabled: false,
              enforceEstimates: false,
              autoArchiveCompleted: false,
            },
          });
        }

        return prismaConfig;
      },
      async () => {
        // ElectroDB read with upsert-if-not-exists
        const result = await entities.teamWorkflowConfig.get({ teamId }).go();

        if (!result.data) {
          // Create default config
          const newConfig = await entities.teamWorkflowConfig
            .upsert({
              id: randomUUID(),
              teamId,
              cycleEnabled: false,
              enforceEstimates: false,
              autoArchiveCompleted: false,
            })
            .go();
          return newConfig.data;
        }

        return result.data;
      },
      { context: { action: 'getWorkflowConfig', teamId } }
    );

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

    const entities = getEntities();

    // Use dual-write with upsert pattern
    const result = await dualWrite(
      'teamWorkflowConfig',
      'upsert',
      async () => {
        // Prisma upsert
        return prisma.teamWorkflowConfig.upsert({
          where: { teamId },
          update: configData,
          create: {
            teamId,
            ...configData,
          },
        });
      },
      async () => {
        // ElectroDB upsert - uses create if not exists, update if exists
        // First try to get existing config to preserve the id
        const existing = await entities.teamWorkflowConfig.get({ teamId }).go();

        const upsertData = {
          id: existing.data?.id || randomUUID(),
          teamId,
          cycleEnabled: configData.cycleEnabled,
          enforceEstimates: configData.enforceEstimates,
          autoArchiveCompleted: configData.autoArchiveCompleted,
          // Convert nulls to undefined for ElectroDB
          wipLimitPlanning: configData.wipLimitPlanning ?? undefined,
          wipLimitInProgress: configData.wipLimitInProgress ?? undefined,
          wipLimitBlocked: configData.wipLimitBlocked ?? undefined,
          wipLimitReview: configData.wipLimitReview ?? undefined,
          cycleDurationWeeks: configData.cycleDurationWeeks ?? undefined,
          cycleStartDayOfWeek: configData.cycleStartDayOfWeek ?? undefined,
          workflowTemplate: configData.workflowTemplate ?? undefined,
          cycleName: configData.cycleName ?? undefined,
          backlogName: configData.backlogName ?? undefined,
        };

        const result = await entities.teamWorkflowConfig.upsert(upsertData).go();
        return result.data;
      },
      { context: { action: 'updateWorkflowConfig', teamId } }
    );

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

    return { config: result.data };
  });

/**
 * Get the current cycle information for a team
 * This is a read-only calculation based on workflow config
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

    const entities = getEntities();

    // Get workflow config using dual-read
    const config = await dualRead(
      'teamWorkflowConfig',
      async () => {
        return prisma.teamWorkflowConfig.findUnique({
          where: { teamId },
        });
      },
      async () => {
        const result = await entities.teamWorkflowConfig.get({ teamId }).go();
        return result.data;
      },
      { context: { action: 'getCurrentCycle', teamId } }
    );

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
    const daysToSubtract = (todayDayOfWeek - cycleStartDayOfWeek + 7) % 7;

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
