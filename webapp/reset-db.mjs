import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDB() {
  console.log('Clearing migration table...');
  await prisma.$executeRaw`DELETE FROM "_prisma_migrations"`;
  console.log('Done! Now run: npx prisma db push');
  await prisma.$disconnect();
}

resetDB().catch(console.error);
