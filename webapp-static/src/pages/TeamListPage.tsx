import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { listTeamsForUser, listProjectsByTeam, type TeamWithMembers } from '../api/appsync';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import {
  Users,
  Plus,
  FolderKanban,
  Crown,
  Shield,
  User as UserIcon,
  Eye,
  ArrowRight,
} from 'lucide-react';

type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

const roleIcons: Record<TeamRole, typeof Crown> = {
  OWNER: Crown,
  ADMIN: Shield,
  MEMBER: UserIcon,
  VIEWER: Eye,
};

const roleColors: Record<TeamRole, string> = {
  OWNER: 'text-amber-400',
  ADMIN: 'text-violet-400',
  MEMBER: 'text-cyan-400',
  VIEWER: 'text-slate-400',
};

export function TeamListPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [projectCountByTeamId, setProjectCountByTeamId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    setLoading(true);
    listTeamsForUser()
      .then(async (data) => {
        setTeams(data);
        setError(null);
        const counts = await Promise.all(
          data.map(({ team }) =>
            listProjectsByTeam(team.id).then((projects) => [team.id, projects.length] as const)
          )
        );
        setProjectCountByTeamId(Object.fromEntries(counts));
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load teams');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isAuthenticated, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <Users className="w-7 h-7 text-violet-400" />
          Your Teams
        </h1>
        <div className="animate-pulse text-slate-400">Loading teams...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <Users className="w-7 h-7 text-violet-400" />
          Your Teams
        </h1>
        <p className="text-slate-400 mb-4">Sign in to view your teams.</p>
        <button
          onClick={() => signInWithRedirect()}
          className="btn-primary"
        >
          Sign In
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold flex items-center gap-3 mb-6">
          <Users className="w-7 h-7 text-violet-400" />
          Your Teams
        </h1>
        <div className="p-4 bg-red-900/30 border border-red-600/30 rounded-lg">
          <p className="text-red-400">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Users className="w-7 h-7 text-violet-400" />
            Your Teams
          </h1>
          <p className="text-slate-400 mt-1">Manage your teams and team members</p>
        </div>
        <Link to="/team/new" className="btn-primary">
          <Plus className="w-5 h-5" />
          Create Team
        </Link>
      </div>

      {/* Teams Grid */}
      {teams.length === 0 ? (
        <div className="component-card text-center py-16">
          <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-medium text-slate-300 mb-2">No teams yet</h2>
          <p className="text-slate-500 mb-6 max-w-md mx-auto">
            Create a team to start collaborating with others on projects
          </p>
          <Link to="/team/new" className="btn-primary">
            <Plus className="w-5 h-5" />
            Create Your First Team
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teams.map(({ team, members }, index) => {
            const userRole = (members[0]?.role || 'MEMBER') as TeamRole;
            const RoleIcon = roleIcons[userRole];
            const memberCount = members.length;
            const projectCount = projectCountByTeamId[team.id] ?? 0;

            return (
              <Link
                key={team.id}
                to={`/team/${team.id}`}
                className="component-card group animate-fade-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
                    <Users className="w-6 h-6 text-violet-400" />
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs ${roleColors[userRole]}`}>
                    <RoleIcon className="w-3.5 h-3.5" />
                    {userRole.toLowerCase()}
                  </div>
                </div>

                <h3 className="text-lg font-semibold text-slate-100 group-hover:text-violet-400 transition-colors mb-2">
                  {team.name}
                </h3>

                {team.description && (
                  <p className="text-sm text-slate-400 line-clamp-2 mb-4">{team.description}</p>
                )}

                {/* Members Avatars */}
                <div className="flex items-center -space-x-2 mb-4">
                  {members.slice(0, 5).map((member) => (
                    <div
                      key={member.userId}
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium border-2 border-slate-900"
                      title={member.userId}
                    >
                      {member.userId?.[0]?.toUpperCase() || 'U'}
                    </div>
                  ))}
                  {memberCount > 5 && (
                    <div className="w-8 h-8 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center text-xs text-slate-400">
                      +{memberCount - 5}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {memberCount} member{memberCount !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <FolderKanban className="w-3.5 h-3.5" />
                      {projectCount} project{projectCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-violet-400 transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
