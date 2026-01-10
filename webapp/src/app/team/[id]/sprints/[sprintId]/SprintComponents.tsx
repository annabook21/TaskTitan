'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { assignComponentToSprint } from '@/app/sprints/actions';
import {
  FolderKanban,
  Clock,
  User,
  CheckCircle2,
  PlayCircle,
  AlertCircle,
  ClipboardList,
  Search,
  X,
} from 'lucide-react';

interface ComponentData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: number;
  estimatedHours: number | null;
  Project: { id: string; name: string };
  Assignment: { User: { id: string; name: string | null; email: string } }[];
}

interface Props {
  components: ComponentData[];
  sprintId: string;
  teamId: string;
  canManage: boolean;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PLANNING: { label: 'Planning', color: 'text-slate-400 bg-slate-500/10', icon: ClipboardList },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-400 bg-amber-500/10', icon: PlayCircle },
  BLOCKED: { label: 'Blocked', color: 'text-red-400 bg-red-500/10', icon: AlertCircle },
  REVIEW: { label: 'Review', color: 'text-violet-400 bg-violet-500/10', icon: Search },
  COMPLETED: { label: 'Completed', color: 'text-green-400 bg-green-500/10', icon: CheckCircle2 },
};

export default function SprintComponents({ components, sprintId, teamId, canManage }: Props) {
  const router = useRouter();

  const { execute: removeFromSprint, isExecuting } = useAction(assignComponentToSprint, {
    onSuccess: () => router.refresh(),
  });

  const handleRemove = (componentId: string) => {
    removeFromSprint({ componentId, sprintId: null });
  };

  // Group by status
  const byStatus = {
    IN_PROGRESS: components.filter((c) => c.status === 'IN_PROGRESS'),
    BLOCKED: components.filter((c) => c.status === 'BLOCKED'),
    REVIEW: components.filter((c) => c.status === 'REVIEW'),
    PLANNING: components.filter((c) => c.status === 'PLANNING'),
    COMPLETED: components.filter((c) => c.status === 'COMPLETED'),
  };

  if (components.length === 0) {
    return (
      <div className="component-card text-center py-12">
        <FolderKanban className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-300 mb-2">No items in this sprint</h3>
        <p className="text-slate-500 max-w-md mx-auto">
          Add components to this sprint from your project pages, or drag items here during sprint planning.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <FolderKanban className="w-5 h-5 text-cyan-400" />
        Sprint Items ({components.length})
      </h2>

      {/* Show each status group */}
      {Object.entries(byStatus).map(([status, items]) => {
        if (items.length === 0) return null;
        const config = statusConfig[status];
        const StatusIcon = config.icon;

        return (
          <div key={status}>
            <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
              <StatusIcon className={`w-4 h-4 ${config.color.split(' ')[0]}`} />
              {config.label} ({items.length})
            </h3>
            <div className="space-y-2">
              {items.map((component) => (
                <div key={component.id} className="component-card flex items-center justify-between group">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}>
                      {config.label}
                    </span>

                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/projects/${component.Project.id}`}
                        className="font-medium text-slate-100 hover:text-cyan-400 transition-colors truncate block"
                      >
                        {component.name}
                      </Link>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <FolderKanban className="w-3 h-3" />
                          {component.Project.name}
                        </span>
                        {component.estimatedHours && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {component.estimatedHours}h
                          </span>
                        )}
                        {component.Assignment.length > 0 && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {component.Assignment.map((a) => a.User.name || a.User.email.split('@')[0]).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <button
                      onClick={() => handleRemove(component.id)}
                      disabled={isExecuting}
                      className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-all disabled:opacity-50"
                      title="Remove from sprint"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
