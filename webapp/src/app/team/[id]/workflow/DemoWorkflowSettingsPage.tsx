'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { ArrowLeft, Settings, Check } from 'lucide-react';

interface WorkflowConfig {
  workflowTemplate: string;
  cycleEnabled: boolean;
  cycleName: string;
  cycleDurationDays: number;
  componentTypes: string[];
  componentStatuses: string[];
  estimationEnabled: boolean;
  estimationUnit: string;
}

const WORKFLOW_TEMPLATES = [
  { value: 'SCRUM', label: 'Scrum', description: 'Time-boxed sprints with ceremonies' },
  { value: 'KANBAN', label: 'Kanban', description: 'Continuous flow with WIP limits' },
  { value: 'CUSTOM', label: 'Custom', description: 'Build your own workflow' },
];

export default function DemoWorkflowSettingsPage() {
  const params = useParams();
  const teamId = params.id as string;
  const [teamName, setTeamName] = useState('');
  const [config, setConfig] = useState<WorkflowConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const store = demoStore.getStore();
    const team = store.teams.find((t) => t.id === teamId);

    if (!team) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setTeamName(team.name);

    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === teamId);
    setConfig(
      workflowConfig
        ? {
            workflowTemplate: workflowConfig.workflowTemplate,
            cycleEnabled: workflowConfig.cycleEnabled,
            cycleName: workflowConfig.cycleName,
            cycleDurationDays: workflowConfig.cycleDurationWeeks * 7,
            componentTypes: ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'],
            componentStatuses: ['PLANNING', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'],
            estimationEnabled: workflowConfig.enforceEstimates,
            estimationUnit: 'hours',
          }
        : {
            workflowTemplate: 'SCRUM',
            cycleEnabled: true,
            cycleName: 'Sprint',
            cycleDurationDays: 14,
            componentTypes: ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'],
            componentStatuses: ['PLANNING', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'],
            estimationEnabled: true,
            estimationUnit: 'hours',
          }
    );
    setLoading(false);
  }, [teamId]);

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  const handleSave = () => {
    if (!config) return;
    setSaving(true);

    // Update localStorage
    const store = demoStore.getStore();
    const existingIndex = store.workflowConfigs.findIndex((w) => w.teamId === teamId);
    const existingConfig = existingIndex >= 0 ? store.workflowConfigs[existingIndex] : null;
    const now = new Date().toISOString();

    const newConfig = {
      id: existingConfig?.id || `wf-${teamId}`,
      teamId,
      wipLimitPlanning: existingConfig?.wipLimitPlanning ?? null,
      wipLimitInProgress: existingConfig?.wipLimitInProgress ?? null,
      wipLimitBlocked: existingConfig?.wipLimitBlocked ?? null,
      wipLimitReview: existingConfig?.wipLimitReview ?? null,
      cycleEnabled: config.cycleEnabled,
      cycleDurationWeeks: Math.ceil(config.cycleDurationDays / 7),
      cycleStartDayOfWeek: existingConfig?.cycleStartDayOfWeek ?? 1,
      workflowTemplate: config.workflowTemplate,
      cycleName: config.cycleName,
      backlogName: existingConfig?.backlogName ?? 'Backlog',
      enforceEstimates: config.estimationEnabled,
      autoArchiveCompleted: existingConfig?.autoArchiveCompleted ?? false,
      createdAt: existingConfig?.createdAt || now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      store.workflowConfigs[existingIndex] = newConfig;
    } else {
      store.workflowConfigs.push(newConfig);
    }
    demoStore.saveStore(store);

    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 500);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="animate-pulse text-slate-400">Loading settings...</div>
        </main>
      </div>
    );
  }

  if (notFound || !config) {
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

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${teamId}`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Team
          </Link>

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center">
              <Settings className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Workflow Settings</h1>
              <p className="text-slate-400">Configure workflow preferences for {teamName}</p>
            </div>
          </div>

          {/* Settings Form */}
          <div className="space-y-8">
            {/* Workflow Template */}
            <div className="component-card">
              <h2 className="text-lg font-semibold mb-4">Workflow Template</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {WORKFLOW_TEMPLATES.map((template) => (
                  <button
                    key={template.value}
                    onClick={() => setConfig({ ...config, workflowTemplate: template.value })}
                    className={`p-4 rounded-xl border text-left transition-colors ${
                      config.workflowTemplate === template.value
                        ? 'border-cyan-500 bg-cyan-500/10'
                        : 'border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-medium">{template.label}</div>
                    <div className="text-sm text-slate-400">{template.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sprint/Cycle Settings */}
            <div className="component-card">
              <h2 className="text-lg font-semibold mb-4">Time-Boxing</h2>
              <div className="space-y-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.cycleEnabled}
                    onChange={(e) => setConfig({ ...config, cycleEnabled: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span>Enable time-boxed cycles</span>
                </label>

                {config.cycleEnabled && (
                  <div className="grid gap-4 sm:grid-cols-2 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Cycle Name</label>
                      <input
                        type="text"
                        value={config.cycleName}
                        onChange={(e) => setConfig({ ...config, cycleName: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Duration (days)
                      </label>
                      <input
                        type="number"
                        value={config.cycleDurationDays}
                        onChange={(e) =>
                          setConfig({ ...config, cycleDurationDays: parseInt(e.target.value) || 14 })
                        }
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Estimation Settings */}
            <div className="component-card">
              <h2 className="text-lg font-semibold mb-4">Estimation</h2>
              <div className="space-y-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={config.estimationEnabled}
                    onChange={(e) => setConfig({ ...config, estimationEnabled: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span>Enable time estimation</span>
                </label>

                {config.estimationEnabled && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Estimation Unit
                    </label>
                    <select
                      value={config.estimationUnit}
                      onChange={(e) => setConfig({ ...config, estimationUnit: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
                    >
                      <option value="hours">Hours</option>
                      <option value="points">Story Points</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                {saved ? (
                  <>
                    <Check className="w-5 h-5" />
                    Saved
                  </>
                ) : saving ? (
                  'Saving...'
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
