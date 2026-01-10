import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Zap } from 'lucide-react';
import NewSprintForm from './NewSprintForm';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NewSprintPage({ params }: Props) {
  const { id } = await params;
  const { userId, user } = await getSession();

  const team = await prisma.team.findFirst({
    where: {
      id,
      Membership: { some: { userId } },
    },
    include: {
      Membership: {
        where: { userId },
        select: { role: true },
      },
      Sprint: {
        where: { status: { in: ['PLANNING', 'ACTIVE'] } },
        orderBy: { endDate: 'desc' },
        take: 1,
      },
    },
  });

  if (!team) {
    notFound();
  }

  const currentUserRole = team.Membership[0]?.role;
  if (currentUserRole !== 'OWNER' && currentUserRole !== 'ADMIN') {
    redirect(`/team/${id}/sprints`);
  }

  // Suggest next sprint dates based on last sprint
  const lastSprint = team.Sprint[0];
  const suggestedStartDate = lastSprint
    ? new Date(lastSprint.endDate.getTime() + 24 * 60 * 60 * 1000) // Day after last sprint ends
    : new Date();

  // Default 2-week sprint
  const suggestedEndDate = new Date(suggestedStartDate.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Generate suggested name
  const sprintCount = await prisma.sprint.count({ where: { teamId: id } });
  const suggestedName = `Sprint ${sprintCount + 1}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Back link */}
          <Link
            href={`/team/${id}/sprints`}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Sprints
          </Link>

          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Zap className="w-8 h-8 text-amber-400" />
              New Sprint
            </h1>
            <p className="text-slate-400 mt-1">Create a new sprint to plan and track work for {team.name}</p>
          </div>

          <NewSprintForm
            teamId={id}
            suggestedName={suggestedName}
            suggestedStartDate={suggestedStartDate.toISOString().split('T')[0]}
            suggestedEndDate={suggestedEndDate.toISOString().split('T')[0]}
          />
        </div>
      </main>
    </div>
  );
}
