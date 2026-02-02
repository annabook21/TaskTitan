/**
 * ElectroDB Service for TaskTitan
 *
 * Combines all entities into a single service for:
 * - Cross-entity queries (collections)
 * - Consistent configuration
 * - Type-safe access to all entities
 *
 * Reference: https://electrodb.dev/en/core-concepts/services/
 */

import { Entity, EntityItem, CreateEntityItem, Service } from 'electrodb';
import { getDynamoDBClient, getTableName } from './index';

// Common configuration for all entities
const getConfig = () => ({
  client: getDynamoDBClient(),
  table: getTableName(),
});

// Entity Schemas

const UserSchema = {
  model: { entity: 'User', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    email: { type: 'string', required: true },
    name: { type: 'string' },
    avatarUrl: { type: 'string' },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
    updatedAt: { type: 'string', required: true, default: () => new Date().toISOString(), set: () => new Date().toISOString(), watch: '*' },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['id'], template: 'USER#${id}' }, sk: { field: 'sk', composite: [], template: 'METADATA' } },
    byEmail: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['email'], template: 'EMAIL#${email}' }, sk: { field: 'gsi1sk', composite: [], template: 'USER' } },
  },
} as const;

const TeamSchema = {
  model: { entity: 'Team', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
    updatedAt: { type: 'string', required: true, default: () => new Date().toISOString(), set: () => new Date().toISOString(), watch: '*' },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['id'], template: 'TEAM#${id}' }, sk: { field: 'sk', composite: [], template: 'METADATA' } },
  },
} as const;

const MembershipSchema = {
  model: { entity: 'Membership', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    userId: { type: 'string', required: true },
    teamId: { type: 'string', required: true },
    role: { type: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const, required: true, default: 'MEMBER' },
    joinedAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
    title: { type: 'string' },
    hoursPerDay: { type: 'number', default: 6 },
    availability: { type: 'number', default: 100 },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['teamId'], template: 'TEAM#${teamId}' }, sk: { field: 'sk', composite: ['userId'], template: 'MEMBER#${userId}' } },
    byUser: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['userId'], template: 'USER#${userId}' }, sk: { field: 'gsi1sk', composite: ['teamId'], template: 'TEAM#${teamId}' } },
  },
} as const;

const ProjectSchema = {
  model: { entity: 'Project', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
    teamId: { type: 'string', required: true },
    ownerId: { type: 'string', required: true },
    githubRepoUrl: { type: 'string' },
    githubWebhookSecret: { type: 'string' },
    githubPrTargetStatus: { type: ['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'] as const, default: 'REVIEW' },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
    updatedAt: { type: 'string', required: true, default: () => new Date().toISOString(), set: () => new Date().toISOString(), watch: '*' },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['id'], template: 'PROJECT#${id}' }, sk: { field: 'sk', composite: [], template: 'METADATA' } },
    byOwner: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['ownerId'], template: 'OWNER#${ownerId}' }, sk: { field: 'gsi1sk', composite: ['id'], template: 'PROJECT#${id}' } },
    byTeam: { index: 'gsi2', pk: { field: 'gsi2pk', composite: ['teamId'], template: 'TEAM#${teamId}' }, sk: { field: 'gsi2sk', composite: ['id'], template: 'PROJECT#${id}' } },
    // GSI for efficient GitHub webhook lookup - sparse index (only items with githubRepoUrl)
    byGitHubRepo: { index: 'gsi3', pk: { field: 'gsi3pk', composite: ['githubRepoUrl'], template: 'GITHUB_REPO#${githubRepoUrl}' }, sk: { field: 'gsi3sk', composite: ['id'], template: 'PROJECT#${id}' } },
  },
} as const;

// Note: Component has many attributes; splitting into a separate type for better TypeScript inference
const ComponentSchema = {
  model: { entity: 'Component', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string' as const, required: true as const },
    name: { type: 'string' as const, required: true as const },
    description: { type: 'string' as const },
    type: { type: ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'] as const, required: true as const, default: 'TASK' as const },
    projectId: { type: 'string' as const, required: true as const },
    parentId: { type: 'string' as const },
    sprintId: { type: 'string' as const },
    status: { type: ['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'] as const, required: true as const, default: 'PLANNING' as const },
    priority: { type: 'number' as const, default: 0 },
    estimatedHours: { type: 'number' as const },
    actualHours: { type: 'number' as const },
    dueDate: { type: 'string' as const },
    owner: { type: 'string' as const },
    tags: { type: 'list' as const, items: { type: 'string' as const }, default: [] as string[] },
    externalId: { type: 'string' as const },
    githubPrUrl: { type: 'string' as const },
    githubPrStatus: { type: 'string' as const },
    githubPrNumber: { type: 'number' as const },
    githubPrTitle: { type: 'string' as const },
    githubPrUpdatedAt: { type: 'string' as const },
    contextDecision: { type: 'string' as const },
    contextRationale: { type: 'string' as const },
    contextAlternatives: { type: 'string' as const },
    contextLinks: { type: 'list' as const, items: { type: 'string' as const }, default: [] as string[] },
    contextAiSummary: { type: 'string' as const },
    contextUpdatedAt: { type: 'string' as const },
    contextUpdatedBy: { type: 'string' as const },
    createdAt: { type: 'string' as const, required: true as const, default: () => new Date().toISOString(), readOnly: true as const },
    updatedAt: { type: 'string' as const, required: true as const, default: () => new Date().toISOString(), set: () => new Date().toISOString(), watch: '*' as const },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['id'] as const, template: 'COMPONENT#${id}' }, sk: { field: 'sk', composite: [] as const, template: 'METADATA' } },
    byProject: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['projectId'] as const, template: 'PROJECT#${projectId}' }, sk: { field: 'gsi1sk', composite: ['id'] as const, template: 'COMPONENT#${id}' } },
    // Sparse GSI for sprint queries - only items with sprintId are indexed
    // Used for sprint metrics and planning views
    bySprint: { index: 'gsi2', pk: { field: 'gsi2pk', composite: ['sprintId'] as const, template: 'SPRINT#${sprintId}' }, sk: { field: 'gsi2sk', composite: ['id'] as const, template: 'COMPONENT#${id}' } },
  },
};

const SprintSchema = {
  model: { entity: 'Sprint', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    goal: { type: 'string' },
    teamId: { type: 'string', required: true },
    startDate: { type: 'string', required: true },
    endDate: { type: 'string', required: true },
    status: { type: ['PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const, required: true, default: 'PLANNING' },
    capacity: { type: 'number' },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
    updatedAt: { type: 'string', required: true, default: () => new Date().toISOString(), set: () => new Date().toISOString(), watch: '*' },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['id'], template: 'SPRINT#${id}' }, sk: { field: 'sk', composite: [], template: 'METADATA' } },
    byTeam: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['teamId'], template: 'TEAM#${teamId}' }, sk: { field: 'gsi1sk', composite: ['startDate', 'id'], template: 'SPRINT#${startDate}#${id}' } },
    byStatus: { index: 'gsi2', pk: { field: 'gsi2pk', composite: ['teamId', 'status'], template: 'TEAM#${teamId}#STATUS#${status}' }, sk: { field: 'gsi2sk', composite: ['startDate', 'id'], template: 'SPRINT#${startDate}#${id}' } },
  },
} as const;

const AssignmentSchema = {
  model: { entity: 'Assignment', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    componentId: { type: 'string', required: true },
    userId: { type: 'string', required: true },
    assignedAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['componentId'], template: 'COMPONENT#${componentId}' }, sk: { field: 'sk', composite: ['userId'], template: 'ASSIGNEE#${userId}' } },
    byUser: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['userId'], template: 'USER#${userId}' }, sk: { field: 'gsi1sk', composite: ['componentId'], template: 'ASSIGNMENT#${componentId}' } },
  },
} as const;

const DependencySchema = {
  model: { entity: 'Dependency', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    dependentComponentId: { type: 'string', required: true },
    requiredComponentId: { type: 'string', required: true },
    description: { type: 'string' },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['dependentComponentId'], template: 'COMPONENT#${dependentComponentId}' }, sk: { field: 'sk', composite: ['requiredComponentId'], template: 'DEPENDS_ON#${requiredComponentId}' } },
    byRequired: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['requiredComponentId'], template: 'REQUIRED_BY#${requiredComponentId}' }, sk: { field: 'gsi1sk', composite: ['dependentComponentId'], template: 'DEPENDENT#${dependentComponentId}' } },
  },
} as const;

const ActivitySchema = {
  model: { entity: 'Activity', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    type: { type: ['PROJECT_CREATED', 'COMPONENT_CREATED', 'COMPONENT_UPDATED', 'COMPONENT_STATUS_CHANGED', 'DEPENDENCY_ADDED', 'DEPENDENCY_REMOVED', 'MEMBER_ASSIGNED', 'MEMBER_UNASSIGNED', 'COMMENT_ADDED', 'SPRINT_CREATED', 'SPRINT_STARTED', 'SPRINT_COMPLETED', 'COMPONENT_ADDED_TO_SPRINT', 'COMPONENT_REMOVED_FROM_SPRINT', 'GITHUB_PR_OPENED', 'GITHUB_PR_MERGED', 'GITHUB_PR_CLOSED', 'GITHUB_PR_LINKED'] as const, required: true },
    projectId: { type: 'string', required: true },
    userId: { type: 'string', required: true },
    metadata: { type: 'any' },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['projectId'], template: 'PROJECT#${projectId}' }, sk: { field: 'sk', composite: ['createdAt', 'id'], template: 'ACTIVITY#${createdAt}#${id}' } },
    byUser: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['userId'], template: 'USER#${userId}' }, sk: { field: 'gsi1sk', composite: ['createdAt', 'id'], template: 'ACTIVITY#${createdAt}#${id}' } },
    byType: { index: 'gsi2', pk: { field: 'gsi2pk', composite: ['projectId', 'type'], template: 'PROJECT#${projectId}#TYPE#${type}' }, sk: { field: 'gsi2sk', composite: ['createdAt', 'id'], template: 'ACTIVITY#${createdAt}#${id}' } },
  },
} as const;

const NotificationSchema = {
  model: { entity: 'Notification', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    userId: { type: 'string', required: true },
    type: { type: ['TASK_ASSIGNED', 'TASK_STATUS_CHANGED', 'TASK_COMMENT', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'SPRINT_STARTED', 'SPRINT_ENDING'] as const, required: true },
    title: { type: 'string', required: true },
    message: { type: 'string', required: true },
    componentId: { type: 'string' },
    projectId: { type: 'string' },
    read: { type: 'boolean', required: true, default: false },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['userId'], template: 'USER#${userId}' }, sk: { field: 'sk', composite: ['createdAt', 'id'], template: 'NOTIFICATION#${createdAt}#${id}' } },
    // For unread notifications, filter by read=false in the query
  },
} as const;

const ComponentStatusHistorySchema = {
  model: { entity: 'ComponentStatusHistory', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    componentId: { type: 'string', required: true },
    status: { type: ['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'] as const, required: true },
    enteredAt: { type: 'string', required: true, default: () => new Date().toISOString() },
    exitedAt: { type: 'string' },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['componentId'], template: 'COMPONENT#${componentId}' }, sk: { field: 'sk', composite: ['enteredAt', 'id'], template: 'STATUS_HISTORY#${enteredAt}#${id}' } },
  },
} as const;

const ComponentPreviewSchema = {
  model: { entity: 'ComponentPreview', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    componentId: { type: 'string', required: true },
    htmlContent: { type: 'string', required: true },
    prompt: { type: 'string', required: true },
    modelUsed: { type: 'string', required: true, default: 'claude-sonnet-4-5' },
    inputTokens: { type: 'number' },
    outputTokens: { type: 'number' },
    status: { type: ['PENDING', 'COMPLETED', 'FAILED'] as const, required: true, default: 'PENDING' },
    generatedBy: { type: 'string', required: true },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['componentId'], template: 'COMPONENT#${componentId}' }, sk: { field: 'sk', composite: ['createdAt', 'id'], template: 'PREVIEW#${createdAt}#${id}' } },
    byUser: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['generatedBy'], template: 'USER#${generatedBy}' }, sk: { field: 'gsi1sk', composite: ['createdAt', 'id'], template: 'PREVIEW#${createdAt}#${id}' } },
  },
} as const;

const TeamWorkflowConfigSchema = {
  model: { entity: 'TeamWorkflowConfig', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    teamId: { type: 'string', required: true },
    wipLimitPlanning: { type: 'number' },
    wipLimitInProgress: { type: 'number' },
    wipLimitBlocked: { type: 'number' },
    wipLimitReview: { type: 'number' },
    cycleEnabled: { type: 'boolean', required: true, default: false },
    cycleDurationWeeks: { type: 'number' },
    cycleStartDayOfWeek: { type: 'number' },
    workflowTemplate: { type: 'string', default: 'CUSTOM' },
    cycleName: { type: 'string', default: 'Sprint' },
    backlogName: { type: 'string', default: 'Backlog' },
    enforceEstimates: { type: 'boolean', required: true, default: false },
    autoArchiveCompleted: { type: 'boolean', required: true, default: false },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
    updatedAt: { type: 'string', required: true, default: () => new Date().toISOString(), set: () => new Date().toISOString(), watch: '*' },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['teamId'], template: 'TEAM#${teamId}' }, sk: { field: 'sk', composite: [], template: 'WORKFLOW_CONFIG' } },
  },
} as const;

const GitHubTransitionConfigSchema = {
  model: { entity: 'GitHubTransitionConfig', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    event: { type: ['PR_OPENED', 'PR_READY_FOR_REVIEW', 'PR_APPROVED', 'PR_MERGED', 'PR_CLOSED'] as const, required: true },
    targetStatus: { type: ['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'] as const, required: true },
    enabled: { type: 'boolean', required: true, default: true },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
    updatedAt: { type: 'string', required: true, default: () => new Date().toISOString(), set: () => new Date().toISOString(), watch: '*' },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['projectId'], template: 'PROJECT#${projectId}' }, sk: { field: 'sk', composite: ['event'], template: 'GITHUB_CONFIG#${event}' } },
  },
} as const;

/**
 * Comment entity for component discussions
 * Supports both authenticated users and guests with @mentions
 */
const CommentSchema = {
  model: { entity: 'Comment', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    componentId: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    authorId: { type: 'string', required: true },
    authorType: { type: ['USER', 'GUEST'] as const, required: true },
    authorName: { type: 'string', required: true },
    content: { type: 'string', required: true },
    mentions: { type: 'list', items: { type: 'string' }, default: [] as string[] },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['componentId'], template: 'COMPONENT#${componentId}' }, sk: { field: 'sk', composite: ['createdAt', 'id'], template: 'COMMENT#${createdAt}#${id}' } },
    byAuthor: { index: 'gsi1', pk: { field: 'gsi1pk', composite: ['authorId'], template: 'AUTHOR#${authorId}' }, sk: { field: 'gsi1sk', composite: ['createdAt', 'id'], template: 'COMMENT#${createdAt}#${id}' } },
  },
} as const;

/**
 * GuestNotification entity - separate from User notifications
 * Guests use cognitoIdentityId as guestId (different from USER# prefix)
 */
const GuestNotificationSchema = {
  model: { entity: 'GuestNotification', version: '1', service: 'tasktitan' },
  attributes: {
    id: { type: 'string', required: true },
    guestId: { type: 'string', required: true },
    type: { type: ['TASK_ASSIGNED', 'TASK_UNASSIGNED', 'TASK_STATUS_CHANGED', 'TASK_MENTIONED'] as const, required: true },
    title: { type: 'string', required: true },
    message: { type: 'string', required: true },
    componentId: { type: 'string' },
    projectId: { type: 'string' },
    read: { type: 'boolean', required: true, default: false },
    createdAt: { type: 'string', required: true, default: () => new Date().toISOString(), readOnly: true },
  },
  indexes: {
    primary: { pk: { field: 'pk', composite: ['guestId'], template: 'GUEST#${guestId}' }, sk: { field: 'sk', composite: ['createdAt', 'id'], template: 'NOTIFICATION#${createdAt}#${id}' } },
  },
} as const;

// Lazy-initialized entities (singleton pattern)
let _entities: ReturnType<typeof createEntities> | null = null;

function createEntities() {
  const config = getConfig();

  return {
    user: new Entity(UserSchema, config),
    team: new Entity(TeamSchema, config),
    membership: new Entity(MembershipSchema, config),
    project: new Entity(ProjectSchema, config),
    component: new Entity(ComponentSchema, config),
    sprint: new Entity(SprintSchema, config),
    assignment: new Entity(AssignmentSchema, config),
    dependency: new Entity(DependencySchema, config),
    activity: new Entity(ActivitySchema, config),
    notification: new Entity(NotificationSchema, config),
    componentStatusHistory: new Entity(ComponentStatusHistorySchema, config),
    componentPreview: new Entity(ComponentPreviewSchema, config),
    teamWorkflowConfig: new Entity(TeamWorkflowConfigSchema, config),
    githubTransitionConfig: new Entity(GitHubTransitionConfigSchema, config),
    comment: new Entity(CommentSchema, config),
    guestNotification: new Entity(GuestNotificationSchema, config),
  };
}

/**
 * Get configured entities for DynamoDB operations
 * Lazy initialization to allow for environment variable loading
 */
export function getEntities() {
  if (!_entities) {
    _entities = createEntities();
  }
  return _entities;
}

/**
 * Reset entities (useful for testing)
 */
export function resetEntities() {
  _entities = null;
}

/**
 * Create ElectroDB Service with all entities configured
 * Use this for cross-entity queries and batch operations
 */
export function getService() {
  const entities = getEntities();
  return new Service(entities);
}

// Create type-only entities for type inference (no runtime config needed)
const _UserEntity = new Entity(UserSchema);
const _TeamEntity = new Entity(TeamSchema);
const _MembershipEntity = new Entity(MembershipSchema);
const _ProjectEntity = new Entity(ProjectSchema);
const _ComponentEntity = new Entity(ComponentSchema);
const _SprintEntity = new Entity(SprintSchema);
const _AssignmentEntity = new Entity(AssignmentSchema);
const _DependencyEntity = new Entity(DependencySchema);
const _ActivityEntity = new Entity(ActivitySchema);
const _NotificationEntity = new Entity(NotificationSchema);
const _ComponentStatusHistoryEntity = new Entity(ComponentStatusHistorySchema);
const _ComponentPreviewEntity = new Entity(ComponentPreviewSchema);
const _TeamWorkflowConfigEntity = new Entity(TeamWorkflowConfigSchema);
const _GitHubTransitionConfigEntity = new Entity(GitHubTransitionConfigSchema);
const _CommentEntity = new Entity(CommentSchema);
const _GuestNotificationEntity = new Entity(GuestNotificationSchema);

// Export entity types for type-safe usage
export type UserItem = EntityItem<typeof _UserEntity>;
export type CreateUserInput = CreateEntityItem<typeof _UserEntity>;
export type TeamItem = EntityItem<typeof _TeamEntity>;
export type CreateTeamInput = CreateEntityItem<typeof _TeamEntity>;
export type MembershipItem = EntityItem<typeof _MembershipEntity>;
export type CreateMembershipInput = CreateEntityItem<typeof _MembershipEntity>;
export type ProjectItem = EntityItem<typeof _ProjectEntity>;
export type CreateProjectInput = CreateEntityItem<typeof _ProjectEntity>;
export type ComponentItem = EntityItem<typeof _ComponentEntity>;
export type CreateComponentInput = CreateEntityItem<typeof _ComponentEntity>;
export type SprintItem = EntityItem<typeof _SprintEntity>;
export type CreateSprintInput = CreateEntityItem<typeof _SprintEntity>;
export type AssignmentItem = EntityItem<typeof _AssignmentEntity>;
export type CreateAssignmentInput = CreateEntityItem<typeof _AssignmentEntity>;
export type DependencyItem = EntityItem<typeof _DependencyEntity>;
export type CreateDependencyInput = CreateEntityItem<typeof _DependencyEntity>;
export type ActivityItem = EntityItem<typeof _ActivityEntity>;
export type CreateActivityInput = CreateEntityItem<typeof _ActivityEntity>;
export type NotificationItem = EntityItem<typeof _NotificationEntity>;
export type CreateNotificationInput = CreateEntityItem<typeof _NotificationEntity>;
export type ComponentStatusHistoryItem = EntityItem<typeof _ComponentStatusHistoryEntity>;
export type CreateComponentStatusHistoryInput = CreateEntityItem<typeof _ComponentStatusHistoryEntity>;
export type ComponentPreviewItem = EntityItem<typeof _ComponentPreviewEntity>;
export type CreateComponentPreviewInput = CreateEntityItem<typeof _ComponentPreviewEntity>;
export type TeamWorkflowConfigItem = EntityItem<typeof _TeamWorkflowConfigEntity>;
export type CreateTeamWorkflowConfigInput = CreateEntityItem<typeof _TeamWorkflowConfigEntity>;
export type GitHubTransitionConfigItem = EntityItem<typeof _GitHubTransitionConfigEntity>;
export type CreateGitHubTransitionConfigInput = CreateEntityItem<typeof _GitHubTransitionConfigEntity>;
export type CommentItem = EntityItem<typeof _CommentEntity>;
export type CreateCommentInput = CreateEntityItem<typeof _CommentEntity>;
export type GuestNotificationItem = EntityItem<typeof _GuestNotificationEntity>;
export type CreateGuestNotificationInput = CreateEntityItem<typeof _GuestNotificationEntity>;

// Export schemas for testing and extension
export {
  UserSchema,
  TeamSchema,
  MembershipSchema,
  ProjectSchema,
  ComponentSchema,
  SprintSchema,
  AssignmentSchema,
  DependencySchema,
  ActivitySchema,
  NotificationSchema,
  ComponentStatusHistorySchema,
  ComponentPreviewSchema,
  TeamWorkflowConfigSchema,
  GitHubTransitionConfigSchema,
  CommentSchema,
  GuestNotificationSchema,
};
