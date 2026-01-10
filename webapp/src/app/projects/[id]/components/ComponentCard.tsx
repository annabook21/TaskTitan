'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateComponent } from '@/app/projects/actions';
import { assignComponentToSprint } from '@/app/sprints/actions';
import { MoreVertical, GitBranch, Clock, User as UserIcon, ChevronDown, Check, Zap, Github } from 'lucide-react';
import { toast } from 'sonner';
import type { ComponentStatus, User, SprintStatus } from '@prisma/client';
import AssignmentPanel from './AssignmentPanel';

interface Sprint {
  id: string;
  name: string;
  status: SprintStatus;
  startDate: Date;
  endDate: Date;
}

interface ComponentWithRelations {
  id: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
  priority: number;
  estimatedHours: number | null;
  dueDate: Date | null;
  sprintId: string | null;
  sprint: Sprint | null;
  githubPrUrl: string | null;
  assignments: { user: User }[];
  dependsOn: { requiredComponent: { id: string; name: string } }[];
  dependedOnBy: { dependentComponent: { id: string; name: string } }[];
}

interface Props {
  component: ComponentWithRelations;
  teamMembers: User[];
  availableSprints: Sprint[];
}

const statusOptions: { value: ComponentStatus; label: string; color: string }[] = [
  { value: 'PLANNING', label: 'Planning', color: 'violet' },
  { value: 'IN_PROGRESS', label: 'In Progress', color: 'cyan' },
  { value: 'BLOCKED', label: 'Blocked', color: 'red' },
  { value: 'REVIEW', label: 'Review', color: 'amber' },
  { value: 'COMPLETED', label: 'Completed', color: 'emerald' },
];

export default function ComponentCard({ component, teamMembers, availableSprints }: Props) {
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [isSprintOpen, setIsSprintOpen] = useState(false);

  const { execute, isExecuting } = useAction(updateComponent, {
    onSuccess: () => {
      toast.success('Component updated');
      setIsStatusOpen(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update');
    },
  });

  const { execute: executeSprint, isExecuting: isSprintExecuting } = useAction(assignComponentToSprint, {
    onSuccess: () => {
      toast.success('Sprint updated');
      setIsSprintOpen(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update sprint');
    },
  });

  const currentStatus = statusOptions.find((s) => s.value === component.status);

  const handleStatusChange = (newStatus: ComponentStatus) => {
    execute({ id: component.id, status: newStatus });
  };

  const handleSprintChange = (sprintId: string | null) => {
    executeSprint({ componentId: component.id, sprintId });
  };

  return (
    <div className="component-card group">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-slate-100 group-hover:text-cyan-400 transition-colors">{component.name}</h4>
        <button className="p-1 text-slate-500 hover:text-slate-300 rounded opacity-0 group-hover:opacity-100 transition-opacity">
          <MoreVertical className="w-4 h-4" />
        </button>
      </div>

      {/* Description */}
      {component.description && <p className="text-sm text-slate-400 line-clamp-2 mb-3">{component.description}</p>}

      {/* GitHub PR Link */}
      {component.githubPrUrl && (
        <a
          href={component.githubPrUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 mb-2 transition-colors"
        >
          <Github className="w-3 h-3" />
          View Pull Request
        </a>
      )}

      {/* Status Dropdown */}
      <div className="relative mb-3">
        <button
          onClick={() => setIsStatusOpen(!isStatusOpen)}
          disabled={isExecuting}
          className={`status-badge ${component.status.toLowerCase().replace('_', '-')} w-full justify-between`}
        >
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full bg-${currentStatus?.color}-500`} />
            {currentStatus?.label}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isStatusOpen ? 'rotate-180' : ''}`} />
        </button>

        {isStatusOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 overflow-hidden">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handleStatusChange(option.value)}
                className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-700 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full bg-${option.color}-500`} />
                  {option.label}
                </span>
                {component.status === option.value && <Check className="w-4 h-4 text-cyan-400" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sprint Selector */}
      {availableSprints.length > 0 && (
        <div className="relative mb-3">
          <button
            onClick={() => setIsSprintOpen(!isSprintOpen)}
            disabled={isSprintExecuting}
            className={`w-full px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center justify-between ${
              component.sprint
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              {component.sprint ? component.sprint.name : 'No Sprint (Backlog)'}
            </span>
            <ChevronDown className={`w-3 h-3 transition-transform ${isSprintOpen ? 'rotate-180' : ''}`} />
          </button>

          {isSprintOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 overflow-hidden max-h-48 overflow-y-auto">
              <button
                onClick={() => handleSprintChange(null)}
                className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-700 transition-colors"
              >
                <span className="text-slate-400">Backlog (No Sprint)</span>
                {!component.sprintId && <Check className="w-4 h-4 text-cyan-400" />}
              </button>
              {availableSprints.map((sprint) => (
                <button
                  key={sprint.id}
                  onClick={() => handleSprintChange(sprint.id)}
                  className="w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-slate-700 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Zap className={`w-3 h-3 ${sprint.status === 'ACTIVE' ? 'text-green-400' : 'text-slate-400'}`} />
                    <span>{sprint.name}</span>
                    {sprint.status === 'ACTIVE' && <span className="text-xs text-green-400">(Active)</span>}
                  </span>
                  {component.sprintId === sprint.id && <Check className="w-4 h-4 text-cyan-400" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dependencies */}
      {component.dependsOn.length > 0 && (
        <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
          <GitBranch className="w-3.5 h-3.5" />
          Depends on: {component.dependsOn.map((d) => d.requiredComponent.name).join(', ')}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        {/* Assignees */}
        <div className="flex items-center gap-2">
          <div className="flex items-center -space-x-2">
            {component.assignments.length === 0 ? (
              <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                <UserIcon className="w-3 h-3 text-slate-500" />
              </div>
            ) : (
              component.assignments.slice(0, 3).map(({ user }) => (
                <div
                  key={user.id}
                  className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-xs font-medium border-2 border-slate-900"
                  title={user.name || user.email}
                >
                  {user.name?.[0] || user.email[0].toUpperCase()}
                </div>
              ))
            )}
            {component.assignments.length > 3 && (
              <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs text-slate-400">
                +{component.assignments.length - 3}
              </div>
            )}
          </div>
          <AssignmentPanel
            componentId={component.id}
            componentName={component.name}
            currentAssignees={component.assignments.map((a) => a.user)}
            teamMembers={teamMembers}
          />
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {component.estimatedHours && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {component.estimatedHours}h
            </span>
          )}
          {component.priority > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">P{component.priority}</span>
          )}
        </div>
      </div>
    </div>
  );
}
