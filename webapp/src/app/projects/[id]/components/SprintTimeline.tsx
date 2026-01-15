'use client';

import { Calendar, Clock, Target, TrendingUp, PlayCircle, PauseCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

type SprintStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

interface Sprint {
  id: string;
  name: string;
  goal?: string | null;
  startDate: Date;
  endDate: Date;
  status: SprintStatus;
  capacity?: number | null;
}

interface Component {
  id: string;
  status: string;
  sprintId?: string | null;
  estimatedHours?: number | null;
}

interface Props {
  sprints: Sprint[];
  components: Component[];
  teamId: string;
  cycleName?: string;
}

export default function SprintTimeline({ sprints, components, teamId, cycleName = 'Sprint' }: Props) {
  const cycleNamePlural = `${cycleName}s`;
  if (sprints.length === 0) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="component-card mb-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5 text-amber-400" />
          {cycleName} Timeline
        </h2>
        <Link href={`/team/${teamId}/sprints`} className="text-sm text-cyan-400 hover:text-cyan-300">
          Manage {cycleNamePlural} →
        </Link>
      </div>

      <div className="space-y-4">
        {sprints.map((sprint) => {
          const sprintComponents = components.filter((c) => c.sprintId === sprint.id);
          const completed = sprintComponents.filter((c) => c.status === 'COMPLETED').length;
          const total = sprintComponents.length;
          const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

          const totalHours = sprintComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
          const completedHours = sprintComponents
            .filter((c) => c.status === 'COMPLETED')
            .reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

          const startDate = new Date(sprint.startDate);
          const endDate = new Date(sprint.endDate);
          const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
          const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
          const timeProgress = sprint.status === 'ACTIVE' ? Math.min(100, (daysElapsed / totalDays) * 100) : 0;

          const isActive = sprint.status === 'ACTIVE';
          const isPast = endDate < today;
          const isUpcoming = startDate > today;

          return (
            <Link
              key={sprint.id}
              href={`/team/${teamId}/sprints/${sprint.id}`}
              className="block p-5 bg-gradient-to-br from-slate-800/50 to-slate-800/30 rounded-lg border border-slate-700/50 hover:border-amber-500/40 hover:shadow-lg transition-all"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                      {sprint.status === 'ACTIVE' && <PlayCircle className="w-5 h-5 text-green-400" />}
                      {sprint.status === 'PLANNING' && <PauseCircle className="w-5 h-5 text-slate-400" />}
                      {sprint.status === 'COMPLETED' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                      {sprint.name}
                    </h3>
                    <span
                      className={`text-xs px-2 py-1 rounded font-medium ${
                        sprint.status === 'ACTIVE'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : sprint.status === 'PLANNING'
                            ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                            : sprint.status === 'COMPLETED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                      }`}
                    >
                      {sprint.status}
                    </span>
                  </div>
                  {sprint.goal && (
                    <p className="text-sm text-slate-400 flex items-start gap-2 mb-3">
                      <Target className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{sprint.goal}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Timeline */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="font-medium">
                    {isActive && `${daysRemaining} days remaining`}
                    {isUpcoming && `Starts in ${daysRemaining} days`}
                    {isPast && 'Ended'}
                  </span>
                  <span className="flex items-center gap-1">
                    {endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    <Calendar className="w-3.5 h-3.5" />
                  </span>
                </div>
                {/* Time progress bar */}
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-gradient-to-r from-slate-500 to-slate-400"
                    style={{ width: `${timeProgress}%` }}
                  />
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {/* Components Progress */}
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Progress
                  </div>
                  <div className="text-lg font-semibold text-slate-200">
                    {progress}%
                    <span className="text-xs text-slate-500 font-normal ml-1">
                      ({completed}/{total})
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-green-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {/* Hours */}
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <Clock className="w-3.5 h-3.5" />
                    Hours
                  </div>
                  <div className="text-lg font-semibold text-slate-200">
                    {completedHours}
                    <span className="text-xs text-slate-500 font-normal">/{totalHours}h</span>
                  </div>
                  {sprint.capacity && <div className="text-xs text-slate-500 mt-1">Cap: {sprint.capacity}h</div>}
                </div>

                {/* Components */}
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1">Components</div>
                  <div className="text-lg font-semibold text-slate-200">{total}</div>
                  <div className="text-xs text-slate-500 mt-1">{completed} done</div>
                </div>

                {/* Duration */}
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1">Duration</div>
                  <div className="text-lg font-semibold text-slate-200">{totalDays} days</div>
                  {isActive && <div className="text-xs text-slate-500 mt-1">{daysElapsed} elapsed</div>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
