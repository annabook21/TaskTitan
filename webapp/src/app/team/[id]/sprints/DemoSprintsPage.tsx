'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import type { DemoSprint } from '@/lib/demo/types';
import Header from '@/components/Header';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Target,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  PauseCircle,
  Plus,
  ChevronRight,
  Zap,
} from 'lucide-react';

const statusConfig = {
  PLANNING: {
    label: 'Planning',
    color: 'text-slate-400 bg-slate-500/10',
    icon: PauseCircle,
  },
  ACTIVE: {
    label: 'Active',
    color: 'text-green-400 bg-green-500/10',
    icon: PlayCircle,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-cyan-400 bg-cyan-500/10',
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-red-400 bg-red-500/10',
    icon: XCircle,
  },
};

interface SprintWithStats extends DemoSprint {
  componentCount: number;
  completedCount: number;
  totalHours: number;
  completedHours: number;
}

interface TeamData {
  id: string;
  name: string;
  sprints: SprintWithStats[];
  cycleEnabled: boolean;
  cycleName: string;
  canManageSprints: boolean;
}

export default function DemoSprintsPage() {
  const params = useParams();
  const teamId = params.id as string;
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const store = demoStore.getStore();
    const teamData = store.teams.find((t) => t.id === teamId);

    if (!teamData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Get workflow config
    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === teamId);
    const cycleEnabled = workflowConfig?.cycleEnabled ?? true;
    const cycleName = workflowConfig?.cycleName || 'Sprint';

    // Get user's role
    const membership = store.memberships.find((m) => m.teamId === teamId && m.userId === DEMO_USER.id);
    const canManageSprints = membership?.role === 'OWNER' || membership?.role === 'ADMIN';

    // Get sprints with component stats
    const sprints = store.sprints
      .filter((s) => s.teamId === teamId)
      .map((sprint) => {
        const sprintComponents = store.components.filter((c) => c.sprintId === sprint.id);
        const completedComponents = sprintComponents.filter((c) => c.status === 'COMPLETED');
        return {
          ...sprint,
          componentCount: sprintComponents.length,
          completedCount: completedComponents.length,
          totalHours: sprintComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0),
          completedHours: completedComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0),
        };
      })
      .sort((a, b) => {
        const dateA = a.startDate ? new Date(a.startDate).getTime() : 0;
        const dateB = b.startDate ? new Date(b.startDate).getTime() : 0;
        return dateB - dateA;
      });

    setTeam({
      id: teamData.id,
      name: teamData.name,
      sprints,
      cycleEnabled,
      cycleName,
      canManageSprints,
    });
    setLoading(false);
  }, [teamId]);

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
          <div className="animate-pulse text-slate-400">Loading sprints...</div>
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

  const cycleNameLower = team.cycleName.toLowerCase();
  const cycleNamePlural = `${team.cycleName}s`;

  const activeSprint = team.sprints.find((s) => s.status === 'ACTIVE');
  const planningSprints = team.sprints.filter((s) => s.status === 'PLANNING');
  const completedSprints = team.sprints.filter((s) => s.status === 'COMPLETED');

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${teamId}`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {team.name}
          </Link>

          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Zap className="w-8 h-8 text-amber-400" />
                {cycleNamePlural}
              </h1>
              <p className="text-slate-400 mt-1">Plan and track work in timeboxed {cycleNameLower}s</p>
            </div>

            {team.canManageSprints && (
              <Link href={`/team/${teamId}/sprints/new`} className="btn-primary">
                <Plus className="w-5 h-5" />
                New {team.cycleName}
              </Link>
            )}
          </div>

          {/* Active Sprint - Featured */}
          {activeSprint && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-green-400 mb-4 flex items-center gap-2">
                <PlayCircle className="w-5 h-5" />
                Active {team.cycleName}
              </h2>
              <SprintCard sprint={activeSprint} teamId={teamId} featured />
            </div>
          )}

          {/* Planning Sprints */}
          {planningSprints.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <PauseCircle className="w-5 h-5 text-slate-400" />
                Upcoming ({planningSprints.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {planningSprints.map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} teamId={teamId} />
                ))}
              </div>
            </div>
          )}

          {/* Completed Sprints */}
          {completedSprints.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                Completed ({completedSprints.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {completedSprints.slice(0, 6).map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} teamId={teamId} />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {team.sprints.length === 0 && (
            <div className="component-card text-center py-16">
              <Zap className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-slate-300 mb-2">No {cycleNameLower}s yet</h3>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                {cycleNamePlural} help you organize work into focused time periods. Create your first {cycleNameLower}{' '}
                to start planning.
              </p>
              {team.canManageSprints && (
                <Link href={`/team/${teamId}/sprints/new`} className="btn-primary">
                  <Plus className="w-5 h-5" />
                  Create First {team.cycleName}
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

interface SprintCardProps {
  sprint: SprintWithStats;
  teamId: string;
  featured?: boolean;
}

function SprintCard({ sprint, teamId, featured }: SprintCardProps) {
  const config = statusConfig[sprint.status];
  const StatusIcon = config.icon;

  const progress = sprint.componentCount > 0 ? Math.round((sprint.completedCount / sprint.componentCount) * 100) : 0;
  const endDate = sprint.endDate ? new Date(sprint.endDate) : new Date();
  const startDate = sprint.startDate ? new Date(sprint.startDate) : new Date();
  const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  return (
    <Link
      href={`/team/${teamId}/sprints/${sprint.id}`}
      className={`component-card group block ${featured ? 'border-green-500/30 bg-green-500/5' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}
          >
            <StatusIcon className="w-3.5 h-3.5" />
            {config.label}
          </span>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-cyan-400 transition-colors" />
      </div>

      <h3 className="font-semibold text-lg text-slate-100 group-hover:text-cyan-400 transition-colors mb-1">
        {sprint.name}
      </h3>

      {sprint.goal && (
        <p className="text-sm text-slate-400 line-clamp-2 mb-3">
          <Target className="w-3.5 h-3.5 inline mr-1" />
          {sprint.goal}
        </p>
      )}

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>
            {sprint.completedCount}/{sprint.componentCount} items
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-green-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Meta info */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          {startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}
        </span>
        {sprint.status === 'ACTIVE' && daysRemaining > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <Clock className="w-3.5 h-3.5" />
            {daysRemaining}d left
          </span>
        )}
      </div>

      {/* Hours summary */}
      {sprint.totalHours > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          <Clock className="w-3.5 h-3.5 inline mr-1" />
          {sprint.completedHours}/{sprint.totalHours}h completed
          {sprint.capacity && (
            <span className="ml-2">({Math.round((sprint.totalHours / sprint.capacity) * 100)}% of capacity)</span>
          )}
        </div>
      )}
    </Link>
  );
}
