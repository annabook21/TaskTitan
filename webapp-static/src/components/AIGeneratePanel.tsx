import { useState, useRef, useCallback, useEffect } from 'react';
import {
  applyFullPlan,
  refineBulkPlan,
  startAIGeneration,
  subscribeToAIProgress,
  type Component,
  type GeneratedComponent,
  type GeneratedSprint,
  type GeneratedEpic,
  type FullPlanResult,
  type ChangedItem,
  type AIProgress,
} from '../api/appsync';

interface AIGeneratePanelProps {
  projectId: string;
  projectName: string;
  projectDescription?: string | null;
  existingComponents: Component[];
  onComponentsCreated: (components: Component[]) => void;
  onClose: () => void;
}

// AWS Best Practice: Rate limiting to prevent abuse
const RATE_LIMIT_MS = 3000;

// Snapshot type for undo/redo history
interface PlanSnapshot {
  components: GeneratedComponent[];
  sprints?: GeneratedSprint[] | null;
  epics?: GeneratedEpic[] | null;
}

// Quick action suggestions for refinement
const QUICK_ACTIONS = [
  'Add more detailed acceptance criteria to all items',
  'Break down large tasks into smaller subtasks',
  'Adjust estimates to be more conservative',
  'Add a testing task for each feature',
  'Prioritize based on user impact',
];

export function AIGeneratePanel({
  projectId,
  projectName,
  projectDescription,
  existingComponents,
  onComponentsCreated,
  onClose,
}: AIGeneratePanelProps) {
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<FullPlanResult | null>(null);
  const [selectedComponents, setSelectedComponents] = useState<Set<number>>(new Set());
  const [generateEpics, setGenerateEpics] = useState(false);

  // Async AI progress state
  const [progress, setProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Chat refinement state
  const [showRefinement, setShowRefinement] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [refinementExplanation, setRefinementExplanation] = useState('');
  const [changedItems, setChangedItems] = useState<ChangedItem[]>([]);
  const [suggestedFollowUps, setSuggestedFollowUps] = useState<string[]>([]);

  // History stack for undo/redo (AWS Best Practice: maintain state for rollback)
  const [history, setHistory] = useState<PlanSnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // AWS Best Practice: Rate limiting
  const lastRequestTime = useRef<number>(0);

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  // Save current plan to history
  const saveToHistory = useCallback((snapshot: PlanSnapshot) => {
    setHistory((prev) => {
      // Truncate any future states if we're not at the end
      const newHistory = prev.slice(0, historyIndex + 1);
      return [...newHistory, snapshot];
    });
    setHistoryIndex((prev) => prev + 1);
  }, [historyIndex]);

  // Undo handler
  const handleUndo = useCallback(() => {
    if (historyIndex > 0 && plan) {
      const prevSnapshot = history[historyIndex - 1];
      setPlan({
        ...plan,
        components: prevSnapshot.components,
        sprints: prevSnapshot.sprints,
        epics: prevSnapshot.epics,
      });
      setHistoryIndex((prev) => prev - 1);
      // Clear refinement feedback when undoing
      setRefinementExplanation('');
      setChangedItems([]);
    }
  }, [historyIndex, history, plan]);

  // Redo handler
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1 && plan) {
      const nextSnapshot = history[historyIndex + 1];
      setPlan({
        ...plan,
        components: nextSnapshot.components,
        sprints: nextSnapshot.sprints,
        epics: nextSnapshot.epics,
      });
      setHistoryIndex((prev) => prev + 1);
    }
  }, [historyIndex, history, plan]);

  // Handle chat refinement
  const handleRefine = async (request: string) => {
    if (!plan || !request.trim()) return;

    // Rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime.current;
    if (timeSinceLastRequest < RATE_LIMIT_MS && lastRequestTime.current > 0) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
      setError(`Please wait ${waitTime} seconds before refining again`);
      return;
    }

    setRefining(true);
    setError(null);
    lastRequestTime.current = now;

    try {
      // Save current state before refinement for undo
      saveToHistory({
        components: plan.components,
        sprints: plan.sprints,
        epics: plan.epics,
      });

      const result = await refineBulkPlan({
        projectId,
        currentPlan: {
          components: plan.components.map((c) => ({
            name: c.name,
            description: c.description,
            type: c.type,
            estimatedHours: c.estimatedHours,
            priority: c.priority,
            suggestedDependencies: c.suggestedDependencies || [],
            parentName: c.parentName,
            acceptanceCriteria: c.acceptanceCriteria,
          })),
          sprints: plan.sprints,
          epics: plan.epics,
        },
        refinementRequest: request,
      });

      // Update plan with refined results
      setPlan({
        ...plan,
        components: result.components,
        sprints: result.sprints,
        epics: result.epics,
      });

      // Update refinement feedback
      setRefinementExplanation(result.explanation);
      setChangedItems(result.changedItems);
      setSuggestedFollowUps(result.suggestedFollowUps);

      // Clear chat input
      setChatInput('');

      // Update selection to include all components
      setSelectedComponents(new Set(result.components.map((_, i) => i)));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refinement failed';
      if (message.includes('Bedrock') || message.includes('throttl')) {
        setError('AI service is busy. Please wait a moment and try again.');
      } else {
        setError(message);
      }
    } finally {
      setRefining(false);
    }
  };

  const handleGenerate = async () => {
    // Rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime.current;
    if (timeSinceLastRequest < RATE_LIMIT_MS && lastRequestTime.current > 0) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
      setError(`Please wait ${waitTime} seconds before generating again`);
      return;
    }

    setGenerating(true);
    setError(null);
    setPlan(null);
    setProgress(0);
    setProgressMessage('Starting AI generation...');
    // Reset refinement state
    setShowRefinement(false);
    setChatInput('');
    setRefinementExplanation('');
    setChangedItems([]);
    setSuggestedFollowUps([]);
    setHistory([]);
    setHistoryIndex(-1);
    lastRequestTime.current = now;

    // Cleanup any existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }

    try {
      // Start async AI generation - returns sessionId immediately
      const job = await startAIGeneration({
        projectId,
        generateEpics,
      });

      // Subscribe to progress updates
      subscriptionRef.current = subscribeToAIProgress(
        job.sessionId,
        (progressUpdate: AIProgress) => {
          setProgress(progressUpdate.progress);
          setProgressMessage(progressUpdate.message);

          if (progressUpdate.status === 'COMPLETED' && progressUpdate.result) {
            const result = progressUpdate.result;
            setPlan(result);
            // Select all components by default
            setSelectedComponents(new Set(result.components.map((_, i) => i)));
            // Save initial state to history for undo support
            setHistory([{
              components: result.components,
              sprints: result.sprints,
              epics: result.epics,
            }]);
            setHistoryIndex(0);
            setGenerating(false);
            // Cleanup subscription
            if (subscriptionRef.current) {
              subscriptionRef.current.unsubscribe();
              subscriptionRef.current = null;
            }
          } else if (progressUpdate.status === 'FAILED') {
            const message = progressUpdate.error || 'AI generation failed';
            if (message.includes('Bedrock') || message.includes('AccessDenied')) {
              setError('AI service is temporarily unavailable. Please try again later.');
            } else {
              setError(message);
            }
            setGenerating(false);
            // Cleanup subscription
            if (subscriptionRef.current) {
              subscriptionRef.current.unsubscribe();
              subscriptionRef.current = null;
            }
          }
        },
        (err: Error) => {
          console.error('Subscription error:', err);
          setError('Lost connection to AI service. Please try again.');
          setGenerating(false);
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI generation failed';
      if (message.includes('Bedrock') || message.includes('AccessDenied')) {
        setError('AI service is temporarily unavailable. Please try again later.');
      } else {
        setError(message);
      }
      setGenerating(false);
    }
  };

  const toggleComponentSelection = (index: number) => {
    const newSelected = new Set(selectedComponents);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedComponents(newSelected);
  };

  const handleApplyPlan = async () => {
    if (!plan || selectedComponents.size === 0) return;

    setApplying(true);
    setError(null);

    try {
      // Filter to only selected components
      const selectedComps = plan.components.filter((_, i) => selectedComponents.has(i));

      // Build the components array for applyFullPlan
      const componentsInput: GeneratedComponent[] = selectedComps.map((c) => ({
        name: c.name,
        description: c.description,
        type: c.type,
        estimatedHours: c.estimatedHours,
        priority: c.priority,
        suggestedDependencies: c.suggestedDependencies || [],
        parentName: c.parentName,
        acceptanceCriteria: c.acceptanceCriteria,
      }));

      // Get sprint references for selected components
      const selectedComponentNames = new Set(selectedComps.map((c) => c.name));
      const filteredSprints: GeneratedSprint[] | undefined = plan.sprints
        ?.map((s) => ({
          ...s,
          componentNames: s.componentNames.filter((name) => selectedComponentNames.has(name)),
        }))
        .filter((s) => s.componentNames.length > 0);

      const result = await applyFullPlan({
        projectId,
        components: componentsInput,
        enhancedDescription: plan.enhancedDescription,
        sprints: filteredSprints?.length ? filteredSprints : undefined,
        epics: plan.epics,
      });

      // Notify parent that components were created
      // We don't have the full Component objects, so we create minimal ones
      const createdComponents: Component[] = result.componentIds.map((id, i) => ({
        id,
        name: selectedComps[i]?.name || 'Unknown',
        description: selectedComps[i]?.description,
        type: selectedComps[i]?.type || 'TASK',
        projectId,
        status: 'PLANNING' as const,
        priority: selectedComps[i]?.priority ? selectedComps[i].priority * 10 : undefined,
        estimatedHours: selectedComps[i]?.estimatedHours,
      }));

      onComponentsCreated(createdComponents);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply plan');
    } finally {
      setApplying(false);
    }
  };

  const TYPE_COLORS: Record<string, string> = {
    EPIC: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    FEATURE: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    STORY: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    TASK: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    BUG: 'bg-red-500/20 text-red-300 border-red-500/30',
  };

  // Group components by sprint for display
  const componentsBySprint = useCallback(() => {
    if (!plan) return null;
    if (!plan.sprints || plan.sprints.length === 0) {
      return { unassigned: plan.components };
    }

    const sprintMap = new Map<string, GeneratedComponent[]>();
    const componentNameToSprint = new Map<string, string>();

    plan.sprints.forEach((sprint) => {
      sprint.componentNames.forEach((name) => {
        componentNameToSprint.set(name, sprint.name);
      });
    });

    const unassigned: GeneratedComponent[] = [];
    plan.components.forEach((c) => {
      const sprintName = componentNameToSprint.get(c.name);
      if (sprintName) {
        const existing = sprintMap.get(sprintName) || [];
        existing.push(c);
        sprintMap.set(sprintName, existing);
      } else {
        unassigned.push(c);
      }
    });

    return { sprints: sprintMap, unassigned };
  }, [plan]);

  const groupedComponents = componentsBySprint();

  return (
    <div className="p-6 bg-slate-800 border border-slate-700 rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-violet-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          AI Plan Generator
        </h2>
        <div className="flex items-center gap-2">
          {/* Undo/Redo buttons - only show when plan exists */}
          {plan && history.length > 1 && (
            <>
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0 || refining}
                className="p-1.5 text-slate-400 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed transition-colors rounded hover:bg-slate-700"
                aria-label="Undo"
                title="Undo last refinement"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1 || refining}
                className="p-1.5 text-slate-400 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed transition-colors rounded hover:bg-slate-700"
                aria-label="Redo"
                title="Redo refinement"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.293 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 9H9a5 5 0 00-5 5v2a1 1 0 11-2 0v-2a7 7 0 017-7h5.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              <div className="w-px h-4 bg-slate-600 mx-1" />
            </>
          )}
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Project context display */}
      <div className="mb-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
        <div className="text-sm">
          <span className="text-slate-400">Project: </span>
          <span className="text-white font-medium">{projectName}</span>
        </div>
        {projectDescription && (
          <p className="text-sm text-slate-500 mt-1 line-clamp-2">{projectDescription}</p>
        )}
        {existingComponents.length > 0 && (
          <p className="text-xs text-slate-500 mt-2">
            {existingComponents.length} existing component{existingComponents.length !== 1 ? 's' : ''} will be considered
          </p>
        )}
      </div>

      {/* Options */}
      <div className="mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={generateEpics}
            onChange={(e) => setGenerateEpics(e.target.checked)}
            disabled={generating || applying}
            className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-violet-500 focus:ring-violet-500"
          />
          <span className="text-sm text-slate-300">Generate epics for hierarchical organization</span>
        </label>
      </div>

      {/* Generate button with progress bar */}
      {!plan && (
        <div className="space-y-3">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Generating Plan...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                    clipRule="evenodd"
                  />
                </svg>
                Generate Full Plan
              </>
            )}
          </button>

          {/* Progress bar - shown during generation */}
          {generating && (
            <div className="space-y-2">
              {/* Progress bar container */}
              <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-violet-500 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {/* Progress message */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">{progressMessage}</span>
                <span className="text-violet-400 font-medium">{progress}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Generated Plan Display */}
      {plan && (
        <div className="mt-4">
          {/* Summary */}
          {plan.summary && (
            <div className="mb-4 p-3 bg-violet-900/20 border border-violet-500/30 rounded-lg">
              <p className="text-sm text-violet-200">{plan.summary}</p>
            </div>
          )}

          {/* Enhanced description */}
          {plan.enhancedDescription && (
            <div className="mb-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <p className="text-xs text-slate-400 mb-1">Enhanced Description:</p>
              <p className="text-sm text-slate-300">{plan.enhancedDescription}</p>
            </div>
          )}

          {/* Selection controls */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">
              {selectedComponents.size} of {plan.components.length} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedComponents(new Set(plan.components.map((_, i) => i)))}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                Select All
              </button>
              <button onClick={() => setSelectedComponents(new Set())} className="text-xs text-slate-400 hover:text-slate-300">
                Clear
              </button>
            </div>
          </div>

          {/* Components grouped by sprint */}
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {groupedComponents?.sprints &&
              Array.from(groupedComponents.sprints.entries()).map(([sprintName, components]) => {
                const sprint = plan.sprints?.find((s) => s.name === sprintName);
                return (
                  <div key={sprintName} className="border border-slate-600 rounded-lg overflow-hidden">
                    <div className="bg-slate-700/50 px-3 py-2 border-b border-slate-600">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-white">{sprintName}</span>
                        {sprint && (
                          <span className="text-xs text-slate-400">
                            {sprint.durationWeeks} week{sprint.durationWeeks !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {sprint?.goal && <p className="text-xs text-slate-400 mt-1">{sprint.goal}</p>}
                    </div>
                    <div className="p-2 space-y-2">
                      {components.map((comp) => {
                        const index = plan.components.findIndex((c) => c.name === comp.name);
                        return (
                          <ComponentCard
                            key={index}
                            component={comp}
                            index={index}
                            selected={selectedComponents.has(index)}
                            onToggle={toggleComponentSelection}
                            typeColors={TYPE_COLORS}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}

            {/* Unassigned components (backlog) */}
            {groupedComponents?.unassigned && groupedComponents.unassigned.length > 0 && (
              <div className="border border-slate-600 rounded-lg overflow-hidden">
                <div className="bg-slate-700/50 px-3 py-2 border-b border-slate-600">
                  <span className="font-medium text-white">Backlog</span>
                </div>
                <div className="p-2 space-y-2">
                  {groupedComponents.unassigned.map((comp) => {
                    const index = plan.components.findIndex((c) => c.name === comp.name);
                    return (
                      <ComponentCard
                        key={index}
                        component={comp}
                        index={index}
                        selected={selectedComponents.has(index)}
                        onToggle={toggleComponentSelection}
                        typeColors={TYPE_COLORS}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Refinement Panel */}
          <div className="mt-4 border border-slate-600 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowRefinement(!showRefinement)}
              className="w-full px-4 py-3 bg-slate-700/50 hover:bg-slate-700 flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
                Refine with AI
                {history.length > 1 && (
                  <span className="text-xs text-slate-400">({history.length - 1} refinement{history.length > 2 ? 's' : ''})</span>
                )}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 text-slate-400 transition-transform ${showRefinement ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {showRefinement && (
              <div className="p-4 bg-slate-900/50 space-y-4">
                {/* Quick action suggestions */}
                <div>
                  <p className="text-xs text-slate-400 mb-2">Quick actions:</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_ACTIONS.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => handleRefine(action)}
                        disabled={refining}
                        className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded transition-colors"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Suggested follow-ups from previous refinement */}
                {suggestedFollowUps.length > 0 && (
                  <div>
                    <p className="text-xs text-violet-400 mb-2">Suggested follow-ups:</p>
                    <div className="flex flex-wrap gap-2">
                      {suggestedFollowUps.map((suggestion, i) => (
                        <button
                          key={i}
                          onClick={() => handleRefine(suggestion)}
                          disabled={refining}
                          className="text-xs px-2 py-1 bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/30 disabled:opacity-50 text-violet-200 rounded transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom refinement input */}
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Custom refinement:</label>
                  <div className="flex gap-2">
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleRefine(chatInput);
                        }
                      }}
                      placeholder="Describe how you'd like to change the plan..."
                      disabled={refining}
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                      rows={2}
                    />
                    <button
                      onClick={() => handleRefine(chatInput)}
                      disabled={refining || !chatInput.trim()}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                      {refining ? (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Press Cmd+Enter to send</p>
                </div>

                {/* Refinement explanation */}
                {refinementExplanation && (
                  <div className="p-3 bg-violet-900/20 border border-violet-500/30 rounded-lg">
                    <p className="text-xs text-violet-400 mb-1">AI Explanation:</p>
                    <p className="text-sm text-violet-200">{refinementExplanation}</p>
                  </div>
                )}

                {/* Changed items */}
                {changedItems.length > 0 && (
                  <div className="p-3 bg-slate-800/50 border border-slate-600 rounded-lg">
                    <p className="text-xs text-slate-400 mb-2">Changes made:</p>
                    <ul className="space-y-1">
                      {changedItems.map((item, i) => (
                        <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
                            item.type === 'ADDED' ? 'bg-green-500/20 text-green-300' :
                            item.type === 'REMOVED' ? 'bg-red-500/20 text-red-300' :
                            'bg-blue-500/20 text-blue-300'
                          }`}>
                            {item.type}
                          </span>
                          <span><strong className="text-white">{item.name}</strong>: {item.change}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleApplyPlan}
              disabled={applying || refining || selectedComponents.size === 0}
              className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {applying ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Applying...
                </>
              ) : (
                `Apply ${selectedComponents.size} Component${selectedComponents.size !== 1 ? 's' : ''}`
              )}
            </button>
            <button
              onClick={() => {
                setPlan(null);
                setSelectedComponents(new Set());
                setShowRefinement(false);
                setRefinementExplanation('');
                setChangedItems([]);
                setSuggestedFollowUps([]);
                setHistory([]);
                setHistoryIndex(-1);
              }}
              disabled={applying || refining}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}

      {/* Tips when no plan generated */}
      {!plan && !generating && (
        <div className="mt-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
          <p className="text-xs text-slate-500">
            <strong className="text-slate-400">AI Plan Generation:</strong> Based on your project name and description, the AI
            will generate a comprehensive plan with components, dependencies, and optional sprints using your team's workflow
            settings.
          </p>
        </div>
      )}
    </div>
  );
}

// Component card subcomponent
function ComponentCard({
  component,
  index,
  selected,
  onToggle,
  typeColors,
}: {
  component: GeneratedComponent;
  index: number;
  selected: boolean;
  onToggle: (index: number) => void;
  typeColors: Record<string, string>;
}) {
  return (
    <div
      onClick={() => onToggle(index)}
      className={`p-3 rounded-lg border cursor-pointer transition-all ${
        selected ? 'bg-slate-700/50 border-cyan-500/50' : 'bg-slate-900/50 border-slate-700 opacity-60'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(index)}
          className="mt-1 w-4 h-4 rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded border ${typeColors[component.type]}`}>{component.type}</span>
            <span className="font-medium text-white truncate">{component.name}</span>
          </div>
          {component.description && <p className="text-sm text-slate-400 line-clamp-2">{component.description}</p>}
          <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
            {component.estimatedHours && <span>{component.estimatedHours}h</span>}
            {component.priority && <span>P{component.priority}</span>}
            {component.suggestedDependencies && component.suggestedDependencies.length > 0 && (
              <span className="text-amber-400/70">
                Depends on: {component.suggestedDependencies.slice(0, 2).join(', ')}
                {component.suggestedDependencies.length > 2 && ` +${component.suggestedDependencies.length - 2}`}
              </span>
            )}
            {component.parentName && <span className="text-violet-400/70">Parent: {component.parentName}</span>}
          </div>
          {component.acceptanceCriteria && component.acceptanceCriteria.length > 0 && (
            <div className="mt-2 text-xs text-slate-500">
              <span className="text-slate-400">Acceptance Criteria:</span>
              <ul className="list-disc list-inside mt-1">
                {component.acceptanceCriteria.slice(0, 3).map((ac, i) => (
                  <li key={i} className="truncate">
                    {ac}
                  </li>
                ))}
                {component.acceptanceCriteria.length > 3 && <li>+{component.acceptanceCriteria.length - 3} more</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
