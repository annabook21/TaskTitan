'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { ArrowLeft, BarChart3, TrendingUp, Clock, CheckCircle2, Layers } from 'lucide-react';

interface MetricsData {
  teamName: string;
  totalComponents: number;
  completedComponents: number;
  inProgressComponents: number;
  totalEstimatedHours: number;
  completedHours: number;
  averageCompletionTime: number;
  componentsByStatus: Record<string, number>;
  componentsByType: Record<string, number>;
  cycleEnabled: boolean;
  cycleName: string;
}

export default function DemoMetricsPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.id as string;
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const store = demoStore.getStore();
    const team = store.teams.find((t) => t.id === teamId);

    if (!team) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Check membership
    const membership = store.memberships.find((m) => m.teamId === teamId && m.userId === DEMO_USER.id);
    if (!membership) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // Get workflow config
    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === teamId);

    // Get all projects for this team
    const teamProjects = store.projects.filter((p) => p.teamId === teamId);
    const projectIds = teamProjects.map((p) => p.id);

    // Get all components for these projects
    const components = store.components.filter((c) => projectIds.includes(c.projectId));

    // Calculate metrics
    const componentsByStatus: Record<string, number> = {};
    const componentsByType: Record<string, number> = {};

    components.forEach((c) => {
      componentsByStatus[c.status] = (componentsByStatus[c.status] || 0) + 1;
      componentsByType[c.type] = (componentsByType[c.type] || 0) + 1;
    });

    const completedComponents = components.filter((c) => c.status === 'COMPLETED');
    const inProgressComponents = components.filter((c) => c.status === 'IN_PROGRESS');

    // Calculate average completion time from actual data (createdAt to updatedAt for completed components)
    let averageCompletionTime = 0;
    if (completedComponents.length > 0) {
      const totalDays = completedComponents.reduce((sum, c) => {
        const created = new Date(c.createdAt).getTime();
        const completed = new Date(c.updatedAt).getTime();
        const days = (completed - created) / (1000 * 60 * 60 * 24);
        return sum + Math.max(0, days); // Ensure non-negative
      }, 0);
      averageCompletionTime = Math.round((totalDays / completedComponents.length) * 10) / 10;
    }

    setMetrics({
      teamName: team.name,
      totalComponents: components.length,
      completedComponents: completedComponents.length,
      inProgressComponents: inProgressComponents.length,
      totalEstimatedHours: components.reduce((sum, c) => sum + (c.estimatedHours || 0), 0),
      completedHours: completedComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0),
      averageCompletionTime,
      componentsByStatus,
      componentsByType,
      cycleEnabled: workflowConfig?.cycleEnabled ?? true,
      cycleName: workflowConfig?.cycleName || 'Sprint',
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
          <div className="animate-pulse text-slate-400">Loading metrics...</div>
        </main>
      </div>
    );
  }

  if (notFound || !metrics) {
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

  const completionRate =
    metrics.totalComponents > 0 ? Math.round((metrics.completedComponents / metrics.totalComponents) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${teamId}`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Team
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <BarChart3 className="w-7 h-7 text-emerald-400" />
              Team Metrics
            </h1>
            <p className="text-slate-400 mt-1">
              {metrics.cycleEnabled
                ? `Track your team's performance across ${metrics.cycleName.toLowerCase()}s`
                : "Track your team's flow metrics and throughput"}
            </p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="component-card">
              <div className="flex items-center gap-3 mb-2">
                <Layers className="w-5 h-5 text-cyan-400" />
                <span className="text-sm text-slate-400">Total Items</span>
              </div>
              <div className="text-2xl font-bold">{metrics.totalComponents}</div>
            </div>

            <div className="component-card">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-sm text-slate-400">Completed</span>
              </div>
              <div className="text-2xl font-bold">{metrics.completedComponents}</div>
            </div>

            <div className="component-card">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-5 h-5 text-violet-400" />
                <span className="text-sm text-slate-400">Completion Rate</span>
              </div>
              <div className="text-2xl font-bold">{completionRate}%</div>
            </div>

            <div className="component-card">
              <div className="flex items-center gap-3 mb-2">
                <Clock className="w-5 h-5 text-amber-400" />
                <span className="text-sm text-slate-400">Hours Completed</span>
              </div>
              <div className="text-2xl font-bold">
                {metrics.completedHours}/{metrics.totalEstimatedHours}h
              </div>
            </div>
          </div>

          {/* Status Breakdown */}
          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <div className="component-card">
              <h2 className="text-lg font-semibold mb-4">By Status</h2>
              <div className="space-y-3">
                {Object.entries(metrics.componentsByStatus).map(([status, count]) => {
                  const percentage = Math.round((count / metrics.totalComponents) * 100);
                  const colors: Record<string, string> = {
                    PLANNING: 'bg-violet-500',
                    IN_PROGRESS: 'bg-cyan-500',
                    REVIEW: 'bg-amber-500',
                    BLOCKED: 'bg-red-500',
                    COMPLETED: 'bg-emerald-500',
                  };
                  return (
                    <div key={status}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-300">{status.replace('_', ' ')}</span>
                        <span className="text-slate-500">
                          {count} ({percentage}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${colors[status] || 'bg-slate-500'}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="component-card">
              <h2 className="text-lg font-semibold mb-4">By Type</h2>
              <div className="space-y-3">
                {Object.entries(metrics.componentsByType).map(([type, count]) => {
                  const percentage = Math.round((count / metrics.totalComponents) * 100);
                  const colors: Record<string, string> = {
                    EPIC: 'bg-purple-500',
                    FEATURE: 'bg-blue-500',
                    STORY: 'bg-cyan-500',
                    TASK: 'bg-slate-500',
                    BUG: 'bg-red-500',
                  };
                  return (
                    <div key={type}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-300">{type}</span>
                        <span className="text-slate-500">
                          {count} ({percentage}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${colors[type] || 'bg-slate-500'}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Demo Notice */}
          <div className="component-card bg-amber-500/5 border-amber-500/20">
            <p className="text-sm text-amber-300">
              This is demo data. In the full version, you&apos;ll see detailed velocity charts, burndown graphs,
              and historical trends.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
