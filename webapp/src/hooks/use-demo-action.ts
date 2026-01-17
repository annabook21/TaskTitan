'use client';

// Demo-aware action utilities
// Provides helper functions for handling demo mode in client components

import { useAction, useOptimisticAction } from 'next-safe-action/hooks';
import { useRouter } from 'next/navigation';
import { demoStore, isDemoMode } from '@/lib/demo';

type DemoActionResult = {
  _demo: true;
  _action: string;
  _input: Record<string, unknown>;
};

/**
 * Check if a result is a demo mode marker
 */
export function isDemoResult(data: unknown): data is DemoActionResult {
  return typeof data === 'object' && data !== null && '_demo' in data && (data as DemoActionResult)._demo === true;
}

/**
 * Execute a demo action locally using the demo store
 */
export function executeDemoAction(action: string, input: Record<string, unknown>): unknown {
  switch (action) {
    // Team actions
    case 'createTeam':
      return { team: demoStore.createTeam(input as Parameters<typeof demoStore.createTeam>[0]) };
    case 'updateTeam':
      return { team: demoStore.updateTeam(input.teamId as string, input) };
    case 'deleteTeam':
      return { success: demoStore.deleteTeam(input.teamId as string) };

    // Project actions
    case 'createProject':
      return { project: demoStore.createProject(input as Parameters<typeof demoStore.createProject>[0]) };
    case 'updateProject':
      return { project: demoStore.updateProject(input.projectId as string, input) };
    case 'deleteProject':
      return { success: demoStore.deleteProject(input.projectId as string) };

    // Component actions
    case 'createComponent':
      return { component: demoStore.createComponent(input as Parameters<typeof demoStore.createComponent>[0]) };
    case 'updateComponent':
      return { component: demoStore.updateComponent(input.componentId as string, input) };
    case 'deleteComponent':
      return { success: demoStore.deleteComponent(input.componentId as string) };

    // Sprint actions
    case 'createSprint':
      return { sprint: demoStore.createSprint(input as Parameters<typeof demoStore.createSprint>[0]) };
    case 'updateSprint':
      return { sprint: demoStore.updateSprint(input.sprintId as string, input) };
    case 'deleteSprint':
      return { success: demoStore.deleteSprint(input.sprintId as string) };
    case 'assignComponentToSprint':
      return {
        component: demoStore.assignComponentToSprint(input.componentId as string, (input.sprintId as string) || null),
      };

    // Assignment actions
    case 'assignComponent':
      return {
        assignment: demoStore.addAssignment(input.componentId as string, input.userId as string),
      };
    case 'unassignComponent':
      return {
        success: demoStore.removeAssignment(input.componentId as string, input.userId as string),
      };

    // Dependency actions
    case 'addDependency':
      return {
        dependency: demoStore.addDependency(
          input.dependentComponentId as string,
          input.requiredComponentId as string,
          input.description as string | undefined,
        ),
      };
    case 'removeDependency':
      return {
        success: demoStore.removeDependency(input.dependentComponentId as string, input.requiredComponentId as string),
      };

    // Workflow config actions
    case 'updateWorkflowConfig':
      return {
        config: demoStore.updateWorkflowConfig(input.teamId as string, input),
      };

    // Import actions
    case 'executeImport':
      return executeImportInDemo(input as unknown as ExecuteImportInput);

    // AI generation actions
    case 'generateAIComponents':
      return generateAIComponentsInDemo(input as unknown as GenerateAIComponentsInput);
    case 'applyAIComponents':
      return applyAIComponentsInDemo(input as unknown as ApplyAIComponentsInput);

    default:
      console.warn(`Unknown demo action: ${action}`);
      return { success: true };
  }
}

/**
 * Input type for executeImport demo action
 */
interface ExecuteImportInput {
  teamId: string;
  projectId?: string;
  projectName?: string;
  mappings: Array<{ sourceColumn: string; targetField: string | null }>;
  rows: Record<string, string>[];
  createMissingParents?: boolean;
  autoAssignSprint?: string;
}

/**
 * Execute import in demo mode - creates components in demo store
 */
function executeImportInDemo(input: ExecuteImportInput) {
  const { teamId, projectId, projectName, mappings, rows, createMissingParents, autoAssignSprint } = input;

  // Create or get project
  let targetProjectId = projectId;
  if (!targetProjectId && projectName) {
    const project = demoStore.createProject({
      name: projectName,
      teamId,
      ownerId: 'demo-user',
    });
    targetProjectId = project.id;
  }

  if (!targetProjectId) {
    return { projectId: null, stats: { created: 0, skipped: 0, errors: ['No project specified'], warnings: [] } };
  }

  // Build mapping lookup
  const fieldMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.targetField) {
      fieldMap.set(m.sourceColumn, m.targetField);
    }
  }

  // Helper to get mapped value
  const getValue = (row: Record<string, string>, field: string): string | undefined => {
    for (const [col, target] of fieldMap.entries()) {
      if (target === field && row[col]) {
        return row[col].trim();
      }
    }
    return undefined;
  };

  // Helper to parse type
  const parseType = (value?: string): 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG' => {
    if (!value) return 'TASK';
    const lower = value.toLowerCase();
    if (lower.includes('epic')) return 'EPIC';
    if (lower.includes('feature')) return 'FEATURE';
    if (lower.includes('story')) return 'STORY';
    if (lower.includes('bug')) return 'BUG';
    return 'TASK';
  };

  // Helper to parse status
  const parseStatus = (value?: string): 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED' => {
    if (!value) return 'PLANNING';
    const lower = value.toLowerCase();
    if (lower.includes('progress') || lower.includes('doing')) return 'IN_PROGRESS';
    if (lower.includes('block')) return 'BLOCKED';
    if (lower.includes('review') || lower.includes('testing')) return 'REVIEW';
    if (lower.includes('done') || lower.includes('complete')) return 'COMPLETED';
    return 'PLANNING';
  };

  // Helper to parse priority
  const parsePriority = (value?: string): number => {
    if (!value) return 0;
    const lower = value.toLowerCase();
    if (lower.includes('critical') || lower.includes('highest')) return 5;
    if (lower.includes('high')) return 4;
    if (lower.includes('medium')) return 3;
    if (lower.includes('low')) return 2;
    if (lower.includes('lowest')) return 1;
    const num = parseInt(value, 10);
    if (!isNaN(num)) return Math.min(5, Math.max(0, num));
    return 0;
  };

  const stats = { created: 0, skipped: 0, errors: [] as string[], warnings: [] as string[] };
  const createdItems = new Map<string, string>(); // name -> id
  const seenNames = new Set<string>();

  // First pass: create components without parents
  for (const row of rows) {
    const name = getValue(row, 'name');
    if (!name || seenNames.has(name)) {
      if (!name) stats.warnings.push('Skipped row with no name');
      else stats.warnings.push(`Skipped duplicate: ${name}`);
      stats.skipped++;
      continue;
    }
    seenNames.add(name);

    const parentName = getValue(row, 'parentName');
    if (parentName) continue; // Handle in second pass

    const component = demoStore.createComponent({
      name,
      description: getValue(row, 'description'),
      type: parseType(getValue(row, 'type')),
      status: parseStatus(getValue(row, 'status')),
      priority: parsePriority(getValue(row, 'priority')),
      estimatedHours: getValue(row, 'estimatedHours') ? parseFloat(getValue(row, 'estimatedHours')!) : undefined,
      projectId: targetProjectId!,
      sprintId: autoAssignSprint,
    });

    createdItems.set(name, component.id);
    stats.created++;
  }

  // Create missing parents if needed
  const missingParents = new Set<string>();
  for (const row of rows) {
    const parentName = getValue(row, 'parentName');
    if (parentName && !createdItems.has(parentName)) {
      missingParents.add(parentName);
    }
  }

  if (createMissingParents) {
    for (const parentName of missingParents) {
      const component = demoStore.createComponent({
        name: parentName,
        type: 'EPIC',
        projectId: targetProjectId!,
        sprintId: autoAssignSprint,
      });
      createdItems.set(parentName, component.id);
      stats.created++;
      stats.warnings.push(`Auto-created parent Epic: "${parentName}"`);
    }
  }

  // Second pass: create components with parents
  seenNames.clear();
  for (const row of rows) {
    const name = getValue(row, 'name');
    if (!name || createdItems.has(name)) continue;

    const parentName = getValue(row, 'parentName');
    if (!parentName) continue;

    const parentId = createdItems.get(parentName);

    const component = demoStore.createComponent({
      name,
      description: getValue(row, 'description'),
      type: parseType(getValue(row, 'type')),
      status: parseStatus(getValue(row, 'status')),
      priority: parsePriority(getValue(row, 'priority')),
      estimatedHours: getValue(row, 'estimatedHours') ? parseFloat(getValue(row, 'estimatedHours')!) : undefined,
      projectId: targetProjectId!,
      parentId,
      sprintId: autoAssignSprint,
    });

    createdItems.set(name, component.id);
    stats.created++;
  }

  return { projectId: targetProjectId, stats };
}

/**
 * Input type for generateAIComponents demo action
 */
interface GenerateAIComponentsInput {
  projectId: string;
  generateSprints?: boolean;
}

/**
 * Input type for applyAIComponents demo action
 */
interface ApplyAIComponentsInput {
  projectId: string;
  components: Array<{
    name: string;
    description: string;
    type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
    estimatedHours: number;
    priority: number;
    suggestedDependencies: string[];
    parentName?: string;
  }>;
  enhancedDescription?: string;
  sprints?: Array<{
    name: string;
    goal: string;
    durationWeeks: number;
    componentNames: string[];
    capacity?: number;
  }>;
}

/**
 * Generated component type for demo AI
 */
interface DemoGeneratedComponent {
  name: string;
  description: string;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  parentName?: string;
}

/**
 * Generated sprint type for demo AI
 */
interface DemoGeneratedSprint {
  name: string;
  goal: string;
  durationWeeks: number;
  componentNames: string[];
  capacity?: number;
}

/**
 * Generate AI components in demo mode - creates intelligent suggestions based on project description
 * Respects team workflow configuration (Scrum vs Kanban vs custom)
 */
function generateAIComponentsInDemo(input: GenerateAIComponentsInput) {
  const { projectId, generateSprints } = input;

  const store = demoStore.getStore();
  const project = store.projects.find((p) => p.id === projectId);

  if (!project) {
    return { components: [], summary: 'Project not found', sprints: [] };
  }

  // Get team's workflow config to respect workflow mode
  const workflowConfig = store.workflowConfigs.find((w) => w.teamId === project.teamId);
  const cycleEnabled = workflowConfig?.cycleEnabled ?? true; // Default to Scrum if not configured
  const cycleName = workflowConfig?.cycleName || 'Sprint';

  const description = project.description || project.name;
  const components: DemoGeneratedComponent[] = [];
  const sprints: DemoGeneratedSprint[] = [];

  // Analyze description for keywords to generate relevant components
  const descLower = description.toLowerCase();

  // Common project patterns and their components - with detailed descriptions like production AI
  const patterns = [
    {
      keywords: ['auth', 'login', 'signup', 'user', 'account', 'password', 'oauth'],
      epic: 'User Authentication System',
      epicDesc:
        'Complete authentication infrastructure including secure user registration, login flows, password management, and session handling. Implements industry-standard security practices with JWT tokens, secure cookie handling, and protection against common attack vectors.',
      features: [
        {
          name: 'User Registration Flow',
          desc: 'Implement a complete user registration experience with email validation, password strength requirements, terms acceptance, and optional social sign-up integration. Includes duplicate email detection, rate limiting for abuse prevention, and welcome email automation.',
          hours: 16,
          priority: 5,
        },
        {
          name: 'Secure Login System',
          desc: 'Build a robust login system with email/password authentication, remember-me functionality, and failed attempt tracking. Includes brute-force protection, CAPTCHA integration after multiple failures, and audit logging for security compliance.',
          hours: 12,
          priority: 5,
        },
        {
          name: 'Password Reset & Recovery',
          desc: 'Implement a secure password reset flow with time-limited tokens, email verification, and password history checking. Includes security questions as backup, account recovery options, and notification of password changes to the user.',
          hours: 8,
          priority: 4,
        },
        {
          name: 'Session & Token Management',
          desc: 'Handle user sessions with JWT tokens, automatic refresh logic, and secure logout. Implements token rotation, concurrent session limits, forced logout capability, and session activity tracking for security auditing.',
          hours: 8,
          priority: 4,
        },
      ],
    },
    {
      keywords: ['ecommerce', 'shop', 'product', 'cart', 'checkout', 'payment', 'store', 'buy'],
      epic: 'E-Commerce Platform',
      epicDesc:
        'Full-featured e-commerce solution with product management, shopping cart, secure checkout, and payment processing. Designed for scalability, conversion optimization, and seamless customer experience across devices.',
      features: [
        {
          name: 'Product Catalog System',
          desc: 'Build a comprehensive product catalog with categories, filtering, search, and sorting capabilities. Includes product variants (size, color), inventory tracking, rich media galleries, and SEO-optimized product pages with structured data.',
          hours: 20,
          priority: 5,
        },
        {
          name: 'Shopping Cart Experience',
          desc: 'Create an intuitive shopping cart with add/remove items, quantity updates, saved for later, and persistent cart across sessions. Includes mini-cart preview, stock validation, price calculations with taxes, and abandoned cart recovery.',
          hours: 16,
          priority: 5,
        },
        {
          name: 'Multi-Step Checkout Flow',
          desc: 'Design a streamlined checkout process with address collection, shipping options, order review, and confirmation. Implements guest checkout option, address validation, promo code support, and order summary with itemized totals.',
          hours: 24,
          priority: 5,
        },
        {
          name: 'Payment Gateway Integration',
          desc: 'Integrate Stripe/PayPal for secure payment processing with PCI compliance. Includes credit card handling, saved payment methods, payment verification, refund processing, and receipt generation with email confirmation.',
          hours: 20,
          priority: 4,
        },
        {
          name: 'Order History & Tracking',
          desc: 'Provide customers with complete order history, status tracking, and reorder functionality. Includes order details view, tracking number integration, delivery notifications, and invoice/receipt downloads.',
          hours: 12,
          priority: 3,
        },
      ],
    },
    {
      keywords: ['dashboard', 'admin', 'analytics', 'report', 'metrics', 'chart'],
      epic: 'Analytics Dashboard',
      epicDesc:
        'Comprehensive analytics platform providing actionable insights through interactive visualizations, customizable reports, and real-time data monitoring. Enables data-driven decision making with intuitive interfaces.',
      features: [
        {
          name: 'Dashboard Overview',
          desc: 'Create a customizable dashboard homepage with key performance indicators, trend indicators, and quick-glance widgets. Includes configurable layouts, date range selectors, comparison periods, and personalized metric preferences.',
          hours: 16,
          priority: 5,
        },
        {
          name: 'Interactive Data Visualization',
          desc: 'Implement rich charting capabilities with line graphs, bar charts, pie charts, and heatmaps. Includes drill-down functionality, tooltips with detailed data, chart animations, and responsive design for all screen sizes.',
          hours: 20,
          priority: 4,
        },
        {
          name: 'Report Generation Engine',
          desc: 'Build a flexible reporting system with customizable templates, scheduled generation, and multi-format export (PDF, Excel, CSV). Includes report builder UI, parameter selection, and automated email distribution.',
          hours: 12,
          priority: 3,
        },
        {
          name: 'Real-time Data Updates',
          desc: 'Implement WebSocket-based live data refresh with configurable update intervals. Includes visual indicators for data freshness, automatic reconnection handling, and selective component updates for performance.',
          hours: 16,
          priority: 3,
        },
      ],
    },
    {
      keywords: ['api', 'backend', 'server', 'rest', 'graphql', 'endpoint'],
      epic: 'API Development',
      epicDesc:
        'Robust API infrastructure with well-designed endpoints, comprehensive documentation, and production-ready security. Built for scalability, maintainability, and developer experience.',
      features: [
        {
          name: 'API Architecture & Design',
          desc: 'Design a clean, consistent API structure following REST or GraphQL best practices. Includes resource modeling, URL conventions, HTTP method usage, response formats, error handling patterns, and versioning strategy.',
          hours: 16,
          priority: 5,
        },
        {
          name: 'Authentication & Authorization Middleware',
          desc: 'Implement secure API authentication with JWT validation, API key support, and role-based access control. Includes permission checking, token validation, and integration with identity providers.',
          hours: 12,
          priority: 5,
        },
        {
          name: 'Rate Limiting & Throttling',
          desc: 'Protect API from abuse with configurable rate limits per endpoint, user, or API key. Includes quota tracking, graceful degradation, retry-after headers, and usage analytics for capacity planning.',
          hours: 8,
          priority: 4,
        },
        {
          name: 'API Documentation Portal',
          desc: 'Create comprehensive API documentation with OpenAPI/Swagger specification. Includes interactive API explorer, code samples in multiple languages, authentication guides, and changelog tracking.',
          hours: 8,
          priority: 3,
        },
      ],
    },
    {
      keywords: ['mobile', 'app', 'ios', 'android', 'react native', 'flutter'],
      epic: 'Mobile Application',
      epicDesc:
        'Cross-platform mobile application with native-like performance, offline capabilities, and engaging user experience. Optimized for both iOS and Android with shared codebase efficiency.',
      features: [
        {
          name: 'Mobile App Foundation',
          desc: 'Set up the mobile application architecture with component structure, state management, and API integration layer. Includes theming system, asset management, environment configuration, and build pipeline setup.',
          hours: 20,
          priority: 5,
        },
        {
          name: 'Navigation & Routing',
          desc: 'Implement intuitive app navigation with stack navigation, tab bars, and drawer menus. Includes deep linking support, navigation state persistence, transition animations, and back button handling.',
          hours: 12,
          priority: 5,
        },
        {
          name: 'Offline-First Architecture',
          desc: 'Enable full app functionality without internet connection using local storage and sync queues. Includes data caching, conflict resolution, background sync, and network status indicators.',
          hours: 16,
          priority: 3,
        },
        {
          name: 'Push Notification System',
          desc: 'Integrate push notifications for user engagement with customizable notification types. Includes notification permissions handling, deep linking from notifications, notification center, and analytics tracking.',
          hours: 12,
          priority: 4,
        },
      ],
    },
    {
      keywords: ['social', 'profile', 'follow', 'feed', 'post', 'comment', 'like'],
      epic: 'Social Features',
      epicDesc:
        'Engaging social functionality that connects users, enables content sharing, and builds community. Designed for viral growth, user retention, and meaningful interactions.',
      features: [
        {
          name: 'User Profile System',
          desc: 'Build comprehensive user profiles with avatar upload, bio editing, and activity history. Includes profile customization options, privacy settings, profile completeness indicators, and public/private profile toggle.',
          hours: 16,
          priority: 5,
        },
        {
          name: 'Activity Feed Engine',
          desc: 'Create an engaging activity feed with algorithmic content ordering and infinite scroll. Includes content type variety, engagement actions, share functionality, and personalized feed preferences.',
          hours: 20,
          priority: 5,
        },
        {
          name: 'Commenting & Discussions',
          desc: 'Implement threaded comments with replies, mentions, and rich text formatting. Includes comment moderation tools, spam detection, edit/delete functionality, and notification triggers for replies.',
          hours: 12,
          priority: 4,
        },
        {
          name: 'Social Graph & Connections',
          desc: 'Build follow/friend system with mutual connections, follow suggestions, and connection management. Includes follower/following lists, connection requests, blocking functionality, and relationship-based feed filtering.',
          hours: 16,
          priority: 4,
        },
      ],
    },
    {
      keywords: ['search', 'filter', 'sort', 'query', 'find'],
      epic: 'Search & Discovery',
      epicDesc:
        'Powerful search infrastructure enabling users to find exactly what they need quickly. Combines full-text search, smart filtering, and personalized recommendations.',
      features: [
        {
          name: 'Full-text Search Engine',
          desc: 'Implement comprehensive search across all content types with relevance ranking. Includes fuzzy matching, stemming, synonym support, highlighting of matches, and search analytics for improvement.',
          hours: 16,
          priority: 4,
        },
        {
          name: 'Advanced Filter System',
          desc: 'Build faceted filtering with dynamic filter options based on results. Includes multi-select filters, range sliders, saved filter presets, and real-time result count updates.',
          hours: 12,
          priority: 4,
        },
        {
          name: 'Search Autocomplete & Suggestions',
          desc: 'Enhance search with type-ahead suggestions, recent searches, and trending queries. Includes keyboard navigation, category suggestions, and personalized recommendations based on history.',
          hours: 8,
          priority: 3,
        },
      ],
    },
    {
      keywords: ['notification', 'alert', 'email', 'sms', 'message'],
      epic: 'Notification System',
      epicDesc:
        'Multi-channel notification infrastructure keeping users informed and engaged. Supports email, in-app, and push notifications with smart delivery and user preferences.',
      features: [
        {
          name: 'Email Notification Service',
          desc: 'Build transactional and marketing email system with template management. Includes HTML email templates, personalization, delivery tracking, bounce handling, and unsubscribe management.',
          hours: 12,
          priority: 4,
        },
        {
          name: 'In-App Notification Center',
          desc: 'Create real-time in-app notification system with notification center UI. Includes unread counts, mark as read, notification grouping, action buttons, and notification history.',
          hours: 16,
          priority: 4,
        },
        {
          name: 'Notification Preferences Hub',
          desc: 'Implement user-controlled notification settings by channel and type. Includes granular preferences, quiet hours, digest options, and preference sync across devices.',
          hours: 8,
          priority: 3,
        },
      ],
    },
  ];

  // Find matching patterns
  const matchedPatterns = patterns.filter((p) => p.keywords.some((k) => descLower.includes(k)));

  // If no patterns match, create generic components with detailed descriptions
  if (matchedPatterns.length === 0) {
    components.push(
      {
        name: 'Core Application Features',
        description: `Primary functionality and business logic for ${project.name}. This epic encompasses the essential features that deliver the core value proposition to users, including the main workflows, data processing, and user interactions that define the product experience.`,
        type: 'EPIC',
        estimatedHours: 40,
        priority: 5,
        suggestedDependencies: [],
      },
      {
        name: 'User Interface & Experience',
        description: 'Design and implement a responsive, accessible user interface following modern UX principles. Includes component library development, layout system, theming support, responsive breakpoints, and accessibility compliance (WCAG 2.1). Ensures consistent visual language across all application screens.',
        type: 'FEATURE',
        estimatedHours: 24,
        priority: 5,
        suggestedDependencies: [],
        parentName: 'Core Application Features',
      },
      {
        name: 'Backend Services & Logic',
        description: 'Implement server-side business logic with clean architecture patterns. Includes API endpoint development, service layer implementation, business rule validation, error handling, and logging. Follows separation of concerns and testability best practices.',
        type: 'FEATURE',
        estimatedHours: 24,
        priority: 5,
        suggestedDependencies: [],
        parentName: 'Core Application Features',
      },
      {
        name: 'Data Layer & Storage',
        description: 'Design and implement the data persistence layer with optimized schema design. Includes database modeling, migration scripts, query optimization, indexing strategy, and data integrity constraints. Implements repository pattern for clean data access abstraction.',
        type: 'FEATURE',
        estimatedHours: 16,
        priority: 4,
        suggestedDependencies: [],
        parentName: 'Core Application Features',
      },
      {
        name: 'Quality Assurance & Testing',
        description: 'Comprehensive testing strategy including unit tests, integration tests, and end-to-end testing. Covers test automation setup, CI/CD integration, code coverage targets, and manual QA processes. Ensures reliability and catches regressions before production deployment.',
        type: 'EPIC',
        estimatedHours: 20,
        priority: 4,
        suggestedDependencies: ['Core Application Features'],
      },
      {
        name: 'Documentation & Guides',
        description: 'Create comprehensive documentation including user guides, API documentation, and technical architecture docs. Includes inline code documentation, README files, deployment guides, and troubleshooting resources for both users and developers.',
        type: 'FEATURE',
        estimatedHours: 12,
        priority: 3,
        suggestedDependencies: ['Core Application Features'],
      },
    );
  } else {
    // Generate components from matched patterns
    for (const pattern of matchedPatterns) {
      // Add Epic with detailed description
      components.push({
        name: pattern.epic,
        description: pattern.epicDesc || `${pattern.epic} functionality for ${project.name}`,
        type: 'EPIC',
        estimatedHours: pattern.features.reduce((sum, f) => sum + f.hours, 0),
        priority: 5,
        suggestedDependencies: [],
      });

      // Add features under the epic
      for (const feature of pattern.features) {
        components.push({
          name: feature.name,
          description: feature.desc,
          type: 'FEATURE',
          estimatedHours: feature.hours,
          priority: feature.priority,
          suggestedDependencies: [],
          parentName: pattern.epic,
        });
      }
    }

    // Add dependencies between epics if multiple patterns matched
    if (matchedPatterns.length > 1) {
      const epicNames = matchedPatterns.map((p) => p.epic);
      // Make later epics depend on first epic
      for (let i = 1; i < components.length; i++) {
        if (components[i].type === 'EPIC' && epicNames.includes(components[i].name)) {
          components[i].suggestedDependencies = [epicNames[0]];
        }
      }
    }
  }

  // Generate sprints/cycles only if cycles are enabled for this team's workflow (Scrum, not Kanban)
  // AND if the user requested sprint generation
  if (generateSprints && cycleEnabled && components.length > 0) {
    const totalHours = components.reduce((sum, c) => sum + c.estimatedHours, 0);
    const cycleDuration = workflowConfig?.cycleDurationWeeks || 2;
    const hoursPerCycle = cycleDuration * 40; // Assuming 1 developer at 40 hours/week
    const numCycles = Math.ceil(totalHours / hoursPerCycle);

    let componentIndex = 0;
    for (let i = 0; i < Math.min(numCycles, 4); i++) {
      const cycleComponents: string[] = [];
      let cycleHours = 0;

      // Add components to cycle until capacity is reached
      while (componentIndex < components.length && cycleHours < hoursPerCycle) {
        const comp = components[componentIndex];
        cycleComponents.push(comp.name);
        cycleHours += comp.estimatedHours;
        componentIndex++;
      }

      sprints.push({
        name: `${cycleName} ${i + 1}`,
        goal: i === 0 ? 'Foundation and core setup' : i === numCycles - 1 ? 'Polish and launch prep' : `Iteration ${i + 1}`,
        durationWeeks: cycleDuration,
        componentNames: cycleComponents,
        capacity: hoursPerCycle,
      });
    }
  }

  // Build summary based on workflow mode
  let workflowNote = '';
  if (!cycleEnabled) {
    workflowNote = ' (Kanban workflow - no sprints generated)';
  } else if (sprints.length > 0) {
    workflowNote = ` with ${sprints.length} ${cycleName.toLowerCase()}(s)`;
  }

  const summary =
    matchedPatterns.length > 0
      ? `Based on your project description, I've identified ${matchedPatterns.length} key area(s): ${matchedPatterns.map((p) => p.epic).join(', ')}. Generated ${components.length} components${workflowNote}.`
      : `Generated a standard project structure with ${components.length} components for ${project.name}${workflowNote}.`;

  return {
    components,
    summary,
    enhancedDescription: description,
    sprints,
  };
}

/**
 * Apply AI-generated components in demo mode - creates them in demo store
 */
function applyAIComponentsInDemo(input: ApplyAIComponentsInput) {
  const { projectId, components, enhancedDescription, sprints } = input;

  // Get the project first to get teamId
  const project = demoStore.getProject(projectId);
  if (!project) {
    return { created: 0, dependencies: 0, sprints: 0 };
  }

  const teamId = project.teamId;

  // Update project description if enhanced (use updateProject to persist)
  if (enhancedDescription) {
    demoStore.updateProject(projectId, { description: enhancedDescription });
  }

  const nameToId = new Map<string, string>();
  let created = 0;
  let dependencyCount = 0;
  let sprintCount = 0;

  // First pass: Create components without parents (EPICs)
  for (const comp of components.filter((c) => !c.parentName)) {
    const component = demoStore.createComponent({
      name: comp.name,
      description: comp.description,
      type: comp.type,
      priority: comp.priority,
      estimatedHours: comp.estimatedHours,
      projectId,
    });
    nameToId.set(comp.name, component.id);
    created++;
  }

  // Second pass: Create components with parents
  for (const comp of components.filter((c) => c.parentName)) {
    const parentId = nameToId.get(comp.parentName!);
    const component = demoStore.createComponent({
      name: comp.name,
      description: comp.description,
      type: comp.type,
      priority: comp.priority,
      estimatedHours: comp.estimatedHours,
      projectId,
      parentId,
    });
    nameToId.set(comp.name, component.id);
    created++;
  }

  // Create dependencies
  for (const comp of components) {
    const dependentId = nameToId.get(comp.name);
    if (!dependentId) continue;

    for (const depName of comp.suggestedDependencies) {
      const requiredId = nameToId.get(depName);
      if (requiredId && requiredId !== dependentId) {
        demoStore.addDependency(dependentId, requiredId);
        dependencyCount++;
      }
    }
  }

  // Create sprints if provided
  if (sprints && sprints.length > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < sprints.length; i++) {
      const sprint = sprints[i];
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() + i * sprint.durationWeeks * 7);

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + sprint.durationWeeks * 7);

      const createdSprint = demoStore.createSprint({
        name: sprint.name,
        goal: sprint.goal,
        teamId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        capacity: sprint.capacity,
      });

      // Assign components to sprint
      for (const compName of sprint.componentNames) {
        const componentId = nameToId.get(compName);
        if (componentId) {
          demoStore.assignComponentToSprint(componentId, createdSprint.id);
        }
      }

      sprintCount++;
    }
  }

  return {
    created,
    dependencies: dependencyCount,
    sprints: sprintCount,
  };
}

/**
 * Custom event name for demo store updates
 * Client components can listen for this to refresh their data
 */
export const DEMO_STORE_UPDATE_EVENT = 'demo-store-update';

/**
 * Dispatch a demo store update event
 * This is called after executeDemoAction to notify listeners
 */
function dispatchDemoStoreUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DEMO_STORE_UPDATE_EVENT));
  }
}

/**
 * Hook to handle demo action results
 * Use this in onSuccess callbacks to process demo markers
 */
export function useDemoActionHandler() {
  const router = useRouter();

  return {
    handleResult: <T>(data: T | DemoActionResult): T => {
      if (isDemoResult(data)) {
        const localResult = executeDemoAction(data._action, data._input);
        // Notify listeners and refresh
        if (isDemoMode()) {
          dispatchDemoStoreUpdate();
          router.refresh();
        }
        return localResult as T;
      }
      return data;
    },
    isDemoMode: isDemoMode(),
  };
}

// Re-export useAction for convenience
export { useAction, useOptimisticAction };
