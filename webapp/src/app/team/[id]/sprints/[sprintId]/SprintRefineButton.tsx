'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { refineExistingSprint } from '@/app/sprints/actions';
import { MessageSquare, X, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  sprintId: string;
  sprintName: string;
}

export default function SprintRefineButton({ sprintId, sprintName }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [suggestions] = useState([
    'Reduce scope by 20%',
    'Add 8 hours to capacity',
    'Move completed items out',
    'Balance component estimates',
  ]);

  const { execute, isExecuting } = useAction(refineExistingSprint, {
    onSuccess: ({ data }) => {
      toast.success('Sprint updated with AI suggestions');
      setIsOpen(false);
      setChatInput('');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to refine sprint');
    },
  });

  const handleRefine = (request?: string) => {
    const refinementText = request || chatInput.trim();
    if (!refinementText) {
      toast.error('Please enter a refinement request');
      return;
    }

    execute({
      sprintId,
      refinementRequest: refinementText,
    });
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="btn-secondary text-sm">
        <MessageSquare className="w-4 h-4" />
        Refine with AI
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-600/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Refine Sprint</h2>
              <p className="text-sm text-slate-400">{sprintName}</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-200 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
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
              placeholder="e.g., 'Move User Login to next sprint' or 'Update goal to focus on backend' or 'Increase capacity to 80 hours'"
              className="input min-h-[100px] resize-none text-sm"
              rows={4}
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

          {/* Info */}
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-slate-400">
            <p className="mb-2 text-amber-300 font-medium">AI can help you:</p>
            <ul className="space-y-1">
              <li>• Adjust sprint goals and capacity</li>
              <li>• Move components between sprints</li>
              <li>• Update estimates based on progress</li>
              <li>• Balance workload across team</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800">
          <button onClick={() => setIsOpen(false)} className="btn-secondary">
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
