import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import MetricsClient from './MetricsClient';
import DemoMetricsPage from './DemoMetricsPage';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function MetricsPage({ params }: Props) {
  const { id: teamId } = await params;
  const session = await getSession();
  const { userId } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoMetricsPage />;
  }

  // Check membership via DynamoDB
  const access = await verifyTeamMembership(userId, teamId);
  if (!access) {
    notFound();
  }

  const entities = getEntities();
  const workflowConfigResult = await entities.teamWorkflowConfig.get({ teamId }).go();
  const workflowConfig = workflowConfigResult.data;

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

      <MetricsClient teamId={teamId} workflowConfig={workflowConfig as any} />
    </div>
  );
}
