'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { demoStore, DEMO_USER } from '@/lib/demo';
import Link from 'next/link';
import MetricsClient from './MetricsClient';
import type { TeamWorkflowConfig } from '@/lib/prisma-compat';

export default function DemoMetricsPage() {
  const params = useParams();
  const teamId = params.id as string;
  const [workflowConfig, setWorkflowConfig] = useState<TeamWorkflowConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const store = demoStore.getStore();
    const team = store.teams.find((t) => t.id === teamId);
    const membership = store.memberships.find((m) => m.teamId === teamId && m.userId === DEMO_USER.id);

    if (!team || !membership) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const config = store.workflowConfigs.find((w) => w.teamId === teamId);
    setWorkflowConfig(
      config
        ? ({
            id: config.id,
            teamId: config.teamId,
            wipLimitPlanning: config.wipLimitPlanning,
            wipLimitInProgress: config.wipLimitInProgress,
            wipLimitBlocked: config.wipLimitBlocked,
            wipLimitReview: config.wipLimitReview,
            cycleEnabled: config.cycleEnabled,
            cycleDurationWeeks: config.cycleDurationWeeks,
            cycleStartDayOfWeek: config.cycleStartDayOfWeek,
            workflowTemplate: config.workflowTemplate,
            cycleName: config.cycleName,
            backlogName: config.backlogName,
            enforceEstimates: config.enforceEstimates,
            autoArchiveCompleted: config.autoArchiveCompleted,
            createdAt: new Date(config.createdAt),
            updatedAt: new Date(config.updatedAt),
          } as TeamWorkflowConfig)
        : null,
    );
    setLoading(false);
  }, [teamId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading metrics...</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-300 mb-2">Team not found</h1>
          <p className="text-slate-500 mb-4">This team doesn&apos;t exist in demo mode.</p>
          <Link href="/team" className="btn-primary">
            Back to Teams
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Team Metrics</h1>
        <p className="text-slate-400">
          {workflowConfig?.cycleEnabled
            ? `Track your team's performance across ${workflowConfig.cycleName?.toLowerCase() || 'sprint'}s`
            : "Track your team's flow metrics and throughput"}
        </p>
      </div>

      <MetricsClient teamId={teamId} workflowConfig={workflowConfig} />
    </div>
  );
}
