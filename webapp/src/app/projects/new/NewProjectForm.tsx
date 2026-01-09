'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, ArrowLeft, Sparkles, Loader2, Users, Plus, Check } from 'lucide-react';
import Link from 'next/link';
import { useAction } from 'next-safe-action/hooks';
import { createProject } from '../actions';
import { createTeam } from '@/app/team/actions';
import { toast } from 'sonner';

interface Team {
  id: string;
  name: string;
  description: string | null;
}

interface NewProjectFormProps {
  teams: Team[];
  preselectedTeamId?: string;
}

export default function NewProjectForm({ teams, preselectedTeamId }: NewProjectFormProps) {
  const router = useRouter();
  const hasExistingTeams = teams.length > 0;

  // If user has teams and one is preselected, skip to project step
  const [step, setStep] = useState<'team' | 'project'>(
    preselectedTeamId && teams.some((t) => t.id === preselectedTeamId) ? 'project' : 'team'
  );
  const [teamId, setTeamId] = useState<string>(preselectedTeamId || '');
  const [teamMode, setTeamMode] = useState<'select' | 'create'>(hasExistingTeams ? 'select' : 'create');
  const [teamName, setTeamName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

  // Set teamId if preselected
  useEffect(() => {
    if (preselectedTeamId && teams.some((t) => t.id === preselectedTeamId)) {
      setTeamId(preselectedTeamId);
    }
  }, [preselectedTeamId, teams]);

  const { execute: executeCreateTeam, isExecuting: isCreatingTeam } = useAction(createTeam, {
    onSuccess: ({ data }) => {
      if (data?.team) {
        setTeamId(data.team.id);
        setStep('project');
        toast.success('Team created!');
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to create team');
    },
  });

  const { execute: executeCreateProject, isExecuting: isCreatingProject } = useAction(createProject, {
    onSuccess: ({ data }) => {
      if (data?.project) {
        toast.success('Project created!');
        router.push(`/projects/${data.project.id}`);
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError || 'Failed to create project');
    },
  });

  const handleTeamSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (teamMode === 'select' && teamId) {
      setStep('project');
    } else if (teamMode === 'create' && teamName.trim()) {
      executeCreateTeam({ name: teamName });
    }
  };

  const handleProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCreateProject({
      name: projectName,
      description: projectDescription || undefined,
      teamId,
    });
  };

  const selectedTeam = teams.find((t) => t.id === teamId);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/projects"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center">
          <FolderKanban className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Create New Project</h1>
          <p className="text-slate-400">Set up your project and start planning</p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-4 mb-8">
        <div className={`flex items-center gap-2 ${step === 'team' ? 'text-cyan-400' : 'text-slate-400'}`}>
          <span
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
            ${step === 'team' ? 'bg-cyan-500/20 border border-cyan-500' : 'bg-slate-800 border border-slate-700'}`}
          >
            {step === 'project' ? <Check className="w-4 h-4" /> : '1'}
          </span>
          <span className="text-sm font-medium">Select Team</span>
        </div>
        <div className="flex-1 h-px bg-slate-700" />
        <div className={`flex items-center gap-2 ${step === 'project' ? 'text-cyan-400' : 'text-slate-500'}`}>
          <span
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
            ${step === 'project' ? 'bg-cyan-500/20 border border-cyan-500' : 'bg-slate-800 border border-slate-700'}`}
          >
            2
          </span>
          <span className="text-sm font-medium">Project Details</span>
        </div>
      </div>

      {/* Forms */}
      {step === 'team' ? (
        <form onSubmit={handleTeamSubmit} className="component-card space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-1">Select or create a team</h2>
            <p className="text-sm text-slate-400">Projects belong to teams for collaboration.</p>
          </div>

          {/* Team Mode Toggle */}
          {hasExistingTeams && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTeamMode('select')}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  teamMode === 'select'
                    ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-400'
                    : 'bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <Users className="w-4 h-4 inline mr-2" />
                Use Existing Team
              </button>
              <button
                type="button"
                onClick={() => setTeamMode('create')}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                  teamMode === 'create'
                    ? 'bg-cyan-500/20 border border-cyan-500 text-cyan-400'
                    : 'bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <Plus className="w-4 h-4 inline mr-2" />
                Create New Team
              </button>
            </div>
          )}

          {teamMode === 'select' && hasExistingTeams ? (
            /* Select Existing Team */
            <div>
              <label className="input-label">Select Team</label>
              <div className="space-y-2">
                {teams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setTeamId(team.id)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      teamId === team.id
                        ? 'bg-cyan-500/10 border-cyan-500'
                        : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                          <Users className="w-5 h-5 text-violet-400" />
                        </div>
                        <div>
                          <div className="font-medium text-slate-200">{team.name}</div>
                          {team.description && (
                            <div className="text-sm text-slate-500 truncate max-w-[300px]">
                              {team.description}
                            </div>
                          )}
                        </div>
                      </div>
                      {teamId === team.id && (
                        <div className="w-6 h-6 rounded-full bg-cyan-500 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Create New Team */
            <div>
              <label htmlFor="teamName" className="input-label">
                Team Name
              </label>
              <input
                id="teamName"
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g., Frontend Team, Startup Squad"
                className="input"
                required={teamMode === 'create'}
              />
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Link href="/projects" className="btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="btn-primary"
              disabled={
                isCreatingTeam ||
                (teamMode === 'select' && !teamId) ||
                (teamMode === 'create' && !teamName.trim())
              }
            >
              {isCreatingTeam ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Continue
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleProjectSubmit} className="component-card space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-1">Project Details</h2>
            <p className="text-sm text-slate-400">
              Creating project for team:{' '}
              <span className="text-cyan-400 font-medium">{selectedTeam?.name}</span>
            </p>
          </div>

          <div>
            <label htmlFor="projectName" className="input-label">
              Project Name
            </label>
            <input
              id="projectName"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g., E-commerce App, Chat Platform"
              className="input"
              required
            />
          </div>

          <div>
            <label htmlFor="projectDescription" className="input-label">
              Description <span className="text-slate-500">(optional but recommended for AI)</span>
            </label>
            <textarea
              id="projectDescription"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="Describe your project in detail. The more detail, the better AI suggestions you'll get..."
              className="input min-h-[120px] resize-none"
              rows={5}
            />
          </div>

          <div className="p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-cyan-300 text-sm">AI Component Generation</h4>
                <p className="text-xs text-slate-400 mt-1">
                  After creating your project, you can use AI to automatically suggest components based on your
                  description. Add a detailed description above for best results!
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setStep('team')}>
              Back
            </button>
            <button type="submit" className="btn-primary" disabled={isCreatingProject || !projectName.trim()}>
              {isCreatingProject ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create Project
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
