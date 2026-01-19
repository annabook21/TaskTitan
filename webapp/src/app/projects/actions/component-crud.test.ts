import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revalidatePath } from 'next/cache';
import {
  createMockPrismaClient,
  createTestProject,
  createTestComponent,
  type MockPrismaClient,
} from '@/test/prisma-mock';

// Mock prisma before importing actions
let mockPrisma: MockPrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

// Mock next-safe-action to bypass auth and directly test action logic
vi.mock('@/lib/safe-action', async () => {
  const { MyCustomError } = await vi.importActual<typeof import('@/lib/safe-action')>(
    '@/lib/safe-action'
  );
  return {
    MyCustomError,
    authActionClient: {
      schema: () => ({
        action: (handler: Function) => {
          // Return a function that calls the handler with test context
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

// Import actions after mocks are set up
import { createComponent, updateComponent } from './component-crud';

describe('Component CRUD Actions', () => {
  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    vi.clearAllMocks();
  });

  describe('createComponent', () => {
    it('creates a component when user has project access', async () => {
      const testProject = createTestProject();
      const testComponent = createTestComponent({ name: 'New Task' });

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.component.create.mockResolvedValue(testComponent);
      mockPrisma.componentStatusHistory.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});

      const result = await createComponent({
        projectId: 'project-123',
        name: 'New Task',
        description: 'A new task',
        priority: 50,
        estimatedHours: 4,
      });

      expect(result.data).toBeDefined();
      expect(result.data?.component).toEqual(testComponent);
      expect(mockPrisma.component.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'New Task',
          description: 'A new task',
          projectId: 'project-123',
          priority: 50,
          estimatedHours: 4,
        }),
      });
      expect(mockPrisma.componentStatusHistory.create).toHaveBeenCalled();
      expect(mockPrisma.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'COMPONENT_CREATED',
          projectId: 'project-123',
        }),
      });
      expect(revalidatePath).toHaveBeenCalledWith('/projects/project-123');
    });

    it('throws error when user lacks project access', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);

      const result = await createComponent({
        projectId: 'project-123',
        name: 'New Task',
      });

      expect(result.serverError).toBe('Project not found or access denied');
      expect(mockPrisma.component.create).not.toHaveBeenCalled();
    });

    it('handles optional fields correctly', async () => {
      const testProject = createTestProject();
      const testComponent = createTestComponent({ name: 'Minimal Task' });

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.component.create.mockResolvedValue(testComponent);
      mockPrisma.componentStatusHistory.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});

      const result = await createComponent({
        projectId: 'project-123',
        name: 'Minimal Task',
        // No optional fields
      });

      expect(result.data).toBeDefined();
      expect(mockPrisma.component.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Minimal Task',
          projectId: 'project-123',
          priority: 0, // Default
          estimatedHours: undefined,
          dueDate: null,
        }),
      });
    });

    it('parses due date correctly', async () => {
      const testProject = createTestProject();
      const testComponent = createTestComponent();

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.component.create.mockResolvedValue(testComponent);
      mockPrisma.componentStatusHistory.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});

      await createComponent({
        projectId: 'project-123',
        name: 'Task with due date',
        dueDate: '2025-06-15',
      });

      expect(mockPrisma.component.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dueDate: new Date('2025-06-15'),
        }),
      });
    });

    it('creates initial status history for new components', async () => {
      const testProject = createTestProject();
      const testComponent = createTestComponent({ status: 'PLANNING' });

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.component.create.mockResolvedValue(testComponent);
      mockPrisma.componentStatusHistory.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});

      await createComponent({
        projectId: 'project-123',
        name: 'New Task',
      });

      expect(mockPrisma.componentStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          componentId: testComponent.id,
          status: 'PLANNING',
        }),
      });
    });

    it('logs activity when component is created', async () => {
      const testProject = createTestProject();
      const testComponent = createTestComponent({ id: 'comp-456', name: 'Logged Task' });

      mockPrisma.project.findFirst.mockResolvedValue(testProject);
      mockPrisma.component.create.mockResolvedValue(testComponent);
      mockPrisma.componentStatusHistory.create.mockResolvedValue({});
      mockPrisma.activity.create.mockResolvedValue({});

      await createComponent({
        projectId: 'project-123',
        name: 'Logged Task',
      });

      expect(mockPrisma.activity.create).toHaveBeenCalledWith({
        data: {
          type: 'COMPONENT_CREATED',
          projectId: 'project-123',
          userId: 'user-123',
          metadata: { componentName: 'Logged Task', componentId: 'comp-456' },
        },
      });
    });
  });

  describe('updateComponent', () => {
    it('updates component fields', async () => {
      const testComponent = createTestComponent({
        status: 'PLANNING',
        Project: createTestProject(),
        Assignment: [],
      });
      const updatedComponent = { ...testComponent, name: 'Updated Name', priority: 75 };

      mockPrisma.component.findFirst.mockResolvedValue(testComponent);
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const txMock = createMockPrismaClient();
        txMock.component.update.mockResolvedValue(updatedComponent);
        return fn(txMock);
      });

      const result = await updateComponent({
        id: 'component-123',
        name: 'Updated Name',
        priority: 75,
      });

      expect(result.data).toBeDefined();
      expect(result.data?.component.name).toBe('Updated Name');
    });

    it('throws error when component not found', async () => {
      mockPrisma.component.findFirst.mockResolvedValue(null);

      const result = await updateComponent({
        id: 'nonexistent',
        name: 'Update attempt',
      });

      expect(result.serverError).toBe('Component not found or access denied');
    });

    it('verifies access through project team membership', async () => {
      // When findFirst is called, it should include the team membership check
      mockPrisma.component.findFirst.mockResolvedValue(null);

      await updateComponent({
        id: 'component-123',
        name: 'Test',
      });

      // Verify the query included team membership check
      expect(mockPrisma.component.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'component-123',
          Project: { Team: { Membership: { some: { userId: 'user-123' } } } },
        },
        include: expect.any(Object),
      });
    });

    it('uses transaction for atomic updates', async () => {
      const testComponent = createTestComponent({
        status: 'PLANNING',
        Project: createTestProject(),
        Assignment: [],
      });

      mockPrisma.component.findFirst.mockResolvedValue(testComponent);
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const txMock = createMockPrismaClient();
        txMock.component.update.mockResolvedValue({ ...testComponent, name: 'Updated' });
        return fn(txMock);
      });

      await updateComponent({
        id: 'component-123',
        name: 'Updated',
      });

      // Verify transaction was used
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('uses transaction for status changes', async () => {
      const testComponent = createTestComponent({
        status: 'PLANNING',
        projectId: 'project-123',
        Project: createTestProject({ id: 'project-123' }),
        Assignment: [],
      });

      mockPrisma.component.findFirst.mockResolvedValue(testComponent);

      // The transaction mock will be called when status changes
      let transactionCalled = false;
      mockPrisma.$transaction.mockImplementation(async () => {
        transactionCalled = true;
        // Return the updated component directly
        return { ...testComponent, status: 'IN_PROGRESS' };
      });

      await updateComponent({
        id: 'component-123',
        status: 'IN_PROGRESS',
      });

      // Verify transaction was called for status changes
      expect(transactionCalled).toBe(true);
    });

    it('revalidates the project path after update', async () => {
      const testComponent = createTestComponent({
        status: 'PLANNING',
        projectId: 'proj-789',
        Project: createTestProject({ id: 'proj-789' }),
        Assignment: [],
      });

      mockPrisma.component.findFirst.mockResolvedValue(testComponent);
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const txMock = createMockPrismaClient();
        txMock.component.update.mockResolvedValue(testComponent);
        return fn(txMock);
      });

      await updateComponent({
        id: 'component-123',
        name: 'Updated',
      });

      expect(revalidatePath).toHaveBeenCalledWith('/projects/proj-789');
    });
  });
});
