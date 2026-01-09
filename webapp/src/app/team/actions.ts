'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';

const createTeamSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});

const updateTeamSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const inviteMemberSchema = z.object({
  teamId: z.string().cuid(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

const updateMemberRoleSchema = z.object({
  teamId: z.string().cuid(),
  userId: z.string(),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

const removeMemberSchema = z.object({
  teamId: z.string().cuid(),
  userId: z.string(),
});

export const createTeam = authActionClient.schema(createTeamSchema).action(async ({ parsedInput, ctx }) => {
  const { name, description } = parsedInput;
  const { userId } = ctx;

  // Create team and add creator as owner
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
    },
  });

  revalidatePath('/');
  revalidatePath('/team');

  return { team };
});

export const updateTeam = authActionClient.schema(updateTeamSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description } = parsedInput;
  const { userId } = ctx;

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
  const { userId } = ctx;

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
  .schema(z.object({ id: z.string().cuid() }))
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId } = ctx;

    // Verify user is owner
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId: id } },
    });

    if (!membership || membership.role !== 'OWNER') {
      throw new Error('Only the team owner can delete the team');
    }

    await prisma.team.delete({ where: { id } });

    revalidatePath('/');
    revalidatePath('/team');

    return { success: true };
  });
