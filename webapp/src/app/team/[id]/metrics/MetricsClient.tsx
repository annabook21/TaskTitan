'use client';

import { useEffect, useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import {
  getCycleTimeMetrics,
  getThroughputMetrics,
  getStatusDistribution,
  type CycleTimeStats,
  type ThroughputData,
  type StatusDistribution,
} from './actions';
import { BarChart3, Clock, TrendingUp, Layers, Loader2 } from 'lucide-react';
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

  useEffect(() => {
    fetchCycleTime({ teamId, days });
    fetchThroughput({ teamId, days });
    fetchStatus({ teamId });
  }, [teamId, days]);

  const isLoading = loadingCycleTime || loadingThroughput || loadingStatus;

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
        </ul>
      </div>
    </div>
  );
}
