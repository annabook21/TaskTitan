import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const demoUsers = [
  {
    id: 'demo-marcus-chen-001',
    email: 'marcus.chen@demo.tasktitan.dev',
    name: 'Marcus Chen',
    role: 'MEMBER' as const,
  },
  {
    id: 'demo-sarah-johnson-002',
    email: 'sarah.johnson@demo.tasktitan.dev',
    name: 'Sarah Johnson',
    role: 'ADMIN' as const,
  },
  {
    id: 'demo-alex-rivera-003',
    email: 'alex.rivera@demo.tasktitan.dev',
    name: 'Alex Rivera',
    role: 'MEMBER' as const,
  },
  {
    id: 'demo-priya-sharma-004',
    email: 'priya.sharma@demo.tasktitan.dev',
    name: 'Priya Sharma',
    role: 'MEMBER' as const,
  },
  {
    id: 'demo-james-oconnor-005',
    email: 'james.oconnor@demo.tasktitan.dev',
    name: "James O'Connor",
    role: 'MEMBER' as const,
  },
  {
    id: 'demo-emily-watson-006',
    email: 'emily.watson@demo.tasktitan.dev',
    name: 'Emily Watson',
    role: 'VIEWER' as const,
  },
];

export async function POST() {
  try {
    // Require authentication
    const { userId } = await getSession();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find Team Alpha
    const team = await prisma.team.findFirst({
      where: { name: { contains: 'Alpha', mode: 'insensitive' } },
      include: { Membership: true },
    });

    if (!team) {
      // List available teams for debugging
      const teams = await prisma.team.findMany({ select: { id: true, name: true } });
      return NextResponse.json(
        { error: 'Team Alpha not found', availableTeams: teams },
        { status: 404 },
      );
    }

    const results: string[] = [];
    results.push(`Found team: ${team.name} (${team.id})`);

    for (const userData of demoUsers) {
      // Check if user already exists
      let user = await prisma.user.findUnique({
        where: { email: userData.email },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            id: userData.id,
            email: userData.email,
            name: userData.name,
          },
        });
        results.push(`Created user: ${userData.name}`);
      } else {
        results.push(`User exists: ${userData.name}`);
      }

      // Check if already a member
      const existingMembership = await prisma.membership.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
      });

      if (!existingMembership) {
        await prisma.membership.create({
          data: {
            userId: user.id,
            teamId: team.id,
            role: userData.role,
          },
        });
        results.push(`  → Added to team as ${userData.role}`);
      } else {
        results.push(`  → Already a member`);
      }
    }

    // Get final team state
    const updatedTeam = await prisma.team.findUnique({
      where: { id: team.id },
      include: {
        Membership: {
          include: { User: true },
          orderBy: { role: 'asc' },
        },
      },
    });

    return NextResponse.json({
      success: true,
      results,
      team: {
        id: updatedTeam!.id,
        name: updatedTeam!.name,
        members: updatedTeam!.Membership.map((m) => ({
          name: m.User.name,
          email: m.User.email,
          role: m.role,
        })),
      },
    });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Seed failed' },
      { status: 500 },
    );
  }
}
