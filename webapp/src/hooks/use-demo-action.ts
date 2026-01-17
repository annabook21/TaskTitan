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

type DemoWireframeTemplate = {
  layout: 'dashboard' | 'settings' | 'auth' | 'board' | 'timeline' | 'search' | 'inbox' | 'feature';
  headline: string;
  subheadline: string;
  stats?: Array<{ label: string; value: string }>;
  cards?: Array<{ title: string; body: string; tag?: string }>;
  list?: Array<{ title: string; meta: string }>;
  table?: { headers: string[]; rows: string[][] };
};

const wireframeTemplates: Array<{ keywords: string[]; template: DemoWireframeTemplate }> = [
  {
    keywords: ['dashboard', 'analytics', 'report', 'insight'],
    template: {
      layout: 'dashboard',
      headline: 'Insights Overview',
      subheadline: 'Key trends and operational signals at a glance.',
      stats: [
        { label: 'Active items', value: '128' },
        { label: 'Cycle time', value: '3.4d' },
        { label: 'Blocked', value: '7' },
      ],
      cards: [
        { title: 'Throughput', body: 'Weekly throughput trending +12% over last 30 days.', tag: 'Trend' },
        { title: 'Aging items', body: '5 items exceed the SLA threshold. Review blockers.', tag: 'Alert' },
        { title: 'Quality', body: 'Review backlog and test coverage are stable.', tag: 'Quality' },
      ],
      list: [
        { title: 'Top blocker: API rate limits', meta: 'Assigned to Platform' },
        { title: 'Priority: Billing reconciliation', meta: 'Due in 3 days' },
        { title: 'Escalation: Mobile crash report', meta: 'Investigating' },
      ],
    },
  },
  {
    keywords: ['settings', 'preferences', 'profile', 'account'],
    template: {
      layout: 'settings',
      headline: 'Account Settings',
      subheadline: 'Manage your profile, preferences, and access.',
      cards: [
        { title: 'Profile', body: 'Update your name, avatar, and role details.' },
        { title: 'Notifications', body: 'Control email and in-app alerts.', tag: 'Updated' },
        { title: 'Security', body: 'Manage passwords and sign-in methods.' },
      ],
      list: [
        { title: 'Default workspace', meta: 'Product Engineering' },
        { title: 'Weekly digest', meta: 'Enabled' },
        { title: 'Session timeout', meta: '30 minutes' },
      ],
    },
  },
  {
    keywords: ['login', 'signin', 'sign in', 'auth', 'signup', 'register'],
    template: {
      layout: 'auth',
      headline: 'Secure Access',
      subheadline: 'Sign in with your work account to continue.',
      cards: [
        { title: 'Single sign-on', body: 'Connect with your corporate identity provider.' },
        { title: 'Magic link', body: 'Get a secure sign-in link in your inbox.' },
      ],
      list: [
        { title: 'SSO providers', meta: 'Okta, Google, Azure AD' },
        { title: 'Security', meta: 'MFA recommended' },
      ],
    },
  },
  {
    keywords: ['kanban', 'board', 'workflow'],
    template: {
      layout: 'board',
      headline: 'Workflow Board',
      subheadline: 'Track items across planning, execution, and review.',
      cards: [
        { title: 'Planning', body: '12 items queued for refinement.', tag: 'WIP 8' },
        { title: 'In Progress', body: '6 active tasks with 2 blocked.', tag: 'WIP 5' },
        { title: 'Review', body: '4 items awaiting approval.', tag: 'WIP 4' },
      ],
      list: [
        { title: 'Urgent: Payment failure audit', meta: 'Owner: Sam' },
        { title: 'Refactor: Notification routing', meta: 'Owner: Lee' },
      ],
    },
  },
  {
    keywords: ['timeline', 'roadmap', 'plan'],
    template: {
      layout: 'timeline',
      headline: 'Release Timeline',
      subheadline: 'Coordinate milestones and delivery windows.',
      list: [
        { title: 'Sprint 18: Customer onboarding', meta: 'Mar 4 - Mar 17' },
        { title: 'Sprint 19: Billing automation', meta: 'Mar 18 - Mar 31' },
        { title: 'Sprint 20: Reporting refresh', meta: 'Apr 1 - Apr 14' },
      ],
      cards: [
        { title: 'Risk', body: 'Payment gateway dependencies still pending.', tag: 'At risk' },
        { title: 'Dependencies', body: 'Waiting on analytics schema changes.', tag: 'External' },
      ],
    },
  },
  {
    keywords: ['search', 'browse', 'catalog', 'library'],
    template: {
      layout: 'search',
      headline: 'Search & Discover',
      subheadline: 'Find assets, components, and docs quickly.',
      list: [
        { title: 'Design system tokens', meta: 'Updated 2h ago' },
        { title: 'Checkout flow checklist', meta: 'Updated yesterday' },
        { title: 'Mobile UI kit', meta: 'Updated last week' },
      ],
      table: {
        headers: ['Item', 'Owner', 'Status'],
        rows: [
          ['Onboarding guide', 'Ava', 'Approved'],
          ['API reference', 'Jordan', 'Draft'],
          ['Release checklist', 'Morgan', 'Approved'],
        ],
      },
    },
  },
  {
    keywords: ['chat', 'message', 'inbox', 'notification'],
    template: {
      layout: 'inbox',
      headline: 'Team Inbox',
      subheadline: 'Centralize updates and decision requests.',
      list: [
        { title: 'Design review requested', meta: '4 min ago' },
        { title: 'Build failed: tests', meta: '12 min ago' },
        { title: 'Deployment complete', meta: '1h ago' },
      ],
      cards: [
        { title: 'Pinned', body: 'Customer escalation thread', tag: 'High' },
        { title: 'Mentions', body: 'You were mentioned in 3 threads', tag: 'New' },
      ],
    },
  },
];

function buildWireframeHtml(componentName: string, description: string | null): string {
  const baseText = `${componentName} experience`;
  const lowered = `${componentName} ${description || ''}`.toLowerCase();
  const selected =
    wireframeTemplates.find((entry) => entry.keywords.some((word) => lowered.includes(word)))?.template || {
      layout: 'feature',
      headline: componentName,
      subheadline: description || 'Deliver a focused experience with clear actions and status.',
      cards: [
        { title: 'Primary action', body: `Start the ${baseText}.`, tag: 'Action' },
        { title: 'Recent activity', body: 'Track the latest changes and updates.' },
        { title: 'Next steps', body: 'Review open items and confirm priorities.' },
      ],
      list: [
        { title: 'Owner assigned', meta: 'Today' },
        { title: 'Requirements captured', meta: 'This week' },
      ],
    };

  const statMarkup =
    selected.stats?.map((stat) => `<div class="stat"><div class="stat-value">${stat.value}</div><div class="stat-label">${stat.label}</div></div>`).join('') ||
    '';
  const cardMarkup =
    selected.cards
      ?.map(
        (card) => `<div class="card">
  <div class="card-title">${card.title}</div>
  <div class="card-body">${card.body}</div>
  ${card.tag ? `<div class="tag">${card.tag}</div>` : ''}
</div>`,
      )
      .join('') || '';
  const listMarkup =
    selected.list
      ?.map(
        (item) => `<div class="list-item">
  <div class="list-title">${item.title}</div>
  <div class="list-meta">${item.meta}</div>
</div>`,
      )
      .join('') || '';
  const tableMarkup = selected.table
    ? `<table class="table">
  <thead><tr>${selected.table.headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
  <tbody>
    ${selected.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}
  </tbody>
</table>`
    : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${componentName} Wireframe</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: "Inter", "Segoe UI", sans-serif; background:#0f172a; color:#0f172a; margin:0; padding:32px; }
      .page { max-width: 980px; margin: 0 auto; background:#f8fafc; border-radius:20px; padding:28px; }
      .header { display:flex; justify-content:space-between; align-items:center; gap:16px; }
      .title { font-size:28px; font-weight:700; color:#0f172a; margin:0; }
      .subtitle { margin:6px 0 0; color:#475569; }
      .cta { padding:10px 16px; border-radius:10px; background:#0ea5e9; color:white; font-weight:600; border:none; }
      .grid { display:grid; gap:16px; margin-top:20px; }
      .grid.cols-3 { grid-template-columns: repeat(3, minmax(0,1fr)); }
      .grid.cols-2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .stat { background:white; border-radius:14px; padding:16px; border:1px solid #e2e8f0; }
      .stat-value { font-size:22px; font-weight:700; color:#0f172a; }
      .stat-label { color:#64748b; font-size:12px; margin-top:4px; }
      .card { background:white; border-radius:14px; padding:16px; border:1px solid #e2e8f0; position:relative; min-height:110px; }
      .card-title { font-weight:600; margin-bottom:6px; color:#0f172a; }
      .card-body { color:#475569; font-size:14px; }
      .tag { position:absolute; top:12px; right:12px; font-size:11px; color:#0ea5e9; background:#e0f2fe; padding:4px 8px; border-radius:999px; }
      .section { margin-top:24px; }
      .section-title { font-weight:600; margin-bottom:12px; color:#0f172a; }
      .list { display:grid; gap:12px; }
      .list-item { background:white; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; }
      .list-title { font-weight:600; color:#0f172a; }
      .list-meta { color:#64748b; font-size:12px; margin-top:4px; }
      .table { width:100%; border-collapse:collapse; background:white; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
      .table th, .table td { padding:10px 12px; font-size:13px; text-align:left; border-bottom:1px solid #e2e8f0; }
      .table th { background:#f1f5f9; color:#334155; font-weight:600; }
      .footer { margin-top:24px; color:#94a3b8; font-size:12px; text-align:right; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          <h1 class="title">${selected.headline}</h1>
          <p class="subtitle">${selected.subheadline}</p>
        </div>
        <button class="cta">Primary Action</button>
      </div>

      ${statMarkup ? `<div class="grid cols-3">${statMarkup}</div>` : ''}

      ${cardMarkup ? `<div class="grid ${selected.layout === 'dashboard' ? 'cols-3' : 'cols-2'} section">${cardMarkup}</div>` : ''}

      ${listMarkup ? `<div class="section"><div class="section-title">Highlights</div><div class="list">${listMarkup}</div></div>` : ''}

      ${tableMarkup ? `<div class="section"><div class="section-title">Key items</div>${tableMarkup}</div>` : ''}

      <div class="footer">Generated for ${componentName}</div>
    </div>
  </body>
</html>`;
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
    case 'inviteMember':
      return {
        membership: demoStore.createMembership({
          teamId: input.teamId as string,
          name: (input.name as string) || (input.email as string).split('@')[0],
          role: input.role as 'ADMIN' | 'MEMBER' | 'VIEWER',
        }),
      };

    // Project actions
    case 'createProject':
      return { project: demoStore.createProject(input as Parameters<typeof demoStore.createProject>[0]) };
    case 'updateProject':
      return { project: demoStore.updateProject(input.projectId as string, input) };
    case 'updateProjectGitHubSettings':
      return {
        project: demoStore.updateProject(input.projectId as string, {
          githubRepoUrl: input.githubRepoUrl as string | null,
          githubWebhookSecret: input.githubWebhookSecret as string | null,
          githubPrTargetStatus: input.githubPrTargetStatus as 'REVIEW' | 'COMPLETED' | null,
        }),
      };
    case 'deleteProject':
      return { success: demoStore.deleteProject(input.projectId as string) };

    // Component actions
    case 'createComponent':
      return { component: demoStore.createComponent(input as Parameters<typeof demoStore.createComponent>[0]) };
    case 'updateComponent':
      return { component: demoStore.updateComponent(input.componentId as string, input) };
    case 'deleteComponent':
      return { success: demoStore.deleteComponent(input.componentId as string) };
    case 'updateComponentContext':
      return {
        component: demoStore.updateComponent(input.componentId as string, {
          contextDecision: input.contextDecision as string | undefined,
          contextRationale: input.contextRationale as string | undefined,
          contextAlternatives: input.contextAlternatives as string | undefined,
          contextLinks: (input.contextLinks as string[]) || [],
          contextUpdatedAt: new Date().toISOString(),
          contextUpdatedBy: input.updatedBy as string | undefined,
        }),
      };
    case 'clearComponentContext':
      return {
        component: demoStore.updateComponent(input.componentId as string, {
          contextDecision: null,
          contextRationale: null,
          contextAlternatives: null,
          contextLinks: [],
          contextAiSummary: null,
          contextUpdatedAt: null,
          contextUpdatedBy: null,
        }),
      };
    case 'generateContextSummary': {
      const store = demoStore.getStore();
      const component = store.components.find((c) => c.id === input.componentId);
      if (!component) {
        return { component: null, keyPoints: [] };
      }
      const keyPoints = [
        `Decision: ${component.contextDecision || 'Not set'}`,
        `Rationale: ${component.contextRationale || 'Not set'}`,
      ];
      demoStore.updateComponent(component.id, {
        contextAiSummary: keyPoints.join('\n'),
      });
      return {
        component: demoStore.getComponent(component.id),
        keyPoints,
      };
    }

    // Sprint actions
    case 'createSprint':
      return { sprint: demoStore.createSprint(input as Parameters<typeof demoStore.createSprint>[0]) };
    case 'updateSprint':
      return { sprint: demoStore.updateSprint(input.sprintId as string, input) };
    case 'updateSprintStatus':
      return { sprint: demoStore.updateSprint(input.sprintId as string, { status: input.status as string }) };
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
    case 'removeDependency': {
      const dependentComponentId = input.dependentComponentId as string | undefined;
      const requiredComponentId = input.requiredComponentId as string | undefined;
      if (dependentComponentId && requiredComponentId) {
        return {
          success: demoStore.removeDependency(dependentComponentId, requiredComponentId),
        };
      }
      const dependencyId = input.id as string | undefined;
      if (dependencyId) {
        const store = demoStore.getStore();
        const dependency = store.dependencies.find((d) => d.id === dependencyId);
        if (dependency) {
          return {
            success: demoStore.removeDependency(dependency.dependentComponentId, dependency.requiredComponentId),
          };
        }
      }
      return {
        success: false,
      };
    }

    // Workflow config actions
    case 'updateWorkflowConfig':
      return {
        config: demoStore.updateWorkflowConfig(input.teamId as string, input),
      };

    // Sprint planning actions (demo heuristics)
    case 'aiPlanSprint': {
      const store = demoStore.getStore();
      const sprint = store.sprints.find((s) => s.id === input.sprintId);
      if (!sprint) {
        return {
          selectedComponentIds: [],
          totalHours: 0,
          reasoning: 'Sprint not found in demo data.',
          warnings: ['Sprint not found.'],
        };
      }

      const capacityHours = (input.capacityHours as number) || 40;
      const backlogComponents = store.components
        .filter((c) => c.sprintId === null && c.status !== 'COMPLETED')
        .sort((a, b) => b.priority - a.priority);

      let totalHours = 0;
      const selectedComponentIds: string[] = [];
      const warnings: string[] = [];

      for (const component of backlogComponents) {
        const estimate = component.estimatedHours || 4;
        if (totalHours + estimate <= capacityHours) {
          selectedComponentIds.push(component.id);
          totalHours += estimate;
        }
      }

      if (selectedComponentIds.length === 0) {
        warnings.push('No backlog components fit within the selected capacity.');
      }

      return {
        selectedComponentIds,
        totalHours,
        reasoning:
          selectedComponentIds.length > 0
            ? 'Selected highest-priority backlog components that fit the capacity.'
            : 'No suitable components found based on capacity.',
        warnings,
      };
    }
    case 'applySprintPlan': {
      const componentIds = (input.componentIds as string[]) || [];
      const sprintId = input.sprintId as string;
      componentIds.forEach((componentId) => {
        demoStore.assignComponentToSprint(componentId, sprintId);
      });
      return { success: true, assignedCount: componentIds.length };
    }
    case 'aiSuggestSprint': {
      const store = demoStore.getStore();
      const teamId = input.teamId as string;
      const backlogComponents = store.components
        .filter((c) => c.sprintId === null && c.status !== 'COMPLETED')
        .sort((a, b) => b.priority - a.priority);
      const sprintNumber = store.sprints.filter((s) => s.teamId === teamId).length + 1;
      const totalHours = backlogComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
      return {
        name: `Sprint ${sprintNumber}`,
        goal:
          backlogComponents.length > 0
            ? `Focus on ${backlogComponents.slice(0, 3).map((c) => c.name).join(', ')}`
            : 'No backlog items available yet.',
        recommendedCapacity: Math.max(40, Math.round(totalHours * 0.8)),
        reasoning: 'Based on backlog size and estimated hours in demo data.',
      };
    }

    // Wireframe preview actions
    case 'generatePreview': {
      const componentId = input.componentId as string;
      const store = demoStore.getStore();
      const component = store.components.find((c) => c.id === componentId);
      const htmlContent = component
        ? buildWireframeHtml(component.name, component.description)
        : '<html><body><p>Wireframe preview unavailable.</p></body></html>';

      const preview = demoStore.addComponentPreview({
        componentId,
        htmlContent,
        prompt: component?.description || null,
      });
      return { preview };
    }
    case 'exportWireframe': {
      const previewId = input.previewId as string;
      const store = demoStore.getStore();
      const preview = store.componentPreviews.find((p) => p.id === previewId);
      if (!preview) {
        return { downloadUrl: '', fileName: 'wireframe.html' };
      }
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(preview.htmlContent)}`;
      return {
        downloadUrl: dataUrl,
        fileName: 'demo-wireframe.html',
      };
    }

    // Import actions
    case 'executeImport':
      return executeImportInDemo(input as unknown as ExecuteImportInput);

    // AI generation actions - generateAIComponents uses real Bedrock AI (not demo fallback)
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
  epics?: Array<{
    name: string;
    description: string;
    componentNames: string[];
  }>;
}

/**
 * Apply AI-generated components in demo mode - creates them in demo store
 */
function applyAIComponentsInDemo(input: ApplyAIComponentsInput) {
  const { projectId, components, enhancedDescription, sprints, epics } = input;

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
  let epicCount = 0;

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

  // Create epic groupings if provided (optional backlog organization)
  if (epics && epics.length > 0) {
    for (const epic of epics) {
      // Create the epic as a top-level component
      const createdEpic = demoStore.createComponent({
        name: epic.name,
        description: epic.description,
        type: 'EPIC',
        priority: 5,
        estimatedHours: 0,
        projectId,
      });

      // Update child components to have this epic as their parent
      for (const compName of epic.componentNames) {
        const componentId = nameToId.get(compName);
        if (componentId) {
          demoStore.updateComponent(componentId, { parentId: createdEpic.id });
        }
      }

      epicCount++;
    }
  }

  return {
    created,
    dependencies: dependencyCount,
    sprints: sprintCount,
    epics: epicCount,
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
