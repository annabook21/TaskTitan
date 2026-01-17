'use client';

import { useState, useEffect, useRef } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { generateAIComponents, applyAIComponents } from '@/app/projects/actions';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';
import { isDemoMode, demoStore } from '@/lib/demo';
import {
  Sparkles,
  X,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  GitBranch,
  Layers,
  Calendar,
  Zap,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';

interface GeneratedComponent {
  name: string;
  description: string;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  estimatedHours: number;
  priority: number;
  suggestedDependencies: string[];
  parentName?: string;
}

interface GeneratedSprint {
  name: string;
  goal: string;
  durationWeeks: number;
  componentNames: string[];
  capacity?: number;
}

interface GeneratedEpic {
  name: string;
  description: string;
  componentNames: string[];
}

interface Props {
  projectId: string;
  hasDescription: boolean;
  autoOpen?: boolean;
  cycleEnabled?: boolean;
  cycleName?: string;
}

export default function AIGeneratePanel({
  projectId,
  hasDescription,
  autoOpen = false,
  cycleEnabled = true,
  cycleName = 'Sprint',
}: Props) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [generatedComponents, setGeneratedComponents] = useState<GeneratedComponent[]>([]);
  const [generatedSprints, setGeneratedSprints] = useState<GeneratedSprint[]>([]);
  const [generatedEpics, setGeneratedEpics] = useState<GeneratedEpic[]>([]);
  const [summary, setSummary] = useState('');
  const [enhancedDescription, setEnhancedDescription] = useState('');
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set());
  // For Scrum: epics are optional backlog organization (sprints are always generated)
  const [generateEpics, setGenerateEpics] = useState(false);
  const [hasAttemptedAutoGeneration, setHasAttemptedAutoGeneration] = useState(false);
  const { handleResult } = useDemoActionHandler();

  // Terminology
  const cycleNameLower = cycleName.toLowerCase();
  const cycleNamePlural = `${cycleName}s`;

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Helper to detect cross-sprint dependencies
  const getCrossSprintDependencies = (sprint: GeneratedSprint, sprintIndex: number) => {
    const warnings: string[] = [];
    const sprintComponentNames = new Set(sprint.componentNames);

    // Get all components in earlier sprints
    const earlierComponents = new Set<string>();
    for (let i = 0; i < sprintIndex; i++) {
      generatedSprints[i].componentNames.forEach((name) => earlierComponents.add(name));
    }

    // Check if any component in this sprint depends on a component in a later sprint
    for (const compName of sprint.componentNames) {
      const component = generatedComponents.find((c) => c.name === compName);
      if (!component) continue;

      for (const depName of component.suggestedDependencies) {
        // Dependency is in a later sprint (not in this sprint or earlier sprints)
        if (!sprintComponentNames.has(depName) && !earlierComponents.has(depName)) {
          const laterSprint = generatedSprints.findIndex(
            (s, idx) => idx > sprintIndex && s.componentNames.includes(depName),
          );
          if (laterSprint !== -1) {
            warnings.push(`${compName} depends on ${depName} (${cycleName} ${laterSprint + 1})`);
          }
        }
      }
    }

    return warnings;
  };

  const { execute: executeGenerate, isExecuting: isGenerating } = useAction(generateAIComponents, {
    onSuccess: ({ data }) => {
      if (!isMountedRef.current || !data) return;

      // Both demo and production mode now return real AI results directly
      interface GenerateResult {
        components: GeneratedComponent[];
        sprints?: GeneratedSprint[];
        epics?: GeneratedEpic[];
        summary: string;
        enhancedDescription?: string;
      }

      if ('components' in data && data.components) {
        const result = data as unknown as GenerateResult;
        setGeneratedComponents(result.components);
        setGeneratedSprints(result.sprints || []);
        setGeneratedEpics(result.epics || []);
        setSummary(result.summary);
        setEnhancedDescription(result.enhancedDescription || '');
        // Select all by default
        setSelectedComponents(new Set(result.components.map((c) => c.name)));
      }
    },
    onError: ({ error }) => {
      if (!isMountedRef.current) return;
      toast.error(error.serverError || 'Failed to generate components');
    },
  });

  const { execute: executeApply, isExecuting: isApplying } = useAction(applyAIComponents, {
    onSuccess: ({ data }) => {
      if (!isMountedRef.current || !data) return;

      // Handle demo mode by processing locally
      interface ApplyResult {
        created: number;
        dependencies: number;
        sprints: number;
        epics: number;
      }

      let result: ApplyResult | undefined;

      if (isDemoResult(data)) {
        result = handleResult(data) as unknown as ApplyResult;
      } else if ('created' in data) {
        result = data as unknown as ApplyResult;
      }

      if (result) {
        const parts = [`Created ${result.created} work items`];
        if (result.sprints > 0) parts.push(`${result.sprints} ${cycleNameLower}s`);
        if (result.epics > 0) parts.push(`${result.epics} epics`);
        if (result.dependencies > 0) parts.push(`${result.dependencies} dependencies`);
        toast.success(parts.join(', '));
        setIsOpen(false);
        setGeneratedComponents([]);
        setGeneratedSprints([]);
        setGeneratedEpics([]);
        setSelectedComponents(new Set());
      }
    },
    onError: ({ error }) => {
      if (!isMountedRef.current) return;
      toast.error(error.serverError || 'Failed to apply components');
    },
  });

  const handleGenerate = () => {
    setGeneratedComponents([]);
    setGeneratedSprints([]);
    setGeneratedEpics([]);

    // In demo mode, pass project data from localStorage since server can't access it
    if (isDemoMode()) {
      const store = demoStore.getStore();
      const project = store.projects.find((p) => p.id === projectId);
      const workflowConfig = project ? store.workflowConfigs.find((w) => w.teamId === project.teamId) : null;
      const existingComponentNames = store.components.filter((c) => c.projectId === projectId).map((c) => c.name);

      executeGenerate({
        projectId,
        // For Scrum: generateEpics controls optional epic groupings (sprints always generated)
        // For Kanban: this is ignored
        generateEpics,
        demoProjectData: project
          ? {
              name: project.name,
              description: project.description || '',
              existingComponentNames,
              workflowConfig: workflowConfig
                ? {
                    cycleEnabled: workflowConfig.cycleEnabled,
                    cycleDurationWeeks: workflowConfig.cycleDurationWeeks,
                    workflowTemplate: workflowConfig.workflowTemplate as 'SCRUM' | 'KANBAN' | 'CUSTOM' | null,
                    cycleName: workflowConfig.cycleName,
                    backlogName: workflowConfig.backlogName,
                  }
                : null,
            }
          : undefined,
      });
    } else {
      executeGenerate({ projectId, generateEpics });
    }
  };

  const handleApply = () => {
    const toApply = generatedComponents.filter((c) => selectedComponents.has(c.name));
    if (toApply.length === 0) {
      toast.error('Please select at least one work item');
      return;
    }
    executeApply({
      projectId,
      components: toApply,
      enhancedDescription,
      sprints: generatedSprints.length > 0 ? generatedSprints : undefined,
      epics: generatedEpics.length > 0 ? generatedEpics : undefined,
    });
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

  // Auto-trigger generation when opened automatically (only once)
  useEffect(() => {
    if (autoOpen && hasDescription && isOpen && !hasAttemptedAutoGeneration && !isGenerating) {
      setHasAttemptedAutoGeneration(true);
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, hasDescription, isOpen, hasAttemptedAutoGeneration, isGenerating]);

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
              <h2 className="text-lg font-semibold">
                {cycleEnabled ? `AI ${cycleName} Planner` : 'AI Work Item Generator'}
              </h2>
              <p className="text-sm text-slate-400">
                {cycleEnabled
                  ? `Generate ${cycleNameLower}s with work items from your project description`
                  : 'Generate work items from your project description'}
              </p>
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
                    <h3 className="text-xl font-medium text-slate-200 mb-2">
                      {cycleEnabled ? `Ready to generate ${cycleNameLower} plan?` : 'Ready to generate work items?'}
                    </h3>
                    <p className="text-slate-400 max-w-md mx-auto">
                      {cycleEnabled
                        ? `AI will create ${cycleNameLower}s with Stories and Tasks based on your project description. Work items will be organized into time-boxed iterations.`
                        : 'AI will analyze your project and suggest independent work items with estimated hours, priorities, and dependencies.'}
                    </p>
                  </div>

                  {!hasDescription && (
                    <div className="flex items-center gap-2 justify-center text-amber-400 text-sm">
                      <AlertCircle className="w-4 h-4" />
                      Please add a detailed project description first
                    </div>
                  )}

                  <div className="flex flex-col items-center gap-4">
                    {/* For Scrum: Sprints are primary, Epics are optional backlog organization */}
                    {cycleEnabled && (
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={generateEpics}
                          onChange={(e) => setGenerateEpics(e.target.checked)}
                          className="w-4 h-4 rounded border-cyan-500/50 bg-slate-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50"
                        />
                        <span className="text-sm text-slate-300">Also create Epic groupings for backlog organization</span>
                      </label>
                    )}

                    <button onClick={handleGenerate} disabled={isGenerating || !hasDescription} className="btn-primary">
                      <Sparkles className="w-5 h-5" />
                      {cycleEnabled ? `Generate ${cycleName} Plan` : 'Generate Work Items'}
                    </button>
                  </div>
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

              {/* Cycles/Sprints Section */}
              {generatedSprints.length > 0 && (
                <div className="space-y-4">
                  <div className="border-t border-slate-700 pt-6">
                    <h4 className="font-medium text-amber-300 mb-2 flex items-center gap-2">
                      <Zap className="w-5 h-5" />
                      Suggested {cycleName} Plan ({generatedSprints.length} {cycleNameLower}s)
                    </h4>
                    <div className="mb-4 p-3 bg-slate-800/30 border border-slate-700/50 rounded-lg text-xs text-slate-400">
                      <div className="flex items-start gap-2">
                        <TrendingUp className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-400" />
                        <div>
                          <span className="text-slate-300 font-medium">Smart capacity planning:</span> {cycleNamePlural}{' '}
                          include a 20% buffer for meetings, code review, testing, and unexpected issues. Target 70-80%
                          utilization for healthy velocity.
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3">
                      {generatedSprints.map((sprint, index) => {
                        const sprintComponents = sprint.componentNames.filter((name) => selectedComponents.has(name));
                        const sprintHours = generatedComponents
                          .filter((c) => sprint.componentNames.includes(c.name) && selectedComponents.has(c.name))
                          .reduce((sum, c) => sum + c.estimatedHours, 0);

                        const crossSprintDeps = getCrossSprintDependencies(sprint, index);
                        const utilizationPercent = sprint.capacity
                          ? Math.round((sprintHours / sprint.capacity) * 100)
                          : 0;
                        const bufferHours = sprint.capacity ? sprint.capacity - sprintHours : 0;

                        return (
                          <div
                            key={`sprint-${sprint.name}`}
                            className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 rounded-lg"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <h5 className="font-medium text-slate-200 mb-1">
                                  {cycleName} {index + 1}: {sprint.name}
                                </h5>
                                <p className="text-sm text-slate-400 mb-2">{sprint.goal}</p>
                                <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {sprint.durationWeeks} week{sprint.durationWeeks > 1 ? 's' : ''}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Layers className="w-3.5 h-3.5" />
                                    {sprintComponents.length} component{sprintComponents.length !== 1 ? 's' : ''}
                                  </span>
                                  {sprint.capacity && (
                                    <>
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3.5 h-3.5" />
                                        {sprintHours}h work
                                      </span>
                                      <span
                                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
                                          utilizationPercent > 90
                                            ? 'bg-red-500/20 text-red-400'
                                            : utilizationPercent > 75
                                              ? 'bg-amber-500/20 text-amber-400'
                                              : 'bg-green-500/20 text-green-400'
                                        }`}
                                      >
                                        <TrendingUp className="w-3 h-3" />
                                        {utilizationPercent}% capacity
                                      </span>
                                      {bufferHours > 0 && (
                                        <span className="flex items-center gap-1 text-green-400">
                                          +{Math.round(bufferHours)}h buffer
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Cross-Sprint Dependency Warnings */}
                            {crossSprintDeps.length > 0 && (
                              <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs">
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <div className="font-medium text-amber-400 mb-1">Dependency Warning</div>
                                    <ul className="text-amber-300/80 space-y-0.5">
                                      {crossSprintDeps.map((warning, idx) => (
                                        <li key={idx}>• {warning}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              </div>
                            )}

                            {sprintComponents.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {sprintComponents.map((compName) => (
                                  <span
                                    key={compName}
                                    className="text-xs px-2 py-1 bg-slate-800/50 border border-slate-700 rounded text-slate-300"
                                  >
                                    {compName}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center justify-center gap-6 text-sm text-slate-400 py-2">
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  {selectedComponents.size} work items
                </span>
                <span className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {generatedComponents
                    .filter((c) => selectedComponents.has(c.name))
                    .reduce((acc, c) => acc + c.estimatedHours, 0)}{' '}
                  total hours
                </span>
                {generatedSprints.length > 0 && (
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    {generatedSprints.length} {cycleNameLower}s
                  </span>
                )}
                {generatedEpics.length > 0 && (
                  <span className="flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    {generatedEpics.length} epics
                  </span>
                )}
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
                Apply {selectedComponents.size} Work Items
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
