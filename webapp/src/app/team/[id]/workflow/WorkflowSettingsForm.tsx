'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateWorkflowConfig } from './actions';
import { toast } from 'sonner';
import { Loader2, Save, Layers, Zap, TrendingUp, Calendar } from 'lucide-react';
import type { TeamWorkflowConfig } from '@prisma/client';

interface Props {
  teamId: string;
  config: TeamWorkflowConfig | null;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const CYCLE_DURATIONS = [
  { value: 1, label: '1 week' },
  { value: 2, label: '2 weeks' },
  { value: 4, label: '4 weeks' },
  { value: 6, label: '6 weeks (Shape Up)' },
];

export default function WorkflowSettingsForm({ teamId, config }: Props) {
  const [wipLimitPlanning, setWipLimitPlanning] = useState<string>(config?.wipLimitPlanning?.toString() || '');
  const [wipLimitInProgress, setWipLimitInProgress] = useState<string>(config?.wipLimitInProgress?.toString() || '');
  const [wipLimitBlocked, setWipLimitBlocked] = useState<string>(config?.wipLimitBlocked?.toString() || '');
  const [wipLimitReview, setWipLimitReview] = useState<string>(config?.wipLimitReview?.toString() || '');
  const [cycleEnabled, setCycleEnabled] = useState(config?.cycleEnabled ?? false);
  const [cycleDurationWeeks, setCycleDurationWeeks] = useState<string>(config?.cycleDurationWeeks?.toString() || '2');
  const [cycleStartDayOfWeek, setCycleStartDayOfWeek] = useState<string>(
    config?.cycleStartDayOfWeek?.toString() || '1',
  );
  const [enforceEstimates, setEnforceEstimates] = useState(config?.enforceEstimates ?? false);
  const [autoArchiveCompleted, setAutoArchiveCompleted] = useState(config?.autoArchiveCompleted ?? false);

  const { execute, isExecuting } = useAction(updateWorkflowConfig, {
    onSuccess: () => {
      toast.success('Workflow settings updated!');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update settings');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    execute({
      teamId,
      wipLimitPlanning: wipLimitPlanning ? parseInt(wipLimitPlanning) : null,
      wipLimitInProgress: wipLimitInProgress ? parseInt(wipLimitInProgress) : null,
      wipLimitBlocked: wipLimitBlocked ? parseInt(wipLimitBlocked) : null,
      wipLimitReview: wipLimitReview ? parseInt(wipLimitReview) : null,
      cycleEnabled,
      cycleDurationWeeks: cycleEnabled && cycleDurationWeeks ? parseInt(cycleDurationWeeks) : null,
      cycleStartDayOfWeek: cycleEnabled && cycleStartDayOfWeek ? parseInt(cycleStartDayOfWeek) : null,
      enforceEstimates,
      autoArchiveCompleted,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* WIP Limits Section */}
      <div className="component-card">
        <div className="flex items-center gap-3 mb-6">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-lg font-semibold">Work-in-Progress Limits</h2>
            <p className="text-sm text-slate-400 mt-1">
              Set soft limits for each status column. Teams will see warnings but can override.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="wipLimitPlanning" className="input-label">
              Planning <span className="text-slate-500">(leave empty for unlimited)</span>
            </label>
            <input
              id="wipLimitPlanning"
              type="number"
              min="1"
              value={wipLimitPlanning}
              onChange={(e) => setWipLimitPlanning(e.target.value)}
              placeholder="Unlimited"
              className="input"
            />
          </div>

          <div>
            <label htmlFor="wipLimitInProgress" className="input-label">
              In Progress <span className="text-slate-500">(leave empty for unlimited)</span>
            </label>
            <input
              id="wipLimitInProgress"
              type="number"
              min="1"
              value={wipLimitInProgress}
              onChange={(e) => setWipLimitInProgress(e.target.value)}
              placeholder="Unlimited"
              className="input"
            />
          </div>

          <div>
            <label htmlFor="wipLimitBlocked" className="input-label">
              Blocked <span className="text-slate-500">(leave empty for unlimited)</span>
            </label>
            <input
              id="wipLimitBlocked"
              type="number"
              min="1"
              value={wipLimitBlocked}
              onChange={(e) => setWipLimitBlocked(e.target.value)}
              placeholder="Unlimited"
              className="input"
            />
          </div>

          <div>
            <label htmlFor="wipLimitReview" className="input-label">
              Review <span className="text-slate-500">(leave empty for unlimited)</span>
            </label>
            <input
              id="wipLimitReview"
              type="number"
              min="1"
              value={wipLimitReview}
              onChange={(e) => setWipLimitReview(e.target.value)}
              placeholder="Unlimited"
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Cycle Settings Section */}
      <div className="component-card">
        <div className="flex items-center gap-3 mb-6">
          <Zap className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-lg font-semibold">Cycle Configuration</h2>
            <p className="text-sm text-slate-400 mt-1">
              Enable time-boxed cycles for your workflow. Disable for continuous flow (Kanban).
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={cycleEnabled}
              onChange={(e) => setCycleEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-cyan-500/50 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 mt-0.5"
            />
            <div>
              <span className="text-sm font-medium text-slate-300">Enable Cycles</span>
              <p className="text-xs text-slate-500 mt-1">
                Use time-boxed cycles (sprints) instead of continuous flow. Components can still exist in the backlog.
              </p>
            </div>
          </label>

          {cycleEnabled && (
            <div className="ml-7 pl-6 border-l-2 border-slate-700 space-y-6">
              <div>
                <label htmlFor="cycleDurationWeeks" className="input-label">
                  <Calendar className="w-4 h-4 inline mr-2" />
                  Cycle Duration
                </label>
                <select
                  id="cycleDurationWeeks"
                  value={cycleDurationWeeks}
                  onChange={(e) => setCycleDurationWeeks(e.target.value)}
                  className="input"
                >
                  {CYCLE_DURATIONS.map((duration) => (
                    <option key={duration.value} value={duration.value}>
                      {duration.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-2">
                  Shape Up methodology uses 6-week cycles with a 2-week cooldown period.
                </p>
              </div>

              <div>
                <label htmlFor="cycleStartDayOfWeek" className="input-label">
                  Cycle Start Day
                </label>
                <select
                  id="cycleStartDayOfWeek"
                  value={cycleStartDayOfWeek}
                  onChange={(e) => setCycleStartDayOfWeek(e.target.value)}
                  className="input"
                >
                  {DAYS_OF_WEEK.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-2">Cycles will start on this day of the week.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Other Settings Section */}
      <div className="component-card">
        <div className="flex items-center gap-3 mb-6">
          <Layers className="w-5 h-5 text-violet-400" />
          <div>
            <h2 className="text-lg font-semibold">Other Settings</h2>
            <p className="text-sm text-slate-400 mt-1">Additional workflow preferences.</p>
          </div>
        </div>

        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enforceEstimates}
              onChange={(e) => setEnforceEstimates(e.target.checked)}
              className="w-4 h-4 rounded border-cyan-500/50 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 mt-0.5"
            />
            <div>
              <span className="text-sm font-medium text-slate-300">Require Estimates</span>
              <p className="text-xs text-slate-500 mt-1">
                Components must have estimated hours before moving to "In Progress" status.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoArchiveCompleted}
              onChange={(e) => setAutoArchiveCompleted(e.target.checked)}
              className="w-4 h-4 rounded border-cyan-500/50 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 mt-0.5"
            />
            <div>
              <span className="text-sm font-medium text-slate-300">Auto-Archive Completed</span>
              <p className="text-xs text-slate-500 mt-1">
                Automatically archive components 30 days after completion to reduce clutter.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-3">
        <button type="submit" className="btn-primary" disabled={isExecuting}>
          {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </button>
      </div>
    </form>
  );
}
