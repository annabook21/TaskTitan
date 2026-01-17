'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import type { DemoComponent, DemoSprint, DemoDependency } from '@/lib/demo/types';
import Header from '@/components/Header';
import Link from 'next/link';
import {
  ArrowLeft,
  Layers,
  Clock,
  ChevronRight,
  GitBranch,
  Zap,
  Plus,
  PlayCircle,
  PauseCircle,
} from 'lucide-react';
import SmartComponentCreator from './components/SmartComponentCreator';
import AIGeneratePanel from './components/AIGeneratePanel';
import DeleteProjectButton from './DeleteProjectButton';
import SprintTimeline from './components/SprintTimeline';
import DependencyGraph from './components/DependencyGraph';
import { DEMO_STORE_UPDATE_EVENT } from '@/hooks/use-demo-action';

const statusColors: Record<string, string> = {
  PLANNING: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  IN_PROGRESS: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  REVIEW: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  BLOCKED: 'bg-red-500/20 text-red-300 border-red-500/30',
  COMPLETED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const typeColors: Record<string, string> = {
  EPIC: 'bg-purple-500/20 text-purple-300',
  FEATURE: 'bg-blue-500/20 text-blue-300',
  STORY: 'bg-cyan-500/20 text-cyan-300',
  TASK: 'bg-slate-500/20 text-slate-300',
  BUG: 'bg-red-500/20 text-red-300',
};

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  teamName: string;
  teamId: string;
  components: DemoComponent[];
  sprints: DemoSprint[];
  dependencies: DemoDependency[];
  updatedAt: string;
  cycleEnabled: boolean;
  cycleName: string;
}

export default function DemoProjectDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.id as string;
  const generateAI = searchParams.get('generateAI') === 'true';
  const [project, setProject] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Load project data from demo store
  const loadProjectData = () => {
    const store = demoStore.getStore();

    const projectData = store.projects.find((p) => p.id === projectId);
    if (!projectData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const team = store.teams.find((t) => t.id === projectData.teamId);
    const components = store.components.filter((c) => c.projectId === projectId);
    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === projectData.teamId);

    // Load sprints for this team
    const sprints = store.sprints.filter((s) => s.teamId === projectData.teamId);

    // Load dependencies for components in this project
    const componentIds = new Set(components.map((c) => c.id));
    const dependencies = store.dependencies.filter(
      (d) => componentIds.has(d.dependentComponentId) || componentIds.has(d.requiredComponentId)
    );

    setProject({
      id: projectData.id,
      name: projectData.name,
      description: projectData.description,
      teamName: team?.name || 'Unknown Team',
      teamId: projectData.teamId,
      components,
      sprints,
      dependencies,
      updatedAt: projectData.updatedAt,
      cycleEnabled: workflowConfig?.cycleEnabled ?? true,
      cycleName: workflowConfig?.cycleName || 'Sprint',
    });
    setLoading(false);
  };

  // Load on mount
  useEffect(() => {
    loadProjectData();
  }, [projectId]);

  // Listen for demo store updates to refresh data
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

  // Organize components by hierarchy
  const topLevelComponents = project.components.filter((c) => !c.parentId);
  const getChildren = (parentId: string) => project.components.filter((c) => c.parentId === parentId);

  // Stats
  const statusCounts = project.components.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

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
                <Link
                  href={`/team/${project.teamId}`}
                  className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded hover:bg-slate-700"
                >
                  {project.teamName}
                </Link>
              </div>
              {project.description && <p className="text-slate-400 max-w-2xl">{project.description}</p>}
              <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  {project.components.length} components
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
                autoOpen={generateAI}
                cycleEnabled={project.cycleEnabled}
                cycleName={project.cycleName}
              />
              <SmartComponentCreator projectId={project.id} />
              <DeleteProjectButton projectId={project.id} projectName={project.name} />
            </div>
          </div>

          {/* Status Overview */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            {['PLANNING', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'].map((status) => (
              <div key={status} className={`component-card border ${statusColors[status]}`}>
                <div className="text-2xl font-bold">{statusCounts[status] || 0}</div>
                <div className="text-xs opacity-70">{status.replace('_', ' ')}</div>
              </div>
            ))}
          </div>

          {/* Sprint Timeline - only show if cycles are enabled and sprints exist */}
          {project.cycleEnabled && project.sprints.length > 0 && (
            <SprintTimeline
              sprints={project.sprints.map((s) => ({
                id: s.id,
                name: s.name,
                goal: s.goal,
                startDate: s.startDate ? new Date(s.startDate) : new Date(),
                endDate: s.endDate ? new Date(s.endDate) : new Date(),
                status: s.status,
                capacity: s.capacity,
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

          {/* Main Content Grid */}
          <div className="grid lg:grid-cols-4 gap-8">
            {/* Main content area */}
            <div className="lg:col-span-3 space-y-8">
              {/* Dependency Graph */}
              {project.components.length > 1 && project.dependencies.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <GitBranch className="w-5 h-5 text-cyan-400" />
                    Dependency Graph
                  </h2>
                  <DependencyGraph
                    components={project.components.map((c) => {
                      // Build dependency relationships for this component
                      const dependsOn = project.dependencies
                        .filter((d) => d.dependentComponentId === c.id)
                        .map((d) => {
                          const reqComp = project.components.find((comp) => comp.id === d.requiredComponentId);
                          return {
                            requiredComponent: {
                              id: d.requiredComponentId,
                              name: reqComp?.name || 'Unknown',
                            },
                          };
                        });

                      const dependedOnBy = project.dependencies
                        .filter((d) => d.requiredComponentId === c.id)
                        .map((d) => {
                          const depComp = project.components.find((comp) => comp.id === d.dependentComponentId);
                          return {
                            dependentComponent: {
                              id: d.dependentComponentId,
                              name: depComp?.name || 'Unknown',
                            },
                          };
                        });

                      return {
                        id: c.id,
                        name: c.name,
                        status: c.status,
                        dependsOn,
                        dependedOnBy,
                      };
                    })}
                  />
                </div>
              )}

              {/* Components List */}
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-cyan-400" />
                  Components
                </h2>

                {project.components.length === 0 ? (
                  <div className="component-card text-center py-12">
                    <Layers className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-300 mb-2">No components yet</h3>
                    <p className="text-slate-500 mb-6">
                      Start by adding your first component or use AI to generate them
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {topLevelComponents.map((component) => (
                      <ComponentItem key={component.id} component={component} getChildren={getChildren} depth={0} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Sprints sidebar - only show when cycles are enabled */}
              {project.cycleEnabled && (
                <div className="component-card">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    {project.cycleName}s
                  </h3>
                  {project.sprints.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-sm text-slate-500 mb-3">No {project.cycleName.toLowerCase()}s yet</p>
                      <p className="text-xs text-slate-600">
                        Use AI Generate to create {project.cycleName.toLowerCase()}s with work items
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {project.sprints.map((sprint) => {
                        const sprintComponents = project.components.filter((c) => c.sprintId === sprint.id);
                        const completed = sprintComponents.filter((c) => c.status === 'COMPLETED').length;
                        const total = sprintComponents.length;
                        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

                        return (
                          <div
                            key={sprint.id}
                            className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50"
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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Project info */}
              <div className="component-card">
                <h3 className="font-medium mb-4 text-slate-300">Project Info</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Team</span>
                    <span className="text-slate-300">{project.teamName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Workflow</span>
                    <span className="text-slate-300">{project.cycleEnabled ? 'Scrum' : 'Kanban'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Components</span>
                    <span className="text-slate-300">{project.components.length}</span>
                  </div>
                  {project.dependencies.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Dependencies</span>
                      <span className="text-slate-300">{project.dependencies.length}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ComponentItem({
  component,
  getChildren,
  depth,
}: {
  component: DemoComponent;
  getChildren: (parentId: string) => DemoComponent[];
  depth: number;
}) {
  const children = getChildren(component.id);
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div className={depth > 0 ? 'ml-6 border-l border-slate-700 pl-4' : ''}>
      <div
        className="component-card flex items-center gap-4 cursor-pointer hover:bg-slate-800/80"
        onClick={() => children.length > 0 && setExpanded(!expanded)}
      >
        {children.length > 0 && (
          <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        )}
        {children.length === 0 && <div className="w-4" />}

        <span className={`text-xs px-2 py-0.5 rounded ${typeColors[component.type]}`}>{component.type}</span>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-slate-200 truncate">{component.name}</h3>
          {component.description && <p className="text-sm text-slate-500 truncate">{component.description}</p>}
        </div>

        <span className={`text-xs px-2 py-1 rounded border ${statusColors[component.status]}`}>
          {component.status.replace('_', ' ')}
        </span>

        {component.estimatedHours && <span className="text-xs text-slate-500">{component.estimatedHours}h</span>}
      </div>

      {expanded && children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map((child) => (
            <ComponentItem key={child.id} component={child} getChildren={getChildren} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
