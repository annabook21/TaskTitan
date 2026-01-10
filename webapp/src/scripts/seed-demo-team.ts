/**
 * Seed script to add demo users to Team Alpha
 *
 * This script must be run against the production database via the bastion host.
 *
 * Usage:
 * 1. Start port forwarding: (from CDK output DatabasePortForwardCommand)
 *    aws ssm start-session --region us-west-2 --target i-0fdbef65bd72584ea \
 *      --document-name AWS-StartPortForwardingSessionToRemoteHost \
 *      --parameters '{"portNumber":["5432"], "localPortNumber":["5433"], "host": ["tasktitanstack-databasecluster..."]}'
 *
 * 2. Set DATABASE_URL to point to localhost:5433
 *
 * 3. Run: npx ts-node src/scripts/seed-demo-team.ts
 */

import { PrismaClient } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

const prisma = new PrismaClient();

const demoUsers = [
  {
    email: 'marcus.chen@demo.tasktitan.dev',
    name: 'Marcus Chen',
    role: 'MEMBER' as const,
    // Full-stack developer, React, Node.js, PostgreSQL
  },
  {
    email: 'sarah.johnson@demo.tasktitan.dev',
    name: 'Sarah Johnson',
    role: 'ADMIN' as const,
    // Product Manager, Agile, User Research, Roadmapping
  },
  {
    email: 'alex.rivera@demo.tasktitan.dev',
    name: 'Alex Rivera',
    role: 'MEMBER' as const,
    // Backend Engineer, Python, AWS, DevOps, Infrastructure
  },
  {
    email: 'priya.sharma@demo.tasktitan.dev',
    name: 'Priya Sharma',
    role: 'MEMBER' as const,
    // UI/UX Designer, Figma, CSS, Accessibility, Design Systems
  },
  {
    email: 'james.oconnor@demo.tasktitan.dev',
    name: "James O'Connor",
    role: 'MEMBER' as const,
    // Mobile Developer, React Native, iOS, Android
  },
  {
    email: 'emily.watson@demo.tasktitan.dev',
    name: 'Emily Watson',
    role: 'VIEWER' as const,
    // QA Engineer, Testing, Documentation, Automation
  },
];

async function main() {
  console.log('🔍 Finding Team Alpha...');

  const team = await prisma.team.findFirst({
    where: { name: { contains: 'Alpha', mode: 'insensitive' } },
    include: { Membership: true },
  });

  if (!team) {
    console.error('❌ Team Alpha not found! Available teams:');
    const teams = await prisma.team.findMany({ select: { id: true, name: true } });
    console.log(teams);
    process.exit(1);
  }

  console.log(`✅ Found team: ${team.name} (${team.id})`);
  console.log(`   Current members: ${team.Membership.length}`);

  console.log('\n👥 Creating demo users...');

  for (const userData of demoUsers) {
    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: createId(),
          email: userData.email,
          name: userData.name,
        },
      });
      console.log(`   ✅ Created user: ${userData.name}`);
    } else {
      console.log(`   ⏭️  User exists: ${userData.name}`);
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
      console.log(`   ✅ Added to team as ${userData.role}`);
    } else {
      console.log(`   ⏭️  Already a member`);
    }
  }

  console.log('\n🎉 Done! Team Alpha now has demo members.');

  // Show final team state
  const updatedTeam = await prisma.team.findUnique({
    where: { id: team.id },
    include: {
      Membership: {
        include: { User: true },
        orderBy: { role: 'asc' },
      },
    },
  });

  console.log('\n📋 Team Alpha Members:');
  for (const m of updatedTeam!.Membership) {
    console.log(`   ${m.role.padEnd(8)} ${m.User.name || m.User.email}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
