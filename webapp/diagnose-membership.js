/**
 * Diagnostic script to check user membership and ownership
 *
 * This will help identify why delete buttons aren't appearing
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnose() {
  try {
    console.log('\n=== DIAGNOSTIC: USER MEMBERSHIP CHECK ===\n');

    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        Membership: {
          include: {
            Team: { select: { id: true, name: true } }
          }
        }
      },
    });

    console.log(`Found ${users.length} user(s):\n`);

    users.forEach(user => {
      console.log(`📧 ${user.email} (${user.name || 'No name'})`);
      console.log(`   User ID: ${user.id}`);
      console.log(`   Type: ${typeof user.id}`);

      if (user.Membership.length === 0) {
        console.log(`   ⚠️  NOT A MEMBER OF ANY TEAM\n`);
      } else {
        console.log(`   Teams:`);
        user.Membership.forEach(m => {
          const indicator = m.role === 'OWNER' ? '👑' : m.role === 'ADMIN' ? '🛡️' : '👤';
          console.log(`   ${indicator} ${m.Team.name}: ${m.role}`);
        });
        console.log('');
      }
    });

    // Get all teams with their owners
    console.log('=== TEAMS WITH OWNERSHIP ===\n');
    const teams = await prisma.team.findMany({
      include: {
        Membership: {
          where: { role: 'OWNER' },
          include: { User: true }
        }
      }
    });

    teams.forEach(team => {
      console.log(`🏢 ${team.name} (ID: ${team.id})`);
      if (team.Membership.length === 0) {
        console.log(`   ❌ NO OWNER ASSIGNED!`);
      } else {
        team.Membership.forEach(m => {
          console.log(`   👑 Owner: ${m.User.email} (User ID: ${m.userId})`);
        });
      }
      console.log('');
    });

    // Get all projects with their owners
    console.log('=== PROJECTS WITH OWNERSHIP ===\n');
    const projects = await prisma.project.findMany({
      include: {
        User: true,
        Team: { select: { name: true } }
      }
    });

    if (projects.length === 0) {
      console.log('No projects found.\n');
    } else {
      projects.forEach(p => {
        console.log(`📁 ${p.name} (Team: ${p.Team.name})`);
        console.log(`   Owner: ${p.User.email} (User ID: ${p.ownerId})`);
        console.log('');
      });
    }

    // Get all sprints
    console.log('=== SPRINTS ===\n');
    const sprints = await prisma.sprint.findMany({
      include: {
        Team: {
          include: {
            Membership: {
              where: { role: 'OWNER' },
              include: { User: true }
            }
          }
        }
      }
    });

    if (sprints.length === 0) {
      console.log('No sprints found.\n');
    } else {
      sprints.forEach(s => {
        console.log(`⚡ ${s.name} (Status: ${s.status})`);
        console.log(`   Team: ${s.Team.name}`);
        console.log(`   Team Owner: ${s.Team.Membership[0]?.User.email || 'None'}`);
        console.log(`   Can delete: ${s.status === 'PLANNING' || s.status === 'CANCELLED' ? 'YES' : 'NO (must be PLANNING or CANCELLED)'}`);
        console.log('');
      });
    }

    console.log('=== RECOMMENDATIONS ===\n');

    // Check for teams without owners
    const teamsWithoutOwners = teams.filter(t => t.Membership.length === 0);
    if (teamsWithoutOwners.length > 0) {
      console.log('⚠️  ISSUE: Some teams have no OWNER assigned:');
      teamsWithoutOwners.forEach(t => console.log(`   - ${t.name} (${t.id})`));
      console.log('\n   FIX: You need to manually update the database to assign an OWNER.\n');
    }

    // Check for users without memberships
    const usersWithoutTeams = users.filter(u => u.Membership.length === 0);
    if (usersWithoutTeams.length > 0) {
      console.log('⚠️  ISSUE: Some users are not members of any team:');
      usersWithoutTeams.forEach(u => console.log(`   - ${u.email} (${u.id})`));
      console.log('\n   This is why delete buttons won\'t appear for them.\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

diagnose();
