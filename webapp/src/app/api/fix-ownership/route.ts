import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { requireDevAccess } from '@/lib/dev-guard';

/**
 * Emergency API to fix ownership issues
 * Makes the current user an OWNER of teams where they're a member but not an owner
 *
 * Security: Restricted to OWNER role only via dev-guard middleware
 */
export async function POST(request: Request) {
  try {
    // OWNER-only access restriction
    const accessDenied = await requireDevAccess();
    if (accessDenied) return accessDenied;

    const { userId, user } = await getSession();

    const body = await request.json();
    const { teamId } = body;

    if (!teamId) {
      return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
    }

    // Find the user's membership in this team
    const membership = await prisma.membership.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId
        }
      },
      include: {
        Team: true
      }
    });

    if (!membership) {
      return NextResponse.json({
        error: 'You are not a member of this team',
        teamId
      }, { status: 403 });
    }

    if (membership.role === 'OWNER') {
      return NextResponse.json({
        message: 'You are already an OWNER of this team',
        team: membership.Team.name,
        role: membership.role
      });
    }

    // Update the membership to OWNER
    const updatedMembership = await prisma.membership.update({
      where: {
        userId_teamId: {
          userId,
          teamId
        }
      },
      data: {
        role: 'OWNER'
      },
      include: {
        Team: true
      }
    });

    // Log privilege escalation for security audit trail
    console.warn(`⚠️  OWNERSHIP ESCALATION: User ${user?.email} (${userId}) promoted themselves to OWNER of team "${updatedMembership.Team.name}" (${teamId}) from role ${membership.role}`);

    return NextResponse.json({
      success: true,
      message: `You are now an OWNER of ${updatedMembership.Team.name}`,
      teamName: updatedMembership.Team.name,
      previousRole: membership.role,
      newRole: updatedMembership.role,
      userId,
      userEmail: user?.email
    });

  } catch (error) {
    console.error('Fix ownership error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fix ownership'
    }, { status: 500 });
  }
}
