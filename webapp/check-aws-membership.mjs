/**
 * Lambda payload to check user membership in AWS database
 * This can be run via the migration Lambda or create a temporary Lambda
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function handler(event) {
  try {
    // Get all users with their memberships
    const users = await prisma.user.findMany({
      include: {
        Membership: {
          include: {
            Team: { select: { id: true, name: true } },
          },
        },
        Project: { select: { id: true, name: true } },
      },
    });

    // Get all teams with owners
    const teams = await prisma.team.findMany({
      include: {
        Membership: {
          where: { role: 'OWNER' },
          include: { User: { select: { email: true, id: true } } },
        },
      },
    });

    const result = {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        memberships: u.Membership.map((m) => ({
          team: m.Team.name,
          teamId: m.Team.id,
          role: m.role,
        })),
        ownedProjects: u.Project.length,
      })),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        owners: t.Membership.map((m) => ({
          email: m.User.email,
          userId: m.User.id,
        })),
      })),
    };

    return {
      statusCode: 200,
      body: JSON.stringify(result, null, 2),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  } finally {
    await prisma.$disconnect();
  }
}
