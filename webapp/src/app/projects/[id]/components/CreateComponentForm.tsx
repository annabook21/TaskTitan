'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { createComponent } from '@/app/projects/actions';
import { Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  projectId: string;
}

export default function CreateComponentForm({ projectId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [priority, setPriority] = useState('0');

  const { execute, isExecuting } = useAction(createComponent, {
    onSuccess: () => {
      toast.success('Component created!');
      setIsOpen(false);
      setName('');
      setDescription('');
      setEstimatedHours('');
      setPriority('0');
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to create component');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    execute({
      projectId,
      name,
      description: description || undefined,
      estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
      priority: parseInt(priority),
    });
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="btn-primary">
        <Plus className="w-5 h-5" />
        Add Component
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold">Add New Component</h2>
          <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 hover:text-slate-200 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label htmlFor="name" className="input-label">
              Component Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., User Authentication, Shopping Cart"
              className="input"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="description" className="input-label">
              Description <span className="text-slate-500">(optional)</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this component do? What are its responsibilities?"
              className="input min-h-[80px] resize-none"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="estimatedHours" className="input-label">
                Estimated Hours
              </label>
              <input
                id="estimatedHours"
                type="number"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="0"
                className="input"
                min="0"
                step="0.5"
              />
            </div>

            <div>
              <label htmlFor="priority" className="input-label">
                Priority (0-100)
              </label>
              <input
                id="priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="0"
                className="input"
                min="0"
                max="100"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button type="button" onClick={() => setIsOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isExecuting || !name.trim()}>
              {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Component
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
