/**
 * Guest Dashboard - View project, self-assign, update status, comments, and activity.
 *
 * Guest capabilities:
 * - View project details and all components
 * - Self-assign to unassigned components
 * - Update status on assigned components
 * - Unassign self from components
 * - View and add comments on components
 * - View project activity feed
 * - Receive notifications for assignments and mentions
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGuestAuth } from '../hooks/useGuestAuth';
import {
  guestListComponents,
  guestListAssignments,
  guestAssignSelf,
  guestUnassignSelf,
  guestUpdateStatus,
  type Component as ApiComponent,
  type ComponentStatus,
} from '../api/appsync';
import {
  FolderKanban,
  Clock,
  CheckCircle2,
  AlertCircle,
  ListTodo,
  User,
  LogOut,
  Loader2,
  Plus,
  Minus,
  RefreshCw,
  Activity,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Sparkles,
  GitBranch,
} from 'lucide-react';
import { GuestNotificationBell } from '../components/GuestNotificationBell';
import { GuestActivityFeed } from '../components/GuestActivityFeed';
import { GuestCommentSection } from '../components/GuestCommentSection';
import { GuestRefineModal } from '../components/GuestRefineModal';
import { TimelineView } from '../components/TimelineView';

type ComponentType = 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
type TabType = 'tasks' | 'activity' | 'timeline';

interface DisplayComponent extends ApiComponent {
  assignedToMe?: boolean;
}

const statusConfig: Record<
  ComponentStatus,
  { label: string; color: string; bgColor: string; icon: typeof Clock }
> = {
  PLANNING: { label: 'Planning', color: 'text-violet-400', bgColor: 'bg-violet-500/10', icon: ListTodo },
  IN_PROGRESS: { label: 'In Progress', color: 'text-cyan-400', bgColor: 'bg-cyan-500/10', icon: Clock },
  BLOCKED: { label: 'Blocked', color: 'text-red-400', bgColor: 'bg-red-500/10', icon: AlertCircle },
  REVIEW: { label: 'Review', color: 'text-amber-400', bgColor: 'bg-amber-500/10', icon: CheckCircle2 },
  COMPLETED: { label: 'Completed', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', icon: CheckCircle2 },
};

const typeColors: Record<ComponentType, string> = {
  EPIC: 'bg-amber-500/20 text-amber-300',
  FEATURE: 'bg-purple-500/20 text-purple-300',
  STORY: 'bg-green-500/20 text-green-300',
  TASK: 'bg-blue-500/20 text-blue-300',
  BUG: 'bg-red-500/20 text-red-300',
};

// Status order for grouped view
const STATUS_ORDER: ComponentStatus[] = ['IN_PROGRESS', 'BLOCKED', 'REVIEW', 'PLANNING', 'COMPLETED'];

export function GuestDashboardPage() {
  const navigate = useNavigate();
  const { guestSession, clearGuestSession, isLoading: authLoading, ensureValidCredentials } = useGuestAuth();

  const [components, setComponents] = useState<DisplayComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [activeTab, setActiveTab] = useState<TabType>('tasks');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedComponent, setExpandedComponent] = useState<string | null>(null);
  const [refineComponent, setRefineComponent] = useState<DisplayComponent | null>(null);

  // Redirect if not in guest mode
  useEffect(() => {
    if (!authLoading && !guestSession) {
      navigate('/join');
    }
  }, [authLoading, guestSession, navigate]);

  // Load components and assignments
  const loadData = useCallback(async () => {
    if (!guestSession) return;

    setLoading(true);
    setError(null);

    try {
      // Ensure we have valid credentials
      await ensureValidCredentials();

      const { guestId, projectId } = guestSession;

      // Load components and assignments in parallel
      const [componentsList, assignmentsList] = await Promise.all([
        guestListComponents(guestId, projectId),
        guestListAssignments(guestId, projectId),
      ]);

      // Create a set of component IDs that are assigned to this guest
      const assignedComponentIds = new Set(
        assignmentsList.map(a => a.assignment.componentId)
      );

      // Merge assignment info into components
      const componentsWithAssignments: DisplayComponent[] = componentsList.map(c => ({
        ...c,
        assignedToMe: assignedComponentIds.has(c.id),
      }));

      setComponents(componentsWithAssignments);
    } catch (err) {
      console.error('[GuestDashboard] loadData error:', err);
      const message = err instanceof Error ? err.message : 'Failed to load components';

      if (message.includes('Unauthorized') || message.includes('Access denied') || message.includes('GuestNotFound')) {
        setError('Your session has expired. Please join again.');
        clearGuestSession();
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [guestSession, ensureValidCredentials, clearGuestSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAssignSelf = async (componentId: string) => {
    if (!guestSession) return;

    setActionLoading(componentId);
    setError(null);

    try {
      await ensureValidCredentials();
      await guestAssignSelf(guestSession.guestId, componentId);

      // Optimistic update
      setComponents(prev => prev.map(c =>
        c.id === componentId ? { ...c, assignedToMe: true } : c
      ));
    } catch (err) {
      console.error('[GuestDashboard] guestAssignSelf error:', err);
      const message = err instanceof Error ? err.message : 'Failed to assign';

      if (message.includes('AlreadyAssigned')) {
        // Already assigned, refresh to get current state
        loadData();
      } else {
        setError(message);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnassignSelf = async (componentId: string) => {
    if (!guestSession) return;

    setActionLoading(componentId);
    setError(null);

    try {
      await ensureValidCredentials();
      await guestUnassignSelf(guestSession.guestId, componentId);

      // Optimistic update
      setComponents(prev => prev.map(c =>
        c.id === componentId ? { ...c, assignedToMe: false } : c
      ));
    } catch (err) {
      console.error('[GuestDashboard] guestUnassignSelf error:', err);
      const message = err instanceof Error ? err.message : 'Failed to unassign';

      if (message.includes('NotAssigned')) {
        // Not assigned, refresh to get current state
        loadData();
      } else {
        setError(message);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateStatus = async (componentId: string, newStatus: ComponentStatus) => {
    if (!guestSession) return;

    setActionLoading(componentId);
    setError(null);

    try {
      await ensureValidCredentials();
      await guestUpdateStatus(guestSession.guestId, componentId, newStatus);

      // Optimistic update
      setComponents(prev => prev.map(c =>
        c.id === componentId ? { ...c, status: newStatus } : c
      ));
    } catch (err) {
      console.error('[GuestDashboard] guestUpdateStatus error:', err);
      const message = err instanceof Error ? err.message : 'Failed to update status';

      if (message.includes('NotAssigned')) {
        setError('You must be assigned to this component to update its status');
        loadData();
      } else {
        setError(message);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleLeave = () => {
    clearGuestSession();
    navigate('/join');
  };

  const handleRefresh = () => {
    loadData();
  };

  const toggleComponentExpand = (componentId: string) => {
    setExpandedComponent(prev => prev === componentId ? null : componentId);
  };

  const filteredComponents = filter === 'mine'
    ? components.filter(c => c.assignedToMe)
    : components;

  const myTasksCount = components.filter(c => c.assignedToMe).length;

  // Group components by status for the My Tasks view
  const groupedByStatus = STATUS_ORDER.reduce((acc, status) => {
    const statusComponents = filteredComponents.filter(c => c.status === status);
    if (statusComponents.length > 0) {
      acc[status] = statusComponents;
    }
    return acc;
  }, {} as Record<ComponentStatus, DisplayComponent[]>);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!guestSession) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center">
              <FolderKanban className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Guest Dashboard</h1>
              <p className="text-sm text-slate-400">
                Project: {guestSession.projectName || 'Project'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Notification Bell */}
            <GuestNotificationBell guestId={guestSession.guestId} />

            <div className="flex items-center gap-2 text-sm text-slate-400">
              <User className="w-4 h-4" />
              <span>{guestSession.displayName}</span>
            </div>
            <button
              onClick={handleLeave}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Leave
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="component-card">
            <div className="text-2xl font-bold text-white">{components.length}</div>
            <div className="text-sm text-slate-400">Total Components</div>
          </div>
          <div className="component-card">
            <div className="text-2xl font-bold text-cyan-400">{myTasksCount}</div>
            <div className="text-sm text-slate-400">My Tasks</div>
          </div>
          <div className="component-card">
            <div className="text-2xl font-bold text-amber-400">
              {components.filter(c => c.status === 'IN_PROGRESS' && c.assignedToMe).length}
            </div>
            <div className="text-sm text-slate-400">In Progress</div>
          </div>
          <div className="component-card">
            <div className="text-2xl font-bold text-emerald-400">
              {components.filter(c => c.status === 'COMPLETED' && c.assignedToMe).length}
            </div>
            <div className="text-sm text-slate-400">Completed</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'tasks'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <ListTodo className="w-4 h-4" />
            Tasks
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'activity'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Activity className="w-4 h-4" />
            Activity
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'timeline'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            Timeline
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-600/30 rounded-lg flex items-center justify-between">
            <p className="text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          <>
            {/* Filter */}
            <div className="flex items-center gap-2 mb-6">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                All Components
              </button>
              <button
                onClick={() => setFilter('mine')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'mine'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                My Tasks ({myTasksCount})
              </button>
            </div>

            {/* Loading */}
            {loading && (
              <div className="flex items-center gap-3 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading components...
              </div>
            )}

            {/* Empty State */}
            {!loading && filteredComponents.length === 0 && (
              <div className="component-card text-center py-12">
                <ListTodo className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-300 mb-2">
                  {filter === 'mine' ? 'No tasks assigned to you' : 'No components found'}
                </h3>
                <p className="text-slate-500">
                  {filter === 'mine'
                    ? 'Assign yourself to components to get started'
                    : 'This project has no components yet'}
                </p>
              </div>
            )}

            {/* Components List - Grouped by Status */}
            {!loading && filteredComponents.length > 0 && filter === 'mine' && (
              <div className="space-y-8">
                {STATUS_ORDER.map((status) => {
                  const statusComponents = groupedByStatus[status];
                  if (!statusComponents || statusComponents.length === 0) return null;

                  const statusInfo = statusConfig[status];
                  const StatusIcon = statusInfo.icon;

                  return (
                    <div key={status}>
                      <div className={`flex items-center gap-2 mb-4 ${statusInfo.color}`}>
                        <StatusIcon className="w-5 h-5" />
                        <h3 className="font-medium">{statusInfo.label}</h3>
                        <span className="text-sm text-slate-500">({statusComponents.length})</span>
                      </div>
                      <div className="space-y-4">
                        {statusComponents.map((component) => (
                          <ComponentCard
                            key={component.id}
                            component={component}
                            guestId={guestSession.guestId}
                            isExpanded={expandedComponent === component.id}
                            isActionLoading={actionLoading === component.id}
                            onToggleExpand={() => toggleComponentExpand(component.id)}
                            onAssign={() => handleAssignSelf(component.id)}
                            onUnassign={() => handleUnassignSelf(component.id)}
                            onUpdateStatus={(newStatus) => handleUpdateStatus(component.id, newStatus)}
                            onRefine={() => setRefineComponent(component)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Components List - Regular (All Components) */}
            {!loading && filteredComponents.length > 0 && filter === 'all' && (
              <div className="space-y-4">
                {filteredComponents.map((component) => (
                  <ComponentCard
                    key={component.id}
                    component={component}
                    guestId={guestSession.guestId}
                    isExpanded={expandedComponent === component.id}
                    isActionLoading={actionLoading === component.id}
                    onToggleExpand={() => toggleComponentExpand(component.id)}
                    onAssign={() => handleAssignSelf(component.id)}
                    onUnassign={() => handleUnassignSelf(component.id)}
                    onUpdateStatus={(newStatus) => handleUpdateStatus(component.id, newStatus)}
                    onRefine={() => setRefineComponent(component)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Activity Tab */}
        {activeTab === 'activity' && (
          <div className="component-card">
            <h3 className="text-lg font-medium text-white mb-4">Recent Activity</h3>
            <GuestActivityFeed
              guestId={guestSession.guestId}
              projectId={guestSession.projectId}
              limit={30}
            />
          </div>
        )}

        {/* Timeline Tab */}
        {activeTab === 'timeline' && (
          <div className="component-card">
            <h3 className="text-lg font-medium text-white mb-4">Project Timeline</h3>
            {loading ? (
              <div className="flex items-center gap-3 text-slate-400 py-8 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" />
                Loading timeline...
              </div>
            ) : components.length === 0 ? (
              <div className="text-center py-12">
                <GitBranch className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-300 mb-2">No components yet</h3>
                <p className="text-slate-500">Timeline will appear once components are added</p>
              </div>
            ) : (
              <TimelineView
                components={components}
                onComponentClick={(component) => {
                  setExpandedComponent(component.id);
                  setActiveTab('tasks');
                  setFilter('all');
                }}
              />
            )}
          </div>
        )}
      </main>

      {/* AI Refine Modal */}
      {refineComponent && (
        <GuestRefineModal
          guestId={guestSession.guestId}
          componentId={refineComponent.id}
          componentName={refineComponent.name}
          onClose={() => setRefineComponent(null)}
          onRefineApplied={() => {
            // Refresh data to pick up any changes
            loadData();
          }}
        />
      )}
    </div>
  );
}

// Component Card with expandable comments section
interface ComponentCardProps {
  component: DisplayComponent;
  guestId: string;
  isExpanded: boolean;
  isActionLoading: boolean;
  onToggleExpand: () => void;
  onAssign: () => void;
  onUnassign: () => void;
  onUpdateStatus: (status: ComponentStatus) => void;
  onRefine: () => void;
}

function ComponentCard({
  component,
  guestId,
  isExpanded,
  isActionLoading,
  onToggleExpand,
  onAssign,
  onUnassign,
  onUpdateStatus,
  onRefine,
}: ComponentCardProps) {
  const status = statusConfig[component.status] || statusConfig.PLANNING;
  const StatusIcon = status.icon;
  const componentType = (component.type || 'TASK') as ComponentType;

  // Check if due date is approaching or overdue
  const getDueDateClass = () => {
    if (!component.dueDate) return '';
    const dueDate = new Date(component.dueDate);
    const now = new Date();
    const diffDays = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'text-red-400'; // Overdue
    if (diffDays <= 2) return 'text-amber-400'; // Due soon
    return 'text-slate-500';
  };

  return (
    <div className="component-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-medium text-slate-200">{component.name}</h3>
            <span className={`px-1.5 py-0.5 text-xs rounded ${typeColors[componentType]}`}>
              {componentType}
            </span>
            {component.assignedToMe && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-cyan-500/20 text-cyan-300">
                Assigned to me
              </span>
            )}
          </div>

          {component.description && (
            <p className="text-sm text-slate-400 mb-3">{component.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span className={`flex items-center gap-1 ${status.color}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              {status.label}
            </span>
            {component.estimatedHours && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {component.estimatedHours}h
              </span>
            )}
            {component.dueDate && (
              <span className={`flex items-center gap-1 ${getDueDateClass()}`}>
                <Clock className="w-3.5 h-3.5" />
                Due: {new Date(component.dueDate).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {/* Assign/Unassign button */}
          {component.assignedToMe ? (
            <button
              onClick={onUnassign}
              disabled={isActionLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors disabled:opacity-50"
            >
              {isActionLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Minus className="w-3 h-3" />
              )}
              Unassign
            </button>
          ) : (
            <button
              onClick={onAssign}
              disabled={isActionLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors disabled:opacity-50"
            >
              {isActionLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              Assign me
            </button>
          )}

          {/* Status update (only for assigned components) */}
          {component.assignedToMe && component.status !== 'COMPLETED' && (
            <select
              value={component.status}
              onChange={(e) => onUpdateStatus(e.target.value as ComponentStatus)}
              disabled={isActionLoading}
              className="px-2 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded text-slate-300 disabled:opacity-50"
            >
              <option value="PLANNING">Planning</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="BLOCKED">Blocked</option>
              <option value="REVIEW">Review</option>
              <option value="COMPLETED">Completed</option>
            </select>
          )}

          {/* AI Refine (only for assigned components) */}
          {component.assignedToMe && (
            <button
              onClick={onRefine}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              AI Refine
            </button>
          )}

          {/* Comments toggle */}
          <button
            onClick={onToggleExpand}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors"
          >
            <MessageSquare className="w-3 h-3" />
            Comments
            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Expandable Comments Section */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <GuestCommentSection
            guestId={guestId}
            componentId={component.id}
          />
        </div>
      )}
    </div>
  );
}
