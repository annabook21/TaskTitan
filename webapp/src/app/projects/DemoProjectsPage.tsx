'use client';

import { useEffect, useState } from 'react';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { Plus, FolderKanban, Layers, Clock, ArrowRight, Filter } from 'lucide-react';

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  teamName: string;
  componentCount: number;
  componentsByStatus: Record<string, number>;
  updatedAt: string;
}

export default function DemoProjectsPage() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const store = demoStore.getStore();

    // Get all projects
    const projectData = store.projects.map((project) => {
      const team = store.teams.find((t) => t.id === project.teamId);
      const components = store.components.filter((c) => c.projectId === project.id);

      // Count by status
      const componentsByStatus: Record<string, number> = {};
      for (const comp of components) {
        componentsByStatus[comp.status] = (componentsByStatus[comp.status] || 0) + 1;
      }

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        teamName: team?.name || 'Unknown Team',
        componentCount: components.length,
        componentsByStatus,
        updatedAt: project.updatedAt,
      };
    });

    setProjects(projectData);
    setLoading(false);
  }, []);

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
          <div className="animate-pulse text-slate-400">Loading projects...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-3">
                <FolderKanban className="w-7 h-7 text-cyan-400" />
                Projects
              </h1>
              <p className="text-slate-400 mt-1">
                {projects.length} project{projects.length !== 1 ? 's' : ''} across all teams
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button className="btn-secondary text-sm" disabled>
                <Filter className="w-4 h-4" />
                Filter
              </button>
              <Link href="/projects/new" className="btn-primary">
                <Plus className="w-5 h-5" />
                New Project
              </Link>
            </div>
          </div>

          {/* Projects Grid */}
          {projects.length === 0 ? (
            <div className="component-card text-center py-16">
              <Layers className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-slate-300 mb-2">No projects yet</h2>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                Create your first project to start breaking down your application into components
              </p>
              <Link href="/projects/new" className="btn-primary">
                <Plus className="w-5 h-5" />
                Create Your First Project
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map((project, index) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="component-card group animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center">
                      <FolderKanban className="w-5 h-5 text-cyan-400" />
                    </div>
                    <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">{project.teamName}</span>
                  </div>

                  <h3 className="text-lg font-semibold text-slate-100 group-hover:text-cyan-400 transition-colors mb-2">
                    {project.name}
                  </h3>

                  {project.description && (
                    <p className="text-sm text-slate-400 line-clamp-2 mb-4">{project.description}</p>
                  )}

                  {/* Component Status Bar */}
                  {project.componentCount > 0 && (
                    <div className="mb-4">
                      <div className="flex h-2 rounded-full overflow-hidden bg-slate-800">
                        {project.componentsByStatus.COMPLETED > 0 && (
                          <div
                            className="bg-emerald-500"
                            style={{
                              width: `${(project.componentsByStatus.COMPLETED / project.componentCount) * 100}%`,
                            }}
                          />
                        )}
                        {project.componentsByStatus.IN_PROGRESS > 0 && (
                          <div
                            className="bg-cyan-500"
                            style={{
                              width: `${(project.componentsByStatus.IN_PROGRESS / project.componentCount) * 100}%`,
                            }}
                          />
                        )}
                        {project.componentsByStatus.REVIEW > 0 && (
                          <div
                            className="bg-amber-500"
                            style={{
                              width: `${(project.componentsByStatus.REVIEW / project.componentCount) * 100}%`,
                            }}
                          />
                        )}
                        {project.componentsByStatus.BLOCKED > 0 && (
                          <div
                            className="bg-red-500"
                            style={{
                              width: `${(project.componentsByStatus.BLOCKED / project.componentCount) * 100}%`,
                            }}
                          />
                        )}
                        {project.componentsByStatus.PLANNING > 0 && (
                          <div
                            className="bg-violet-500"
                            style={{
                              width: `${(project.componentsByStatus.PLANNING / project.componentCount) * 100}%`,
                            }}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        {project.componentsByStatus.COMPLETED > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            {project.componentsByStatus.COMPLETED} done
                          </span>
                        )}
                        {project.componentsByStatus.IN_PROGRESS > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-cyan-500" />
                            {project.componentsByStatus.IN_PROGRESS} active
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5" />
                        {project.componentCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
