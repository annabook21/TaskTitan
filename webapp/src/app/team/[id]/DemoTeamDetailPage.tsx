'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
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
import DeleteTeamButton from './DeleteTeamButton';
import DemoInviteMemberForm from './DemoInviteMemberForm';

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

interface TeamData {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  members: Array<{
    id: string;
    name: string | null;
    email: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    title: string | null;
  }>;
  projects: Array<{
    id: string;
    name: string;
    description: string | null;
    componentCount: number;
    updatedAt: string;
  }>;
  workflowConfig: {
    cycleEnabled: boolean;
    cycleName: string;
  } | null;
}

export default function DemoTeamDetailPage() {
  const params = useParams();
  const teamId = params.id as string;
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const store = demoStore.getStore();

    const teamData = store.teams.find((t) => t.id === teamId);
    if (!teamData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Get members
    const memberships = store.memberships.filter((m) => m.teamId === teamId);
    const members = memberships.map((m) => {
      const user = store.users.find((u) => u.id === m.userId);
      return {
        id: user?.id || m.userId,
        name: user?.name || null,
        email: user?.email || 'unknown@example.com',
        role: m.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
        title: m.title ?? null,
      };
    });

    // Get projects
    const projects = store.projects
      .filter((p) => p.teamId === teamId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        componentCount: store.components.filter((c) => c.projectId === p.id).length,
        updatedAt: p.updatedAt,
      }));

    // Get workflow config
    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === teamId);

    setTeam({
      id: teamData.id,
      name: teamData.name,
      description: teamData.description,
      createdAt: teamData.createdAt,
      members,
      projects,
      workflowConfig: workflowConfig
        ? {
            cycleEnabled: workflowConfig.cycleEnabled,
            cycleName: workflowConfig.cycleName,
          }
        : null,
    });
    setLoading(false);
  }, [teamId, refreshKey]);

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
          <div className="animate-pulse text-slate-400">Loading team...</div>
        </main>
      </div>
    );
  }

  if (notFound || !team) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-300 mb-2">Team not found</h1>
            <p className="text-slate-500 mb-4">This team doesn&apos;t exist in demo mode.</p>
            <Link href="/team" className="btn-primary">
              Back to Teams
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const currentUserMember = team.members.find((m) => m.id === DEMO_USER.id);
  const isOwnerOrAdmin = currentUserMember?.role === 'OWNER' || currentUserMember?.role === 'ADMIN';
  const cycleEnabled = team.workflowConfig?.cycleEnabled ?? true;
  const cycleName = team.workflowConfig?.cycleName || 'Sprint';
  const cycleNamePlural = `${cycleName}s`;

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link href="/team" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6">
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
                    {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FolderKanban className="w-4 h-4" />
                    {team.projects.length} project{team.projects.length !== 1 ? 's' : ''}
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

              {team.projects.length === 0 ? (
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
                  {team.projects.map((project) => (
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
                            <span>{project.componentCount} components</span>
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
                {isOwnerOrAdmin && (
                  <button
                    onClick={() => setShowInviteModal(true)}
                    className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    + Add Member
                  </button>
                )}
              </div>

              <div className="component-card">
                <div className="space-y-4">
                  {team.members.map((member) => {
                    const RoleIcon = roleIcons[member.role];
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
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${roleColors[member.role]}`}
                            >
                              <RoleIcon className="w-3 h-3" />
                              {member.role.toLowerCase()}
                            </span>
                          </div>
                          {member.title && (
                            <div className="text-xs text-slate-400 mt-0.5">{member.title}</div>
                          )}
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
            </div>
          </div>
        </div>
      </main>

      {/* Add Member Modal */}
      {showInviteModal && (
        <DemoInviteMemberForm
          teamId={team.id}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
