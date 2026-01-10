import { prisma } from '@/lib/prisma';
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
  MoreVertical,
  Sparkles,
  Zap,
  PlayCircle,
  PauseCircle,
} from 'lucide-react';
import ComponentCard from './components/ComponentCard';
import CreateComponentForm from './components/CreateComponentForm';
import DependencyGraph from './components/DependencyGraph';
import AIGeneratePanel from './components/AIGeneratePanel';
import TimelineView from './components/TimelineView';
import DeleteProjectButton from './DeleteProjectButton';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  const { userId, user } = await getSession();

  const project = await prisma.project.findFirst({
    where: {
      id,
      Team: { Membership: { some: { userId } } },
    },
    include: {
      Team: {
        include: {
          Membership: {
            include: { User: true },
          },
          Sprint: {
            where: { status: { in: ['PLANNING', 'ACTIVE'] } },
            orderBy: { startDate: 'asc' },
          },
        },
      },
      User: true,
      Component: {
        include: {
          Assignment: {
            include: { User: true },
          },
          Sprint: true,
          Dependency_Dependency_dependentComponentIdToComponent: {
            include: { Component_Dependency_requiredComponentIdToComponent: true },
          },
          Dependency_Dependency_requiredComponentIdToComponent: {
            include: { Component_Dependency_dependentComponentIdToComponent: true },
          },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      },
      Activity: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { User: true },
      },
    },
  });

  if (!project) {
    notFound();
  }

  // Map components for easier use
  const components = project.Component.map((c) => ({
    ...c,
    sprint: c.Sprint,
    assignments: c.Assignment.map((a) => ({ ...a, user: a.User })),
    dependsOn: c.Dependency_Dependency_dependentComponentIdToComponent.map((d) => ({
      requiredComponent: d.Component_Dependency_requiredComponentIdToComponent,
    })),
    dependedOnBy: c.Dependency_Dependency_requiredComponentIdToComponent.map((d) => ({
      dependentComponent: d.Component_Dependency_dependentComponentIdToComponent,
    })),
  }));

  // Get available sprints for this team
  const availableSprints = project.Team.Sprint || [];

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

  const team = project.Team;
  const teamMembers = team.Membership.map((m) => m.User);
  const activities = project.Activity.map((a) => ({ ...a, user: a.User }));

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
                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">{team.name}</span>
              </div>
              {project.description && <p className="text-slate-400 max-w-2xl">{project.description}</p>}
              <div className="flex items-center gap-4 mt-4 text-sm text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  {components.length} components
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {team.Membership.length} team members
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  Updated {new Date(project.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <AIGeneratePanel
                projectId={project.id}
                hasDescription={!!project.description && project.description.length >= 20}
              />
              <CreateComponentForm projectId={project.id} />
            </div>
          </div>

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
                  <CreateComponentForm projectId={project.id} />
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
                      }))}
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
                      ([status, statusComponents]) => (
                        <div key={status} className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h3
                              className={`text-sm font-medium flex items-center gap-2 text-${statusConfig[status].color}-400`}
                            >
                              <span className={`w-2 h-2 rounded-full bg-${statusConfig[status].color}-500`} />
                              {statusConfig[status].label}
                              <span className="text-slate-500 font-normal">({statusComponents.length})</span>
                            </h3>
                          </div>

                          <div className="space-y-3 min-h-[100px]">
                            {statusComponents.map((component) => (
                              <ComponentCard
                                key={component.id}
                                component={component}
                                teamMembers={teamMembers}
                                availableSprints={availableSprints}
                              />
                            ))}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Sprints */}
              <div className="component-card">
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Sprints
                </h3>
                {availableSprints.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-slate-500 mb-3">No active sprints</p>
                    <Link
                      href={`/team/${team.id}/sprints/new`}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Create Sprint
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
                              <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">Active</span>
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
                      View all sprints →
                    </Link>
                  </div>
                )}
              </div>

              {/* Team Members */}
              <div className="component-card">
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4 text-violet-400" />
                  Team Members
                </h3>
                <div className="space-y-3">
                  {team.Membership.map(({ User: user, role }) => (
                    <div key={user.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium">
                        {user.name?.[0] || user.email[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 truncate">{user.name || user.email}</div>
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
                          {new Date(activity.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Danger Zone - only for owner */}
              {String(project.ownerId) === String(userId) ? (
                <div className="component-card border-red-500/30">
                  <h3 className="text-sm font-medium text-red-400 mb-3">Danger Zone</h3>
                  <DeleteProjectButton projectId={project.id} projectName={project.name} />
                </div>
              ) : (
                <div className="component-card border-slate-700">
                  <p className="text-xs text-slate-500">
                    Owner: {project.ownerId} | You: {userId}
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
