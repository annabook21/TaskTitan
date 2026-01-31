import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  createSprint,
  planSprint,
  listProjectsByTeam,
  listComponentsByProject,
  type Component,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';

// AWS Best Practice: Rate limiting for AI requests
const RATE_LIMIT_MS = 3000;

export function SprintNewPage() {
  const { id: teamId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI suggestion state
  const [suggesting, setSuggesting] = useState(false);
  const [backlogComponents, setBacklogComponents] = useState<Component[]>([]);
  const [aiReasoning, setAiReasoning] = useState('');
  const [suggestedHours, setSuggestedHours] = useState<number | null>(null);
  const lastSuggestTime = useRef<number>(0);

  // Fetch backlog components on mount
  useEffect(() => {
    if (!isAuthenticated || !teamId) return;

    async function fetchBacklog() {
      try {
        const projects = await listProjectsByTeam(teamId!);
        const allComponentPromises = projects.map((p) => listComponentsByProject(p.id));
        const allComponentArrays = await Promise.all(allComponentPromises);
        const allComponents = allComponentArrays.flat();
        const backlog = allComponents.filter((c) => !c.sprintId);
        setBacklogComponents(backlog);
      } catch {
        // Silently fail - AI suggest just won't work
      }
    }

    fetchBacklog();
  }, [isAuthenticated, teamId]);

  // AI Suggest handler
  const handleAISuggest = async () => {
    if (!teamId || backlogComponents.length === 0) {
      setError('No backlog items available for AI suggestions');
      return;
    }

    // Rate limiting check
    const now = Date.now();
    const timeSinceLastRequest = now - lastSuggestTime.current;
    if (timeSinceLastRequest < RATE_LIMIT_MS && lastSuggestTime.current > 0) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRequest) / 1000);
      setError(`Please wait ${waitTime} seconds before suggesting again`);
      return;
    }

    setSuggesting(true);
    setError(null);
    lastSuggestTime.current = now;

    try {
      // Use planSprint with no sprintId to get AI analysis of backlog
      const result = await planSprint({
        teamId,
        sprintId: undefined,
        capacityHours: 40, // Default 2-week sprint capacity
      });

      // Generate a suggested name based on top priority components
      const suggestedComponents = backlogComponents.filter((c) =>
        result.selectedComponentIds.includes(c.id)
      );
      
      // Create a meaningful sprint name
      const topComponent = suggestedComponents[0];
      const sprintNumber = `Sprint ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      const suggestedName = topComponent
        ? `${sprintNumber} - ${topComponent.name.substring(0, 30)}${topComponent.name.length > 30 ? '...' : ''}`
        : sprintNumber;

      // Create a goal based on the analysis
      const componentNames = suggestedComponents.slice(0, 3).map((c) => c.name);
      const suggestedGoal = componentNames.length > 0
        ? `Complete: ${componentNames.join(', ')}${suggestedComponents.length > 3 ? `, and ${suggestedComponents.length - 3} more items` : ''}`
        : 'Review and complete prioritized backlog items';

      // Set suggested dates (2 weeks from today)
      const today = new Date();
      const twoWeeksLater = new Date(today);
      twoWeeksLater.setDate(today.getDate() + 14);

      // Apply suggestions
      setName(suggestedName);
      setGoal(suggestedGoal);
      setStartDate(today.toISOString().split('T')[0]);
      setEndDate(twoWeeksLater.toISOString().split('T')[0]);
      setAiReasoning(result.reasoning);
      setSuggestedHours(result.totalHours);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI suggestion failed';
      if (message.includes('Bedrock') || message.includes('throttl')) {
        setError('AI service is busy. Please wait and try again.');
      } else {
        setError(message);
      }
    } finally {
      setSuggesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !teamId) return;

    setCreating(true);
    setError(null);
    try {
      const sprint = await createSprint({
        id: crypto.randomUUID(),
        teamId,
        name: name.trim(),
        goal: goal.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      navigate(`/team/${teamId}/sprints/${sprint.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sprint');
      setCreating(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-xl mx-auto">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">New Sprint</h1>
        <p className="text-slate-400 mb-4">Sign in to create a sprint.</p>
        <button
          onClick={() => signInWithRedirect()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <Link to="/team" className="hover:text-white">
          Teams
        </Link>
        <span>/</span>
        <Link to={`/team/${teamId}`} className="hover:text-white">
          Team
        </Link>
        <span>/</span>
        <Link to={`/team/${teamId}/sprints`} className="hover:text-white">
          Sprints
        </Link>
        <span>/</span>
        <span className="text-white">New</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">New Sprint</h1>
        {backlogComponents.length > 0 && (
          <button
            type="button"
            onClick={handleAISuggest}
            disabled={suggesting || creating}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            {suggesting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Suggesting...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
                </svg>
                AI Suggest
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* AI Reasoning display */}
      {aiReasoning && (
        <div className="mb-4 p-4 bg-violet-900/20 border border-violet-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-violet-300 text-sm mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
            </svg>
            AI Suggestion
            {suggestedHours && (
              <span className="ml-auto text-xs text-violet-400">
                Estimated: {suggestedHours}h capacity
              </span>
            )}
          </div>
          <p className="text-sm text-violet-200">{aiReasoning}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-1">
            Sprint Name *
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="e.g., Sprint 1 - User Authentication"
            disabled={creating}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="goal" className="block text-sm font-medium text-slate-300 mb-1">
            Sprint Goal
          </label>
          <textarea
            id="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
            placeholder="What do you want to achieve in this sprint?"
            disabled={creating}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-slate-300 mb-1">
              Start Date
            </label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              disabled={creating}
            />
          </div>
          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-slate-300 mb-1">
              End Date
            </label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              disabled={creating}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors"
          >
            {creating ? 'Creating...' : 'Create Sprint'}
          </button>
          <Link
            to={`/team/${teamId}/sprints`}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
