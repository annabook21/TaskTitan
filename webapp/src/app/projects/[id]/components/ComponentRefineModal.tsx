'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { refineExistingComponent } from '@/app/projects/actions';
import { X, Sparkles, Loader2, MessageSquare, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoActionHandler, isDemoResult, isDemoMode, demoStore } from '@/hooks/use-demo-action';

interface Props {
  component: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    estimatedHours: number | null;
    priority: number;
  };
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ComponentRefineModal({ component, projectId, onClose, onSuccess }: Props) {
  const [chatInput, setChatInput] = useState('');
  const [suggestions] = useState([
    'Break this down into smaller tasks',
    'Increase the estimate by 25%',
    'Add acceptance criteria',
    'Change to higher priority',
  ]);
  const { handleResult } = useDemoActionHandler();
  const inDemoMode = isDemoMode();

  const { execute, isExecuting } = useAction(refineExistingComponent, {
    onSuccess: ({ data }) => {
      if (isDemoResult(data)) {
        // Apply the refined component to demo store
        const refinedData = data as { component?: { id: string; name: string; description: string; estimatedHours: number; priority: number } };
        if (refinedData.component) {
          demoStore.updateComponent(refinedData.component.id, {
            name: refinedData.component.name,
            description: refinedData.component.description,
            estimatedHours: refinedData.component.estimatedHours,
            priority: refinedData.component.priority,
          });
        }
        handleResult(data);
      }
      toast.success('Component updated with AI suggestions');
      onSuccess();
      onClose();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to refine component');
    },
  });

  const handleRefine = (request?: string) => {
    const refinementText = request || chatInput.trim();
    if (!refinementText) {
      toast.error('Please enter a refinement request');
      return;
    }

    // Build demo data if in demo mode
    let demoComponentData;
    if (inDemoMode) {
      const project = demoStore.getProject(projectId);
      const allComponents = demoStore.getComponentsByProject(projectId);
      
      if (project) {
        demoComponentData = {
          name: component.name,
          description: component.description || '',
          type: component.type as 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG',
          estimatedHours: component.estimatedHours || 8,
          priority: Math.floor(component.priority / 10), // Convert to 1-10 scale for AI
          projectName: project.name,
          projectDescription: project.description || '',
          existingComponents: allComponents.map((c) => ({
            name: c.name,
            type: c.type,
          })),
        };
      }
    }

    execute({
      componentId: component.id,
      projectId,
      refinementRequest: refinementText,
      demoComponentData,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-violet-600/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Refine Component</h2>
              <p className="text-sm text-slate-400">{component.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Current Details */}
          <div className="p-3 bg-slate-800/50 rounded-lg text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Type:</span>
              <span className="text-slate-300">{component.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Estimate:</span>
              <span className="text-slate-300">{component.estimatedHours ? `${component.estimatedHours}h` : 'None'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Priority:</span>
              <span className="text-slate-300">{component.priority}</span>
            </div>
          </div>

          {/* Suggested Prompts */}
          <div>
            <label className="text-xs text-slate-500 uppercase tracking-wide mb-2 block">
              Quick Actions
            </label>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => handleRefine(suggestion)}
                  disabled={isExecuting}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-sm transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Input */}
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">
              Or describe your changes
            </label>
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="e.g., 'Split into 3 subtasks' or 'Add testing requirements' or 'Reduce estimate to 8 hours'"
              className="input min-h-[80px] resize-none text-sm"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.metaKey) {
                  handleRefine();
                }
              }}
            />
            <p className="text-xs text-slate-500 mt-1">
              Press Cmd+Enter to apply
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => handleRefine()}
            disabled={isExecuting || !chatInput.trim()}
            className="btn-primary"
          >
            {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
