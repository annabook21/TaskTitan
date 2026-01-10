'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { createSprint } from '@/app/sprints/actions';
import { Loader2, Zap, Calendar, Target, Clock } from 'lucide-react';

interface Props {
  teamId: string;
  suggestedName: string;
  suggestedStartDate: string;
  suggestedEndDate: string;
}

export default function NewSprintForm({
  teamId,
  suggestedName,
  suggestedStartDate,
  suggestedEndDate,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState(suggestedStartDate);
  const [endDate, setEndDate] = useState(suggestedEndDate);
  const [capacity, setCapacity] = useState<string>('');

  const { execute, isExecuting, result } = useAction(createSprint, {
    onSuccess: (data) => {
      if (data.data?.sprint) {
        router.push(`/team/${teamId}/sprints/${data.data.sprint.id}`);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    execute({
      teamId,
      name,
      goal: goal || undefined,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      capacity: capacity ? parseInt(capacity, 10) : undefined,
    });
  };

  // Calculate sprint duration
  const durationDays = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Sprint Name */}
      <div className="component-card">
        <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2">
          <Zap className="w-4 h-4 inline mr-2 text-amber-400" />
          Sprint Name
        </label>
        <input
          type="text"
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Sprint 1, Q1 Week 3, January Release"
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all text-slate-100 placeholder-slate-500"
          required
        />
      </div>

      {/* Sprint Goal */}
      <div className="component-card">
        <label htmlFor="goal" className="block text-sm font-medium text-slate-300 mb-2">
          <Target className="w-4 h-4 inline mr-2 text-cyan-400" />
          Sprint Goal
          <span className="text-slate-500 font-normal ml-2">(optional)</span>
        </label>
        <textarea
          id="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What does the team aim to accomplish this sprint?"
          rows={3}
          className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all text-slate-100 placeholder-slate-500 resize-none"
        />
      </div>

      {/* Date Range */}
      <div className="component-card">
        <label className="block text-sm font-medium text-slate-300 mb-4">
          <Calendar className="w-4 h-4 inline mr-2 text-violet-400" />
          Sprint Duration
        </label>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="startDate" className="block text-xs text-slate-500 mb-1">
              Start Date
            </label>
            <input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all text-slate-100"
              required
            />
          </div>

          <div>
            <label htmlFor="endDate" className="block text-xs text-slate-500 mb-1">
              End Date
            </label>
            <input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all text-slate-100"
              required
            />
          </div>
        </div>

        {durationDays > 0 && (
          <p className="text-sm text-slate-400 mt-3">
            📅 {durationDays} day{durationDays !== 1 ? 's' : ''} 
            {durationDays === 7 && ' (1 week)'}
            {durationDays === 14 && ' (2 weeks)'}
            {durationDays === 21 && ' (3 weeks)'}
          </p>
        )}
      </div>

      {/* Capacity */}
      <div className="component-card">
        <label htmlFor="capacity" className="block text-sm font-medium text-slate-300 mb-2">
          <Clock className="w-4 h-4 inline mr-2 text-green-400" />
          Team Capacity
          <span className="text-slate-500 font-normal ml-2">(optional)</span>
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            id="capacity"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="e.g., 80"
            min="1"
            className="w-32 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all text-slate-100 placeholder-slate-500"
          />
          <span className="text-slate-400">hours</span>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Total available hours for the team this sprint. Used to calculate capacity utilization.
        </p>
      </div>

      {/* Error message */}
      {result.serverError && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
          {result.serverError}
        </div>
      )}

      {/* Submit */}
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isExecuting || !name || !startDate || !endDate}
          className="flex-1 btn-primary justify-center disabled:opacity-50"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Create Sprint
            </>
          )}
        </button>
      </div>
    </form>
  );
}
