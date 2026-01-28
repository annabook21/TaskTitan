import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { Users, Plus, FolderKanban, Crown, Shield, User as UserIcon, Eye, ArrowRight } from 'lucide-react';
import DemoTeamListPage from './DemoTeamListPage';

// DynamoDB migration imports
import { getMigrationPhase } from '@/lib/dynamodb/feature-flags';
import { getEntities } from '@/lib/dynamodb/service';

const roleIcons = {
  OWNER: Crown,
  ADMIN: Shield,
  MEMBER: UserIcon,
  VIEWER: Eye,
};

const roleColors = {
  OWNER: 'text-amber-400',
  ADMIN: 'text-violet-400',
  MEMBER: 'text-cyan-400',
  VIEWER: 'text-slate-400',
};

// Type for membership data used in the teams listing
type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

interface TeamMembershipData {
  role: TeamRole;
  Team: {
    id: string;
    name: string;
    description: string | null;
    Membership: Array<{
      User: {
        id: string;
        name: string | null;
        email: string;
      };
    }>;
    _count: {
      Membership: number;
      Project: number;
    };
  };
}

export default async function TeamPage() {
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoTeamListPage />;
  }

  const phase = getMigrationPhase('membership');
  let memberships: TeamMembershipData[];

  if (phase === 'dynamo_primary' || phase === 'dynamo_only') {
    // DynamoDB: Multiple round-trips with application-layer aggregation
    const entities = getEntities();

    // Step 1: Get user's memberships (GSI1: userId)
    const membershipsResult = await entities.membership.query.byUser({ userId }).go();

    if (membershipsResult.data.length === 0) {
      memberships = [];
    } else {
      // Sort by joinedAt desc
      const sortedMemberships = membershipsResult.data.sort(
        (a, b) => new Date(b.joinedAt || 0).getTime() - new Date(a.joinedAt || 0).getTime()
      );

      // Step 2: For each membership, fetch team data in parallel
      memberships = await Promise.all(
        sortedMemberships.map(async (membership) => {
          const teamId = membership.teamId;

          // Parallel: team details, team memberships, and project count
          const [teamResult, teamMembershipsResult, projectsResult] = await Promise.all([
            entities.team.get({ id: teamId }).go(),
            entities.membership.query.primary({ teamId }).go(),
            entities.project.query.byTeam({ teamId }).go(),
          ]);

          const team = teamResult.data;
          if (!team) {
            return null;
          }

          // Sort team memberships by joinedAt and take first 6
          const sortedTeamMembers = teamMembershipsResult.data
            .sort((a, b) => new Date(a.joinedAt || 0).getTime() - new Date(b.joinedAt || 0).getTime())
            .slice(0, 6);

          // Fetch user details for each team member
          const teamMembersWithUsers = await Promise.all(
            sortedTeamMembers.map(async (m) => {
              const userResult = await entities.user.get({ id: m.userId }).go();
              return {
                User: {
                  id: m.userId,
                  name: userResult.data?.name ?? null,
                  email: userResult.data?.email ?? 'unknown@example.com',
                },
              };
            })
          );

          return {
            role: (membership.role as TeamRole) || 'MEMBER',
            Team: {
              id: team.id,
              name: team.name,
              description: team.description ?? null,
              Membership: teamMembersWithUsers,
              _count: {
                Membership: teamMembershipsResult.data.length,
                Project: projectsResult.data.length,
              },
            },
          };
        })
      ).then((results) => results.filter((r): r is TeamMembershipData => r !== null));
    }
  } else {
    // Prisma: Nested includes with single query
    const prismaResults = await prisma.membership.findMany({
      where: { userId },
      select: {
        role: true,
        joinedAt: true,
        Team: {
          select: {
            id: true,
            name: true,
            description: true,
            Membership: {
              take: 6,
              orderBy: { joinedAt: 'asc' },
              select: {
                User: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
            _count: {
              select: {
                Membership: true,
                Project: true,
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    memberships = prismaResults.map((m) => ({
      role: m.role as TeamRole,
      Team: m.Team,
    }));
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
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
            <Link href="/team/new" className="btn-primary">
              <Plus className="w-5 h-5" />
              Create Team
            </Link>
          </div>

          {/* Teams Grid */}
          {memberships.length === 0 ? (
            <div className="component-card text-center py-16">
              <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-slate-300 mb-2">No teams yet</h2>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                Create a team to start collaborating with others on projects
              </p>
              <Link href="/team/new" className="btn-primary">
                <Plus className="w-5 h-5" />
                Create Your First Team
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {memberships.map(({ Team: team, role }, index) => {
                const RoleIcon = roleIcons[role];

                return (
                  <Link
                    key={team.id}
                    href={`/team/${team.id}`}
                    className="component-card group animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
                        <Users className="w-6 h-6 text-violet-400" />
                      </div>
                      <div className={`flex items-center gap-1.5 text-xs ${roleColors[role]}`}>
                        <RoleIcon className="w-3.5 h-3.5" />
                        {role.toLowerCase()}
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold text-slate-100 group-hover:text-violet-400 transition-colors mb-2">
                      {team.name}
                    </h3>

                    {team.description && <p className="text-sm text-slate-400 line-clamp-2 mb-4">{team.description}</p>}

                    {/* Members Avatars */}
                    <div className="flex items-center -space-x-2 mb-4">
                      {team.Membership.slice(0, 5).map(({ User: user }) => (
                        <div
                          key={user.id}
                          className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium border-2 border-slate-900"
                          title={user.name || user.email}
                        >
                          {user.name?.[0] || user.email[0].toUpperCase()}
                        </div>
                      ))}
                      {team._count.Membership > 5 && (
                        <div className="w-8 h-8 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center text-xs text-slate-400">
                          +{team._count.Membership - 5}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {team._count.Membership} member{team._count.Membership !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <FolderKanban className="w-3.5 h-3.5" />
                          {team._count.Project} project{team._count.Project !== 1 ? 's' : ''}
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
      </main>
    </div>
  );
}
