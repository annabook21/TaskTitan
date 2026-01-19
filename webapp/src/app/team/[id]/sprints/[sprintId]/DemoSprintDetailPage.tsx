'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import type { DemoSprint, DemoComponent } from '@/lib/demo/types';
import Header from '@/components/Header';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Target,
  Clock,
  CheckCircle2,
  AlertCircle,
  PlayCircle,
  PauseCircle,
  Zap,
  FolderKanban,
  XCircle,
  ChevronRight,
} from 'lucide-react';
import SprintRefineButton from './SprintRefineButton';

const statusConfig = {
  PLANNING: {
    label: 'Planning',
    color: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
    icon: PauseCircle,
  },
  ACTIVE: {
    label: 'Active',
    color: 'text-green-400 bg-green-500/10 border-green-500/30',
    icon: PlayCircle,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-red-400 bg-red-500/10 border-red-500/30',
    icon: XCircle,
  },
};

const componentStatusColors: Record<string, string> = {
  PLANNING: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  IN_PROGRESS: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  REVIEW: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  BLOCKED: 'bg-red-500/20 text-red-300 border-red-500/30',
  COMPLETED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const typeColors: Record<string, string> = {
  EPIC: 'bg-purple-500/20 text-purple-300',
  FEATURE: 'bg-blue-500/20 text-blue-300',
  STORY: 'bg-cyan-500/20 text-cyan-300',
  TASK: 'bg-slate-500/20 text-slate-300',
  BUG: 'bg-red-500/20 text-red-300',
};

interface SprintData extends DemoSprint {
  teamName: string;
  components: DemoComponent[];
}

export default function DemoSprintDetailPage() {
  const params = useParams();
  const teamId = params.id as string;
  const sprintId = params.sprintId as string;
  const [sprint, setSprint] = useState<SprintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const store = demoStore.getStore();

    const sprintData = store.sprints.find((s) => s.id === sprintId && s.teamId === teamId);
    if (!sprintData) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const team = store.teams.find((t) => t.id === teamId);
    const components = store.components.filter((c) => c.sprintId === sprintId);

    setSprint({
      ...sprintData,
      teamName: team?.name || 'Unknown Team',
      components,
    });
    setLoading(false);
  }, [teamId, sprintId]);

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
          <div className="animate-pulse text-slate-400">Loading sprint...</div>
        </main>
      </div>
    );
  }

  if (notFound || !sprint) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-300 mb-2">Sprint not found</h1>
            <p className="text-slate-500 mb-4">This sprint doesn&apos;t exist in demo mode.</p>
            <Link href={`/team/${teamId}/sprints`} className="btn-primary">
              Back to Sprints
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const config = statusConfig[sprint.status];
  const StatusIcon = config.icon;

  // Calculate metrics
  const totalComponents = sprint.components.length;
  const completedComponents = sprint.components.filter((c) => c.status === 'COMPLETED').length;
  const blockedComponents = sprint.components.filter((c) => c.status === 'BLOCKED').length;
  const inProgressComponents = sprint.components.filter((c) => c.status === 'IN_PROGRESS').length;

  const totalHours = sprint.components.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
  const completedHours = sprint.components
    .filter((c) => c.status === 'COMPLETED')
    .reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

  const progress = totalComponents > 0 ? Math.round((completedComponents / totalComponents) * 100) : 0;

  const startDate = sprint.startDate ? new Date(sprint.startDate) : new Date();
  const endDate = sprint.endDate ? new Date(sprint.endDate) : new Date();
  const daysTotal = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(0, Math.ceil((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${teamId}/sprints`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sprints
          </Link>

          {/* Sprint Header */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 flex items-center justify-center">
                <Zap className="w-8 h-8 text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-3xl font-bold">{sprint.name}</h1>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${config.color}`}
                  >
                    <StatusIcon className="w-4 h-4" />
                    {config.label}
                  </span>
                </div>
                {sprint.goal && (
                  <p className="text-slate-400 max-w-2xl flex items-start gap-2">
                    <Target className="w-4 h-4 mt-1 flex-shrink-0" />
                    {sprint.goal}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FolderKanban className="w-4 h-4" />
                    {totalComponents} items
                  </span>
                  {sprint.status === 'ACTIVE' && daysRemaining > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <Clock className="w-4 h-4" />
                      {daysRemaining} days remaining
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Refine with AI button */}
            <div className="flex items-center gap-3">
              <SprintRefineButton sprintId={sprintId} sprintName={sprint.name} teamId={teamId} />
            </div>
          </div>

          {/* Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="component-card text-center">
              <div className="text-3xl font-bold text-cyan-400">{progress}%</div>
              <div className="text-sm text-slate-400 mt-1">Complete</div>
              <div className="h-2 bg-slate-700 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-green-500" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="component-card text-center">
              <div className="text-3xl font-bold text-green-400">{completedComponents}</div>
              <div className="text-sm text-slate-400 mt-1">Completed</div>
              <div className="text-xs text-slate-500 mt-2">of {totalComponents} items</div>
            </div>

            <div className="component-card text-center">
              <div className="text-3xl font-bold text-amber-400">{inProgressComponents}</div>
              <div className="text-sm text-slate-400 mt-1">In Progress</div>
              {blockedComponents > 0 && (
                <div className="text-xs text-red-400 mt-2 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {blockedComponents} blocked
                </div>
              )}
            </div>

            <div className="component-card text-center">
              <div className="text-3xl font-bold text-violet-400">{Math.round(completedHours)}</div>
              <div className="text-sm text-slate-400 mt-1">Hours Done</div>
              <div className="text-xs text-slate-500 mt-2">of {Math.round(totalHours)}h planned</div>
            </div>
          </div>

          {/* Components List */}
          <div className="component-card">
            <h2 className="text-lg font-semibold mb-4">Sprint Items</h2>
            {sprint.components.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <FolderKanban className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No items in this sprint yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sprint.components.map((component) => (
                  <div
                    key={component.id}
                    className="flex items-center gap-4 p-3 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    <span className={`text-xs px-2 py-0.5 rounded ${typeColors[component.type]}`}>
                      {component.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-slate-200 truncate">{component.name}</h3>
                      {component.description && (
                        <p className="text-sm text-slate-500 truncate">{component.description}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded border ${componentStatusColors[component.status]}`}>
                      {component.status.replace('_', ' ')}
                    </span>
                    {component.estimatedHours && (
                      <span className="text-xs text-slate-500">{component.estimatedHours}h</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
