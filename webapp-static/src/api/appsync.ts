/**
 * AppSync GraphQL client using Amplify API + Cognito auth.
 * Operations match schema: getProject, getTeam, listProjectsByTeam, createProject, etc.
 * We do NOT redirect to sign-in on AppSync errors here: that was causing users to be
 * kicked to sign-in when opening their own project (e.g. backend/auth quirks).
 * Auth is enforced by ProtectedRoute; page-level errors are shown in the UI.
 */
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';

// Lazy-initialize client to avoid "Amplify not configured" warning
// (generateClient() must be called AFTER Amplify.configure() in main.tsx)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
function getClient() {
  if (!_client) {
    _client = generateClient();
  }
  return _client;
}

/**
 * Extract error message from GraphQL response.
 * Handles both Amplify v6 error formats and standard GraphQL errors.
 */
function extractGraphQLError(result: unknown, operationName: string): void {
  // Check for errors array (standard GraphQL response)
  const gqlResult = result as { 
    errors?: Array<{ message: string; errorType?: string }>; 
    data?: unknown 
  };
  
  if (gqlResult.errors && gqlResult.errors.length > 0) {
    const errorMessages = gqlResult.errors.map((e) => {
      const prefix = e.errorType ? `[${e.errorType}] ` : '';
      return `${prefix}${e.message}`;
    });
    const errorMessage = errorMessages.join('; ');
    console.error(`[${operationName}] GraphQL errors:`, JSON.stringify(gqlResult.errors, null, 2));
    throw new Error(errorMessage);
  }
}

export type Project = {
  id: string;
  name: string;
  description?: string | null;
  teamId: string;
  ownerId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type Team = {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type User = {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  // Timestamp-based "Read Until" marker for O(1) mark-all-as-read (AWS best practice)
  notificationsReadUntil?: string | null;
};

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export type Membership = {
  id: string;
  userId: string;
  teamId: string;
  role: MemberRole;
  joinedAt?: string | null;
  title?: string | null;
  hoursPerDay?: number | null;
  availability?: number | null;
  user?: User | null;
};

export type TeamWithMembers = {
  team: Team;
  members: Membership[];
};

export type TeamMember = {
  id: string;
  userId: string;
  teamId: string;
  role: MemberRole;
  joinedAt?: string | null;
  title?: string | null;
};

export type CreateTeamInput = {
  id: string;
  name: string;
  description?: string | null;
};

export type UpdateTeamInput = {
  name?: string | null;
  description?: string | null;
};

export type AddTeamMemberInput = {
  teamId: string;
  userId: string;
  role: MemberRole;
  title?: string | null;
};

export type UpdateMemberRoleInput = {
  teamId: string;
  userId: string;
  role: MemberRole;
};

// Registration types (unauthenticated - uses AdminCreateUser)
export type RegisterUserInput = {
  email: string;
  name: string;
};

export type RegisterUserResult = {
  success: boolean;
  message: string;
};

export type CreateProjectInput = {
  id: string;
  teamId: string;
  ownerId: string;
  name: string;
  description?: string | null;
};

export type UpdateProjectInput = {
  name?: string | null;
  description?: string | null;
};

export type ComponentType = 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
export type ComponentStatus = 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';

export type Component = {
  id: string;
  name: string;
  description?: string | null;
  type: ComponentType;
  projectId: string;
  parentId?: string | null;
  sprintId?: string | null;
  status: ComponentStatus;
  priority?: number | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: string | null;
  owner?: string | null;
  tags?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  // Kanban: Timestamp when work started (for cycle time calculation)
  startedAt?: string | null;
  // Shape Up: Manual hill chart position (0-100)
  hillPhase?: number | null;
};

export type CreateComponentInput = {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  type: ComponentType;
  parentId?: string | null;
  status?: ComponentStatus | null;
  priority?: number | null;
  estimatedHours?: number | null;
  dueDate?: string | null;
  owner?: string | null;
  tags?: string[] | null;
  startedAt?: string | null;
  hillPhase?: number | null;
};

export type UpdateComponentInput = {
  name?: string | null;
  description?: string | null;
  type?: ComponentType | null;
  parentId?: string | null;
  sprintId?: string | null;
  status?: ComponentStatus | null;
  priority?: number | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: string | null;
  owner?: string | null;
  tags?: string[] | null;
  startedAt?: string | null;
  hillPhase?: number | null;
};

export type Dependency = {
  fromComponentId: string;
  toComponentId: string;
  createdAt?: string | null;
};

export type SprintStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type Sprint = {
  id: string;
  teamId: string;
  name: string;
  goal?: string | null;
  status: SprintStatus;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SprintWithComponents = {
  sprint: Sprint;
  components: Component[];
};

export type CreateSprintInput = {
  id: string;
  teamId: string;
  name: string;
  goal?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type UpdateSprintInput = {
  name?: string | null;
  goal?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type Assignment = {
  id: string;
  componentId: string;
  userId: string;
  assignedAt: string;
  user?: User | null;
  component?: Component | null;
};

export type AssignmentWithComponent = {
  assignment: Assignment;
  component: Component;
};

export type ActivityType =
  | 'PROJECT_CREATED'
  | 'COMPONENT_CREATED'
  | 'COMPONENT_UPDATED'
  | 'COMPONENT_STATUS_CHANGED'
  | 'DEPENDENCY_ADDED'
  | 'DEPENDENCY_REMOVED'
  | 'MEMBER_ASSIGNED'
  | 'MEMBER_UNASSIGNED'
  | 'COMMENT_ADDED'
  | 'SPRINT_CREATED'
  | 'SPRINT_STARTED'
  | 'SPRINT_COMPLETED'
  | 'COMPONENT_ADDED_TO_SPRINT'
  | 'COMPONENT_REMOVED_FROM_SPRINT'
  | 'GITHUB_PR_OPENED'
  | 'GITHUB_PR_MERGED'
  | 'GITHUB_PR_CLOSED'
  | 'GITHUB_PR_LINKED';

export type Activity = {
  id: string;
  type: ActivityType;
  projectId: string;
  userId: string;
  metadata?: string | null;
  createdAt: string;
};

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_COMMENT'
  | 'TASK_DUE_SOON'
  | 'TASK_OVERDUE'
  | 'SPRINT_STARTED'
  | 'SPRINT_ENDING';

export type Notification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  componentId?: string | null;
  projectId?: string | null;
  read: boolean;
  createdAt: string;
};

// Comment types for component discussions
export type AuthorType = 'USER' | 'GUEST';

export type Comment = {
  id: string;
  componentId: string;
  projectId: string;
  authorId: string;
  authorType: AuthorType;
  authorName: string;
  content: string;
  mentions?: string[] | null;
  createdAt: string;
};

export type CreateCommentInput = {
  componentId: string;
  content: string;
  mentions?: string[];
};

// @mentions autocomplete types
export type TeamMemberSuggestion = {
  id: string;
  name: string;
  isGuest: boolean;
};

// Guest notification types
export type GuestNotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_UNASSIGNED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_MENTIONED';

export type GuestNotification = {
  id: string;
  guestId: string;
  type: GuestNotificationType;
  title: string;
  message: string;
  componentId?: string | null;
  projectId?: string | null;
  read: boolean;
  createdAt: string;
};

// Phase 9: Workflow Config & Metrics types
export type TeamWorkflowConfig = {
  id: string;
  teamId: string;
  wipLimitPlanning?: number | null;
  wipLimitInProgress?: number | null;
  wipLimitBlocked?: number | null;
  wipLimitReview?: number | null;
  cycleEnabled: boolean;
  cycleDurationWeeks?: number | null;
  cycleStartDayOfWeek?: number | null;
  cycleName?: string | null;
  backlogName?: string | null;
  workflowTemplate?: string | null;
  enforceEstimates: boolean;
  autoArchiveCompleted: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type UpdateWorkflowConfigInput = {
  wipLimitPlanning?: number | null;
  wipLimitInProgress?: number | null;
  wipLimitBlocked?: number | null;
  wipLimitReview?: number | null;
  cycleEnabled?: boolean | null;
  cycleDurationWeeks?: number | null;
  cycleStartDayOfWeek?: number | null;
  cycleName?: string | null;
  backlogName?: string | null;
  workflowTemplate?: string | null;
  enforceEstimates?: boolean | null;
  autoArchiveCompleted?: boolean | null;
};

export type StatusCount = {
  status: ComponentStatus;
  count: number;
};

export type TeamMetrics = {
  teamId: string;
  totalComponents: number;
  statusDistribution: StatusCount[];
  epicCount: number;
  featureCount: number;
  storyCount: number;
  taskCount: number;
  bugCount: number;
  totalSprints: number;
  activeSprints: number;
  completedSprints: number;
};

const GetProject = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const GetTeam = /* GraphQL */ `
  query GetTeam($id: ID!) {
    getTeam(id: $id) {
      id
      name
      description
      createdAt
      updatedAt
    }
  }
`;

const ListProjectsByTeam = /* GraphQL */ `
  query ListProjectsByTeam($teamId: ID!) {
    listProjectsByTeam(teamId: $teamId) {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const GetCurrentUser = /* GraphQL */ `
  query GetCurrentUser {
    getCurrentUser {
      id
      email
      name
      avatarUrl
      createdAt
      updatedAt
      notificationsReadUntil
    }
  }
`;

const GetUserByEmail = /* GraphQL */ `
  query GetUserByEmail($email: String!) {
    getUserByEmail(email: $email) {
      id
      email
      name
      avatarUrl
      createdAt
      updatedAt
    }
  }
`;

const ListTeamsForUser = /* GraphQL */ `
  query ListTeamsForUser {
    listTeamsForUser {
      team {
        id
        name
        description
        createdAt
        updatedAt
      }
      members {
        id
        userId
        teamId
        role
        joinedAt
        title
      }
    }
  }
`;

const GetTeamWithMembers = /* GraphQL */ `
  query GetTeamWithMembers($teamId: ID!) {
    getTeamWithMembers(teamId: $teamId) {
      team {
        id
        name
        description
        createdAt
        updatedAt
      }
      members {
        id
        userId
        teamId
        role
        joinedAt
        title
        hoursPerDay
        availability
        user {
          id
          email
          name
          avatarUrl
        }
      }
    }
  }
`;

// User registration mutation (unauthenticated - uses API key)
// AWS Documentation: https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html
const RegisterUser = /* GraphQL */ `
  mutation RegisterUser($input: RegisterUserInput!) {
    registerUser(input: $input) {
      success
      message
    }
  }
`;

// Sync user profile from ID token claims after OAuth callback
// AWS Best Practice: Access token (used by AppSync auth) doesn't contain email/name claims
// Frontend extracts these from the ID token and syncs to DynamoDB
const SyncUserProfile = /* GraphQL */ `
  mutation SyncUserProfile($input: SyncUserProfileInput!) {
    syncUserProfile(input: $input) {
      id
      email
      name
      createdAt
      updatedAt
    }
  }
`;

const CreateTeam = /* GraphQL */ `
  mutation CreateTeam($input: CreateTeamInput!) {
    createTeam(input: $input) {
      team {
        id
        name
        description
        createdAt
        updatedAt
      }
      members {
        id
        userId
        teamId
        role
        joinedAt
      }
    }
  }
`;

const UpdateTeam = /* GraphQL */ `
  mutation UpdateTeam($teamId: ID!, $input: UpdateTeamInput!) {
    updateTeam(teamId: $teamId, input: $input) {
      id
      name
      description
      createdAt
      updatedAt
    }
  }
`;

const AddTeamMember = /* GraphQL */ `
  mutation AddTeamMember($input: AddTeamMemberInput!) {
    addTeamMember(input: $input) {
      id
      userId
      teamId
      role
      joinedAt
      title
    }
  }
`;

const RemoveTeamMember = /* GraphQL */ `
  mutation RemoveTeamMember($teamId: ID!, $userId: ID!) {
    removeTeamMember(teamId: $teamId, userId: $userId)
  }
`;

const UpdateMemberRole = /* GraphQL */ `
  mutation UpdateMemberRole($input: UpdateMemberRoleInput!) {
    updateMemberRole(input: $input) {
      id
      userId
      teamId
      role
    }
  }
`;

const DeleteTeam = /* GraphQL */ `
  mutation DeleteTeam($teamId: ID!) {
    deleteTeam(teamId: $teamId)
  }
`;

const ListProjectsForUser = /* GraphQL */ `
  query ListProjectsForUser {
    listProjectsForUser {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const CreateProject = /* GraphQL */ `
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const UpdateProject = /* GraphQL */ `
  mutation UpdateProject($id: ID!, $input: UpdateProjectInput!) {
    updateProject(id: $id, input: $input) {
      id
      name
      description
      teamId
      ownerId
      createdAt
      updatedAt
    }
  }
`;

const DeleteProject = /* GraphQL */ `
  mutation DeleteProject($id: ID!) {
    deleteProject(id: $id)
  }
`;

const GetComponent = /* GraphQL */ `
  query GetComponent($id: ID!) {
    getComponent(id: $id) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

const ListComponentsByProject = /* GraphQL */ `
  query ListComponentsByProject($projectId: ID!) {
    listComponentsByProject(projectId: $projectId) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

const GetComponentChildren = /* GraphQL */ `
  query GetComponentChildren($parentId: ID!) {
    getComponentChildren(parentId: $parentId) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

const CreateComponent = /* GraphQL */ `
  mutation CreateComponent($input: CreateComponentInput!) {
    createComponent(input: $input) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

const UpdateComponent = /* GraphQL */ `
  mutation UpdateComponent($id: ID!, $input: UpdateComponentInput!) {
    updateComponent(id: $id, input: $input) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

const DeleteComponent = /* GraphQL */ `
  mutation DeleteComponent($id: ID!) {
    deleteComponent(id: $id)
  }
`;

const GetDependencies = /* GraphQL */ `
  query GetDependencies($componentId: ID!) {
    getDependencies(componentId: $componentId) {
      fromComponentId
      toComponentId
      createdAt
    }
  }
`;

const GetDependents = /* GraphQL */ `
  query GetDependents($componentId: ID!) {
    getDependents(componentId: $componentId) {
      fromComponentId
      toComponentId
      createdAt
    }
  }
`;

const AddDependency = /* GraphQL */ `
  mutation AddDependency($fromComponentId: ID!, $toComponentId: ID!) {
    addDependency(fromComponentId: $fromComponentId, toComponentId: $toComponentId) {
      fromComponentId
      toComponentId
      createdAt
    }
  }
`;

const RemoveDependency = /* GraphQL */ `
  mutation RemoveDependency($fromComponentId: ID!, $toComponentId: ID!) {
    removeDependency(fromComponentId: $fromComponentId, toComponentId: $toComponentId)
  }
`;

const GetSprint = /* GraphQL */ `
  query GetSprint($id: ID!) {
    getSprint(id: $id) {
      id
      teamId
      name
      goal
      status
      startDate
      endDate
      createdAt
      updatedAt
    }
  }
`;

const ListSprintsByTeam = /* GraphQL */ `
  query ListSprintsByTeam($teamId: ID!) {
    listSprintsByTeam(teamId: $teamId) {
      id
      teamId
      name
      goal
      status
      startDate
      endDate
      createdAt
      updatedAt
    }
  }
`;

const GetSprintWithComponents = /* GraphQL */ `
  query GetSprintWithComponents($sprintId: ID!) {
    getSprintWithComponents(sprintId: $sprintId) {
      sprint {
        id
        teamId
        name
        goal
        status
        startDate
        endDate
        createdAt
        updatedAt
      }
      components {
        id
        name
        description
        type
        projectId
        parentId
        sprintId
        status
        priority
        estimatedHours
        actualHours
        dueDate
        owner
        tags
        createdAt
        updatedAt
      }
    }
  }
`;

const CreateSprint = /* GraphQL */ `
  mutation CreateSprint($input: CreateSprintInput!) {
    createSprint(input: $input) {
      id
      teamId
      name
      goal
      status
      startDate
      endDate
      createdAt
      updatedAt
    }
  }
`;

const UpdateSprint = /* GraphQL */ `
  mutation UpdateSprint($id: ID!, $input: UpdateSprintInput!) {
    updateSprint(id: $id, input: $input) {
      id
      teamId
      name
      goal
      status
      startDate
      endDate
      createdAt
      updatedAt
    }
  }
`;

const DeleteSprint = /* GraphQL */ `
  mutation DeleteSprint($id: ID!) {
    deleteSprint(id: $id)
  }
`;

const StartSprint = /* GraphQL */ `
  mutation StartSprint($id: ID!) {
    startSprint(id: $id) {
      id
      teamId
      name
      goal
      status
      startDate
      endDate
      createdAt
      updatedAt
    }
  }
`;

const CompleteSprint = /* GraphQL */ `
  mutation CompleteSprint($id: ID!) {
    completeSprint(id: $id) {
      id
      teamId
      name
      goal
      status
      startDate
      endDate
      createdAt
      updatedAt
    }
  }
`;

const AssignComponentToSprint = /* GraphQL */ `
  mutation AssignComponentToSprint($componentId: ID!, $sprintId: ID!) {
    assignComponentToSprint(componentId: $componentId, sprintId: $sprintId) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

const RemoveComponentFromSprint = /* GraphQL */ `
  mutation RemoveComponentFromSprint($componentId: ID!) {
    removeComponentFromSprint(componentId: $componentId) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

const ListAssignmentsForUser = /* GraphQL */ `
  query ListAssignmentsForUser {
    listAssignmentsForUser {
      assignment {
        id
        componentId
        userId
        assignedAt
      }
      component {
        id
        name
        description
        type
        projectId
        parentId
        sprintId
        status
        priority
        estimatedHours
        actualHours
        dueDate
        owner
        tags
        createdAt
        updatedAt
      }
    }
  }
`;

const ListAssignmentsForComponent = /* GraphQL */ `
  query ListAssignmentsForComponent($componentId: ID!) {
    listAssignmentsForComponent(componentId: $componentId) {
      id
      componentId
      userId
      assignedAt
    }
  }
`;

const AssignUserToComponent = /* GraphQL */ `
  mutation AssignUserToComponent($componentId: ID!, $userId: ID!) {
    assignUserToComponent(componentId: $componentId, userId: $userId) {
      id
      componentId
      userId
      assignedAt
    }
  }
`;

const UnassignUserFromComponent = /* GraphQL */ `
  mutation UnassignUserFromComponent($componentId: ID!, $userId: ID!) {
    unassignUserFromComponent(componentId: $componentId, userId: $userId)
  }
`;

const ListActivitiesForProject = /* GraphQL */ `
  query ListActivitiesForProject($projectId: ID!, $limit: Int) {
    listActivitiesForProject(projectId: $projectId, limit: $limit) {
      id
      type
      projectId
      userId
      metadata
      createdAt
    }
  }
`;

const ListNotificationsForUser = /* GraphQL */ `
  query ListNotificationsForUser($limit: Int, $unreadOnly: Boolean) {
    listNotificationsForUser(limit: $limit, unreadOnly: $unreadOnly) {
      id
      userId
      type
      title
      message
      componentId
      projectId
      read
      createdAt
    }
  }
`;

const CountUnreadNotifications = /* GraphQL */ `
  query CountUnreadNotifications {
    countUnreadNotifications
  }
`;

const MarkNotificationRead = /* GraphQL */ `
  mutation MarkNotificationRead($notificationId: ID!) {
    markNotificationRead(notificationId: $notificationId) {
      id
      userId
      type
      title
      message
      componentId
      projectId
      read
      createdAt
    }
  }
`;

const MarkAllNotificationsRead = /* GraphQL */ `
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

// Comment queries and mutations
const ListCommentsForComponent = /* GraphQL */ `
  query ListCommentsForComponent($componentId: ID!, $limit: Int) {
    listCommentsForComponent(componentId: $componentId, limit: $limit) {
      id
      componentId
      projectId
      authorId
      authorType
      authorName
      content
      mentions
      createdAt
    }
  }
`;

const CreateComment = /* GraphQL */ `
  mutation CreateComment($componentId: ID!, $content: String!, $mentions: [String!]) {
    createComment(componentId: $componentId, content: $content, mentions: $mentions) {
      id
      componentId
      projectId
      authorId
      authorType
      authorName
      content
      mentions
      createdAt
    }
  }
`;

const GetTeamWorkflowConfig = /* GraphQL */ `
  query GetTeamWorkflowConfig($teamId: ID!) {
    getTeamWorkflowConfig(teamId: $teamId) {
      id
      teamId
      wipLimitPlanning
      wipLimitInProgress
      wipLimitBlocked
      wipLimitReview
      cycleEnabled
      cycleDurationWeeks
      cycleStartDayOfWeek
      cycleName
      backlogName
      workflowTemplate
      enforceEstimates
      autoArchiveCompleted
      createdAt
      updatedAt
    }
  }
`;

const UpdateTeamWorkflowConfig = /* GraphQL */ `
  mutation UpdateTeamWorkflowConfig($teamId: ID!, $input: UpdateWorkflowConfigInput!) {
    updateTeamWorkflowConfig(teamId: $teamId, input: $input) {
      id
      teamId
      wipLimitPlanning
      wipLimitInProgress
      wipLimitBlocked
      wipLimitReview
      cycleEnabled
      cycleDurationWeeks
      cycleStartDayOfWeek
      cycleName
      backlogName
      workflowTemplate
      enforceEstimates
      autoArchiveCompleted
      createdAt
      updatedAt
    }
  }
`;

const GetTeamMetrics = /* GraphQL */ `
  query GetTeamMetrics($teamId: ID!) {
    getTeamMetrics(teamId: $teamId) {
      teamId
      totalComponents
      statusDistribution {
        status
        count
      }
      epicCount
      featureCount
      storyCount
      taskCount
      bugCount
      totalSprints
      activeSprints
      completedSprints
    }
  }
`;

const GenerateComponentViaAI = /* GraphQL */ `
  mutation GenerateComponentViaAI($projectId: ID!, $prompt: String!) {
    generateComponentViaAI(projectId: $projectId, prompt: $prompt)
  }
`;

// =============================================================================
// Async AI Generation (bypasses 30s AppSync timeout via subscriptions)
// =============================================================================

export type AIJobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export type AIJob = {
  sessionId: string;
  status: AIJobStatus;
  createdAt: string;
};

export type AIProgress = {
  sessionId: string;
  progress: number;
  message: string;
  status: AIJobStatus;
  result?: FullPlanResult | null;
  error?: string | null;
};

export type StartAIGenerationInput = {
  projectId: string;
  generateEpics?: boolean | null;
};

const StartAIGeneration = /* GraphQL */ `
  mutation StartAIGeneration($input: StartAIGenerationInput!) {
    startAIGeneration(input: $input) {
      sessionId
      status
      createdAt
    }
  }
`;

const OnAIProgress = /* GraphQL */ `
  subscription OnAIProgress($sessionId: ID!) {
    onAIProgress(sessionId: $sessionId) {
      sessionId
      progress
      message
      status
      result {
        components {
          name
          description
          type
          estimatedHours
          priority
          suggestedDependencies
          parentName
          acceptanceCriteria
        }
        summary
        enhancedDescription
        sprints {
          name
          goal
          durationWeeks
          componentNames
          capacity
        }
        epics {
          name
          description
          componentNames
        }
      }
      error
    }
  }
`;

export async function getProject(id: string): Promise<Project | null> {
  const result = await getClient().graphql({
    query: GetProject,
    variables: { id },
  });
  extractGraphQLError(result, 'getProject');
  return (result as { data: { getProject: Project | null } }).data.getProject;
}

export async function getTeam(id: string): Promise<Team | null> {
  const result = await getClient().graphql({
    query: GetTeam,
    variables: { id },
  });
  return (result as { data: { getTeam: Team | null } }).data.getTeam;
}

export async function listProjectsByTeam(teamId: string): Promise<Project[]> {
  const result = await getClient().graphql({
    query: ListProjectsByTeam,
    variables: { teamId },
  });
  return (result as { data: { listProjectsByTeam: Project[] } }).data.listProjectsByTeam ?? [];
}

export async function fetchCurrentUser(): Promise<User | null> {
  const result = await getClient().graphql({
    query: GetCurrentUser,
  });
  return (result as { data: { getCurrentUser: User | null } }).data.getCurrentUser;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await getClient().graphql({
    query: GetUserByEmail,
    variables: { email },
  });
  return (result as { data: { getUserByEmail: User | null } }).data.getUserByEmail;
}

export async function listTeamsForUser(): Promise<TeamWithMembers[]> {
  const result = await getClient().graphql({
    query: ListTeamsForUser,
  });
  return (result as { data: { listTeamsForUser: TeamWithMembers[] } }).data.listTeamsForUser ?? [];
}

export async function getTeamWithMembers(teamId: string): Promise<TeamWithMembers | null> {
  const result = await getClient().graphql({
    query: GetTeamWithMembers,
    variables: { teamId },
  });
  extractGraphQLError(result, 'getTeamWithMembers');
  return (result as { data: { getTeamWithMembers: TeamWithMembers | null } }).data.getTeamWithMembers;
}

export async function createTeam(input: CreateTeamInput): Promise<TeamWithMembers> {
  const result = await getClient().graphql({
    query: CreateTeam,
    variables: { input },
  });
  const team = (result as { data: { createTeam: TeamWithMembers } }).data.createTeam;
  if (!team) throw new Error('createTeam returned null');
  return team;
}

export async function updateTeam(teamId: string, input: UpdateTeamInput): Promise<Team> {
  const result = await getClient().graphql({
    query: UpdateTeam,
    variables: { teamId, input },
  });
  const team = (result as { data: { updateTeam: Team } }).data.updateTeam;
  if (!team) throw new Error('updateTeam returned null');
  return team;
}

export async function addTeamMember(input: AddTeamMemberInput): Promise<Membership> {
  const result = await getClient().graphql({
    query: AddTeamMember,
    variables: { input },
  });
  const membership = (result as { data: { addTeamMember: Membership } }).data.addTeamMember;
  if (!membership) throw new Error('addTeamMember returned null');
  return membership;
}

export async function removeTeamMember(teamId: string, userId: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: RemoveTeamMember,
    variables: { teamId, userId },
  });
  return (result as { data: { removeTeamMember: boolean } }).data.removeTeamMember;
}

export async function updateMemberRole(input: UpdateMemberRoleInput): Promise<Membership> {
  const result = await getClient().graphql({
    query: UpdateMemberRole,
    variables: { input },
  });
  const membership = (result as { data: { updateMemberRole: Membership } }).data.updateMemberRole;
  if (!membership) throw new Error('updateMemberRole returned null');
  return membership;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const result = await getClient().graphql({
    query: CreateProject,
    variables: { input },
  });
  const project = (result as { data: { createProject: Project } }).data.createProject;
  if (!project) throw new Error('createProject returned null');
  return project;
}

export async function listProjectsForUser(): Promise<Project[]> {
  const result = await getClient().graphql({
    query: ListProjectsForUser,
  });
  return (result as { data: { listProjectsForUser: Project[] } }).data.listProjectsForUser ?? [];
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const result = await getClient().graphql({
    query: UpdateProject,
    variables: { id, input },
  });
  const project = (result as { data: { updateProject: Project } }).data.updateProject;
  if (!project) throw new Error('updateProject returned null');
  return project;
}

export async function deleteProject(id: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: DeleteProject,
    variables: { id },
  });
  return (result as { data: { deleteProject: boolean } }).data.deleteProject;
}

export async function getComponent(id: string): Promise<Component | null> {
  const result = await getClient().graphql({
    query: GetComponent,
    variables: { id },
  });
  return (result as { data: { getComponent: Component | null } }).data.getComponent;
}

export async function listComponentsByProject(projectId: string): Promise<Component[]> {
  const result = await getClient().graphql({
    query: ListComponentsByProject,
    variables: { projectId },
  });
  extractGraphQLError(result, 'listComponentsByProject');
  return (result as { data: { listComponentsByProject: Component[] } }).data.listComponentsByProject ?? [];
}

export async function getComponentChildren(parentId: string): Promise<Component[]> {
  const result = await getClient().graphql({
    query: GetComponentChildren,
    variables: { parentId },
  });
  return (result as { data: { getComponentChildren: Component[] } }).data.getComponentChildren ?? [];
}

export async function createComponent(input: CreateComponentInput): Promise<Component> {
  const result = await getClient().graphql({
    query: CreateComponent,
    variables: { input },
  });
  const component = (result as { data: { createComponent: Component } }).data.createComponent;
  if (!component) throw new Error('createComponent returned null');
  return component;
}

export async function updateComponent(id: string, input: UpdateComponentInput): Promise<Component> {
  const result = await getClient().graphql({
    query: UpdateComponent,
    variables: { id, input },
  });
  const component = (result as { data: { updateComponent: Component } }).data.updateComponent;
  if (!component) throw new Error('updateComponent returned null');
  return component;
}

export async function deleteComponent(id: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: DeleteComponent,
    variables: { id },
  });
  return (result as { data: { deleteComponent: boolean } }).data.deleteComponent;
}

export async function generateComponentViaAI(projectId: string, prompt: string): Promise<string> {
  const result = await getClient().graphql({
    query: GenerateComponentViaAI,
    variables: { projectId, prompt },
  });
  const text = (result as { data: { generateComponentViaAI: string } }).data.generateComponentViaAI;
  if (text == null) throw new Error('generateComponentViaAI returned null');
  return text;
}

export async function getDependencies(componentId: string): Promise<Dependency[]> {
  const result = await getClient().graphql({
    query: GetDependencies,
    variables: { componentId },
  });
  return (result as { data: { getDependencies: Dependency[] } }).data.getDependencies ?? [];
}

export async function getDependents(componentId: string): Promise<Dependency[]> {
  const result = await getClient().graphql({
    query: GetDependents,
    variables: { componentId },
  });
  return (result as { data: { getDependents: Dependency[] } }).data.getDependents ?? [];
}

export async function addDependency(fromComponentId: string, toComponentId: string): Promise<Dependency> {
  const result = await getClient().graphql({
    query: AddDependency,
    variables: { fromComponentId, toComponentId },
  });
  const dependency = (result as { data: { addDependency: Dependency } }).data.addDependency;
  if (!dependency) throw new Error('addDependency returned null');
  return dependency;
}

export async function removeDependency(fromComponentId: string, toComponentId: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: RemoveDependency,
    variables: { fromComponentId, toComponentId },
  });
  return (result as { data: { removeDependency: boolean } }).data.removeDependency;
}

export async function getSprint(id: string): Promise<Sprint | null> {
  const result = await getClient().graphql({
    query: GetSprint,
    variables: { id },
  });
  return (result as { data: { getSprint: Sprint | null } }).data.getSprint;
}

export async function listSprintsByTeam(teamId: string): Promise<Sprint[]> {
  const result = await getClient().graphql({
    query: ListSprintsByTeam,
    variables: { teamId },
  });
  return (result as { data: { listSprintsByTeam: Sprint[] } }).data.listSprintsByTeam ?? [];
}

export async function getSprintWithComponents(sprintId: string): Promise<SprintWithComponents | null> {
  const result = await getClient().graphql({
    query: GetSprintWithComponents,
    variables: { sprintId },
  });
  return (result as { data: { getSprintWithComponents: SprintWithComponents | null } }).data.getSprintWithComponents;
}

export async function createSprint(input: CreateSprintInput): Promise<Sprint> {
  const result = await getClient().graphql({
    query: CreateSprint,
    variables: { input },
  });
  const sprint = (result as { data: { createSprint: Sprint } }).data.createSprint;
  if (!sprint) throw new Error('createSprint returned null');
  return sprint;
}

export async function updateSprint(id: string, input: UpdateSprintInput): Promise<Sprint> {
  const result = await getClient().graphql({
    query: UpdateSprint,
    variables: { id, input },
  });
  const sprint = (result as { data: { updateSprint: Sprint } }).data.updateSprint;
  if (!sprint) throw new Error('updateSprint returned null');
  return sprint;
}

export async function deleteSprint(id: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: DeleteSprint,
    variables: { id },
  });
  return (result as { data: { deleteSprint: boolean } }).data.deleteSprint;
}

export async function startSprint(id: string): Promise<Sprint> {
  const result = await getClient().graphql({
    query: StartSprint,
    variables: { id },
  });
  const sprint = (result as { data: { startSprint: Sprint } }).data.startSprint;
  if (!sprint) throw new Error('startSprint returned null');
  return sprint;
}

export async function completeSprint(id: string): Promise<Sprint> {
  const result = await getClient().graphql({
    query: CompleteSprint,
    variables: { id },
  });
  const sprint = (result as { data: { completeSprint: Sprint } }).data.completeSprint;
  if (!sprint) throw new Error('completeSprint returned null');
  return sprint;
}

export async function assignComponentToSprint(componentId: string, sprintId: string): Promise<Component> {
  const result = await getClient().graphql({
    query: AssignComponentToSprint,
    variables: { componentId, sprintId },
  });
  const component = (result as { data: { assignComponentToSprint: Component } }).data.assignComponentToSprint;
  if (!component) throw new Error('assignComponentToSprint returned null');
  return component;
}

export async function removeComponentFromSprint(componentId: string): Promise<Component> {
  const result = await getClient().graphql({
    query: RemoveComponentFromSprint,
    variables: { componentId },
  });
  const component = (result as { data: { removeComponentFromSprint: Component } }).data.removeComponentFromSprint;
  if (!component) throw new Error('removeComponentFromSprint returned null');
  return component;
}

export async function listAssignmentsForUser(): Promise<AssignmentWithComponent[]> {
  const result = await getClient().graphql({
    query: ListAssignmentsForUser,
  });
  return (result as { data: { listAssignmentsForUser: AssignmentWithComponent[] } }).data.listAssignmentsForUser ?? [];
}

export async function listAssignmentsForComponent(componentId: string): Promise<Assignment[]> {
  const result = await getClient().graphql({
    query: ListAssignmentsForComponent,
    variables: { componentId },
  });
  return (result as { data: { listAssignmentsForComponent: Assignment[] } }).data.listAssignmentsForComponent ?? [];
}

export async function assignUserToComponent(componentId: string, userId: string): Promise<Assignment> {
  const result = await getClient().graphql({
    query: AssignUserToComponent,
    variables: { componentId, userId },
  });
  const assignment = (result as { data: { assignUserToComponent: Assignment } }).data.assignUserToComponent;
  if (!assignment) throw new Error('assignUserToComponent returned null');
  return assignment;
}

export async function unassignUserFromComponent(componentId: string, userId: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: UnassignUserFromComponent,
    variables: { componentId, userId },
  });
  return (result as { data: { unassignUserFromComponent: boolean } }).data.unassignUserFromComponent;
}

export async function listActivitiesForProject(projectId: string, limit?: number): Promise<Activity[]> {
  const result = await getClient().graphql({
    query: ListActivitiesForProject,
    variables: { projectId, limit },
  });
  return (result as { data: { listActivitiesForProject: Activity[] } }).data.listActivitiesForProject ?? [];
}

export async function listNotificationsForUser(limit?: number, unreadOnly?: boolean): Promise<Notification[]> {
  const result = await getClient().graphql({
    query: ListNotificationsForUser,
    variables: { limit, unreadOnly },
  });
  return (result as { data: { listNotificationsForUser: Notification[] } }).data.listNotificationsForUser ?? [];
}

export async function countUnreadNotifications(): Promise<number> {
  const result = await getClient().graphql({
    query: CountUnreadNotifications,
  });
  return (result as { data: { countUnreadNotifications: number } }).data.countUnreadNotifications ?? 0;
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  const result = await getClient().graphql({
    query: MarkNotificationRead,
    variables: { notificationId },
  });
  const notification = (result as { data: { markNotificationRead: Notification } }).data.markNotificationRead;
  if (!notification) throw new Error('markNotificationRead returned null');
  return notification;
}

export async function markAllNotificationsRead(): Promise<number> {
  const result = await getClient().graphql({
    query: MarkAllNotificationsRead,
  });
  return (result as { data: { markAllNotificationsRead: number } }).data.markAllNotificationsRead ?? 0;
}

// Comment API functions
export async function listCommentsForComponent(componentId: string, limit?: number): Promise<Comment[]> {
  const result = await getClient().graphql({
    query: ListCommentsForComponent,
    variables: { componentId, limit },
  });
  extractGraphQLError(result, 'listCommentsForComponent');
  return (result as { data: { listCommentsForComponent: Comment[] } }).data.listCommentsForComponent ?? [];
}

export async function createComment(input: CreateCommentInput): Promise<Comment> {
  const result = await getClient().graphql({
    query: CreateComment,
    variables: {
      componentId: input.componentId,
      content: input.content,
      mentions: input.mentions,
    },
  });
  extractGraphQLError(result, 'createComment');
  const comment = (result as { data: { createComment: Comment } }).data.createComment;
  if (!comment) throw new Error('createComment returned null');
  return comment;
}

// Guest comment API functions (IAM auth via Identity Pool)
const GuestListComments = /* GraphQL */ `
  query GuestListComments($guestId: ID!, $componentId: ID!, $limit: Int) {
    guestListComments(guestId: $guestId, componentId: $componentId, limit: $limit) {
      id
      componentId
      projectId
      authorId
      authorType
      authorName
      content
      mentions
      createdAt
    }
  }
`;

const GuestCreateComment = /* GraphQL */ `
  mutation GuestCreateComment($guestId: ID!, $componentId: ID!, $content: String!, $mentions: [String!]) {
    guestCreateComment(guestId: $guestId, componentId: $componentId, content: $content, mentions: $mentions) {
      id
      componentId
      projectId
      authorId
      authorType
      authorName
      content
      mentions
      createdAt
    }
  }
`;

/**
 * List comments for a component as a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestListComments(guestId: string, componentId: string, limit?: number): Promise<Comment[]> {
  const result = await getClient().graphql({
    query: GuestListComments,
    variables: { guestId, componentId, limit },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestListComments');
  return (result as { data: { guestListComments: Comment[] } }).data.guestListComments ?? [];
}

/**
 * Create a comment as a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestCreateComment(guestId: string, componentId: string, content: string, mentions?: string[]): Promise<Comment> {
  const result = await getClient().graphql({
    query: GuestCreateComment,
    variables: { guestId, componentId, content, mentions },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestCreateComment');
  const comment = (result as { data: { guestCreateComment: Comment } }).data.guestCreateComment;
  if (!comment) throw new Error('guestCreateComment returned null');
  return comment;
}

// Guest AI refinement API (IAM auth via Identity Pool)
export type GuestRefineComponentInput = {
  guestId: string;
  componentId: string;
  refinementRequest: string;
};

const GuestRefineComponent = /* GraphQL */ `
  mutation GuestRefineComponent($input: GuestRefineComponentInput!) {
    guestRefineComponent(input: $input) {
      component {
        name
        description
        type
        estimatedHours
        priority
        suggestedDependencies
        parentName
        acceptanceCriteria
      }
      explanation
      suggestedFollowUps
    }
  }
`;

/**
 * Refine a component via AI chat as a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 * Guest must be assigned to the component.
 */
export async function guestRefineComponent(input: GuestRefineComponentInput): Promise<RefineComponentResult> {
  const result = await getClient().graphql({
    query: GuestRefineComponent,
    variables: { input },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestRefineComponent');
  const refined = (result as { data: { guestRefineComponent: RefineComponentResult } }).data.guestRefineComponent;
  if (!refined) throw new Error('guestRefineComponent returned null');
  return refined;
}

// Guest update component (apply AI refinement)
export type GuestUpdateComponentInput = {
  guestId: string;
  componentId: string;
  name?: string;
  description?: string;
  type?: ComponentType;
  estimatedHours?: number;
  priority?: number;
  acceptanceCriteria?: string[];
};

const GuestUpdateComponent = /* GraphQL */ `
  mutation GuestUpdateComponent($input: GuestUpdateComponentInput!) {
    guestUpdateComponent(input: $input) {
      id
      name
      description
      type
      projectId
      parentId
      sprintId
      status
      priority
      estimatedHours
      actualHours
      dueDate
      owner
      tags
      createdAt
      updatedAt
    }
  }
`;

/**
 * Update a component as a guest (IAM auth).
 * Used to apply AI refinement suggestions.
 * guestId must match the caller's Cognito Identity ID.
 * Guest must be assigned to the component.
 */
export async function guestUpdateComponent(input: GuestUpdateComponentInput): Promise<Component> {
  const result = await getClient().graphql({
    query: GuestUpdateComponent,
    variables: { input },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestUpdateComponent');
  const component = (result as { data: { guestUpdateComponent: Component } }).data.guestUpdateComponent;
  if (!component) throw new Error('guestUpdateComponent returned null');
  return component;
}

// @mentions autocomplete API
const SearchTeamMembersForMention = /* GraphQL */ `
  query SearchTeamMembersForMention($teamId: ID!, $query: String!) {
    searchTeamMembersForMention(teamId: $teamId, query: $query) {
      id
      name
      isGuest
    }
  }
`;

/**
 * Search team members for @mention autocomplete.
 * Returns users and guests matching the query string.
 */
export async function searchTeamMembersForMention(teamId: string, query: string): Promise<TeamMemberSuggestion[]> {
  const result = await getClient().graphql({
    query: SearchTeamMembersForMention,
    variables: { teamId, query },
  });
  extractGraphQLError(result, 'searchTeamMembersForMention');
  return (result as { data: { searchTeamMembersForMention: TeamMemberSuggestion[] } }).data.searchTeamMembersForMention ?? [];
}

// Guest notification API (IAM auth via Identity Pool)
const GuestListNotifications = /* GraphQL */ `
  query GuestListNotifications($guestId: ID!, $limit: Int) {
    guestListNotifications(guestId: $guestId, limit: $limit) {
      id
      guestId
      type
      title
      message
      componentId
      projectId
      read
      createdAt
    }
  }
`;

const GuestCountUnreadNotifications = /* GraphQL */ `
  query GuestCountUnreadNotifications($guestId: ID!) {
    guestCountUnreadNotifications(guestId: $guestId)
  }
`;

const GuestMarkNotificationRead = /* GraphQL */ `
  mutation GuestMarkNotificationRead($guestId: ID!, $notificationId: ID!) {
    guestMarkNotificationRead(guestId: $guestId, notificationId: $notificationId) {
      id
      guestId
      type
      title
      message
      componentId
      projectId
      read
      createdAt
    }
  }
`;

const GuestMarkAllNotificationsRead = /* GraphQL */ `
  mutation GuestMarkAllNotificationsRead($guestId: ID!) {
    guestMarkAllNotificationsRead(guestId: $guestId)
  }
`;

/**
 * List notifications for a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestListNotifications(guestId: string, limit?: number): Promise<GuestNotification[]> {
  const result = await getClient().graphql({
    query: GuestListNotifications,
    variables: { guestId, limit },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestListNotifications');
  return (result as { data: { guestListNotifications: GuestNotification[] } }).data.guestListNotifications ?? [];
}

/**
 * Count unread notifications for a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestCountUnreadNotifications(guestId: string): Promise<number> {
  const result = await getClient().graphql({
    query: GuestCountUnreadNotifications,
    variables: { guestId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestCountUnreadNotifications');
  return (result as { data: { guestCountUnreadNotifications: number } }).data.guestCountUnreadNotifications ?? 0;
}

/**
 * Mark a single notification as read for a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestMarkNotificationRead(guestId: string, notificationId: string): Promise<GuestNotification> {
  const result = await getClient().graphql({
    query: GuestMarkNotificationRead,
    variables: { guestId, notificationId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestMarkNotificationRead');
  const notification = (result as { data: { guestMarkNotificationRead: GuestNotification } }).data.guestMarkNotificationRead;
  if (!notification) throw new Error('guestMarkNotificationRead returned null');
  return notification;
}

/**
 * Mark all notifications as read for a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestMarkAllNotificationsRead(guestId: string): Promise<number> {
  const result = await getClient().graphql({
    query: GuestMarkAllNotificationsRead,
    variables: { guestId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestMarkAllNotificationsRead');
  return (result as { data: { guestMarkAllNotificationsRead: number } }).data.guestMarkAllNotificationsRead ?? 0;
}

// Guest activity feed API (IAM auth via Identity Pool)
export type ActivityWithAuthor = {
  id: string;
  type: ActivityType;
  projectId: string;
  authorId: string;
  authorName?: string | null;
  authorType: AuthorType;
  metadata?: string | null;
  createdAt: string;
};

const GuestListActivityFeed = /* GraphQL */ `
  query GuestListActivityFeed($guestId: ID!, $projectId: ID!, $limit: Int) {
    guestListActivityFeed(guestId: $guestId, projectId: $projectId, limit: $limit) {
      id
      type
      projectId
      authorId
      authorName
      authorType
      metadata
      createdAt
    }
  }
`;

/**
 * List activity feed for a guest (IAM auth).
 * Returns recent activity on the project.
 */
export async function guestListActivityFeed(guestId: string, projectId: string, limit?: number): Promise<ActivityWithAuthor[]> {
  const result = await getClient().graphql({
    query: GuestListActivityFeed,
    variables: { guestId, projectId, limit },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestListActivityFeed');
  return (result as { data: { guestListActivityFeed: ActivityWithAuthor[] } }).data.guestListActivityFeed ?? [];
}

// Phase 9: Workflow Config & Metrics API functions
export async function getTeamWorkflowConfig(teamId: string): Promise<TeamWorkflowConfig | null> {
  const result = await getClient().graphql({
    query: GetTeamWorkflowConfig,
    variables: { teamId },
  });
  extractGraphQLError(result, 'getTeamWorkflowConfig');
  return (result as { data: { getTeamWorkflowConfig: TeamWorkflowConfig | null } }).data.getTeamWorkflowConfig;
}

export async function updateTeamWorkflowConfig(
  teamId: string,
  input: UpdateWorkflowConfigInput
): Promise<TeamWorkflowConfig> {
  const result = await getClient().graphql({
    query: UpdateTeamWorkflowConfig,
    variables: { teamId, input },
  });
  const config = (result as { data: { updateTeamWorkflowConfig: TeamWorkflowConfig } }).data.updateTeamWorkflowConfig;
  if (!config) throw new Error('updateTeamWorkflowConfig returned null');
  return config;
}

export async function getTeamMetrics(teamId: string): Promise<TeamMetrics> {
  const result = await getClient().graphql({
    query: GetTeamMetrics,
    variables: { teamId },
  });
  const metrics = (result as { data: { getTeamMetrics: TeamMetrics } }).data.getTeamMetrics;
  if (!metrics) throw new Error('getTeamMetrics returned null');
  return metrics;
}

export async function getCurrentUserId(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user?.userId ?? null;
  } catch {
    return null;
  }
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const result = await getTeamWithMembers(teamId);
  if (!result) return [];
  return result.members.map((m) => ({
    id: m.id,
    userId: m.userId,
    teamId: m.teamId,
    role: m.role,
    joinedAt: m.joinedAt,
    title: m.title,
  }));
}

export async function deleteTeam(teamId: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: DeleteTeam,
    variables: { teamId },
  });
  return (result as { data: { deleteTeam: boolean } }).data.deleteTeam;
}

/**
 * Register a new user (unauthenticated - uses AdminCreateUser via Lambda)
 * Uses API key auth since the user isn't authenticated yet.
 * AWS Documentation: https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html
 */
export async function registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
  // Use API key auth for unauthenticated registration
  // AWS Documentation: https://docs.amplify.aws/react/build-a-backend/data/connect-to-API/
  const result = await getClient().graphql({
    query: RegisterUser,
    variables: { input },
    authMode: 'apiKey',
  });
  return (result as { data: { registerUser: RegisterUserResult } }).data.registerUser;
}

// Sync user profile from ID token claims after OAuth callback
// AWS Best Practice: Access token (used by AppSync) doesn't contain email/name,
// so we extract from the ID token and sync to DynamoDB
export type SyncUserProfileInput = {
  email: string;
  name: string;
};

export async function syncUserProfile(input: SyncUserProfileInput): Promise<User> {
  const result = await getClient().graphql({
    query: SyncUserProfile,
    variables: { input },
  });
  extractGraphQLError(result, 'syncUserProfile');
  return (result as { data: { syncUserProfile: User } }).data.syncUserProfile;
}

// =============================================================================
// Phase 10: AI Features - Full Parity Types
// =============================================================================

export type GeneratedComponent = {
  name: string;
  description: string;
  type: ComponentType;
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  parentName?: string | null;
  acceptanceCriteria?: string[] | null;
};

export type GeneratedSprint = {
  name: string;
  goal: string;
  durationWeeks: number;
  componentNames: string[];
  capacity?: number | null;
};

export type GeneratedEpic = {
  name: string;
  description: string;
  componentNames: string[];
};

export type FullPlanResult = {
  components: GeneratedComponent[];
  summary: string;
  enhancedDescription?: string | null;
  sprints?: GeneratedSprint[] | null;
  epics?: GeneratedEpic[] | null;
};

export type GenerateFullPlanInput = {
  projectId: string;
  generateEpics?: boolean | null;
};

export type ApplyFullPlanInput = {
  projectId: string;
  components: GeneratedComponent[];
  enhancedDescription?: string | null;
  sprints?: GeneratedSprint[] | null;
  epics?: GeneratedEpic[] | null;
};

export type ApplyPlanResult = {
  created: number;
  dependencies: number;
  sprints: number;
  epics: number;
  componentIds: string[];
  sprintIds: string[];
};

// =============================================================================
// Phase 10: AI Features - GraphQL Mutations
// =============================================================================

const GenerateFullPlan = /* GraphQL */ `
  mutation GenerateFullPlan($input: GenerateFullPlanInput!) {
    generateFullPlan(input: $input) {
      components {
        name
        description
        type
        estimatedHours
        priority
        suggestedDependencies
        parentName
        acceptanceCriteria
      }
      summary
      enhancedDescription
      sprints {
        name
        goal
        durationWeeks
        componentNames
        capacity
      }
      epics {
        name
        description
        componentNames
      }
    }
  }
`;

const ApplyFullPlan = /* GraphQL */ `
  mutation ApplyFullPlan($input: ApplyFullPlanInput!) {
    applyFullPlan(input: $input) {
      created
      dependencies
      sprints
      epics
      componentIds
      sprintIds
    }
  }
`;

// =============================================================================
// Phase 10: AI Features - API Functions
// =============================================================================

/**
 * Generate a full plan using AI with workflow awareness.
 * Fetches project context, team workflow config, and team capacity.
 * Returns structured components with optional sprints and epics.
 */
export async function generateFullPlan(input: GenerateFullPlanInput): Promise<FullPlanResult> {
  const result = await getClient().graphql({
    query: GenerateFullPlan,
    variables: { input },
  });
  extractGraphQLError(result, 'generateFullPlan');
  const plan = (result as { data: { generateFullPlan: FullPlanResult } }).data.generateFullPlan;
  if (!plan) throw new Error('generateFullPlan returned null');
  return plan;
}

/**
 * Apply a generated plan atomically to the database.
 * Creates components, dependencies, sprints, and assigns sprint membership.
 * Uses saga pattern for operations exceeding 25-item DynamoDB transaction limit.
 */
export async function applyFullPlan(input: ApplyFullPlanInput): Promise<ApplyPlanResult> {
  const result = await getClient().graphql({
    query: ApplyFullPlan,
    variables: { input },
  });
  extractGraphQLError(result, 'applyFullPlan');
  const applied = (result as { data: { applyFullPlan: ApplyPlanResult } }).data.applyFullPlan;
  if (!applied) throw new Error('applyFullPlan returned null');
  return applied;
}

// =============================================================================
// Phase 10.3-10.5: Additional AI Features Types
// =============================================================================

export type NaturalLanguageComponent = {
  name: string;
  description: string;
  type: ComponentType;
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  reasoning: string;
  acceptanceCriteria?: string[] | null;
};

export type RefineComponentInput = {
  projectId: string;
  currentComponent: NaturalLanguageComponent;
  refinementRequest: string;
};

export type RefineComponentResult = {
  component: GeneratedComponent;
  explanation: string;
  suggestedFollowUps: string[];
};

export type CurrentPlan = {
  components: GeneratedComponent[];
  sprints?: GeneratedSprint[] | null;
  epics?: GeneratedEpic[] | null;
};

export type RefineBulkPlanInput = {
  projectId: string;
  currentPlan: CurrentPlan;
  refinementRequest: string;
};

export type ChangedItem = {
  type: string;
  name: string;
  change: string;
};

export type RefineBulkPlanResult = {
  components: GeneratedComponent[];
  sprints?: GeneratedSprint[] | null;
  epics?: GeneratedEpic[] | null;
  explanation: string;
  changedItems: ChangedItem[];
  suggestedFollowUps: string[];
};

export type SmartComponentInput = {
  projectId: string;
  userInput: string;
  parentComponentId?: string | null;
};

export type SmartComponentResult = {
  component: GeneratedComponent;
  reasoning: string;
  suggestedFollowUps: string[];
};

export type PlanSprintInput = {
  teamId: string;
  sprintId?: string | null;
  capacityHours: number;
};

export type SprintPlanResult = {
  selectedComponentIds: string[];
  totalHours: number;
  reasoning: string;
  warnings: string[];
};

// =============================================================================
// Phase 1-5: Additional AI Features Types
// =============================================================================

// Phase 1: Template Application
export type ComponentTemplateType =
  | 'CRUD_FEATURE'
  | 'REST_API'
  | 'USER_AUTH'
  | 'FORM_WITH_VALIDATION'
  | 'DATA_DASHBOARD'
  | 'FILE_UPLOAD'
  | 'SEARCH_FILTER'
  | 'NOTIFICATION_SYSTEM'
  | 'PAYMENT_INTEGRATION'
  | 'ADMIN_PANEL';

export type ApplyTemplateInput = {
  template: ComponentTemplateType;
  entityName: string;
  projectName: string;
  projectId: string;
  additionalRequirements?: string | null;
};

export type TemplateComponentOutput = {
  name: string;
  description: string;
  type: ComponentType;
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
};

export type ApplyTemplateResult = {
  components: TemplateComponentOutput[];
  implementationNotes: string;
  techStackRecommendations?: string | null;
};

// Phase 2: Component Breakdown
export type SuggestBreakdownInput = {
  componentId: string;
  projectId: string;
};

export type BreakdownSuggestion = {
  name: string;
  description: string;
  type: ComponentType;
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  acceptanceCriteria?: string[] | null;
};

export type SuggestBreakdownResult = {
  suggestions: BreakdownSuggestion[];
  reasoning: string;
  recommendedApproach: string;
};

// Phase 3: Wireframe Generation
export type GenerateWireframeInput = {
  componentId: string;
};

export type GenerateWireframeResult = {
  html: string;
  componentName: string;
};

// Phase 4: Import Analysis
export type AnalyzeImportInput = {
  headers: string[];
  sampleRows: string[];
  projectId: string;
};

export type ColumnMappingOutput = {
  sourceColumn: string;
  targetField: string | null;
  confidence: number;
};

export type AnalyzeImportResult = {
  mappings: ColumnMappingOutput[];
  detectedFormat: string;
  suggestions: string[];
  warnings: string[];
};

export type ColumnMappingInput = {
  sourceColumn: string;
  targetField: string | null;
};

export type CleanupImportInput = {
  rows: string[];
  mappings: ColumnMappingInput[];
};

export type CleanedRowOutput = {
  original: string;
  cleaned: string;
  changes: string[];
};

export type CleanupImportResult = {
  rows: CleanedRowOutput[];
  summary: string;
  totalChanges: number;
};

// Phase 5: Retrospective Generation
export type GenerateRetrospectiveInput = {
  sprintId: string;
  applyAdjustments?: boolean | null;
};

export type EstimationInsights = {
  estimationAccuracy: string;
  velocityTrend: string;
  recommendations: string[];
};

export type AdjustedEstimate = {
  componentId: string;
  componentName: string;
  originalEstimate: number;
  adjustedEstimate: number;
  reasoning: string;
};

export type GenerateRetrospectiveResult = {
  summary: string;
  insights: EstimationInsights;
  adjustedEstimates: AdjustedEstimate[];
  suggestedActions: string[];
  adjustmentsApplied: boolean;
};

// =============================================================================
// Phase 10.3-10.5: Additional AI Features GraphQL Mutations
// =============================================================================

const RefineComponent = /* GraphQL */ `
  mutation RefineComponent($input: RefineComponentInput!) {
    refineComponent(input: $input) {
      component {
        name
        description
        type
        estimatedHours
        priority
        suggestedDependencies
        parentName
        acceptanceCriteria
      }
      explanation
      suggestedFollowUps
    }
  }
`;

const RefineBulkPlan = /* GraphQL */ `
  mutation RefineBulkPlan($input: RefineBulkPlanInput!) {
    refineBulkPlan(input: $input) {
      components {
        name
        description
        type
        estimatedHours
        priority
        suggestedDependencies
        parentName
        acceptanceCriteria
      }
      sprints {
        name
        goal
        durationWeeks
        componentNames
        capacity
      }
      epics {
        name
        description
        componentNames
      }
      explanation
      changedItems {
        type
        name
        change
      }
      suggestedFollowUps
    }
  }
`;

const CreateSmartComponent = /* GraphQL */ `
  mutation CreateSmartComponent($input: SmartComponentInput!) {
    createSmartComponent(input: $input) {
      component {
        name
        description
        type
        estimatedHours
        priority
        suggestedDependencies
        parentName
        acceptanceCriteria
      }
      reasoning
      suggestedFollowUps
    }
  }
`;

const PlanSprint = /* GraphQL */ `
  mutation PlanSprint($input: PlanSprintInput!) {
    planSprint(input: $input) {
      selectedComponentIds
      totalHours
      reasoning
      warnings
    }
  }
`;

// =============================================================================
// Phase 10.3-10.5: Additional AI Features API Functions
// =============================================================================

/**
 * Refine a single component via conversational chat.
 * Updates the component based on user feedback.
 */
export async function refineComponent(input: RefineComponentInput): Promise<RefineComponentResult> {
  const result = await getClient().graphql({
    query: RefineComponent,
    variables: { input },
  });
  extractGraphQLError(result, 'refineComponent');
  const refined = (result as { data: { refineComponent: RefineComponentResult } }).data.refineComponent;
  if (!refined) throw new Error('refineComponent returned null');
  return refined;
}

/**
 * Refine an entire plan via conversational chat.
 * Updates components, sprints, and epics based on user feedback.
 */
export async function refineBulkPlan(input: RefineBulkPlanInput): Promise<RefineBulkPlanResult> {
  const result = await getClient().graphql({
    query: RefineBulkPlan,
    variables: { input },
  });
  extractGraphQLError(result, 'refineBulkPlan');
  const refined = (result as { data: { refineBulkPlan: RefineBulkPlanResult } }).data.refineBulkPlan;
  if (!refined) throw new Error('refineBulkPlan returned null');
  return refined;
}

/**
 * Create a structured component from natural language input.
 * Returns a preview that can be refined before saving.
 */
export async function createSmartComponent(input: SmartComponentInput): Promise<SmartComponentResult> {
  const result = await getClient().graphql({
    query: CreateSmartComponent,
    variables: { input },
  });
  extractGraphQLError(result, 'createSmartComponent');
  const smart = (result as { data: { createSmartComponent: SmartComponentResult } }).data.createSmartComponent;
  if (!smart) throw new Error('createSmartComponent returned null');
  return smart;
}

/**
 * AI-powered sprint planning.
 * Suggests which backlog components to include based on capacity, priorities, and dependencies.
 */
export async function planSprint(input: PlanSprintInput): Promise<SprintPlanResult> {
  const result = await getClient().graphql({
    query: PlanSprint,
    variables: { input },
  });
  extractGraphQLError(result, 'planSprint');
  const plan = (result as { data: { planSprint: SprintPlanResult } }).data.planSprint;
  if (!plan) throw new Error('planSprint returned null');
  return plan;
}

// =============================================================================
// Phase 1-5: Additional AI Features GraphQL Mutations
// =============================================================================

const ApplyTemplate = /* GraphQL */ `
  mutation ApplyTemplate($input: ApplyTemplateInput!) {
    applyTemplate(input: $input) {
      components {
        name
        description
        type
        estimatedHours
        priority
        suggestedDependencies
      }
      implementationNotes
      techStackRecommendations
    }
  }
`;

const SuggestBreakdown = /* GraphQL */ `
  mutation SuggestBreakdown($input: SuggestBreakdownInput!) {
    suggestBreakdown(input: $input) {
      suggestions {
        name
        description
        type
        estimatedHours
        priority
        suggestedDependencies
        acceptanceCriteria
      }
      reasoning
      recommendedApproach
    }
  }
`;

const GenerateWireframe = /* GraphQL */ `
  mutation GenerateWireframe($input: GenerateWireframeInput!) {
    generateWireframe(input: $input) {
      html
      componentName
    }
  }
`;

const AnalyzeImport = /* GraphQL */ `
  mutation AnalyzeImport($input: AnalyzeImportInput!) {
    analyzeImport(input: $input) {
      mappings {
        sourceColumn
        targetField
        confidence
      }
      detectedFormat
      suggestions
      warnings
    }
  }
`;

const CleanupImport = /* GraphQL */ `
  mutation CleanupImport($input: CleanupImportInput!) {
    cleanupImport(input: $input) {
      rows {
        original
        cleaned
        changes
      }
      summary
      totalChanges
    }
  }
`;

const GenerateRetrospective = /* GraphQL */ `
  mutation GenerateRetrospective($input: GenerateRetrospectiveInput!) {
    generateRetrospective(input: $input) {
      summary
      insights {
        estimationAccuracy
        velocityTrend
        recommendations
      }
      adjustedEstimates {
        componentId
        componentName
        originalEstimate
        adjustedEstimate
        reasoning
      }
      suggestedActions
      adjustmentsApplied
    }
  }
`;

// =============================================================================
// Phase 1-5: Additional AI Features API Functions
// =============================================================================

/**
 * Apply a component template to generate a set of components.
 * Templates provide pre-built patterns for common features like CRUD, auth, etc.
 */
export async function applyTemplate(input: ApplyTemplateInput): Promise<ApplyTemplateResult> {
  const result = await getClient().graphql({
    query: ApplyTemplate,
    variables: { input },
  });
  extractGraphQLError(result, 'applyTemplate');
  const template = (result as { data: { applyTemplate: ApplyTemplateResult } }).data.applyTemplate;
  if (!template) throw new Error('applyTemplate returned null');
  return template;
}

/**
 * Suggest how to break down a component into smaller sub-components.
 * Useful for decomposing large features or epics.
 */
export async function suggestBreakdown(input: SuggestBreakdownInput): Promise<SuggestBreakdownResult> {
  const result = await getClient().graphql({
    query: SuggestBreakdown,
    variables: { input },
  });
  extractGraphQLError(result, 'suggestBreakdown');
  const breakdown = (result as { data: { suggestBreakdown: SuggestBreakdownResult } }).data.suggestBreakdown;
  if (!breakdown) throw new Error('suggestBreakdown returned null');
  return breakdown;
}

/**
 * Generate an HTML wireframe for a UI component.
 * Returns static HTML that can be previewed.
 */
export async function generateWireframe(input: GenerateWireframeInput): Promise<GenerateWireframeResult> {
  const result = await getClient().graphql({
    query: GenerateWireframe,
    variables: { input },
  });
  extractGraphQLError(result, 'generateWireframe');
  const wireframe = (result as { data: { generateWireframe: GenerateWireframeResult } }).data.generateWireframe;
  if (!wireframe) throw new Error('generateWireframe returned null');
  return wireframe;
}

/**
 * Analyze import data to detect column mappings and format.
 * Provides suggestions for mapping CSV/spreadsheet columns to component fields.
 */
export async function analyzeImport(input: AnalyzeImportInput): Promise<AnalyzeImportResult> {
  const result = await getClient().graphql({
    query: AnalyzeImport,
    variables: { input },
  });
  extractGraphQLError(result, 'analyzeImport');
  const analysis = (result as { data: { analyzeImport: AnalyzeImportResult } }).data.analyzeImport;
  if (!analysis) throw new Error('analyzeImport returned null');
  return analysis;
}

/**
 * Clean up import data based on provided mappings.
 * Normalizes and transforms rows for import.
 */
export async function cleanupImport(input: CleanupImportInput): Promise<CleanupImportResult> {
  const result = await getClient().graphql({
    query: CleanupImport,
    variables: { input },
  });
  extractGraphQLError(result, 'cleanupImport');
  const cleanup = (result as { data: { cleanupImport: CleanupImportResult } }).data.cleanupImport;
  if (!cleanup) throw new Error('cleanupImport returned null');
  return cleanup;
}

/**
 * Generate a sprint retrospective with insights and estimation adjustments.
 * Analyzes completed sprint data to provide actionable recommendations.
 */
export async function generateRetrospective(input: GenerateRetrospectiveInput): Promise<GenerateRetrospectiveResult> {
  const result = await getClient().graphql({
    query: GenerateRetrospective,
    variables: { input },
  });
  extractGraphQLError(result, 'generateRetrospective');
  const retro = (result as { data: { generateRetrospective: GenerateRetrospectiveResult } }).data.generateRetrospective;
  if (!retro) throw new Error('generateRetrospective returned null');
  return retro;
}

// =============================================================================
// Async AI Generation API Functions
// =============================================================================

/**
 * Start async AI generation. Returns sessionId immediately.
 * Client should subscribe to onAIProgress to receive progress updates.
 */
export async function startAIGeneration(input: StartAIGenerationInput): Promise<AIJob> {
  const result = await getClient().graphql({
    query: StartAIGeneration,
    variables: { input },
  });
  extractGraphQLError(result, 'startAIGeneration');
  const job = (result as { data: { startAIGeneration: AIJob } }).data.startAIGeneration;
  if (!job) throw new Error('startAIGeneration returned null');
  return job;
}

/**
 * Subscribe to AI progress updates for a given sessionId.
 * Returns an object with subscribe() method that accepts next/error callbacks.
 */
export function subscribeToAIProgress(
  sessionId: string,
  onProgress: (progress: AIProgress) => void,
  onError?: (error: Error) => void
): { unsubscribe: () => void } {
  const subscription = getClient().graphql({
    query: OnAIProgress,
    variables: { sessionId },
  });

  // Amplify v6 returns an observable-like object
  const sub = (subscription as { subscribe: (opts: { next: (data: { data: { onAIProgress: AIProgress } }) => void; error: (err: Error) => void }) => { unsubscribe: () => void } }).subscribe({
    next: (data) => {
      const progress = data?.data?.onAIProgress;
      if (progress) {
        onProgress(progress);
      }
    },
    error: (err) => {
      console.error('[subscribeToAIProgress] Subscription error:', err);
      onError?.(err);
    },
  });

  return { unsubscribe: () => sub.unsubscribe() };
}

// ============================================
// Share Code API Functions
// ============================================

export type ShareCode = {
  code: string;
  projectId: string;
  projectName?: string | null;
  teamId: string;
  teamName?: string | null;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
};

export type ShareCodeInfo = {
  valid: boolean;
  projectId?: string | null;
  projectName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  expiresAt?: string | null;
};

export type GuestSession = {
  guestId: string;
  displayName: string;
  projectId: string;
  projectName?: string | null;
  teamId: string;
  teamName?: string | null;
};

export type GenerateShareCodeInput = {
  projectId: string;
  projectName?: string;
  teamId?: string;
  teamName?: string;
  expiresInHours?: number;
};

export type GuestJoinInput = {
  code: string;
  displayName: string;
};

// GraphQL queries and mutations for share codes
const ValidateShareCode = /* GraphQL */ `
  query ValidateShareCode($code: String!) {
    validateShareCode(code: $code) {
      valid
      projectId
      projectName
      teamId
      teamName
      expiresAt
    }
  }
`;

const GenerateShareCode = /* GraphQL */ `
  mutation GenerateShareCode($input: GenerateShareCodeInput!) {
    generateShareCode(input: $input) {
      code
      projectId
      projectName
      teamId
      teamName
      expiresAt
      createdAt
      createdBy
    }
  }
`;

const RevokeShareCode = /* GraphQL */ `
  mutation RevokeShareCode($code: String!) {
    revokeShareCode(code: $code)
  }
`;

const ListShareCodesForProject = /* GraphQL */ `
  query ListShareCodesForProject($projectId: ID!) {
    listShareCodesForProject(projectId: $projectId) {
      code
      projectId
      projectName
      teamId
      teamName
      expiresAt
      createdAt
      createdBy
    }
  }
`;

const GuestJoinProject = /* GraphQL */ `
  mutation GuestJoinProject($input: GuestJoinInput!) {
    guestJoinProject(input: $input) {
      guestId
      displayName
      projectId
      projectName
      teamId
      teamName
    }
  }
`;

const GuestGetProject = /* GraphQL */ `
  query GuestGetProject($guestId: ID!, $projectId: ID!) {
    guestGetProject(guestId: $guestId, projectId: $projectId) {
      id
      name
      description
      teamId
      createdAt
      updatedAt
    }
  }
`;

const GuestListComponents = /* GraphQL */ `
  query GuestListComponents($guestId: ID!, $projectId: ID!) {
    guestListComponents(guestId: $guestId, projectId: $projectId) {
      id
      name
      description
      type
      status
      projectId
      parentId
      estimatedHours
      createdAt
      updatedAt
    }
  }
`;

const GuestListAssignments = /* GraphQL */ `
  query GuestListAssignments($guestId: ID!, $projectId: ID!) {
    guestListAssignments(guestId: $guestId, projectId: $projectId) {
      assignment {
        id
        componentId
        userId
        assignedAt
      }
      component {
        id
        name
        status
        type
        projectId
      }
    }
  }
`;

const GuestAssignSelf = /* GraphQL */ `
  mutation GuestAssignSelf($guestId: ID!, $componentId: ID!) {
    guestAssignSelf(guestId: $guestId, componentId: $componentId) {
      id
      componentId
      userId
      assignedAt
    }
  }
`;

const GuestUnassignSelf = /* GraphQL */ `
  mutation GuestUnassignSelf($guestId: ID!, $componentId: ID!) {
    guestUnassignSelf(guestId: $guestId, componentId: $componentId)
  }
`;

const GuestUpdateStatus = /* GraphQL */ `
  mutation GuestUpdateStatus($guestId: ID!, $componentId: ID!, $status: ComponentStatus!) {
    guestUpdateStatus(guestId: $guestId, componentId: $componentId, status: $status) {
      id
      status
      updatedAt
    }
  }
`;

const ListAssignmentsForTeamMember = /* GraphQL */ `
  query ListAssignmentsForTeamMember($teamId: ID!, $userId: ID!) {
    listAssignmentsForTeamMember(teamId: $teamId, userId: $userId) {
      assignment {
        id
        componentId
        userId
        assignedAt
      }
      component {
        id
        name
        description
        status
        type
        projectId
        estimatedHours
      }
    }
  }
`;

/**
 * Validate a share code (unauthenticated - uses API_KEY auth).
 * Returns project/team info if code is valid and not expired.
 */
export async function validateShareCode(code: string): Promise<ShareCodeInfo> {
  const result = await getClient().graphql({
    query: ValidateShareCode,
    variables: { code },
    authMode: 'apiKey',
  });
  extractGraphQLError(result, 'validateShareCode');
  return (result as { data: { validateShareCode: ShareCodeInfo } }).data.validateShareCode;
}

/**
 * Generate a share code for a project (Cognito auth required).
 * Only project owners should call this.
 */
export async function generateShareCode(input: GenerateShareCodeInput): Promise<ShareCode> {
  const result = await getClient().graphql({
    query: GenerateShareCode,
    variables: { input },
  });
  extractGraphQLError(result, 'generateShareCode');
  const code = (result as { data: { generateShareCode: ShareCode } }).data.generateShareCode;
  if (!code) throw new Error('generateShareCode returned null');
  return code;
}

/**
 * Revoke a share code (Cognito auth required).
 * Immediately invalidates the code.
 */
export async function revokeShareCode(code: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: RevokeShareCode,
    variables: { code },
  });
  extractGraphQLError(result, 'revokeShareCode');
  return (result as { data: { revokeShareCode: boolean } }).data.revokeShareCode;
}

/**
 * List all active share codes for a project (Cognito auth required).
 * Used by project owners to manage their share codes.
 */
export async function listShareCodesForProject(projectId: string): Promise<ShareCode[]> {
  const result = await getClient().graphql({
    query: ListShareCodesForProject,
    variables: { projectId },
  });
  extractGraphQLError(result, 'listShareCodesForProject');
  return (result as { data: { listShareCodesForProject: ShareCode[] } }).data.listShareCodesForProject || [];
}

/**
 * Join a project as a guest using a share code (IAM auth via Identity Pool).
 * Creates a guest session and returns guestId for subsequent operations.
 */
export async function guestJoinProject(input: GuestJoinInput): Promise<GuestSession> {
  const result = await getClient().graphql({
    query: GuestJoinProject,
    variables: { input },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestJoinProject');
  const session = (result as { data: { guestJoinProject: GuestSession } }).data.guestJoinProject;
  if (!session) throw new Error('guestJoinProject returned null');
  return session;
}

/**
 * Get project details for a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestGetProject(guestId: string, projectId: string): Promise<Project | null> {
  const result = await getClient().graphql({
    query: GuestGetProject,
    variables: { guestId, projectId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestGetProject');
  return (result as { data: { guestGetProject: Project | null } }).data.guestGetProject;
}

/**
 * List components for a guest's project (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestListComponents(guestId: string, projectId: string): Promise<Component[]> {
  const result = await getClient().graphql({
    query: GuestListComponents,
    variables: { guestId, projectId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestListComponents');
  return (result as { data: { guestListComponents: Component[] } }).data.guestListComponents || [];
}

/**
 * List assignments for a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestListAssignments(guestId: string, projectId: string): Promise<AssignmentWithComponent[]> {
  const result = await getClient().graphql({
    query: GuestListAssignments,
    variables: { guestId, projectId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestListAssignments');
  return (result as { data: { guestListAssignments: AssignmentWithComponent[] } }).data.guestListAssignments || [];
}

/**
 * Self-assign to a component as a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestAssignSelf(guestId: string, componentId: string): Promise<Assignment> {
  const result = await getClient().graphql({
    query: GuestAssignSelf,
    variables: { guestId, componentId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestAssignSelf');
  const assignment = (result as { data: { guestAssignSelf: Assignment } }).data.guestAssignSelf;
  if (!assignment) throw new Error('guestAssignSelf returned null');
  return assignment;
}

/**
 * Unassign self from a component as a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 */
export async function guestUnassignSelf(guestId: string, componentId: string): Promise<boolean> {
  const result = await getClient().graphql({
    query: GuestUnassignSelf,
    variables: { guestId, componentId },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestUnassignSelf');
  return (result as { data: { guestUnassignSelf: boolean } }).data.guestUnassignSelf;
}

/**
 * Update component status as a guest (IAM auth).
 * guestId must match the caller's Cognito Identity ID.
 * Guest must be assigned to the component.
 */
export async function guestUpdateStatus(
  guestId: string, 
  componentId: string, 
  status: ComponentStatus
): Promise<Component> {
  const result = await getClient().graphql({
    query: GuestUpdateStatus,
    variables: { guestId, componentId, status },
    authMode: 'iam',
  });
  extractGraphQLError(result, 'guestUpdateStatus');
  const component = (result as { data: { guestUpdateStatus: Component } }).data.guestUpdateStatus;
  if (!component) throw new Error('guestUpdateStatus returned null');
  return component;
}

/**
 * List assignments for a specific team member (Cognito auth).
 * Used by owners/admins to view member workload.
 */
export async function listAssignmentsForTeamMember(
  teamId: string, 
  userId: string
): Promise<AssignmentWithComponent[]> {
  const result = await getClient().graphql({
    query: ListAssignmentsForTeamMember,
    variables: { teamId, userId },
  });
  extractGraphQLError(result, 'listAssignmentsForTeamMember');
  return (result as { data: { listAssignmentsForTeamMember: AssignmentWithComponent[] } }).data.listAssignmentsForTeamMember || [];
}
