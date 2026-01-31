import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  listAssignmentsForUser,
  type AssignmentWithComponent,
  type ComponentStatus,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ListTodo,
  Calendar,
  ArrowRight,
  Loader2,
  LayoutGrid,
  List,
} from 'lucide-react';

const STATUS_ORDER: ComponentStatus[] = [
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'PLANNING',
  'COMPLETED',
];

const statusConfig: Record<
  ComponentStatus,
  { label: string; color: string; bgColor: string; icon: typeof Clock }
> = {
  IN_PROGRESS: {
    label: 'In Progress',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    icon: Clock,
  },
  PLANNING: {
    label: 'Planning',
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    icon: ListTodo,
  },
  BLOCKED: {
    label: 'Blocked',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    icon: AlertCircle,
  },
  REVIEW: {
    label: 'Review',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    icon: CheckCircle2,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    icon: CheckCircle2,
  },
};

const typeColors: Record<string, string> = {
  EPIC: 'bg-amber-500/20 text-amber-300',
  FEATURE: 'bg-purple-500/20 text-purple-300',
  STORY: 'bg-green-500/20 text-green-300',
  TASK: 'bg-blue-500/20 text-blue-300',
  BUG: 'bg-red-500/20 text-red-300',
};

export function MyTasksPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [assignments, setAssignments] = useState<AssignmentWithComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grouped' | 'board'>('grouped');

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const data = await listAssignmentsForUser();
        setAssignments(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tasks');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [isAuthenticated, authLoading]);

  const getTasksByStatus = (status: ComponentStatus) => {
    return assignments.filter((a) => a.component.status === status);
  };

  // Group tasks by status
  const tasksByStatus = {
    IN_PROGRESS: getTasksByStatus('IN_PROGRESS'),
    PLANNING: getTasksByStatus('PLANNING'),
    BLOCKED: getTasksByStatus('BLOCKED'),
    REVIEW: getTasksByStatus('REVIEW'),
    COMPLETED: getTasksByStatus('COMPLETED'),
  };

  if (authLoading || loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-2">My Tasks</h1>
        <div className="flex items-center gap-3 text-slate-400 mt-4">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading your tasks...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-2">My Tasks</h1>
        <p className="text-slate-400 mb-4">Sign in to view your tasks.</p>
        <button onClick={() => signInWithRedirect()} className="btn-primary">
          Sign In
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-2">My Tasks</h1>
        <div className="mt-4 p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">My Tasks</h1>
          <p className="text-slate-400 mt-1">
            All work items assigned to you across projects
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grouped')}
            className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
              viewMode === 'grouped'
                ? 'bg-cyan-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <List className="w-4 h-4" />
            List
          </button>
          <button
            onClick={() => setViewMode('board')}
            className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
              viewMode === 'board'
                ? 'bg-cyan-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Board
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {STATUS_ORDER.map((status) => {
          const config = statusConfig[status];
          const Icon = config.icon;
          const count = tasksByStatus[status].length;
          return (
            <div key={status} className="component-card">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${config.color}`} />
                <span className="text-sm text-slate-400">{config.label}</span>
              </div>
              <div className={`text-2xl font-bold ${config.color}`}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {assignments.length === 0 && (
        <div className="component-card text-center py-16">
          <ListTodo className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-slate-300 mb-2">
            No tasks assigned
          </h2>
          <p className="text-slate-500">
            You don't have any work items assigned to you yet.
          </p>
        </div>
      )}

      {/* Content */}
      {assignments.length > 0 && viewMode === 'grouped' && (
        <div className="space-y-8">
          {STATUS_ORDER.map((status) => {
            const statusTasks = tasksByStatus[status];
            if (statusTasks.length === 0) return null;
            const config = statusConfig[status];
            const Icon = config.icon;

            return (
              <div key={status}>
                <h2
                  className={`text-lg font-semibold mb-4 flex items-center gap-2 ${config.color}`}
                >
                  <Icon className="w-5 h-5" />
                  {config.label}
                  <span className="text-slate-500 font-normal">
                    ({statusTasks.length})
                  </span>
                </h2>
                <div className="grid gap-4">
                  {statusTasks.map(({ component }) => (
                    <Link
                      key={component.id}
                      to={`/project/${component.projectId}`}
                      className="component-card hover:border-cyan-500/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-slate-200 truncate">
                              {component.name}
                            </h3>
                            <span
                              className={`px-1.5 py-0.5 text-xs rounded ${
                                typeColors[component.type] || 'bg-slate-500/20 text-slate-300'
                              }`}
                            >
                              {component.type}
                            </span>
                          </div>
                          {component.description && (
                            <p className="text-sm text-slate-400 line-clamp-2 mb-3">
                              {component.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              {component.estimatedHours
                                ? `${component.estimatedHours}h`
                                : 'No estimate'}
                            </span>
                            {component.dueDate && (
                              <span
                                className={`flex items-center gap-1 ${
                                  new Date(component.dueDate) < new Date()
                                    ? 'text-red-400'
                                    : ''
                                }`}
                              >
                                <Calendar className="w-3.5 h-3.5" />
                                {new Date(component.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0 mt-1" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Board View */}
      {assignments.length > 0 && viewMode === 'board' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUS_ORDER.map((status) => {
            const statusTasks = tasksByStatus[status];
            const config = statusConfig[status];
            const Icon = config.icon;

            return (
              <div
                key={status}
                className="flex-shrink-0 w-72 bg-slate-900 rounded-lg border border-slate-800"
              >
                <div className="p-3 border-b border-slate-800">
                  <div className="flex items-center justify-between">
                    <h3 className={`font-medium flex items-center gap-2 ${config.color}`}>
                      <Icon className="w-4 h-4" />
                      {config.label}
                    </h3>
                    <span className="text-sm text-slate-500">
                      {statusTasks.length}
                    </span>
                  </div>
                </div>
                <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-400px)] overflow-y-auto">
                  {statusTasks.map(({ component }) => (
                    <Link
                      key={component.id}
                      to={`/project/${component.projectId}`}
                      className="block p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-cyan-500/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`px-1.5 py-0.5 text-xs rounded ${
                            typeColors[component.type] || 'bg-slate-500/20 text-slate-300'
                          }`}
                        >
                          {component.type}
                        </span>
                      </div>
                      <h4 className="font-medium text-sm text-slate-200 line-clamp-2 mb-2">
                        {component.name}
                      </h4>
                      {component.estimatedHours && (
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="w-3 h-3" />
                          {component.estimatedHours}h
                        </div>
                      )}
                    </Link>
                  ))}
                  {statusTasks.length === 0 && (
                    <div className="text-center py-8 text-slate-600 text-sm">
                      No tasks
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
