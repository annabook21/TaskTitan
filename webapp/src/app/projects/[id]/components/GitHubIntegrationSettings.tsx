'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateProjectGitHubSettings } from '@/app/projects/actions';
import { toast } from 'sonner';
import { Github, Key, Copy } from 'lucide-react';
import type { ComponentStatus } from '@prisma/client';

interface Props {
  projectId: string;
  currentSettings: {
    githubRepoUrl: string | null;
    githubWebhookSecret: string | null;
    githubPrTargetStatus: ComponentStatus | null;
  };
}

export default function GitHubIntegrationSettings({ projectId, currentSettings }: Props) {
  const [repoUrl, setRepoUrl] = useState(currentSettings.githubRepoUrl || '');
  const [secret, setSecret] = useState(currentSettings.githubWebhookSecret || '');
  const [targetStatus, setTargetStatus] = useState<'REVIEW' | 'COMPLETED'>(
    currentSettings.githubPrTargetStatus === 'REVIEW' || currentSettings.githubPrTargetStatus === 'COMPLETED'
      ? currentSettings.githubPrTargetStatus
      : 'REVIEW',
  );

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/api/webhooks/github`
      : '/api/webhooks/github';

  const { execute, isExecuting } = useAction(updateProjectGitHubSettings, {
    onSuccess: () => {
      toast.success('GitHub integration updated');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    execute({
      id: projectId,
      githubRepoUrl: repoUrl || null,
      githubWebhookSecret: secret || null,
      githubPrTargetStatus: targetStatus,
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
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter a secret token"
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

        {/* Target Status */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Status on PR Merge</label>
          <select
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value as 'REVIEW' | 'COMPLETED')}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
          >
            <option value="REVIEW">Review</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <p className="text-xs text-slate-500 mt-1">Status to set when a PR is merged</p>
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
            <li>Select &quot;Pull requests&quot; event</li>
            <li>Save the webhook</li>
            <li>Reference components in PR title/body with #COMP-{'{'} componentId{'}'}</li>
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
