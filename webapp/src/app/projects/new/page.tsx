import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import NewProjectForm from './NewProjectForm';
import { getEntities } from '@/lib/dynamodb/service';
import DemoNewProjectPage from './DemoNewProjectPage';

interface Props {
  searchParams: Promise<{ teamId?: string }>;
}

export default async function NewProjectPage({ searchParams }: Props) {
  const session = await getSession();
  const { user, userId } = session;
  const params = await searchParams;

  // Demo mode - render client-side page that reads from localStorage
  if ('isDemo' in session && session.isDemo) {
    return <DemoNewProjectPage />;
  }

  const entities = getEntities();

  // Get user's teams from DynamoDB
  const membershipsResult = await entities.membership.query.byUser({ userId }).go();

  // Sort by joinedAt descending
  const sortedMemberships = membershipsResult.data.sort(
    (a, b) => new Date(b.joinedAt ?? 0).getTime() - new Date(a.joinedAt ?? 0).getTime(),
  );

  // Fetch team details
  const teams = await Promise.all(
    sortedMemberships.map(async (m) => {
      const teamResult = await entities.team.get({ id: m.teamId }).go();
      return teamResult.data;
    }),
  ).then((results) => results.filter((t): t is NonNullable<typeof t> => t !== null));

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />
      <main className="flex-grow">
        <NewProjectForm teams={teams as any} preselectedTeamId={params.teamId} />
      </main>
    </div>
  );
}
