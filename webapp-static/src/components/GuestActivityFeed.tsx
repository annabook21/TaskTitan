import { useState, useEffect } from 'react';
import { guestListActivityFeed, type ActivityWithAuthor, type ActivityType } from '../api/appsync';
import { Loader2, Activity } from 'lucide-react';

interface GuestActivityFeedProps {
  guestId: string;
  projectId: string;
  limit?: number;
}

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  PROJECT_CREATED: 'created the project',
  COMPONENT_CREATED: 'created a component',
  COMPONENT_UPDATED: 'updated a component',
  COMPONENT_STATUS_CHANGED: 'changed component status',
  DEPENDENCY_ADDED: 'added a dependency',
  DEPENDENCY_REMOVED: 'removed a dependency',
  MEMBER_ASSIGNED: 'assigned a member',
  MEMBER_UNASSIGNED: 'unassigned a member',
  COMMENT_ADDED: 'added a comment',
  SPRINT_CREATED: 'created a sprint',
  SPRINT_STARTED: 'started a sprint',
  SPRINT_COMPLETED: 'completed a sprint',
  COMPONENT_ADDED_TO_SPRINT: 'added component to sprint',
  COMPONENT_REMOVED_FROM_SPRINT: 'removed component from sprint',
  GITHUB_PR_OPENED: 'opened a pull request',
  GITHUB_PR_MERGED: 'merged a pull request',
  GITHUB_PR_CLOSED: 'closed a pull request',
  GITHUB_PR_LINKED: 'linked a pull request',
};

const ACTIVITY_ICONS: Record<ActivityType, string> = {
  PROJECT_CREATED: '+',
  COMPONENT_CREATED: '+',
  COMPONENT_UPDATED: '~',
  COMPONENT_STATUS_CHANGED: '~',
  DEPENDENCY_ADDED: '~',
  DEPENDENCY_REMOVED: '-',
  MEMBER_ASSIGNED: '+',
  MEMBER_UNASSIGNED: '-',
  COMMENT_ADDED: '+',
  SPRINT_CREATED: '+',
  SPRINT_STARTED: '>',
  SPRINT_COMPLETED: 'v',
  COMPONENT_ADDED_TO_SPRINT: '+',
  COMPONENT_REMOVED_FROM_SPRINT: '-',
  GITHUB_PR_OPENED: '+',
  GITHUB_PR_MERGED: 'v',
  GITHUB_PR_CLOSED: 'x',
  GITHUB_PR_LINKED: '~',
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function GuestActivityFeed({ guestId, projectId, limit = 20 }: GuestActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivities();
  }, [guestId, projectId, limit]);

  const loadActivities = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await guestListActivityFeed(guestId, projectId, limit);
      setActivities(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activities');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={loadActivities}
          className="mt-2 text-xs text-cyan-400 hover:text-cyan-300"
        >
          Retry
        </button>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-500">
        <Activity className="w-8 h-8 mb-2" />
        <p className="text-sm">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div
          key={activity.id}
          className="flex items-start gap-3 text-sm"
        >
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs text-slate-400">
            {ACTIVITY_ICONS[activity.type] || '~'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-slate-300">
              <span className="font-medium text-slate-200">
                {activity.authorName || 'Someone'}
              </span>
              {activity.authorType === 'GUEST' && (
                <span className="ml-1 text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
                  Guest
                </span>
              )}{' '}
              {ACTIVITY_LABELS[activity.type] || 'performed an action'}
            </p>
            <p className="text-slate-500 text-xs">
              {formatRelativeTime(activity.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
