import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getTeamWithMembers,
  listProjectsByTeam,
  createProject,
  deleteTeam,
  getCurrentUserId,
  type Project,
  type Membership,
} from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import {
  ArrowLeft,
  Users,
  FolderKanban,
  Crown,
  Shield,
  User as UserIcon,
  Eye,
  Plus,
  Mail,
  Calendar,
  Zap,
  Settings,
  BarChart3,
  Trash2,
  Loader2,
} from 'lucide-react';

type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

const roleIcons: Record<TeamRole, typeof Crown> = {
  OWNER: Crown,
  ADMIN: Shield,
  MEMBER: UserIcon,
  VIEWER: Eye,
};

const roleColors: Record<TeamRole, string> = {
  OWNER: 'text-amber-400 bg-amber-500/10',
  ADMIN: 'text-violet-400 bg-violet-500/10',
  MEMBER: 'text-cyan-400 bg-cyan-500/10',
  VIEWER: 'text-slate-400 bg-slate-500/10',
};

interface TeamData {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string | null;
}

export function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [team, setTeam] = useState<TeamData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create project form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id || authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    async function loadData() {
      try {
        const [teamWithMembers, projectsList, userId] = await Promise.all([
          getTeamWithMembers(id!),
          listProjectsByTeam(id!),
          getCurrentUserId(),
        ]);
        setTeam(teamWithMembers?.team ?? null);
        setProjects(projectsList);
        setMembers(teamWithMembers?.members ?? []);
        setCurrentUserId(userId);
      } catch (err) {
        // Extract error message from various error shapes (Amplify v6, GraphQL, standard)
        let message = 'Failed to load team';
        if (err instanceof Error) {
          message = err.message;
        } else if (err && typeof err === 'object') {
          // Amplify v6 GraphQL errors have errors array
          const graphqlErr = err as { errors?: Array<{ message?: string; errorType?: string }> };
          if (graphqlErr.errors && Array.isArray(graphqlErr.errors) && graphqlErr.errors.length > 0) {
            message = graphqlErr.errors
              .map((e) => (e.errorType ? `[${e.errorType}] ${e.message || 'Unknown error'}` : e.message || 'Unknown error'))
              .join('; ');
          } else if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
            message = (err as { message: string }).message;
          } else {
            // Log the actual error structure for debugging
            console.error('Unknown error structure:', JSON.stringify(err, null, 2));
          }
        }
        setError(message);
        console.error('Team load error:', message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [id, isAuthenticated, authLoading]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !newName.trim() || !currentUserId) return;

    setCreating(true);
    setError(null);
    try {
      const project = await createProject({
        id: crypto.randomUUID(),
        teamId: id,
        ownerId: currentUserId,
        name: newName.trim(),
        description: newDesc.trim() || undefined,
      });
      setProjects((prev) => [...prev, project]);
      setNewName('');
      setNewDesc('');
      setShowCreateForm(false);
    } catch (err) {
      setError((err as Error)?.message ?? 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!id || deleteConfirmText !== team?.name) return;

    setDeleting(true);
    try {
      await deleteTeam(id);
      navigate('/team');
    } catch (err) {
      setError((err as Error)?.message ?? 'Delete failed');
      setDeleting(false);
    }
  };

  // Get current user's role
  const currentUserMember = members.find((m) => m.userId === currentUserId);
  const userRole = (currentUserMember?.role || 'MEMBER') as TeamRole;
  const isOwnerOrAdmin = userRole === 'OWNER' || userRole === 'ADMIN';
  const isOwner = userRole === 'OWNER';

  if (authLoading || loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading team...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold mb-6">Team</h1>
        <p className="text-slate-400 mb-4">Sign in to view this team.</p>
        <button onClick={() => signInWithRedirect()} className="btn-primary">
          Sign In
        </button>
      </div>
    );
  }

  if (error && !team) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to="/team"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Teams
        </Link>
        <div className="p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link
          to="/team"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Teams
        </Link>
        <p className="text-slate-400">Team not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        to="/team"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Teams
      </Link>

      {/* Team Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
            <Users className="w-8 h-8 text-violet-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">{team.name}</h1>
            {team.description && (
              <p className="text-slate-400 mt-1 max-w-2xl">{team.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                {members.length} member{members.length !== 1 ? 's' : ''}
              </span>
              <span className="flex items-center gap-1.5">
                <FolderKanban className="w-4 h-4" />
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </span>
              {team.createdAt && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  Created {new Date(team.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/team/${team.id}/sprints`}
            className="px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-300 font-medium transition-colors inline-flex items-center gap-2"
          >
            <Zap className="w-5 h-5" />
            Sprints
          </Link>
          <Link
            to={`/team/${team.id}/metrics`}
            className="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-emerald-300 font-medium transition-colors inline-flex items-center gap-2"
          >
            <BarChart3 className="w-5 h-5" />
            Metrics
          </Link>
          {isOwnerOrAdmin && (
            <Link
              to={`/team/${team.id}/workflow`}
              className="px-4 py-2.5 bg-slate-500/10 hover:bg-slate-500/20 border border-slate-500/30 rounded-xl text-slate-300 font-medium transition-colors inline-flex items-center gap-2"
            >
              <Settings className="w-5 h-5" />
              Settings
            </Link>
          )}
          <button onClick={() => setShowCreateForm(true)} className="btn-primary">
            <Plus className="w-5 h-5" />
            New Project
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateForm && (
        <div className="mb-6 component-card">
          <h3 className="text-lg font-semibold mb-4">Create New Project</h3>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label htmlFor="projectName" className="block text-sm font-medium text-slate-300 mb-1">
                Project Name *
              </label>
              <input
                id="projectName"
                type="text"
                placeholder="Enter project name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                disabled={creating}
              />
            </div>
            <div>
              <label htmlFor="projectDesc" className="block text-sm font-medium text-slate-300 mb-1">
                Description
              </label>
              <textarea
                id="projectDesc"
                placeholder="Brief description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                disabled={creating}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Create Project
                  </>
                )}
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

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Projects */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-cyan-400" />
            Projects
          </h2>

          {projects.length === 0 ? (
            <div className="component-card text-center py-12">
              <FolderKanban className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-300 mb-2">No projects yet</h3>
              <p className="text-slate-500 mb-6">Create your first project for this team</p>
              <button onClick={() => setShowCreateForm(true)} className="btn-primary">
                <Plus className="w-5 h-5" />
                Create Project
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  to={`/project/${project.id}`}
                  className="component-card block group"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-slate-100 group-hover:text-cyan-400 transition-colors">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="text-sm text-slate-400 mt-1 line-clamp-2">
                          {project.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                        <span>
                          Updated{' '}
                          {project.updatedAt
                            ? new Date(project.updatedAt).toLocaleDateString()
                            : 'recently'}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Team Members */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-5 h-5 text-violet-400" />
              Members
            </h2>
          </div>

          <div className="component-card">
            <div className="space-y-4">
              {members.map((member) => {
                const role = (member.role || 'MEMBER') as TeamRole;
                const RoleIcon = roleIcons[role];
                const displayName = member.user?.name || member.user?.email || 'Unknown User';
                const displayEmail = member.user?.email || member.userId;
                const initial = (member.user?.name?.[0] || member.user?.email?.[0] || 'U').toUpperCase();
                return (
                  <div key={member.id} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium text-white">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200 truncate">
                          {displayName}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${roleColors[role]}`}
                        >
                          <RoleIcon className="w-3 h-3" />
                          {role.toLowerCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{displayEmail}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Danger Zone - only for owner */}
          {isOwner && (
            <div className="mt-8 pt-6 border-t border-slate-700">
              <h3 className="text-sm font-medium text-red-400 mb-3">Danger Zone</h3>
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Team
                </button>
              ) : (
                <div className="p-4 bg-red-900/20 border border-red-600/30 rounded-lg space-y-3">
                  <p className="text-sm text-red-300">
                    This will permanently delete the team and all its data. Type{' '}
                    <strong>{team.name}</strong> to confirm.
                  </p>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type team name to confirm"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500"
                    disabled={deleting}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleDeleteTeam}
                      disabled={deleting || deleteConfirmText !== team.name}
                      className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-800 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {deleting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirmText('');
                      }}
                      disabled={deleting}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
