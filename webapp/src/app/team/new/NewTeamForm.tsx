'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAction } from 'next-safe-action/hooks';
import { createTeam } from '../actions';
import { toast } from 'sonner';

export default function NewTeamForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const { execute, isExecuting } = useAction(createTeam, {
    onSuccess: ({ data }) => {
      if (data?.team) {
        toast.success('Team created!');
        router.push(`/team/${data.team.id}`);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to create team');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    execute({
      name,
      description: description || undefined,
    });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link href="/team" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-8">
        <ArrowLeft className="w-4 h-4" />
        Back to Teams
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 flex items-center justify-center">
          <Users className="w-6 h-6 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Create New Team</h1>
          <p className="text-slate-400">Start collaborating with others</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="component-card space-y-6">
        <div>
          <label htmlFor="name" className="input-label">
            Team Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Frontend Team, Startup Squad, Project Alpha"
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
            placeholder="What is this team working on?"
            className="input min-h-[100px] resize-none"
            rows={4}
          />
        </div>

        <div className="p-4 bg-violet-500/10 border border-violet-500/20 rounded-lg">
          <h4 className="font-medium text-violet-300 text-sm mb-2">What happens next?</h4>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>• You&apos;ll be the team owner with full admin rights</li>
            <li>• You can invite team members via email</li>
            <li>• Create projects for your team to collaborate on</li>
          </ul>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
          <Link href="/team" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" className="btn-primary" disabled={isExecuting || !name.trim()}>
            {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create Team
          </button>
        </div>
      </form>
    </div>
  );
}
