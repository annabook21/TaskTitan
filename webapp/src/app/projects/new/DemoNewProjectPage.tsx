'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { ArrowLeft, FolderKanban, Plus } from 'lucide-react';

interface TeamOption {
  id: string;
  name: string;
}

export default function DemoNewProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTeamId = searchParams.get('teamId');

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState(preselectedTeamId || '');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const store = demoStore.getStore();
    const userMemberships = store.memberships.filter((m) => m.userId === DEMO_USER.id);
    const userTeams = userMemberships
      .map((m) => store.teams.find((t) => t.id === m.teamId))
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .map((t) => ({ id: t.id, name: t.name }));

    setTeams(userTeams);
    if (!preselectedTeamId && userTeams.length > 0) {
      setTeamId(userTeams[0].id);
    }
    setLoading(false);
  }, [preselectedTeamId]);

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Project name is required');
      return;
    }

    if (!teamId) {
      setError('Please select a team');
      return;
    }

    setSubmitting(true);

    try {
      const store = demoStore.getStore();
      const newProject = {
        id: `project-${Date.now()}`,
        name: name.trim(),
        description: description.trim() || null,
        teamId,
        ownerId: DEMO_USER.id,
        githubRepoUrl: null,
        githubWebhookSecret: null,
        githubPrTargetStatus: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.projects.push(newProject);
      demoStore.saveStore(store);

      router.push(`/projects/${newProject.id}`);
    } catch {
      setError('Failed to create project');
      setSubmitting(false);
    }
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
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-300 mb-2">No teams found</h1>
            <p className="text-slate-500 mb-4">Create a team first before creating a project.</p>
            <Link href="/team/new" className="btn-primary">
              Create Team
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Link>

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center">
              <FolderKanban className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Create New Project</h1>
              <p className="text-slate-400">Set up a new project for your team</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="component-card space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Team</label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Mobile App, API Redesign"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Description <span className="text-slate-500">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
                rows={3}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Link href="/projects" className="btn-secondary">
                Cancel
              </Link>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? (
                  'Creating...'
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Create Project
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
