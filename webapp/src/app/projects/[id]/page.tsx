import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Layers,
  GitBranch,
  Users,
  Clock,
  Sparkles,
  Zap,
  PlayCircle,
  PauseCircle,
} from 'lucide-react';
import ComponentCard from './components/ComponentCard';
import SmartComponentCreator from './components/SmartComponentCreator';
import DependencyGraph from './components/DependencyGraph';
import AIGeneratePanelWrapper from './components/AIGeneratePanelWrapper';
import TimelineView from './components/TimelineView';
import DeleteProjectButton from './DeleteProjectButton';
import GitHubIntegrationSettings from './components/GitHubIntegrationSettings';
import SprintTimeline from './components/SprintTimeline';
import DemoProjectDetailPage from './DemoProjectDetailPage';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyProjectAccess } from '@/lib/dynamodb/auth-helpers';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoProjectDetailPage />;
  }

  const entities = getEntities();

  // Fetch project from DynamoDB
  const projectResult = await entities.project.get({ id }).go();
  const project = projectResult.data;

  if (!project) {
    notFound();
  }

  // Fetch team to verify user has access
  const teamResult = await entities.team.get({ id: project.teamId }).go();
  const team = teamResult.data;

  if (!team) {
    notFound();
  }

  // Check user membership via auth-helper
  const access = await verifyProjectAccess(userId, id);
  if (!access) {
    notFound();
  }
  const membership = access.membership;

  // Fetch all related data in parallel
  const [
    membershipsResult,
    sprintsResult,
    workflowConfigResult,
    componentsResult,
    activitiesResult,
    ownerResult,
  ] = await Promise.all([
    entities.membership.query.primary({ teamId: team.id }).go(),
    entities.sprint.query.byTeam({ teamId: team.id }).go(),
    entities.teamWorkflowConfig.get({ teamId: team.id }).go(),
    entities.component.query.byProject({ projectId: id }).go(),
    entities.activity.query.primary({ projectId: id }).go(),
    entities.user.get({ id: project.ownerId }).go(),
  ]);

  // Fetch users for all memberships
  const memberUsers = await Promise.all(
    membershipsResult.data.map(async (m) => {
      const userResult = await entities.user.get({ id: m.userId }).go();
      return { membership: m, user: userResult.data };
    })
  );

  // Active sprints - convert date strings to Date objects
  const availableSprints = sprintsResult.data
    .filter((s) => s.status === 'PLANNING' || s.status === 'ACTIVE')
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .map((s) => ({
      ...s,
      startDate: new Date(s.startDate),
      endDate: new Date(s.endDate),
    }));

  // Fetch component-related data
  const componentsWithRelations = await Promise.all(
    componentsResult.data.slice(0, 200).map(async (c) => {
      const [
        assignmentsResult,
        dependsOnResult,
        dependedOnByResult,
        statusHistoryResult,
        previewResult,
        sprintResult,
      ] = await Promise.all([
        entities.assignment.query.primary({ componentId: c.id }).go(),
        entities.dependency.query.primary({ dependentComponentId: c.id }).go(),
        entities.dependency.query.byRequired({ requiredComponentId: c.id }).go(),
        entities.componentStatusHistory.query.primary({ componentId: c.id }).go(),
        entities.componentPreview.query.primary({ componentId: c.id }).go(),
        c.sprintId ? entities.sprint.get({ id: c.sprintId }).go() : Promise.resolve({ data: null }),
      ]);

      // Fetch assigned users
      const assignments = await Promise.all(
        assignmentsResult.data.map(async (a) => {
          const userResult = await entities.user.get({ id: a.userId }).go();
          return { ...a, user: userResult.data, User: userResult.data };
        })
      );

      // Fetch dependency component info
      const dependsOn = await Promise.all(
        dependsOnResult.data.map(async (d) => {
          const compResult = await entities.component.get({ id: d.requiredComponentId }).go();
          return {
            requiredComponent: compResult.data
              ? { id: compResult.data.id, name: compResult.data.name, status: compResult.data.status, type: compResult.data.type }
              : { id: d.requiredComponentId, name: 'Unknown', status: 'PLANNING', type: 'TASK' },
          };
        })
      );

      const dependedOnBy = await Promise.all(
        dependedOnByResult.data.map(async (d) => {
          const compResult = await entities.component.get({ id: d.dependentComponentId }).go();
          return {
            dependentComponent: compResult.data
              ? { id: compResult.data.id, name: compResult.data.name, status: compResult.data.status, type: compResult.data.type }
              : { id: d.dependentComponentId, name: 'Unknown', status: 'PLANNING', type: 'TASK' },
          };
        })
      );

      // Sort status history
      const sortedHistory = statusHistoryResult.data.sort(
        (a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime()
      );

      const currentStatusEntry = sortedHistory.find((h) => !h.exitedAt) || sortedHistory[sortedHistory.length - 1];

      // Calculate cycle time for completed items
      let cycleTimeDays: number | null = null;
      if (c.status === 'COMPLETED') {
        const inProgressEntry = sortedHistory.find((h) => h.status === 'IN_PROGRESS');
        const completedEntry = sortedHistory.find((h) => h.status === 'COMPLETED');
        if (inProgressEntry && completedEntry) {
          const cycleTimeMs = new Date(completedEntry.enteredAt).getTime() - new Date(inProgressEntry.enteredAt).getTime();
          cycleTimeDays = Math.round((cycleTimeMs / (1000 * 60 * 60 * 24)) * 10) / 10;
        }
      }

      // Get latest preview
      const sortedPreviews = previewResult.data.sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      );
      const latestPreview = sortedPreviews[0];

      return {
        ...c,
        // Normalize undefined to null/defaults for optional fields
        priority: c.priority ?? 0,
        estimatedHours: c.estimatedHours ?? null,
        actualHours: c.actualHours ?? null,
        description: c.description ?? null,
        parentId: c.parentId ?? null,
        dueDate: c.dueDate ? new Date(c.dueDate) : null,
        owner: c.owner ?? null,
        externalId: c.externalId ?? null,
        // Map DynamoDB context fields to expected names
        contextSummary: c.contextAiSummary ?? null,
        contextDetail: c.contextRationale ?? null,
        contextFiles: c.contextLinks ?? null,
        contextDecision: c.contextDecision ?? null,
        contextAlternatives: c.contextAlternatives ?? null,
        contextUpdatedAt: c.contextUpdatedAt ?? null,
        contextUpdatedBy: c.contextUpdatedBy ?? null,
        githubPrUrl: c.githubPrUrl ?? null,
        githubPrNumber: c.githubPrNumber ?? null,
        githubPrTitle: c.githubPrTitle ?? null,
        githubPrStatus: c.githubPrStatus ?? null,
        githubPrUpdatedAt: c.githubPrUpdatedAt ?? null,
        createdAt: new Date(c.createdAt ?? Date.now()),
        updatedAt: new Date(c.updatedAt ?? Date.now()),
        sprint: sprintResult.data ? { ...sprintResult.data, startDate: new Date(sprintResult.data.startDate), endDate: new Date(sprintResult.data.endDate) } : null,
        Sprint: sprintResult.data ? { ...sprintResult.data, startDate: new Date(sprintResult.data.startDate), endDate: new Date(sprintResult.data.endDate) } : null,
        sprintId: c.sprintId ?? null,
        assignments,
        Assignment: assignments,
        dependsOn,
        Dependency_Dependency_dependentComponentIdToComponent: dependsOn.map((d) => ({
          Component_Dependency_requiredComponentIdToComponent: d.requiredComponent,
        })),
        dependedOnBy,
        Dependency_Dependency_requiredComponentIdToComponent: dependedOnBy.map((d) => ({
          Component_Dependency_dependentComponentIdToComponent: d.dependentComponent,
        })),
        Preview: latestPreview ? [{ id: latestPreview.id, htmlContent: latestPreview.htmlContent }] : [],
        StatusHistory: sortedHistory,
        statusEnteredAt: currentStatusEntry?.enteredAt ? new Date(currentStatusEntry.enteredAt) : new Date(c.createdAt ?? Date.now()),
        cycleTimeDays,
      };
    })
  );

  // Sort components by priority desc, createdAt asc
  const components = componentsWithRelations.sort((a, b) => {
    const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  // Fetch activity users
  const sortedActivities = activitiesResult.data
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 10);

  const activities = await Promise.all(
    sortedActivities.map(async (a) => {
      const userResult = await entities.user.get({ id: a.userId }).go();
      return {
        ...a,
        createdAt: new Date(a.createdAt ?? Date.now()),
        user: userResult.data || { id: a.userId, email: 'unknown', name: null },
        User: userResult.data || { id: a.userId, email: 'unknown', name: null },
      };
    })
  );

  // Group components by status
  const componentsByStatus = {
    PLANNING: components.filter((c) => c.status === 'PLANNING'),
    IN_PROGRESS: components.filter((c) => c.status === 'IN_PROGRESS'),
    BLOCKED: components.filter((c) => c.status === 'BLOCKED'),
    REVIEW: components.filter((c) => c.status === 'REVIEW'),
    COMPLETED: components.filter((c) => c.status === 'COMPLETED'),
  };

  const statusConfig = {
    PLANNING: { label: 'Planning', color: 'violet' },
    IN_PROGRESS: { label: 'In Progress', color: 'cyan' },
    BLOCKED: { label: 'Blocked', color: 'red' },
    REVIEW: { label: 'Review', color: 'amber' },
    COMPLETED: { label: 'Completed', color: 'emerald' },
  };

  const teamMembers = memberUsers
    .filter((m) => m.user)
    .map((m) => m.user!);

  const teamWithMembership = {
    ...team,
    Membership: memberUsers.map((m) => ({
      userId: m.membership.userId,
      role: m.membership.role,
      User: m.user || { id: m.membership.userId, email: 'unknown', name: null },
    })),
  };

  const workflowConfig = workflowConfigResult.data;
  const cycleEnabled = workflowConfig?.cycleEnabled ?? true;
  const cycleName = workflowConfig?.cycleName || 'Sprint';
  const cycleNamePlural = `${cycleName}s`;
  const isKanban = !cycleEnabled;

  // Get WIP limits for each status
  const wipLimits = {
    PLANNING: workflowConfig?.wipLimitPlanning ?? undefined,
    IN_PROGRESS: workflowConfig?.wipLimitInProgress ?? undefined,
    BLOCKED: workflowConfig?.wipLimitBlocked ?? undefined,
    REVIEW: workflowConfig?.wipLimitReview ?? undefined,
    COMPLETED: null,
  };

  const projectData = {
    ...project,
    updatedAt: new Date(project.updatedAt ?? Date.now()),
    githubRepoUrl: project.githubRepoUrl ?? null,
    githubWebhookSecret: project.githubWebhookSecret ?? null,
    githubPrTargetStatus: project.githubPrTargetStatus ?? null,
  };

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
                <h1 className="text-3xl font-bold">{projectData.name}</h1>
                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">{team.name}</span>
              </div>
              {projectData.description && <p className="text-slate-400 max-w-2xl">{projectData.description}</p>}
              <div className="flex items-center gap-4 mt-4 text-sm text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  {components.length} components
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {teamWithMembership.Membership.length} team members
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  Updated {projectData.updatedAt.toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <AIGeneratePanelWrapper
                projectId={projectData.id}
                hasDescription={!!projectData.description && projectData.description.length >= 20}
                cycleEnabled={cycleEnabled}
                cycleName={cycleName}
              />
              <SmartComponentCreator projectId={projectData.id} />
            </div>
          </div>

          {/* Sprint Timeline - only show if cycles are enabled */}
          {cycleEnabled && availableSprints.length > 0 && (
            <SprintTimeline sprints={availableSprints} components={components} teamId={team.id} cycleName={cycleName} />
          )}

          {/* Main Content */}
          <div className="grid lg:grid-cols-4 gap-8">
            {/* Kanban Board */}
            <div className="lg:col-span-3">
              {components.length === 0 ? (
                <div className="component-card text-center py-16">
                  <Layers className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <h2 className="text-xl font-medium text-slate-300 mb-2">No components yet</h2>
                  <p className="text-slate-500 mb-6 max-w-md mx-auto">
                    Break down your project into components. Each component represents a distinct piece of functionality
                    that can be developed independently.
                  </p>
                  <SmartComponentCreator projectId={projectData.id} />
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Timeline View */}
                  {components.length > 0 && (
                    <TimelineView
                      components={components.map((c) => ({
                        ...c,
                        dependsOn: c.dependsOn.map((d) => ({
                          requiredComponent: {
                            id: d.requiredComponent.id,
                            name: d.requiredComponent.name,
                            status: d.requiredComponent.status,
                          },
                        })),
                      })) as any}
                    />
                  )}

                  {/* Dependency Graph */}
                  {components.length > 1 && (
                    <div>
                      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <GitBranch className="w-5 h-5 text-cyan-400" />
                        Dependency Graph
                      </h2>
                      <DependencyGraph components={components} />
                    </div>
                  )}

                  {/* Status Columns */}
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {(Object.entries(componentsByStatus) as [keyof typeof statusConfig, typeof components][]).map(
                      ([status, statusComponents]) => {
                        const wipLimit = wipLimits[status];
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
                                  component={component as any}
                                  teamMembers={teamMembers as any}
                                  availableSprints={availableSprints as any}
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
              {/* Cycles/Sprints - only show when cycles are enabled */}
              {cycleEnabled && (
                <div className="component-card">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    {cycleNamePlural}
                  </h3>
                  {availableSprints.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-sm text-slate-500 mb-3">No active {cycleName.toLowerCase()}s</p>
                      <Link
                        href={`/team/${team.id}/sprints/new`}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Create {cycleName}
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {availableSprints.map((sprint) => {
                        const sprintComponents = components.filter((c) => c.sprintId === sprint.id);
                        const completed = sprintComponents.filter((c) => c.status === 'COMPLETED').length;
                        const total = sprintComponents.length;
                        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

                        return (
                          <Link
                            key={sprint.id}
                            href={`/team/${team.id}/sprints/${sprint.id}`}
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
                        href={`/team/${team.id}/sprints`}
                        className="block text-center text-sm text-slate-400 hover:text-amber-400 mt-2"
                      >
                        View all {cycleName.toLowerCase()}s →
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
                  {teamWithMembership.Membership.map(({ User: memberUser, role }) => (
                    <div key={memberUser.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium">
                        {memberUser.name?.[0] || memberUser.email[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 truncate">{memberUser.name || memberUser.email}</div>
                        <div className="text-xs text-slate-500">{role.toLowerCase()}</div>
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
                {activities.length === 0 ? (
                  <p className="text-sm text-slate-500">No activity yet</p>
                ) : (
                  <div className="space-y-3">
                    {activities.slice(0, 5).map((activity) => (
                      <div key={activity.id} className="text-sm">
                        <div className="text-slate-300">
                          <span className="font-medium">{activity.user.name || activity.user.email}</span>{' '}
                          <span className="text-slate-500">{activity.type.replace(/_/g, ' ').toLowerCase()}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {activity.createdAt.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* GitHub Integration - only for owner or admin */}
              {teamWithMembership.Membership.some((m) => m.User.id === userId && (m.role === 'OWNER' || m.role === 'ADMIN')) && (
                <GitHubIntegrationSettings
                  projectId={projectData.id}
                  currentSettings={{
                    githubRepoUrl: projectData.githubRepoUrl,
                    githubWebhookSecret: projectData.githubWebhookSecret,
                    githubPrTargetStatus: projectData.githubPrTargetStatus,
                  }}
                />
              )}

              {/* Danger Zone - only for owner */}
              {String(projectData.ownerId) === String(userId) ? (
                <div className="component-card border-red-500/30">
                  <h3 className="text-sm font-medium text-red-400 mb-3">Danger Zone</h3>
                  <DeleteProjectButton projectId={projectData.id} projectName={projectData.name} />
                </div>
              ) : (
                <div className="component-card border-slate-700">
                  <p className="text-xs text-slate-500">
                    Owner: {projectData.ownerId} | You: {userId}
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
