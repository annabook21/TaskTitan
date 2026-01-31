import { useState, useRef } from 'react';
import {
  planSprint,
  assignComponentToSprint,
  type SprintPlanResult,
  type Component,
} from '../api/appsync';

interface AISprintPlannerProps {
  teamId: string;
  sprintId: string;
  components: Component[];
  onComponentsAssigned: (componentIds: string[]) => void;
}

// AWS Best Practice: Rate limiting to prevent abuse
const RATE_LIMIT_MS = 3000;

export function AISprintPlanner({
  teamId,
  sprintId,
  components,
  onComponentsAssigned,
}: AISprintPlannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacityHours, setCapacityHours] = useState('40');
  const [plan, setPlan] = useState<SprintPlanResult | null>(null);

  // Rate limiting
  const lastRequestTime = useRef<number>(0);

  const handlePlanSprint = async () => {
    const capacity = parseFloat(capacityHours);
    if (isNaN(capacity) || capacity <= 0) {
      setError('Please enter a valid capacity in hours');
      return;
    }

    // Rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime.current;
    if (timeSinceLastRequest < RATE_LIMIT_MS && lastRequestTime.current > 0) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
      setError(`Please wait ${waitTime} seconds before planning again`);
      return;
    }

    setLoading(true);
    setError(null);
    lastRequestTime.current = now;

    try {
      const result = await planSprint({
        teamId,
        sprintId,
        capacityHours: capacity,
      });

      setPlan(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to plan sprint';
      if (message.includes('Bedrock') || message.includes('throttl')) {
        setError('AI service is busy. Please wait and try again.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPlan = async () => {
    if (!plan || plan.selectedComponentIds.length === 0) return;

    setApplying(true);
    setError(null);

    try {
      // Assign each component to the sprint
      await Promise.all(
        plan.selectedComponentIds.map((componentId) =>
          assignComponentToSprint(componentId, sprintId)
        )
      );

      onComponentsAssigned(plan.selectedComponentIds);
      setPlan(null);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply plan');
    } finally {
      setApplying(false);
    }
  };

  // Get component names for display
  const getComponentName = (id: string) => {
    const comp = components.find((c) => c.id === id);
    return comp?.name || id;
  };

  // Calculate fill percentage
  const fillPercentage = plan
    ? Math.round((plan.totalHours / parseFloat(capacityHours)) * 100)
    : 0;

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-slate-700/50 hover:bg-slate-700 flex items-center justify-between transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
          </svg>
          AI Sprint Planner
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="p-4 bg-slate-900/50 space-y-4">
          {/* Capacity input */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Sprint Capacity (hours)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={capacityHours}
                onChange={(e) => setCapacityHours(e.target.value)}
                min={1}
                disabled={loading || applying}
                className="w-32 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="40"
              />
              <button
                onClick={handlePlanSprint}
                disabled={loading || applying}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Planning...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                    </svg>
                    Generate Plan
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-900/30 border border-red-600/30 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Plan results */}
          {plan && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-slate-800 rounded-lg">
                  <div className="text-lg font-bold text-white">{plan.selectedComponentIds.length}</div>
                  <div className="text-xs text-slate-400">Components</div>
                </div>
                <div className="p-3 bg-slate-800 rounded-lg">
                  <div className="text-lg font-bold text-white">{plan.totalHours}h</div>
                  <div className="text-xs text-slate-400">Total Hours</div>
                </div>
                <div className="p-3 bg-slate-800 rounded-lg">
                  <div className={`text-lg font-bold ${fillPercentage > 100 ? 'text-red-400' : fillPercentage > 80 ? 'text-amber-400' : 'text-green-400'}`}>
                    {fillPercentage}%
                  </div>
                  <div className="text-xs text-slate-400">Capacity Used</div>
                </div>
              </div>

              {/* Reasoning */}
              {plan.reasoning && (
                <div className="p-3 bg-violet-900/20 border border-violet-500/30 rounded-lg">
                  <p className="text-xs text-violet-400 mb-1">AI Reasoning:</p>
                  <p className="text-sm text-violet-200">{plan.reasoning}</p>
                </div>
              )}

              {/* Warnings */}
              {plan.warnings && plan.warnings.length > 0 && (
                <div className="p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg">
                  <div className="flex items-center gap-2 text-amber-400 text-sm mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Warnings
                  </div>
                  <ul className="text-sm text-amber-200 space-y-1">
                    {plan.warnings.map((warning, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-400">•</span>
                        {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Selected components */}
              <div>
                <p className="text-xs text-slate-400 mb-2">Selected components:</p>
                <div className="flex flex-wrap gap-2">
                  {plan.selectedComponentIds.map((id) => (
                    <span
                      key={id}
                      className="text-xs px-2 py-1 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded"
                    >
                      {getComponentName(id)}
                    </span>
                  ))}
                </div>
              </div>

              {/* Apply button */}
              <div className="flex gap-3">
                <button
                  onClick={handleApplyPlan}
                  disabled={applying}
                  className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {applying ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Applying...
                    </>
                  ) : (
                    `Add ${plan.selectedComponentIds.length} Components to Sprint`
                  )}
                </button>
                <button
                  onClick={() => setPlan(null)}
                  disabled={applying}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Tips when no plan */}
          {!plan && !loading && (
            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <p className="text-xs text-slate-500">
                <strong className="text-slate-400">AI Sprint Planning:</strong> Enter your sprint capacity and the AI will suggest which backlog components to include based on priority, dependencies, and estimated effort.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
