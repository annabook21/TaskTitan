'use client';

import { useMemo } from 'react';
import type { ComponentStatus, User } from '@prisma/client';

interface ComponentWithDetails {
  id: string;
  name: string;
  status: ComponentStatus;
  estimatedHours: number | null;
  dueDate: Date | null;
  createdAt: Date;
  assignments: { user: User }[];
  dependsOn: { requiredComponent: { id: string; name: string; status: ComponentStatus } }[];
}

interface Props {
  components: ComponentWithDetails[];
}

const statusColors: Record<ComponentStatus, { bg: string; border: string; text: string }> = {
  PLANNING: { bg: 'bg-violet-500/20', border: 'border-violet-500/40', text: 'text-violet-400' },
  IN_PROGRESS: { bg: 'bg-cyan-500/20', border: 'border-cyan-500/40', text: 'text-cyan-400' },
  BLOCKED: { bg: 'bg-red-500/20', border: 'border-red-500/40', text: 'text-red-400' },
  REVIEW: { bg: 'bg-amber-500/20', border: 'border-amber-500/40', text: 'text-amber-400' },
  COMPLETED: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-400' },
};

export default function TimelineView({ components }: Props) {
  // Sort components by dependencies (topological sort)
  const sortedComponents = useMemo(() => {
    const visited = new Set<string>();
    const result: ComponentWithDetails[] = [];
    const componentMap = new Map(components.map((c) => [c.id, c]));

    function visit(id: string) {
      if (visited.has(id)) return;
      const comp = componentMap.get(id);
      if (!comp) return;

      // Visit dependencies first
      for (const dep of comp.dependsOn) {
        visit(dep.requiredComponent.id);
      }

      visited.add(id);
      result.push(comp);
    }

    // Visit all components
    for (const comp of components) {
      visit(comp.id);
    }

    return result;
  }, [components]);

  // Calculate timeline data
  const timelineData = useMemo(() => {
    let cumulativeHours = 0;
    return sortedComponents.map((comp) => {
      const hours = comp.estimatedHours || 8;
      const startHours = cumulativeHours;
      cumulativeHours += hours;

      // Check if blocked by incomplete dependencies
      const blockedBy = comp.dependsOn
        .filter((d) => d.requiredComponent.status !== 'COMPLETED')
        .map((d) => d.requiredComponent.name);

      return {
        ...comp,
        startHours,
        endHours: cumulativeHours,
        hours,
        blockedBy,
      };
    });
  }, [sortedComponents]);

  const totalHours = timelineData[timelineData.length - 1]?.endHours || 0;
  const maxWidth = Math.max(totalHours * 10, 600); // 10px per hour, minimum 600px

  if (components.length === 0) {
    return null;
  }

  return (
    <div className="component-card">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        📅 Timeline View
        <span className="text-sm font-normal text-slate-500">{totalHours} hours total</span>
      </h3>

      <div className="overflow-x-auto">
        <div className="min-w-[600px]" style={{ width: `${maxWidth}px` }}>
          {/* Time scale */}
          <div className="flex items-center h-8 border-b border-slate-700 mb-2">
            {Array.from({ length: Math.ceil(totalHours / 8) + 1 }, (_, i) => (
              <div key={i} className="flex-shrink-0 text-xs text-slate-500" style={{ width: '80px' }}>
                {i * 8}h
              </div>
            ))}
          </div>

          {/* Bars */}
          <div className="space-y-3">
            {timelineData.map((comp) => {
              const colors = statusColors[comp.status];
              const widthPercent = (comp.hours / totalHours) * 100;
              const leftPercent = (comp.startHours / totalHours) * 100;

              return (
                <div key={comp.id} className="flex items-center gap-4">
                  {/* Component name */}
                  <div className="w-40 flex-shrink-0 text-sm truncate" title={comp.name}>
                    {comp.name}
                  </div>

                  {/* Bar container */}
                  <div className="flex-1 h-10 relative bg-slate-800/50 rounded">
                    {/* The bar */}
                    <div
                      className={`absolute h-full rounded ${colors.bg} ${colors.border} border transition-all`}
                      style={{
                        left: `${leftPercent}%`,
                        width: `${Math.max(widthPercent, 2)}%`,
                      }}
                    >
                      <div className="flex items-center h-full px-2 gap-2">
                        {/* Status indicator */}
                        <span className={`text-xs font-medium ${colors.text}`}>{comp.status.replace('_', ' ')}</span>

                        {/* Hours */}
                        <span className="text-xs text-slate-400">{comp.hours}h</span>

                        {/* Assignees */}
                        {comp.assignments.length > 0 && (
                          <div className="flex -space-x-1">
                            {comp.assignments.slice(0, 2).map(({ user }) => (
                              <div
                                key={user.id}
                                className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center text-xs font-medium border border-slate-900"
                                title={user.name || user.email}
                              >
                                {user.name?.[0] || user.email[0].toUpperCase()}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Blocked indicator */}
                        {comp.blockedBy.length > 0 && (
                          <span className="text-xs text-red-400" title={`Blocked by: ${comp.blockedBy.join(', ')}`}>
                            ⚠️
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-6 pt-4 border-t border-slate-800 text-xs">
            {Object.entries(statusColors).map(([status, colors]) => (
              <div key={status} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded ${colors.bg} ${colors.border} border`} />
                <span className="text-slate-400">{status.replace('_', ' ').toLowerCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
