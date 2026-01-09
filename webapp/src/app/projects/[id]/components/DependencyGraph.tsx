'use client';

import { useMemo } from 'react';
import type { ComponentStatus } from '@prisma/client';

interface ComponentWithDeps {
  id: string;
  name: string;
  status: ComponentStatus;
  dependsOn: { requiredComponent: { id: string; name: string } }[];
  dependedOnBy: { dependentComponent: { id: string; name: string } }[];
}

interface Props {
  components: ComponentWithDeps[];
}

const statusColors: Record<ComponentStatus, string> = {
  PLANNING: '#a78bfa',
  IN_PROGRESS: '#22d3ee',
  BLOCKED: '#f87171',
  REVIEW: '#fbbf24',
  COMPLETED: '#4ade80',
};

export default function DependencyGraph({ components }: Props) {
  // Simple visualization - show dependencies as a list
  // For a full graph, we'd use a library like react-flow or d3

  const componentsWithDeps = useMemo(() => {
    return components.filter((c) => c.dependsOn.length > 0 || c.dependedOnBy.length > 0);
  }, [components]);

  if (componentsWithDeps.length === 0) {
    return (
      <div className="component-card text-center py-8">
        <p className="text-sm text-slate-500">
          No dependencies defined yet. Add dependencies between components to see the graph.
        </p>
      </div>
    );
  }

  return (
    <div className="component-card overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Simple dependency visualization */}
        <div className="relative">
          {/* Legend */}
          <div className="flex items-center gap-4 mb-6 text-xs">
            {Object.entries(statusColors).map(([status, color]) => (
              <div key={status} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-slate-400">{status.replace('_', ' ').toLowerCase()}</span>
              </div>
            ))}
          </div>

          {/* Dependency Tree */}
          <div className="space-y-4">
            {components.map((component) => {
              const hasDeps = component.dependsOn.length > 0;
              const hasDependents = component.dependedOnBy.length > 0;

              if (!hasDeps && !hasDependents) return null;

              return (
                <div key={component.id} className="flex items-center gap-4">
                  {/* Dependents (what depends on this) */}
                  <div className="flex-1 flex justify-end gap-2">
                    {component.dependedOnBy.map((dep) => {
                      const depComponent = components.find((c) => c.id === dep.dependentComponent.id);
                      return (
                        <div
                          key={dep.dependentComponent.id}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium border"
                          style={{
                            borderColor: depComponent ? statusColors[depComponent.status] + '40' : '#475569',
                            backgroundColor: depComponent ? statusColors[depComponent.status] + '10' : '#1e293b',
                          }}
                        >
                          {dep.dependentComponent.name}
                        </div>
                      );
                    })}
                  </div>

                  {/* Arrows */}
                  {hasDependents && (
                    <div className="flex items-center gap-1 text-slate-600">
                      <div className="w-8 h-px bg-slate-600" />
                      <span>→</span>
                    </div>
                  )}

                  {/* Current Component */}
                  <div
                    className="px-4 py-2 rounded-lg text-sm font-semibold border-2 flex-shrink-0"
                    style={{
                      borderColor: statusColors[component.status],
                      backgroundColor: statusColors[component.status] + '20',
                      color: statusColors[component.status],
                    }}
                  >
                    {component.name}
                  </div>

                  {/* Arrows */}
                  {hasDeps && (
                    <div className="flex items-center gap-1 text-slate-600">
                      <span>→</span>
                      <div className="w-8 h-px bg-slate-600" />
                    </div>
                  )}

                  {/* Dependencies (what this depends on) */}
                  <div className="flex-1 flex gap-2">
                    {component.dependsOn.map((dep) => {
                      const depComponent = components.find((c) => c.id === dep.requiredComponent.id);
                      return (
                        <div
                          key={dep.requiredComponent.id}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium border"
                          style={{
                            borderColor: depComponent ? statusColors[depComponent.status] + '40' : '#475569',
                            backgroundColor: depComponent ? statusColors[depComponent.status] + '10' : '#1e293b',
                          }}
                        >
                          {dep.requiredComponent.name}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Help text */}
          <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-500 text-center">
            Components on the left depend on the center component. Components on the right are required by the center
            component.
          </div>
        </div>
      </div>
    </div>
  );
}
