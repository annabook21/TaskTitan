'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, ArrowLeft, ArrowRight, Loader2, Check, RotateCcw, Columns3, Calendar, Settings } from 'lucide-react';
import Link from 'next/link';
import { useAction } from 'next-safe-action/hooks';
import { createTeam } from '../actions';
import { toast } from 'sonner';
import { WORKFLOW_TEMPLATES, type WorkflowTemplateKey } from '@/lib/workflow-templates';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';

const TEMPLATE_ICONS: Record<WorkflowTemplateKey, React.ReactNode> = {
  SCRUM: <RotateCcw className="w-6 h-6" />,
  KANBAN: <Columns3 className="w-6 h-6" />,
  SHAPE_UP: <Calendar className="w-6 h-6" />,
  CUSTOM: <Settings className="w-6 h-6" />,
};

const TEMPLATE_ORDER: WorkflowTemplateKey[] = ['SCRUM', 'KANBAN', 'SHAPE_UP', 'CUSTOM'];

export default function NewTeamForm() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplateKey | null>(null);
  const { handleResult } = useDemoActionHandler();

  const { execute, isExecuting } = useAction(createTeam, {
    onSuccess: ({ data }) => {
      if (!data) return;
      const resolved = isDemoResult(data) ? (handleResult(data) as typeof data) : data;
      if ('team' in resolved && resolved.team) {
        toast.success('Team created!');
        router.push(`/team/${resolved.team.id}`);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to create team');
    },
  });

  const handleSubmit = () => {
    execute({
      name,
      description: description || undefined,
      workflowTemplate: selectedTemplate ?? undefined,
    });
  };

  const canProceedToStep2 = name.trim().length > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link href="/team" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-8">
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
          <p className="text-slate-400">Start collaborating with others</p>
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
          <div>
            <label htmlFor="name" className="input-label">
              Team Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Frontend Team, Startup Squad, Project Alpha"
              className="input"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="description" className="input-label">
              Description <span className="text-slate-500">(optional)</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this team working on?"
              className="input min-h-[100px] resize-none"
              rows={4}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <Link href="/team" className="btn-secondary">
              Cancel
            </Link>
            <button type="button" className="btn-primary" disabled={!canProceedToStep2} onClick={() => setStep(2)}>
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Workflow Selection */}
      {step === 2 && (
        <div className="component-card space-y-6">
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
            <button type="button" className="btn-primary" disabled={isExecuting} onClick={handleSubmit}>
              {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create Team
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
