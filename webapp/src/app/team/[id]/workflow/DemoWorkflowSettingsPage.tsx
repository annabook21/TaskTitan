'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Header from '@/components/Header';
import Link from 'next/link';
import { ArrowLeft, Settings } from 'lucide-react';
import WorkflowSettingsForm from './WorkflowSettingsForm';
import type { TeamWorkflowConfig } from '@prisma/client';

export default function DemoWorkflowSettingsPage() {
  const params = useParams();
  const teamId = params.id as string;
  const [teamName, setTeamName] = useState('');
  const [config, setConfig] = useState<TeamWorkflowConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const store = demoStore.getStore();
    const team = store.teams.find((t) => t.id === teamId);

    if (!team) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setTeamName(team.name);

    const workflowConfig = store.workflowConfigs.find((w) => w.teamId === teamId);
    setConfig(
      workflowConfig
        ? ({
            id: workflowConfig.id,
            teamId: workflowConfig.teamId,
            wipLimitPlanning: workflowConfig.wipLimitPlanning,
            wipLimitInProgress: workflowConfig.wipLimitInProgress,
            wipLimitBlocked: workflowConfig.wipLimitBlocked,
            wipLimitReview: workflowConfig.wipLimitReview,
            cycleEnabled: workflowConfig.cycleEnabled,
            cycleDurationWeeks: workflowConfig.cycleDurationWeeks,
            cycleStartDayOfWeek: workflowConfig.cycleStartDayOfWeek,
            workflowTemplate: workflowConfig.workflowTemplate,
            cycleName: workflowConfig.cycleName,
            backlogName: workflowConfig.backlogName,
            enforceEstimates: workflowConfig.enforceEstimates,
            autoArchiveCompleted: workflowConfig.autoArchiveCompleted,
            createdAt: new Date(workflowConfig.createdAt),
            updatedAt: new Date(workflowConfig.updatedAt),
          } as TeamWorkflowConfig)
        : null,
    );
    setLoading(false);
  }, [teamId]);

  const user = {
    id: DEMO_USER.id,
    name: DEMO_USER.name,
    email: DEMO_USER.email,
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="animate-pulse text-slate-400">Loading settings...</div>
        </main>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header user={user} />
        <main className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-300 mb-2">Team not found</h1>
            <p className="text-slate-500 mb-4">This team doesn&apos;t exist in demo mode.</p>
            <Link href="/team" className="btn-primary">
              Back to Teams
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${teamId}`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Team
          </Link>

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center">
              <Settings className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Workflow Settings</h1>
              <p className="text-slate-400">Configure workflow preferences for {teamName}</p>
            </div>
          </div>

          <WorkflowSettingsForm teamId={teamId} config={config} />
        </div>
      </main>
    </div>
  );
}
