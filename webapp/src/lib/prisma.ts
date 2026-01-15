import { PrismaClient, Prisma } from '@prisma/client';

// https://www.prisma.io/docs/guides/nextjs

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

// Construct DATABASE_URL from individual components if not provided
// This allows secure injection of credentials via ECS Secrets Manager
function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const { DATABASE_HOST, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD, DATABASE_ENGINE, DATABASE_PORT, DATABASE_OPTION } =
    process.env;

  if (DATABASE_HOST && DATABASE_NAME && DATABASE_USER && DATABASE_PASSWORD) {
    const engine = DATABASE_ENGINE || 'postgresql';
    const port = DATABASE_PORT || '5432';
    const option = DATABASE_OPTION || '';
    return `${engine}://${DATABASE_USER}:${DATABASE_PASSWORD}@${DATABASE_HOST}:${port}/${DATABASE_NAME}?${option}`;
  }

  throw new Error('DATABASE_URL or individual database environment variables must be set');
}

// Environment-dependent Prisma logging for security and performance
// Production: Errors only (prevents SQL query exposure in logs)
// Development: Full logging for debugging
const logConfig: Prisma.LogLevel[] =
  process.env.NODE_ENV === 'production'
    ? ['error'] // Production: Errors only
    : ['query', 'info', 'warn', 'error']; // Development: Full logging

// Set DATABASE_URL for Prisma if constructed from components
const databaseUrl = getDatabaseUrl();
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = databaseUrl;
}

export const prisma = globalForPrisma.prisma || new PrismaClient({ log: logConfig });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
