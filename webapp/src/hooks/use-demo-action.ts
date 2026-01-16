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
 */
function generateAIComponentsInDemo(input: GenerateAIComponentsInput) {
  const { projectId, generateSprints } = input;

  const store = demoStore.getStore();
  const project = store.projects.find((p) => p.id === projectId);

  if (!project) {
    return { components: [], summary: 'Project not found', sprints: [] };
  }

  const description = project.description || project.name;
  const components: DemoGeneratedComponent[] = [];
  const sprints: DemoGeneratedSprint[] = [];

  // Analyze description for keywords to generate relevant components
  const descLower = description.toLowerCase();

  // Common project patterns and their components
  const patterns = [
    {
      keywords: ['auth', 'login', 'signup', 'user', 'account', 'password', 'oauth'],
      epic: 'User Authentication',
      features: [
        { name: 'User Registration', desc: 'Allow users to create accounts', hours: 16, priority: 5 },
        { name: 'User Login', desc: 'Secure login with email/password', hours: 12, priority: 5 },
        { name: 'Password Reset', desc: 'Forgot password flow with email verification', hours: 8, priority: 4 },
        { name: 'Session Management', desc: 'Handle user sessions and tokens', hours: 8, priority: 4 },
      ],
    },
    {
      keywords: ['ecommerce', 'shop', 'product', 'cart', 'checkout', 'payment', 'store', 'buy'],
      epic: 'E-Commerce Platform',
      features: [
        { name: 'Product Catalog', desc: 'Browse and search products', hours: 20, priority: 5 },
        { name: 'Shopping Cart', desc: 'Add/remove items, update quantities', hours: 16, priority: 5 },
        { name: 'Checkout Flow', desc: 'Multi-step checkout process', hours: 24, priority: 5 },
        { name: 'Payment Integration', desc: 'Stripe/PayPal payment processing', hours: 20, priority: 4 },
        { name: 'Order History', desc: 'View past orders and status', hours: 12, priority: 3 },
      ],
    },
    {
      keywords: ['dashboard', 'admin', 'analytics', 'report', 'metrics', 'chart'],
      epic: 'Analytics Dashboard',
      features: [
        { name: 'Dashboard Overview', desc: 'Key metrics at a glance', hours: 16, priority: 5 },
        { name: 'Data Visualization', desc: 'Charts and graphs for insights', hours: 20, priority: 4 },
        { name: 'Report Generation', desc: 'Export reports in various formats', hours: 12, priority: 3 },
        { name: 'Real-time Updates', desc: 'Live data refresh', hours: 16, priority: 3 },
      ],
    },
    {
      keywords: ['api', 'backend', 'server', 'rest', 'graphql', 'endpoint'],
      epic: 'API Development',
      features: [
        { name: 'API Architecture', desc: 'Design RESTful or GraphQL API', hours: 16, priority: 5 },
        { name: 'Authentication Middleware', desc: 'Secure API endpoints', hours: 12, priority: 5 },
        { name: 'Rate Limiting', desc: 'Protect against abuse', hours: 8, priority: 4 },
        { name: 'API Documentation', desc: 'OpenAPI/Swagger docs', hours: 8, priority: 3 },
      ],
    },
    {
      keywords: ['mobile', 'app', 'ios', 'android', 'react native', 'flutter'],
      epic: 'Mobile Application',
      features: [
        { name: 'Mobile UI Framework', desc: 'Set up mobile app structure', hours: 20, priority: 5 },
        { name: 'Navigation', desc: 'App navigation and routing', hours: 12, priority: 5 },
        { name: 'Offline Support', desc: 'Work without internet connection', hours: 16, priority: 3 },
        { name: 'Push Notifications', desc: 'Engage users with notifications', hours: 12, priority: 4 },
      ],
    },
    {
      keywords: ['social', 'profile', 'follow', 'feed', 'post', 'comment', 'like'],
      epic: 'Social Features',
      features: [
        { name: 'User Profiles', desc: 'View and edit user profiles', hours: 16, priority: 5 },
        { name: 'Activity Feed', desc: 'News feed with posts and updates', hours: 20, priority: 5 },
        { name: 'Comments System', desc: 'Comment on posts and content', hours: 12, priority: 4 },
        { name: 'Follow/Friend System', desc: 'Connect with other users', hours: 16, priority: 4 },
      ],
    },
    {
      keywords: ['search', 'filter', 'sort', 'query', 'find'],
      epic: 'Search & Discovery',
      features: [
        { name: 'Full-text Search', desc: 'Search across content', hours: 16, priority: 4 },
        { name: 'Advanced Filters', desc: 'Filter results by criteria', hours: 12, priority: 4 },
        { name: 'Search Suggestions', desc: 'Autocomplete and suggestions', hours: 8, priority: 3 },
      ],
    },
    {
      keywords: ['notification', 'alert', 'email', 'sms', 'message'],
      epic: 'Notifications',
      features: [
        { name: 'Email Notifications', desc: 'Send email alerts', hours: 12, priority: 4 },
        { name: 'In-App Notifications', desc: 'Real-time in-app alerts', hours: 16, priority: 4 },
        { name: 'Notification Preferences', desc: 'User notification settings', hours: 8, priority: 3 },
      ],
    },
  ];

  // Find matching patterns
  const matchedPatterns = patterns.filter((p) => p.keywords.some((k) => descLower.includes(k)));

  // If no patterns match, create generic components
  if (matchedPatterns.length === 0) {
    components.push(
      {
        name: 'Core Features',
        description: 'Main functionality for ' + project.name,
        type: 'EPIC',
        estimatedHours: 40,
        priority: 5,
        suggestedDependencies: [],
      },
      {
        name: 'User Interface',
        description: 'Design and implement the user interface',
        type: 'FEATURE',
        estimatedHours: 24,
        priority: 5,
        suggestedDependencies: [],
        parentName: 'Core Features',
      },
      {
        name: 'Backend Logic',
        description: 'Server-side business logic',
        type: 'FEATURE',
        estimatedHours: 24,
        priority: 5,
        suggestedDependencies: [],
        parentName: 'Core Features',
      },
      {
        name: 'Data Storage',
        description: 'Database schema and data layer',
        type: 'FEATURE',
        estimatedHours: 16,
        priority: 4,
        suggestedDependencies: [],
        parentName: 'Core Features',
      },
      {
        name: 'Testing & QA',
        description: 'Unit tests, integration tests, and QA',
        type: 'EPIC',
        estimatedHours: 20,
        priority: 4,
        suggestedDependencies: ['Core Features'],
      },
      {
        name: 'Documentation',
        description: 'User guides and technical documentation',
        type: 'FEATURE',
        estimatedHours: 12,
        priority: 3,
        suggestedDependencies: ['Core Features'],
      },
    );
  } else {
    // Generate components from matched patterns
    for (const pattern of matchedPatterns) {
      // Add Epic
      components.push({
        name: pattern.epic,
        description: `${pattern.epic} functionality for ${project.name}`,
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

  // Generate sprints if requested
  if (generateSprints && components.length > 0) {
    const totalHours = components.reduce((sum, c) => sum + c.estimatedHours, 0);
    const hoursPerSprint = 80; // Assuming 2-week sprints with 2 developers
    const numSprints = Math.ceil(totalHours / hoursPerSprint);

    let componentIndex = 0;
    for (let i = 0; i < Math.min(numSprints, 4); i++) {
      const sprintComponents: string[] = [];
      let sprintHours = 0;

      // Add components to sprint until capacity is reached
      while (componentIndex < components.length && sprintHours < hoursPerSprint) {
        const comp = components[componentIndex];
        sprintComponents.push(comp.name);
        sprintHours += comp.estimatedHours;
        componentIndex++;
      }

      sprints.push({
        name: `Sprint ${i + 1}`,
        goal: i === 0 ? 'Foundation and core setup' : i === numSprints - 1 ? 'Polish and launch prep' : `Iteration ${i + 1}`,
        durationWeeks: 2,
        componentNames: sprintComponents,
        capacity: hoursPerSprint,
      });
    }
  }

  const summary =
    matchedPatterns.length > 0
      ? `Based on your project description, I've identified ${matchedPatterns.length} key area(s): ${matchedPatterns.map((p) => p.epic).join(', ')}. Generated ${components.length} components with logical dependencies.`
      : `Generated a standard project structure with ${components.length} components for ${project.name}.`;

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

  const store = demoStore.getStore();
  const project = store.projects.find((p) => p.id === projectId);

  if (!project) {
    return { created: 0, dependencies: 0, sprints: 0 };
  }

  // Update project description if enhanced
  if (enhancedDescription) {
    project.description = enhancedDescription;
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
        teamId: project.teamId,
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

  demoStore.saveStore(store);

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
