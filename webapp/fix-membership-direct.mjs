/**
 * Direct database fix for membership ownership
 * Run with: node fix-membership-direct.mjs
 *
 * This requires AWS SSM Session Manager plugin to be installed.
 * If you don't have it, wait for the deployment to finish and use the API endpoints instead.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:FdNm.qIMTjyv9Q5fU.rE3H2JjvveN-@localhost:5433/postgres?schema=public'
    }
  }
});

async function main() {
  console.log('🔍 Checking current memberships...\n');

  // Get all users with their memberships
  const users = await prisma.user.findMany({
    include: {
      Membership: {
        include: {
          Team: { select: { id: true, name: true } }
        }
      }
    }
  });

  console.log('📋 Current users and memberships:');
  users.forEach(user => {
    console.log(`\n👤 ${user.email} (ID: ${user.id})`);
    if (user.Membership.length === 0) {
      console.log('   ⚠️  Not a member of any team');
    } else {
      user.Membership.forEach(m => {
        const icon = m.role === 'OWNER' ? '👑' : m.role === 'ADMIN' ? '🛡️' : '👤';
        console.log(`   ${icon} ${m.Team.name}: ${m.role}`);
      });
    }
  });

  // Find Team Alpha
  const teamAlpha = await prisma.team.findFirst({
    where: { name: { contains: 'Alpha', mode: 'insensitive' } },
    include: {
      Membership: {
        include: { User: true }
      }
    }
  });

  if (!teamAlpha) {
    console.log('\n❌ Team Alpha not found!');
    return;
  }

  console.log(`\n\n🏢 Found team: ${teamAlpha.name} (${teamAlpha.id})`);
  console.log('Current members:');
  teamAlpha.Membership.forEach(m => {
    const icon = m.role === 'OWNER' ? '👑' : m.role === 'ADMIN' ? '🛡️' : '👤';
    console.log(`   ${icon} ${m.User.email}: ${m.role}`);
  });

  // Find users who are members but not owners
  const nonOwners = teamAlpha.Membership.filter(m => m.role !== 'OWNER');

  if (nonOwners.length === 0) {
    console.log('\n✅ All members are already owners or team has no non-owner members.');
    return;
  }

  console.log(`\n\n🔧 Found ${nonOwners.length} non-owner member(s):`);
  nonOwners.forEach(m => console.log(`   - ${m.User.email} (${m.role})`));

  console.log('\n❓ Do you want to make these users OWNERs? (This script will update the first user)');
  console.log('   If you want to proceed, uncomment the update code below and run again.\n');

  // UNCOMMENT THIS SECTION TO FIX THE FIRST NON-OWNER
  /*
  if (nonOwners.length > 0) {
    const userToFix = nonOwners[0];
    console.log(`\n🔄 Updating ${userToFix.User.email} to OWNER...`);

    await prisma.membership.update({
      where: {
        userId_teamId: {
          userId: userToFix.userId,
          teamId: teamAlpha.id
        }
      },
      data: {
        role: 'OWNER'
      }
    });

    console.log(`✅ ${userToFix.User.email} is now an OWNER of ${teamAlpha.name}!`);
    console.log('\n🎉 Refresh your app and the delete buttons should appear!');
  }
  */
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
