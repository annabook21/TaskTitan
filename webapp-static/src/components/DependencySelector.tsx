import { useState, useEffect } from 'react';
import {
  type Component,
  type Dependency,
  getDependencies,
  getDependents,
  addDependency,
  removeDependency,
} from '../api/appsync';

interface DependencySelectorProps {
  component: Component;
  allComponents: Component[];
  onUpdate?: () => void;
}

export function DependencySelector({ component, allComponents, onUpdate }: DependencySelectorProps) {
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [dependents, setDependents] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Get components that can be added as dependencies (exclude self and existing dependencies)
  const availableComponents = allComponents.filter(
    (c) =>
      c.id !== component.id &&
      !dependencies.some((d) => d.toComponentId === c.id)
  );

  useEffect(() => {
    async function fetchDependencies() {
      try {
        const [deps, depts] = await Promise.all([
          getDependencies(component.id),
          getDependents(component.id),
        ]);
        setDependencies(deps);
        setDependents(depts);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dependencies');
      } finally {
        setLoading(false);
      }
    }

    fetchDependencies();
  }, [component.id]);

  const handleAddDependency = async () => {
    if (!selectedComponentId) return;

    setAdding(true);
    setError(null);
    try {
      const newDep = await addDependency(component.id, selectedComponentId);
      setDependencies((prev) => [...prev, newDep]);
      setSelectedComponentId('');
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add dependency');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveDependency = async (toComponentId: string) => {
    setRemoving(toComponentId);
    setError(null);
    try {
      await removeDependency(component.id, toComponentId);
      setDependencies((prev) => prev.filter((d) => d.toComponentId !== toComponentId));
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove dependency');
    } finally {
      setRemoving(null);
    }
  };

  const getComponentName = (id: string) => {
    const comp = allComponents.find((c) => c.id === id);
    return comp?.name || id;
  };

  const getComponentType = (id: string) => {
    const comp = allComponents.find((c) => c.id === id);
    return comp?.type || 'UNKNOWN';
  };

  if (loading) {
    return <div className="text-sm text-slate-400">Loading dependencies...</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2 bg-red-900/30 border border-red-600/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Dependencies (what this component depends on) */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-2">
          Depends On ({dependencies.length})
        </h4>
        {dependencies.length === 0 ? (
          <p className="text-xs text-slate-500">No dependencies</p>
        ) : (
          <ul className="space-y-1">
            {dependencies.map((dep) => (
              <li
                key={dep.toComponentId}
                className="flex items-center justify-between p-2 bg-slate-800 rounded text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{getComponentType(dep.toComponentId)}</span>
                  <span className="text-white">{getComponentName(dep.toComponentId)}</span>
                </div>
                <button
                  onClick={() => handleRemoveDependency(dep.toComponentId)}
                  disabled={removing === dep.toComponentId}
                  className="text-red-400 hover:text-red-300 disabled:opacity-50 text-xs"
                >
                  {removing === dep.toComponentId ? 'Removing...' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add dependency */}
        <div className="mt-2 flex gap-2">
          <select
            value={selectedComponentId}
            onChange={(e) => setSelectedComponentId(e.target.value)}
            className="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm text-white"
            disabled={adding || availableComponents.length === 0}
          >
            <option value="">Select component...</option>
            {availableComponents.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.type}] {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleAddDependency}
            disabled={!selectedComponentId || adding}
            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 text-white rounded text-sm"
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>

      {/* Dependents (what depends on this component) */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-2">
          Required By ({dependents.length})
        </h4>
        {dependents.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing depends on this component</p>
        ) : (
          <ul className="space-y-1">
            {dependents.map((dep) => (
              <li
                key={dep.fromComponentId}
                className="flex items-center gap-2 p-2 bg-slate-800 rounded text-sm"
              >
                <span className="text-xs text-slate-500">{getComponentType(dep.fromComponentId)}</span>
                <span className="text-white">{getComponentName(dep.fromComponentId)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
