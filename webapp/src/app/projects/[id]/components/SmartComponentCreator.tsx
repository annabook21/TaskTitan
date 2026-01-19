'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import {
  generateSmartComponent,
  refineSmartComponent,
  createFromPreview,
  createComponent,
} from '@/app/projects/actions';
import {
  Plus,
  X,
  Loader2,
  Sparkles,
  ArrowLeft,
  Check,
  RotateCcw,
  MessageSquare,
  Pencil,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import type { NaturalLanguageComponentResult } from '@/lib/ai';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';
import { isDemoMode, demoStore } from '@/lib/demo';

interface Props {
  projectId: string;
}

type Step = 'input' | 'preview' | 'refine' | 'manual';
type ComponentType = 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';

const TYPE_OPTIONS: { value: ComponentType; label: string }[] = [
  { value: 'EPIC', label: 'Epic' },
  { value: 'FEATURE', label: 'Feature' },
  { value: 'STORY', label: 'Story' },
  { value: 'TASK', label: 'Task' },
  { value: 'BUG', label: 'Bug' },
];

export default function SmartComponentCreator({ projectId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const { handleResult } = useDemoActionHandler();

  // Input state
  const [userInput, setUserInput] = useState('');

  // Preview/Generated component state
  const [generatedComponent, setGeneratedComponent] = useState<NaturalLanguageComponentResult | null>(null);
  const [suggestedFollowUps, setSuggestedFollowUps] = useState<string[]>([]);
  const [aiExplanation, setAiExplanation] = useState<string>('');

  // Refinement state
  const [refinementInput, setRefinementInput] = useState('');

  // Manual form state
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualEstimate, setManualEstimate] = useState('');
  const [manualPriority, setManualPriority] = useState('0');

  // Inline edit state
  const [editingField, setEditingField] = useState<string | null>(null);

  // Actions
  const generateAction = useAction(generateSmartComponent, {
    onSuccess: ({ data }) => {
      if (data?.component) {
        setGeneratedComponent(data.component);
        setSuggestedFollowUps(data.suggestedFollowUps || []);
        setAiExplanation(data.component.reasoning);
        setStep('preview');
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to generate component');
    },
  });

  const refineAction = useAction(refineSmartComponent, {
    onSuccess: ({ data }) => {
      if (data?.component) {
        setGeneratedComponent(data.component);
        setSuggestedFollowUps(data.suggestedFollowUps || []);
        setAiExplanation(data.explanation || '');
        setRefinementInput('');
        setStep('preview');
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to refine component');
    },
  });

  const createFromPreviewAction = useAction(createFromPreview, {
    onSuccess: ({ data }) => {
      // Handle demo mode by processing locally
      if (isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('Component created!');
      handleClose();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to create component');
    },
  });

  const createManualAction = useAction(createComponent, {
    onSuccess: ({ data }) => {
      // Handle demo mode by processing locally
      if (isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('Component created!');
      handleClose();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to create component');
    },
  });

  const handleClose = () => {
    setIsOpen(false);
    setStep('input');
    setUserInput('');
    setGeneratedComponent(null);
    setSuggestedFollowUps([]);
    setAiExplanation('');
    setRefinementInput('');
    setManualName('');
    setManualDescription('');
    setManualEstimate('');
    setManualPriority('0');
    setEditingField(null);
  };

  const handleGenerate = () => {
    if (userInput.trim().length < 3) {
      toast.error('Please provide more detail');
      return;
    }

    // In demo mode, pass project data from localStorage since server can't access it
    if (isDemoMode()) {
      const store = demoStore.getStore();
      const project = store.projects.find((p) => p.id === projectId);
      const existingComponents = store.components
        .filter((c) => c.projectId === projectId)
        .map((c) => ({ name: c.name, type: c.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG' }));

      generateAction.execute({
        projectId,
        userInput: userInput.trim(),
        demoProjectData: project
          ? {
              name: project.name,
              description: project.description || '',
              existingComponents,
            }
          : undefined,
      });
    } else {
      generateAction.execute({ projectId, userInput: userInput.trim() });
    }
  };

  const handleRefine = (request: string) => {
    if (!generatedComponent || !request.trim()) return;

    // In demo mode, pass project data from localStorage since server can't access it
    if (isDemoMode()) {
      const store = demoStore.getStore();
      const project = store.projects.find((p) => p.id === projectId);
      const existingComponents = store.components
        .filter((c) => c.projectId === projectId)
        .map((c) => ({ name: c.name, type: c.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG' }));

      refineAction.execute({
        projectId,
        currentComponent: generatedComponent,
        refinementRequest: request.trim(),
        demoProjectData: project
          ? {
              name: project.name,
              description: project.description || '',
              existingComponents,
            }
          : undefined,
      });
    } else {
      refineAction.execute({
        projectId,
        currentComponent: generatedComponent,
        refinementRequest: request.trim(),
      });
    }
  };

  const handleCreateFromPreview = () => {
    if (!generatedComponent) return;
    createFromPreviewAction.execute({
      projectId,
      component: generatedComponent,
    });
  };

  const handleCreateManual = () => {
    if (!manualName.trim()) {
      toast.error('Name is required');
      return;
    }
    createManualAction.execute({
      projectId,
      name: manualName.trim(),
      description: manualDescription || undefined,
      estimatedHours: manualEstimate ? parseFloat(manualEstimate) : undefined,
      priority: parseInt(manualPriority),
    });
  };

  const updateGeneratedField = (field: keyof NaturalLanguageComponentResult, value: string | number) => {
    if (!generatedComponent) return;
    setGeneratedComponent({
      ...generatedComponent,
      [field]: value,
    });
    setEditingField(null);
  };

  const isLoading =
    generateAction.isExecuting ||
    refineAction.isExecuting ||
    createFromPreviewAction.isExecuting ||
    createManualAction.isExecuting;

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="btn-primary">
        <Plus className="w-5 h-5" />
        Add Component
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-fade-in max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            {step !== 'input' && step !== 'manual' && (
              <button
                onClick={() => setStep(step === 'refine' ? 'preview' : 'input')}
                className="p-1 text-slate-400 hover:text-slate-200 rounded"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold">
              {step === 'input' && 'Add New Component'}
              {step === 'preview' && 'Review Component'}
              {step === 'refine' && 'Refine Component'}
              {step === 'manual' && 'Manual Entry'}
            </h2>
          </div>
          <button onClick={handleClose} className="p-1 text-slate-400 hover:text-slate-200 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {/* Step 1: Natural Language Input */}
          {step === 'input' && (
            <div className="space-y-4">
              <div>
                <label className="input-label flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  Describe what you want to create
                </label>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="e.g., Create a user profile page with avatar upload and settings, high priority"
                  className="input min-h-[100px] resize-none"
                  rows={4}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) {
                      handleGenerate();
                    }
                  }}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Press Cmd+Enter to generate, or describe type, priority, and estimates naturally
                </p>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setStep('manual')}
                  className="text-sm text-slate-400 hover:text-slate-200"
                >
                  Switch to manual form
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="btn-primary"
                  disabled={isLoading || userInput.trim().length < 3}
                >
                  {generateAction.isExecuting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Generate with AI
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Editable Preview */}
          {step === 'preview' && generatedComponent && (
            <div className="space-y-4">
              {/* Preview Card */}
              <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4 space-y-4">
                {/* Name */}
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide">Name</label>
                  {editingField === 'name' ? (
                    <input
                      type="text"
                      value={generatedComponent.name}
                      onChange={(e) => setGeneratedComponent({ ...generatedComponent, name: e.target.value })}
                      onBlur={() => setEditingField(null)}
                      onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                      className="input mt-1"
                      autoFocus
                    />
                  ) : (
                    <div
                      onClick={() => setEditingField('name')}
                      className="flex items-center gap-2 mt-1 cursor-pointer group"
                    >
                      <span className="text-lg font-medium">{generatedComponent.name}</span>
                      <Pencil className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100" />
                    </div>
                  )}
                </div>

                {/* Type + Priority + Estimate row */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Type</label>
                    <div className="relative mt-1">
                      <select
                        value={generatedComponent.type}
                        onChange={(e) => updateGeneratedField('type', e.target.value)}
                        className="input appearance-none pr-8 cursor-pointer"
                      >
                        {TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Estimate</label>
                    {editingField === 'estimatedHours' ? (
                      <input
                        type="number"
                        value={generatedComponent.estimatedHours}
                        onChange={(e) =>
                          setGeneratedComponent({
                            ...generatedComponent,
                            estimatedHours: parseFloat(e.target.value) || 0,
                          })
                        }
                        onBlur={() => setEditingField(null)}
                        onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                        className="input mt-1"
                        min="1"
                        max="200"
                        autoFocus
                      />
                    ) : (
                      <div
                        onClick={() => setEditingField('estimatedHours')}
                        className="flex items-center gap-1 mt-1 cursor-pointer group"
                      >
                        <span className="text-lg font-medium">{generatedComponent.estimatedHours}</span>
                        <span className="text-slate-400">hrs</span>
                        <Pencil className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 ml-1" />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Priority</label>
                    {editingField === 'priority' ? (
                      <input
                        type="number"
                        value={generatedComponent.priority}
                        onChange={(e) =>
                          setGeneratedComponent({
                            ...generatedComponent,
                            priority: parseInt(e.target.value) || 0,
                          })
                        }
                        onBlur={() => setEditingField(null)}
                        onKeyDown={(e) => e.key === 'Enter' && setEditingField(null)}
                        className="input mt-1"
                        min="1"
                        max="10"
                        autoFocus
                      />
                    ) : (
                      <div
                        onClick={() => setEditingField('priority')}
                        className="flex items-center gap-1 mt-1 cursor-pointer group"
                      >
                        <span className="text-lg font-medium">{generatedComponent.priority}</span>
                        <span className="text-slate-400">/10</span>
                        <Pencil className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 ml-1" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide">Description</label>
                  {editingField === 'description' ? (
                    <textarea
                      value={generatedComponent.description}
                      onChange={(e) => setGeneratedComponent({ ...generatedComponent, description: e.target.value })}
                      onBlur={() => setEditingField(null)}
                      className="input mt-1 min-h-[80px] resize-none"
                      rows={3}
                      autoFocus
                    />
                  ) : (
                    <div onClick={() => setEditingField('description')} className="mt-1 cursor-pointer group">
                      <p className="text-slate-300 text-sm">{generatedComponent.description}</p>
                      <span className="text-xs text-slate-500 opacity-0 group-hover:opacity-100 flex items-center gap-1 mt-1">
                        <Pencil className="w-3 h-3" /> Click to edit
                      </span>
                    </div>
                  )}
                </div>

                {/* Dependencies */}
                {generatedComponent.suggestedDependencies.length > 0 && (
                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wide">Dependencies</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {generatedComponent.suggestedDependencies.map((dep) => (
                        <span key={dep} className="px-2 py-0.5 bg-slate-700 rounded text-xs">
                          {dep}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* AI Explanation */}
              {aiExplanation && (
                <div className="flex items-start gap-2 p-3 bg-violet-500/10 border border-violet-500/20 rounded-lg">
                  <Sparkles className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-violet-200">{aiExplanation}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between items-center pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setStep('input');
                    setGeneratedComponent(null);
                  }}
                  className="btn-secondary"
                >
                  <RotateCcw className="w-4 h-4" />
                  Start Over
                </button>

                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep('refine')} className="btn-secondary">
                    <MessageSquare className="w-4 h-4" />
                    Refine
                  </button>
                  <button type="button" onClick={handleCreateFromPreview} className="btn-primary" disabled={isLoading}>
                    {createFromPreviewAction.isExecuting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Create Component
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Refinement Chat */}
          {step === 'refine' && generatedComponent && (
            <div className="space-y-4">
              {/* Quick suggestions */}
              {suggestedFollowUps.length > 0 && (
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">Suggestions</label>
                  <div className="flex flex-wrap gap-2">
                    {suggestedFollowUps.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleRefine(suggestion)}
                        disabled={isLoading}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-sm transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom refinement input */}
              <div>
                <label className="input-label">Or describe your changes</label>
                <textarea
                  value={refinementInput}
                  onChange={(e) => setRefinementInput(e.target.value)}
                  placeholder="e.g., Make it lower priority, add authentication requirement, break into smaller tasks..."
                  className="input min-h-[80px] resize-none"
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) {
                      handleRefine(refinementInput);
                    }
                  }}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center pt-4 border-t border-slate-800">
                <button type="button" onClick={() => setStep('preview')} className="btn-secondary">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Preview
                </button>
                <button
                  type="button"
                  onClick={() => handleRefine(refinementInput)}
                  className="btn-primary"
                  disabled={isLoading || !refinementInput.trim()}
                >
                  {refineAction.isExecuting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Apply Refinement
                </button>
              </div>
            </div>
          )}

          {/* Manual Form Fallback */}
          {step === 'manual' && (
            <div className="space-y-4">
              <div>
                <label htmlFor="manual-name" className="input-label">
                  Component Name
                </label>
                <input
                  id="manual-name"
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="e.g., User Authentication, Shopping Cart"
                  className="input"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="manual-description" className="input-label">
                  Description <span className="text-slate-500">(optional)</span>
                </label>
                <textarea
                  id="manual-description"
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  placeholder="What does this component do?"
                  className="input min-h-[80px] resize-none"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="manual-estimate" className="input-label">
                    Estimated Hours
                  </label>
                  <input
                    id="manual-estimate"
                    type="number"
                    value={manualEstimate}
                    onChange={(e) => setManualEstimate(e.target.value)}
                    placeholder="0"
                    className="input"
                    min="0"
                    step="0.5"
                  />
                </div>

                <div>
                  <label htmlFor="manual-priority" className="input-label">
                    Priority (0-100)
                  </label>
                  <input
                    id="manual-priority"
                    type="number"
                    value={manualPriority}
                    onChange={(e) => setManualPriority(e.target.value)}
                    placeholder="0"
                    className="input"
                    min="0"
                    max="100"
                  />
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="text-sm text-slate-400 hover:text-slate-200"
                >
                  <ArrowLeft className="w-4 h-4 inline mr-1" />
                  Back to AI mode
                </button>
                <button
                  type="button"
                  onClick={handleCreateManual}
                  className="btn-primary"
                  disabled={isLoading || !manualName.trim()}
                >
                  {createManualAction.isExecuting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Create Component
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
