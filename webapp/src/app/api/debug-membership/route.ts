import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { requireDevAccess } from '@/lib/dev-guard';

/**
 * Debug endpoint for membership and ownership troubleshooting
 *
 * Security: Restricted to OWNER role only via dev-guard middleware
 */
export async function GET() {
  try {
    // OWNER-only access restriction
    const accessDenied = await requireDevAccess();
    if (accessDenied) return accessDenied;

    const { userId, user } = await getSession();

    // Get current user's full details
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        Membership: {
          include: {
            Team: { select: { id: true, name: true } }
          }
        },
        Project: { select: { id: true, name: true } }
      }
    });

    // Get all teams with their owners
    const teams = await prisma.team.findMany({
      include: {
        Membership: {
          include: {
            User: { select: { id: true, email: true, name: true } }
          }
        }
      }
    });

    // Get all projects
    const projects = await prisma.project.findMany({
      include: {
        User: { select: { id: true, email: true, name: true } },
        Team: { select: { id: true, name: true } }
      }
    });

    // Get all sprints
    const sprints = await prisma.sprint.findMany({
      include: {
        Team: {
          select: {
            id: true,
            name: true,
            Membership: {
              where: { role: 'OWNER' },
              include: { User: { select: { id: true, email: true } } }
            }
          }
        }
      }
    });

    return NextResponse.json({
      currentUser: {
        id: currentUser?.id,
        email: currentUser?.email,
        name: currentUser?.name,
        memberships: currentUser?.Membership.map(m => ({
          teamId: m.Team.id,
          teamName: m.Team.name,
          role: m.role,
          canDeleteTeam: m.role === 'OWNER',
          canManageTeam: m.role === 'OWNER' || m.role === 'ADMIN'
        })),
        ownedProjects: currentUser?.Project.length || 0
      },
      teams: teams.map(t => ({
        id: t.id,
        name: t.name,
        members: t.Membership.map(m => ({
          userId: m.userId,
          email: m.User.email,
          name: m.User.name,
          role: m.role
        })),
        owners: t.Membership.filter(m => m.role === 'OWNER').map(m => m.User.email),
        youAreOwner: t.Membership.some(m => m.userId === userId && m.role === 'OWNER')
      })),
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        teamName: p.Team.name,
        ownerId: p.ownerId,
        ownerEmail: p.User.email,
        youAreOwner: p.ownerId === userId
      })),
      sprints: sprints.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        teamName: s.Team.name,
        teamOwners: s.Team.Membership.map(m => m.User.email),
        canDelete: s.Team.Membership.some(m => m.userId === userId) &&
                   (s.status === 'PLANNING' || s.status === 'CANCELLED')
      }))
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Debug failed'
    }, { status: 500 });
  }
}
