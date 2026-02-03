import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import {
  listTeamsForUser,
  listProjectsForUser,
  listComponentsByProject,
  type TeamWithMembers,
  type Project,
} from '../api/appsync';
import {
  FolderKanban,
  Users,
  Upload,
  Plus,
  ArrowRight,
  Sparkles,
  Layers,
  Clock,
  LogIn,
} from 'lucide-react';

interface DashboardStats {
  totalProjects: number;
  totalComponents: number;
  totalTeams: number;
  totalMembers: number;
}

interface ProjectWithCount extends Project {
  componentCount: number;
}

export function HomePage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [recentProjects, setRecentProjects] = useState<ProjectWithCount[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalProjects: 0,
    totalComponents: 0,
    totalTeams: 0,
    totalMembers: 0,
  });

  useEffect(() => {
    async function loadDashboard() {
      try {
        // Check auth first - this page is protected so should always succeed
        await getCurrentUser();
        setSignedIn(true);

        // Fetch teams and projects in parallel
        const [teamsData, projectsData] = await Promise.all([
          listTeamsForUser(),
          listProjectsForUser(),
        ]);

        setTeams(teamsData);

        // Sort projects by updatedAt and take recent 5
        const sortedProjects = [...projectsData]
          .sort((a, b) => {
            const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
            const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
            return bTime - aTime;
          })
          .slice(0, 5);

        // Fetch component counts for recent projects
        const projectsWithCounts = await Promise.all(
          sortedProjects.map(async (project) => {
            try {
              const components = await listComponentsByProject(project.id);
              return { ...project, componentCount: components.length };
            } catch {
              return { ...project, componentCount: 0 };
            }
          })
        );

        setRecentProjects(projectsWithCounts);

        // Calculate stats - use Math.max to handle stale memberCount from old teams
        const totalMembers = teamsData.reduce((acc, t) => acc + Math.max(t.team.memberCount || 0, t.members.length), 0);
        const totalComponents = projectsWithCounts.reduce((acc, p) => acc + p.componentCount, 0);

        setStats({
          totalProjects: projectsData.length,
          totalComponents,
          totalTeams: teamsData.length,
          totalMembers,
        });
      } catch (err) {
        // If auth check fails, user is not signed in
        // If data fetch fails, user is still signed in but we show an error
        const isAuthError = err instanceof Error &&
          (err.message.includes('UserUnAuthenticatedException') ||
           err.message.includes('not authenticated'));

        if (isAuthError) {
          setSignedIn(false);
        } else {
          // Data fetch error - user is authenticated but data failed to load
          // Show the authenticated dashboard with empty state
          setSignedIn(true);
        }
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Not signed in - show landing page
  if (!signedIn) {
    return (
      <div className="min-h-screen flex flex-col">
        <main className="flex-grow">
          {/* Hero Section */}
          <section className="relative overflow-hidden border-b border-slate-800">
            <div className="absolute inset-0 grid-pattern opacity-50" />
            <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-medium mb-6">
                  <Sparkles className="w-4 h-4" />
                  AI-Powered Project Planning
                </div>

                <h1 className="text-4xl lg:text-5xl font-bold mb-6 leading-tight">
                  Plan Your Code Structure{' '}
                  <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                    Before You Write a Line
                  </span>
                </h1>

                <p className="text-lg text-slate-400 mb-8 max-w-2xl">
                  TaskTitan helps teams break down projects into components, assign ownership, visualize dependencies, and
                  coordinate integration — eliminating merge conflicts before they happen.
                </p>

                <Link
                  to="/"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-500 transition-colors"
                >
                  <LogIn className="w-5 h-5" />
                  Sign In to Get Started
                </Link>
              </div>
            </div>
          </section>

          {/* Features Preview */}
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                <div className="w-12 h-12 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-4">
                  <Layers className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Component Hierarchy</h3>
                <p className="text-slate-400 text-sm">
                  Break down projects into Epics, Features, Stories, and Tasks with clear parent-child relationships.
                </p>
              </div>
              <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-violet-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Team Collaboration</h3>
                <p className="text-slate-400 text-sm">
                  Organize teams with role-based access, assign ownership, and track progress together.
                </p>
              </div>
              <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700">
                <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-4">
                  <Sparkles className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">AI-Powered Planning</h3>
                <p className="text-slate-400 text-sm">
                  Let AI help you break down requirements and generate component structures automatically.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // Signed in - show dashboard
  return (
    <div className="flex flex-col">
      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-slate-800">
          <div className="absolute inset-0 grid-pattern opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4" />
                AI-Powered Project Planning
              </div>

              <h1 className="text-4xl lg:text-5xl font-bold mb-6 leading-tight">
                Plan Your Code Structure{' '}
                <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                  Before You Write a Line
                </span>
              </h1>

              <p className="text-lg text-slate-400 mb-8 max-w-2xl">
                TaskTitan helps teams break down projects into components, assign ownership, visualize dependencies, and
                coordinate integration — eliminating merge conflicts before they happen.
              </p>

              <div className="flex flex-wrap gap-4">
                <Link
                  to="/project/new"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-600 text-white font-medium hover:bg-cyan-500 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Start New Project
                </Link>
                <Link
                  to="/project"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-600 transition-colors"
                >
                  View All Projects
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="border-b border-slate-800 bg-slate-900/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-cyan-400">{stats.totalProjects}</div>
                <div className="text-sm text-slate-400 mt-1">Active Projects</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400">{stats.totalComponents}</div>
                <div className="text-sm text-slate-400 mt-1">Components</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-violet-400">{stats.totalTeams}</div>
                <div className="text-sm text-slate-400 mt-1">Teams</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-amber-400">{stats.totalMembers}</div>
                <div className="text-sm text-slate-400 mt-1">Team Members</div>
              </div>
            </div>
          </div>
        </section>

        {/* Main Content */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Recent Projects */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <FolderKanban className="w-5 h-5 text-cyan-400" />
                  Recent Projects
                </h2>
                <Link to="/project" className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                  View all <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {recentProjects.length === 0 ? (
                <div className="p-8 rounded-xl bg-slate-800/50 border border-slate-700 text-center">
                  <Layers className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-slate-300 mb-2">No projects yet</h3>
                  <p className="text-slate-500 mb-6">Create your first project to start planning</p>
                  <Link
                    to="/project/new"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-600 text-white font-medium hover:bg-cyan-500 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    Create Project
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentProjects.map((project) => (
                    <Link
                      key={project.id}
                      to={`/project/${project.id}`}
                      className="block p-4 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors group"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium text-slate-100 group-hover:text-cyan-400 transition-colors">
                            {project.name}
                          </h3>
                          {project.description && (
                            <p className="text-sm text-slate-400 mt-1 line-clamp-2">{project.description}</p>
                          )}
                          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Layers className="w-3.5 h-3.5" />
                              {project.componentCount} components
                            </span>
                            {project.updatedAt && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {new Date(project.updatedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="w-5 h-5 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Teams */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Users className="w-5 h-5 text-violet-400" />
                    Your Teams
                  </h2>
                  <Link to="/team" className="text-sm text-cyan-400 hover:text-cyan-300">
                    Manage
                  </Link>
                </div>

                {teams.length === 0 ? (
                  <div className="p-6 rounded-xl bg-slate-800/50 border border-slate-700 text-center">
                    <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 mb-4">No teams yet</p>
                    <Link
                      to="/team/new"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-600 transition-colors"
                    >
                      Create Team
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {teams.map((teamData) => (
                      <Link
                        key={teamData.team.id}
                        to={`/team/${teamData.team.id}`}
                        className="block p-4 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors group"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-medium text-slate-200 group-hover:text-cyan-400 transition-colors">
                              {teamData.team.name}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                              {Math.max(teamData.team.memberCount || 0, teamData.members.length)} members
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick Actions */}
              <div>
                <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
                <div className="space-y-2">
                  <Link
                    to="/project/new"
                    className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                      <Plus className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-200 group-hover:text-cyan-400 transition-colors">
                        New Project
                      </div>
                      <div className="text-xs text-slate-500">Start planning a new app</div>
                    </div>
                  </Link>
                  <Link
                    to="/team/new"
                    className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-200 group-hover:text-violet-400 transition-colors">
                        Create Team
                      </div>
                      <div className="text-xs text-slate-500">Collaborate with others</div>
                    </div>
                  </Link>
                  <Link
                    to="/import"
                    className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-slate-600 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Upload className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-200 group-hover:text-emerald-400 transition-colors">
                        Import Data
                      </div>
                      <div className="text-xs text-slate-500">Jira, Trello, Asana, CSV</div>
                    </div>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
