import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getProject,
  listComponentsByProject,
  createComponent,
  deleteProject,
  getTeamWithMembers,
  getTeamWorkflowConfig,
  type Project,
  type Component,
  type ComponentType,
  type Membership,
  type Team,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { useComponentSubscription } from '../hooks/useComponentSubscription';
import { signInWithRedirect } from 'aws-amplify/auth';
import { KanbanBoard } from '../components/KanbanBoard';
import { AIGeneratePanel } from '../components/AIGeneratePanel';
import { SmartComponentCreator } from '../components/SmartComponentCreator';
import { ComponentDetailModal } from '../components/ComponentDetailModal';
import { TimelineView } from '../components/TimelineView';
import { CumulativeFlowDiagram } from '../components/CumulativeFlowDiagram';
import { HillChart } from '../components/HillChart';
import { ShareCodeModal } from '../components/ShareCodeModal';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showSmartCreator, setShowSmartCreator] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);

  // Team and workflow state
  const [team, setTeam] = useState<Team | null>(null);
  const [teamMembers, setTeamMembers] = useState<Membership[]>([]);
  const [workflowTemplate, setWorkflowTemplate] = useState<string>('SCRUM');
  const [activeView, setActiveView] = useState<'kanban' | 'timeline' | 'cfd' | 'hill'>('kanban');

  // Filter state: 'all' | 'unassigned' | userId
  const [ownerFilter, setOwnerFilter] = useState<string>('all');

  // Share code modal
  const [showShareModal, setShowShareModal] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState<ComponentType>('TASK');

  // Real-time component subscription for multi-user updates
  const { publish } = useComponentSubscription({
    projectId: id,
    enabled: isAuthenticated,
    onCreated: useCallback((component: Component) => {
      // Avoid duplicates (in case we're the one who created it)
      setComponents((prev) =>
        prev.some((c) => c.id === component.id) ? prev : [...prev, component]
      );
    }, []),
    onUpdated: useCallback((component: Component) => {
      setComponents((prev) =>
        prev.map((c) => (c.id === component.id ? component : c))
      );
    }, []),
    onDeleted: useCallback((componentId: string) => {
      setComponents((prev) => prev.filter((c) => c.id !== componentId));
    }, []),
  });

  // Filter components by owner
  const filteredComponents = useMemo(() => {
    if (ownerFilter === 'all') return components;
    if (ownerFilter === 'unassigned') return components.filter((c) => !c.owner);
    return components.filter((c) => c.owner === ownerFilter);
  }, [components, ownerFilter]);

  useEffect(() => {
    if (!statusUpdateError) return;
    const t = setTimeout(() => setStatusUpdateError(null), 5000);
    return () => clearTimeout(t);
  }, [statusUpdateError]);

  useEffect(() => {
    if (!isAuthenticated || !id) return;

    async function fetchData() {
      try {
        const [projectData, componentsData] = await Promise.all([
          getProject(id!),
          listComponentsByProject(id!),
        ]);
        setProject(projectData);
        setComponents(componentsData);

        // Fetch team data for assignments and workflow-specific views
        if (projectData?.teamId) {
          const [teamData, workflowConfig] = await Promise.all([
            getTeamWithMembers(projectData.teamId),
            getTeamWorkflowConfig(projectData.teamId),
          ]);
          setTeam(teamData?.team ?? null);
          setTeamMembers(teamData?.members ?? []);
          setWorkflowTemplate(workflowConfig?.workflowTemplate ?? 'SCRUM');
        }
      } catch (err) {
        console.error('[ProjectDetailPage] Error loading project:', err);
        // Extract error message from various error formats
        let errorMessage = 'Failed to load project';
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (typeof err === 'object' && err !== null) {
          // Handle Amplify/GraphQL error objects
          const errObj = err as { errors?: Array<{ message: string }>; message?: string };
          if (errObj.errors && errObj.errors.length > 0) {
            errorMessage = errObj.errors.map((e) => e.message).join('; ');
          } else if (errObj.message) {
            errorMessage = errObj.message;
          } else {
            errorMessage = JSON.stringify(err);
          }
        }
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id, isAuthenticated]);

  const handleCreateComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !id) return;

    setCreating(true);
    try {
      const newComponent = await createComponent({
        id: crypto.randomUUID(),
        projectId: id,
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        type: newType,
      });
      setComponents((prev) => [...prev, newComponent]);
      // Notify other users viewing this project
      publish(newComponent.id, 'CREATED', newComponent);
      setNewName('');
      setNewDescription('');
      setNewType('TASK');
      setShowCreateForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create component');
    } finally {
      setCreating(false);
    }
  };

  const handleComponentUpdate = (updated: Component) => {
    setComponents((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    // Notify other users viewing this project
    publish(updated.id, 'UPDATED', updated);
  };

  const handleComponentDeleted = (componentId: string) => {
    setComponents((prev) => prev.filter((c) => c.id !== componentId));
    // Notify other users viewing this project
    publish(componentId, 'DELETED', null);
  };

  const handleDeleteProject = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteProject(id);
      navigate('/project', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

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
        <h1 className="text-2xl font-bold mb-6">Project</h1>
        <p className="text-slate-400 mb-4">Sign in to view this project.</p>
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
        <p className="text-slate-400">Loading project...</p>
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

  if (!project) {
    return (
      <div className="max-w-6xl mx-auto">
        <p className="text-slate-400">Project not found.</p>
        <Link to="/project" className="text-cyan-400 hover:underline">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-400 mb-1">
            <Link to="/project" className="hover:text-white">
              Projects
            </Link>
            <span>/</span>
            <span className="text-white">{project.name}</span>
          </div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {project.description && (
            <p className="text-slate-400 mt-1">{project.description}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setShowAIPanel(true);
              setShowCreateForm(false);
              setShowSmartCreator(false);
            }}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            AI Generate
          </button>
          <button
            onClick={() => {
              setShowSmartCreator(true);
              setShowAIPanel(false);
              setShowCreateForm(false);
            }}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Smart Create a Component
          </button>
          <button
            onClick={() => {
              setShowCreateForm(true);
              setShowAIPanel(false);
              setShowSmartCreator(false);
            }}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
          >
            Manual Add
          </button>
          <button
            onClick={() => setShowShareModal(true)}
            className="px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 border border-emerald-600/30 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 8A3 3 0 1 0 18 2a3 3 0 0 0 0 6zm-12 4a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
            </svg>
            Share
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300 border border-red-600/30 rounded-lg font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-white mb-2">Delete Project?</h2>
            <p className="text-slate-400 mb-6">
              This will permanently delete "{project.name}" and all its components. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAIPanel && (
        <div className="mb-6">
          <AIGeneratePanel
            projectId={id!}
            projectName={project.name}
            projectDescription={project.description}
            existingComponents={components}
            onComponentsCreated={(newComponents) => {
              setComponents((prev) => [...prev, ...newComponents]);
            }}
            onClose={() => setShowAIPanel(false)}
          />
        </div>
      )}

      {showSmartCreator && (
        <div className="mb-6">
          <SmartComponentCreator
            projectId={id!}
            onComponentCreated={(newComponent) => {
              setComponents((prev) => [...prev, newComponent]);
            }}
            onClose={() => setShowSmartCreator(false)}
          />
        </div>
      )}

      {showCreateForm && (
        <div className="mb-6 p-4 bg-slate-800 border border-slate-700 rounded-lg">
          <h2 className="text-lg font-semibold mb-4">Create Component</h2>
          <form onSubmit={handleCreateComponent} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-slate-300 mb-1"
                >
                  Name *
                </label>
                <input
                  type="text"
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="Component name"
                  disabled={creating}
                />
              </div>
              <div>
                <label
                  htmlFor="type"
                  className="block text-sm font-medium text-slate-300 mb-1"
                >
                  Type
                </label>
                <select
                  id="type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as ComponentType)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  disabled={creating}
                >
                  <option value="EPIC">Epic</option>
                  <option value="FEATURE">Feature</option>
                  <option value="STORY">Story</option>
                  <option value="TASK">Task</option>
                  <option value="BUG">Bug</option>
                </select>
              </div>
            </div>
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-slate-300 mb-1"
              >
                Description
              </label>
              <textarea
                id="description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                placeholder="Brief description"
                disabled={creating}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                disabled={creating}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedComponent && id && (
        <ComponentDetailModal
          component={selectedComponent}
          projectId={id}
          teamMembers={teamMembers}
          onClose={() => setSelectedComponent(null)}
          onUpdate={handleComponentUpdate}
          onDeleted={handleComponentDeleted}
        />
      )}

      {statusUpdateError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-600/30 rounded-lg text-red-400 text-sm">
          {statusUpdateError}
          <button
            type="button"
            onClick={() => setStatusUpdateError(null)}
            className="ml-2 text-red-300 hover:text-red-200 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter and View Controls */}
      <div className="flex items-center justify-between mb-4">
        {/* Owner Filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="ownerFilter" className="text-sm text-slate-400">
            Filter by owner:
          </label>
          <select
            id="ownerFilter"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="all">All</option>
            <option value="unassigned">Unassigned</option>
            {teamMembers.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.user?.name || member.title || member.userId}
              </option>
            ))}
          </select>
          {ownerFilter !== 'all' && (
            <button
              onClick={() => setOwnerFilter('all')}
              className="text-xs text-slate-400 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* View Switcher - Methodology-aware tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-700">
        <button
          onClick={() => setActiveView('kanban')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeView === 'kanban'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Board
        </button>
        {(workflowTemplate === 'SCRUM' || workflowTemplate === 'CUSTOM') && (
          <button
            onClick={() => setActiveView('timeline')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'timeline'
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Timeline
          </button>
        )}
        {workflowTemplate === 'KANBAN' && (
          <button
            onClick={() => setActiveView('cfd')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'cfd'
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Flow Diagram
          </button>
        )}
        {workflowTemplate === 'SHAPE_UP' && (
          <button
            onClick={() => setActiveView('hill')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeView === 'hill'
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Hill Chart
          </button>
        )}
      </div>

      {/* Conditional View Rendering */}
      {activeView === 'kanban' && (
        <KanbanBoard
          components={filteredComponents}
          onComponentClick={(component) => setSelectedComponent(component)}
          onComponentUpdate={handleComponentUpdate}
          onStatusUpdateError={(err) => setStatusUpdateError(err.message)}
          teamMembers={teamMembers}
        />
      )}

      {activeView === 'timeline' && (
        <TimelineView
          components={filteredComponents}
          onComponentClick={(component: Component) => setSelectedComponent(component)}
        />
      )}

      {activeView === 'cfd' && (
        <CumulativeFlowDiagram components={filteredComponents} />
      )}

      {activeView === 'hill' && (
        <HillChart
          components={filteredComponents}
          onComponentClick={(component: Component) => setSelectedComponent(component)}
        />
      )}

      {filteredComponents.length === 0 && !showCreateForm && !showAIPanel && !showSmartCreator && (
        <div className="text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
          <p className="text-slate-400 mb-4">
            {components.length === 0
              ? 'No components yet.'
              : `No components match the current filter.`}
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => setShowAIPanel(true)}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              Generate Full Plan
            </button>
            <button
              onClick={() => setShowSmartCreator(true)}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Smart Create a Component
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              Create Manually
            </button>
          </div>
        </div>
      )}

      {/* Share Code Modal */}
      {showShareModal && project && (
        <ShareCodeModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          projectId={project.id}
          projectName={project.name}
          teamId={team?.id || project.teamId}
          teamName={team?.name}
        />
      )}
    </div>
  );
}
