/**
 * Prisma compatibility shim for migration from Aurora/Prisma to DynamoDB/ElectroDB.
 * Provides type definitions that work with both the demo store (uses null) and
 * ElectroDB entities (uses undefined) for backwards compatibility.
 */

// Flexible User type compatible with both demo store and ElectroDB
export interface User {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Flexible Team type
export interface Team {
  id: string;
  name: string;
  description?: string | null;
  workflowConfig?: TeamWorkflowConfig | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Flexible Component type
export interface Component {
  id: string;
  name: string;
  description?: string | null;
  type: ComponentType;
  status: ComponentStatus;
  projectId: string;
  parentId?: string | null;
  priority: number;
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: string | null;
  sprintId?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Flexible Sprint type
export interface Sprint {
  id: string;
  name: string;
  goal?: string | null;
  teamId: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Enum types (matching ElectroDB schema definitions in dynamodb/service.ts)
export type ComponentType = 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
export type ComponentStatus = 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';
export type SprintStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

// TeamWorkflowConfig type - full Prisma model shape
export interface TeamWorkflowConfig {
  id?: string;
  teamId?: string;
  methodology?: 'SCRUM' | 'KANBAN';
  sprintDuration?: number;
  workingDays?: string[];
  defaultEstimateUnit?: 'HOURS' | 'POINTS';
  statusWorkflow?: string[];
  cycleName?: string | null;
  backlogName?: string | null;
  wipLimitPlanning?: number | null;
  wipLimitInProgress?: number | null;
  wipLimitBlocked?: number | null;
  wipLimitReview?: number | null;
  cycleEnabled?: boolean;
  cycleDurationWeeks?: number | null;
  cycleStartDayOfWeek?: number;
  workflowTemplate?: string | null;
  enforceEstimates?: boolean;
  autoArchiveCompleted?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

// Mock PrismaClient for test compatibility
export class PrismaClient {
  // This is a mock - actual data access uses ElectroDB via getEntities()
  async $connect() {}
  async $disconnect() {}
}
