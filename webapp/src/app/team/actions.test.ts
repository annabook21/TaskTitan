import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revalidatePath } from 'next/cache';
import {
  createMockPrismaClient,
  createTestUser,
  createTestTeam,
  createTestMembership,
  type MockPrismaClient,
} from '@/test/prisma-mock';

let mockPrisma: MockPrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

vi.mock('@/lib/workflow-templates', () => ({
  getTemplateSettings: vi.fn(() => ({
    cycleEnabled: true,
    cycleDurationWeeks: 2,
    cycleStartDayOfWeek: 1,
    cycleName: 'Sprint',
    backlogName: 'Backlog',
    enforceEstimates: false,
    wipLimitPlanning: null,
    wipLimitInProgress: null,
    wipLimitBlocked: null,
    wipLimitReview: null,
    autoArchiveCompleted: false,
  })),
}));

vi.mock('@/lib/safe-action', async () => {
  return {
    authActionClient: {
      schema: () => ({
        action: (handler: Function) => {
          return async (input: unknown) => {
            try {
              const result = await handler({
                parsedInput: input,
                ctx: { userId: 'user-123', isDemo: false },
              });
              return { data: result };
            } catch (error) {
              return { serverError: (error as Error).message };
            }
          };
        },
      }),
    },
  };
});

import { createTeam, updateTeam, inviteMember, updateMemberRole, removeMember, deleteTeam } from './actions';

describe('Team Management Actions', () => {
  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    vi.clearAllMocks();
  });

  describe('createTeam', () => {
    it('creates team with user as owner', async () => {
      const testTeam = createTestTeam({ name: 'New Team' });

      mockPrisma.team.create.mockResolvedValue(testTeam);

      const result = await createTeam({
        name: 'New Team',
        description: 'A great team',
        workflowTemplate: 'SCRUM',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.team).toEqual(testTeam);
      expect(mockPrisma.team.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'New Team',
          description: 'A great team',
          Membership: {
            create: {
              userId: 'user-123',
              role: 'OWNER',
            },
          },
          WorkflowConfig: {
            create: expect.objectContaining({
              workflowTemplate: 'SCRUM',
              cycleEnabled: true,
            }),
          },
        }),
      });
      expect(revalidatePath).toHaveBeenCalledWith('/');
      expect(revalidatePath).toHaveBeenCalledWith('/team');
    });

    it('creates team with default workflow when none specified', async () => {
      const testTeam = createTestTeam();

      mockPrisma.team.create.mockResolvedValue(testTeam);

      await createTeam({
        name: 'Default Team',
      });

      expect(mockPrisma.team.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          WorkflowConfig: {
            create: expect.objectContaining({
              workflowTemplate: 'CUSTOM',
            }),
          },
        }),
      });
    });
  });

  describe('updateTeam', () => {
    it('allows owner to update team', async () => {
      const ownerMembership = createTestMembership({ role: 'OWNER' });
      const updatedTeam = createTestTeam({ name: 'Updated Name' });

      mockPrisma.membership.findUnique.mockResolvedValue(ownerMembership);
      mockPrisma.team.update.mockResolvedValue(updatedTeam);

      const result = await updateTeam({
        id: 'team-123',
        name: 'Updated Name',
        description: 'New description',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.team.name).toBe('Updated Name');
    });

    it('allows admin to update team', async () => {
      const adminMembership = createTestMembership({ role: 'ADMIN' });
      const updatedTeam = createTestTeam({ name: 'Admin Update' });

      mockPrisma.membership.findUnique.mockResolvedValue(adminMembership);
      mockPrisma.team.update.mockResolvedValue(updatedTeam);

      const result = await updateTeam({
        id: 'team-123',
        name: 'Admin Update',
      });

      expect(result.data).toBeDefined();
    });

    it('denies regular member from updating team', async () => {
      const memberMembership = createTestMembership({ role: 'MEMBER' });

      mockPrisma.membership.findUnique.mockResolvedValue(memberMembership);

      const result = await updateTeam({
        id: 'team-123',
        name: 'Unauthorized Update',
      });

      expect(result.serverError).toBe('Only team owners and admins can update team settings');
    });
  });

  describe('inviteMember', () => {
    it('allows admin to invite member', async () => {
      const adminMembership = createTestMembership({ role: 'ADMIN' });
      const newUser = createTestUser({ id: 'new-user', email: 'newuser@example.com' });
      const newMembership = createTestMembership({
        userId: 'new-user',
        role: 'MEMBER',
      });

      mockPrisma.membership.findUnique
        .mockResolvedValueOnce(adminMembership) // Check inviter's role
        .mockResolvedValueOnce(null); // Check existing membership
      mockPrisma.user.findUnique.mockResolvedValue(newUser);
      mockPrisma.membership.create.mockResolvedValue(newMembership);

      const result = await inviteMember({
        teamId: 'team-123',
        email: 'newuser@example.com',
        role: 'MEMBER',
      });

      expect(result.data).toBeDefined();
      expect(mockPrisma.membership.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'new-user',
          teamId: 'team-123',
          role: 'MEMBER',
        }),
      });
    });

    it('throws error when inviting non-existent user', async () => {
      const adminMembership = createTestMembership({ role: 'ADMIN' });

      mockPrisma.membership.findUnique.mockResolvedValue(adminMembership);
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await inviteMember({
        teamId: 'team-123',
        email: 'nonexistent@example.com',
        role: 'MEMBER',
      });

      expect(result.serverError).toBe('User not found. They need to sign up first.');
    });

    it('throws error when user already a member', async () => {
      const adminMembership = createTestMembership({ role: 'ADMIN' });
      const existingUser = createTestUser({ id: 'existing-user' });
      const existingMembership = createTestMembership({ userId: 'existing-user' });

      mockPrisma.membership.findUnique.mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(existingMembership);
      mockPrisma.user.findUnique.mockResolvedValue(existingUser);

      const result = await inviteMember({
        teamId: 'team-123',
        email: 'existing@example.com',
        role: 'MEMBER',
      });

      expect(result.serverError).toBe('User is already a member of this team');
    });

    it('denies regular member from inviting', async () => {
      const memberMembership = createTestMembership({ role: 'MEMBER' });

      mockPrisma.membership.findUnique.mockResolvedValue(memberMembership);

      const result = await inviteMember({
        teamId: 'team-123',
        email: 'someone@example.com',
        role: 'MEMBER',
      });

      expect(result.serverError).toBe('Only team owners and admins can invite members');
    });
  });

  describe('updateMemberRole', () => {
    it('allows owner to change member role', async () => {
      const ownerMembership = createTestMembership({ role: 'OWNER' });
      const targetMembership = createTestMembership({
        userId: 'target-user',
        role: 'MEMBER',
      });
      const updatedMembership = { ...targetMembership, role: 'ADMIN' };

      mockPrisma.membership.findUnique.mockResolvedValueOnce(ownerMembership).mockResolvedValueOnce(targetMembership);
      mockPrisma.membership.update.mockResolvedValue(updatedMembership);

      const result = await updateMemberRole({
        teamId: 'team-123',
        userId: 'target-user',
        role: 'ADMIN',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.membership.role).toBe('ADMIN');
    });

    it('prevents changing owner role', async () => {
      const ownerMembership = createTestMembership({ role: 'OWNER' });
      const targetOwnerMembership = createTestMembership({
        userId: 'other-owner',
        role: 'OWNER',
      });

      mockPrisma.membership.findUnique
        .mockResolvedValueOnce(ownerMembership)
        .mockResolvedValueOnce(targetOwnerMembership);

      const result = await updateMemberRole({
        teamId: 'team-123',
        userId: 'other-owner',
        role: 'ADMIN',
      });

      expect(result.serverError).toBe('Cannot change the role of the team owner');
    });

    it('denies non-owner from changing roles', async () => {
      const adminMembership = createTestMembership({ role: 'ADMIN' });

      mockPrisma.membership.findUnique.mockResolvedValue(adminMembership);

      const result = await updateMemberRole({
        teamId: 'team-123',
        userId: 'target-user',
        role: 'VIEWER',
      });

      expect(result.serverError).toBe('Only the team owner can change member roles');
    });
  });

  describe('removeMember', () => {
    it('allows owner to remove member', async () => {
      const ownerMembership = createTestMembership({ role: 'OWNER' });
      const targetMembership = createTestMembership({
        userId: 'target-user',
        role: 'MEMBER',
      });

      mockPrisma.membership.findUnique.mockResolvedValueOnce(ownerMembership).mockResolvedValueOnce(targetMembership);
      mockPrisma.membership.delete.mockResolvedValue(targetMembership);

      const result = await removeMember({
        teamId: 'team-123',
        userId: 'target-user',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.success).toBe(true);
    });

    it('allows member to leave team', async () => {
      const memberMembership = createTestMembership({ role: 'MEMBER' });

      mockPrisma.membership.findUnique.mockResolvedValue(memberMembership);
      mockPrisma.membership.delete.mockResolvedValue(memberMembership);

      const result = await removeMember({
        teamId: 'team-123',
        userId: 'user-123', // Same as ctx.userId
      });

      expect(result.data).toBeDefined();
      expect(result.data?.success).toBe(true);
    });

    it('prevents owner from leaving', async () => {
      const ownerMembership = createTestMembership({ role: 'OWNER' });

      mockPrisma.membership.findUnique.mockResolvedValue(ownerMembership);

      const result = await removeMember({
        teamId: 'team-123',
        userId: 'user-123', // Owner trying to leave
      });

      expect(result.serverError).toBe('Team owner cannot leave. Transfer ownership first.');
    });

    it('prevents removing the owner', async () => {
      const adminMembership = createTestMembership({ role: 'ADMIN' });
      const ownerMembership = createTestMembership({
        userId: 'owner-user',
        role: 'OWNER',
      });

      mockPrisma.membership.findUnique.mockResolvedValueOnce(adminMembership).mockResolvedValueOnce(ownerMembership);

      const result = await removeMember({
        teamId: 'team-123',
        userId: 'owner-user',
      });

      expect(result.serverError).toBe('Cannot remove the team owner');
    });
  });

  describe('deleteTeam', () => {
    it('allows owner to delete team', async () => {
      const ownerMembership = createTestMembership({ role: 'OWNER' });
      const testTeam = createTestTeam();

      mockPrisma.membership.findUnique.mockResolvedValue(ownerMembership);
      mockPrisma.team.delete.mockResolvedValue(testTeam);

      const result = await deleteTeam({ id: 'team-123' });

      expect(result.data).toBeDefined();
      expect(result.data?.success).toBe(true);
      expect(mockPrisma.team.delete).toHaveBeenCalledWith({ where: { id: 'team-123' } });
    });

    it('denies admin from deleting team', async () => {
      const adminMembership = createTestMembership({ role: 'ADMIN' });

      mockPrisma.membership.findUnique.mockResolvedValue(adminMembership);

      const result = await deleteTeam({ id: 'team-123' });

      expect(result.serverError).toBe('Only the team owner can delete the team');
      expect(mockPrisma.team.delete).not.toHaveBeenCalled();
    });
  });
});
