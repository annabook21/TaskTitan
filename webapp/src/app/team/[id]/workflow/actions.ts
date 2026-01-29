'use server';

import { randomUUID } from 'crypto';
import { authActionClient } from '@/lib/safe-action';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { MyCustomError } from '@/lib/safe-action';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

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
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) {
      throw new MyCustomError('You are not a member of this team');
    }

    const entities = getEntities();
    const result = await entities.teamWorkflowConfig.get({ teamId }).go();

    if (!result.data) {
      // Create default config with sprints enabled
      const newConfig = await entities.teamWorkflowConfig
        .upsert({
          id: randomUUID(),
          teamId,
          cycleEnabled: true,
          cycleDurationWeeks: 2,
          cycleStartDayOfWeek: 1,
          workflowTemplate: 'SCRUM',
          cycleName: 'Sprint',
          backlogName: 'Backlog',
          enforceEstimates: false,
          autoArchiveCompleted: false,
        })
        .go();
      return { config: newConfig.data };
    }

    return { config: result.data };
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
    const access = await verifyTeamMembership(userId, teamId);
    if (!access || (access.membership.role !== 'OWNER' && access.membership.role !== 'ADMIN')) {
      throw new MyCustomError('You must be a team owner or admin to update workflow settings');
    }

    const entities = getEntities();

    // Get existing config to preserve the id
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

    revalidatePath(`/team/${teamId}`);
    revalidatePath(`/team/${teamId}/workflow`);

    // Revalidate all project pages for this team
    const projects = await entities.project.query.byTeam({ teamId }).go();
    for (const project of projects.data) {
      revalidatePath(`/projects/${project.id}`);
    }

    return { config: result.data };
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
    const access = await verifyTeamMembership(userId, teamId);
    if (!access) {
      throw new MyCustomError('You are not a member of this team');
    }

    const entities = getEntities();
    const result = await entities.teamWorkflowConfig.get({ teamId }).go();
    const config = result.data;

    if (!config || !config.cycleEnabled || !config.cycleDurationWeeks || config.cycleStartDayOfWeek === null) {
      return { currentCycle: null };
    }

    // Calculate current cycle dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cycleStartDayOfWeek = config.cycleStartDayOfWeek ?? 1; // Default to Monday
    const cycleDurationDays = (config.cycleDurationWeeks ?? 2) * 7;

    let cycleStartDate = new Date(today);
    const todayDayOfWeek = today.getDay();
    const daysToSubtract = (todayDayOfWeek - cycleStartDayOfWeek + 7) % 7;
    cycleStartDate.setDate(today.getDate() - daysToSubtract);

    const cycleEndDate = new Date(cycleStartDate);
    cycleEndDate.setDate(cycleStartDate.getDate() + cycleDurationDays);

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
