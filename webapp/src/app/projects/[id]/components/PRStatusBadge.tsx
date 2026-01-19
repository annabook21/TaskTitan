'use client';

import { Github, GitPullRequest, GitMerge, XCircle, CircleDot } from 'lucide-react';

type PRStatus = 'open' | 'draft' | 'merged' | 'closed' | null;

interface Props {
  prUrl: string;
  prNumber?: number | null;
  prTitle?: string | null;
  prStatus?: PRStatus;
  compact?: boolean; // For collapsed view
}

const statusConfig: Record<
  NonNullable<PRStatus>,
  {
    label: string;
    icon: typeof GitPullRequest;
    bgColor: string;
    textColor: string;
    borderColor: string;
  }
> = {
  open: {
    label: 'Open',
    icon: GitPullRequest,
    bgColor: 'bg-green-500/20',
    textColor: 'text-green-400',
    borderColor: 'border-green-500/30',
  },
  draft: {
    label: 'Draft',
    icon: CircleDot,
    bgColor: 'bg-slate-500/20',
    textColor: 'text-slate-400',
    borderColor: 'border-slate-500/30',
  },
  merged: {
    label: 'Merged',
    icon: GitMerge,
    bgColor: 'bg-purple-500/20',
    textColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
  },
  closed: {
    label: 'Closed',
    icon: XCircle,
    bgColor: 'bg-red-500/20',
    textColor: 'text-red-400',
    borderColor: 'border-red-500/30',
  },
};

export default function PRStatusBadge({ prUrl, prNumber, prTitle, prStatus, compact = false }: Props) {
  const status = prStatus || 'open';
  const config = statusConfig[status];
  const Icon = config.icon;

  if (compact) {
    // Compact view for collapsed card
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border transition-colors hover:opacity-80 ${config.bgColor} ${config.textColor} ${config.borderColor}`}
        title={prTitle || `PR #${prNumber}`}
      >
        <Icon className="w-3 h-3" />
        <span>#{prNumber || 'PR'}</span>
        <span className="opacity-75">{config.label}</span>
      </a>
    );
  }

  // Expanded view with more details
  return (
    <div className="space-y-1">
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80 ${config.bgColor} ${config.textColor} ${config.borderColor}`}
      >
        <Github className="w-4 h-4" />
        <span className="font-medium">PR #{prNumber || ''}</span>
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${config.bgColor}`}>
          <Icon className="w-3 h-3" />
          {config.label}
        </span>
      </a>
      {prTitle && (
        <p className="text-xs text-slate-400 pl-1 truncate max-w-[300px]" title={prTitle}>
          {prTitle}
        </p>
      )}
    </div>
  );
}
