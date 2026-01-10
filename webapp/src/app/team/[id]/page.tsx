import { prisma } from '@/lib/prisma';
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
} from 'lucide-react';
import InviteButton from './InviteButton';
import SeedDemoButton from './SeedDemoButton';

interface Props {
  params: Promise<{ id: string }>;
}

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
  const { userId, user } = await getSession();

  const team = await prisma.team.findFirst({
    where: {
      id,
      Membership: { some: { userId } },
    },
    include: {
      Membership: {
        include: { User: true },
        orderBy: { joinedAt: 'asc' },
      },
      Project: {
        include: {
          _count: { select: { Component: true } },
        },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  if (!team) {
    notFound();
  }

  // Get current user's role in this team
  const currentUserMembership = team.Membership.find((m) => m.userId === userId);
  const isOwnerOrAdmin = currentUserMembership?.role === 'OWNER' || currentUserMembership?.role === 'ADMIN';

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
                    {team.Membership.length} member{team.Membership.length !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FolderKanban className="w-4 h-4" />
                    {team.Project.length} project{team.Project.length !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    Created {new Date(team.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={`/team/${team.id}/sprints`}
                className="px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-300 font-medium transition-colors inline-flex items-center gap-2"
              >
                <Zap className="w-5 h-5" />
                Sprints
              </Link>
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

              {team.Project.length === 0 ? (
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
                  {team.Project.map((project) => (
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
                  {team.Membership.map(({ User: member, role }) => {
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
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
