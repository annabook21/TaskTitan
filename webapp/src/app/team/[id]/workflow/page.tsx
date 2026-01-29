import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Settings } from 'lucide-react';
import WorkflowSettingsForm from './WorkflowSettingsForm';
import DemoWorkflowSettingsPage from './DemoWorkflowSettingsPage';
import { getEntities } from '@/lib/dynamodb/service';
import { verifyTeamMembership } from '@/lib/dynamodb/auth-helpers';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WorkflowSettingsPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoWorkflowSettingsPage />;
  }

  const entities = getEntities();

  // Verify user is owner or admin
  const access = await verifyTeamMembership(userId, id);
  if (!access || (access.membership.role !== 'OWNER' && access.membership.role !== 'ADMIN')) {
    notFound();
  }

  // Get team and workflow config
  const [teamResult, workflowConfigResult] = await Promise.all([
    entities.team.get({ id }).go(),
    entities.teamWorkflowConfig.get({ teamId: id }).go(),
  ]);

  const team = teamResult.data;
  if (!team) {
    notFound();
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${id}`}
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
              <p className="text-slate-400">Configure workflow preferences for {team.name}</p>
            </div>
          </div>

          {/* Settings Form */}
          <WorkflowSettingsForm teamId={team.id} config={workflowConfigResult.data as any} />
        </div>
      </main>
    </div>
  );
}
