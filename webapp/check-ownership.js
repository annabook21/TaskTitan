const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOwnership() {
  try {
    // Get all users
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true },
    });
    console.log('\n=== USERS ===');
    users.forEach(u => console.log(`ID: ${u.id}, Email: ${u.email}, Name: ${u.name || 'N/A'}`));

    // Get all teams with memberships
    const teams = await prisma.team.findMany({
      include: {
        Membership: {
          include: { User: true },
        },
      },
    });
    console.log('\n=== TEAMS & MEMBERSHIPS ===');
    teams.forEach(team => {
      console.log(`\nTeam: ${team.name} (ID: ${team.id})`);
      team.Membership.forEach(m => {
        console.log(`  - ${m.User.email}: ${m.role}`);
      });
    });

    // Get all projects with owners
    const projects = await prisma.project.findMany({
      include: {
        User: true,
        Team: true,
      },
    });
    console.log('\n=== PROJECTS & OWNERS ===');
    projects.forEach(p => {
      console.log(`\nProject: ${p.name} (ID: ${p.id})`);
      console.log(`  Team: ${p.Team.name}`);
      console.log(`  Owner ID: ${p.ownerId}`);
      console.log(`  Owner: ${p.User.email}`);
    });

    // Get all sprints
    const sprints = await prisma.sprint.findMany({
      include: {
        Team: true,
      },
    });
    console.log('\n=== SPRINTS ===');
    sprints.forEach(s => {
      console.log(`\nSprint: ${s.name} (ID: ${s.id})`);
      console.log(`  Team: ${s.Team.name}`);
      console.log(`  Status: ${s.status}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkOwnership();
