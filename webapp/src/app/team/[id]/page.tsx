import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  FolderKanban,
  Crown,
  Shield,
  User as UserIcon,
  Eye,
  Plus,
  Mail,
  Calendar,
  Zap,
  Settings,
  BarChart3,
} from 'lucide-react';
import InviteButton from './InviteButton';
import SeedDemoButton from './SeedDemoButton';
import DeleteTeamButton from './DeleteTeamButton';
import DemoTeamDetailPage from './DemoTeamDetailPage';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

interface Props {
  params: Promise<{ id: string }>;
}

type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

const roleIcons = {
  OWNER: Crown,
  ADMIN: Shield,
  MEMBER: UserIcon,
  VIEWER: Eye,
};

const roleColors = {
  OWNER: 'text-amber-400 bg-amber-500/10',
  ADMIN: 'text-violet-400 bg-violet-500/10',
  MEMBER: 'text-cyan-400 bg-cyan-500/10',
  VIEWER: 'text-slate-400 bg-slate-500/10',
};

export default async function TeamDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoTeamDetailPage />;
  }

  const entities = getEntities();

  // Verify user has access to this team
  const access = await verifyTeamMembership(userId, id);
  if (!access) {
    notFound();
  }

  // Fetch team data
  const teamResult = await entities.team.get({ id }).go();
  const team = teamResult.data;
  if (!team) {
    notFound();
  }

  // Fetch memberships, projects, and workflow config in parallel
  const [membershipsResult, projectsResult, workflowConfigResult] = await Promise.all([
    entities.membership.query.primary({ teamId: id }).go(),
    entities.project.query.byTeam({ teamId: id }).go(),
    entities.teamWorkflowConfig.get({ teamId: id }).go(),
  ]);

  // Sort memberships by joinedAt
  const sortedMemberships = membershipsResult.data.sort(
    (a, b) => new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime()
  );

  // Fetch user details for each membership
  const membershipsWithUsers = await Promise.all(
    sortedMemberships.map(async (m) => {
      const userResult = await entities.user.get({ id: m.userId }).go();
      return {
        ...m,
        User: userResult.data || { id: m.userId, name: null, email: 'unknown@example.com' },
      };
    })
  );

  // Fetch component counts for each project
  const projectsWithCounts = await Promise.all(
    projectsResult.data
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .map(async (p) => {
        const componentsResult = await entities.component.query.byProject({ projectId: p.id }).go();
        return {
          ...p,
          _count: { Component: componentsResult.data.length },
        };
      })
  );

  // Get current user's role in this team
  const currentUserMembership = membershipsWithUsers.find((m) => String(m.userId) === String(userId));
  const isOwnerOrAdmin = currentUserMembership?.role === 'OWNER' || currentUserMembership?.role === 'ADMIN';

  // Get workflow terminology
  const workflowConfig = workflowConfigResult.data;
  const cycleEnabled = workflowConfig?.cycleEnabled ?? true;
  const cycleName = workflowConfig?.cycleName || 'Sprint';
  const cycleNamePlural = `${cycleName}s`;

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href="/team"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Teams
          </Link>

          {/* Team Header */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
                <Users className="w-8 h-8 text-violet-400" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">{team.name}</h1>
                {team.description && <p className="text-slate-400 mt-1 max-w-2xl">{team.description}</p>}
                <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    {membershipsWithUsers.length} member{membershipsWithUsers.length !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FolderKanban className="w-4 h-4" />
                    {projectsWithCounts.length} project{projectsWithCounts.length !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    Created {new Date(team.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {cycleEnabled && (
                <Link
                  href={`/team/${team.id}/sprints`}
                  className="px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-300 font-medium transition-colors inline-flex items-center gap-2"
                >
                  <Zap className="w-5 h-5" />
                  {cycleNamePlural}
                </Link>
              )}
              <Link
                href={`/team/${team.id}/metrics`}
                className="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-emerald-300 font-medium transition-colors inline-flex items-center gap-2"
              >
                <BarChart3 className="w-5 h-5" />
                Metrics
              </Link>
              {isOwnerOrAdmin && (
                <Link
                  href={`/team/${team.id}/workflow`}
                  className="px-4 py-2.5 bg-slate-500/10 hover:bg-slate-500/20 border border-slate-500/30 rounded-xl text-slate-300 font-medium transition-colors inline-flex items-center gap-2"
                >
                  <Settings className="w-5 h-5" />
                  Settings
                </Link>
              )}
              <Link href={`/projects/new?teamId=${team.id}`} className="btn-primary">
                <Plus className="w-5 h-5" />
                New Project
              </Link>
            </div>
          </div>

          {/* Main Content */}
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Projects */}
            <div className="lg:col-span-2">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-cyan-400" />
                Projects
              </h2>

              {projectsWithCounts.length === 0 ? (
                <div className="component-card text-center py-12">
                  <FolderKanban className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-slate-300 mb-2">No projects yet</h3>
                  <p className="text-slate-500 mb-6">Create your first project for this team</p>
                  <Link href={`/projects/new?teamId=${team.id}`} className="btn-primary">
                    <Plus className="w-5 h-5" />
                    Create Project
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {projectsWithCounts.map((project) => (
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
                            <span>{project._count.Component} components</span>
                            <span>Updated {new Date(project.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Team Members */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5 text-violet-400" />
                  Members
                </h2>
                {isOwnerOrAdmin && <InviteButton teamId={team.id} />}
              </div>

              <div className="component-card">
                <div className="space-y-4">
                  {membershipsWithUsers.map((membership) => {
                    const member = membership.User;
                    const role = (membership.role || 'MEMBER') as TeamRole;
                    const RoleIcon = roleIcons[role];
                    return (
                      <div key={member.id} className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium text-white">
                          {member.name?.[0]?.toUpperCase() || member.email[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-200 truncate">
                              {member.name || member.email.split('@')[0]}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${roleColors[role]}`}
                            >
                              <RoleIcon className="w-3 h-3" />
                              {role.toLowerCase()}
                            </span>
                          </div>
                          {membership.title && <div className="text-xs text-slate-400 mt-0.5">{membership.title}</div>}
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            <Mail className="w-3 h-3" />
                            <span className="truncate">{member.email}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Demo seed button - only for owner */}
              {currentUserMembership?.role === 'OWNER' && (
                <div className="mt-6">
                  <SeedDemoButton teamId={team.id} />
                </div>
              )}

              {/* Danger Zone - only for owner */}
              {currentUserMembership?.role === 'OWNER' && (
                <div className="mt-8 pt-6 border-t border-slate-700">
                  <h3 className="text-sm font-medium text-red-400 mb-3">Danger Zone</h3>
                  <DeleteTeamButton teamId={team.id} teamName={team.name} />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
