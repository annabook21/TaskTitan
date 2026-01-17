'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Users,
  Check,
  RotateCcw,
  Columns3,
  Calendar,
  Settings,
} from 'lucide-react';
import {
  WORKFLOW_TEMPLATES,
  getTemplateSettings,
  type WorkflowTemplateKey,
} from '@/lib/workflow-templates';

const TEMPLATE_ICONS: Record<WorkflowTemplateKey, React.ReactNode> = {
  SCRUM: <RotateCcw className="w-6 h-6" />,
  KANBAN: <Columns3 className="w-6 h-6" />,
  SHAPE_UP: <Calendar className="w-6 h-6" />,
  CUSTOM: <Settings className="w-6 h-6" />,
};

const TEMPLATE_ORDER: WorkflowTemplateKey[] = ['SCRUM', 'KANBAN', 'SHAPE_UP', 'CUSTOM'];

export default function DemoNewTeamPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplateKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  const canProceedToStep2 = name.trim().length > 0;

  const handleSubmit = async () => {
    setError('');

    if (!name.trim()) {
      setError('Team name is required');
      return;
    }

    setSubmitting(true);

    try {
      const store = demoStore.getStore();
      const newTeamId = `team-${Date.now()}`;
      const now = new Date().toISOString();

      // Create team
      const newTeam = {
        id: newTeamId,
        name: name.trim(),
        description: description.trim() || null,
        createdAt: now,
        updatedAt: now,
      };
      store.teams.push(newTeam);

      // Create membership (owner)
      store.memberships.push({
        id: `membership-${Date.now()}`,
        userId: DEMO_USER.id,
        teamId: newTeamId,
        role: 'OWNER',
        joinedAt: now,
        title: null,
        hoursPerDay: 6,
        availability: 100,
      });

      // Get template settings (defaults to CUSTOM if not specified)
      const templateKey: WorkflowTemplateKey = selectedTemplate ?? 'CUSTOM';
      const templateSettings = getTemplateSettings(templateKey);

      // Create workflow config with template settings
      store.workflowConfigs.push({
        id: `wf-${newTeamId}`,
        teamId: newTeamId,
        workflowTemplate: templateKey,
        wipLimitPlanning: templateSettings?.wipLimitPlanning ?? null,
        wipLimitInProgress: templateSettings?.wipLimitInProgress ?? null,
        wipLimitBlocked: templateSettings?.wipLimitBlocked ?? null,
        wipLimitReview: templateSettings?.wipLimitReview ?? null,
        cycleEnabled: templateSettings?.cycleEnabled ?? false,
        cycleDurationWeeks: templateSettings?.cycleDurationWeeks ?? 2,
        cycleStartDayOfWeek: templateSettings?.cycleStartDayOfWeek ?? 1,
        cycleName: templateSettings?.cycleName ?? 'Sprint',
        backlogName: templateSettings?.backlogName ?? 'Backlog',
        enforceEstimates: templateSettings?.enforceEstimates ?? false,
        autoArchiveCompleted: templateSettings?.autoArchiveCompleted ?? false,
        createdAt: now,
        updatedAt: now,
      });

      demoStore.saveStore(store);

      router.push(`/team/${newTeamId}`);
    } catch {
      setError('Failed to create team');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href="/team"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Teams
          </Link>

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Create New Team</h1>
              <p className="text-slate-400">Set up a team to collaborate on projects</p>
            </div>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center gap-2 mb-8">
            <div className={`flex items-center gap-2 ${step >= 1 ? 'text-violet-400' : 'text-slate-500'}`}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= 1 ? 'bg-violet-500/20 border border-violet-500/50' : 'bg-slate-800 border border-slate-700'}`}
              >
                {step > 1 ? <Check className="w-4 h-4" /> : '1'}
              </div>
              <span className="text-sm font-medium">Team Details</span>
            </div>
            <div className={`flex-1 h-px ${step >= 2 ? 'bg-violet-500/50' : 'bg-slate-700'}`} />
            <div className={`flex items-center gap-2 ${step >= 2 ? 'text-violet-400' : 'text-slate-500'}`}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${step >= 2 ? 'bg-violet-500/20 border border-violet-500/50' : 'bg-slate-800 border border-slate-700'}`}
              >
                2
              </div>
              <span className="text-sm font-medium">Workflow</span>
            </div>
          </div>

          {/* Step 1: Team Details */}
          {step === 1 && (
            <div className="component-card space-y-6">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Team Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Engineering, Design, Marketing"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Description <span className="text-slate-500">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this team work on?"
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:border-cyan-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <Link href="/team" className="btn-secondary">
                  Cancel
                </Link>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canProceedToStep2}
                  onClick={() => setStep(2)}
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Workflow Selection */}
          {step === 2 && (
            <div className="component-card space-y-6">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <h3 className="text-lg font-semibold mb-2">Choose a Workflow</h3>
                <p className="text-sm text-slate-400 mb-4">
                  Select a methodology for your team. You can customize these settings later.
                </p>

                <div className="grid gap-3">
                  {TEMPLATE_ORDER.map((key) => {
                    const template = WORKFLOW_TEMPLATES[key];
                    const isSelected = selectedTemplate === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedTemplate(isSelected ? null : key)}
                        className={`flex items-start gap-4 p-4 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'bg-violet-500/10 border-violet-500/50'
                            : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                        }`}
                      >
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'bg-violet-500/20 text-violet-400' : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          {TEMPLATE_ICONS[key]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${isSelected ? 'text-violet-300' : 'text-slate-200'}`}>
                              {template.name}
                            </span>
                            {isSelected && <Check className="w-4 h-4 text-violet-400" />}
                          </div>
                          <p className="text-sm text-slate-400 mt-0.5">{template.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-slate-500 mt-4">
                  No selection will default to Custom workflow. You can always change this in team settings.
                </p>
              </div>

              <div className="flex justify-between gap-3 pt-4 border-t border-slate-800">
                <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button type="button" className="btn-primary" disabled={submitting} onClick={handleSubmit}>
                  {submitting ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
