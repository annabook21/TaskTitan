/**
 * Guest AI Refinement Modal
 *
 * Allows guests to refine assigned components using AI chat.
 * Uses the same chat refinement as authenticated users but with IAM auth.
 * Guests can apply the AI suggestions to update the component.
 */

import { useState, useRef } from 'react';
import { guestRefineComponent, guestUpdateComponent, type RefineComponentResult } from '../api/appsync';
import { Loader2, Sparkles, X, AlertCircle, Save } from 'lucide-react';

// AWS Best Practice: Rate limiting for AI requests (same as authenticated mode)
const RATE_LIMIT_MS = 3000;

// Quick action suggestions for component refinement (same as authenticated mode)
const REFINE_QUICK_ACTIONS = [
  'Break this down into smaller tasks',
  'Increase the estimate by 25%',
  'Add acceptance criteria',
  'Suggest dependencies',
  'Make the description more detailed',
];

interface GuestRefineModalProps {
  guestId: string;
  componentId: string;
  componentName: string;
  onClose: () => void;
  onRefineApplied?: (result: RefineComponentResult) => void;
}

export function GuestRefineModal({
  guestId,
  componentId,
  componentName,
  onClose,
  onRefineApplied,
}: GuestRefineModalProps) {
  const [refineInput, setRefineInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RefineComponentResult | null>(null);
  const lastRefineTime = useRef<number>(0);

  // Handle AI refinement (same pattern as authenticated mode)
  const handleRefine = async (request: string) => {
    if (!request.trim() || loading) return;

    // Rate limiting check (same as authenticated mode)
    const now = Date.now();
    const timeSinceLastRequest = now - lastRefineTime.current;
    if (timeSinceLastRequest < RATE_LIMIT_MS && lastRefineTime.current > 0) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
      setError(`Please wait ${waitTime} seconds before refining again`);
      return;
    }

    setLoading(true);
    setError(null);
    lastRefineTime.current = now;

    try {
      const response = await guestRefineComponent({
        guestId,
        componentId,
        refinementRequest: request.trim(),
      });
      setResult(response);
      setRefineInput('');
    } catch (err) {
      console.error('AI refinement failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to refine component';
      if (message.includes('Bedrock') || message.includes('throttl')) {
        setError('AI service is busy. Please wait and try again.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApplyChanges = async () => {
    if (!result || applying) return;

    setApplying(true);
    setError(null);

    try {
      await guestUpdateComponent({
        guestId,
        componentId,
        name: result.component.name,
        description: result.component.description,
        type: result.component.type,
        estimatedHours: result.component.estimatedHours,
        priority: result.component.priority,
        acceptanceCriteria: result.component.acceptanceCriteria ?? undefined,
      });

      // Notify parent and close
      if (onRefineApplied) {
        onRefineApplied(result);
      }
      onClose();
    } catch (err) {
      console.error('Failed to apply changes:', err);
      setError(err instanceof Error ? err.message : 'Failed to apply changes');
    } finally {
      setApplying(false);
    }
  };

  const handleClose = () => {
    if (result && onRefineApplied) {
      onRefineApplied(result);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h2 className="font-medium text-white">AI Refine: {componentName}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body - scrollable */}
        <div className="p-4 overflow-y-auto flex-1">
          {!result ? (
            <div className="space-y-4">
              {/* Quick actions - clicking immediately submits (same as authenticated) */}
              <div>
                <p className="text-xs text-slate-400 mb-2">Quick actions:</p>
                <div className="flex flex-wrap gap-1.5">
                  {REFINE_QUICK_ACTIONS.map((action, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleRefine(action)}
                      disabled={loading}
                      className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded transition-colors"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom refinement input (same pattern as authenticated) */}
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
                    disabled={loading}
                    className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-600 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleRefine(refineInput)}
                    disabled={loading || !refineInput.trim()}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded font-medium transition-colors flex items-center gap-1"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-600/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* AI Explanation */}
              <div className="p-3 bg-cyan-900/30 border border-cyan-600/30 rounded-lg">
                <p className="text-xs text-cyan-400 mb-1">AI applied:</p>
                <p className="text-sm text-cyan-200">{result.explanation}</p>
              </div>

              {/* Refined Component Preview */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-slate-300">Suggested Changes:</h4>
                <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg space-y-2">
                  <p className="text-sm">
                    <span className="text-slate-500">Name:</span>{' '}
                    <span className="text-white">{result.component.name}</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-slate-500">Type:</span>{' '}
                    <span className="text-white">{result.component.type}</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-slate-500">Hours:</span>{' '}
                    <span className="text-white">{result.component.estimatedHours}h</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-slate-500">Description:</span>{' '}
                    <span className="text-slate-300">{result.component.description}</span>
                  </p>
                  {result.component.acceptanceCriteria && result.component.acceptanceCriteria.length > 0 && (
                    <div className="text-sm">
                      <span className="text-slate-500">Acceptance Criteria:</span>
                      <ul className="list-disc list-inside text-slate-300 mt-1">
                        {result.component.acceptanceCriteria.map((ac, i) => (
                          <li key={i}>{ac}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Suggestions from AI (same styling as authenticated) */}
              {result.suggestedFollowUps.length > 0 && (
                <div>
                  <p className="text-xs text-violet-400 mb-2">Suggestions:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.suggestedFollowUps.map((suggestion, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setResult(null);
                          handleRefine(suggestion);
                        }}
                        disabled={loading || applying}
                        className="text-xs px-2 py-1 bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/30 disabled:opacity-50 text-violet-200 rounded transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-600/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  disabled={applying}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  Refine Again
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={applying}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={handleApplyChanges}
                  disabled={applying}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm rounded-lg transition-colors"
                >
                  {applying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Apply Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
