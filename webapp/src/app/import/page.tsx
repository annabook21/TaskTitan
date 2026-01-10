import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import { redirect } from 'next/navigation';
import ImportWizard from './ImportWizard';

interface Props {
  searchParams: Promise<{ teamId?: string }>;
}

export default async function ImportPage({ searchParams }: Props) {
  const params = await searchParams;
  const { userId, user } = await getSession();

  // Get user's teams
  const teams = await prisma.team.findMany({
    where: {
      Membership: { some: { userId } },
    },
    include: {
      Project: { select: { id: true, name: true } },
      Sprint: {
        where: { status: { in: ['PLANNING', 'ACTIVE'] } },
        select: { id: true, name: true },
      },
    },
  });

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
          <ImportWizard
            teams={teams}
            selectedTeam={selectedTeam}
          />
        </div>
      </main>
    </div>
  );
}
