import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getSprintWithComponents,
  getTeam,
  startSprint,
  completeSprint,
  deleteSprint,
  removeComponentFromSprint,
  listProjectsByTeam,
  listComponentsByProject,
  type Sprint,
  type Component,
  type Team,
  type ComponentStatus,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import { ComponentCard } from '../components/ComponentCard';
import { AISprintPlanner } from '../components/AISprintPlanner';

const statusColors: Record<string, string> = {
  PLANNING: 'bg-slate-600',
  ACTIVE: 'bg-blue-600',
  COMPLETED: 'bg-green-600',
  CANCELLED: 'bg-red-600',
};

const COMPONENT_STATUSES: { key: ComponentStatus; label: string }[] = [
  { key: 'PLANNING', label: 'Planning' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'REVIEW', label: 'Review' },
  { key: 'COMPLETED', label: 'Completed' },
];

export function SprintDetailPage() {
  const { id: teamId, sprintId } = useParams<{ id: string; sprintId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [backlogComponents, setBacklogComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !teamId || !sprintId) return;

    async function fetchData() {
      try {
        const [teamData, sprintData] = await Promise.all([
          getTeam(teamId!),
          getSprintWithComponents(sprintId!),
        ]);
        setTeam(teamData);
        if (sprintData) {
          setSprint(sprintData.sprint);
          setComponents(sprintData.components);
        }

        // Fetch backlog components for AI planner
        // Get all projects for this team, then get components not in any sprint
        const projects = await listProjectsByTeam(teamId!);
        const allComponentPromises = projects.map((p) => listComponentsByProject(p.id));
        const allComponentArrays = await Promise.all(allComponentPromises);
        const allComponents = allComponentArrays.flat();
        // Filter to only components not assigned to any sprint
        const backlog = allComponents.filter((c) => !c.sprintId);
        setBacklogComponents(backlog);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sprint');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [teamId, sprintId, isAuthenticated]);

  // Handle when AI assigns components to sprint
  const handleComponentsAssigned = async (componentIds: string[]) => {
    // Find the newly assigned components from backlog
    const newlyAssigned = backlogComponents.filter((c) => componentIds.includes(c.id));
    // Add them to sprint components
    setComponents((prev) => [...prev, ...newlyAssigned.map((c) => ({ ...c, sprintId }))]);
    // Remove them from backlog
    setBacklogComponents((prev) => prev.filter((c) => !componentIds.includes(c.id)));
  };

  const handleStartSprint = async () => {
    if (!sprintId) return;
    setActionLoading(true);
    try {
      const updated = await startSprint(sprintId);
      setSprint(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sprint');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteSprint = async () => {
    if (!sprintId) return;
    setActionLoading(true);
    try {
      const updated = await completeSprint(sprintId);
      setSprint(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete sprint');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSprint = async () => {
    if (!sprintId || !confirm('Are you sure you want to delete this sprint?')) return;
    setActionLoading(true);
    try {
      await deleteSprint(sprintId);
      navigate(`/team/${teamId}/sprints`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sprint');
      setActionLoading(false);
    }
  };

  const handleRemoveComponent = async (componentId: string) => {
    try {
      await removeComponentFromSprint(componentId);
      setComponents((prev) => prev.filter((c) => c.id !== componentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove component');
    }
  };

  const getComponentsByStatus = (status: ComponentStatus) => {
    return components.filter((c) => c.status === status);
  };

  // Calculate sprint metrics
  const totalEstimatedHours = components.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
  const completedCount = components.filter((c) => c.status === 'COMPLETED').length;
  const completionRate = components.length > 0 ? Math.round((completedCount / components.length) * 100) : 0;

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Sprint</h1>
        <p className="text-slate-400 mb-4">Sign in to view this sprint.</p>
        <button
          onClick={() => signInWithRedirect()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium"
        >
          Sign In
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <p className="text-slate-400">Loading sprint...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="max-w-6xl mx-auto">
        <p className="text-slate-400">Sprint not found.</p>
        <Link to={`/team/${teamId}/sprints`} className="text-cyan-400 hover:underline">
          Back to Sprints
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-400 mb-1">
            <Link to="/team" className="hover:text-white">Teams</Link>
            <span>/</span>
            <Link to={`/team/${teamId}`} className="hover:text-white">{team?.name || 'Team'}</Link>
            <span>/</span>
            <Link to={`/team/${teamId}/sprints`} className="hover:text-white">Sprints</Link>
            <span>/</span>
            <span className="text-white">{sprint.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{sprint.name}</h1>
            <span className={`text-sm px-2 py-0.5 rounded text-white ${statusColors[sprint.status]}`}>
              {sprint.status}
            </span>
          </div>
          {sprint.goal && <p className="text-slate-400 mt-1">{sprint.goal}</p>}
          {(sprint.startDate || sprint.endDate) && (
            <p className="text-sm text-slate-500 mt-1">
              {sprint.startDate && new Date(sprint.startDate).toLocaleDateString()}
              {sprint.startDate && sprint.endDate && ' - '}
              {sprint.endDate && new Date(sprint.endDate).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {sprint.status === 'PLANNING' && (
            <>
              <button
                onClick={handleStartSprint}
                disabled={actionLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-lg font-medium"
              >
                {actionLoading ? 'Starting...' : 'Start Sprint'}
              </button>
              <button
                onClick={handleDeleteSprint}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 text-white rounded-lg font-medium"
              >
                Delete
              </button>
            </>
          )}
          {sprint.status === 'ACTIVE' && (
            <button
              onClick={handleCompleteSprint}
              disabled={actionLoading}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 text-white rounded-lg font-medium"
            >
              {actionLoading ? 'Completing...' : 'Complete Sprint'}
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-white">{components.length}</div>
          <div className="text-sm text-slate-400">Total Items</div>
        </div>
        <div className="p-4 bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-white">{completedCount}</div>
          <div className="text-sm text-slate-400">Completed</div>
        </div>
        <div className="p-4 bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-white">{completionRate}%</div>
          <div className="text-sm text-slate-400">Progress</div>
        </div>
        <div className="p-4 bg-slate-800 rounded-lg">
          <div className="text-2xl font-bold text-white">{totalEstimatedHours}h</div>
          <div className="text-sm text-slate-400">Estimated Hours</div>
        </div>
      </div>

      {/* AI Sprint Planner - only show for PLANNING sprints with backlog items */}
      {sprint.status === 'PLANNING' && backlogComponents.length > 0 && (
        <div className="mb-6">
          <AISprintPlanner
            teamId={teamId!}
            sprintId={sprintId!}
            components={backlogComponents}
            onComponentsAssigned={handleComponentsAssigned}
          />
        </div>
      )}

      {/* Sprint Board */}
      {components.length === 0 ? (
        <div className="text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
          <p className="text-slate-400 mb-2">No components assigned to this sprint.</p>
          <p className="text-sm text-slate-500">
            Assign components from the project Kanban board.
          </p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COMPONENT_STATUSES.map((status) => {
            const statusComponents = getComponentsByStatus(status.key);
            return (
              <div
                key={status.key}
                className="flex-shrink-0 w-64 bg-slate-900 rounded-lg"
              >
                <div className="p-3 border-b border-slate-800">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-slate-300">{status.label}</h3>
                    <span className="text-sm text-slate-500">{statusComponents.length}</span>
                  </div>
                </div>
                <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-450px)] overflow-y-auto">
                  {statusComponents.map((component) => (
                    <div key={component.id} className="relative group">
                      <ComponentCard
                        component={component}
                        onClick={() => {
                          // TODO: Open component detail modal
                          console.log('Component clicked:', component);
                        }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveComponent(component.id);
                        }}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition-opacity"
                        title="Remove from sprint"
                      >
                        x
                      </button>
                    </div>
                  ))}
                  {statusComponents.length === 0 && (
                    <div className="text-center py-4 text-slate-600 text-sm">
                      No items
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
