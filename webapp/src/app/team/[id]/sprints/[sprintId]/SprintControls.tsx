'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { updateSprintStatus, deleteSprint } from '@/app/sprints/actions';
import { PlayCircle, CheckCircle2, XCircle, Trash2, Loader2 } from 'lucide-react';

interface Props {
  sprint: {
    id: string;
    status: 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  };
  teamId: string;
}

export default function SprintControls({ sprint, teamId }: Props) {
  const router = useRouter();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { execute: executeStatus, isExecuting: isUpdatingStatus } = useAction(updateSprintStatus, {
    onSuccess: () => router.refresh(),
  });

  const { execute: executeDelete, isExecuting: isDeleting } = useAction(deleteSprint, {
    onSuccess: () => router.push(`/team/${teamId}/sprints`),
  });

  const handleStartSprint = () => {
    executeStatus({ id: sprint.id, status: 'ACTIVE' });
  };

  const handleCompleteSprint = () => {
    executeStatus({ id: sprint.id, status: 'COMPLETED' });
  };

  const handleCancelSprint = () => {
    executeStatus({ id: sprint.id, status: 'CANCELLED' });
  };

  const handleDelete = () => {
    executeDelete({ id: sprint.id });
  };

  return (
    <div className="flex items-center gap-2">
      {sprint.status === 'PLANNING' && (
        <button
          onClick={handleStartSprint}
          disabled={isUpdatingStatus}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-xl text-green-400 font-medium transition-colors disabled:opacity-50"
        >
          {isUpdatingStatus ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <PlayCircle className="w-4 h-4" />
          )}
          Start Sprint
        </button>
      )}

      {sprint.status === 'ACTIVE' && (
        <>
          <button
            onClick={handleCompleteSprint}
            disabled={isUpdatingStatus}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-xl text-cyan-400 font-medium transition-colors disabled:opacity-50"
          >
            {isUpdatingStatus ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Complete Sprint
          </button>
          <button
            onClick={handleCancelSprint}
            disabled={isUpdatingStatus}
            className="inline-flex items-center gap-2 px-3 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-400 transition-colors disabled:opacity-50"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </>
      )}

      {(sprint.status === 'PLANNING' || sprint.status === 'CANCELLED') && (
        <>
          {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-xl text-red-400 font-medium transition-colors disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Confirm Delete'
                )}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-2 px-3 py-2.5 bg-slate-700 hover:bg-red-500/20 hover:text-red-400 rounded-xl text-slate-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
