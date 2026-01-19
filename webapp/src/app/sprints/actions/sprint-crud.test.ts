import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revalidatePath } from 'next/cache';
import {
  createMockPrismaClient,
  createTestMembership,
  createTestSprint,
  createTestComponent,
  createTestProject,
  type MockPrismaClient,
} from '@/test/prisma-mock';

let mockPrisma: MockPrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return mockPrisma;
  },
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

import {
  createSprint,
  updateSprint,
  updateSprintStatus,
  assignComponentToSprint,
  deleteSprint,
  getSprintMetrics,
} from './sprint-crud';

describe('Sprint CRUD Actions', () => {
  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    vi.clearAllMocks();
  });

  describe('createSprint', () => {
    it('creates a sprint when user is team member', async () => {
      const testMembership = createTestMembership();
      const testSprint = createTestSprint({ name: 'Sprint 1' });

      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);
      mockPrisma.sprint.findFirst.mockResolvedValue(null); // No overlapping sprints
      mockPrisma.sprint.create.mockResolvedValue(testSprint);

      const result = await createSprint({
        teamId: 'team-123',
        name: 'Sprint 1',
        goal: 'Complete MVP',
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-14T00:00:00Z',
        capacity: 80,
      });

      expect(result.data).toBeDefined();
      expect(result.data?.sprint).toEqual(testSprint);
      expect(mockPrisma.sprint.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          teamId: 'team-123',
          name: 'Sprint 1',
          goal: 'Complete MVP',
          capacity: 80,
        }),
      });
      expect(revalidatePath).toHaveBeenCalledWith('/team/team-123');
      expect(revalidatePath).toHaveBeenCalledWith('/team/team-123/sprints');
    });

    it('throws error when user is not team member', async () => {
      mockPrisma.membership.findUnique.mockResolvedValue(null);

      const result = await createSprint({
        teamId: 'team-123',
        name: 'Sprint 1',
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-14T00:00:00Z',
      });

      expect(result.serverError).toBe('You must be a team member to create sprints');
      expect(mockPrisma.sprint.create).not.toHaveBeenCalled();
    });

    it('prevents overlapping sprints', async () => {
      const testMembership = createTestMembership();
      const existingSprint = createTestSprint({ name: 'Existing Sprint' });

      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);
      mockPrisma.sprint.findFirst.mockResolvedValue(existingSprint);

      const result = await createSprint({
        teamId: 'team-123',
        name: 'Sprint 2',
        startDate: '2025-01-07T00:00:00Z', // Overlaps with existing
        endDate: '2025-01-21T00:00:00Z',
      });

      expect(result.serverError).toContain('overlaps with these dates');
      expect(mockPrisma.sprint.create).not.toHaveBeenCalled();
    });
  });

  describe('updateSprintStatus', () => {
    it('allows admin to change sprint status', async () => {
      const testSprint = createTestSprint({ status: 'PLANNING' });
      const adminMembership = createTestMembership({ role: 'ADMIN' });
      const updatedSprint = { ...testSprint, status: 'ACTIVE' };

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(adminMembership);
      mockPrisma.sprint.findFirst.mockResolvedValue(null); // No other active sprint
      mockPrisma.sprint.update.mockResolvedValue(updatedSprint);

      const result = await updateSprintStatus({
        id: 'sprint-123',
        status: 'ACTIVE',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.sprint.status).toBe('ACTIVE');
    });

    it('allows owner to change sprint status', async () => {
      const testSprint = createTestSprint({ status: 'PLANNING' });
      const ownerMembership = createTestMembership({ role: 'OWNER' });
      const updatedSprint = { ...testSprint, status: 'ACTIVE' };

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(ownerMembership);
      mockPrisma.sprint.findFirst.mockResolvedValue(null);
      mockPrisma.sprint.update.mockResolvedValue(updatedSprint);

      const result = await updateSprintStatus({
        id: 'sprint-123',
        status: 'ACTIVE',
      });

      expect(result.data).toBeDefined();
    });

    it('denies regular member from changing sprint status', async () => {
      const testSprint = createTestSprint();
      const memberMembership = createTestMembership({ role: 'MEMBER' });

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(memberMembership);

      const result = await updateSprintStatus({
        id: 'sprint-123',
        status: 'ACTIVE',
      });

      expect(result.serverError).toBe('Only team owners and admins can change sprint status');
    });

    it('prevents activating sprint when another is active', async () => {
      const testSprint = createTestSprint({ status: 'PLANNING' });
      const adminMembership = createTestMembership({ role: 'ADMIN' });
      const activeSprint = createTestSprint({ id: 'other-sprint', name: 'Active Sprint', status: 'ACTIVE' });

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(adminMembership);
      mockPrisma.sprint.findFirst.mockResolvedValue(activeSprint);

      const result = await updateSprintStatus({
        id: 'sprint-123',
        status: 'ACTIVE',
      });

      expect(result.serverError).toContain('is already active');
    });
  });

  describe('assignComponentToSprint', () => {
    it('assigns component to sprint within same team', async () => {
      const testComponent = createTestComponent({
        Project: createTestProject({ teamId: 'team-123' }),
      });
      const testSprint = createTestSprint({ teamId: 'team-123' });
      const testMembership = createTestMembership();
      const updatedComponent = { ...testComponent, sprintId: 'sprint-123' };

      mockPrisma.component.findUnique.mockResolvedValue(testComponent);
      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);
      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.component.update.mockResolvedValue(updatedComponent);

      const result = await assignComponentToSprint({
        componentId: 'component-123',
        sprintId: 'sprint-123',
      });

      expect(result.data).toBeDefined();
      expect(result.data?.component.sprintId).toBe('sprint-123');
    });

    it('allows unassigning from sprint (null sprintId)', async () => {
      const testComponent = createTestComponent({
        sprintId: 'sprint-123',
        Project: createTestProject({ teamId: 'team-123' }),
      });
      const testMembership = createTestMembership();
      const updatedComponent = { ...testComponent, sprintId: null };

      mockPrisma.component.findUnique.mockResolvedValue(testComponent);
      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);
      mockPrisma.component.update.mockResolvedValue(updatedComponent);

      const result = await assignComponentToSprint({
        componentId: 'component-123',
        sprintId: null,
      });

      expect(result.data).toBeDefined();
      expect(result.data?.component.sprintId).toBeNull();
      // Should not have looked up sprint when sprintId is null
      expect(mockPrisma.sprint.findUnique).not.toHaveBeenCalled();
    });

    it('prevents assigning to sprint from different team', async () => {
      const testComponent = createTestComponent({
        Project: createTestProject({ teamId: 'team-123' }),
      });
      const testSprint = createTestSprint({ teamId: 'different-team' });
      const testMembership = createTestMembership();

      mockPrisma.component.findUnique.mockResolvedValue(testComponent);
      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);
      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);

      const result = await assignComponentToSprint({
        componentId: 'component-123',
        sprintId: 'sprint-123',
      });

      expect(result.serverError).toBe('Sprint and component must belong to the same team');
    });
  });

  describe('deleteSprint', () => {
    it('allows owner to delete sprint', async () => {
      const testSprint = createTestSprint();
      const ownerMembership = createTestMembership({ role: 'OWNER' });

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(ownerMembership);
      mockPrisma.sprint.delete.mockResolvedValue(testSprint);

      const result = await deleteSprint({ id: 'sprint-123' });

      expect(result.data).toBeDefined();
      expect(result.data?.success).toBe(true);
      expect(mockPrisma.sprint.delete).toHaveBeenCalledWith({ where: { id: 'sprint-123' } });
    });

    it('denies non-owner from deleting sprint', async () => {
      const testSprint = createTestSprint();
      const adminMembership = createTestMembership({ role: 'ADMIN' });

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(adminMembership);

      const result = await deleteSprint({ id: 'sprint-123' });

      expect(result.serverError).toBe('Only the team owner can delete sprints');
      expect(mockPrisma.sprint.delete).not.toHaveBeenCalled();
    });
  });

  describe('getSprintMetrics', () => {
    it('calculates metrics correctly', async () => {
      const now = new Date();
      const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
      const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

      const testSprint = createTestSprint({
        startDate,
        endDate,
        status: 'ACTIVE',
        capacity: 100,
        Component: [
          createTestComponent({ status: 'COMPLETED', estimatedHours: 8 }),
          createTestComponent({ status: 'COMPLETED', estimatedHours: 4 }),
          createTestComponent({ status: 'IN_PROGRESS', estimatedHours: 6 }),
          createTestComponent({ status: 'BLOCKED', estimatedHours: 2 }),
          createTestComponent({ status: 'PLANNING', estimatedHours: 10 }),
        ],
        Team: { id: 'team-123', name: 'Test Team' },
      });
      const testMembership = createTestMembership();

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);

      const result = await getSprintMetrics({ id: 'sprint-123' });

      expect(result.data).toBeDefined();
      const { metrics } = result.data!;

      expect(metrics.totalComponents).toBe(5);
      expect(metrics.completedComponents).toBe(2);
      expect(metrics.blockedComponents).toBe(1);
      expect(metrics.inProgressComponents).toBe(1);
      expect(metrics.completionRate).toBe(40); // 2/5 = 40%
      expect(metrics.totalEstimatedHours).toBe(30); // 8+4+6+2+10
      expect(metrics.completedHours).toBe(12); // 8+4
      expect(metrics.hoursRemaining).toBe(18); // 30-12
      expect(metrics.capacityUsed).toBe(30); // 30/100 = 30%
    });

    it('handles empty sprint', async () => {
      const testSprint = createTestSprint({
        Component: [],
        Team: { id: 'team-123', name: 'Test Team' },
      });
      const testMembership = createTestMembership();

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(testMembership);

      const result = await getSprintMetrics({ id: 'sprint-123' });

      expect(result.data).toBeDefined();
      const { metrics } = result.data!;

      expect(metrics.totalComponents).toBe(0);
      expect(metrics.completionRate).toBe(0);
      expect(metrics.totalEstimatedHours).toBe(0);
    });

    it('denies access to non-team members', async () => {
      const testSprint = createTestSprint();

      mockPrisma.sprint.findUnique.mockResolvedValue(testSprint);
      mockPrisma.membership.findUnique.mockResolvedValue(null);

      const result = await getSprintMetrics({ id: 'sprint-123' });

      expect(result.serverError).toBe('You must be a team member to view sprint metrics');
    });
  });
});
