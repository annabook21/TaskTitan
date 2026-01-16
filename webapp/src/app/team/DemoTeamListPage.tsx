'use client';

import { useEffect, useState } from 'react';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { Plus, Users, FolderKanban, Crown, ArrowRight } from 'lucide-react';

interface TeamData {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  projectCount: number;
  role: string;
}

export default function DemoTeamListPage() {
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const store = demoStore.getStore();
    const userId = DEMO_USER.id;

    // Get teams through memberships
    const userMemberships = store.memberships.filter((m) => m.userId === userId);
    const teamData = userMemberships
      .map((membership) => {
        const team = store.teams.find((t) => t.id === membership.teamId);
        if (!team) return null;

        const memberCount = store.memberships.filter((m) => m.teamId === team.id).length;
        const projectCount = store.projects.filter((p) => p.teamId === team.id).length;

        return {
          id: team.id,
          name: team.name,
          description: team.description,
          memberCount,
          projectCount,
          role: membership.role,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    setTeams(teamData);
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
          <div className="animate-pulse text-slate-400">Loading teams...</div>
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
                <Users className="w-7 h-7 text-violet-400" />
                Teams
              </h1>
              <p className="text-slate-400 mt-1">
                {teams.length} team{teams.length !== 1 ? 's' : ''} you belong to
              </p>
            </div>
            <Link href="/team/new" className="btn-primary">
              <Plus className="w-5 h-5" />
              Create Team
            </Link>
          </div>

          {/* Teams Grid */}
          {teams.length === 0 ? (
            <div className="component-card text-center py-16">
              <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-slate-300 mb-2">No teams yet</h2>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                Create a team to start collaborating with others on projects
              </p>
              <Link href="/team/new" className="btn-primary">
                <Plus className="w-5 h-5" />
                Create Your First Team
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {teams.map((team, index) => (
                <Link
                  key={team.id}
                  href={`/team/${team.id}`}
                  className="component-card group animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
                      <Users className="w-6 h-6 text-violet-400" />
                    </div>
                    {team.role === 'OWNER' && (
                      <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                        <Crown className="w-3 h-3" />
                        Owner
                      </span>
                    )}
                  </div>

                  <h3 className="text-lg font-semibold text-slate-100 group-hover:text-violet-400 transition-colors mb-2">
                    {team.name}
                  </h3>

                  {team.description && (
                    <p className="text-sm text-slate-400 line-clamp-2 mb-4">{team.description}</p>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {team.memberCount} member{team.memberCount !== 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <FolderKanban className="w-3.5 h-3.5" />
                        {team.projectCount} project{team.projectCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-violet-400 transition-colors" />
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
