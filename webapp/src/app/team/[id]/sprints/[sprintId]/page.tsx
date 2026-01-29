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
  AlertCircle,
  PlayCircle,
  PauseCircle,
  Zap,
  FolderKanban,
  XCircle,
} from 'lucide-react';
import SprintControls from './SprintControls';
import SprintComponents from './SprintComponents';
import AISprintPlanner from './AISprintPlanner';
import SprintRefineButton from './SprintRefineButton';
import DemoSprintDetailPage from './DemoSprintDetailPage';
import { getEntities } from '@/lib/dynamodb/service';
import { verifySprintAccess } from '@/lib/dynamodb/auth-helpers';
import { batchFetchAssignmentsByComponents, batchFetchUsers } from '@/lib/dynamodb/batch-queries';

interface Props {
  params: Promise<{ id: string; sprintId: string }>;
}

type SprintStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

const statusConfig = {
  PLANNING: {
    label: 'Planning',
    color: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
    icon: PauseCircle,
  },
  ACTIVE: {
    label: 'Active',
    color: 'text-green-400 bg-green-500/10 border-green-500/30',
    icon: PlayCircle,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-red-400 bg-red-500/10 border-red-500/30',
    icon: XCircle,
  },
};

export default async function SprintDetailPage({ params }: Props) {
  const { id: teamId, sprintId } = await params;
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoSprintDetailPage />;
  }

  const entities = getEntities();

  // Verify user has access to this sprint
  const access = await verifySprintAccess(userId, sprintId);
  if (!access || access.sprint.teamId !== teamId) {
    notFound();
  }

  const sprint = access.sprint;
  const sprintStatus = ((sprint as any).status || 'PLANNING') as SprintStatus;

  // Get projects for this team to fetch components
  const projectsResult = await entities.project.query.byTeam({ teamId }).go();
  const projectIds = projectsResult.data.map((p) => p.id);

  // Fetch all components and filter for this sprint
  const componentResults = await Promise.all(
    projectIds.map((projectId) => entities.component.query.byProject({ projectId }).go())
  );
  const allComponents = componentResults.flatMap((r) => r.data);
  const sprintComponents = allComponents.filter((c) => c.sprintId === sprintId);

  // Batch fetch assignments for all sprint components, then batch fetch users
  const componentIds = sprintComponents.map((c) => c.id);
  const assignmentsMap = await batchFetchAssignmentsByComponents(componentIds);
  const allAssignmentUserIds = Array.from(assignmentsMap.values()).flatMap((arr) => arr.map((a) => a.userId));
  const usersMap = await batchFetchUsers([...new Set(allAssignmentUserIds)]);

  const projectMap = new Map(projectsResult.data.map((p) => [p.id, p]));

  const componentsWithDetails = sprintComponents.map((comp) => {
    const project = projectMap.get(comp.projectId);
    const assignments = assignmentsMap.get(comp.id) ?? [];
    const assignmentsWithUsers = assignments.map((a) => ({
      User: {
        id: a.userId,
        name: usersMap.get(a.userId)?.name ?? null,
        email: usersMap.get(a.userId)?.email ?? 'unknown@example.com',
      },
    }));

    return {
      id: comp.id,
      name: comp.name,
      status: comp.status,
      priority: (comp as any).priority ?? 0,
      estimatedHours: (comp as any).estimatedHours ?? null,
      description: (comp as any).description ?? null,
      Project: project ? { id: project.id, name: project.name } : null,
      Assignment: assignmentsWithUsers,
    };
  });

  // Sort components by status then priority
  const sortedComponents = componentsWithDetails.sort((a, b) => {
    const statusOrder = ['IN_PROGRESS', 'BLOCKED', 'PLANNING', 'REVIEW', 'COMPLETED'];
    const statusDiff = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    if (statusDiff !== 0) return statusDiff;
    return (b.priority || 0) - (a.priority || 0);
  });

  const currentUserRole = access.membership.role;
  const canManage = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN';

  const config = statusConfig[sprintStatus];
  const StatusIcon = config.icon;

  // Calculate metrics
  const totalComponents = sortedComponents.length;
  const completedComponents = sortedComponents.filter((c) => c.status === 'COMPLETED').length;
  const blockedComponents = sortedComponents.filter((c) => c.status === 'BLOCKED').length;
  const inProgressComponents = sortedComponents.filter((c) => c.status === 'IN_PROGRESS').length;

  const totalHours = sortedComponents.reduce((sum, c) => sum + (c.estimatedHours || 0), 0);
  const completedHours = sortedComponents
    .filter((c) => c.status === 'COMPLETED')
    .reduce((sum, c) => sum + (c.estimatedHours || 0), 0);

  const progress = totalComponents > 0 ? Math.round((completedComponents / totalComponents) * 100) : 0;

  const startDate = new Date(sprint.startDate);
  const endDate = new Date(sprint.endDate);
  const daysTotal = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(0, Math.ceil((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${teamId}/sprints`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sprints
          </Link>

          {/* Sprint Header */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 flex items-center justify-center">
                <Zap className="w-8 h-8 text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-3xl font-bold">{sprint.name}</h1>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${config.color}`}
                  >
                    <StatusIcon className="w-4 h-4" />
                    {config.label}
                  </span>
                </div>
                {(sprint as any).goal && (
                  <p className="text-slate-400 max-w-2xl flex items-start gap-2">
                    <Target className="w-4 h-4 mt-1 flex-shrink-0" />
                    {(sprint as any).goal}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    {startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FolderKanban className="w-4 h-4" />
                    {totalComponents} items
                  </span>
                  {sprintStatus === 'ACTIVE' && daysRemaining > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <Clock className="w-4 h-4" />
                      {daysRemaining} days remaining
                    </span>
                  )}
                </div>
              </div>
            </div>

            {canManage && (
              <div className="flex items-center gap-3">
                <SprintRefineButton sprintId={sprint.id} sprintName={sprint.name} teamId={teamId} />
                <SprintControls sprint={{ ...sprint, status: sprintStatus } as any} teamId={teamId} />
              </div>
            )}
          </div>

          {/* Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="component-card text-center">
              <div className="text-3xl font-bold text-cyan-400">{progress}%</div>
              <div className="text-sm text-slate-400 mt-1">Complete</div>
              <div className="h-2 bg-slate-700 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-500 to-green-500" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className="component-card text-center">
              <div className="text-3xl font-bold text-green-400">{completedComponents}</div>
              <div className="text-sm text-slate-400 mt-1">Completed</div>
              <div className="text-xs text-slate-500 mt-2">of {totalComponents} items</div>
            </div>

            <div className="component-card text-center">
              <div className="text-3xl font-bold text-amber-400">{inProgressComponents}</div>
              <div className="text-sm text-slate-400 mt-1">In Progress</div>
              {blockedComponents > 0 && (
                <div className="text-xs text-red-400 mt-2 flex items-center justify-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {blockedComponents} blocked
                </div>
              )}
            </div>

            <div className="component-card text-center">
              <div className="text-3xl font-bold text-violet-400">{Math.round(completedHours)}</div>
              <div className="text-sm text-slate-400 mt-1">Hours Done</div>
              <div className="text-xs text-slate-500 mt-2">of {Math.round(totalHours)}h planned</div>
            </div>
          </div>

          {/* AI Sprint Planning - show for planning sprints */}
          {canManage && sprintStatus === 'PLANNING' && (
            <div className="mb-8">
              <AISprintPlanner sprintId={sprintId} defaultCapacity={(sprint as any).capacity || 40} />
            </div>
          )}

          {/* Components List */}
          <SprintComponents components={sortedComponents as any} sprintId={sprintId} teamId={teamId} canManage={canManage} />
        </div>
      </main>
    </div>
  );
}
