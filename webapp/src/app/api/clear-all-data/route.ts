import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { requireDevAccess } from '@/lib/dev-guard';

/**
 * DANGER: This endpoint clears ALL data from the database
 * Only use this in development!
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

    // Require explicit confirmation
    if (body.confirm !== true) {
      return NextResponse.json({
        error: 'Confirmation required. Send { "confirm": true } to proceed.'
      }, { status: 400 });
    }

    console.log(`🗑️  User ${user?.email} (${userId}) initiated database clear`);

    // Delete in the correct order to respect foreign key constraints

    // 1. Delete Activities
    const activities = await prisma.activity.deleteMany({});
    console.log(`Deleted ${activities.count} activities`);

    // 2. Delete Assignments
    const assignments = await prisma.assignment.deleteMany({});
    console.log(`Deleted ${assignments.count} assignments`);

    // 3. Delete Dependencies
    const dependencies = await prisma.dependency.deleteMany({});
    console.log(`Deleted ${dependencies.count} dependencies`);

    // 4. Delete Components
    const components = await prisma.component.deleteMany({});
    console.log(`Deleted ${components.count} components`);

    // 5. Delete Sprints
    const sprints = await prisma.sprint.deleteMany({});
    console.log(`Deleted ${sprints.count} sprints`);

    // 6. Delete Projects
    const projects = await prisma.project.deleteMany({});
    console.log(`Deleted ${projects.count} projects`);

    // 7. Delete Memberships
    const memberships = await prisma.membership.deleteMany({});
    console.log(`Deleted ${memberships.count} memberships`);

    // 8. Delete Teams
    const teams = await prisma.team.deleteMany({});
    console.log(`Deleted ${teams.count} teams`);

    // Note: NOT deleting Users as they come from Cognito

    return NextResponse.json({
      success: true,
      message: 'Database cleared successfully. Users have been preserved (Cognito-managed).',
      deleted: {
        activities: activities.count,
        assignments: assignments.count,
        dependencies: dependencies.count,
        components: components.count,
        sprints: sprints.count,
        projects: projects.count,
        memberships: memberships.count,
        teams: teams.count
      },
      note: 'You can now create new teams and projects from scratch with proper ownership.'
    });

  } catch (error) {
    console.error('Clear database error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to clear database'
    }, { status: 500 });
  }
}
