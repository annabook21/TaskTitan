'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { deleteProject } from '@/app/projects/actions';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  projectId: string;
  projectName: string;
}

export default function DeleteProjectButton({ projectId, projectName }: Props) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const { execute, isExecuting } = useAction(deleteProject, {
    onSuccess: (result) => {
      if (result.data?.success) {
        toast.success('Project deleted');
        // Use replace to prevent back-navigation to deleted project
        router.replace('/projects');
      } else {
        toast.error('Failed to delete project');
        setShowConfirm(false);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to delete project');
      setShowConfirm(false);
    },
  });

  const handleDelete = () => {
    if (confirmText === projectName) {
      execute({ id: projectId });
    }
  };

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="flex items-center gap-2 px-4 py-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        Delete Project
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Delete Project</h3>
            <p className="text-sm text-slate-400">This action cannot be undone</p>
          </div>
        </div>

        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-red-300">
            This will permanently delete <strong>{projectName}</strong> and all its:
          </p>
          <ul className="text-sm text-red-300/80 mt-2 space-y-1">
            <li>• All components and tasks</li>
            <li>• All assignments</li>
            <li>• All dependencies</li>
            <li>• All activity history</li>
          </ul>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2">
            Type <strong className="text-white">{projectName}</strong> to confirm:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={projectName}
            className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-600 focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setShowConfirm(false);
              setConfirmText('');
            }}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={confirmText !== projectName || isExecuting}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isExecuting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete Project
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
