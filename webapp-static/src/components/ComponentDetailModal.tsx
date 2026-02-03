import { useState, useEffect, useRef, useMemo } from 'react';
import {
  getComponent,
  updateComponent,
  deleteComponent,
  refineComponent,
  type Component,
  type ComponentType,
  type ComponentStatus,
  type NaturalLanguageComponent,
  type Membership,
} from '../api/appsync';
import { Loader2 } from 'lucide-react';
import { AssigneeSelector } from './AssigneeSelector';
// CommentSection removed (guest functionality deleted)

const COMPONENT_TYPES: ComponentType[] = ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG'];
const COMPONENT_STATUSES: ComponentStatus[] = ['PLANNING', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'];

// AWS Best Practice: Rate limiting for AI requests
const RATE_LIMIT_MS = 3000;

// Quick action suggestions for component refinement
const REFINE_QUICK_ACTIONS = [
  'Break this down into smaller tasks',
  'Increase the estimate by 25%',
  'Add acceptance criteria',
  'Suggest dependencies',
  'Make the description more detailed',
];

interface ComponentDetailModalProps {
  component: Component;
  projectId: string;
  teamMembers?: Membership[];
  onClose: () => void;
  onUpdate: (updated: Component) => void;
  onDeleted?: (componentId: string) => void;
}

export function ComponentDetailModal({
  component: initialComponent,
  projectId,
  teamMembers,
  onClose,
  onUpdate,
  onDeleted,
}: ComponentDetailModalProps) {
  const [component, setComponent] = useState<Component | null>(initialComponent);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // AI Refinement state
  const [showRefinePanel, setShowRefinePanel] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineInput, setRefineInput] = useState('');
  const [refineExplanation, setRefineExplanation] = useState('');
  const [refineSuggestions, setRefineSuggestions] = useState<string[]>([]);
  const [refinedPreview, setRefinedPreview] = useState<{
    name: string;
    description: string;
    type: ComponentType;
    estimatedHours: number;
    priority: number;
    acceptanceCriteria?: string[];
  } | null>(null);
  const lastRefineTime = useRef<number>(0);

  // Editable form state
  const [name, setName] = useState(initialComponent.name);
  const [description, setDescription] = useState(initialComponent.description ?? '');
  const [type, setType] = useState<ComponentType>(initialComponent.type);
  const [status, setStatus] = useState<ComponentStatus>(initialComponent.status);
  const [priority, setPriority] = useState<string>(
    initialComponent.priority != null ? String(initialComponent.priority) : ''
  );
  const [estimatedHours, setEstimatedHours] = useState(
    initialComponent.estimatedHours != null ? String(initialComponent.estimatedHours) : ''
  );
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>(
    initialComponent.acceptanceCriteria ?? []
  );

  // Create a lookup map to resolve owner IDs to names
  const memberMap = useMemo(() => {
    if (!teamMembers) return new Map<string, string>();
    return new Map(
      teamMembers.map((m) => [m.userId, m.user?.name || m.title || m.userId])
    );
  }, [teamMembers]);

  // Resolve owner ID to display name
  const resolveOwnerName = (ownerId: string | null | undefined): string | null => {
    if (!ownerId) return null;
    return memberMap.get(ownerId) || ownerId;
  };

  // Handle AI refinement
  const handleRefine = async (request: string) => {
    if (!request.trim()) return;

    // Rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - lastRefineTime.current;
    if (timeSinceLastRequest < RATE_LIMIT_MS && lastRefineTime.current > 0) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
      setError(`Please wait ${waitTime} seconds before refining again`);
      return;
    }

    setRefining(true);
    setError(null);
    lastRefineTime.current = now;

    try {
      // Build current component state for refinement
      const currentComponent: NaturalLanguageComponent = {
        name,
        description,
        type,
        estimatedHours: parseFloat(estimatedHours) || 0,
        priority: parseInt(priority, 10) || 50,
        suggestedDependencies: [],
        reasoning: 'Existing component being refined',
      };

      const result = await refineComponent({
        projectId,
        currentComponent,
        refinementRequest: request.trim(),
      });

      // Store preview instead of directly applying (same UX as guest mode)
      setRefinedPreview({
        name: result.component.name,
        description: result.component.description,
        type: result.component.type,
        estimatedHours: result.component.estimatedHours,
        priority: result.component.priority,
        acceptanceCriteria: result.component.acceptanceCriteria ?? undefined,
      });

      // Show explanation and suggestions
      setRefineExplanation(result.explanation);
      setRefineSuggestions(result.suggestedFollowUps);
      setRefineInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refinement failed';
      if (message.includes('Bedrock') || message.includes('throttl')) {
        setError('AI service is busy. Please wait and try again.');
      } else {
        setError(message);
      }
    } finally {
      setRefining(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const full = await getComponent(initialComponent.id);
        if (mounted && full) {
          setComponent(full);
          setName(full.name);
          setDescription(full.description ?? '');
          setType(full.type);
          setStatus(full.status);
          setPriority(full.priority != null ? String(full.priority) : '');
          setEstimatedHours(
            full.estimatedHours != null ? String(full.estimatedHours) : ''
          );
          setAcceptanceCriteria(full.acceptanceCriteria ?? []);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load component');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [initialComponent.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!component || !name.trim()) return;

    const parsedPriority =
      priority.trim() === ''
        ? undefined
        : (() => {
            const p = parseInt(priority, 10);
            return Number.isNaN(p) ? undefined : p;
          })();
    const parsedHours =
      estimatedHours.trim() === ''
        ? undefined
        : (() => {
            const h = parseFloat(estimatedHours);
            return Number.isNaN(h) ? undefined : h;
          })();

    setSaving(true);
    setError(null);
    try {
      const updated = await updateComponent(component.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        type,
        status,
        priority: parsedPriority,
        estimatedHours: parsedHours,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
      });
      onUpdate(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!component) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteComponent(component.id);
      onDeleted?.(component.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const displayComponent = component ?? initialComponent;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Component details</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRefinePanel(!showRefinePanel)}
              disabled={loading}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                showRefinePanel
                  ? 'bg-violet-600 text-white'
                  : 'bg-violet-600/20 text-violet-300 hover:bg-violet-600/30'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Refine with AI
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="p-3 bg-red-900/30 border border-red-600/30 rounded-lg">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Component name"
                  disabled={saving || deleting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                  placeholder="Brief description"
                  disabled={saving || deleting}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Type
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as ComponentType)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    disabled={saving || deleting}
                  >
                    {COMPONENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ComponentStatus)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    disabled={saving || deleting}
                  >
                    {COMPONENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Priority
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="1–100"
                    disabled={saving || deleting}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Estimated hours
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="Hours"
                    disabled={saving || deleting}
                  />
                </div>
              </div>

              {displayComponent.owner && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">
                    Owner
                  </label>
                  <p className="text-sm text-slate-400">{resolveOwnerName(displayComponent.owner)}</p>
                </div>
              )}

              {/* Team Member Assignment */}
              {teamMembers && teamMembers.length > 0 && (
                <div className="border-t border-slate-700 pt-4 mt-2">
                  <AssigneeSelector
                    componentId={displayComponent.id}
                    teamMembers={teamMembers}
                  />
                </div>
              )}

              {/* AI Refinement Panel */}
              {showRefinePanel && (
                <div className="mt-2 p-4 bg-slate-900/50 border border-violet-500/30 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 text-sm text-violet-300">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                    AI Refinement
                  </div>

                  {/* Quick actions */}
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Quick actions:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {REFINE_QUICK_ACTIONS.map((action, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleRefine(action)}
                          disabled={refining || saving || deleting}
                          className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded transition-colors"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Suggested follow-ups from previous refinement */}
                  {refineSuggestions.length > 0 && (
                    <div>
                      <p className="text-xs text-violet-400 mb-2">Suggestions:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {refineSuggestions.map((suggestion, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => handleRefine(suggestion)}
                            disabled={refining || saving || deleting}
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
                      <input
                        type="text"
                        value={refineInput}
                        onChange={(e) => setRefineInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRefine(refineInput);
                          }
                        }}
                        placeholder="Describe how to improve this component..."
                        disabled={refining || saving || deleting}
                        className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleRefine(refineInput)}
                        disabled={refining || saving || deleting || !refineInput.trim()}
                        className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded font-medium transition-colors flex items-center gap-1"
                      >
                        {refining ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Refinement explanation */}
                  {refineExplanation && (
                    <div className="p-2 bg-violet-900/30 border border-violet-500/20 rounded">
                      <p className="text-xs text-violet-400 mb-1">AI applied:</p>
                      <p className="text-sm text-violet-200">{refineExplanation}</p>
                    </div>
                  )}

                  {/* Refined Preview (same UX as guest mode) */}
                  {refinedPreview && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-slate-300">Suggested Changes:</h4>
                      <div className="p-3 bg-slate-800 border border-slate-600 rounded-lg space-y-2 max-h-48 overflow-y-auto">
                        <p className="text-sm">
                          <span className="text-slate-500">Name:</span>{' '}
                          <span className="text-white">{refinedPreview.name}</span>
                        </p>
                        <p className="text-sm">
                          <span className="text-slate-500">Type:</span>{' '}
                          <span className="text-white">{refinedPreview.type}</span>
                        </p>
                        <p className="text-sm">
                          <span className="text-slate-500">Hours:</span>{' '}
                          <span className="text-white">{refinedPreview.estimatedHours}h</span>
                        </p>
                        <p className="text-sm">
                          <span className="text-slate-500">Description:</span>{' '}
                          <span className="text-slate-300">{refinedPreview.description}</span>
                        </p>
                        {refinedPreview.acceptanceCriteria && refinedPreview.acceptanceCriteria.length > 0 && (
                          <div className="text-sm">
                            <span className="text-slate-500">Acceptance Criteria:</span>
                            <ul className="list-disc list-inside text-slate-300 mt-1">
                              {refinedPreview.acceptanceCriteria.map((ac, i) => (
                                <li key={i}>{ac}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setRefinedPreview(null)}
                          disabled={refining}
                          className="px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Apply preview to form fields
                            setName(refinedPreview.name);
                            setDescription(refinedPreview.description);
                            setType(refinedPreview.type);
                            setEstimatedHours(String(refinedPreview.estimatedHours));
                            setPriority(String(refinedPreview.priority));
                            setAcceptanceCriteria(refinedPreview.acceptanceCriteria ?? []);
                            setRefinedPreview(null);
                          }}
                          disabled={refining}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded font-medium transition-colors"
                        >
                          Apply Changes
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Comments Section */}
              <div className="border-t border-slate-700 pt-4 mt-4">
                {/* CommentSection removed - guest functionality deleted */}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-700">
              <div>
                {onDeleted && (
                  <>
                    {!showDeleteConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={saving || deleting}
                        className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        Delete
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Delete?</span>
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={deleting}
                          className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50"
                        >
                          {deleting ? 'Deleting...' : 'Yes'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(false)}
                          disabled={deleting}
                          className="px-2 py-1 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded"
                        >
                          No
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving || deleting}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || deleting || !name.trim()}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
