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
import {
  fetchProjectDetailData,
  batchFetchUsers,
  batchFetchSprints,
  batchFetchPreviewsByComponents,
} from '@/lib/dynamodb/batch-queries';

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

  // Fetch all related data in parallel (batch queries for project detail)
  const [
    membershipsResult,
    sprintsResult,
    workflowConfigResult,
    projectDetailData,
    activitiesResult,
    ownerResult,
  ] = await Promise.all([
    entities.membership.query.primary({ teamId: team.id }).go(),
    entities.sprint.query.byTeam({ teamId: team.id }).go(),
    entities.teamWorkflowConfig.get({ teamId: team.id }).go(),
    fetchProjectDetailData(id),
    entities.activity.query.primary({ projectId: id }).go(),
    entities.user.get({ id: project.ownerId }).go(),
  ]);

  const { components: rawComponents, assignmentsMap, dependenciesMap, statusHistoryMap, usersMap } = projectDetailData;

  // Batch fetch users for memberships
  const memberUserIds = membershipsResult.data.map((m) => m.userId);
  const memberUsersMap = await batchFetchUsers(memberUserIds);
  const memberUsers = membershipsResult.data.map((m) => ({
    membership: m,
    user: memberUsersMap.get(m.userId) ?? null,
  }));

  // Active sprints - convert date strings to Date objects
  const availableSprints = sprintsResult.data
    .filter((s) => s.status === 'PLANNING' || s.status === 'ACTIVE')
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .map((s) => ({
      ...s,
      startDate: new Date(s.startDate),
      endDate: new Date(s.endDate),
    }));

  // Batch fetch sprints and previews for components (no N+1)
  const uniqueSprintIds = [...new Set(rawComponents.map((c) => c.sprintId).filter(Boolean))] as string[];
  const sprintMap = await batchFetchSprints(uniqueSprintIds);
  const previewsByComponent = await batchFetchPreviewsByComponents(rawComponents.map((c) => c.id));

  const componentMap = new Map(rawComponents.map((c) => [c.id, c]));

  // Build componentsWithRelations from batch data (no N+1)
  const componentsWithRelations = rawComponents.slice(0, 200).map((c, idx) => {
    const assignments = (assignmentsMap.get(c.id) ?? []).map((a) => ({
      ...a,
      user: usersMap.get(a.userId) ?? null,
      User: usersMap.get(a.userId) ?? null,
    }));
    const dependsOnData = dependenciesMap.dependsOn.get(c.id) ?? [];
    const dependedOnByData = dependenciesMap.requiredBy.get(c.id) ?? [];
    const dependsOn = dependsOnData.map((d) => ({
      requiredComponent: componentMap.get(d.requiredComponentId) ?? {
        id: d.requiredComponentId,
        name: 'Unknown',
        status: 'PLANNING',
        type: 'TASK',
      },
    }));
    const dependedOnBy = dependedOnByData.map((d) => ({
      dependentComponent: componentMap.get(d.dependentComponentId) ?? {
        id: d.dependentComponentId,
        name: 'Unknown',
        status: 'PLANNING',
        type: 'TASK',
      },
    }));
    const statusHistoryData = statusHistoryMap.get(c.id) ?? [];
    const sortedHistory = [...statusHistoryData].sort(
      (a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime()
    );
    const currentStatusEntry = sortedHistory.find((h) => !h.exitedAt) ?? sortedHistory[sortedHistory.length - 1];
    let cycleTimeDays: number | null = null;
    if (c.status === 'COMPLETED') {
      const inProgressEntry = sortedHistory.find((h) => h.status === 'IN_PROGRESS');
      const completedEntry = sortedHistory.find((h) => h.status === 'COMPLETED');
      if (inProgressEntry && completedEntry) {
        const cycleTimeMs = new Date(completedEntry.enteredAt).getTime() - new Date(inProgressEntry.enteredAt).getTime();
        cycleTimeDays = Math.round((cycleTimeMs / (1000 * 60 * 60 * 24)) * 10) / 10;
      }
    }
    const previewList = previewsByComponent.get(c.id) ?? [];
    const sortedPreviews = [...previewList].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );
    const latestPreview = sortedPreviews[0] ?? null;
    const sprintData = c.sprintId ? sprintMap.get(c.sprintId) : null;

    return {
      ...c,
      priority: c.priority ?? 0,
      estimatedHours: c.estimatedHours ?? null,
      actualHours: c.actualHours ?? null,
      description: c.description ?? null,
      parentId: c.parentId ?? null,
      dueDate: c.dueDate ? new Date(c.dueDate) : null,
      owner: c.owner ?? null,
      externalId: c.externalId ?? null,
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
      sprint: sprintData ? { ...sprintData, startDate: new Date(sprintData.startDate), endDate: new Date(sprintData.endDate) } : null,
      Sprint: sprintData ? { ...sprintData, startDate: new Date(sprintData.startDate), endDate: new Date(sprintData.endDate) } : null,
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
  });

  // Sort components by priority desc, createdAt asc
  const components = componentsWithRelations.sort((a, b) => {
    const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  // Batch fetch activity users
  const sortedActivities = activitiesResult.data
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 10);
  const activityUserIds = sortedActivities.map((a) => a.userId);
  const activityUsersMap = await batchFetchUsers(activityUserIds);
  const activities = sortedActivities.map((a) => {
    const activityUser = activityUsersMap.get(a.userId);
    return {
      ...a,
      createdAt: new Date(a.createdAt ?? Date.now()),
      user: activityUser ?? { id: a.userId, email: 'unknown', name: null },
      User: activityUser ?? { id: a.userId, email: 'unknown', name: null },
    };
  });

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
