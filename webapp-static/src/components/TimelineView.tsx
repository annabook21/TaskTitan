import { useMemo } from 'react';
import type { Component, ComponentStatus } from '../api/appsync';

interface TimelineViewProps {
  components: Component[];
  onComponentClick?: (component: Component) => void;
}

const statusColors: Record<ComponentStatus, { bg: string; border: string; text: string }> = {
  PLANNING: { bg: 'bg-violet-500/20', border: 'border-violet-500/40', text: 'text-violet-400' },
  IN_PROGRESS: { bg: 'bg-cyan-500/20', border: 'border-cyan-500/40', text: 'text-cyan-400' },
  BLOCKED: { bg: 'bg-red-500/20', border: 'border-red-500/40', text: 'text-red-400' },
  REVIEW: { bg: 'bg-amber-500/20', border: 'border-amber-500/40', text: 'text-amber-400' },
  COMPLETED: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-400' },
};

const typeColors: Record<string, string> = {
  EPIC: 'text-violet-400',
  FEATURE: 'text-blue-400',
  STORY: 'text-cyan-400',
  TASK: 'text-emerald-400',
  BUG: 'text-red-400',
};

export function TimelineView({ components, onComponentClick }: TimelineViewProps) {
  // Sort components by priority (higher first), then by type hierarchy
  const sortedComponents = useMemo(() => {
    const typeOrder = { EPIC: 0, FEATURE: 1, STORY: 2, TASK: 3, BUG: 4 };
    return [...components].sort((a, b) => {
      // First by type hierarchy
      const typeA = typeOrder[a.type as keyof typeof typeOrder] ?? 5;
      const typeB = typeOrder[b.type as keyof typeof typeOrder] ?? 5;
      if (typeA !== typeB) return typeA - typeB;
      // Then by priority (higher first)
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
  }, [components]);

  // Calculate timeline data
  const timelineData = useMemo(() => {
    let cumulativeHours = 0;
    return sortedComponents.map((comp) => {
      const hours = comp.estimatedHours || 8;
      const startHours = cumulativeHours;
      cumulativeHours += hours;

      return {
        ...comp,
        startHours,
        endHours: cumulativeHours,
        hours,
      };
    });
  }, [sortedComponents]);

  const totalHours = timelineData[timelineData.length - 1]?.endHours || 0;
  const maxWidth = Math.max(totalHours * 10, 600); // 10px per hour, minimum 600px

  if (components.length === 0) {
    return (
      <div className="text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
        <p className="text-slate-400">No components to display in timeline.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          Timeline View
          <span className="text-sm font-normal text-slate-500">{totalHours} hours total</span>
        </h3>
        <div className="text-xs text-slate-400">
          {components.length} components
        </div>
      </div>

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
          <div className="space-y-2">
            {timelineData.map((comp) => {
              const colors = statusColors[comp.status];
              const widthPercent = (comp.hours / totalHours) * 100;
              const leftPercent = (comp.startHours / totalHours) * 100;

              return (
                <div
                  key={comp.id}
                  className="flex items-center gap-3 cursor-pointer hover:bg-slate-700/30 rounded transition-colors py-1 px-1 -mx-1"
                  onClick={() => onComponentClick?.(comp)}
                >
                  {/* Component name and type */}
                  <div className="w-44 flex-shrink-0">
                    <div className="text-sm truncate" title={comp.name}>
                      {comp.name}
                    </div>
                    <div className={`text-xs ${typeColors[comp.type] || 'text-slate-400'}`}>
                      {comp.type}
                    </div>
                  </div>

                  {/* Bar container */}
                  <div className="flex-1 h-9 relative bg-slate-900/50 rounded">
                    {/* The bar */}
                    <div
                      className={`absolute h-full rounded ${colors.bg} ${colors.border} border transition-all`}
                      style={{
                        left: `${leftPercent}%`,
                        width: `${Math.max(widthPercent, 3)}%`,
                      }}
                    >
                      <div className="flex items-center h-full px-2 gap-2 overflow-hidden">
                        {/* Status indicator */}
                        <span className={`text-xs font-medium ${colors.text} whitespace-nowrap`}>
                          {comp.status.replace('_', ' ')}
                        </span>

                        {/* Hours */}
                        <span className="text-xs text-slate-400 whitespace-nowrap">{comp.hours}h</span>

                        {/* Priority badge */}
                        {comp.priority != null && comp.priority >= 70 && (
                          <span className="text-xs bg-amber-500/20 text-amber-300 px-1.5 rounded whitespace-nowrap">
                            P{comp.priority}
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
          <div className="flex flex-wrap items-center gap-4 mt-6 pt-4 border-t border-slate-700 text-xs">
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
