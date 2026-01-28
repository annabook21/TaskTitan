'use server';

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { authActionClient } from '@/lib/safe-action';
import { revalidatePath } from 'next/cache';
import { getTemplateSettings, type WorkflowTemplateKey } from '@/lib/workflow-templates';

// DynamoDB migration imports
import { dualWrite } from '@/lib/dynamodb/dual-write';
import { verifyTeamMembership, isTeamOwner } from '@/lib/dynamodb/auth-helpers';
import { batchDelete } from '@/lib/dynamodb/batch-ops';
import { getEntities, getService } from '@/lib/dynamodb/service';
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';

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
  title: z.string().max(100).optional(),
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

  // Generate IDs for DynamoDB (Prisma auto-generates, but we need consistent IDs for dual-write)
  const teamId = randomUUID();
  const membershipId = randomUUID();
  const workflowConfigId = randomUUID();

  const result = await dualWrite(
    'team',
    'create',
    // Prisma operation - nested creates in one call
    async () => {
      return prisma.team.create({
        data: {
          id: teamId,
          name,
          description,
          Membership: {
            create: {
              id: membershipId,
              userId,
              role: 'OWNER',
            },
          },
          WorkflowConfig: {
            create: {
              id: workflowConfigId,
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
    },
    // ElectroDB operation - use Service transaction for atomic multi-entity create
    // Reference: https://electrodb.dev/en/mutations/transact-write/
    async () => {
      const service = getService();

      await service.transaction
        .write(({ team, membership, teamWorkflowConfig }) => [
          team.create({ id: teamId, name, description }).commit(),
          membership.create({ id: membershipId, teamId, userId, role: 'OWNER' }).commit(),
          teamWorkflowConfig
            .create({
              id: workflowConfigId,
              teamId,
              workflowTemplate: templateKey,
              ...(templateSettings && {
                cycleEnabled: templateSettings.cycleEnabled,
                cycleDurationWeeks: templateSettings.cycleDurationWeeks ?? undefined,
                cycleStartDayOfWeek: templateSettings.cycleStartDayOfWeek ?? undefined,
                cycleName: templateSettings.cycleName ?? undefined,
                backlogName: templateSettings.backlogName ?? undefined,
                enforceEstimates: templateSettings.enforceEstimates,
                wipLimitPlanning: templateSettings.wipLimitPlanning ?? undefined,
                wipLimitInProgress: templateSettings.wipLimitInProgress ?? undefined,
                wipLimitBlocked: templateSettings.wipLimitBlocked ?? undefined,
                wipLimitReview: templateSettings.wipLimitReview ?? undefined,
                autoArchiveCompleted: templateSettings.autoArchiveCompleted,
              }),
            })
            .commit(),
        ])
        .go();

      return { id: teamId, name, description };
    }
  );

  revalidatePath('/');
  revalidatePath('/team');

  return { team: result.data };
});

export const updateTeam = authActionClient.schema(updateTeamSchema).action(async ({ parsedInput, ctx }) => {
  const { id, name, description } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'updateTeam', _input: { teamId: id, name, description } };
  }

  // Verify user is admin or owner
  const phase = getMigrationPhase('team');
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyTeamMembership(userId, id, ['OWNER', 'ADMIN']);
    if (!access) {
      throw new Error('Only team owners and admins can update team settings');
    }
  } else {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId: id } },
    });
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new Error('Only team owners and admins can update team settings');
    }
  }

  const result = await dualWrite(
    'team',
    'update',
    async () => {
      return prisma.team.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
        },
      });
    },
    async () => {
      const { team } = getEntities();
      const updateData: Record<string, unknown> = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;

      const updated = await team.update({ id }).set(updateData).go({ response: 'all_new' });
      return updated.data;
    }
  );

  revalidatePath(`/team/${id}`);
  revalidatePath('/team');

  return { team: result.data };
});

export const inviteMember = authActionClient.schema(inviteMemberSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, email, role, title } = parsedInput;
  const { userId, isDemo } = ctx;

  // Demo mode - return marker for client-side handling
  if (isDemo) {
    return { _demo: true, _action: 'inviteMember', _input: { teamId, email, role, title } };
  }

  const phase = getMigrationPhase('membership');
  const { user: userEntity, membership: membershipEntity } = getEntities();

  // Verify inviter is admin or owner
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const access = await verifyTeamMembership(userId, teamId, ['OWNER', 'ADMIN']);
    if (!access) {
      throw new Error('Only team owners and admins can invite members');
    }
  } else {
    const membership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new Error('Only team owners and admins can invite members');
    }
  }

  // Find user by email
  let targetUser: { id: string; email: string } | null = null;

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    // Query DynamoDB by email GSI - Reference: https://electrodb.dev/en/queries/query/
    const result = await userEntity.query.byEmail({ email }).go();
    targetUser = result.data[0] ?? null;
  } else {
    targetUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
  }

  if (!targetUser) {
    throw new Error('User not found. They need to sign up first.');
  }

  // Check if already a member - use .get() since we have full composite key (teamId in PK, userId in SK)
  // Reference: https://electrodb.dev/en/queries/find/
  let existingMembership = null;

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const result = await membershipEntity.get({ teamId, userId: targetUser.id }).go();
    existingMembership = result.data;
  } else {
    existingMembership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: targetUser.id, teamId } },
    });
  }

  if (existingMembership) {
    throw new Error('User is already a member of this team');
  }

  const membershipId = randomUUID();

  const result = await dualWrite(
    'membership',
    'create',
    async () => {
      return prisma.membership.create({
        data: {
          id: membershipId,
          userId: targetUser!.id,
          teamId,
          role,
          title: title || null,
        },
      });
    },
    async () => {
      const created = await membershipEntity
        .create({
          id: membershipId,
          userId: targetUser!.id,
          teamId,
          role,
          title: title || undefined,
        })
        .go();
      return created.data;
    }
  );

  revalidatePath(`/team/${teamId}`);

  return { membership: result.data };
});

export const updateMemberRole = authActionClient.schema(updateMemberRoleSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, userId: targetUserId, role } = parsedInput;
  const { userId } = ctx;

  const phase = getMigrationPhase('membership');
  const { membership: membershipEntity } = getEntities();

  // Verify current user is owner
  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const isOwner = await isTeamOwner(userId, teamId);
    if (!isOwner) {
      throw new Error('Only the team owner can change member roles');
    }
  } else {
    const currentMembership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId, teamId } },
    });
    if (!currentMembership || currentMembership.role !== 'OWNER') {
      throw new Error('Only the team owner can change member roles');
    }
  }

  // Check target user's role - use .get() with full composite key
  let targetMembershipRole: string | null = null;

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    const result = await membershipEntity.get({ teamId, userId: targetUserId }).go();
    targetMembershipRole = result.data?.role ?? null;
  } else {
    const targetMembership = await prisma.membership.findUnique({
      where: { userId_teamId: { userId: targetUserId, teamId } },
    });
    targetMembershipRole = targetMembership?.role ?? null;
  }

  if (targetMembershipRole === 'OWNER') {
    throw new Error('Cannot change the role of the team owner');
  }

  const result = await dualWrite(
    'membership',
    'update',
    async () => {
      return prisma.membership.update({
        where: { userId_teamId: { userId: targetUserId, teamId } },
        data: { role },
      });
    },
    async () => {
      const updated = await membershipEntity
        .update({ teamId, userId: targetUserId })
        .set({ role })
        .go({ response: 'all_new' });
      return updated.data;
    }
  );

  revalidatePath(`/team/${teamId}`);

  return { membership: result.data };
});

export const removeMember = authActionClient.schema(removeMemberSchema).action(async ({ parsedInput, ctx }) => {
  const { teamId, userId: targetUserId } = parsedInput;
  const { userId } = ctx;

  const phase = getMigrationPhase('membership');
  const { membership: membershipEntity } = getEntities();

  // Check if removing self
  if (userId === targetUserId) {
    // Allow leaving team unless owner - use .get() with full composite key
    let userRole: string | null = null;

    if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
      const result = await membershipEntity.get({ teamId, userId }).go();
      userRole = result.data?.role ?? null;
    } else {
      const membership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });
      userRole = membership?.role ?? null;
    }

    if (userRole === 'OWNER') {
      throw new Error('Team owner cannot leave. Transfer ownership first.');
    }
  } else {
    // Verify current user is admin or owner
    if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
      const access = await verifyTeamMembership(userId, teamId, ['OWNER', 'ADMIN']);
      if (!access) {
        throw new Error('Only team owners and admins can remove members');
      }
    } else {
      const currentMembership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });
      if (!currentMembership || !['OWNER', 'ADMIN'].includes(currentMembership.role)) {
        throw new Error('Only team owners and admins can remove members');
      }
    }

    // Cannot remove owner - use .get() with full composite key
    let targetRole: string | null = null;

    if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
      const result = await membershipEntity.get({ teamId, userId: targetUserId }).go();
      targetRole = result.data?.role ?? null;
    } else {
      const targetMembership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId: targetUserId, teamId } },
      });
      targetRole = targetMembership?.role ?? null;
    }

    if (targetRole === 'OWNER') {
      throw new Error('Cannot remove the team owner');
    }
  }

  await dualWrite(
    'membership',
    'delete',
    async () => {
      await prisma.membership.delete({
        where: { userId_teamId: { userId: targetUserId, teamId } },
      });
      return { success: true };
    },
    async () => {
      await membershipEntity.delete({ teamId, userId: targetUserId }).go();
      return { success: true };
    }
  );

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

      const phase = getMigrationPhase('team');

      // Verify user is owner
      if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
        const isOwner = await isTeamOwner(userId, id);
        if (!isOwner) {
          throw new Error('Only the team owner can delete the team');
        }
      } else {
        const membership = await prisma.membership.findUnique({
          where: { userId_teamId: { userId, teamId: id } },
        });
        if (!membership || membership.role !== 'OWNER') {
          throw new Error('Only the team owner can delete the team');
        }
      }

      await dualWrite(
        'team',
        'delete',
        // Prisma operation - cascades are set up in schema
        async () => {
          await prisma.team.delete({ where: { id } });
          return { success: true };
        },
        // ElectroDB operation - must manually cascade (no automatic cascade)
        // Reference: https://electrodb.dev/en/mutations/transact-write/
        async () => {
          const {
            team,
            membership: membershipEntity,
            project,
            sprint,
            teamWorkflowConfig,
            component,
            activity,
            assignment,
            dependency,
            componentStatusHistory,
            componentPreview,
            githubTransitionConfig,
          } = getEntities();

          // Get all related entities in parallel
          const [memberships, projects, sprints, workflowConfig] = await Promise.all([
            membershipEntity.query.primary({ teamId: id }).go(),
            project.query.byTeam({ teamId: id }).go(),
            sprint.query.byTeam({ teamId: id }).go(),
            teamWorkflowConfig.get({ teamId: id }).go(),
          ]);

          // For each project, get components and their related data
          const projectIds = projects.data.map((p) => p.id);

          if (projectIds.length > 0) {
            const componentResults = await Promise.all(
              projectIds.map((projectId) => component.query.byProject({ projectId }).go())
            );
            const allComponents = componentResults.flatMap((r) => r.data);
            const componentIds = allComponents.map((c) => c.id);

            // Get activities and component-related data in parallel
            const [activityResults, assignmentResults, dependencyResults, historyResults, previewResults, githubConfigResults] =
              await Promise.all([
                Promise.all(projectIds.map((projectId) => activity.query.primary({ projectId }).go())),
                Promise.all(componentIds.map((componentId) => assignment.query.primary({ componentId }).go())),
                Promise.all(componentIds.map((componentId) => dependency.query.primary({ dependentComponentId: componentId }).go())),
                Promise.all(componentIds.map((componentId) => componentStatusHistory.query.primary({ componentId }).go())),
                Promise.all(componentIds.map((componentId) => componentPreview.query.primary({ componentId }).go())),
                Promise.all(projectIds.map((projectId) => githubTransitionConfig.query.primary({ projectId }).go())),
              ]);

            const allActivities = activityResults.flatMap((r) => r.data);
            const allAssignments = assignmentResults.flatMap((r) => r.data);
            const allDependencies = dependencyResults.flatMap((r) => r.data);
            const allHistory = historyResults.flatMap((r) => r.data);
            const allPreviews = previewResults.flatMap((r) => r.data);
            const allGithubConfigs = githubConfigResults.flatMap((r) => r.data);

            // Delete in order: leaf nodes first, then parents
            // Using batchDelete with automatic chunking (25 items per batch)
            // Reference: DynamoDB BatchWriteItem limit
            if (allAssignments.length > 0) {
              await batchDelete(
                allAssignments.map((a) => ({
                  pk: `COMPONENT#${a.componentId}`,
                  sk: `ASSIGNEE#${a.userId}`,
                }))
              );
            }

            if (allDependencies.length > 0) {
              await batchDelete(
                allDependencies.map((d) => ({
                  pk: `COMPONENT#${d.dependentComponentId}`,
                  sk: `DEPENDS_ON#${d.requiredComponentId}`,
                }))
              );
            }

            if (allHistory.length > 0) {
              await batchDelete(
                allHistory.map((h) => ({
                  pk: `COMPONENT#${h.componentId}`,
                  sk: `STATUS_HISTORY#${h.enteredAt}#${h.id}`,
                }))
              );
            }

            if (allPreviews.length > 0) {
              await batchDelete(
                allPreviews.map((p) => ({
                  pk: `COMPONENT#${p.componentId}`,
                  sk: `PREVIEW#${p.createdAt}#${p.id}`,
                }))
              );
            }

            if (allComponents.length > 0) {
              await batchDelete(
                allComponents.map((c) => ({
                  pk: `COMPONENT#${c.id}`,
                  sk: 'METADATA',
                }))
              );
            }

            if (allActivities.length > 0) {
              await batchDelete(
                allActivities.map((a) => ({
                  pk: `PROJECT#${a.projectId}`,
                  sk: `ACTIVITY#${a.createdAt}#${a.id}`,
                }))
              );
            }

            if (allGithubConfigs.length > 0) {
              await batchDelete(
                allGithubConfigs.map((g) => ({
                  pk: `PROJECT#${g.projectId}`,
                  sk: `GITHUB_CONFIG#${g.event}`,
                }))
              );
            }

            if (projects.data.length > 0) {
              await batchDelete(
                projects.data.map((p) => ({
                  pk: `PROJECT#${p.id}`,
                  sk: 'METADATA',
                }))
              );
            }
          }

          // Delete sprints
          if (sprints.data.length > 0) {
            await batchDelete(
              sprints.data.map((s) => ({
                pk: `SPRINT#${s.id}`,
                sk: 'METADATA',
              }))
            );
          }

          // Delete memberships
          if (memberships.data.length > 0) {
            await batchDelete(
              memberships.data.map((m) => ({
                pk: `TEAM#${id}`,
                sk: `MEMBER#${m.userId}`,
              }))
            );
          }

          // Delete workflow config
          if (workflowConfig.data) {
            await teamWorkflowConfig.delete({ teamId: id }).go();
          }

          // Finally delete the team
          await team.delete({ id }).go();

          return { success: true };
        }
      );

      revalidatePath('/');
      revalidatePath('/team');

      return { success: true };
    } catch (error) {
      if (error instanceof Error && error.message.includes('owner')) {
        throw error;
      }
      console.error('Error deleting team:', error);
      throw new Error('Failed to delete team. Please ensure all related data can be deleted.');
    }
  });
