import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { FolderKanban, Users, GitBranch, Plus, ArrowRight, Sparkles, Layers, Clock } from 'lucide-react';

export default async function Dashboard() {
  const { userId, user } = await getSession();

  // Get user's projects through team memberships
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: {
      Team: {
        include: {
          Project: {
            include: {
              Component: true,
              _count: {
                select: { Component: true },
              },
            },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          },
          _count: {
            select: { Membership: true },
          },
        },
      },
    },
  });

  const teams = memberships.map((m) => m.Team);
  const recentProjects = teams.flatMap((t) => t.Project).slice(0, 5);

  // Calculate stats
  const totalProjects = teams.reduce((acc, t) => acc + t.Project.length, 0);
  const totalComponents = recentProjects.reduce((acc, p) => acc + p._count.Component, 0);
  const totalTeamMembers = teams.reduce((acc, t) => acc + t._count.Membership, 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

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
                <Link href="/projects/new" className="btn-primary">
                  <Plus className="w-5 h-5" />
                  Start New Project
                </Link>
                <Link href="/projects" className="btn-secondary">
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
                <div className="text-3xl font-bold text-cyan-400">{totalProjects}</div>
                <div className="text-sm text-slate-400 mt-1">Active Projects</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400">{totalComponents}</div>
                <div className="text-sm text-slate-400 mt-1">Components</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-violet-400">{teams.length}</div>
                <div className="text-sm text-slate-400 mt-1">Teams</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-amber-400">{totalTeamMembers}</div>
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
                <Link href="/projects" className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                  View all <ArrowRight className="w-4 h-4" />
                </Link>
              </div>

              {recentProjects.length === 0 ? (
                <div className="component-card text-center py-12">
                  <Layers className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-slate-300 mb-2">No projects yet</h3>
                  <p className="text-slate-500 mb-6">Create your first project to start planning</p>
                  <Link href="/projects/new" className="btn-primary">
                    <Plus className="w-5 h-5" />
                    Create Project
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {recentProjects.map((project) => (
                    <Link key={project.id} href={`/projects/${project.id}`} className="component-card block group">
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
                              {project._count.Component} components
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {new Date(project.updatedAt).toLocaleDateString()}
                            </span>
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
                  <Link href="/team" className="text-sm text-cyan-400 hover:text-cyan-300">
                    Manage
                  </Link>
                </div>

                {teams.length === 0 ? (
                  <div className="component-card text-center py-8">
                    <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500 mb-4">No teams yet</p>
                    <Link href="/team/new" className="btn-secondary text-sm">
                      Create Team
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {teams.map((team) => (
                      <Link key={team.id} href={`/team/${team.id}`} className="component-card block group">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-medium text-slate-200 group-hover:text-cyan-400 transition-colors">
                              {team.name}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                              {team._count.Membership} members · {team.Project.length} projects
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
                  <Link href="/projects/new" className="component-card flex items-center gap-3 group">
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
                  <Link href="/team/new" className="component-card flex items-center gap-3 group">
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
                  <div className="component-card flex items-center gap-3 opacity-60 cursor-not-allowed">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <GitBranch className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-200">Import from GitHub</div>
                      <div className="text-xs text-slate-500">Coming soon</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <div>© 2024 TaskTitan. Built with AWS Serverless.</div>
            <div className="flex items-center gap-4">
              <Link href="/docs" className="hover:text-slate-300">
                Docs
              </Link>
              <Link href="/privacy" className="hover:text-slate-300">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
