'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateWorkflowConfig } from './actions';
import { toast } from 'sonner';
import { Loader2, Save, Layers, Zap, TrendingUp, Calendar, LayoutTemplate, Type } from 'lucide-react';
import type { TeamWorkflowConfig } from '@/lib/prisma-compat';
import { WORKFLOW_TEMPLATES, type WorkflowTemplateKey, getTemplateSettings } from '@/lib/workflow-templates';
import { CYCLE_NAME_OPTIONS, BACKLOG_NAME_OPTIONS } from '@/lib/terminology';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';

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
  // Workflow template
  const [workflowTemplate, setWorkflowTemplate] = useState<WorkflowTemplateKey>(
    (config?.workflowTemplate as WorkflowTemplateKey) || 'CUSTOM',
  );

  // WIP Limits
  const [wipLimitPlanning, setWipLimitPlanning] = useState<string>(config?.wipLimitPlanning?.toString() || '');
  const [wipLimitInProgress, setWipLimitInProgress] = useState<string>(config?.wipLimitInProgress?.toString() || '');
  const [wipLimitBlocked, setWipLimitBlocked] = useState<string>(config?.wipLimitBlocked?.toString() || '');
  const [wipLimitReview, setWipLimitReview] = useState<string>(config?.wipLimitReview?.toString() || '');

  // Cycle settings
  const [cycleEnabled, setCycleEnabled] = useState(config?.cycleEnabled ?? false);
  const [cycleDurationWeeks, setCycleDurationWeeks] = useState<string>(config?.cycleDurationWeeks?.toString() || '2');
  const [cycleStartDayOfWeek, setCycleStartDayOfWeek] = useState<string>(
    config?.cycleStartDayOfWeek?.toString() || '1',
  );

  // Terminology
  const [cycleName, setCycleName] = useState(config?.cycleName || 'Sprint');
  const [backlogName, setBacklogName] = useState(config?.backlogName || 'Backlog');

  // Other settings
  const [enforceEstimates, setEnforceEstimates] = useState(config?.enforceEstimates ?? false);
  const [autoArchiveCompleted, setAutoArchiveCompleted] = useState(config?.autoArchiveCompleted ?? false);
  const { handleResult } = useDemoActionHandler();

  const { execute, isExecuting } = useAction(updateWorkflowConfig, {
    onSuccess: ({ data }) => {
      if (data && isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('Workflow settings updated!');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update settings');
    },
  });

  const applyTemplate = (templateKey: WorkflowTemplateKey) => {
    setWorkflowTemplate(templateKey);

    const settings = getTemplateSettings(templateKey);
    if (!settings) return; // CUSTOM template - don't change settings

    // Apply all template settings
    setCycleEnabled(settings.cycleEnabled);
    if (settings.cycleDurationWeeks) setCycleDurationWeeks(settings.cycleDurationWeeks.toString());
    if (settings.cycleStartDayOfWeek !== undefined) setCycleStartDayOfWeek(settings.cycleStartDayOfWeek.toString());
    setCycleName(settings.cycleName);
    setBacklogName(settings.backlogName);
    setEnforceEstimates(settings.enforceEstimates);
    setAutoArchiveCompleted(settings.autoArchiveCompleted);
    setWipLimitPlanning(settings.wipLimitPlanning?.toString() || '');
    setWipLimitInProgress(settings.wipLimitInProgress?.toString() || '');
    setWipLimitBlocked(settings.wipLimitBlocked?.toString() || '');
    setWipLimitReview(settings.wipLimitReview?.toString() || '');

    toast.info(`Applied ${WORKFLOW_TEMPLATES[templateKey].name} template`);
  };

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
      workflowTemplate,
      cycleName,
      backlogName,
      enforceEstimates,
      autoArchiveCompleted,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Workflow Template Section */}
      <div className="component-card">
        <div className="flex items-center gap-3 mb-6">
          <LayoutTemplate className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-lg font-semibold">Workflow Template</h2>
            <p className="text-sm text-slate-400 mt-1">Choose a preset or customize your own workflow settings.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(Object.entries(WORKFLOW_TEMPLATES) as [WorkflowTemplateKey, typeof WORKFLOW_TEMPLATES.SCRUM][]).map(
            ([key, template]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyTemplate(key)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  workflowTemplate === key
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <h3 className="font-medium text-slate-200">{template.name}</h3>
                <p className="text-xs text-slate-400 mt-1">{template.description}</p>
              </button>
            ),
          )}
        </div>
      </div>

      {/* Terminology Section */}
      <div className="component-card">
        <div className="flex items-center gap-3 mb-6">
          <Type className="w-5 h-5 text-pink-400" />
          <div>
            <h2 className="text-lg font-semibold">Terminology</h2>
            <p className="text-sm text-slate-400 mt-1">Customize the language used throughout your workspace.</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="cycleName" className="input-label">
              Cycle Name
            </label>
            <select
              id="cycleName"
              value={cycleName}
              onChange={(e) => {
                setCycleName(e.target.value);
                setWorkflowTemplate('CUSTOM');
              }}
              className="input"
            >
              {CYCLE_NAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-2">
              {CYCLE_NAME_OPTIONS.find((o) => o.value === cycleName)?.description}
            </p>
          </div>

          <div>
            <label htmlFor="backlogName" className="input-label">
              Backlog Name
            </label>
            <select
              id="backlogName"
              value={backlogName}
              onChange={(e) => {
                setBacklogName(e.target.value);
                setWorkflowTemplate('CUSTOM');
              }}
              className="input"
            >
              {BACKLOG_NAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-2">
              {BACKLOG_NAME_OPTIONS.find((o) => o.value === backlogName)?.description}
            </p>
          </div>
        </div>
      </div>

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
              onChange={(e) => {
                setWipLimitPlanning(e.target.value);
                setWorkflowTemplate('CUSTOM');
              }}
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
              onChange={(e) => {
                setWipLimitInProgress(e.target.value);
                setWorkflowTemplate('CUSTOM');
              }}
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
              onChange={(e) => {
                setWipLimitBlocked(e.target.value);
                setWorkflowTemplate('CUSTOM');
              }}
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
              onChange={(e) => {
                setWipLimitReview(e.target.value);
                setWorkflowTemplate('CUSTOM');
              }}
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
            <h2 className="text-lg font-semibold">{cycleName} Configuration</h2>
            <p className="text-sm text-slate-400 mt-1">
              Enable time-boxed {cycleName.toLowerCase()}s for your workflow. Disable for continuous flow (Kanban).
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={cycleEnabled}
              onChange={(e) => {
                setCycleEnabled(e.target.checked);
                setWorkflowTemplate('CUSTOM');
              }}
              className="w-4 h-4 rounded border-cyan-500/50 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 mt-0.5"
            />
            <div>
              <span className="text-sm font-medium text-slate-300">Enable {cycleName}s</span>
              <p className="text-xs text-slate-500 mt-1">
                Use time-boxed {cycleName.toLowerCase()}s instead of continuous flow. Components can still exist in the{' '}
                {backlogName.toLowerCase()}.
              </p>
            </div>
          </label>

          {cycleEnabled && (
            <div className="ml-7 pl-6 border-l-2 border-slate-700 space-y-6">
              <div>
                <label htmlFor="cycleDurationWeeks" className="input-label">
                  <Calendar className="w-4 h-4 inline mr-2" />
                  {cycleName} Duration
                </label>
                <select
                  id="cycleDurationWeeks"
                  value={cycleDurationWeeks}
                  onChange={(e) => {
                    setCycleDurationWeeks(e.target.value);
                    setWorkflowTemplate('CUSTOM');
                  }}
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
                  {cycleName} Start Day
                </label>
                <select
                  id="cycleStartDayOfWeek"
                  value={cycleStartDayOfWeek}
                  onChange={(e) => {
                    setCycleStartDayOfWeek(e.target.value);
                    setWorkflowTemplate('CUSTOM');
                  }}
                  className="input"
                >
                  {DAYS_OF_WEEK.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-2">{cycleName}s will start on this day of the week.</p>
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
              onChange={(e) => {
                setEnforceEstimates(e.target.checked);
                setWorkflowTemplate('CUSTOM');
              }}
              className="w-4 h-4 rounded border-cyan-500/50 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 mt-0.5"
            />
            <div>
              <span className="text-sm font-medium text-slate-300">Require Estimates</span>
              <p className="text-xs text-slate-500 mt-1">
                Components must have estimated hours before moving to &quot;In Progress&quot; status.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoArchiveCompleted}
              onChange={(e) => {
                setAutoArchiveCompleted(e.target.checked);
                setWorkflowTemplate('CUSTOM');
              }}
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
