'use client';

import { useEffect, useState } from 'react';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { CheckCircle2, Clock, AlertCircle, ListTodo, Calendar, ArrowRight } from 'lucide-react';
import { DEMO_STORE_UPDATE_EVENT } from '@/hooks/use-demo-action';

interface Task {
  id: string;
  name: string;
  description: string | null;
  type: 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG';
  status: 'PLANNING' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED';
  priority: number;
  estimatedHours: number | null;
  actualHours: number | null;
  dueDate: Date | null;
  statusAge: number;
  project: {
    id: string;
    name: string;
    teamName: string;
  };
  sprint: {
    id: string;
    name: string;
  } | null;
  assignedAt: Date;
}

export default function DemoMyTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);

  const loadTasks = () => {
    const store = demoStore.getStore();

    // Get all assignments for current user
    const userAssignments = store.assignments.filter((a) => a.userId === DEMO_USER.id);

    const loadedTasks: Task[] = userAssignments.map((assignment) => {
      const component = store.components.find((c) => c.id === assignment.componentId)!;
      const project = store.projects.find((p) => p.id === component.projectId)!;
      const team = store.teams.find((t) => t.id === project.teamId)!;
      const sprint = component.sprintId ? store.sprints.find((s) => s.id === component.sprintId) : null;

      // Calculate status age
      const statusHistory = store.statusHistory
        .filter((h) => h.componentId === component.id)
        .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());
      const currentStatusEntry = statusHistory.find((h) => !h.exitedAt) || statusHistory[statusHistory.length - 1];
      const statusAge = currentStatusEntry
        ? Math.floor((Date.now() - new Date(currentStatusEntry.enteredAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        id: component.id,
        name: component.name,
        description: component.description,
        type: component.type,
        status: component.status,
        priority: component.priority,
        estimatedHours: component.estimatedHours,
        actualHours: component.actualHours,
        dueDate: component.dueDate ? new Date(component.dueDate) : null,
        statusAge,
        project: {
          id: project.id,
          name: project.name,
          teamName: team.name,
        },
        sprint: sprint
          ? {
              id: sprint.id,
              name: sprint.name,
            }
          : null,
        assignedAt: new Date(assignment.createdAt),
      };
    });

    setTasks(loadedTasks.sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime()));
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    const handleStoreUpdate = () => {
      loadTasks();
    };
    window.addEventListener(DEMO_STORE_UPDATE_EVENT, handleStoreUpdate);
    return () => {
      window.removeEventListener(DEMO_STORE_UPDATE_EVENT, handleStoreUpdate);
    };
  }, []);

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  // Group by status
  const tasksByStatus = {
    IN_PROGRESS: tasks.filter((t) => t.status === 'IN_PROGRESS'),
    PLANNING: tasks.filter((t) => t.status === 'PLANNING'),
    BLOCKED: tasks.filter((t) => t.status === 'BLOCKED'),
    REVIEW: tasks.filter((t) => t.status === 'REVIEW'),
    COMPLETED: tasks.filter((t) => t.status === 'COMPLETED'),
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
            {Object.entries(tasksByStatus).map(([status, tasks]) => {
              const config = statusConfig[status as keyof typeof statusConfig];
              const Icon = config.icon;
              return (
                <div key={status} className="component-card">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 text-${config.color}-400`} />
                    <span className="text-sm text-slate-400">{config.label}</span>
                  </div>
                  <div className={`text-2xl font-bold text-${config.color}-400`}>{tasks.length}</div>
                </div>
              );
            })}
          </div>

          {/* No tasks message */}
          {tasks.length === 0 && (
            <div className="component-card text-center py-16">
              <ListTodo className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-slate-300 mb-2">No tasks assigned</h2>
              <p className="text-slate-500">You don't have any work items assigned to you yet.</p>
            </div>
          )}

          {/* Task Lists by Status */}
          {tasks.length > 0 && (
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
                        const isOverdue = task.dueDate && task.dueDate < new Date();
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
                                      {task.dueDate.toLocaleDateString()}
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
                                  <span className="text-slate-500">{task.project.teamName}</span>
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
