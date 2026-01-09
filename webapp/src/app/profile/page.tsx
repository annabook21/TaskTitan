import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import { prisma } from '@/lib/prisma';
import { User, Mail, Calendar, FolderKanban, Users } from 'lucide-react';
import Link from 'next/link';

export default async function ProfilePage() {
  const { user } = await getSession();

  // Get user stats
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: {
      Team: {
        include: {
          Project: true,
        },
      },
    },
  });

  const teamsCount = memberships.length;
  const projectsCount = memberships.reduce((acc, m) => acc + m.Team.Project.length, 0);

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Profile Header */}
          <div className="component-card mb-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center text-3xl font-bold text-white">
                {user.name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-slate-100">{user.name || 'User'}</h1>
                <p className="text-slate-400 flex items-center gap-2 mt-1">
                  <Mail className="w-4 h-4" />
                  {user.email}
                </p>
                <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    Joined{' '}
                    {new Date(user.createdAt).toLocaleDateString('en-US', {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <Link href="/team" className="component-card group">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
                  <Users className="w-6 h-6 text-violet-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-100">{teamsCount}</div>
                  <div className="text-sm text-slate-400 group-hover:text-violet-400 transition-colors">Teams</div>
                </div>
              </div>
            </Link>

            <Link href="/projects" className="component-card group">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                  <FolderKanban className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-100">{projectsCount}</div>
                  <div className="text-sm text-slate-400 group-hover:text-cyan-400 transition-colors">Projects</div>
                </div>
              </div>
            </Link>
          </div>

          {/* Account Settings */}
          <div className="component-card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-cyan-400" />
              Account
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-slate-800">
                <div>
                  <div className="text-sm font-medium text-slate-300">Name</div>
                  <div className="text-sm text-slate-500">{user.name || 'Not set'}</div>
                </div>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-slate-800">
                <div>
                  <div className="text-sm font-medium text-slate-300">Email</div>
                  <div className="text-sm text-slate-500">{user.email}</div>
                </div>
              </div>
              <div className="pt-4">
                <Link
                  href="/api/auth/sign-out"
                  className="btn-secondary text-red-400 border-red-500/20 hover:bg-red-500/10"
                >
                  Sign Out
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
