import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createProject,
  listTeamsForUser,
  getCurrentUserId,
  startAIGeneration,
  subscribeToAIProgress,
  getTeamWorkflowConfig,
  type TeamWithMembers,
  type AIProgress,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import { Sparkles, Loader2 } from 'lucide-react';

export function ProjectNewPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState('');
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI generation state
  const [useAI, setUseAI] = useState(false);
  const [generateEpics, setGenerateEpics] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiProgress, setAiProgress] = useState<string>('');
  // AWS Best Practice: Use AbortController instead of boolean ref for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Workflow template state
  const [workflowTemplate, setWorkflowTemplate] = useState<string>('SCRUM');
  const [workflowLoading, setWorkflowLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function fetchTeams() {
      try {
        const data = await listTeamsForUser();
        setTeams(data);
        if (data.length > 0) {
          setTeamId(data[0].team.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load teams');
      } finally {
        setTeamsLoading(false);
      }
    }

    fetchTeams();
  }, [isAuthenticated]);

  // Fetch team's workflow config when team changes
  useEffect(() => {
    if (!teamId) return;

    async function fetchWorkflowConfig() {
      setWorkflowLoading(true);
      try {
        const config = await getTeamWorkflowConfig(teamId);
        if (config?.workflowTemplate) {
          setWorkflowTemplate(config.workflowTemplate);
        } else {
          setWorkflowTemplate('SCRUM'); // Default if no config
        }
      } catch (err) {
        console.warn('Failed to load workflow config, using default:', err);
        setWorkflowTemplate('SCRUM');
      } finally {
        setWorkflowLoading(false);
      }
    }

    fetchWorkflowConfig();
  }, [teamId]);

  if (authLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Create Project</h1>
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Create Project</h1>
        <p className="text-slate-400 mb-4">Sign in to create a project.</p>
        <button
          onClick={() => signInWithRedirect()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium"
        >
          Sign In
        </button>
      </div>
    );
  }

  if (teamsLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Create Project</h1>
        <p className="text-slate-400">Loading teams...</p>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Create Project</h1>
        <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg">
          <p className="text-slate-400 mb-4">You need to be part of a team to create a project.</p>
          <button
            onClick={() => navigate('/team/new')}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium"
          >
            Create a Team First
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    if (!teamId) {
      setError('Please select a team');
      return;
    }

    setLoading(true);
    setError(null);
    // Create new AbortController for this submission
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const ownerId = await getCurrentUserId();
      if (!ownerId) {
        setError('Unable to get current user');
        setLoading(false);
        return;
      }

      // Step 1: Create the project
      setAiProgress('Creating project...');
      const projectId = crypto.randomUUID();
      const result = await createProject({
        id: projectId,
        teamId,
        ownerId,
        name: name.trim(),
        description: description.trim() || undefined,
      });

      // Step 2: If AI is enabled, generate and apply a full plan using async pattern
      if (useAI) {
        setAiGenerating(true);
        setAiProgress('Starting AI generation...');

        try {
          if (signal.aborted) return;

          // Start async AI generation - returns sessionId immediately (bypasses 30s AppSync timeout)
          const job = await startAIGeneration({
            projectId: result.id,
            generateEpics,
          });

          if (signal.aborted) return;

          // Check abort BEFORE creating subscription (fixes cleanup order issue)
          if (signal.aborted) return;

          // Wait for AI generation to complete via subscription
          // Note: Lambda applies the plan directly to DynamoDB, so we just wait for COMPLETED
          const subscription = subscribeToAIProgress(
            job.sessionId,
            (progressUpdate: AIProgress) => {
              // Don't update state if aborted
              if (signal.aborted) return;

              console.log('[ProjectNewPage] Progress update:', {
                status: progressUpdate.status,
                message: progressUpdate.message,
              });

              setAiProgress(progressUpdate.message);
            },
            (err: Error) => {
              console.error('[ProjectNewPage] Subscription error:', err);
            }
          );

          try {
            await new Promise<void>((resolve, reject) => {
              // Listen for abort signal
              signal.addEventListener('abort', () => {
                reject(new Error('Aborted'));
              });

              // Re-subscribe with completion handlers
              const completionSub = subscribeToAIProgress(
                job.sessionId,
                (progressUpdate: AIProgress) => {
                  if (progressUpdate.status === 'COMPLETED') {
                    completionSub.unsubscribe();
                    console.log('[ProjectNewPage] AI generation complete, plan applied by Lambda');
                    if (!signal.aborted) {
                      setAiProgress('Plan applied! Redirecting...');
                    }
                    resolve();
                  } else if (progressUpdate.status === 'FAILED') {
                    completionSub.unsubscribe();
                    reject(new Error(progressUpdate.error || 'AI generation failed'));
                  }
                },
                (_err: Error) => {
                  reject(new Error('Lost connection to AI service'));
                }
              );
            });
          } finally {
            // Always cleanup subscription
            subscription.unsubscribe();
          }

          if (signal.aborted) return;
        } catch (aiErr) {
          // AI generation failed but project was created - show warning and continue
          const aiMessage = aiErr instanceof Error ? aiErr.message : 'Unknown AI error';
          console.error('AI generation failed:', aiMessage);
          setAiProgress(`AI generation failed: ${aiMessage}. Project created without components.`);
          // Brief delay to show the message before navigating
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      navigate(`/project/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
      setAiGenerating(false);
      setAiProgress('');
    }
  };

  const isSubmitting = loading || aiGenerating;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Project</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="team" className="block text-sm font-medium text-slate-300 mb-1">
            Team *
          </label>
          <select
            id="team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            disabled={isSubmitting}
          >
            {teams.map((tw) => (
              <option key={tw.team.id} value={tw.team.id}>
                {tw.team.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-1">
            Project Name *
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            placeholder="My Project"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-slate-300 mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none"
            placeholder="What is this project about? Be detailed - the AI will use this to generate components."
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-slate-500">
            Tip: A detailed description helps the AI generate better components, dependencies, and sprints.
          </p>
        </div>

        {/* Workflow Template Selector */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Workflow Template
          </label>
          <p className="text-xs text-slate-500 mb-3">
            Choose how this project organizes work. This affects AI-generated plans and sprint behavior.
          </p>
          {workflowLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading team workflow...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`relative flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  workflowTemplate === 'SCRUM'
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-slate-700 hover:border-slate-600'
                } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="workflowTemplate"
                  value="SCRUM"
                  checked={workflowTemplate === 'SCRUM'}
                  onChange={(e) => setWorkflowTemplate(e.target.value)}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">Scrum</span>
                <span className="text-xs text-slate-400 mt-0.5">Time-boxed sprints with ceremonies</span>
              </label>
              <label
                className={`relative flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  workflowTemplate === 'KANBAN'
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-slate-700 hover:border-slate-600'
                } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="workflowTemplate"
                  value="KANBAN"
                  checked={workflowTemplate === 'KANBAN'}
                  onChange={(e) => setWorkflowTemplate(e.target.value)}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">Kanban</span>
                <span className="text-xs text-slate-400 mt-0.5">Continuous flow with WIP limits</span>
              </label>
              <label
                className={`relative flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  workflowTemplate === 'SHAPE_UP'
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-slate-700 hover:border-slate-600'
                } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="workflowTemplate"
                  value="SHAPE_UP"
                  checked={workflowTemplate === 'SHAPE_UP'}
                  onChange={(e) => setWorkflowTemplate(e.target.value)}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">Shape Up</span>
                <span className="text-xs text-slate-400 mt-0.5">6-week cycles with appetites</span>
              </label>
              <label
                className={`relative flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  workflowTemplate === 'CUSTOM'
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-slate-700 hover:border-slate-600'
                } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="workflowTemplate"
                  value="CUSTOM"
                  checked={workflowTemplate === 'CUSTOM'}
                  onChange={(e) => setWorkflowTemplate(e.target.value)}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">Custom</span>
                <span className="text-xs text-slate-400 mt-0.5">Custom configuration</span>
              </label>
            </div>
          )}
        </div>

        {/* AI Generation Toggle */}
        <div className="pt-2 border-t border-slate-700">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useAI}
              onChange={(e) => setUseAI(e.target.checked)}
              disabled={isSubmitting}
              className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-violet-500 focus:ring-violet-500"
            />
            <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <Sparkles className="w-4 h-4 text-violet-400" />
              Generate components with AI
            </span>
          </label>
        </div>

        {/* AI Options */}
        {useAI && (
          <div className="p-4 bg-violet-500/10 border border-violet-500/30 rounded-lg space-y-3">
            <p className="text-sm text-violet-200">
              The AI will analyze your project description and generate a comprehensive plan with components, dependencies,
              and sprints tailored to your{' '}
              <span className="font-semibold text-violet-100">
                {workflowTemplate === 'SCRUM' && 'Scrum'}
                {workflowTemplate === 'KANBAN' && 'Kanban'}
                {workflowTemplate === 'SHAPE_UP' && 'Shape Up'}
                {workflowTemplate === 'CUSTOM' && 'Custom'}
              </span>{' '}
              workflow.
            </p>

            {/* Epic option - only for Scrum and Custom (per official methodology guidelines) */}
            {(workflowTemplate === 'SCRUM' || workflowTemplate === 'CUSTOM') && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={generateEpics}
                  onChange={(e) => setGenerateEpics(e.target.checked)}
                  disabled={isSubmitting}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-violet-500 focus:ring-violet-500"
                />
                <span className="text-sm text-slate-300">Generate epics for hierarchical organization</span>
              </label>
            )}

            {/* Methodology-specific guidance */}
            {workflowTemplate === 'KANBAN' && (
              <p className="text-xs text-slate-400">
                Kanban workflow: Items will be generated as flat work items optimized for continuous flow. No sprints or epics.
              </p>
            )}
            {workflowTemplate === 'SHAPE_UP' && (
              <p className="text-xs text-slate-400">
                Shape Up workflow: Items will be organized as scopes within 6-week cycles. Progress tracked via hill charts.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-600/30 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Progress indicator */}
        {aiProgress && (
          <div className="p-3 bg-violet-900/30 border border-violet-600/30 rounded-lg flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
            <p className="text-violet-300 text-sm">{aiProgress}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className={`px-4 py-2 text-white rounded-lg font-medium transition-colors flex items-center gap-2 ${
              useAI
                ? 'bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700'
                : 'bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {aiGenerating ? 'Generating...' : 'Creating...'}
              </>
            ) : useAI ? (
              <>
                <Sparkles className="w-4 h-4" />
                Create with AI
              </>
            ) : (
              'Create Project'
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              // Abort any pending operations
              abortControllerRef.current?.abort();
              navigate('/project');
            }}
            disabled={isSubmitting}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
