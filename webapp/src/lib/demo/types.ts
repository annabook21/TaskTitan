// Demo mode types - mirrors Prisma schema for localStorage storage

import type { ComponentStatus, ComponentType, Role, SprintStatus } from '@prisma/client';

export interface DemoUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoTeam {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoMembership {
  id: string;
  userId: string;
  teamId: string;
  role: Role;
  joinedAt: string;
}

export interface DemoProject {
  id: string;
  name: string;
  description: string | null;
  teamId: string;
  ownerId: string;
  githubRepoUrl: string | null;
  githubWebhookSecret: string | null;
  githubPrTargetStatus: ComponentStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoComponent {
  id: string;
  name: string;
  description: string | null;
  type: ComponentType;
  projectId: string;
  parentId: string | null;
  sprintId: string | null;
  status: ComponentStatus;
  statusEnteredAt: string;
  priority: number;
  estimatedHours: number | null;
  dueDate: string | null;
  owner: string | null;
  tags: string[];
  externalId: string | null;
  githubPrUrl: string | null;
  contextDecision: string | null;
  contextRationale: string | null;
  contextAlternatives: string | null;
  contextLinks: string[];
  contextAiSummary: string | null;
  contextUpdatedAt: string | null;
  contextUpdatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoDependency {
  id: string;
  dependentComponentId: string;
  requiredComponentId: string;
  description: string | null;
  createdAt: string;
}

export interface DemoAssignment {
  id: string;
  componentId: string;
  userId: string;
  assignedAt: string;
}

export interface DemoSprint {
  id: string;
  name: string;
  goal: string | null;
  teamId: string;
  startDate: string | null;
  endDate: string | null;
  status: SprintStatus;
  capacity: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DemoActivity {
  id: string;
  type: string;
  projectId: string;
  userId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DemoWorkflowConfig {
  id: string;
  teamId: string;
  wipLimitPlanning: number | null;
  wipLimitInProgress: number | null;
  wipLimitBlocked: number | null;
  wipLimitReview: number | null;
  cycleEnabled: boolean;
  cycleDurationWeeks: number;
  cycleStartDayOfWeek: number;
  workflowTemplate: string;
  cycleName: string;
  backlogName: string;
  enforceEstimates: boolean;
  autoArchiveCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoComponentPreview {
  id: string;
  componentId: string;
  svgContent: string;
  prompt: string | null;
  generatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DemoStatusHistory {
  id: string;
  componentId: string;
  status: ComponentStatus;
  enteredAt: string;
  exitedAt: string | null;
  durationMs: number | null;
}

export interface DemoDataStore {
  version: number;
  lastUpdated: string;
  users: DemoUser[];
  teams: DemoTeam[];
  memberships: DemoMembership[];
  projects: DemoProject[];
  components: DemoComponent[];
  dependencies: DemoDependency[];
  assignments: DemoAssignment[];
  sprints: DemoSprint[];
  activities: DemoActivity[];
  workflowConfigs: DemoWorkflowConfig[];
  componentPreviews: DemoComponentPreview[];
  statusHistory: DemoStatusHistory[];
}

// Types for relations (matching Prisma includes)
export interface DemoTeamWithRelations extends DemoTeam {
  Membership: (DemoMembership & { User: DemoUser })[];
  Project: DemoProject[];
  Sprint: DemoSprint[];
  WorkflowConfig: DemoWorkflowConfig | null;
}

export interface DemoProjectWithRelations extends DemoProject {
  Team: DemoTeamWithRelations;
  Component: DemoComponentWithRelations[];
  Owner: DemoUser;
}

export interface DemoComponentWithRelations extends DemoComponent {
  Assignment: (DemoAssignment & { User: DemoUser })[];
  Sprint: DemoSprint | null;
  children: DemoComponent[];
  Dependency_Dependency_dependentComponentIdToComponent: {
    Component_Dependency_requiredComponentIdToComponent: DemoComponent;
  }[];
  StatusHistory: DemoStatusHistory[];
}

export interface DemoMembershipWithRelations extends DemoMembership {
  User: DemoUser;
  Team: DemoTeamWithRelations;
}
