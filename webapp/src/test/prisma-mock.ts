import { vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// Type-safe mock for Prisma client
export type MockPrismaClient = {
  [K in keyof PrismaClient]: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
} & {
  $transaction: ReturnType<typeof vi.fn>;
};

export function createMockPrismaClient(): MockPrismaClient {
  const createModelMock = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  });

  return {
    user: createModelMock(),
    team: createModelMock(),
    membership: createModelMock(),
    project: createModelMock(),
    component: createModelMock(),
    sprint: createModelMock(),
    activity: createModelMock(),
    assignment: createModelMock(),
    dependency: createModelMock(),
    notification: createModelMock(),
    componentStatusHistory: createModelMock(),
    componentPreview: createModelMock(),
    teamWorkflowConfig: createModelMock(),
    gitHubTransitionConfig: createModelMock(),
    $transaction: vi.fn((fn) => fn(createMockPrismaClient())),
  } as unknown as MockPrismaClient;
}

// Factory functions for creating test data
export const createTestUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestTeam = (overrides = {}) => ({
  id: 'team-123',
  name: 'Test Team',
  description: 'A test team',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestMembership = (overrides = {}) => ({
  id: 'membership-123',
  userId: 'user-123',
  teamId: 'team-123',
  role: 'MEMBER' as const,
  joinedAt: new Date(),
  title: null,
  hoursPerDay: 6,
  availability: 100,
  ...overrides,
});

export const createTestProject = (overrides = {}) => ({
  id: 'project-123',
  name: 'Test Project',
  description: 'A test project',
  teamId: 'team-123',
  ownerId: 'user-123',
  githubRepoUrl: null,
  githubWebhookSecret: null,
  githubPrTargetStatus: 'REVIEW',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestComponent = (overrides = {}) => ({
  id: 'component-123',
  name: 'Test Component',
  description: 'A test component',
  type: 'TASK' as const,
  projectId: 'project-123',
  parentId: null,
  sprintId: null,
  status: 'PLANNING' as const,
  priority: 0,
  estimatedHours: null,
  actualHours: null,
  dueDate: null,
  owner: null,
  tags: [],
  externalId: null,
  githubPrUrl: null,
  githubPrStatus: null,
  githubPrNumber: null,
  githubPrTitle: null,
  githubPrUpdatedAt: null,
  contextDecision: null,
  contextRationale: null,
  contextAlternatives: null,
  contextLinks: [],
  contextAiSummary: null,
  contextUpdatedAt: null,
  contextUpdatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestSprint = (overrides = {}) => ({
  id: 'sprint-123',
  name: 'Sprint 1',
  goal: 'Complete the MVP',
  teamId: 'team-123',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-01-14'),
  status: 'PLANNING' as const,
  capacity: 80,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});
