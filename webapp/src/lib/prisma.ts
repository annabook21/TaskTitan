import { PrismaClient, Prisma } from '@prisma/client';

// https://www.prisma.io/docs/guides/nextjs

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

// Environment-dependent Prisma logging for security and performance
// Production: Errors only (prevents SQL query exposure in logs)
// Development: Full logging for debugging
const logConfig: Prisma.LogLevel[] = process.env.NODE_ENV === 'production'
  ? ['error']  // Production: Errors only
  : ['query', 'info', 'warn', 'error'];  // Development: Full logging

console.log(process.env.DATABASE_URL);
export const prisma = globalForPrisma.prisma || new PrismaClient({ log: logConfig });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
