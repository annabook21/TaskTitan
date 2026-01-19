'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateProjectGitHubSettings, updateGitHubTransitionConfig } from '@/app/projects/actions';
import { toast } from 'sonner';
import { Github, Key, Copy, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import type { ComponentStatus } from '@prisma/client';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';

type GitHubEvent = 'PR_OPENED' | 'PR_READY_FOR_REVIEW' | 'PR_APPROVED' | 'PR_MERGED' | 'PR_CLOSED';

interface TransitionConfig {
  event: GitHubEvent;
  targetStatus: ComponentStatus;
  enabled: boolean;
}

interface Props {
  projectId: string;
  currentSettings: {
    githubRepoUrl: string | null;
    githubWebhookSecret: string | null;
    githubPrTargetStatus: ComponentStatus | null;
  };
  transitionConfigs?: TransitionConfig[];
}

const eventLabels: Record<GitHubEvent, { label: string; description: string }> = {
  PR_OPENED: { label: 'PR Opened', description: 'When a pull request is created' },
  PR_READY_FOR_REVIEW: { label: 'PR Ready for Review', description: 'When a draft PR is marked ready' },
  PR_APPROVED: { label: 'PR Approved', description: 'When a PR receives approval' },
  PR_MERGED: { label: 'PR Merged', description: 'When a PR is merged into the target branch' },
  PR_CLOSED: { label: 'PR Closed', description: 'When a PR is closed without merging' },
};

const statusOptions: { value: ComponentStatus; label: string }[] = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'REVIEW', label: 'Review' },
  { value: 'COMPLETED', label: 'Completed' },
];

const defaultTransitions: TransitionConfig[] = [
  { event: 'PR_OPENED', targetStatus: 'IN_PROGRESS', enabled: true },
  { event: 'PR_READY_FOR_REVIEW', targetStatus: 'REVIEW', enabled: true },
  { event: 'PR_APPROVED', targetStatus: 'REVIEW', enabled: false },
  { event: 'PR_MERGED', targetStatus: 'COMPLETED', enabled: true },
  { event: 'PR_CLOSED', targetStatus: 'PLANNING', enabled: false },
];

export default function GitHubIntegrationSettings({ projectId, currentSettings, transitionConfigs }: Props) {
  const [repoUrl, setRepoUrl] = useState(currentSettings.githubRepoUrl || '');
  const [secret, setSecret] = useState(currentSettings.githubWebhookSecret || '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { handleResult } = useDemoActionHandler();

  // Merge provided configs with defaults
  const [transitions, setTransitions] = useState<TransitionConfig[]>(() => {
    if (!transitionConfigs || transitionConfigs.length === 0) {
      return defaultTransitions;
    }
    // Merge with defaults to ensure all events are present
    return defaultTransitions.map((defaultConfig) => {
      const existing = transitionConfigs.find((c) => c.event === defaultConfig.event);
      return existing || defaultConfig;
    });
  });

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/api/webhooks/github`
      : '/api/webhooks/github';

  const { execute: executeSettings, isExecuting: isExecutingSettings } = useAction(updateProjectGitHubSettings, {
    onSuccess: ({ data }) => {
      if (data && isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('GitHub integration updated');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update');
    },
  });

  const { execute: executeTransitions, isExecuting: isExecutingTransitions } = useAction(updateGitHubTransitionConfig, {
    onSuccess: ({ data }) => {
      if (data && isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('Transition rules updated');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update transitions');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Save basic settings
    executeSettings({
      id: projectId,
      githubRepoUrl: repoUrl || null,
      githubWebhookSecret: secret || null,
      githubPrTargetStatus:
        (transitions.find((t) => t.event === 'PR_MERGED')?.targetStatus as 'REVIEW' | 'COMPLETED' | null) || 'REVIEW',
    });

    // Save transition configs
    executeTransitions({
      projectId,
      transitions: transitions.map((t) => ({
        event: t.event,
        targetStatus: t.targetStatus,
        enabled: t.enabled,
      })),
    });
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied');
  };

  const generateSecret = () => {
    const randomSecret = crypto.randomUUID();
    setSecret(randomSecret);
    toast.success('Secret generated');
  };

  const updateTransition = (event: GitHubEvent, updates: Partial<TransitionConfig>) => {
    setTransitions((prev) => prev.map((t) => (t.event === event ? { ...t, ...updates } : t)));
  };

  const isExecuting = isExecutingSettings || isExecutingTransitions;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <Github className="w-6 h-6 text-slate-400" />
        <h3 className="text-lg font-semibold text-slate-100">GitHub PR Integration</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Repository URL */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Repository URL</label>
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1">The GitHub repository URL for this project</p>
        </div>

        {/* Webhook Secret */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Webhook Secret</label>
          <div className="flex gap-2">
            <input
              type="text"
              name="username"
              autoComplete="username"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter a secret token"
              autoComplete="current-password"
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={generateSecret}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm flex items-center gap-2 transition-colors"
              title="Generate random secret"
            >
              <Key className="w-4 h-4" />
              Generate
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Used to verify webhook requests from GitHub</p>
        </div>

        {/* Webhook URL (read-only) */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Webhook URL</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={webhookUrl}
              readOnly
              className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 cursor-default"
            />
            <button
              type="button"
              onClick={copyWebhookUrl}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
              title="Copy webhook URL"
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Configure this URL in your GitHub repository webhook settings</p>
        </div>

        {/* Status Transition Configuration */}
        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full px-4 py-3 bg-slate-800/50 flex items-center justify-between hover:bg-slate-800 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <Zap className="w-4 h-4 text-amber-400" />
              Status Transition Rules
            </span>
            {showAdvanced ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showAdvanced && (
            <div className="p-4 space-y-3 border-t border-slate-700">
              <p className="text-xs text-slate-500 mb-4">
                Configure which component status to set when GitHub events occur on linked PRs.
              </p>

              {transitions.map((transition) => (
                <div
                  key={transition.event}
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                    transition.enabled
                      ? 'bg-slate-800/50 border-slate-700'
                      : 'bg-slate-900/50 border-slate-800 opacity-60'
                  }`}
                >
                  {/* Enable checkbox */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={transition.enabled}
                      onChange={(e) => updateTransition(transition.event, { enabled: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                    />
                  </label>

                  {/* Event label */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200">{eventLabels[transition.event].label}</div>
                    <div className="text-xs text-slate-500 truncate">{eventLabels[transition.event].description}</div>
                  </div>

                  {/* Arrow */}
                  <span className="text-slate-500">→</span>

                  {/* Status dropdown */}
                  <select
                    value={transition.targetStatus}
                    onChange={(e) =>
                      updateTransition(transition.event, { targetStatus: e.target.value as ComponentStatus })
                    }
                    disabled={!transition.enabled}
                    className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Setup Instructions */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <h4 className="text-sm font-medium text-slate-300 mb-2">Setup Instructions</h4>
          <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
            <li>Generate a webhook secret above</li>
            <li>Go to your GitHub repository Settings → Webhooks</li>
            <li>Click &quot;Add webhook&quot;</li>
            <li>Paste the webhook URL above</li>
            <li>Set Content type to &quot;application/json&quot;</li>
            <li>Paste the secret</li>
            <li>Select &quot;Pull requests&quot; and &quot;Pull request reviews&quot; events</li>
            <li>Save the webhook</li>
            <li>
              Reference components in PR title/body with #COMP-{'{'} componentId{'}'}
            </li>
          </ol>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isExecuting}
          className="w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg font-medium transition-colors"
        >
          {isExecuting ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
