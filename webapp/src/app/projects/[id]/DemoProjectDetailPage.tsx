'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import type { Role, User } from '@/lib/prisma-compat';
import { ArrowLeft, Plus, Layers, GitBranch, Users, Clock, PlayCircle, PauseCircle, Zap } from 'lucide-react';
import ComponentCard from './components/ComponentCard';
import SmartComponentCreator from './components/SmartComponentCreator';
import DependencyGraph from './components/DependencyGraph';
import AIGeneratePanelWrapper from './components/AIGeneratePanelWrapper';
import TimelineView from './components/TimelineView';
import DeleteProjectButton from './DeleteProjectButton';
import GitHubIntegrationSettings from './components/GitHubIntegrationSettings';
import SprintTimeline from './components/SprintTimeline';
import { DEMO_STORE_UPDATE_EVENT } from '@/hooks/use-demo-action';

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  teamId: string;
  teamName: string;
  ownerId: string;
  githubRepoUrl: string | null;
  githubWebhookSecret: string | null;
  githubPrTargetStatus: 'REVIEW' | 'COMPLETED' | null;
  components: ComponentData[];
  availableSprints: SprintData[];
  teamMembers: TeamMember[];
  activities: ActivityData[];
  cycleEnabled: boolean;
  cycleName: string;
  wipLimits: Record<string, number | null>;
  updatedAt: string;
}

interface SprintData {
  id: string;
  name: string;
  status: 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  startDate: Date;
  endDate: Date;
  goal: string | null;
  capacity: number | null;
}

interface TeamMember extends User {
  role: Role;
}

interface ActivityData {
  id: string;
  type: string;
  createdAt: string;
  user: TeamMember;
}

interface ComponentData {
  id: string;
  name: string;
  description: string | null;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  status: 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';
  priority: number;
  estimatedHours: number | null;
  dueDate: Date | null;
  sprintId: string | null;
  sprint: SprintData | null;
  // GitHub PR Integration
  githubPrUrl: string | null;
  githubPrStatus?: string | null;
  githubPrNumber?: number | null;
  githubPrTitle?: string | null;
  // Relations
  assignments: { user: TeamMember }[];
  dependsOn: { requiredComponent: { id: string; name: string; status: ComponentData['status'] } }[];
  dependedOnBy: { dependentComponent: { id: string; name: string; status: ComponentData['status'] } }[];
  Preview?: { id: string; htmlContent: string }[];
  contextDecision: string | null;
  contextRationale: string | null;
  contextAlternatives: string | null;
  contextLinks: string[];
  contextAiSummary: string | null;
  statusEnteredAt?: Date;
  cycleTimeDays?: number | null;
  createdAt: Date;
  updatedAt: Date;
  projectId: string;
}

const statusConfig = {
  PLANNING: { label: 'Planning', color: 'violet' },
  IN_PROGRESS: { label: 'In Progress', color: 'cyan' },
  BLOCKED: { label: 'Blocked', color: 'red' },
  REVIEW: { label: 'Review', color: 'amber' },
  COMPLETED: { label: 'Completed', color: 'emerald' },
} as const;

export default function DemoProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const loadProjectData = () => {
    const store = demoStore.getStore();
    const projectData = store.projects.find((p) => p.id === projectId);
    if (!projectData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const membership = store.memberships.find((m) => m.userId === DEMO_USER.id && m.teamId === projectData.teamId);
    if (!membership) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const team = store.teams.find((t) => t.id === projectData.teamId);
    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === projectData.teamId);

    const teamMemberships = store.memberships.filter((m) => m.teamId === projectData.teamId);
    const roleByUserId = new Map(teamMemberships.map((member) => [member.userId, member.role]));
    const fallbackRole: Role = 'MEMBER';

    const toUser = (userId: string): User => {
      const user = store.users.find((u) => u.id === userId);
      if (!user) {
        return {
          id: userId,
          name: null,
          email: 'unknown@example.com',
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      };
    };

    const teamMembers = teamMemberships.map((member) => ({
      ...toUser(member.userId),
      role: member.role,
    }));

    const sprints = store.sprints
      .filter((s) => s.teamId === projectData.teamId)
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        startDate: s.startDate ? new Date(s.startDate) : new Date(),
        endDate: s.endDate ? new Date(s.endDate) : new Date(),
        goal: s.goal,
        capacity: s.capacity,
      }))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const availableSprints = sprints.filter((s) => s.status === 'PLANNING' || s.status === 'ACTIVE');
    const sprintById = new Map(sprints.map((s) => [s.id, s]));

    const activities = store.activities
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((activity) => {
        const user = toUser(activity.userId);
        return {
          id: activity.id,
          type: activity.type,
          createdAt: activity.createdAt,
          user: {
            ...user,
            role: roleByUserId.get(user.id) ?? fallbackRole,
          },
        };
      })
      .slice(0, 10);

    const components = store.components
      .filter((c) => c.projectId === projectId)
      .map((component) => {
        const assignments = store.assignments
          .filter((a) => a.componentId === component.id)
          .map((assignment) => {
            const user = toUser(assignment.userId);
            return {
              user: {
                ...user,
                role: roleByUserId.get(user.id) ?? fallbackRole,
              },
            };
          });

        const dependsOn = store.dependencies
          .filter((d) => d.dependentComponentId === component.id)
          .map((d) => {
            const required = store.components.find((c) => c.id === d.requiredComponentId);
            return {
              requiredComponent: {
                id: d.requiredComponentId,
                name: required?.name || 'Unknown',
                status: required?.status || 'PLANNING',
              },
            };
          });

        const dependedOnBy = store.dependencies
          .filter((d) => d.requiredComponentId === component.id)
          .map((d) => {
            const dependent = store.components.find((c) => c.id === d.dependentComponentId);
            return {
              dependentComponent: {
                id: d.dependentComponentId,
                name: dependent?.name || 'Unknown',
                status: dependent?.status || 'PLANNING',
              },
            };
          });

        const previews = store.componentPreviews
          .filter((p) => p.componentId === component.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((preview) => ({
            id: preview.id,
            htmlContent: preview.htmlContent,
          }));

        const history = store.statusHistory
          .filter((h) => h.componentId === component.id)
          .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());
        const currentStatusEntry = history.find((h) => !h.exitedAt) || history[history.length - 1];
        let cycleTimeDays: number | null = null;
        if (component.status === 'COMPLETED') {
          const inProgress = history.find((h) => h.status === 'IN_PROGRESS');
          const completed = history.find((h) => h.status === 'COMPLETED');
          if (inProgress && completed) {
            const cycleTimeMs = new Date(completed.enteredAt).getTime() - new Date(inProgress.enteredAt).getTime();
            cycleTimeDays = Math.round((cycleTimeMs / (1000 * 60 * 60 * 24)) * 10) / 10;
          } else {
            const createdAt = new Date(component.createdAt).getTime();
            const updatedAt = new Date(component.updatedAt).getTime();
            if (updatedAt > createdAt) {
              cycleTimeDays = Math.round(((updatedAt - createdAt) / (1000 * 60 * 60 * 24)) * 10) / 10;
            }
          }
        }

        return {
          id: component.id,
          name: component.name,
          description: component.description,
          type: component.type,
          status: component.status,
          priority: component.priority,
          estimatedHours: component.estimatedHours,
          dueDate: component.dueDate ? new Date(component.dueDate) : null,
          sprintId: component.sprintId,
          sprint: component.sprintId ? sprintById.get(component.sprintId) || null : null,
          githubPrUrl: component.githubPrUrl,
          githubPrStatus: component.githubPrStatus,
          githubPrNumber: component.githubPrNumber,
          githubPrTitle: component.githubPrTitle,
          assignments,
          dependsOn,
          dependedOnBy,
          Preview: previews.length > 0 ? previews : undefined,
          contextDecision: component.contextDecision,
          contextRationale: component.contextRationale,
          contextAlternatives: component.contextAlternatives,
          contextLinks: component.contextLinks,
          contextAiSummary: component.contextAiSummary,
          statusEnteredAt: currentStatusEntry
            ? new Date(currentStatusEntry.enteredAt)
            : new Date(component.statusEnteredAt),
          cycleTimeDays,
          createdAt: new Date(component.createdAt),
          updatedAt: new Date(component.updatedAt),
          projectId: component.projectId,
        };
      })
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 200);

    setProject({
      id: projectData.id,
      name: projectData.name,
      description: projectData.description,
      teamId: projectData.teamId,
      teamName: team?.name || 'Unknown Team',
      ownerId: projectData.ownerId,
      githubRepoUrl: projectData.githubRepoUrl,
      githubWebhookSecret: projectData.githubWebhookSecret,
      githubPrTargetStatus: projectData.githubPrTargetStatus as 'REVIEW' | 'COMPLETED' | null,
      components,
      availableSprints,
      teamMembers,
      activities,
      cycleEnabled: workflowConfig?.cycleEnabled ?? true,
      cycleName: workflowConfig?.cycleName || 'Sprint',
      wipLimits: {
        PLANNING: workflowConfig?.wipLimitPlanning ?? null,
        IN_PROGRESS: workflowConfig?.wipLimitInProgress ?? null,
        BLOCKED: workflowConfig?.wipLimitBlocked ?? null,
        REVIEW: workflowConfig?.wipLimitReview ?? null,
        COMPLETED: null,
      },
      updatedAt: projectData.updatedAt,
    });
    setLoading(false);
  };

  useEffect(() => {
    loadProjectData();
  }, [projectId]);

  useEffect(() => {
    const handleStoreUpdate = () => {
      loadProjectData();
    };
    window.addEventListener(DEMO_STORE_UPDATE_EVENT, handleStoreUpdate);
    return () => {
      window.removeEventListener(DEMO_STORE_UPDATE_EVENT, handleStoreUpdate);
    };
  }, [projectId]);

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  const componentsByStatus = useMemo(() => {
    if (!project) {
      return {
        PLANNING: [],
        IN_PROGRESS: [],
        BLOCKED: [],
        REVIEW: [],
        COMPLETED: [],
      };
    }
    return {
      PLANNING: project.components.filter((c) => c.status === 'PLANNING'),
      IN_PROGRESS: project.components.filter((c) => c.status === 'IN_PROGRESS'),
      BLOCKED: project.components.filter((c) => c.status === 'BLOCKED'),
      REVIEW: project.components.filter((c) => c.status === 'REVIEW'),
      COMPLETED: project.components.filter((c) => c.status === 'COMPLETED'),
    };
  }, [project]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="animate-pulse text-slate-400">Loading project...</div>
        </main>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-300 mb-2">Project not found</h1>
            <p className="text-slate-500 mb-4">This project doesn&apos;t exist in demo mode.</p>
            <Link href="/projects" className="btn-primary">
              Back to Projects
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const cycleNamePlural = `${project.cycleName}s`;
  const isKanban = !project.cycleEnabled;
  const currentMembership = project.teamMembers.find((member) => member.id === DEMO_USER.id);
  const canManageGitHub = currentMembership?.role === 'OWNER' || currentMembership?.role === 'ADMIN';
  const isOwner = project.ownerId === DEMO_USER.id;

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Link>

          {/* Project Header */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold">{project.name}</h1>
                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">{project.teamName}</span>
              </div>
              {project.description && <p className="text-slate-400 max-w-2xl">{project.description}</p>}
              <div className="flex items-center gap-4 mt-4 text-sm text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  {project.components.length} components
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {project.teamMembers.length} team members
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  Updated {new Date(project.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <AIGeneratePanelWrapper
                projectId={project.id}
                hasDescription={!!project.description && project.description.length >= 20}
                cycleEnabled={project.cycleEnabled}
                cycleName={project.cycleName}
              />
              <SmartComponentCreator projectId={project.id} />
            </div>
          </div>

          {/* Sprint Timeline */}
          {project.cycleEnabled && project.availableSprints.length > 0 && (
            <SprintTimeline
              sprints={project.availableSprints.map((sprint) => ({
                id: sprint.id,
                name: sprint.name,
                goal: sprint.goal,
                startDate: sprint.startDate,
                endDate: sprint.endDate,
                status: sprint.status,
                capacity: sprint.capacity,
              }))}
              components={project.components.map((c) => ({
                id: c.id,
                status: c.status,
                sprintId: c.sprintId,
                estimatedHours: c.estimatedHours,
              }))}
              teamId={project.teamId}
              cycleName={project.cycleName}
            />
          )}

          {/* Main Content */}
          <div className="grid lg:grid-cols-4 gap-8">
            {/* Kanban Board */}
            <div className="lg:col-span-3">
              {project.components.length === 0 ? (
                <div className="component-card text-center py-16">
                  <Layers className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <h2 className="text-xl font-medium text-slate-300 mb-2">No components yet</h2>
                  <p className="text-slate-500 mb-6 max-w-md mx-auto">
                    Break down your project into components. Each component represents a distinct piece of functionality
                    that can be developed independently.
                  </p>
                  <SmartComponentCreator projectId={project.id} />
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Timeline View */}
                  <TimelineView
                    components={project.components.map((c) => ({
                      id: c.id,
                      name: c.name,
                      status: c.status,
                      estimatedHours: c.estimatedHours,
                      dueDate: c.dueDate,
                      createdAt: c.createdAt,
                      assignments: c.assignments,
                      dependsOn: c.dependsOn.map((d) => ({
                        requiredComponent: {
                          id: d.requiredComponent.id,
                          name: d.requiredComponent.name,
                          status: d.requiredComponent.status,
                        },
                      })),
                    }))}
                  />

                  {/* Dependency Graph */}
                  {project.components.length > 1 && (
                    <div>
                      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <GitBranch className="w-5 h-5 text-cyan-400" />
                        Dependency Graph
                      </h2>
                      <DependencyGraph components={project.components} />
                    </div>
                  )}

                  {/* Status Columns */}
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {(Object.entries(componentsByStatus) as [keyof typeof statusConfig, ComponentData[]][]).map(
                      ([status, statusComponents]) => {
                        const wipLimit = project.wipLimits[status];
                        const isOverLimit = wipLimit && statusComponents.length > wipLimit;
                        const isAtLimit = wipLimit && statusComponents.length === wipLimit;

                        return (
                          <div
                            key={status}
                            className={`space-y-3 rounded-lg p-3 -m-3 transition-colors ${
                              isOverLimit
                                ? 'bg-red-500/5 border-2 border-red-500/40'
                                : isAtLimit
                                  ? 'bg-amber-500/5 border-2 border-amber-500/30'
                                  : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <h3
                                className={`text-sm font-medium flex items-center gap-2 text-${statusConfig[status].color}-400`}
                              >
                                <span className={`w-2 h-2 rounded-full bg-${statusConfig[status].color}-500`} />
                                {statusConfig[status].label}
                                <span className="text-slate-500 font-normal">({statusComponents.length})</span>
                                {wipLimit && (
                                  <span
                                    className={`text-xs px-1.5 py-0.5 rounded ${
                                      isOverLimit
                                        ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse'
                                        : isAtLimit
                                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                          : 'bg-slate-700 text-slate-400'
                                    }`}
                                  >
                                    {statusComponents.length}/{wipLimit}
                                  </span>
                                )}
                              </h3>
                              {isOverLimit && <span className="text-xs text-red-400 font-medium">WIP exceeded!</span>}
                            </div>

                            <div className="space-y-3 min-h-[100px]">
                              {statusComponents.map((component) => (
                                <ComponentCard
                                  key={component.id}
                                  component={component}
                                  teamMembers={project.teamMembers}
                                  availableSprints={project.availableSprints}
                                  showAging={isKanban}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Cycles/Sprints */}
              {project.cycleEnabled && (
                <div className="component-card">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    {cycleNamePlural}
                  </h3>
                  {project.availableSprints.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-sm text-slate-500 mb-3">No active {project.cycleName.toLowerCase()}s</p>
                      <Link
                        href={`/team/${project.teamId}/sprints/new`}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Create {project.cycleName}
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {project.availableSprints.map((sprint) => {
                        const sprintComponents = project.components.filter((c) => c.sprintId === sprint.id);
                        const completed = sprintComponents.filter((c) => c.status === 'COMPLETED').length;
                        const total = sprintComponents.length;
                        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

                        return (
                          <Link
                            key={sprint.id}
                            href={`/team/${project.teamId}/sprints/${sprint.id}`}
                            className="block p-3 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors border border-slate-700/50 hover:border-amber-500/30"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-slate-200 flex items-center gap-2">
                                {sprint.status === 'ACTIVE' ? (
                                  <PlayCircle className="w-4 h-4 text-green-400" />
                                ) : (
                                  <PauseCircle className="w-4 h-4 text-slate-400" />
                                )}
                                {sprint.name}
                              </span>
                              {sprint.status === 'ACTIVE' && (
                                <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span>{total} items</span>
                              <span>•</span>
                              <span>{progress}% done</span>
                            </div>
                            <div className="h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-500 to-green-500"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </Link>
                        );
                      })}
                      <Link
                        href={`/team/${project.teamId}/sprints`}
                        className="block text-center text-sm text-slate-400 hover:text-amber-400 mt-2"
                      >
                        View all {project.cycleName.toLowerCase()}s →
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {/* Team Members */}
              <div className="component-card">
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-400" />
                  Team Members
                </h3>
                <div className="space-y-3">
                  {project.teamMembers.map((member) => (
                    <div key={member.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium">
                        {member.name?.[0] || member.email[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 truncate">{member.name || member.email}</div>
                        <div className="text-xs text-slate-500">{member.role.toLowerCase()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="component-card">
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Recent Activity
                </h3>
                {project.activities.length === 0 ? (
                  <p className="text-sm text-slate-500">No activity yet</p>
                ) : (
                  <div className="space-y-3">
                    {project.activities.slice(0, 5).map((activity) => (
                      <div key={activity.id} className="text-sm">
                        <div className="text-slate-300">
                          <span className="font-medium">{activity.user.name || activity.user.email}</span>{' '}
                          <span className="text-slate-500">{activity.type.replace(/_/g, ' ').toLowerCase()}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {new Date(activity.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* GitHub Integration - only for owner or admin */}
              {canManageGitHub && (
                <GitHubIntegrationSettings
                  projectId={project.id}
                  currentSettings={{
                    githubRepoUrl: project.githubRepoUrl,
                    githubWebhookSecret: project.githubWebhookSecret,
                    githubPrTargetStatus: project.githubPrTargetStatus,
                  }}
                />
              )}

              {/* Danger Zone - only for owner */}
              {isOwner ? (
                <div className="component-card border-red-500/30">
                  <h3 className="text-sm font-medium text-red-400 mb-3">Danger Zone</h3>
                  <DeleteProjectButton projectId={project.id} projectName={project.name} />
                </div>
              ) : (
                <div className="component-card border-slate-700">
                  <p className="text-xs text-slate-500">
                    Owner: {project.ownerId} | You: {DEMO_USER.id}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
