'use client';

import { useEffect, useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import {
  getCycleTimeMetrics,
  getThroughputMetrics,
  getStatusDistribution,
  getCumulativeFlowData,
  getAgingAnalysis,
  type CycleTimeStats,
  type ThroughputData,
  type StatusDistribution,
  type CumulativeFlowData,
  type AgingData,
} from './actions';
import { BarChart3, Clock, TrendingUp, Layers, Loader2, AlertTriangle, Activity } from 'lucide-react';
import type { TeamWorkflowConfig } from '@prisma/client';

interface Props {
  teamId: string;
  workflowConfig: TeamWorkflowConfig | null;
}

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

export default function MetricsClient({ teamId, workflowConfig }: Props) {
  const [days, setDays] = useState(30);
  const [cycleTimeStats, setCycleTimeStats] = useState<CycleTimeStats | null>(null);
  const [throughputData, setThroughputData] = useState<{
    data: ThroughputData[];
    totalCompleted: number;
    dailyAverage: number;
    weeklyAverage: number;
  } | null>(null);
  const [statusDist, setStatusDist] = useState<StatusDistribution[]>([]);
  const [cfdData, setCfdData] = useState<CumulativeFlowData[]>([]);
  const [agingData, setAgingData] = useState<AgingData[]>([]);

  // Determine if this is a Kanban (continuous flow) team
  const isKanban = !workflowConfig?.cycleEnabled;

  const { execute: fetchCycleTime, isExecuting: loadingCycleTime } = useAction(getCycleTimeMetrics, {
    onSuccess: ({ data }) => {
      setCycleTimeStats(data?.stats ?? null);
    },
  });

  const { execute: fetchThroughput, isExecuting: loadingThroughput } = useAction(getThroughputMetrics, {
    onSuccess: ({ data }) => {
      if (data) {
        setThroughputData({
          data: data.data,
          totalCompleted: data.totalCompleted,
          dailyAverage: data.dailyAverage,
          weeklyAverage: data.weeklyAverage,
        });
      }
    },
  });

  const { execute: fetchStatus, isExecuting: loadingStatus } = useAction(getStatusDistribution, {
    onSuccess: ({ data }) => {
      setStatusDist(data?.data ?? []);
    },
  });

  const { execute: fetchCfd, isExecuting: loadingCfd } = useAction(getCumulativeFlowData, {
    onSuccess: ({ data }) => {
      setCfdData(data?.data ?? []);
    },
  });

  const { execute: fetchAging, isExecuting: loadingAging } = useAction(getAgingAnalysis, {
    onSuccess: ({ data }) => {
      setAgingData(data?.data ?? []);
    },
  });

  useEffect(() => {
    fetchCycleTime({ teamId, days });
    fetchThroughput({ teamId, days });
    fetchStatus({ teamId });
    // Kanban-specific metrics
    if (isKanban) {
      fetchCfd({ teamId, days });
      fetchAging({ teamId });
    }
  }, [teamId, days, isKanban]);

  const isLoading = loadingCycleTime || loadingThroughput || loadingStatus || loadingCfd || loadingAging;

  // Calculate total for percentage
  const totalItems = statusDist.reduce((sum, s) => sum + s.count, 0);

  // Find max throughput for chart scaling
  const maxThroughput = Math.max(...(throughputData?.data.map((d) => d.count) || [1]));

  return (
    <div className="space-y-8">
      {/* Time Range Selector */}
      <div className="flex items-center gap-4">
        <label className="text-sm text-slate-400">Time range:</label>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="input w-auto"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />}
      </div>

      {/* Metrics Cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Cycle Time Card */}
        <div className="component-card">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-cyan-400" />
            <h3 className="font-medium">Avg Cycle Time</h3>
          </div>
          {cycleTimeStats ? (
            <div>
              <p className="text-3xl font-bold text-cyan-400">
                {cycleTimeStats.average.toFixed(1)}
                <span className="text-lg text-slate-400 ml-1">days</span>
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Based on {cycleTimeStats.count} completed items
              </p>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No cycle time data</p>
          )}
        </div>

        {/* Median Cycle Time */}
        <div className="component-card">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <h3 className="font-medium">Median Cycle Time</h3>
          </div>
          {cycleTimeStats ? (
            <div>
              <p className="text-3xl font-bold text-emerald-400">
                {cycleTimeStats.median.toFixed(1)}
                <span className="text-lg text-slate-400 ml-1">days</span>
              </p>
              <p className="text-xs text-slate-500 mt-2">
                P85: {cycleTimeStats.p85.toFixed(1)}d | P95: {cycleTimeStats.p95.toFixed(1)}d
              </p>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No data available</p>
          )}
        </div>

        {/* Throughput */}
        <div className="component-card">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            <h3 className="font-medium">Weekly Throughput</h3>
          </div>
          {throughputData ? (
            <div>
              <p className="text-3xl font-bold text-amber-400">
                {throughputData.weeklyAverage.toFixed(1)}
                <span className="text-lg text-slate-400 ml-1">items/week</span>
              </p>
              <p className="text-xs text-slate-500 mt-2">
                {throughputData.totalCompleted} completed in {days} days
              </p>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No throughput data</p>
          )}
        </div>

        {/* Current WIP */}
        <div className="component-card">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-violet-400" />
            <h3 className="font-medium">Work in Progress</h3>
          </div>
          <p className="text-3xl font-bold text-violet-400">
            {statusDist.find((s) => s.status === 'IN_PROGRESS')?.count || 0}
            <span className="text-lg text-slate-400 ml-1">items</span>
          </p>
          <p className="text-xs text-slate-500 mt-2">Currently in progress</p>
        </div>
      </div>

      {/* Throughput Chart */}
      <div className="component-card">
        <h3 className="font-medium mb-6">Weekly Throughput</h3>
        {throughputData && throughputData.data.length > 0 ? (
          <div className="flex items-end gap-2 h-40">
            {throughputData.data.map((week) => (
              <div key={week.date} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full bg-cyan-500 rounded-t transition-all"
                  style={{
                    height: `${(week.count / maxThroughput) * 100}%`,
                    minHeight: week.count > 0 ? '8px' : '0',
                  }}
                />
                <span className="text-xs text-slate-500 -rotate-45 origin-left whitespace-nowrap">
                  {new Date(week.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-8">
            No throughput data for this period
          </p>
        )}
      </div>

      {/* Status Distribution */}
      <div className="component-card">
        <h3 className="font-medium mb-6">Status Distribution</h3>
        {statusDist.length > 0 ? (
          <div className="space-y-4">
            {/* Progress bar */}
            <div className="flex h-8 rounded-lg overflow-hidden">
              {statusDist.map((status) => (
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
              {statusDist.map((status) => (
                <div key={status.status} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded ${STATUS_COLORS[status.status]}`} />
                  <span className="text-sm text-slate-400">
                    {STATUS_LABELS[status.status]}: {status.count} (
                    {((status.count / totalItems) * 100).toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-8">No components yet</p>
        )}
      </div>

      {/* Cumulative Flow Diagram (Kanban-specific) */}
      {isKanban && cfdData.length > 0 && (
        <div className="component-card">
          <div className="flex items-center gap-2 mb-6">
            <Activity className="w-5 h-5 text-violet-400" />
            <h3 className="font-medium">Cumulative Flow Diagram</h3>
          </div>
          <div className="h-48 flex items-end gap-1">
            {cfdData.slice(-14).map((day, idx) => {
              const total = day.PLANNING + day.IN_PROGRESS + day.BLOCKED + day.REVIEW + day.COMPLETED;
              if (total === 0) return null;
              const maxTotal = Math.max(...cfdData.slice(-14).map(d =>
                d.PLANNING + d.IN_PROGRESS + d.BLOCKED + d.REVIEW + d.COMPLETED
              ));

              return (
                <div key={day.date} className="flex-1 flex flex-col h-full justify-end">
                  <div className="flex flex-col rounded-t overflow-hidden" style={{ height: `${(total / maxTotal) * 100}%` }}>
                    {day.COMPLETED > 0 && (
                      <div
                        className="bg-emerald-500"
                        style={{ height: `${(day.COMPLETED / total) * 100}%` }}
                        title={`Completed: ${day.COMPLETED}`}
                      />
                    )}
                    {day.REVIEW > 0 && (
                      <div
                        className="bg-amber-500"
                        style={{ height: `${(day.REVIEW / total) * 100}%` }}
                        title={`Review: ${day.REVIEW}`}
                      />
                    )}
                    {day.BLOCKED > 0 && (
                      <div
                        className="bg-red-500"
                        style={{ height: `${(day.BLOCKED / total) * 100}%` }}
                        title={`Blocked: ${day.BLOCKED}`}
                      />
                    )}
                    {day.IN_PROGRESS > 0 && (
                      <div
                        className="bg-cyan-500"
                        style={{ height: `${(day.IN_PROGRESS / total) * 100}%` }}
                        title={`In Progress: ${day.IN_PROGRESS}`}
                      />
                    )}
                    {day.PLANNING > 0 && (
                      <div
                        className="bg-slate-500"
                        style={{ height: `${(day.PLANNING / total) * 100}%` }}
                        title={`Planning: ${day.PLANNING}`}
                      />
                    )}
                  </div>
                  {idx % 2 === 0 && (
                    <span className="text-[10px] text-slate-500 mt-1 -rotate-45 origin-left whitespace-nowrap">
                      {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4 mt-4">
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-slate-500" /><span className="text-xs text-slate-400">Planning</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-cyan-500" /><span className="text-xs text-slate-400">In Progress</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-red-500" /><span className="text-xs text-slate-400">Blocked</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-amber-500" /><span className="text-xs text-slate-400">Review</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-emerald-500" /><span className="text-xs text-slate-400">Completed</span></div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            CFD shows bottlenecks - if bands widen, work is accumulating in that status.
          </p>
        </div>
      )}

      {/* Aging Analysis (Kanban-specific) */}
      {isKanban && agingData.length > 0 && (
        <div className="component-card">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h3 className="font-medium">Aging Analysis</h3>
          </div>
          <div className="space-y-4">
            {agingData.filter(d => d.itemCount > 0).map(status => {
              const isWarning =
                (status.status === 'IN_PROGRESS' && status.avgDays > 5) ||
                (status.status === 'BLOCKED' && status.avgDays > 2) ||
                (status.status === 'REVIEW' && status.avgDays > 3);
              const isCritical =
                (status.status === 'IN_PROGRESS' && status.avgDays > 7) ||
                (status.status === 'BLOCKED' && status.avgDays > 3) ||
                (status.status === 'REVIEW' && status.avgDays > 5);

              return (
                <div key={status.status} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded ${STATUS_COLORS[status.status]}`} />
                    <span className="text-sm">{STATUS_LABELS[status.status]}</span>
                    <span className="text-xs text-slate-500">({status.itemCount} items)</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className={`text-sm font-medium ${
                        isCritical ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-slate-300'
                      }`}>
                        Avg: {status.avgDays.toFixed(1)}d
                      </span>
                      <span className="text-xs text-slate-500 ml-2">
                        Max: {status.maxDays.toFixed(1)}d
                      </span>
                    </div>
                    {isCritical && <AlertTriangle className="w-4 h-4 text-red-400" />}
                    {isWarning && !isCritical && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-4">
            High aging in a column indicates a bottleneck. Consider WIP limits or process improvements.
          </p>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <h4 className="font-medium text-slate-300 mb-2">Understanding These Metrics</h4>
        <ul className="text-sm text-slate-400 space-y-1">
          <li>
            <strong>Cycle Time</strong>: Time from when work starts (In Progress) until completion.
            Lower is generally better.
          </li>
          <li>
            <strong>Throughput</strong>: Number of items completed per week. Tracks team delivery
            velocity.
          </li>
          <li>
            <strong>WIP</strong>: Work in Progress. Keep this low to reduce context switching and
            improve flow.
          </li>
          {isKanban && (
            <>
              <li>
                <strong>Cumulative Flow</strong>: Shows work distribution over time. Widening bands indicate bottlenecks.
              </li>
              <li>
                <strong>Aging Analysis</strong>: Shows how long items sit in each status. Helps identify stuck work.
              </li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
