import { type Component, type ComponentStatus, type Membership } from '../api/appsync';

const statusColors: Record<ComponentStatus, string> = {
  PLANNING: 'bg-slate-600',
  IN_PROGRESS: 'bg-blue-600',
  BLOCKED: 'bg-red-600',
  REVIEW: 'bg-yellow-600',
  COMPLETED: 'bg-green-600',
};

const typeColors: Record<string, string> = {
  EPIC: 'text-purple-400 border-purple-400',
  FEATURE: 'text-cyan-400 border-cyan-400',
  STORY: 'text-green-400 border-green-400',
  TASK: 'text-slate-400 border-slate-400',
  BUG: 'text-red-400 border-red-400',
};

interface ComponentCardProps {
  component: Component;
  onClick?: () => void;
  onStatusChange?: (status: ComponentStatus) => void;
  isDragging?: boolean;
  // Optional team members for resolving owner ID to name
  teamMembers?: Membership[];
}

export function ComponentCard({ component, onClick, isDragging, teamMembers }: ComponentCardProps) {
  // Resolve owner ID to display name if teamMembers provided
  const getOwnerName = (ownerId: string | null | undefined): string | null => {
    if (!ownerId) return null;
    if (!teamMembers) return ownerId;
    const member = teamMembers.find((m) => m.userId === ownerId);
    return member?.user?.name || member?.title || ownerId;
  };
  return (
    <div
      onClick={onClick}
      className={`p-3 bg-slate-800 border border-slate-700 rounded-lg cursor-pointer hover:border-cyan-500/50 transition-all ${
        isDragging ? 'opacity-50 scale-105' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className={`text-xs font-medium px-1.5 py-0.5 border rounded ${typeColors[component.type]}`}
        >
          {component.type}
        </span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded text-white ${statusColors[component.status]}`}
        >
          {component.status.replace('_', ' ')}
        </span>
      </div>

      <h3 className="text-sm font-medium text-white mb-1 line-clamp-2">{component.name}</h3>

      {component.description && (
        <p className="text-xs text-slate-400 line-clamp-2 mb-2">{component.description}</p>
      )}

      <div className="flex items-center gap-2 text-xs text-slate-500">
        {component.estimatedHours && (
          <span title="Estimated hours">{component.estimatedHours}h</span>
        )}
        {component.priority != null && component.priority > 0 && (
          <span title="Priority" className="text-yellow-500">
            P{component.priority}
          </span>
        )}
        {component.owner && <span title="Owner">{getOwnerName(component.owner)}</span>}
      </div>
    </div>
  );
}
