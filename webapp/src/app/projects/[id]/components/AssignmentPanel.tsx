'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { assignComponent, unassignComponent } from '@/app/projects/actions';
import { UserPlus, X, Check, Loader2, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '@prisma/client';

interface Props {
  componentId: string;
  componentName: string;
  currentAssignees: User[];
  teamMembers: User[];
}

export default function AssignmentPanel({ componentId, componentName, currentAssignees, teamMembers }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const assigneeIds = new Set(currentAssignees.map((u) => u.id));

  const { execute: executeAssign, isExecuting: isAssigning } = useAction(assignComponent, {
    onSuccess: () => {
      toast.success('Member assigned');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to assign');
    },
  });

  const { execute: executeUnassign, isExecuting: isUnassigning } = useAction(unassignComponent, {
    onSuccess: () => {
      toast.success('Member unassigned');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to unassign');
    },
  });

  const handleToggle = (userId: string) => {
    if (assigneeIds.has(userId)) {
      executeUnassign({ componentId, assigneeId: userId });
    } else {
      executeAssign({ componentId, assigneeId: userId });
    }
  };

  const isLoading = isAssigning || isUnassigning;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="p-1.5 text-slate-500 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors"
        title="Manage assignments"
      >
        <UserPlus className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div>
            <h2 className="font-semibold">Assign Team Members</h2>
            <p className="text-sm text-slate-400 mt-0.5">{componentName}</p>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-200 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Members List */}
        <div className="p-4 max-h-80 overflow-y-auto">
          <div className="space-y-2">
            {teamMembers.map((member) => {
              const isAssigned = assigneeIds.has(member.id);
              return (
                <button
                  key={member.id}
                  onClick={() => handleToggle(member.id)}
                  disabled={isLoading}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    isAssigned
                      ? 'bg-cyan-500/10 border-cyan-500/40'
                      : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-sm font-medium">
                    {member.name?.[0] || member.email[0].toUpperCase()}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-slate-200">{member.name || member.email}</div>
                    {member.name && <div className="text-xs text-slate-500">{member.email}</div>}
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
                      isAssigned ? 'bg-cyan-500 border-cyan-500' : 'border-slate-600'
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : isAssigned ? (
                      <Check className="w-3 h-3 text-white" />
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800">
          <div className="text-sm text-slate-400">{currentAssignees.length} assigned</div>
          <button onClick={() => setIsOpen(false)} className="btn-primary text-sm">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
