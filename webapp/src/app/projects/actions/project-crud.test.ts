import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revalidatePath } from 'next/cache';
import {
  createMockPrismaClient,
  createTestProject,
  createTestMembership,
  type MockPrismaClient,
} from '@/test/prisma-mock';

let mockPrisma: MockPrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

vi.mock('@/lib/safe-action', async () => {
  const { MyCustomError } = await vi.importActual<typeof import('@/lib/safe-action')>('@/lib/safe-action');
  return {
    MyCustomError,
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

import { createProject, updateProject, deleteProject } from './project-crud';

describe('Project CRUD Actions', () => {
  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    vi.clearAllMocks();
  });

  describe('createProject', () => {
    it('creates project when user is team member', async () => {
      const testMembership = createTestMembership();
      const testProject = createTestProject({ name: 'New Project' });

      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);
      mockPrisma.project.create.mockResolvedValue(testProject);
      mockPrisma.activity.create.mockResolvedValue({});

      const result = await createProject({
        name: 'New Project',
        description: 'A great project',
        teamId: 'team-123',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.project).toEqual(testProject);
      expect(mockPrisma.project.create).toHaveBeenCalledWith({
        data: {
          name: 'New Project',
          description: 'A great project',
          teamId: 'team-123',
          ownerId: 'user-123',
        },
      });
      expect(mockPrisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'PROJECT_CREATED',
          userId: 'user-123',
        }),
      });
      expect(revalidatePath).toHaveBeenCalledWith('/');
      expect(revalidatePath).toHaveBeenCalledWith('/projects');
    });

    it('throws error when user is not team member', async () => {
      mockPrisma.membership.findUnique.mockResolvedValue(null);

      const result = await createProject({
        name: 'New Project',
        teamId: 'team-123',
      });

      expect(result.serverError).toBe('You are not a member of this team');
      expect(mockPrisma.project.create).not.toHaveBeenCalled();
    });
  });

  describe('updateProject', () => {
    it('updates project when user has access', async () => {
      const testProject = createTestProject();
      const updatedProject = { ...testProject, name: 'Updated Name' };

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.project.update.mockResolvedValue(updatedProject);

      const result = await updateProject({
        id: 'project-123',
        name: 'Updated Name',
        description: 'New description',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.project.name).toBe('Updated Name');
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-123' },
        data: {
          name: 'Updated Name',
          description: 'New description',
        },
      });
    });

    it('throws error when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);

      const result = await updateProject({
        id: 'nonexistent',
        name: 'Update attempt',
      });

      expect(result.serverError).toBe('Project not found or access denied');
    });

    it('allows partial updates', async () => {
      const testProject = createTestProject();
      const updatedProject = { ...testProject, description: 'Only description changed' };

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.project.update.mockResolvedValue(updatedProject);

      const result = await updateProject({
        id: 'project-123',
        description: 'Only description changed',
        // No name update
      });

      expect(result.data).toBeDefined();
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-123' },
        data: {
          description: 'Only description changed',
        },
      });
    });
  });

  describe('deleteProject', () => {
    it('allows project owner to delete', async () => {
      const testProject = createTestProject({ ownerId: 'user-123' });

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.project.delete.mockResolvedValue(testProject);

      const result = await deleteProject({ id: 'project-123' });

      expect(result.data).toBeDefined();
      expect(result.data?.success).toBe(true);
      expect(mockPrisma.project.delete).toHaveBeenCalledWith({
        where: { id: 'project-123' },
      });
      expect(revalidatePath).toHaveBeenCalledWith('/');
      expect(revalidatePath).toHaveBeenCalledWith('/projects');
    });

    it('denies non-owner from deleting', async () => {
      const testProject = createTestProject({ ownerId: 'other-user' });

      mockPrisma.project.findFirst.mockResolvedValue(testProject);

      const result = await deleteProject({ id: 'project-123' });

      expect(result.serverError).toBe('Only the project owner can delete it');
      expect(mockPrisma.project.delete).not.toHaveBeenCalled();
    });

    it('handles project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);

      const result = await deleteProject({ id: 'nonexistent' });

      expect(result.serverError).toBe('Project not found');
    });

    it('handles database errors gracefully', async () => {
      const testProject = createTestProject({ ownerId: 'user-123' });

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.project.delete.mockRejectedValue(new Error('FK constraint'));

      const result = await deleteProject({ id: 'project-123' });

      expect(result.serverError).toBe('Failed to delete project. Please try again.');
    });
  });
});
