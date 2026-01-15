import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import MetricsClient from './MetricsClient';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MetricsPage({ params }: Props) {
  const { id: teamId } = await params;
  const { userId } = await getSession();

  // Check membership
  const membership = await prisma.membership.findFirst({
    where: { teamId, userId },
    include: {
      Team: {
        include: {
          WorkflowConfig: true,
        },
      },
    },
  });

  if (!membership) {
    notFound();
  }

  const team = membership.Team;
  const workflowConfig = team.WorkflowConfig;

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
