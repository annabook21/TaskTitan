'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import ImportWizard from './ImportWizard';

interface TeamWithData {
  id: string;
  name: string;
  Project: Array<{ id: string; name: string }>;
  Sprint: Array<{ id: string; name: string }>;
}

export default function DemoImportPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<TeamWithData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const store = demoStore.getStore();
    const userMemberships = store.memberships.filter((m) => m.userId === DEMO_USER.id);

    const userTeams = userMemberships
      .map((m) => {
        const team = store.teams.find((t) => t.id === m.teamId);
        if (!team) return null;

        const projects = store.projects
          .filter((p) => p.teamId === team.id)
          .map((p) => ({ id: p.id, name: p.name }));

        const sprints = store.sprints
          .filter((s) => s.teamId === team.id && (s.status === 'PLANNING' || s.status === 'ACTIVE'))
          .map((s) => ({ id: s.id, name: s.name }));

        return {
          id: team.id,
          name: team.name,
          Project: projects,
          Sprint: sprints,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    setTeams(userTeams);
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
          <div className="animate-pulse text-slate-400">Loading...</div>
        </main>
      </div>
    );
  }

  if (teams.length === 0) {
    router.push('/team/new');
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ImportWizard teams={teams} selectedTeam={teams[0]} />
        </div>
      </main>
    </div>
  );
}
