import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getTeam,
  getTeamWorkflowConfig,
  updateTeamWorkflowConfig,
  type Team,
  type UpdateWorkflowConfigInput,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import { ArrowLeft, Settings, Loader2 } from 'lucide-react';

export function TeamWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [workflowTemplate, setWorkflowTemplate] = useState<string>('SCRUM');
  const [wipLimitPlanning, setWipLimitPlanning] = useState<string>('');
  const [wipLimitInProgress, setWipLimitInProgress] = useState<string>('');
  const [wipLimitBlocked, setWipLimitBlocked] = useState<string>('');
  const [wipLimitReview, setWipLimitReview] = useState<string>('');
  const [cycleEnabled, setCycleEnabled] = useState(false);
  const [cycleDurationWeeks, setCycleDurationWeeks] = useState<string>('2');
  const [cycleStartDayOfWeek, setCycleStartDayOfWeek] = useState<string>('1');
  const [cycleName, setCycleName] = useState('Sprint');
  const [backlogName, setBacklogName] = useState('Backlog');
  const [enforceEstimates, setEnforceEstimates] = useState(false);
  const [autoArchiveCompleted, setAutoArchiveCompleted] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [teamData, configData] = await Promise.all([
        getTeam(id),
        getTeamWorkflowConfig(id),
      ]);
      setTeam(teamData);

      // Populate form with existing config
      if (configData) {
        setWorkflowTemplate(configData.workflowTemplate ?? 'SCRUM');
        setWipLimitPlanning(configData.wipLimitPlanning?.toString() ?? '');
        setWipLimitInProgress(configData.wipLimitInProgress?.toString() ?? '');
        setWipLimitBlocked(configData.wipLimitBlocked?.toString() ?? '');
        setWipLimitReview(configData.wipLimitReview?.toString() ?? '');
        setCycleEnabled(configData.cycleEnabled ?? false);
        setCycleDurationWeeks(configData.cycleDurationWeeks?.toString() ?? '2');
        setCycleStartDayOfWeek(configData.cycleStartDayOfWeek?.toString() ?? '1');
        setCycleName(configData.cycleName ?? 'Sprint');
        setBacklogName(configData.backlogName ?? 'Backlog');
        setEnforceEstimates(configData.enforceEstimates ?? false);
        setAutoArchiveCompleted(configData.autoArchiveCompleted ?? false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const input: UpdateWorkflowConfigInput = {
        workflowTemplate,
        wipLimitPlanning: wipLimitPlanning ? parseInt(wipLimitPlanning) : null,
        wipLimitInProgress: wipLimitInProgress ? parseInt(wipLimitInProgress) : null,
        wipLimitBlocked: wipLimitBlocked ? parseInt(wipLimitBlocked) : null,
        wipLimitReview: wipLimitReview ? parseInt(wipLimitReview) : null,
        cycleEnabled,
        cycleDurationWeeks: cycleEnabled && cycleDurationWeeks ? parseInt(cycleDurationWeeks) : null,
        cycleStartDayOfWeek: cycleEnabled && cycleStartDayOfWeek ? parseInt(cycleStartDayOfWeek) : null,
        cycleName: cycleName || null,
        backlogName: backlogName || null,
        enforceEstimates,
        autoArchiveCompleted,
      };

      await updateTeamWorkflowConfig(id, input);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading workflow settings...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <Settings className="w-7 h-7 text-cyan-400" />
          Workflow Settings
        </h1>
        <p className="text-slate-400 mb-4">Sign in to manage workflow settings.</p>
        <button onClick={() => signInWithRedirect()} className="btn-primary">
          Sign In
        </button>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to={`/team/${id}`}
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Team
        </Link>
        <p className="text-slate-400">Team not found.</p>
      </div>
    );
  }

  const DAYS_OF_WEEK = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        to={`/team/${id}`}
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {team.name}
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center">
          <Settings className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Workflow Settings</h1>
          <p className="text-slate-400">Configure workflow preferences for {team.name}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Workflow Template Section */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Workflow Template</h2>
          <p className="text-sm text-slate-400 mb-4">
            Choose how your team organizes work. This affects AI-generated plans and workflow behavior.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <label
              className={`relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all ${
                workflowTemplate === 'SCRUM'
                  ? 'border-cyan-500 bg-cyan-500/10'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="workflowTemplate"
                value="SCRUM"
                checked={workflowTemplate === 'SCRUM'}
                onChange={(e) => {
                  setWorkflowTemplate(e.target.value);
                  setCycleEnabled(true);
                }}
                className="sr-only"
              />
              <span className="text-lg font-semibold">Scrum</span>
              <span className="text-xs text-slate-400 mt-1">Time-boxed sprints, ceremonies, velocity tracking</span>
            </label>
            <label
              className={`relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all ${
                workflowTemplate === 'KANBAN'
                  ? 'border-cyan-500 bg-cyan-500/10'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="workflowTemplate"
                value="KANBAN"
                checked={workflowTemplate === 'KANBAN'}
                onChange={(e) => {
                  setWorkflowTemplate(e.target.value);
                  setCycleEnabled(false);
                }}
                className="sr-only"
              />
              <span className="text-lg font-semibold">Kanban</span>
              <span className="text-xs text-slate-400 mt-1">Continuous flow, WIP limits, pull-based</span>
            </label>
            <label
              className={`relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all ${
                workflowTemplate === 'SHAPE_UP'
                  ? 'border-cyan-500 bg-cyan-500/10'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="workflowTemplate"
                value="SHAPE_UP"
                checked={workflowTemplate === 'SHAPE_UP'}
                onChange={(e) => {
                  setWorkflowTemplate(e.target.value);
                  setCycleEnabled(true);
                  setCycleDurationWeeks('6');
                  setCycleName('Cycle');
                }}
                className="sr-only"
              />
              <span className="text-lg font-semibold">Shape Up</span>
              <span className="text-xs text-slate-400 mt-1">6-week cycles, appetites, cool-down</span>
            </label>
            <label
              className={`relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all ${
                workflowTemplate === 'CUSTOM'
                  ? 'border-cyan-500 bg-cyan-500/10'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="workflowTemplate"
                value="CUSTOM"
                checked={workflowTemplate === 'CUSTOM'}
                onChange={(e) => setWorkflowTemplate(e.target.value)}
                className="sr-only"
              />
              <span className="text-lg font-semibold">Custom</span>
              <span className="text-xs text-slate-400 mt-1">Mix and match settings below</span>
            </label>
          </div>
        </section>

        {/* WIP Limits Section */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">WIP Limits</h2>
          <p className="text-sm text-slate-400 mb-4">
            Work-in-Progress limits help maintain flow by preventing too many items in each status.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Planning</label>
              <input
                type="number"
                min="0"
                value={wipLimitPlanning}
                onChange={(e) => setWipLimitPlanning(e.target.value)}
                placeholder="No limit"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">In Progress</label>
              <input
                type="number"
                min="0"
                value={wipLimitInProgress}
                onChange={(e) => setWipLimitInProgress(e.target.value)}
                placeholder="No limit"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Blocked</label>
              <input
                type="number"
                min="0"
                value={wipLimitBlocked}
                onChange={(e) => setWipLimitBlocked(e.target.value)}
                placeholder="No limit"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Review</label>
              <input
                type="number"
                min="0"
                value={wipLimitReview}
                onChange={(e) => setWipLimitReview(e.target.value)}
                placeholder="No limit"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </div>
          </div>
        </section>

        {/* Sprint/Cycle Settings Section */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Sprint Settings</h2>
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={cycleEnabled}
                onChange={(e) => setCycleEnabled(e.target.checked)}
                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
              />
              <span>Enable time-boxed sprints</span>
            </label>

            {cycleEnabled && (
              <div className="grid grid-cols-2 gap-4 mt-4 pl-8">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Sprint Duration (weeks)</label>
                  <select
                    value={cycleDurationWeeks}
                    onChange={(e) => setCycleDurationWeeks(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                  >
                    <option value="1">1 week</option>
                    <option value="2">2 weeks</option>
                    <option value="3">3 weeks</option>
                    <option value="4">4 weeks</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Sprint Start Day</label>
                  <select
                    value={cycleStartDayOfWeek}
                    onChange={(e) => setCycleStartDayOfWeek(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Terminology Section */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Terminology</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Sprint Name</label>
              <input
                type="text"
                value={cycleName}
                onChange={(e) => setCycleName(e.target.value)}
                placeholder="Sprint"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Backlog Name</label>
              <input
                type="text"
                value={backlogName}
                onChange={(e) => setBacklogName(e.target.value)}
                placeholder="Backlog"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
            </div>
          </div>
        </section>

        {/* Other Settings Section */}
        <section className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Other Settings</h2>
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={enforceEstimates}
                onChange={(e) => setEnforceEstimates(e.target.checked)}
                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
              />
              <div>
                <span>Require estimates</span>
                <p className="text-sm text-slate-500">Components must have estimated hours before starting</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoArchiveCompleted}
                onChange={(e) => setAutoArchiveCompleted(e.target.checked)}
                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
              />
              <div>
                <span>Auto-archive completed items</span>
                <p className="text-sm text-slate-500">Automatically hide completed items after 7 days</p>
              </div>
            </label>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {success && <span className="text-emerald-400">Settings saved successfully!</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      </form>
    </div>
  );
}
