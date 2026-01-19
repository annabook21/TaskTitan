// Demo seed data generator
// Creates realistic sample data for the demo mode experience

import { DEMO_USER, DEMO_TEAM, DEMO_PROJECT, DEMO_SPRINT, DEMO_STORAGE_VERSION } from './constants';
import type { DemoDataStore } from './types';

/**
 * Generate a unique ID for demo entities
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get a date relative to now
 */
function getRelativeDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString();
}

/**
 * Generate the initial demo data store with sample data
 */
export function generateDemoSeedData(): DemoDataStore {
  const now = new Date().toISOString();
  const userId = DEMO_USER.id;
  const teamId = DEMO_TEAM.id;
  const projectId = DEMO_PROJECT.id;
  const sprintId = DEMO_SPRINT.id;

  // Component IDs
  const epicAuthId = 'demo-epic-auth';
  const epicCatalogId = 'demo-epic-catalog';
  const epicCartId = 'demo-epic-cart';
  const featRegistrationId = 'demo-feat-registration';
  const featLoginId = 'demo-feat-login';
  const featProductListId = 'demo-feat-product-list';
  const featProductDetailId = 'demo-feat-product-detail';
  const storySignupFormId = 'demo-story-signup-form';
  const storyEmailVerifyId = 'demo-story-email-verify';
  const taskLoginFormId = 'demo-task-login-form';
  const taskJwtRefreshId = 'demo-task-jwt-refresh';
  const taskPasswordResetId = 'demo-task-password-reset';
  const bugSessionTimeoutId = 'demo-bug-session-timeout';

  return {
    version: DEMO_STORAGE_VERSION,
    lastUpdated: now,

    users: [
      {
        id: userId,
        email: DEMO_USER.email,
        name: DEMO_USER.name,
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
      },
    ],

    teams: [
      {
        id: teamId,
        name: DEMO_TEAM.name,
        description: DEMO_TEAM.description,
        createdAt: now,
        updatedAt: now,
      },
    ],

    memberships: [
      {
        id: 'demo-membership-001',
        userId,
        teamId,
        role: 'OWNER',
        joinedAt: now,
        title: 'Product Owner',
        hoursPerDay: 6,
        availability: 100,
      },
    ],

    projects: [
      {
        id: projectId,
        name: DEMO_PROJECT.name,
        description: DEMO_PROJECT.description,
        teamId,
        ownerId: userId,
        githubRepoUrl: null,
        githubWebhookSecret: null,
        githubPrTargetStatus: 'REVIEW',
        createdAt: now,
        updatedAt: now,
      },
    ],

    components: [
      // Epic: User Authentication
      {
        id: epicAuthId,
        name: 'User Authentication System',
        description:
          'Complete authentication flow including signup, login, password reset, and OAuth integration. This epic covers all user identity management features.',
        type: 'EPIC',
        projectId,
        parentId: null,
        sprintId: null,
        status: 'IN_PROGRESS',
        statusEnteredAt: getRelativeDate(-5),
        priority: 90,
        estimatedHours: 40,
        actualHours: null,
        dueDate: getRelativeDate(14),
        owner: null,
        tags: ['auth', 'security', 'core'],
        externalId: null,
        githubPrUrl: null,
        githubPrStatus: null,
        githubPrNumber: null,
        githubPrTitle: null,
        githubPrUpdatedAt: null,
        contextDecision: 'Using JWT tokens with HTTP-only cookies for session management',
        contextRationale:
          'JWT provides stateless authentication that scales well. HTTP-only cookies prevent XSS attacks from stealing tokens.',
        contextAlternatives: 'Session-based auth with Redis, OAuth-only approach',
        contextLinks: ['https://jwt.io/introduction', 'https://owasp.org/www-community/HttpOnly'],
        contextAiSummary: null,
        contextUpdatedAt: getRelativeDate(-3),
        contextUpdatedBy: userId,
        createdAt: getRelativeDate(-10),
        updatedAt: now,
      },

      // Feature: User Registration (under Auth Epic)
      {
        id: featRegistrationId,
        name: 'User Registration',
        description: 'Email-based registration with validation, email verification, and welcome flow',
        type: 'FEATURE',
        projectId,
        parentId: epicAuthId,
        sprintId,
        status: 'COMPLETED',
        statusEnteredAt: getRelativeDate(-2),
        priority: 85,
        estimatedHours: 12,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['auth', 'onboarding'],
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
        createdAt: getRelativeDate(-9),
        updatedAt: getRelativeDate(-2),
      },

      // Story: Signup Form (under Registration)
      {
        id: storySignupFormId,
        name: 'Create signup form with validation',
        description:
          'Build React component with email, password fields. Include real-time validation and error messages.',
        type: 'STORY',
        projectId,
        parentId: featRegistrationId,
        sprintId,
        status: 'COMPLETED',
        statusEnteredAt: getRelativeDate(-3),
        priority: 80,
        estimatedHours: 4,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['frontend', 'forms'],
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
        createdAt: getRelativeDate(-8),
        updatedAt: getRelativeDate(-3),
      },

      // Story: Email Verification (under Registration)
      {
        id: storyEmailVerifyId,
        name: 'Implement email verification flow',
        description: 'Send verification email on signup, handle verification link clicks, update user status',
        type: 'STORY',
        projectId,
        parentId: featRegistrationId,
        sprintId,
        status: 'COMPLETED',
        statusEnteredAt: getRelativeDate(-2),
        priority: 75,
        estimatedHours: 6,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['backend', 'email'],
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
        createdAt: getRelativeDate(-8),
        updatedAt: getRelativeDate(-2),
      },

      // Feature: Login & Session Management (under Auth Epic)
      {
        id: featLoginId,
        name: 'Login & Session Management',
        description: 'Secure login with JWT tokens, session handling, and automatic token refresh',
        type: 'FEATURE',
        projectId,
        parentId: epicAuthId,
        sprintId,
        status: 'IN_PROGRESS',
        statusEnteredAt: getRelativeDate(-4),
        priority: 80,
        estimatedHours: 16,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['auth', 'security'],
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
        createdAt: getRelativeDate(-9),
        updatedAt: now,
      },

      // Task: Login Form (under Login Feature)
      {
        id: taskLoginFormId,
        name: 'Create login form component',
        description: 'React component with email/password inputs, remember me checkbox, and validation',
        type: 'TASK',
        projectId,
        parentId: featLoginId,
        sprintId,
        status: 'COMPLETED',
        statusEnteredAt: getRelativeDate(-1),
        priority: 75,
        estimatedHours: 4,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['frontend'],
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
        createdAt: getRelativeDate(-7),
        updatedAt: getRelativeDate(-1),
      },

      // Task: JWT Refresh (under Login Feature)
      {
        id: taskJwtRefreshId,
        name: 'Implement JWT token refresh',
        description: 'Background token refresh mechanism to maintain sessions without user interruption',
        type: 'TASK',
        projectId,
        parentId: featLoginId,
        sprintId,
        status: 'IN_PROGRESS',
        statusEnteredAt: getRelativeDate(-1),
        priority: 70,
        estimatedHours: 6,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['backend', 'security'],
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
        createdAt: getRelativeDate(-6),
        updatedAt: now,
      },

      // Task: Password Reset (under Login Feature)
      {
        id: taskPasswordResetId,
        name: 'Add password reset functionality',
        description: 'Forgot password flow with email link, reset form, and confirmation',
        type: 'TASK',
        projectId,
        parentId: featLoginId,
        sprintId: null,
        status: 'PLANNING',
        statusEnteredAt: getRelativeDate(-5),
        priority: 65,
        estimatedHours: 5,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['backend', 'email'],
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
        createdAt: getRelativeDate(-5),
        updatedAt: getRelativeDate(-5),
      },

      // Bug: Session Timeout (under Login Feature)
      {
        id: bugSessionTimeoutId,
        name: 'Fix session timeout not redirecting to login',
        description:
          'When JWT expires, users see a blank page instead of being redirected to login. Need to handle 401 responses globally.',
        type: 'BUG',
        projectId,
        parentId: featLoginId,
        sprintId,
        status: 'REVIEW',
        statusEnteredAt: getRelativeDate(0),
        priority: 85,
        estimatedHours: 2,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['bug', 'ux'],
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
        createdAt: getRelativeDate(-2),
        updatedAt: now,
      },

      // Epic: Product Catalog
      {
        id: epicCatalogId,
        name: 'Product Catalog',
        description: 'Product listing, search, filtering, categories, and detail pages with rich media support',
        type: 'EPIC',
        projectId,
        parentId: null,
        sprintId: null,
        status: 'PLANNING',
        statusEnteredAt: getRelativeDate(-3),
        priority: 70,
        estimatedHours: 60,
        actualHours: null,
        dueDate: getRelativeDate(30),
        owner: null,
        tags: ['catalog', 'search'],
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
        createdAt: getRelativeDate(-8),
        updatedAt: getRelativeDate(-3),
      },

      // Feature: Product List (under Catalog Epic)
      {
        id: featProductListId,
        name: 'Product Listing Page',
        description: 'Grid/list view of products with pagination, sorting, and filtering options',
        type: 'FEATURE',
        projectId,
        parentId: epicCatalogId,
        sprintId: null,
        status: 'PLANNING',
        statusEnteredAt: getRelativeDate(-3),
        priority: 65,
        estimatedHours: 20,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['frontend', 'catalog'],
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
        createdAt: getRelativeDate(-7),
        updatedAt: getRelativeDate(-3),
      },

      // Feature: Product Detail (under Catalog Epic)
      {
        id: featProductDetailId,
        name: 'Product Detail Page',
        description: 'Rich product page with images, descriptions, specifications, reviews, and add-to-cart',
        type: 'FEATURE',
        projectId,
        parentId: epicCatalogId,
        sprintId: null,
        status: 'PLANNING',
        statusEnteredAt: getRelativeDate(-3),
        priority: 60,
        estimatedHours: 24,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['frontend', 'catalog'],
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
        createdAt: getRelativeDate(-7),
        updatedAt: getRelativeDate(-3),
      },

      // Epic: Shopping Cart
      {
        id: epicCartId,
        name: 'Shopping Cart & Checkout',
        description: 'Shopping cart management, checkout flow, payment integration, and order confirmation',
        type: 'EPIC',
        projectId,
        parentId: null,
        sprintId: null,
        status: 'PLANNING',
        statusEnteredAt: getRelativeDate(-8),
        priority: 50,
        estimatedHours: 80,
        actualHours: null,
        dueDate: null,
        owner: null,
        tags: ['cart', 'checkout', 'payments'],
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
        createdAt: getRelativeDate(-8),
        updatedAt: getRelativeDate(-8),
      },
    ],

    dependencies: [
      // Login depends on Registration being complete
      {
        id: 'demo-dep-001',
        dependentComponentId: featLoginId,
        requiredComponentId: featRegistrationId,
        description: 'Login requires user registration to exist',
        createdAt: getRelativeDate(-9),
      },
      // Product Detail depends on Product List
      {
        id: 'demo-dep-002',
        dependentComponentId: featProductDetailId,
        requiredComponentId: featProductListId,
        description: 'Detail page navigation from list page',
        createdAt: getRelativeDate(-7),
      },
      // Shopping Cart depends on Product Catalog
      {
        id: 'demo-dep-003',
        dependentComponentId: epicCartId,
        requiredComponentId: epicCatalogId,
        description: 'Cart requires products to add',
        createdAt: getRelativeDate(-8),
      },
    ],

    assignments: [
      // Demo user assigned to JWT refresh task
      {
        id: 'demo-assign-001',
        componentId: taskJwtRefreshId,
        userId,
        assignedAt: getRelativeDate(-1),
      },
      // Demo user assigned to the bug
      {
        id: 'demo-assign-002',
        componentId: bugSessionTimeoutId,
        userId,
        assignedAt: getRelativeDate(-1),
      },
    ],

    sprints: [
      {
        id: sprintId,
        name: DEMO_SPRINT.name,
        goal: DEMO_SPRINT.goal,
        teamId,
        startDate: getRelativeDate(-7),
        endDate: getRelativeDate(7),
        status: 'ACTIVE',
        capacity: 40,
        createdAt: getRelativeDate(-7),
        updatedAt: now,
      },
    ],

    activities: [
      {
        id: 'demo-activity-001',
        type: 'PROJECT_CREATED',
        projectId,
        userId,
        metadata: { projectName: DEMO_PROJECT.name },
        createdAt: getRelativeDate(-10),
      },
      {
        id: 'demo-activity-002',
        type: 'COMPONENT_CREATED',
        projectId,
        userId,
        metadata: { componentName: 'User Authentication System', componentType: 'EPIC' },
        createdAt: getRelativeDate(-10),
      },
      {
        id: 'demo-activity-003',
        type: 'SPRINT_STARTED',
        projectId,
        userId,
        metadata: { sprintName: DEMO_SPRINT.name },
        createdAt: getRelativeDate(-7),
      },
      {
        id: 'demo-activity-004',
        type: 'COMPONENT_STATUS_CHANGED',
        projectId,
        userId,
        metadata: {
          componentName: 'User Registration',
          oldStatus: 'IN_PROGRESS',
          newStatus: 'COMPLETED',
        },
        createdAt: getRelativeDate(-2),
      },
      {
        id: 'demo-activity-005',
        type: 'COMPONENT_STATUS_CHANGED',
        projectId,
        userId,
        metadata: {
          componentName: 'Fix session timeout not redirecting to login',
          oldStatus: 'IN_PROGRESS',
          newStatus: 'REVIEW',
        },
        createdAt: now,
      },
    ],

    workflowConfigs: [
      {
        id: 'demo-workflow-001',
        teamId,
        wipLimitPlanning: null,
        wipLimitInProgress: 3,
        wipLimitBlocked: null,
        wipLimitReview: 2,
        cycleEnabled: true,
        cycleDurationWeeks: 2,
        cycleStartDayOfWeek: 1,
        workflowTemplate: 'SCRUM',
        cycleName: 'Sprint',
        backlogName: 'Backlog',
        enforceEstimates: false,
        autoArchiveCompleted: false,
        createdAt: now,
        updatedAt: now,
      },
    ],

    componentPreviews: [],
    statusHistory: [],
  };
}
