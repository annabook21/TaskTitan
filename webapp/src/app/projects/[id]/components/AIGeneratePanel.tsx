'use client';

import { useState, useEffect, useRef } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { generateAIComponents, applyAIComponents, refineBulkAIPlan } from '@/app/projects/actions';
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
  MessageSquare,
  ArrowLeft,
  RotateCcw,
  History,
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
  const [step, setStep] = useState<'generate' | 'preview' | 'chat' | 'confirm'>('generate');
  const [generatedComponents, setGeneratedComponents] = useState<GeneratedComponent[]>([]);
  const [generatedSprints, setGeneratedSprints] = useState<GeneratedSprint[]>([]);
  const [generatedEpics, setGeneratedEpics] = useState<GeneratedEpic[]>([]);
  const [summary, setSummary] = useState('');
  const [enhancedDescription, setEnhancedDescription] = useState('');
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set());
  // For Scrum: epics are optional backlog organization (sprints are always generated)
  const [generateEpics, setGenerateEpics] = useState(false);
  const [hasAttemptedAutoGeneration, setHasAttemptedAutoGeneration] = useState(false);

  // Chat refinement state
  const [chatInput, setChatInput] = useState('');
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [refinementExplanation, setRefinementExplanation] = useState('');
  const [changedItems, setChangedItems] = useState<Array<{ type: string; name: string; change: string }>>([]);

  // History/undo state
  const [history, setHistory] = useState<
    Array<{
      components: GeneratedComponent[];
      sprints: GeneratedSprint[];
      epics: GeneratedEpic[];
      summary: string;
    }>
  >([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Progress state
  const [generationProgress, setGenerationProgress] = useState<string>('');

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

  const handleActionError = (error: { serverError?: string }) => {
    const message = error.serverError || 'An unexpected error occurred';
    // Next.js Server Actions can 403 on stale client bundles after deploys.
    if (message.includes('Invalid Server Actions request') || message.includes('Failed to find Server Action')) {
      toast.error('App updated. Refreshing to load latest version...');
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 1200);
      return;
    }
    toast.error(message);
  };

  // Helper to generate chat suggestions based on current plan
  const generateChatSuggestions = (components: GeneratedComponent[], sprints: GeneratedSprint[]) => {
    const suggestions: string[] = [];

    if (sprints.length > 1) {
      suggestions.push('Move items between sprints');
    }

    if (sprints.length > 0) {
      const firstSprintHours = components
        .filter((c) => sprints[0].componentNames.includes(c.name))
        .reduce((sum, c) => sum + c.estimatedHours, 0);
      if (sprints[0].capacity && firstSprintHours > sprints[0].capacity * 0.85) {
        suggestions.push('Reduce Sprint 1 scope');
      }
    }

    const largeComponents = components.filter((c) => c.estimatedHours > 20);
    if (largeComponents.length > 0) {
      suggestions.push(`Break down ${largeComponents[0].name} into smaller tasks`);
    }

    if (suggestions.length < 3) {
      suggestions.push('Adjust component priorities');
    }

    return suggestions.slice(0, 3);
  };

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

        // Save to history
        const newHistoryEntry = {
          components: result.components,
          sprints: result.sprints || [],
          epics: result.epics || [],
          summary: result.summary,
        };
        setHistory([newHistoryEntry]);
        setHistoryIndex(0);

        setGeneratedComponents(result.components);
        setGeneratedSprints(result.sprints || []);
        setGeneratedEpics(result.epics || []);
        setSummary(result.summary);
        setEnhancedDescription(result.enhancedDescription || '');
        // Select all by default
        setSelectedComponents(new Set(result.components.map((c) => c.name)));
        setStep('preview');
        setGenerationProgress('');

        // Generate initial chat suggestions
        const suggestions = generateChatSuggestions(result.components, result.sprints || []);
        setChatSuggestions(suggestions);
      }
    },
    onError: ({ error }) => {
      if (!isMountedRef.current) return;
      setGenerationProgress('');
      handleActionError(error);
    },
  });

  const { execute: executeRefine, isExecuting: isRefining } = useAction(refineBulkAIPlan, {
    onSuccess: ({ data }) => {
      if (!isMountedRef.current || !data) return;

      if ('components' in data) {
        // Save current state to history before updating
        const newHistoryEntry = {
          components: data.components,
          sprints: data.sprints || generatedSprints,
          epics: data.epics || generatedEpics,
          summary,
        };
        const newHistory = [...history.slice(0, historyIndex + 1), newHistoryEntry];
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);

        setGeneratedComponents(data.components);
        if (data.sprints) setGeneratedSprints(data.sprints);
        if (data.epics) setGeneratedEpics(data.epics);
        setRefinementExplanation(data.explanation || '');
        setChangedItems(data.changedItems || []);
        setChatSuggestions(data.suggestedFollowUps || []);
        setSelectedComponents(new Set(data.components.map((c) => c.name)));
        setChatInput('');
        setStep('preview');
      }
    },
    onError: ({ error }) => {
      if (!isMountedRef.current) return;
      handleActionError(error);
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
      handleActionError(error);
    },
  });

  const handleGenerate = () => {
    setGeneratedComponents([]);
    setGeneratedSprints([]);
    setGeneratedEpics([]);
    setStep('generate');
    setGenerationProgress('Analyzing project description...');

    // Simulate progress steps
    setTimeout(() => setGenerationProgress('Identifying key features...'), 5000);
    setTimeout(() => setGenerationProgress('Creating work breakdown...'), 15000);
    setTimeout(() => setGenerationProgress('Organizing into sprints...'), 25000);

    // In demo mode, pass project data from localStorage since server can't access it
    if (isDemoMode()) {
      const store = demoStore.getStore();
      const project = store.projects.find((p) => p.id === projectId);
      const workflowConfig = project ? store.workflowConfigs.find((w) => w.teamId === project.teamId) : null;
      const existingComponentNames = store.components.filter((c) => c.projectId === projectId).map((c) => c.name);

      // Calculate team capacity for Scrum workflows
      let teamCapacity:
        | {
            memberCount: number;
            members: Array<{ name: string; title?: string; hoursPerDay: number; availability: number }>;
            sprintDays: number;
            totalCapacityHours: number;
          }
        | undefined;

      if (project && workflowConfig?.cycleEnabled) {
        const sprintDays = (workflowConfig.cycleDurationWeeks ?? 2) * 5;
        const members = demoStore.getTeamMembersForAI(project.teamId);
        const totalCapacityHours = demoStore.getTeamSprintCapacity(project.teamId, sprintDays);

        teamCapacity = {
          memberCount: members.length,
          members,
          sprintDays,
          totalCapacityHours,
        };
      }

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
              teamCapacity,
            }
          : undefined,
      });
    } else {
      executeGenerate({ projectId, generateEpics });
    }
  };

  const handleShowConfirmation = () => {
    const toApply = generatedComponents.filter((c) => selectedComponents.has(c.name));
    if (toApply.length === 0) {
      toast.error('Please select at least one work item');
      return;
    }
    setStep('confirm');
  };

  const handleApply = () => {
    const toApply = generatedComponents.filter((c) => selectedComponents.has(c.name));
    executeApply({
      projectId,
      components: toApply,
      enhancedDescription,
      sprints: generatedSprints.length > 0 ? generatedSprints : undefined,
      epics: generatedEpics.length > 0 ? generatedEpics : undefined,
    });
  };

  const handleRefinePlan = (request?: string) => {
    const refinementText = request || chatInput.trim();
    if (!refinementText) {
      toast.error('Please enter a refinement request');
      return;
    }

    const workflowType = cycleEnabled ? 'SCRUM' : 'KANBAN';

    if (isDemoMode()) {
      const store = demoStore.getStore();
      const project = store.projects.find((p) => p.id === projectId);

      executeRefine({
        projectId,
        currentPlan: {
          components: generatedComponents,
          sprints: generatedSprints.length > 0 ? generatedSprints : undefined,
          epics: generatedEpics.length > 0 ? generatedEpics : undefined,
        },
        refinementRequest: refinementText,
        demoProjectData: project
          ? {
              name: project.name,
              description: project.description || '',
              workflowType,
              cycleName,
            }
          : undefined,
      });
    } else {
      executeRefine({
        projectId,
        currentPlan: {
          components: generatedComponents,
          sprints: generatedSprints.length > 0 ? generatedSprints : undefined,
          epics: generatedEpics.length > 0 ? generatedEpics : undefined,
        },
        refinementRequest: refinementText,
      });
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const prevState = history[prevIndex];
      setHistoryIndex(prevIndex);
      setGeneratedComponents(prevState.components);
      setGeneratedSprints(prevState.sprints);
      setGeneratedEpics(prevState.epics);
      setSummary(prevState.summary);
      setSelectedComponents(new Set(prevState.components.map((c) => c.name)));
      toast.success('Reverted to previous version');
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const nextState = history[nextIndex];
      setHistoryIndex(nextIndex);
      setGeneratedComponents(nextState.components);
      setGeneratedSprints(nextState.sprints);
      setGeneratedEpics(nextState.epics);
      setSummary(nextState.summary);
      setSelectedComponents(new Set(nextState.components.map((c) => c.name)));
      toast.success('Restored next version');
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-fade-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            {step === 'chat' && (
              <button
                onClick={() => setStep('preview')}
                className="p-1 text-slate-400 hover:text-slate-200 rounded flex-shrink-0"
                title="Back to preview"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold truncate">
                {step === 'generate' && (cycleEnabled ? `AI ${cycleName} Planner` : 'AI Work Item Generator')}
                {step === 'preview' && 'Review Generated Plan'}
                {step === 'chat' && 'Refine Plan'}
                {step === 'confirm' && 'Confirm Changes'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 truncate">
                {step === 'generate' &&
                  (cycleEnabled
                    ? `Generate ${cycleNameLower}s with work items`
                    : 'Generate work items from description')}
                {step === 'preview' && 'Select items and customize before applying'}
                {step === 'chat' && 'Use AI to adjust the plan'}
                {step === 'confirm' && 'Review before creating items'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {(step === 'preview' || step === 'chat') && generatedComponents.length > 0 && (
              <>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="p-2 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors"
                  title="Regenerate from scratch"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                {history.length > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleUndo}
                      disabled={historyIndex <= 0}
                      className="p-2 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors disabled:opacity-30"
                      title="Undo"
                    >
                      <History className="w-4 h-4 rotate-180" />
                    </button>
                    <button
                      onClick={handleRedo}
                      disabled={historyIndex >= history.length - 1}
                      className="p-2 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors disabled:opacity-30"
                      title="Redo"
                    >
                      <History className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
            <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-200 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-3 sm:p-4">
          {step === 'generate' && generatedComponents.length === 0 ? (
            <div className="text-center py-8 sm:py-12">
              {isGenerating ? (
                <div className="space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-cyan-400 mx-auto" />
                  <p className="text-slate-300">
                    {generationProgress || 'Analyzing your project and generating components...'}
                  </p>
                  <div className="max-w-xs mx-auto">
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 animate-pulse"
                        style={{ width: '60%' }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-slate-500">This may take 30-90 seconds</p>
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
                        <span className="text-sm text-slate-300">
                          Also create Epic groupings for backlog organization
                        </span>
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
          ) : step === 'preview' ? (
            <div className="space-y-4 sm:space-y-6">
              {/* Refinement Explanation (if just refined) */}
              {refinementExplanation && (
                <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-medium text-violet-300 mb-1 text-sm">AI Applied Changes</h4>
                      <p className="text-xs sm:text-sm text-violet-200">{refinementExplanation}</p>
                      {changedItems.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-violet-300/80">
                          {changedItems.map((item, idx) => (
                            <li key={idx}>
                              • {item.name}: {item.change}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Summary */}
              {summary && (
                <div className="p-3 sm:p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                  <h4 className="font-medium text-cyan-300 mb-2 text-sm">Architecture Summary</h4>
                  <p className="text-xs sm:text-sm text-slate-300">{summary}</p>
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
          ) : step === 'chat' ? (
            <div className="space-y-4">
              {/* Current Plan Summary */}
              <div className="p-3 bg-slate-800/50 rounded-lg text-sm">
                <p className="text-slate-300">
                  Current plan: <span className="font-medium text-cyan-400">{selectedComponents.size} components</span>
                  {generatedSprints.length > 0 && (
                    <span>
                      {' '}
                      across{' '}
                      <span className="font-medium text-amber-400">
                        {generatedSprints.length} {cycleNameLower}s
                      </span>
                    </span>
                  )}
                </p>
              </div>

              {/* Suggested Prompts */}
              {chatSuggestions.length > 0 && (
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">Quick Actions</label>
                  <div className="flex flex-wrap gap-2">
                    {chatSuggestions.map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => handleRefinePlan(suggestion)}
                        disabled={isRefining}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-xs sm:text-sm transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Refinement Input */}
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">Describe your changes</label>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="e.g., 'Move authentication stories to Sprint 1' or 'Reduce Sprint 2 scope by 30%' or 'Split User Profile into 3 tasks'"
                  className="input min-h-[100px] resize-none text-sm"
                  rows={4}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) {
                      handleRefinePlan();
                    }
                  }}
                />
                <p className="text-xs text-slate-500 mt-1">Press Cmd+Enter to apply changes</p>
              </div>

              {/* Info Box */}
              <div className="p-3 bg-slate-800/30 border border-slate-700/50 rounded-lg text-xs text-slate-400">
                <p className="mb-2 text-slate-300 font-medium">Examples:</p>
                <ul className="space-y-1">
                  <li>• Move [component name] to Sprint 2</li>
                  <li>• Break down [component name] into tasks</li>
                  <li>• Reduce total scope by 20%</li>
                  <li>• Increase priority of security items</li>
                  <li>• Balance sprint capacity evenly</li>
                </ul>
              </div>
            </div>
          ) : step === 'confirm' ? (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-8 h-8 text-amber-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-200 mb-2">Confirm Plan</h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto">
                  This will create the following items in your project. This action cannot be undone.
                </p>
              </div>

              {/* Summary of what will be created */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Work Items</span>
                  <span className="font-medium text-cyan-400">{selectedComponents.size} components</span>
                </div>
                {generatedSprints.length > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">{cycleNamePlural}</span>
                    <span className="font-medium text-amber-400">
                      {generatedSprints.length} {cycleNameLower}s
                    </span>
                  </div>
                )}
                {generatedEpics.length > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Epic Groupings</span>
                    <span className="font-medium text-violet-400">{generatedEpics.length} epics</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-700">
                  <span className="text-slate-400">Total Estimated Hours</span>
                  <span className="font-medium text-slate-200">
                    {generatedComponents
                      .filter((c) => selectedComponents.has(c.name))
                      .reduce((acc, c) => acc + c.estimatedHours, 0)}
                    h
                  </span>
                </div>
              </div>

              {enhancedDescription && (
                <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3 text-xs">
                  <p className="text-slate-400 mb-1">Project description will also be updated with AI enhancements.</p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {step === 'preview' && generatedComponents.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 p-3 sm:p-4 border-t border-slate-800 flex-shrink-0">
            <button onClick={() => setIsOpen(false)} className="btn-secondary order-2 sm:order-1">
              Cancel
            </button>
            <div className="flex items-center gap-2 sm:gap-3 order-1 sm:order-2">
              <button onClick={() => setStep('chat')} className="btn-secondary flex-1 sm:flex-initial">
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Refine</span>
              </button>
              <button
                onClick={handleShowConfirmation}
                disabled={selectedComponents.size === 0}
                className="btn-primary flex-1 sm:flex-initial"
              >
                <Check className="w-4 h-4" />
                Apply {selectedComponents.size} Items
              </button>
            </div>
          </div>
        )}

        {step === 'chat' && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 p-3 sm:p-4 border-t border-slate-800 flex-shrink-0">
            <button onClick={() => setStep('preview')} className="btn-secondary">
              <ArrowLeft className="w-4 h-4" />
              Back to Preview
            </button>
            <button
              onClick={() => handleRefinePlan()}
              disabled={isRefining || !chatInput.trim()}
              className="btn-primary"
            >
              {isRefining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Apply Changes
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-3 p-3 sm:p-4 border-t border-slate-800 flex-shrink-0">
            <button onClick={() => setStep('preview')} className="btn-secondary order-2 sm:order-1">
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button onClick={handleApply} disabled={isApplying} className="btn-primary order-1 sm:order-2">
              {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Confirm & Create
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
