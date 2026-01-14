import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkData() {
  const teams = await prisma.team.findMany({
    include: {
      Project: true,
      Membership: true,
    },
  });

  console.log('Teams and Projects:');
  teams.forEach((team) => {
    console.log(`\nTeam: ${team.name} (${team.id})`);
    console.log(`  Memberships: ${team.Membership.length}`);
    team.Membership.forEach((m) => {
      console.log(`    - User ${m.userId}: ${m.role}`);
    });
    console.log(`  Projects: ${team.Project.length}`);
    team.Project.forEach((p) => {
      console.log(`    - ${p.name} (owner: ${p.ownerId})`);
    });
  });

  await prisma.$disconnect();
}

checkData().catch(console.error);
