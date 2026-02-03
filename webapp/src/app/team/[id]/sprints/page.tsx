import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Target,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  PauseCircle,
  Plus,
  ChevronRight,
  Zap,
} from 'lucide-react';
import DemoSprintsPage from './DemoSprintsPage';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

interface Props {
  params: Promise<{ id: string }>;
}

type SprintStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

const statusConfig = {
  PLANNING: {
    label: 'Planning',
    color: 'text-slate-400 bg-slate-500/10',
    icon: PauseCircle,
  },
  ACTIVE: {
    label: 'Active',
    color: 'text-green-400 bg-green-500/10',
    icon: PlayCircle,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-cyan-400 bg-cyan-500/10',
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-red-400 bg-red-500/10',
    icon: XCircle,
  },
};

export default async function SprintsPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoSprintsPage />;
  }

  const entities = getEntities();

  // Verify user has access to this team
  const access = await verifyTeamMembership(userId, id);
  if (!access) {
    notFound();
  }

  // Get team details
  const teamResult = await entities.team.get({ id }).go();
  const team = teamResult.data;
  if (!team) {
    notFound();
  }

  // Get sprints, workflow config in parallel
  const [sprintsResult, workflowConfigResult] = await Promise.all([
    entities.sprint.query.byTeam({ teamId: id }).go(),
    entities.teamWorkflowConfig.get({ teamId: id }).go(),
  ]);

  // Sort sprints by startDate desc
  const sortedSprints = sprintsResult.data.sort(
    (a, b) => new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime(),
  );

  // For each sprint, get component counts and details
  // First get all projects for this team
  const projectsResult = await entities.project.query.byTeam({ teamId: id }).go();
  const projectIds = projectsResult.data.map((p) => p.id);

  // Get all components for all projects
  const componentResults = await Promise.all(
    projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go()),
  );
  const allComponents = componentResults.flatMap((r) => r.data);

  // Build sprint data with component counts
  const sprintsWithData = sortedSprints.map((sprint) => {
    const sprintComponents = allComponents.filter((c) => c.sprintId === sprint.id);
    return {
      id: sprint.id,
      name: sprint.name,
      goal: (sprint as any).goal ?? null,
      status: ((sprint as any).status || 'PLANNING') as SprintStatus,
      startDate: new Date(sprint.startDate),
      endDate: new Date(sprint.endDate),
      capacity: (sprint as any).capacity ?? null,
      _count: { Component: sprintComponents.length },
      Component: sprintComponents.map((c) => ({
        status: c.status,
        estimatedHours: (c as any).estimatedHours ?? null,
      })),
    };
  });

  const currentUserRole = access.membership.role;
  const canManageSprints = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN';

  // Get workflow terminology
  const cycleName = workflowConfigResult.data?.cycleName || 'Sprint';
  const cycleNameLower = cycleName.toLowerCase();
  const cycleNamePlural = `${cycleName}s`;

  // Separate sprints by status
  const activeSprint = sprintsWithData.find((s) => s.status === 'ACTIVE');
  const planningSprints = sprintsWithData.filter((s) => s.status === 'PLANNING');
  const completedSprints = sprintsWithData.filter((s) => s.status === 'COMPLETED');

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${id}`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to {team.name}
          </Link>

          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Zap className="w-8 h-8 text-amber-400" />
                {cycleNamePlural}
              </h1>
              <p className="text-slate-400 mt-1">Plan and track work in timeboxed {cycleNameLower}s</p>
            </div>

            {canManageSprints && (
              <Link href={`/team/${id}/sprints/new`} className="btn-primary">
                <Plus className="w-5 h-5" />
                New {cycleName}
              </Link>
            )}
          </div>

          {/* Active Sprint - Featured */}
          {activeSprint && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-green-400 mb-4 flex items-center gap-2">
                <PlayCircle className="w-5 h-5" />
                Active {cycleName}
              </h2>
              <SprintCard sprint={activeSprint} teamId={id} featured />
            </div>
          )}

          {/* Planning Sprints */}
          {planningSprints.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <PauseCircle className="w-5 h-5 text-slate-400" />
                Upcoming ({planningSprints.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {planningSprints.map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} teamId={id} />
                ))}
              </div>
            </div>
          )}

          {/* Completed Sprints */}
          {completedSprints.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                Completed ({completedSprints.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {completedSprints.slice(0, 6).map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} teamId={id} />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {sprintsWithData.length === 0 && (
            <div className="component-card text-center py-16">
              <Zap className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-medium text-slate-300 mb-2">No {cycleNameLower}s yet</h3>
              <p className="text-slate-500 mb-6 max-w-md mx-auto">
                {cycleNamePlural} help you organize work into focused time periods. Create your first {cycleNameLower}{' '}
                to start planning.
              </p>
              {canManageSprints && (
                <Link href={`/team/${id}/sprints/new`} className="btn-primary">
                  <Plus className="w-5 h-5" />
                  Create First {cycleName}
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

interface SprintCardProps {
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    status: SprintStatus;
    startDate: Date;
    endDate: Date;
    capacity: number | null;
    _count: { Component: number };
    Component: { status: string; estimatedHours: number | null }[];
  };
  teamId: string;
  featured?: boolean;
}

function SprintCard({ sprint, teamId, featured }: SprintCardProps) {
  const config = statusConfig[sprint.status];
  const StatusIcon = config.icon;

  const completedCount = sprint.Component.filter((c) => c.status === 'COMPLETED').length;
  const totalHours = sprint.Component.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
  const completedHours = sprint.Component.filter((c) => c.status === 'COMPLETED').reduce(
    (sum, c) => sum + (c.estimatedHours || 0),
    0,
  );

  const progress = sprint._count.Component > 0 ? Math.round((completedCount / sprint._count.Component) * 100) : 0;

  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(sprint.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  return (
    <Link
      href={`/team/${teamId}/sprints/${sprint.id}`}
      className={`component-card group block ${featured ? 'border-green-500/30 bg-green-500/5' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}
          >
            <StatusIcon className="w-3.5 h-3.5" />
            {config.label}
          </span>
        </div>
        <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-cyan-400 transition-colors" />
      </div>

      <h3 className="font-semibold text-lg text-slate-100 group-hover:text-cyan-400 transition-colors mb-1">
        {sprint.name}
      </h3>

      {sprint.goal && (
        <p className="text-sm text-slate-400 line-clamp-2 mb-3">
          <Target className="w-3.5 h-3.5 inline mr-1" />
          {sprint.goal}
        </p>
      )}

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>
            {completedCount}/{sprint._count.Component} items
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-green-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Meta info */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          {new Date(sprint.startDate).toLocaleDateString()} - {new Date(sprint.endDate).toLocaleDateString()}
        </span>
        {sprint.status === 'ACTIVE' && daysRemaining > 0 && (
          <span className="flex items-center gap-1 text-amber-400">
            <Clock className="w-3.5 h-3.5" />
            {daysRemaining}d left
          </span>
        )}
      </div>

      {/* Hours summary */}
      {totalHours > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          <Clock className="w-3.5 h-3.5 inline mr-1" />
          {completedHours}/{totalHours}h completed
          {sprint.capacity && (
            <span className="ml-2">({Math.round((totalHours / sprint.capacity) * 100)}% of capacity)</span>
          )}
        </div>
      )}
    </Link>
  );
}
