// Demo data store - localStorage CRUD operations mimicking Prisma patterns
// This provides a client-side data layer for demo mode

import { DEMO_STORAGE_KEY, DEMO_STORAGE_VERSION, DEMO_USER } from './constants';
import { generateDemoSeedData } from './demo-seed';
import type {
  DemoDataStore,
  DemoTeam,
  DemoProject,
  DemoComponent,
  DemoSprint,
  DemoMembership,
  DemoAssignment,
  DemoDependency,
  DemoActivity,
  DemoWorkflowConfig,
  DemoUser,
  DemoStatusHistory,
  DemoTeamWithRelations,
  DemoProjectWithRelations,
  DemoComponentWithRelations,
  DemoMembershipWithRelations,
} from './types';

/**
 * Generate a unique ID for new entities
 */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get the current timestamp as ISO string
 */
function now(): string {
  return new Date().toISOString();
}

function createStatusHistoryEntry(input: {
  componentId: string;
  status: DemoComponent['status'];
  enteredAt?: string;
}): DemoStatusHistory {
  const enteredAt = input.enteredAt ?? now();
  return {
    id: generateId('status'),
    componentId: input.componentId,
    status: input.status,
    enteredAt,
    exitedAt: null,
    durationMs: null,
  };
}

class DemoStore {
  /**
   * Get the data store from localStorage, initializing with seed data if needed
   */
  getStore(): DemoDataStore {
    if (typeof window === 'undefined') {
      // Return empty store during SSR
      return generateDemoSeedData();
    }

    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) {
      // Initialize with seed data
      const seedData = generateDemoSeedData();
      this.saveStore(seedData);
      return seedData;
    }

    try {
      const data = JSON.parse(raw) as DemoDataStore;
      // Check version and migrate if needed
      if (data.version !== DEMO_STORAGE_VERSION) {
        // Migrate existing data by adding missing fields
        const migratedData = this.migrateData(data);
        migratedData.version = DEMO_STORAGE_VERSION;
        this.saveStore(migratedData);
        return migratedData;
      }
      return data;
    } catch {
      // Invalid JSON, reset to seed data
      const seedData = generateDemoSeedData();
      this.saveStore(seedData);
      return seedData;
    }
  }

  /**
   * Migrate data from older versions to the current version
   */
  private migrateData(data: DemoDataStore): DemoDataStore {
    // Migrate memberships to include capacity planning fields
    data.memberships = data.memberships.map((m) => ({
      ...m,
      title: (m as Record<string, unknown>).title ?? null,
      hoursPerDay: (m as Record<string, unknown>).hoursPerDay ?? 6,
      availability: (m as Record<string, unknown>).availability ?? 100,
    })) as DemoDataStore['memberships'];

    return data;
  }

  /**
   * Save the data store to localStorage
   */
  saveStore(data: DemoDataStore): void {
    if (typeof window === 'undefined') {
      return;
    }

    data.lastUpdated = now();
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
  }

  /**
   * Reset the store to fresh seed data
   */
  resetStore(): DemoDataStore {
    const seedData = generateDemoSeedData();
    this.saveStore(seedData);
    return seedData;
  }

  // ============================================
  // USER OPERATIONS
  // ============================================

  getUser(userId: string): DemoUser | null {
    const store = this.getStore();
    return store.users.find((u) => u.id === userId) || null;
  }

  // ============================================
  // TEAM OPERATIONS
  // ============================================

  getTeam(teamId: string): DemoTeam | null {
    const store = this.getStore();
    return store.teams.find((t) => t.id === teamId) || null;
  }

  getTeamWithRelations(teamId: string): DemoTeamWithRelations | null {
    const store = this.getStore();
    const team = store.teams.find((t) => t.id === teamId);
    if (!team) return null;

    const memberships = store.memberships
      .filter((m) => m.teamId === teamId)
      .map((m) => ({
        ...m,
        User: store.users.find((u) => u.id === m.userId)!,
      }));

    const projects = store.projects.filter((p) => p.teamId === teamId);
    const sprints = store.sprints.filter((s) => s.teamId === teamId);
    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === teamId) || null;

    return {
      ...team,
      Membership: memberships,
      Project: projects,
      Sprint: sprints,
      WorkflowConfig: workflowConfig,
    };
  }

  getTeamsByUser(userId: string): DemoTeamWithRelations[] {
    const store = this.getStore();
    const userMemberships = store.memberships.filter((m) => m.userId === userId);

    return userMemberships
      .map((m) => this.getTeamWithRelations(m.teamId))
      .filter((t): t is DemoTeamWithRelations => t !== null);
  }

  createTeam(input: { name: string; description?: string; userId: string }): DemoTeam {
    const store = this.getStore();
    const teamId = generateId('team');
    const timestamp = now();

    const team: DemoTeam = {
      id: teamId,
      name: input.name,
      description: input.description || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Also create OWNER membership
    const membership: DemoMembership = {
      id: generateId('membership'),
      userId: input.userId,
      teamId,
      role: 'OWNER',
      joinedAt: timestamp,
      title: null,
      hoursPerDay: 6,
      availability: 100,
    };

    // Create default workflow config
    const workflowConfig: DemoWorkflowConfig = {
      id: generateId('workflow'),
      teamId,
      wipLimitPlanning: null,
      wipLimitInProgress: null,
      wipLimitBlocked: null,
      wipLimitReview: null,
      cycleEnabled: true,
      cycleDurationWeeks: 2,
      cycleStartDayOfWeek: 1,
      workflowTemplate: 'SCRUM',
      cycleName: 'Sprint',
      backlogName: 'Backlog',
      enforceEstimates: false,
      autoArchiveCompleted: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    store.teams.push(team);
    store.memberships.push(membership);
    store.workflowConfigs.push(workflowConfig);
    this.saveStore(store);

    return team;
  }

  updateTeam(teamId: string, input: { name?: string; description?: string }): DemoTeam | null {
    const store = this.getStore();
    const teamIndex = store.teams.findIndex((t) => t.id === teamId);
    if (teamIndex === -1) return null;

    const team = store.teams[teamIndex];
    if (input.name !== undefined) team.name = input.name;
    if (input.description !== undefined) team.description = input.description;
    team.updatedAt = now();

    this.saveStore(store);
    return team;
  }

  deleteTeam(teamId: string): boolean {
    const store = this.getStore();
    const teamIndex = store.teams.findIndex((t) => t.id === teamId);
    if (teamIndex === -1) return false;

    // Delete team and all related data
    store.teams.splice(teamIndex, 1);
    store.memberships = store.memberships.filter((m) => m.teamId !== teamId);
    store.sprints = store.sprints.filter((s) => s.teamId !== teamId);
    store.workflowConfigs = store.workflowConfigs.filter((w) => w.teamId !== teamId);

    // Delete projects and their components
    const projectIds = store.projects.filter((p) => p.teamId === teamId).map((p) => p.id);
    store.projects = store.projects.filter((p) => p.teamId !== teamId);
    store.components = store.components.filter((c) => !projectIds.includes(c.projectId));
    store.activities = store.activities.filter((a) => !projectIds.includes(a.projectId));

    this.saveStore(store);
    return true;
  }

  // ============================================
  // MEMBERSHIP OPERATIONS
  // ============================================

  getMembershipsByUser(userId: string): DemoMembershipWithRelations[] {
    const store = this.getStore();
    return store.memberships
      .filter((m) => m.userId === userId)
      .map((m) => ({
        ...m,
        User: store.users.find((u) => u.id === m.userId)!,
        Team: this.getTeamWithRelations(m.teamId)!,
      }))
      .filter((m) => m.Team !== null);
  }

  getMembership(userId: string, teamId: string): DemoMembership | null {
    const store = this.getStore();
    return store.memberships.find((m) => m.userId === userId && m.teamId === teamId) || null;
  }

  createMembership(input: {
    teamId: string;
    name: string;
    role: 'ADMIN' | 'MEMBER' | 'VIEWER';
    title?: string;
    hoursPerDay?: number;
    availability?: number;
  }): DemoMembership {
    const store = this.getStore();

    // In demo mode, create a new user with the given name
    const timestamp = now();
    const user = {
      id: generateId('user'),
      email: `${input.name.toLowerCase().replace(/\s+/g, '.')}@demo.local`,
      name: input.name,
      avatarUrl: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.users.push(user);

    const membership: DemoMembership = {
      id: generateId('membership'),
      userId: user.id,
      teamId: input.teamId,
      role: input.role,
      joinedAt: now(),
      title: input.title || null,
      hoursPerDay: input.hoursPerDay ?? 6,
      availability: input.availability ?? 100,
    };

    store.memberships.push(membership);
    this.saveStore(store);

    return membership;
  }

  updateMembershipRole(
    userId: string,
    teamId: string,
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
  ): DemoMembership | null {
    const store = this.getStore();
    const membership = store.memberships.find((m) => m.userId === userId && m.teamId === teamId);
    if (!membership) return null;

    membership.role = role;
    this.saveStore(store);
    return membership;
  }

  /**
   * Calculate team sprint capacity using industry-standard formula:
   * Capacity = Σ (member.hoursPerDay × availability% × sprintDays)
   */
  getTeamSprintCapacity(teamId: string, sprintDays: number): number {
    const store = this.getStore();
    const memberships = store.memberships.filter((m) => m.teamId === teamId);

    return memberships.reduce((total, member) => {
      const hoursPerDay = member.hoursPerDay ?? 6;
      const availability = (member.availability ?? 100) / 100;
      return total + hoursPerDay * availability * sprintDays;
    }, 0);
  }

  /**
   * Get team members formatted for AI generation
   */
  getTeamMembersForAI(teamId: string): Array<{
    name: string;
    title?: string;
    hoursPerDay: number;
    availability: number;
  }> {
    const store = this.getStore();
    const memberships = store.memberships.filter((m) => m.teamId === teamId);

    return memberships.map((m) => {
      const user = store.users.find((u) => u.id === m.userId);
      return {
        name: user?.name || 'Unknown',
        title: m.title ?? undefined,
        hoursPerDay: m.hoursPerDay ?? 6,
        availability: m.availability ?? 100,
      };
    });
  }

  // ============================================
  // PROJECT OPERATIONS
  // ============================================

  getProject(projectId: string): DemoProject | null {
    const store = this.getStore();
    return store.projects.find((p) => p.id === projectId) || null;
  }

  getProjectWithRelations(projectId: string, userId: string): DemoProjectWithRelations | null {
    const store = this.getStore();
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return null;

    // Check user has access via team membership
    const hasMembership = store.memberships.some((m) => m.userId === userId && m.teamId === project.teamId);
    if (!hasMembership) return null;

    const team = this.getTeamWithRelations(project.teamId);
    if (!team) return null;

    const owner = store.users.find((u) => u.id === project.ownerId)!;
    const components = this.getComponentsByProject(projectId);

    return {
      ...project,
      Team: team,
      Component: components,
      Owner: owner,
    };
  }

  getProjectsByTeam(teamId: string): DemoProject[] {
    const store = this.getStore();
    return store.projects.filter((p) => p.teamId === teamId);
  }

  getProjectsByUser(userId: string): DemoProject[] {
    const store = this.getStore();
    const userTeamIds = store.memberships.filter((m) => m.userId === userId).map((m) => m.teamId);
    return store.projects.filter((p) => userTeamIds.includes(p.teamId));
  }

  createProject(input: { name: string; description?: string; teamId: string; ownerId: string }): DemoProject {
    const store = this.getStore();
    const projectId = generateId('project');
    const timestamp = now();

    const project: DemoProject = {
      id: projectId,
      name: input.name,
      description: input.description || null,
      teamId: input.teamId,
      ownerId: input.ownerId,
      githubRepoUrl: null,
      githubWebhookSecret: null,
      githubPrTargetStatus: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Create activity
    const activity: DemoActivity = {
      id: generateId('activity'),
      type: 'PROJECT_CREATED',
      projectId,
      userId: input.ownerId,
      metadata: { projectName: input.name },
      createdAt: timestamp,
    };

    store.projects.push(project);
    store.activities.push(activity);
    this.saveStore(store);

    return project;
  }

  updateProject(
    projectId: string,
    input: {
      name?: string;
      description?: string;
      githubRepoUrl?: string | null;
      githubWebhookSecret?: string | null;
      githubPrTargetStatus?: DemoProject['githubPrTargetStatus'] | null;
    },
  ): DemoProject | null {
    const store = this.getStore();
    const projectIndex = store.projects.findIndex((p) => p.id === projectId);
    if (projectIndex === -1) return null;

    const project = store.projects[projectIndex];
    if (input.name !== undefined) project.name = input.name;
    if (input.description !== undefined) project.description = input.description;
    if (input.githubRepoUrl !== undefined) project.githubRepoUrl = input.githubRepoUrl;
    if (input.githubWebhookSecret !== undefined) project.githubWebhookSecret = input.githubWebhookSecret;
    if (input.githubPrTargetStatus !== undefined) project.githubPrTargetStatus = input.githubPrTargetStatus;
    project.updatedAt = now();

    this.saveStore(store);
    return project;
  }

  deleteProject(projectId: string): boolean {
    const store = this.getStore();
    const projectIndex = store.projects.findIndex((p) => p.id === projectId);
    if (projectIndex === -1) return false;

    store.projects.splice(projectIndex, 1);
    // Delete related components, assignments, dependencies, activities
    const componentIds = store.components.filter((c) => c.projectId === projectId).map((c) => c.id);
    store.components = store.components.filter((c) => c.projectId !== projectId);
    store.assignments = store.assignments.filter((a) => !componentIds.includes(a.componentId));
    store.dependencies = store.dependencies.filter(
      (d) => !componentIds.includes(d.dependentComponentId) && !componentIds.includes(d.requiredComponentId),
    );
    store.activities = store.activities.filter((a) => a.projectId !== projectId);

    this.saveStore(store);
    return true;
  }

  // ============================================
  // COMPONENT OPERATIONS
  // ============================================

  getComponent(componentId: string): DemoComponent | null {
    const store = this.getStore();
    return store.components.find((c) => c.id === componentId) || null;
  }

  getComponentWithRelations(componentId: string): DemoComponentWithRelations | null {
    const store = this.getStore();
    const component = store.components.find((c) => c.id === componentId);
    if (!component) return null;

    const assignments = store.assignments
      .filter((a) => a.componentId === componentId)
      .map((a) => ({
        ...a,
        User: store.users.find((u) => u.id === a.userId)!,
      }));

    const sprint = component.sprintId ? store.sprints.find((s) => s.id === component.sprintId) || null : null;

    const children = store.components.filter((c) => c.parentId === componentId);

    const dependencies = store.dependencies
      .filter((d) => d.dependentComponentId === componentId)
      .map((d) => ({
        Component_Dependency_requiredComponentIdToComponent: store.components.find(
          (c) => c.id === d.requiredComponentId,
        )!,
      }));

    const statusHistory = store.statusHistory.filter((h) => h.componentId === componentId);

    return {
      ...component,
      Assignment: assignments,
      Sprint: sprint,
      children,
      Dependency_Dependency_dependentComponentIdToComponent: dependencies,
      StatusHistory: statusHistory,
    };
  }

  getComponentsByProject(projectId: string): DemoComponentWithRelations[] {
    const store = this.getStore();
    return store.components
      .filter((c) => c.projectId === projectId)
      .map((c) => this.getComponentWithRelations(c.id)!)
      .filter((c) => c !== null);
  }

  createComponent(input: {
    name: string;
    description?: string;
    type: DemoComponent['type'];
    projectId: string;
    parentId?: string;
    sprintId?: string;
    status?: DemoComponent['status'];
    priority?: number;
    estimatedHours?: number;
    dueDate?: string;
    tags?: string[];
  }): DemoComponent {
    const store = this.getStore();
    const componentId = generateId('component');
    const timestamp = now();

    const component: DemoComponent = {
      id: componentId,
      name: input.name,
      description: input.description || null,
      type: input.type,
      projectId: input.projectId,
      parentId: input.parentId || null,
      sprintId: input.sprintId || null,
      status: input.status || 'PLANNING',
      statusEnteredAt: timestamp,
      priority: input.priority ?? 0,
      estimatedHours: input.estimatedHours || null,
      dueDate: input.dueDate || null,
      owner: null,
      tags: input.tags || [],
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
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    store.components.push(component);
    store.statusHistory.push(
      createStatusHistoryEntry({
        componentId,
        status: component.status,
        enteredAt: component.statusEnteredAt,
      }),
    );
    this.saveStore(store);

    return component;
  }

  updateComponent(
    componentId: string,
    input: Partial<
      Pick<
        DemoComponent,
        | 'name'
        | 'description'
        | 'status'
        | 'priority'
        | 'estimatedHours'
        | 'dueDate'
        | 'parentId'
        | 'sprintId'
        | 'tags'
        | 'contextDecision'
        | 'contextRationale'
        | 'contextAlternatives'
        | 'contextLinks'
        | 'contextAiSummary'
        | 'contextUpdatedAt'
        | 'contextUpdatedBy'
      >
    >,
  ): DemoComponent | null {
    const store = this.getStore();
    const componentIndex = store.components.findIndex((c) => c.id === componentId);
    if (componentIndex === -1) return null;

    const component = store.components[componentIndex];
    const oldStatus = component.status;
    const updatedAt = now();

    // Update fields
    Object.keys(input).forEach((key) => {
      const value = input[key as keyof typeof input];
      if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (component as any)[key] = value;
      }
    });

    // Track status change
    if (input.status && input.status !== oldStatus) {
      component.statusEnteredAt = updatedAt;
      // Close previous status entry
      const previousStatusEntries = store.statusHistory.filter(
        (entry) => entry.componentId === componentId && entry.exitedAt === null,
      );
      previousStatusEntries.forEach((entry) => {
        entry.exitedAt = updatedAt;
        entry.durationMs = new Date(updatedAt).getTime() - new Date(entry.enteredAt).getTime();
      });
      store.statusHistory.push(
        createStatusHistoryEntry({
          componentId,
          status: component.status,
          enteredAt: component.statusEnteredAt,
        }),
      );
    }

    component.updatedAt = updatedAt;
    this.saveStore(store);

    return component;
  }

  addComponentPreview(input: { componentId: string; htmlContent: string; prompt?: string; generatedBy?: string }) {
    const store = this.getStore();
    const timestamp = now();
    const preview = {
      id: generateId('preview'),
      componentId: input.componentId,
      htmlContent: input.htmlContent,
      prompt: input.prompt ?? null,
      generatedBy: input.generatedBy ?? DEMO_USER.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    store.componentPreviews.push(preview);
    this.saveStore(store);
    return preview;
  }

  deleteComponent(componentId: string): boolean {
    const store = this.getStore();
    const componentIndex = store.components.findIndex((c) => c.id === componentId);
    if (componentIndex === -1) return false;

    // Delete component and children recursively
    const deleteRecursive = (id: string) => {
      const children = store.components.filter((c) => c.parentId === id);
      children.forEach((child) => deleteRecursive(child.id));

      store.components = store.components.filter((c) => c.id !== id);
      store.assignments = store.assignments.filter((a) => a.componentId !== id);
      store.dependencies = store.dependencies.filter(
        (d) => d.dependentComponentId !== id && d.requiredComponentId !== id,
      );
    };

    deleteRecursive(componentId);
    this.saveStore(store);

    return true;
  }

  // ============================================
  // SPRINT OPERATIONS
  // ============================================

  getSprint(sprintId: string): DemoSprint | null {
    const store = this.getStore();
    return store.sprints.find((s) => s.id === sprintId) || null;
  }

  getSprintsByTeam(teamId: string): DemoSprint[] {
    const store = this.getStore();
    return store.sprints.filter((s) => s.teamId === teamId);
  }

  getActiveSprintsByTeam(teamId: string): DemoSprint[] {
    const store = this.getStore();
    return store.sprints.filter((s) => s.teamId === teamId && (s.status === 'PLANNING' || s.status === 'ACTIVE'));
  }

  createSprint(input: {
    name: string;
    goal?: string;
    teamId: string;
    startDate?: string;
    endDate?: string;
    capacity?: number;
  }): DemoSprint {
    const store = this.getStore();
    const sprintId = generateId('sprint');
    const timestamp = now();

    const sprint: DemoSprint = {
      id: sprintId,
      name: input.name,
      goal: input.goal || null,
      teamId: input.teamId,
      startDate: input.startDate || null,
      endDate: input.endDate || null,
      status: 'PLANNING',
      capacity: input.capacity || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    store.sprints.push(sprint);
    this.saveStore(store);

    return sprint;
  }

  updateSprint(
    sprintId: string,
    input: Partial<Pick<DemoSprint, 'name' | 'goal' | 'startDate' | 'endDate' | 'status' | 'capacity'>>,
  ): DemoSprint | null {
    const store = this.getStore();
    const sprintIndex = store.sprints.findIndex((s) => s.id === sprintId);
    if (sprintIndex === -1) return null;

    const sprint = store.sprints[sprintIndex];
    Object.keys(input).forEach((key) => {
      const value = input[key as keyof typeof input];
      if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sprint as any)[key] = value;
      }
    });
    sprint.updatedAt = now();

    this.saveStore(store);
    return sprint;
  }

  deleteSprint(sprintId: string): boolean {
    const store = this.getStore();
    const sprintIndex = store.sprints.findIndex((s) => s.id === sprintId);
    if (sprintIndex === -1) return false;

    store.sprints.splice(sprintIndex, 1);
    // Remove sprint from components
    store.components.forEach((c) => {
      if (c.sprintId === sprintId) {
        c.sprintId = null;
      }
    });

    this.saveStore(store);
    return true;
  }

  assignComponentToSprint(componentId: string, sprintId: string | null): DemoComponent | null {
    const store = this.getStore();
    const component = store.components.find((c) => c.id === componentId);
    if (!component) return null;

    component.sprintId = sprintId;
    component.updatedAt = now();
    this.saveStore(store);

    return component;
  }

  // ============================================
  // ASSIGNMENT OPERATIONS
  // ============================================

  addAssignment(componentId: string, userId: string): DemoAssignment {
    const store = this.getStore();

    // Check if already assigned
    const existing = store.assignments.find((a) => a.componentId === componentId && a.userId === userId);
    if (existing) return existing;

    const assignment: DemoAssignment = {
      id: generateId('assignment'),
      componentId,
      userId,
      assignedAt: now(),
    };

    store.assignments.push(assignment);
    this.saveStore(store);

    return assignment;
  }

  removeAssignment(componentId: string, userId: string): boolean {
    const store = this.getStore();
    const index = store.assignments.findIndex((a) => a.componentId === componentId && a.userId === userId);
    if (index === -1) return false;

    store.assignments.splice(index, 1);
    this.saveStore(store);
    return true;
  }

  // ============================================
  // DEPENDENCY OPERATIONS
  // ============================================

  addDependency(dependentComponentId: string, requiredComponentId: string, description?: string): DemoDependency {
    const store = this.getStore();

    // Check if already exists
    const existing = store.dependencies.find(
      (d) => d.dependentComponentId === dependentComponentId && d.requiredComponentId === requiredComponentId,
    );
    if (existing) return existing;

    const dependency: DemoDependency = {
      id: generateId('dependency'),
      dependentComponentId,
      requiredComponentId,
      description: description || null,
      createdAt: now(),
    };

    store.dependencies.push(dependency);
    this.saveStore(store);

    return dependency;
  }

  removeDependency(dependentComponentId: string, requiredComponentId: string): boolean {
    const store = this.getStore();
    const index = store.dependencies.findIndex(
      (d) => d.dependentComponentId === dependentComponentId && d.requiredComponentId === requiredComponentId,
    );
    if (index === -1) return false;

    store.dependencies.splice(index, 1);
    this.saveStore(store);
    return true;
  }

  // ============================================
  // WORKFLOW CONFIG OPERATIONS
  // ============================================

  getWorkflowConfig(teamId: string): DemoWorkflowConfig | null {
    const store = this.getStore();
    return store.workflowConfigs.find((w) => w.teamId === teamId) || null;
  }

  updateWorkflowConfig(teamId: string, input: Partial<DemoWorkflowConfig>): DemoWorkflowConfig | null {
    const store = this.getStore();
    const configIndex = store.workflowConfigs.findIndex((w) => w.teamId === teamId);
    if (configIndex === -1) return null;

    const config = store.workflowConfigs[configIndex];
    Object.keys(input).forEach((key) => {
      if (key !== 'id' && key !== 'teamId') {
        const value = input[key as keyof typeof input];
        if (value !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (config as any)[key] = value;
        }
      }
    });
    config.updatedAt = now();

    this.saveStore(store);
    return config;
  }

  // ============================================
  // ACTIVITY OPERATIONS
  // ============================================

  getActivitiesByProject(projectId: string, limit = 50): DemoActivity[] {
    const store = this.getStore();
    return store.activities
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  createActivity(input: {
    type: string;
    projectId: string;
    userId: string;
    metadata: Record<string, unknown>;
  }): DemoActivity {
    const store = this.getStore();

    const activity: DemoActivity = {
      id: generateId('activity'),
      type: input.type,
      projectId: input.projectId,
      userId: input.userId,
      metadata: input.metadata,
      createdAt: now(),
    };

    store.activities.push(activity);
    this.saveStore(store);

    return activity;
  }
}

// Export singleton instance
export const demoStore = new DemoStore();
