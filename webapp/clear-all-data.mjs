/**
 * Clear all data from the database (Teams, Projects, Sprints, etc.)
 * This will be packaged and deployed as a one-time Lambda invocation
 */

export const handler = async (event) => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    console.log('🗑️  Starting database cleanup...\n');

    // Delete in the correct order to respect foreign key constraints

    // 1. Delete Activities (depends on Project)
    const activities = await prisma.activity.deleteMany({});
    console.log(`✅ Deleted ${activities.count} activity records`);

    // 2. Delete Assignments (depends on Component and User)
    const assignments = await prisma.assignment.deleteMany({});
    console.log(`✅ Deleted ${assignments.count} assignments`);

    // 3. Delete Dependencies (depends on Component)
    const dependencies = await prisma.dependency.deleteMany({});
    console.log(`✅ Deleted ${dependencies.count} dependencies`);

    // 4. Delete Components (depends on Project and Sprint)
    const components = await prisma.component.deleteMany({});
    console.log(`✅ Deleted ${components.count} components`);

    // 5. Delete Sprints (depends on Team)
    const sprints = await prisma.sprint.deleteMany({});
    console.log(`✅ Deleted ${sprints.count} sprints`);

    // 6. Delete Projects (depends on Team)
    const projects = await prisma.project.deleteMany({});
    console.log(`✅ Deleted ${projects.count} projects`);

    // 7. Delete Memberships (depends on Team and User)
    const memberships = await prisma.membership.deleteMany({});
    console.log(`✅ Deleted ${memberships.count} memberships`);

    // 8. Delete Teams (no dependencies)
    const teams = await prisma.team.deleteMany({});
    console.log(`✅ Deleted ${teams.count} teams`);

    // Note: NOT deleting Users as they come from Cognito

    console.log('\n✨ Database cleanup complete!');
    console.log('Users have been preserved (Cognito-managed).');
    console.log('You can now create new teams and projects from scratch.');

    await prisma.$disconnect();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Database cleared successfully',
        deleted: {
          activities: activities.count,
          assignments: assignments.count,
          dependencies: dependencies.count,
          components: components.count,
          sprints: sprints.count,
          projects: projects.count,
          memberships: memberships.count,
          teams: teams.count,
        },
      }),
    };
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    await prisma.$disconnect();

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};

// If running directly (not in Lambda)
if (import.meta.url === `file://${process.argv[1]}`) {
  handler({}).then((result) => {
    console.log('\nResult:', result);
    process.exit(result.statusCode === 200 ? 0 : 1);
  });
}
