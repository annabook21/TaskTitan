/**
 * Member Workload Modal - Shows all tasks assigned to a specific team member.
 * 
 * Used by team owners/admins to view workload distribution across the team.
 * Uses the listAssignmentsForTeamMember query to fetch data.
 */

import { useState, useEffect } from 'react';
import { X, Loader2, Clock, CheckCircle2, AlertCircle, ListTodo, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

type ComponentStatus = 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';
type ComponentType = 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';

interface Component {
  id: string;
  name: string;
  description?: string | null;
  type: ComponentType;
  status: ComponentStatus;
  projectId: string;
  estimatedHours?: number | null;
}

interface AssignmentWithComponent {
  assignment: {
    id: string;
    componentId: string;
    userId: string;
    assignedAt: string;
  };
  component: Component;
}

interface MemberWorkloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  userId: string;
  userName: string;
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

const STATUS_ORDER: ComponentStatus[] = ['IN_PROGRESS', 'BLOCKED', 'REVIEW', 'PLANNING', 'COMPLETED'];

export function MemberWorkloadModal({ 
  isOpen, 
  onClose, 
  teamId, 
  userId, 
  userName 
}: MemberWorkloadModalProps) {
  const [assignments, setAssignments] = useState<AssignmentWithComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    async function loadAssignments() {
      setLoading(true);
      setError(null);
      
      try {
        // TODO: Call listAssignmentsForTeamMember API
        // For now, use mock data
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const mockAssignments: AssignmentWithComponent[] = [
          {
            assignment: { id: '1', componentId: 'c1', userId, assignedAt: new Date().toISOString() },
            component: { id: 'c1', name: 'User Authentication', type: 'FEATURE', status: 'IN_PROGRESS', projectId: 'p1', estimatedHours: 8 },
          },
          {
            assignment: { id: '2', componentId: 'c2', userId, assignedAt: new Date().toISOString() },
            component: { id: 'c2', name: 'Fix Login Bug', type: 'BUG', status: 'BLOCKED', projectId: 'p1', estimatedHours: 2 },
          },
          {
            assignment: { id: '3', componentId: 'c3', userId, assignedAt: new Date().toISOString() },
            component: { id: 'c3', name: 'Dashboard UI', type: 'STORY', status: 'COMPLETED', projectId: 'p1', estimatedHours: 6 },
          },
        ];
        
        setAssignments(mockAssignments);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load assignments');
      } finally {
        setLoading(false);
      }
    }

    loadAssignments();
  }, [isOpen, teamId, userId]);

  if (!isOpen) return null;

  // Group by status
  const byStatus = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = assignments.filter(a => a.component.status === status);
    return acc;
  }, {} as Record<ComponentStatus, AssignmentWithComponent[]>);

  // Calculate stats
  const totalHours = assignments.reduce((sum, a) => sum + (a.component.estimatedHours || 0), 0);
  const completedCount = byStatus.COMPLETED?.length || 0;
  const inProgressCount = byStatus.IN_PROGRESS?.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-2xl border border-slate-800 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-semibold text-white">{userName}'s Workload</h2>
            <p className="text-sm text-slate-400">
              {assignments.length} task{assignments.length !== 1 ? 's' : ''} assigned
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 px-6 py-4 border-b border-slate-800 bg-slate-800/30">
          <div className="text-center">
            <div className="text-2xl font-bold text-white">{assignments.length}</div>
            <div className="text-xs text-slate-400">Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-cyan-400">{inProgressCount}</div>
            <div className="text-xs text-slate-400">In Progress</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-400">{completedCount}</div>
            <div className="text-xs text-slate-400">Completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-400">{totalHours}h</div>
            <div className="text-xs text-slate-400">Estimated</div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {!loading && !error && assignments.length === 0 && (
            <div className="text-center py-12">
              <ListTodo className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">No tasks assigned</h3>
              <p className="text-slate-500">This team member has no assigned work items.</p>
            </div>
          )}

          {!loading && !error && assignments.length > 0 && (
            <div className="space-y-6">
              {STATUS_ORDER.map(status => {
                const items = byStatus[status];
                if (!items || items.length === 0) return null;

                const config = statusConfig[status];
                const StatusIcon = config.icon;

                return (
                  <div key={status}>
                    <h3 className={`text-sm font-medium mb-3 flex items-center gap-2 ${config.color}`}>
                      <StatusIcon className="w-4 h-4" />
                      {config.label}
                      <span className="text-slate-500">({items.length})</span>
                    </h3>
                    <div className="space-y-2">
                      {items.map(({ component }) => (
                        <Link
                          key={component.id}
                          to={`/project/${component.projectId}`}
                          onClick={onClose}
                          className="flex items-center justify-between p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700/50 transition-colors group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-200 truncate group-hover:text-cyan-400 transition-colors">
                                {component.name}
                              </span>
                              <span className={`px-1.5 py-0.5 text-xs rounded ${typeColors[component.type]}`}>
                                {component.type}
                              </span>
                            </div>
                            {component.estimatedHours && (
                              <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                                <Clock className="w-3 h-3" />
                                {component.estimatedHours}h estimated
                              </div>
                            )}
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 flex-shrink-0" />
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-800/30">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
