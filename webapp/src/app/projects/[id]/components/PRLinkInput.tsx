'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { Link2, X, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { linkComponentToPR } from '@/app/projects/actions/component-github';
import { useDemoActionHandler, isDemoResult } from '@/hooks/use-demo-action';

interface Props {
  componentId: string;
  currentPrUrl?: string | null;
  onLinked?: () => void;
}

/**
 * Validates and parses a GitHub PR URL
 * Returns { owner, repo, prNumber } or null if invalid
 */
export function parseGitHubPrUrl(url: string): { owner: string; repo: string; prNumber: number } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;

    // Expected format: /owner/repo/pull/123
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;

    return {
      owner: match[1],
      repo: match[2],
      prNumber: parseInt(match[3], 10),
    };
  } catch {
    return null;
  }
}

export default function PRLinkInput({ componentId, currentPrUrl, onLinked }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [url, setUrl] = useState('');
  const { handleResult } = useDemoActionHandler();

  const { execute, isExecuting } = useAction(linkComponentToPR, {
    onSuccess: ({ data }) => {
      if (data && isDemoResult(data)) {
        handleResult(data);
      }
      toast.success('PR linked successfully');
      setIsEditing(false);
      setUrl('');
      onLinked?.();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to link PR');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setIsEditing(false);
      return;
    }

    const parsed = parseGitHubPrUrl(url.trim());
    if (!parsed) {
      toast.error('Invalid GitHub PR URL', {
        description: 'Expected format: https://github.com/owner/repo/pull/123',
      });
      return;
    }

    execute({
      componentId,
      prUrl: url.trim(),
      prNumber: parsed.prNumber,
    });
  };

  const handleUnlink = () => {
    execute({
      componentId,
      prUrl: null,
      prNumber: null,
    });
  };

  // If already linked, show the link with option to unlink
  if (currentPrUrl && !isEditing) {
    const parsed = parseGitHubPrUrl(currentPrUrl);
    return (
      <div className="flex items-center gap-2">
        <a
          href={currentPrUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition-colors"
        >
          <Link2 className="w-3.5 h-3.5" />
          PR #{parsed?.prNumber || 'linked'}
        </a>
        <button
          onClick={handleUnlink}
          disabled={isExecuting}
          className="text-xs text-slate-500 hover:text-red-400 transition-colors"
          title="Unlink PR"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Editing mode
  if (isEditing) {
    return (
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/pull/123"
          className="flex-1 px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          autoFocus
          disabled={isExecuting}
        />
        <button
          type="submit"
          disabled={isExecuting}
          className="p-1 text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
        >
          {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsEditing(false);
            setUrl('');
          }}
          disabled={isExecuting}
          className="p-1 text-slate-500 hover:text-slate-300"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  }

  // Default: show link button
  return (
    <button
      onClick={() => setIsEditing(true)}
      className="text-xs text-slate-400 hover:text-cyan-400 flex items-center gap-1.5 transition-colors"
    >
      <Link2 className="w-3.5 h-3.5" />
      Link PR
    </button>
  );
}
