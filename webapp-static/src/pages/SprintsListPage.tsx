import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  listSprintsByTeam,
  getTeam,
  getSprintWithComponents,
  type Sprint,
  type Team,
  type Component,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
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
  Loader2,
} from 'lucide-react';

type SprintStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

const statusConfig: Record<
  SprintStatus,
  { label: string; color: string; icon: typeof PlayCircle }
> = {
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

interface SprintWithData extends Sprint {
  componentCount: number;
  completedCount: number;
  components: Component[];
  totalHours: number;
  completedHours: number;
}

export function SprintsListPage() {
  const { id: teamId } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [sprints, setSprints] = useState<SprintWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !teamId) {
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const [teamData, sprintsData] = await Promise.all([
          getTeam(teamId!),
          listSprintsByTeam(teamId!),
        ]);
        setTeam(teamData);

        // Fetch component counts for each sprint
        const sprintsWithData: SprintWithData[] = await Promise.all(
          sprintsData.map(async (sprint) => {
            try {
              const sprintDetails = await getSprintWithComponents(sprint.id);
              const components = sprintDetails?.components || [];
              const completedCount = components.filter(
                (c) => c.status === 'COMPLETED'
              ).length;
              const totalHours = components.reduce(
                (sum, c) => sum + (c.estimatedHours || 0),
                0
              );
              const completedHours = components
                .filter((c) => c.status === 'COMPLETED')
                .reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

              return {
                ...sprint,
                componentCount: components.length,
                completedCount,
                components,
                totalHours,
                completedHours,
              };
            } catch {
              return {
                ...sprint,
                componentCount: 0,
                completedCount: 0,
                components: [],
                totalHours: 0,
                completedHours: 0,
              };
            }
          })
        );

        // Sort by startDate desc
        sprintsWithData.sort(
          (a, b) =>
            new Date(b.startDate || 0).getTime() -
            new Date(a.startDate || 0).getTime()
        );

        setSprints(sprintsWithData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sprints');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [teamId, isAuthenticated, authLoading]);

  // Separate sprints by status
  const activeSprint = sprints.find((s) => s.status === 'ACTIVE');
  const planningSprints = sprints.filter((s) => s.status === 'PLANNING');
  const completedSprints = sprints.filter((s) => s.status === 'COMPLETED');

  if (authLoading || loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading sprints...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <Zap className="w-7 h-7 text-amber-400" />
          Sprints
        </h1>
        <p className="text-slate-400 mb-4">Sign in to view sprints.</p>
        <button onClick={() => signInWithRedirect()} className="btn-primary">
          Sign In
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to={`/team/${teamId}`}
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {team?.name || 'Team'}
        </Link>
        <div className="p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        to={`/team/${teamId}`}
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {team?.name || 'Team'}
      </Link>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Zap className="w-8 h-8 text-amber-400" />
            Sprints
          </h1>
          <p className="text-slate-400 mt-1">
            Plan and track work in timeboxed sprints
          </p>
        </div>

        <Link to={`/team/${teamId}/sprints/new`} className="btn-primary">
          <Plus className="w-5 h-5" />
          New Sprint
        </Link>
      </div>

      {/* Active Sprint - Featured */}
      {activeSprint && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-green-400 mb-4 flex items-center gap-2">
            <PlayCircle className="w-5 h-5" />
            Active Sprint
          </h2>
          <SprintCard sprint={activeSprint} teamId={teamId!} featured />
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
              <SprintCard key={sprint.id} sprint={sprint} teamId={teamId!} />
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
              <SprintCard key={sprint.id} sprint={sprint} teamId={teamId!} />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {sprints.length === 0 && (
        <div className="component-card text-center py-16">
          <Zap className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-slate-300 mb-2">
            No sprints yet
          </h3>
          <p className="text-slate-500 mb-6 max-w-md mx-auto">
            Sprints help you organize work into focused time periods. Create
            your first sprint to start planning.
          </p>
          <Link to={`/team/${teamId}/sprints/new`} className="btn-primary">
            <Plus className="w-5 h-5" />
            Create First Sprint
          </Link>
        </div>
      )}
    </div>
  );
}

interface SprintCardProps {
  sprint: SprintWithData;
  teamId: string;
  featured?: boolean;
}

function SprintCard({ sprint, teamId, featured }: SprintCardProps) {
  const config = statusConfig[sprint.status as SprintStatus] || statusConfig.PLANNING;
  const StatusIcon = config.icon;

  const progress =
    sprint.componentCount > 0
      ? Math.round((sprint.completedCount / sprint.componentCount) * 100)
      : 0;

  const daysRemaining = sprint.endDate
    ? Math.max(
        0,
        Math.ceil(
          (new Date(sprint.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      )
    : 0;

  return (
    <Link
      to={`/team/${teamId}/sprints/${sprint.id}`}
      className={`component-card group block ${
        featured ? 'border-green-500/30 bg-green-500/5' : ''
      }`}
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
        {sprint.startDate && sprint.endDate && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {new Date(sprint.startDate).toLocaleDateString()} -{' '}
            {new Date(sprint.endDate).toLocaleDateString()}
          </span>
        )}
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
        </div>
      )}
    </Link>
  );
}
