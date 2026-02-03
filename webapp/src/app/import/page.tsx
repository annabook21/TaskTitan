import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import { redirect } from 'next/navigation';
import ImportWizard from './ImportWizard';
import DemoImportPage from './DemoImportPage';
import { getEntities } from '@/lib/dynamodb/service';

interface Props {
  searchParams: Promise<{ teamId?: string }>;
}

export default async function ImportPage({ searchParams }: Props) {
  const params = await searchParams;
  const session = await getSession();
  const { userId, user } = session;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoImportPage />;
  }

  const entities = getEntities();

  // Get user's memberships
  const membershipsResult = await entities.membership.query.byUser({ userId }).go();
  const teamIds = membershipsResult.data.map((m) => m.teamId);

  if (teamIds.length === 0) {
    redirect('/team/new');
  }

  // Fetch teams with their projects and sprints
  const teamsData = await Promise.all(
    teamIds.map(async (teamId) => {
      const [teamResult, projectsResult, sprintsResult] = await Promise.all([
        entities.team.get({ id: teamId }).go(),
        entities.project.query.byTeam({ teamId }).go(),
        entities.sprint.query.byTeam({ teamId }).go(),
      ]);

      if (!teamResult.data) return null;

      const activeOrPlanningSprints = sprintsResult.data.filter(
        (s) => s.status === 'PLANNING' || s.status === 'ACTIVE',
      );

      return {
        id: teamResult.data.id,
        name: teamResult.data.name,
        Project: projectsResult.data.map((p) => ({ id: p.id, name: p.name })),
        Sprint: activeOrPlanningSprints.map((s) => ({ id: s.id, name: s.name })),
      };
    }),
  );

  const teams = teamsData.filter((t): t is NonNullable<typeof t> => t !== null);

  if (teams.length === 0) {
    redirect('/team/new');
  }

  const selectedTeamId = params.teamId || teams[0].id;
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) || teams[0];

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <ImportWizard teams={teams} selectedTeam={selectedTeam} />
        </div>
      </main>
    </div>
  );
}
