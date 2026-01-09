'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { generateAIComponents, applyAIComponents } from '@/app/projects/actions';
import { Sparkles, X, Loader2, Check, AlertCircle, Clock, GitBranch, Layers } from 'lucide-react';
import { toast } from 'sonner';

interface GeneratedComponent {
  name: string;
  description: string;
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
}

interface Props {
  projectId: string;
  hasDescription: boolean;
}

export default function AIGeneratePanel({ projectId, hasDescription }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [generatedComponents, setGeneratedComponents] = useState<GeneratedComponent[]>([]);
  const [summary, setSummary] = useState('');
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set());

  const { execute: executeGenerate, isExecuting: isGenerating } = useAction(generateAIComponents, {
    onSuccess: ({ data }) => {
      if (data) {
        setGeneratedComponents(data.components);
        setSummary(data.summary);
        // Select all by default
        setSelectedComponents(new Set(data.components.map((c) => c.name)));
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to generate components');
    },
  });

  const { execute: executeApply, isExecuting: isApplying } = useAction(applyAIComponents, {
    onSuccess: ({ data }) => {
      if (data) {
        toast.success(`Created ${data.created} components with ${data.dependencies} dependencies`);
        setIsOpen(false);
        setGeneratedComponents([]);
        setSelectedComponents(new Set());
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to apply components');
    },
  });

  const handleGenerate = () => {
    setGeneratedComponents([]);
    executeGenerate({ projectId });
  };

  const handleApply = () => {
    const toApply = generatedComponents.filter((c) => selectedComponents.has(c.name));
    if (toApply.length === 0) {
      toast.error('Please select at least one component');
      return;
    }
    executeApply({ projectId, components: toApply });
  };

  const toggleComponent = (name: string) => {
    const newSelected = new Set(selectedComponents);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedComponents(newSelected);
  };

  const selectAll = () => {
    setSelectedComponents(new Set(generatedComponents.map((c) => c.name)));
  };

  const selectNone = () => {
    setSelectedComponents(new Set());
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="btn-secondary text-sm"
        disabled={!hasDescription}
        title={!hasDescription ? 'Add a project description first' : 'Generate components with AI'}
      >
        <Sparkles className="w-4 h-4" />
        AI Generate
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-fade-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">AI Component Generator</h2>
              <p className="text-sm text-slate-400">Generate component suggestions from your project description</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-200 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {generatedComponents.length === 0 ? (
            <div className="text-center py-12">
              {isGenerating ? (
                <div className="space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-cyan-400 mx-auto" />
                  <p className="text-slate-300">Analyzing your project and generating components...</p>
                  <p className="text-sm text-slate-500">This may take 10-20 seconds</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center mx-auto">
                    <Sparkles className="w-8 h-8 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-medium text-slate-200 mb-2">Ready to generate components?</h3>
                    <p className="text-slate-400 max-w-md mx-auto">
                      AI will analyze your project description and suggest logical components with estimated hours,
                      priorities, and dependencies.
                    </p>
                  </div>

                  {!hasDescription && (
                    <div className="flex items-center gap-2 justify-center text-amber-400 text-sm">
                      <AlertCircle className="w-4 h-4" />
                      Please add a detailed project description first
                    </div>
                  )}

                  <button onClick={handleGenerate} disabled={isGenerating || !hasDescription} className="btn-primary">
                    <Sparkles className="w-5 h-5" />
                    Generate Components
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary */}
              {summary && (
                <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                  <h4 className="font-medium text-cyan-300 mb-2">Architecture Summary</h4>
                  <p className="text-sm text-slate-300">{summary}</p>
                </div>
              )}

              {/* Selection Controls */}
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-400">
                  {selectedComponents.size} of {generatedComponents.length} selected
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={selectAll} className="text-sm text-cyan-400 hover:text-cyan-300">
                    Select All
                  </button>
                  <span className="text-slate-600">|</span>
                  <button onClick={selectNone} className="text-sm text-slate-400 hover:text-slate-300">
                    Select None
                  </button>
                </div>
              </div>

              {/* Components Grid */}
              <div className="grid md:grid-cols-2 gap-4">
                {generatedComponents.map((component) => {
                  const isSelected = selectedComponents.has(component.name);
                  return (
                    <div
                      key={component.name}
                      onClick={() => toggleComponent(component.name)}
                      className={`relative p-4 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-cyan-500/10 border-cyan-500/40'
                          : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      {/* Checkbox */}
                      <div
                        className={`absolute top-3 right-3 w-5 h-5 rounded border flex items-center justify-center ${
                          isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-slate-600'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>

                      <h4 className="font-medium text-slate-200 mb-2 pr-8">{component.name}</h4>
                      <p className="text-sm text-slate-400 line-clamp-2 mb-3">{component.description}</p>

                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {component.estimatedHours}h
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                          P{component.priority}
                        </span>
                        {component.suggestedDependencies.length > 0 && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3.5 h-3.5" />
                            {component.suggestedDependencies.length} deps
                          </span>
                        )}
                      </div>

                      {component.suggestedDependencies.length > 0 && (
                        <div className="mt-2 text-xs text-slate-500">
                          Depends on: {component.suggestedDependencies.join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Stats */}
              <div className="flex items-center justify-center gap-6 text-sm text-slate-400 py-2">
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  {selectedComponents.size} components
                </span>
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {generatedComponents
                    .filter((c) => selectedComponents.has(c.name))
                    .reduce((acc, c) => acc + c.estimatedHours, 0)}{' '}
                  total hours
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {generatedComponents.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-800 flex-shrink-0">
            <button onClick={handleGenerate} disabled={isGenerating} className="btn-ghost">
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Regenerate
            </button>
            <div className="flex items-center gap-3">
              <button onClick={() => setIsOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={isApplying || selectedComponents.size === 0}
                className="btn-primary"
              >
                {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Apply {selectedComponents.size} Components
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
