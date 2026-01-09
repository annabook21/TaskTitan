import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import NewProjectForm from './NewProjectForm';
import { prisma } from '@/lib/prisma';

interface Props {
  searchParams: Promise<{ teamId?: string }>;
}

export default async function NewProjectPage({ searchParams }: Props) {
  const { user, userId } = await getSession();
  const params = await searchParams;

  // Get user's teams
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: {
      Team: true,
    },
    orderBy: { joinedAt: 'desc' },
  });

  const teams = memberships.map((m) => m.Team);

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />
      <main className="flex-grow">
        <NewProjectForm teams={teams} preselectedTeamId={params.teamId} />
      </main>
    </div>
  );
}
