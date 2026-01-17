'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { getTemplateSettings, type WorkflowTemplateKey } from '@/lib/workflow-templates';

const createTeamSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  workflowTemplate: z.enum(['SCRUM', 'KANBAN', 'SHAPE_UP', 'CUSTOM']).optional(),
});

const updateTeamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const inviteMemberSchema = z.object({
  teamId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

const updateMemberRoleSchema = z.object({
  teamId: z.string().min(1),
  userId: z.string(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

const removeMemberSchema = z.object({
  teamId: z.string().min(1),
  userId: z.string(),
});

export const createTeam = authActionClient.schema(createTeamSchema).action(async ({ parsedInput, ctx }) => {
  const { name, description, workflowTemplate } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'createTeam', _input: { name, description, workflowTemplate, userId } };
  }

  // Get template settings (defaults to CUSTOM if not specified)
  const templateKey: WorkflowTemplateKey = workflowTemplate ?? 'CUSTOM';
  const templateSettings = getTemplateSettings(templateKey);

  // Create team and add creator as owner, with workflow config
  const team = await prisma.team.create({
    data: {
      name,
      description,
      Membership: {
        create: {
          userId,
          role: 'OWNER',
        },
      },
      WorkflowConfig: {
        create: {
          workflowTemplate: templateKey,
          ...(templateSettings && {
            cycleEnabled: templateSettings.cycleEnabled,
            cycleDurationWeeks: templateSettings.cycleDurationWeeks,
            cycleStartDayOfWeek: templateSettings.cycleStartDayOfWeek,
            cycleName: templateSettings.cycleName,
            backlogName: templateSettings.backlogName,
            enforceEstimates: templateSettings.enforceEstimates,
            wipLimitPlanning: templateSettings.wipLimitPlanning,
            wipLimitInProgress: templateSettings.wipLimitInProgress,
            wipLimitBlocked: templateSettings.wipLimitBlocked,
            wipLimitReview: templateSettings.wipLimitReview,
            autoArchiveCompleted: templateSettings.autoArchiveCompleted,
          }),
        },
      },
    },
  });

  revalidatePath('/');
  revalidatePath('/team');

  return { team };
});

export const updateTeam = authActionClient.schema(updateTeamSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'updateTeam', _input: { teamId: id, name, description } };
  }

  // Verify user is admin or owner
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId: id } },
  });

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    throw new Error('Only team owners and admins can update team settings');
  }

  const team = await prisma.team.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
    },
  });

  revalidatePath(`/team/${id}`);
  revalidatePath('/team');

  return { team };
});

export const inviteMember = authActionClient.schema(inviteMemberSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, email, role } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'inviteMember', _input: { teamId, email, role } };
  }

  // Verify inviter is admin or owner
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
    throw new Error('Only team owners and admins can invite members');
  }

  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error('User not found. They need to sign up first.');
  }

  // Check if already a member
  const existing = await prisma.membership.findUnique({
    where: { userId_teamId: { userId: user.id, teamId } },
  });

  if (existing) {
    throw new Error('User is already a member of this team');
  }

  const newMembership = await prisma.membership.create({
    data: {
      userId: user.id,
      teamId,
      role,
    },
  });

  revalidatePath(`/team/${teamId}`);

  return { membership: newMembership };
});

export const updateMemberRole = authActionClient.schema(updateMemberRoleSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, userId: targetUserId, role } = parsedInput;
  const { userId } = ctx;

  // Verify current user is owner
  const currentMembership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });

  if (!currentMembership || currentMembership.role !== 'OWNER') {
    throw new Error('Only the team owner can change member roles');
  }

  // Cannot change owner's role
  const targetMembership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId: targetUserId, teamId } },
  });

  if (targetMembership?.role === 'OWNER') {
    throw new Error('Cannot change the role of the team owner');
  }

  const updated = await prisma.membership.update({
    where: { userId_teamId: { userId: targetUserId, teamId } },
    data: { role },
  });

  revalidatePath(`/team/${teamId}`);

  return { membership: updated };
});

export const removeMember = authActionClient.schema(removeMemberSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, userId: targetUserId } = parsedInput;
  const { userId } = ctx;

  // Check if removing self
  if (userId === targetUserId) {
    // Allow leaving team unless owner
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });

    if (membership?.role === 'OWNER') {
      throw new Error('Team owner cannot leave. Transfer ownership first.');
    }
  } else {
    // Verify current user is admin or owner
    const currentMembership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });

    if (!currentMembership || !['OWNER', 'ADMIN'].includes(currentMembership.role)) {
      throw new Error('Only team owners and admins can remove members');
    }

    // Cannot remove owner
    const targetMembership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: targetUserId, teamId } },
    });

    if (targetMembership?.role === 'OWNER') {
      throw new Error('Cannot remove the team owner');
    }
  }

  await prisma.membership.delete({
    where: { userId_teamId: { userId: targetUserId, teamId } },
  });

  revalidatePath(`/team/${teamId}`);
  revalidatePath('/team');

  return { success: true };
});

export const deleteTeam = authActionClient
  .schema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    try {
      const { id } = parsedInput;
      const { userId, isDemo } = ctx;

      // Demo mode - return marker for client-side handling
      if (isDemo) {
        return { _demo: true, _action: 'deleteTeam', _input: { teamId: id } };
      }

      // Verify user is owner
      const membership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId, teamId: id } },
      });

      if (!membership || membership.role !== 'OWNER') {
        throw new Error('Only the team owner can delete the team');
      }

      // Cascades are set up in schema (Team -> Project, Membership, Sprint)
      // Projects cascade to Components -> Assignments, Dependencies
      // So we can delete the team directly
      await prisma.team.delete({ where: { id } });

      revalidatePath('/');
      revalidatePath('/team');

      return { success: true };
    } catch (error) {
      // If it's already our error, re-throw it
      if (error instanceof Error && error.message.includes('owner')) {
        throw error;
      }

      // For FK constraint errors or other Prisma errors, provide a helpful message
      console.error('Error deleting team:', error);
      throw new Error('Failed to delete team. Please ensure all related data can be deleted.');
    }
  });
