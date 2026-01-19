'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { ArrowLeft, Zap, Plus } from 'lucide-react';

export default function DemoNewSprintPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.id as string;

  const [teamName, setTeamName] = useState('');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [capacity, setCapacity] = useState('40');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const store = demoStore.getStore();
    const team = store.teams.find((t) => t.id === teamId);

    if (!team) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Check if user is owner or admin
    const membership = store.memberships.find((m) => m.teamId === teamId && m.userId === DEMO_USER.id);
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      router.push(`/team/${teamId}/sprints`);
      return;
    }

    setTeamName(team.name);

    // Get last sprint to suggest dates
    const teamSprints = store.sprints
      .filter((s) => s.teamId === teamId)
      .sort((a, b) => {
        const dateA = a.endDate ? new Date(a.endDate).getTime() : 0;
        const dateB = b.endDate ? new Date(b.endDate).getTime() : 0;
        return dateB - dateA;
      });

    const lastSprint = teamSprints[0];
    const suggestedStart =
      lastSprint && lastSprint.endDate
        ? new Date(new Date(lastSprint.endDate).getTime() + 24 * 60 * 60 * 1000)
        : new Date();

    const suggestedEnd = new Date(suggestedStart.getTime() + 14 * 24 * 60 * 60 * 1000);

    setStartDate(suggestedStart.toISOString().split('T')[0]);
    setEndDate(suggestedEnd.toISOString().split('T')[0]);
    setName(`Sprint ${teamSprints.length + 1}`);

    setLoading(false);
  }, [teamId, router]);

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Sprint name is required');
      return;
    }

    if (!startDate || !endDate) {
      setError('Start and end dates are required');
      return;
    }

    if (new Date(startDate) >= new Date(endDate)) {
      setError('End date must be after start date');
      return;
    }

    setSubmitting(true);

    try {
      const store = demoStore.getStore();
      const newSprint = {
        id: `sprint-${Date.now()}`,
        name: name.trim(),
        goal: goal.trim() || null,
        status: 'PLANNING' as const,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        capacity: parseInt(capacity) || null,
        teamId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.sprints.push(newSprint);
      demoStore.saveStore(store);

      router.push(`/team/${teamId}/sprints/${newSprint.id}`);
    } catch {
      setError('Failed to create sprint');
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

  if (notFound) {
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${teamId}/sprints`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sprints
          </Link>

          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Zap className="w-8 h-8 text-amber-400" />
              New Sprint
            </h1>
            <p className="text-slate-400 mt-1">Create a new sprint to plan and track work for {teamName}</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="component-card space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Sprint Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sprint 1"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Goal <span className="text-slate-500">(optional)</span>
              </label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What do you want to achieve in this sprint?"
                rows={3}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Capacity (hours) <span className="text-slate-500">(optional)</span>
              </label>
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="40"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Team&apos;s available hours for this sprint. Helps with planning.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Link href={`/team/${teamId}/sprints`} className="btn-secondary">
                Cancel
              </Link>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? (
                  'Creating...'
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Create Sprint
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
