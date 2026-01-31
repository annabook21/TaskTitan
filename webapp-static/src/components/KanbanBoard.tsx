import { useState } from 'react';
import { type Component, type ComponentStatus, type Membership, updateComponent } from '../api/appsync';
import { ComponentCard } from './ComponentCard';

const STATUSES: { key: ComponentStatus; label: string; color: string }[] = [
  { key: 'PLANNING', label: 'Planning', color: 'border-slate-500' },
  { key: 'IN_PROGRESS', label: 'In Progress', color: 'border-blue-500' },
  { key: 'BLOCKED', label: 'Blocked', color: 'border-red-500' },
  { key: 'REVIEW', label: 'Review', color: 'border-yellow-500' },
  { key: 'COMPLETED', label: 'Completed', color: 'border-green-500' },
];

interface KanbanBoardProps {
  components: Component[];
  onComponentClick?: (component: Component) => void;
  onComponentUpdate?: (component: Component) => void;
  onStatusUpdateError?: (err: Error) => void;
  // Team members for resolving owner IDs to names
  teamMembers?: Membership[];
}

export function KanbanBoard({ components, onComponentClick, onComponentUpdate, onStatusUpdateError, teamMembers }: KanbanBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const getComponentsByStatus = (status: ComponentStatus) => {
    return components.filter((c) => c.status === status);
  };

  const handleDragStart = (e: React.DragEvent, componentId: string) => {
    setDraggedId(componentId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, newStatus: ComponentStatus) => {
    e.preventDefault();
    if (!draggedId) return;

    const component = components.find((c) => c.id === draggedId);
    if (!component || component.status === newStatus) {
      setDraggedId(null);
      return;
    }

    setUpdating(draggedId);
    try {
      const updated = await updateComponent(draggedId, { status: newStatus });
      onComponentUpdate?.(updated);
    } catch (err) {
      onStatusUpdateError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setUpdating(null);
      setDraggedId(null);
    }
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUSES.map((status) => {
        const statusComponents = getComponentsByStatus(status.key);
        return (
          <div
            key={status.key}
            className={`flex-shrink-0 w-72 bg-slate-900 rounded-lg border-t-2 ${status.color}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, status.key)}
          >
            <div className="p-3 border-b border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-slate-300">{status.label}</h3>
                <span className="text-sm text-slate-500">{statusComponents.length}</span>
              </div>
            </div>

            <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto">
              {statusComponents.map((component) => (
                <div
                  key={component.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, component.id)}
                  onDragEnd={handleDragEnd}
                  className={updating === component.id ? 'opacity-50' : ''}
                >
                  <ComponentCard
                    component={component}
                    onClick={() => onComponentClick?.(component)}
                    isDragging={draggedId === component.id}
                    teamMembers={teamMembers}
                  />
                </div>
              ))}

              {statusComponents.length === 0 && (
                <div className="text-center py-8 text-slate-600 text-sm">
                  Drop components here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
