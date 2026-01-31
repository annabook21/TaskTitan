import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  listProjectsForUser,
  listComponentsByProject,
  getTeam,
  type Project,
  type Component,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import {
  Plus,
  FolderKanban,
  Layers,
  Clock,
  ArrowRight,
  Filter,
  Loader2,
} from 'lucide-react';

interface ProjectWithStats extends Project {
  teamName: string;
  componentCount: number;
  componentsByStatus: Record<string, number>;
}

export function ProjectsListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    async function fetchProjects() {
      try {
        const projectsList = await listProjectsForUser();

        // Fetch team names and component counts for each project
        const projectsWithStats: ProjectWithStats[] = await Promise.all(
          projectsList.map(async (project) => {
            const [team, components] = await Promise.all([
              getTeam(project.teamId).catch(() => null),
              listComponentsByProject(project.id).catch(() => [] as Component[]),
            ]);

            // Count components by status
            const componentsByStatus: Record<string, number> = {};
            components.forEach((c) => {
              componentsByStatus[c.status] = (componentsByStatus[c.status] || 0) + 1;
            });

            return {
              ...project,
              teamName: team?.name || 'Unknown Team',
              componentCount: components.length,
              componentsByStatus,
            };
          })
        );

        // Sort by updatedAt desc
        projectsWithStats.sort(
          (a, b) =>
            new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
        );

        setProjects(projectsWithStats);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    }

    fetchProjects();
  }, [isAuthenticated, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <FolderKanban className="w-7 h-7 text-cyan-400" />
          Projects
        </h1>
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading projects...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <FolderKanban className="w-7 h-7 text-cyan-400" />
          Projects
        </h1>
        <p className="text-slate-400 mb-4">Sign in to view your projects.</p>
        <button onClick={() => signInWithRedirect()} className="btn-primary">
          Sign In
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <FolderKanban className="w-7 h-7 text-cyan-400" />
          Projects
        </h1>
        <div className="p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
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
          <Link to="/project/new" className="btn-primary">
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
          <Link to="/project/new" className="btn-primary">
            <Plus className="w-5 h-5" />
            Create Your First Project
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project, index) => (
            <Link
              key={project.id}
              to={`/project/${project.id}`}
              className="component-card group animate-fade-in"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center">
                  <FolderKanban className="w-5 h-5 text-cyan-400" />
                </div>
                <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
                  {project.teamName}
                </span>
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
                    {(project.componentsByStatus.COMPLETED || 0) > 0 && (
                      <div
                        className="bg-emerald-500"
                        style={{
                          width: `${
                            ((project.componentsByStatus.COMPLETED || 0) / project.componentCount) *
                            100
                          }%`,
                        }}
                      />
                    )}
                    {(project.componentsByStatus.IN_PROGRESS || 0) > 0 && (
                      <div
                        className="bg-cyan-500"
                        style={{
                          width: `${
                            ((project.componentsByStatus.IN_PROGRESS || 0) /
                              project.componentCount) *
                            100
                          }%`,
                        }}
                      />
                    )}
                    {(project.componentsByStatus.REVIEW || 0) > 0 && (
                      <div
                        className="bg-amber-500"
                        style={{
                          width: `${
                            ((project.componentsByStatus.REVIEW || 0) / project.componentCount) *
                            100
                          }%`,
                        }}
                      />
                    )}
                    {(project.componentsByStatus.BLOCKED || 0) > 0 && (
                      <div
                        className="bg-red-500"
                        style={{
                          width: `${
                            ((project.componentsByStatus.BLOCKED || 0) / project.componentCount) *
                            100
                          }%`,
                        }}
                      />
                    )}
                    {(project.componentsByStatus.PLANNING || 0) > 0 && (
                      <div
                        className="bg-violet-500"
                        style={{
                          width: `${
                            ((project.componentsByStatus.PLANNING || 0) / project.componentCount) *
                            100
                          }%`,
                        }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    {(project.componentsByStatus.COMPLETED || 0) > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {project.componentsByStatus.COMPLETED} done
                      </span>
                    )}
                    {(project.componentsByStatus.IN_PROGRESS || 0) > 0 && (
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
                    {project.updatedAt
                      ? new Date(project.updatedAt).toLocaleDateString()
                      : 'N/A'}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
