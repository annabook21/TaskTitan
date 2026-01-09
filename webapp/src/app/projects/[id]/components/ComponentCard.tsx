'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateComponent } from '@/app/projects/actions';
import { MoreVertical, GitBranch, Clock, User as UserIcon, ChevronDown, Check, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { ComponentStatus, User } from '@prisma/client';
import AssignmentPanel from './AssignmentPanel';

interface ComponentWithRelations {
  id: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
  priority: number;
  estimatedHours: number | null;
  dueDate: Date | null;
  assignments: { user: User }[];
  dependsOn: { requiredComponent: { id: string; name: string } }[];
  dependedOnBy: { dependentComponent: { id: string; name: string } }[];
}

interface Props {
  component: ComponentWithRelations;
  teamMembers: User[];
}

const statusOptions: { value: ComponentStatus; label: string; color: string }[] = [
  { value: 'PLANNING', label: 'Planning', color: 'violet' },
  { value: 'IN_PROGRESS', label: 'In Progress', color: 'cyan' },
  { value: 'BLOCKED', label: 'Blocked', color: 'red' },
  { value: 'REVIEW', label: 'Review', color: 'amber' },
  { value: 'COMPLETED', label: 'Completed', color: 'emerald' },
];

export default function ComponentCard({ component, teamMembers }: Props) {
  const [isStatusOpen, setIsStatusOpen] = useState(false);

  const { execute, isExecuting } = useAction(updateComponent, {
    onSuccess: () => {
      toast.success('Component updated');
      setIsStatusOpen(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to update');
    },
  });

  const currentStatus = statusOptions.find((s) => s.value === component.status);

  const handleStatusChange = (newStatus: ComponentStatus) => {
    execute({ id: component.id, status: newStatus });
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
