'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { aiPlanSprintAction, applySprintPlan } from '@/app/sprints/actions';
import { Sparkles, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  sprintId: string;
  defaultCapacity?: number;
}

interface PlanResult {
  selectedComponentIds: string[];
  totalHours: number;
  reasoning: string;
  warnings: string[];
}

export default function AISprintPlanner({ sprintId, defaultCapacity = 40 }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [capacity, setCapacity] = useState(defaultCapacity);
  const [plan, setPlan] = useState<PlanResult | null>(null);

  const { execute: generatePlan, isExecuting: isGenerating } = useAction(aiPlanSprintAction, {
    onSuccess: ({ data }) => {
      if (data) {
        setPlan(data);
        if (data.selectedComponentIds.length === 0) {
          toast.info('No components available for this sprint');
        }
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to generate sprint plan');
    },
  });

  const { execute: applyPlan, isExecuting: isApplying } = useAction(applySprintPlan, {
    onSuccess: ({ data }) => {
      toast.success(`Added ${data?.assignedCount} components to sprint!`);
      setPlan(null);
      setIsOpen(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to apply sprint plan');
    },
  });

  const handleGenerate = () => {
    setPlan(null);
    generatePlan({ sprintId, capacityHours: capacity });
  };

  const handleApply = () => {
    if (plan && plan.selectedComponentIds.length > 0) {
      applyPlan({ sprintId, componentIds: plan.selectedComponentIds });
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-violet-500/20"
      >
        <Sparkles className="w-4 h-4" />
        AI Plan Sprint
      </button>
    );
  }

  return (
    <div className="bg-slate-800/50 border border-violet-500/30 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-400" />
          AI Sprint Planner
        </h3>
        <button
          onClick={() => {
            setIsOpen(false);
            setPlan(null);
          }}
          className="text-slate-400 hover:text-white text-sm"
        >
          Cancel
        </button>
      </div>

      <p className="text-slate-400 text-sm">
        Let AI suggest which components to include based on capacity, priorities, and dependencies.
      </p>

      <div className="flex items-center gap-4">
        <label className="text-sm text-slate-300">Sprint Capacity (hours):</label>
        <input
          type="number"
          value={capacity}
          onChange={(e) => setCapacity(parseInt(e.target.value) || 40)}
          min={1}
          max={1000}
          className="w-24 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate Plan
            </>
          )}
        </button>
      </div>

      {plan && (
        <div className="space-y-4 pt-4 border-t border-slate-700">
          <div className="bg-slate-900/50 rounded-lg p-4">
            <p className="text-slate-300 mb-3">{plan.reasoning}</p>

            <div className="flex items-center gap-6 text-sm">
              <span className="text-cyan-400">
                <strong>{plan.selectedComponentIds.length}</strong> components selected
              </span>
              <span className="text-amber-400">
                <strong>{plan.totalHours}</strong> estimated hours
              </span>
              <span className="text-slate-400">
                {capacity > 0 ? Math.round((plan.totalHours / capacity) * 100) : 0}% capacity
              </span>
            </div>
          </div>

          {plan.warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <h4 className="text-amber-400 font-medium flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4" />
                Warnings
              </h4>
              <ul className="text-sm text-amber-300/80 space-y-1">
                {plan.warnings.map((warning, i) => (
                  <li key={i}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.selectedComponentIds.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={handleApply}
                disabled={isApplying}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Apply Plan
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
