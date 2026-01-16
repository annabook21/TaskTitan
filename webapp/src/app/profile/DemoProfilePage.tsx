'use client';

import { useEffect, useState } from 'react';
import { demoStore, DEMO_USER, clearDemoMode } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { User, Mail, Calendar, FolderKanban, Users, LogOut } from 'lucide-react';

interface ProfileData {
  teamsCount: number;
  projectsCount: number;
}

export default function DemoProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<ProfileData>({ teamsCount: 0, projectsCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const store = demoStore.getStore();
    const userMemberships = store.memberships.filter((m) => m.userId === DEMO_USER.id);
    const teamIds = userMemberships.map((m) => m.teamId);

    const teamsCount = teamIds.length;
    const projectsCount = store.projects.filter((p) => teamIds.includes(p.teamId)).length;

    setData({ teamsCount, projectsCount });
    setLoading(false);
  }, []);

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  const handleSignOut = () => {
    clearDemoMode();
    router.push('/sign-in');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="animate-pulse text-slate-400">Loading profile...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Profile Header */}
          <div className="component-card mb-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center text-3xl font-bold text-white">
                {DEMO_USER.name[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-slate-100">{DEMO_USER.name}</h1>
                <p className="text-slate-400 flex items-center gap-2 mt-1">
                  <Mail className="w-4 h-4" />
                  {DEMO_USER.email}
                </p>
                <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    Demo Account
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
                  <div className="text-2xl font-bold text-slate-100">{data.teamsCount}</div>
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
                  <div className="text-2xl font-bold text-slate-100">{data.projectsCount}</div>
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
                  <div className="text-sm text-slate-500">{DEMO_USER.name}</div>
                </div>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-slate-800">
                <div>
                  <div className="text-sm font-medium text-slate-300">Email</div>
                  <div className="text-sm text-slate-500">{DEMO_USER.email}</div>
                </div>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-slate-800">
                <div>
                  <div className="text-sm font-medium text-slate-300">Account Type</div>
                  <div className="text-sm text-amber-400">Demo Account</div>
                </div>
              </div>
              <div className="pt-4">
                <button
                  onClick={handleSignOut}
                  className="btn-secondary text-red-400 border-red-500/20 hover:bg-red-500/10 inline-flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Exit Demo Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
