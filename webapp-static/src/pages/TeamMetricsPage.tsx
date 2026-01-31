import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTeam, getTeamMetrics, type Team, type TeamMetrics } from '../api/appsync';

const STATUS_COLORS: Record<string, string> = {
  PLANNING: 'bg-slate-500',
  IN_PROGRESS: 'bg-cyan-500',
  BLOCKED: 'bg-red-500',
  REVIEW: 'bg-amber-500',
  COMPLETED: 'bg-emerald-500',
};

const STATUS_LABELS: Record<string, string> = {
  PLANNING: 'Planning',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
};

export function TeamMetricsPage() {
  const { id } = useParams<{ id: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [metrics, setMetrics] = useState<TeamMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [teamData, metricsData] = await Promise.all([getTeam(id), getTeamMetrics(id)]);
      setTeam(teamData);
      setMetrics(metricsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <p className="text-slate-400">Loading metrics...</p>;
  }

  if (error) {
    return <p className="text-red-400">{error}</p>;
  }

  if (!team || !metrics) {
    return <p className="text-slate-400">Team not found.</p>;
  }

  const totalItems = metrics.statusDistribution.reduce((sum, s) => sum + s.count, 0);
  const wipCount =
    metrics.statusDistribution.find((s) => s.status === 'IN_PROGRESS')?.count ?? 0;
  const completedCount =
    metrics.statusDistribution.find((s) => s.status === 'COMPLETED')?.count ?? 0;

  return (
    <div className="max-w-4xl">
      <Link to={`/team/${id}`} className="text-cyan-400 hover:underline mb-4 inline-block">
        &larr; {team.name}
      </Link>
      <h1 className="text-2xl font-bold mb-6">Team Metrics</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <p className="text-sm text-slate-400 mb-1">Total Components</p>
          <p className="text-3xl font-bold text-cyan-400">{metrics.totalComponents}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <p className="text-sm text-slate-400 mb-1">Work in Progress</p>
          <p className="text-3xl font-bold text-amber-400">{wipCount}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <p className="text-sm text-slate-400 mb-1">Completed</p>
          <p className="text-3xl font-bold text-emerald-400">{completedCount}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <p className="text-sm text-slate-400 mb-1">Active Sprints</p>
          <p className="text-3xl font-bold text-violet-400">{metrics.activeSprints}</p>
        </div>
      </div>

      {/* Status Distribution */}
      <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Status Distribution</h2>
        {totalItems > 0 ? (
          <>
            {/* Progress bar */}
            <div className="flex h-8 rounded-lg overflow-hidden mb-4">
              {metrics.statusDistribution
                .filter((s) => s.count > 0)
                .map((status) => (
                  <div
                    key={status.status}
                    className={`${STATUS_COLORS[status.status]} transition-all`}
                    style={{ width: `${(status.count / totalItems) * 100}%` }}
                    title={`${STATUS_LABELS[status.status]}: ${status.count}`}
                  />
                ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4">
              {metrics.statusDistribution.map((status) => (
                <div key={status.status} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded ${STATUS_COLORS[status.status]}`} />
                  <span className="text-sm text-slate-400">
                    {STATUS_LABELS[status.status]}: {status.count} (
                    {totalItems > 0 ? ((status.count / totalItems) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-slate-500 text-center py-4">No components yet</p>
        )}
      </section>

      {/* Component Types */}
      <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Component Types</h2>
        <div className="grid grid-cols-5 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-violet-400">{metrics.epicCount}</p>
            <p className="text-sm text-slate-400">Epics</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-400">{metrics.featureCount}</p>
            <p className="text-sm text-slate-400">Features</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-cyan-400">{metrics.storyCount}</p>
            <p className="text-sm text-slate-400">Stories</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-400">{metrics.taskCount}</p>
            <p className="text-sm text-slate-400">Tasks</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-400">{metrics.bugCount}</p>
            <p className="text-sm text-slate-400">Bugs</p>
          </div>
        </div>
      </section>

      {/* Sprint Summary */}
      <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Sprint Summary</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-300">{metrics.totalSprints}</p>
            <p className="text-sm text-slate-400">Total Sprints</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-cyan-400">{metrics.activeSprints}</p>
            <p className="text-sm text-slate-400">Active</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-400">{metrics.completedSprints}</p>
            <p className="text-sm text-slate-400">Completed</p>
          </div>
        </div>
      </section>

      {/* Info Box */}
      <div className="mt-8 bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <h4 className="font-medium text-slate-300 mb-2">About These Metrics</h4>
        <ul className="text-sm text-slate-400 space-y-1">
          <li>
            <strong>Status Distribution</strong>: Shows how work items are distributed across
            workflow stages.
          </li>
          <li>
            <strong>WIP (Work in Progress)</strong>: Items currently being worked on. Keep this low
            for better flow.
          </li>
          <li>
            <strong>Component Types</strong>: Breakdown of work by type (Epic, Feature, Story, Task,
            Bug).
          </li>
        </ul>
      </div>
    </div>
  );
}
