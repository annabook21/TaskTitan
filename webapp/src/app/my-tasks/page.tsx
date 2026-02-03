import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { CheckCircle2, Clock, AlertCircle, ListTodo, Calendar, ArrowRight } from 'lucide-react';
import DemoMyTasksPage from './DemoMyTasksPage';
import { getEntities } from '@/lib/dynamodb/service';
import {
  batchFetchComponents,
  batchFetchProjects,
  batchFetchTeams,
  batchFetchSprints,
  batchFetchStatusHistory,
} from '@/lib/dynamodb/batch-queries';

export default async function MyTasksPage() {
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page
  if ('isDemo' in session && session.isDemo) {
    return <DemoMyTasksPage />;
  }

  const entities = getEntities();

  // Get all assignments for the current user from DynamoDB
  const assignmentsResult = await entities.assignment.query.byUser({ userId }).go();
  const assignments = assignmentsResult.data;

  const componentIds = assignments.map((a) => a.componentId);
  const [componentsMap, statusHistoryMap] = await Promise.all([
    batchFetchComponents(componentIds),
    batchFetchStatusHistory(componentIds),
  ]);

  const componentList = Array.from(componentsMap.values());
  const projectIds = [...new Set(componentList.map((c) => c.projectId).filter((id): id is string => Boolean(id)))];
  const sprintIds = [...new Set(componentList.map((c) => c.sprintId).filter((id): id is string => Boolean(id)))];

  const projectsMap = await batchFetchProjects(projectIds);
  const teamIds = [...new Set(Array.from(projectsMap.values()).map((p) => p.teamId))];
  const [teamsMap2, sprintsMap] = await Promise.all([batchFetchTeams(teamIds), batchFetchSprints(sprintIds)]);

  const tasks = assignments
    .map((a) => {
      const component = componentsMap.get(a.componentId);
      if (!component) return null;
      const project = projectsMap.get(component.projectId);
      if (!project) return null;
      const team = teamsMap2.get(project.teamId);
      const sprint = component.sprintId ? sprintsMap.get(component.sprintId) : null;

      const history = statusHistoryMap.get(component.id) ?? [];
      const sortedHistory = [...history].sort(
        (x, y) => new Date(x.enteredAt).getTime() - new Date(y.enteredAt).getTime(),
      );
      const currentStatusEntry = sortedHistory.find((h) => !h.exitedAt) ?? sortedHistory[sortedHistory.length - 1];
      const statusAge = currentStatusEntry
        ? Math.floor((Date.now() - new Date(currentStatusEntry.enteredAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        id: component.id,
        name: component.name,
        description: component.description ?? null,
        type: component.type,
        status: component.status,
        priority: component.priority,
        estimatedHours: component.estimatedHours ?? null,
        actualHours: component.actualHours ?? null,
        dueDate: component.dueDate ?? null,
        statusAge,
        project: {
          id: project.id,
          name: project.name,
          Team: team ? { id: team.id, name: team.name } : { id: project.teamId, name: 'Unknown' },
        },
        sprint: sprint
          ? {
              id: sprint.id,
              name: sprint.name,
              status: sprint.status,
              startDate: sprint.startDate,
              endDate: sprint.endDate,
            }
          : null,
        assignedAt: a.assignedAt,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  // Filter out null tasks and sort by assignedAt descending
  const validTasks = tasks
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());

  // Group by status
  const tasksByStatus = {
    IN_PROGRESS: validTasks.filter((t) => t.status === 'IN_PROGRESS'),
    PLANNING: validTasks.filter((t) => t.status === 'PLANNING'),
    BLOCKED: validTasks.filter((t) => t.status === 'BLOCKED'),
    REVIEW: validTasks.filter((t) => t.status === 'REVIEW'),
    COMPLETED: validTasks.filter((t) => t.status === 'COMPLETED'),
  };

  const statusConfig = {
    IN_PROGRESS: { label: 'In Progress', color: 'cyan', icon: Clock },
    PLANNING: { label: 'Planning', color: 'violet', icon: ListTodo },
    BLOCKED: { label: 'Blocked', color: 'red', icon: AlertCircle },
    REVIEW: { label: 'Review', color: 'amber', icon: CheckCircle2 },
    COMPLETED: { label: 'Completed', color: 'emerald', icon: CheckCircle2 },
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">My Tasks</h1>
            <p className="text-slate-400">All work items assigned to you across projects</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
            {Object.entries(tasksByStatus).map(([status, statusTasks]) => {
              const config = statusConfig[status as keyof typeof statusConfig];
              const Icon = config.icon;
              return (
                <div key={status} className="component-card">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 text-${config.color}-400`} />
                    <span className="text-sm text-slate-400">{config.label}</span>
                  </div>
                  <div className={`text-2xl font-bold text-${config.color}-400`}>{statusTasks.length}</div>
                </div>
              );
            })}
          </div>

          {/* No tasks message */}
          {validTasks.length === 0 && (
            <div className="component-card text-center py-16">
              <ListTodo className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-slate-300 mb-2">No tasks assigned</h2>
              <p className="text-slate-500">You don't have any work items assigned to you yet.</p>
            </div>
          )}

          {/* Task Lists by Status */}
          {validTasks.length > 0 && (
            <div className="space-y-8">
              {Object.entries(tasksByStatus).map(([status, statusTasks]) => {
                if (statusTasks.length === 0) return null;
                const config = statusConfig[status as keyof typeof statusConfig];
                const Icon = config.icon;

                return (
                  <div key={status}>
                    <h2 className={`text-lg font-semibold mb-4 flex items-center gap-2 text-${config.color}-400`}>
                      <Icon className="w-5 h-5" />
                      {config.label}
                      <span className="text-slate-500 font-normal">({statusTasks.length})</span>
                    </h2>
                    <div className="grid gap-4">
                      {statusTasks.map((task) => {
                        const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();
                        const isAging = task.statusAge > 7;

                        return (
                          <Link
                            key={task.id}
                            href={`/projects/${task.project.id}`}
                            className="component-card hover:border-cyan-500/30 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2">
                                  <h3 className="font-medium text-slate-200 truncate">{task.name}</h3>
                                  <span
                                    className={`px-1.5 py-0.5 text-xs rounded bg-${config.color}-500/20 text-${config.color}-400`}
                                  >
                                    {task.type}
                                  </span>
                                </div>
                                {task.description && (
                                  <p className="text-sm text-slate-400 line-clamp-2 mb-3">{task.description}</p>
                                )}
                                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5" />
                                    {task.estimatedHours ? `${task.estimatedHours}h` : 'No estimate'}
                                    {task.actualHours && ` (${task.actualHours}h actual)`}
                                  </span>
                                  {task.dueDate && (
                                    <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-400' : ''}`}>
                                      <Calendar className="w-3.5 h-3.5" />
                                      {new Date(task.dueDate).toLocaleDateString()}
                                      {isOverdue && ' (overdue)'}
                                    </span>
                                  )}
                                  {task.sprint && <span className="flex items-center gap-1">{task.sprint.name}</span>}
                                  {isAging && (
                                    <span className="flex items-center gap-1 text-amber-400">
                                      <AlertCircle className="w-3.5 h-3.5" />
                                      {task.statusAge} days in {config.label}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-2 text-xs">
                                  <span className="text-slate-500">{task.project.Team.name}</span>
                                  <span className="text-slate-600">•</span>
                                  <span className="text-slate-500">{task.project.name}</span>
                                </div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0 mt-1" />
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
