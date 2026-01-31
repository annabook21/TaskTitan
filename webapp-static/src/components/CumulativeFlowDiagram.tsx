import { useMemo } from 'react';
import type { Component, ComponentStatus } from '../api/appsync';

interface CumulativeFlowDiagramProps {
  components: Component[];
  // Show advanced Kanban metrics (cycle time, throughput, Little's Law)
  showKanbanMetrics?: boolean;
}

// Calculate Kanban metrics based on component data
// Sources: https://getnave.com/blog/kanban-metrics/, Little's Law
interface KanbanMetrics {
  averageCycleTimeDays: number | null; // null if not enough data
  throughputPerWeek: number | null;
  currentWIP: number;
  percentileEstimates: {
    p50: number | null;
    p85: number | null;
    p95: number | null;
  };
  littlesLawValid: boolean;
  littlesLawEstimate: number | null;
}

const STATUS_ORDER: ComponentStatus[] = ['COMPLETED', 'REVIEW', 'BLOCKED', 'IN_PROGRESS', 'PLANNING'];

const statusColors: Record<ComponentStatus, { fill: string; stroke: string; label: string }> = {
  PLANNING: { fill: '#8b5cf6', stroke: '#7c3aed', label: 'Planning' },
  IN_PROGRESS: { fill: '#06b6d4', stroke: '#0891b2', label: 'In Progress' },
  BLOCKED: { fill: '#ef4444', stroke: '#dc2626', label: 'Blocked' },
  REVIEW: { fill: '#f59e0b', stroke: '#d97706', label: 'Review' },
  COMPLETED: { fill: '#10b981', stroke: '#059669', label: 'Completed' },
};

export function CumulativeFlowDiagram({
  components,
  showKanbanMetrics = false,
}: CumulativeFlowDiagramProps) {
  // Calculate current status counts
  const statusCounts = useMemo(() => {
    const counts: Record<ComponentStatus, number> = {
      PLANNING: 0,
      IN_PROGRESS: 0,
      BLOCKED: 0,
      REVIEW: 0,
      COMPLETED: 0,
    };
    components.forEach((comp) => {
      counts[comp.status]++;
    });
    return counts;
  }, [components]);

  // Calculate basic metrics
  const metrics = useMemo(() => {
    const wip = statusCounts.IN_PROGRESS + statusCounts.BLOCKED + statusCounts.REVIEW;
    const total = components.length;
    const completed = statusCounts.COMPLETED;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { wip, total, completed, completionRate };
  }, [statusCounts, components.length]);

  // Calculate Kanban metrics (cycle time, throughput, Little's Law)
  // Based on: https://getnave.com/blog/kanban-metrics/
  const kanbanMetrics = useMemo((): KanbanMetrics => {
    const now = new Date();
    const completedComponents = components.filter((c) => c.status === 'COMPLETED');
    const wip = statusCounts.IN_PROGRESS + statusCounts.BLOCKED + statusCounts.REVIEW;

    // Calculate cycle times for items with startedAt and updatedAt (completion time)
    const cycleTimes: number[] = [];
    completedComponents.forEach((comp) => {
      if (comp.startedAt && comp.updatedAt) {
        const startDate = new Date(comp.startedAt);
        const endDate = new Date(comp.updatedAt);
        const cycleTimeDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        if (cycleTimeDays >= 0 && cycleTimeDays < 365) {
          // Sanity check: ignore negative or extremely long cycle times
          cycleTimes.push(cycleTimeDays);
        }
      }
    });

    // Sort cycle times for percentile calculation
    cycleTimes.sort((a, b) => a - b);

    // Calculate percentiles
    const getPercentile = (sorted: number[], p: number): number | null => {
      if (sorted.length === 0) return null;
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    const avgCycleTime =
      cycleTimes.length > 0
        ? cycleTimes.reduce((sum, ct) => sum + ct, 0) / cycleTimes.length
        : null;

    // Calculate throughput: items completed in last 4 weeks
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const recentlyCompleted = completedComponents.filter((c) => {
      if (!c.updatedAt) return false;
      return new Date(c.updatedAt) >= fourWeeksAgo;
    });
    const throughputPerWeek = recentlyCompleted.length > 0 ? recentlyCompleted.length / 4 : null;

    // Little's Law validation: Cycle Time = WIP / Throughput
    // If our measured values align with Little's Law, our process is stable
    let littlesLawValid = false;
    let littlesLawEstimate: number | null = null;
    if (wip > 0 && throughputPerWeek && throughputPerWeek > 0) {
      littlesLawEstimate = wip / throughputPerWeek; // Expected cycle time in weeks
      const littlesLawDays = littlesLawEstimate * 7;
      // Check if measured avg is within 30% of Little's Law estimate
      if (avgCycleTime !== null) {
        const ratio = avgCycleTime / littlesLawDays;
        littlesLawValid = ratio >= 0.7 && ratio <= 1.3;
      }
    }

    return {
      averageCycleTimeDays: avgCycleTime !== null ? Math.round(avgCycleTime * 10) / 10 : null,
      throughputPerWeek:
        throughputPerWeek !== null ? Math.round(throughputPerWeek * 10) / 10 : null,
      currentWIP: wip,
      percentileEstimates: {
        p50: getPercentile(cycleTimes, 50),
        p85: getPercentile(cycleTimes, 85),
        p95: getPercentile(cycleTimes, 95),
      },
      littlesLawValid,
      littlesLawEstimate:
        littlesLawEstimate !== null ? Math.round(littlesLawEstimate * 7 * 10) / 10 : null,
    };
  }, [components, statusCounts]);

  // Calculate cumulative values for stacked bar visualization
  const stackData = useMemo(() => {
    let cumulative = 0;
    return STATUS_ORDER.map((status) => {
      const count = statusCounts[status];
      const start = cumulative;
      cumulative += count;
      return { status, count, start, end: cumulative };
    }).filter((d) => d.count > 0);
  }, [statusCounts]);

  const total = components.length;

  if (components.length === 0) {
    return (
      <div className="text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
        <p className="text-slate-400">No components to display in flow diagram.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold">Cumulative Flow</h3>
        <div className="text-xs text-slate-400">
          {components.length} total items
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-cyan-400">{metrics.wip}</div>
          <div className="text-xs text-slate-400">Work in Progress</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-emerald-400">{metrics.completed}</div>
          <div className="text-xs text-slate-400">Completed</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-violet-400">{statusCounts.PLANNING}</div>
          <div className="text-xs text-slate-400">In Backlog</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-white">{metrics.completionRate}%</div>
          <div className="text-xs text-slate-400">Done</div>
        </div>
      </div>

      {/* Kanban Flow Metrics (Little's Law based) */}
      {showKanbanMetrics && (
        <div className="mb-6 p-4 bg-slate-900/30 rounded-lg border border-slate-700">
          <h4 className="text-sm font-medium text-slate-300 mb-3">Flow Metrics</h4>
          <div className="grid grid-cols-3 gap-4">
            {/* Cycle Time */}
            <div>
              <div className="text-lg font-bold text-blue-400">
                {kanbanMetrics.averageCycleTimeDays !== null
                  ? `${kanbanMetrics.averageCycleTimeDays}d`
                  : '—'}
              </div>
              <div className="text-xs text-slate-400">Avg Cycle Time</div>
              {kanbanMetrics.percentileEstimates.p85 !== null && (
                <div className="text-xs text-slate-500 mt-1">
                  85th: {Math.round(kanbanMetrics.percentileEstimates.p85 * 10) / 10}d
                </div>
              )}
            </div>
            {/* Throughput */}
            <div>
              <div className="text-lg font-bold text-green-400">
                {kanbanMetrics.throughputPerWeek !== null
                  ? `${kanbanMetrics.throughputPerWeek}/wk`
                  : '—'}
              </div>
              <div className="text-xs text-slate-400">Throughput</div>
              <div className="text-xs text-slate-500 mt-1">items per week</div>
            </div>
            {/* Little's Law */}
            <div>
              <div className="text-lg font-bold text-purple-400">
                {kanbanMetrics.littlesLawEstimate !== null
                  ? `${kanbanMetrics.littlesLawEstimate}d`
                  : '—'}
              </div>
              <div className="text-xs text-slate-400">Little's Law Est.</div>
              {kanbanMetrics.littlesLawEstimate !== null && (
                <div
                  className={`text-xs mt-1 ${kanbanMetrics.littlesLawValid ? 'text-emerald-400' : 'text-amber-400'}`}
                >
                  {kanbanMetrics.littlesLawValid ? 'Process stable' : 'Process variable'}
                </div>
              )}
            </div>
          </div>
          {/* Forecasting note */}
          {kanbanMetrics.percentileEstimates.p85 !== null && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <p className="text-xs text-slate-400">
                <span className="text-slate-300">Forecasting:</span> 85% of items complete
                within {Math.round(kanbanMetrics.percentileEstimates.p85 * 10) / 10} days.
                {kanbanMetrics.percentileEstimates.p95 !== null && (
                  <> Worst case (95th): {Math.round(kanbanMetrics.percentileEstimates.p95 * 10) / 10} days.</>
                )}
              </p>
            </div>
          )}
          {/* Explanation tooltip */}
          <div className="mt-2 text-xs text-slate-500 italic">
            Little's Law: Cycle Time = WIP / Throughput
          </div>
        </div>
      )}

      {/* Stacked Horizontal Bar */}
      <div className="mb-6">
        <div className="h-12 flex rounded-lg overflow-hidden">
          {stackData.map(({ status, count }) => {
            const widthPercent = (count / total) * 100;
            const colors = statusColors[status];
            return (
              <div
                key={status}
                className="flex items-center justify-center transition-all"
                style={{
                  width: `${widthPercent}%`,
                  backgroundColor: colors.fill,
                  minWidth: count > 0 ? '2rem' : 0,
                }}
                title={`${colors.label}: ${count} (${Math.round(widthPercent)}%)`}
              >
                {widthPercent > 8 && (
                  <span className="text-xs font-medium text-white/90">{count}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="space-y-3">
        {STATUS_ORDER.filter((status) => statusCounts[status] > 0).map((status) => {
          const count = statusCounts[status];
          const percent = Math.round((count / total) * 100);
          const colors = statusColors[status];
          return (
            <div key={status} className="flex items-center gap-3">
              <div className="w-24 text-sm text-slate-300">{colors.label}</div>
              <div className="flex-1 h-6 bg-slate-900/50 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: `${percent}%`,
                    backgroundColor: colors.fill,
                    opacity: 0.7,
                  }}
                />
              </div>
              <div className="w-16 text-sm text-slate-400 text-right">
                {count} ({percent}%)
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-6 pt-4 border-t border-slate-700 text-xs">
        {STATUS_ORDER.map((status) => {
          const colors = statusColors[status];
          return (
            <div key={status} className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded"
                style={{ backgroundColor: colors.fill }}
              />
              <span className="text-slate-400">{colors.label}</span>
            </div>
          );
        })}
      </div>

      {/* WIP Limit Indicator */}
      {metrics.wip > 5 && (
        <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-amber-400 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>High WIP: {metrics.wip} items in progress. Consider limiting work in progress to improve flow.</span>
          </div>
        </div>
      )}
    </div>
  );
}
