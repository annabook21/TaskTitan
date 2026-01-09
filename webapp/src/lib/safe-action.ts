import { prisma } from '@/lib/prisma';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { getCurrentUser } from 'aws-amplify/auth/server';
import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action';
import { cookies } from 'next/headers';

// Local development mode - bypasses Cognito auth
const IS_LOCAL_DEV = process.env.NODE_ENV === 'development' && !process.env.USER_POOL_ID;

// Mock user for local development
const LOCAL_DEV_USER = {
  id: 'local-dev-user-001',
  email: 'dev@tasktitan.local',
  name: 'Local Developer',
};

export class MyCustomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MyCustomError';
  }
}

const actionClient = createSafeActionClient({
  handleServerError(e) {
    // Log to console.
    console.error('Action error:', e.message);

    // In this case, we can use the 'MyCustomError` class to unmask errors
    // and return them with their actual messages to the client.
    if (e instanceof MyCustomError) {
      return e.message;
    }

    // Every other error that occurs will be masked with the default message.
    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
});

export const authActionClient = actionClient.use(async ({ next }) => {
  // Local development mode - use mock user
  if (IS_LOCAL_DEV) {
    // Ensure local dev user exists
    let user = await prisma.user.findUnique({
      where: { id: LOCAL_DEV_USER.id },
    });

    if (!user) {
      user = await prisma.user.create({
        data: LOCAL_DEV_USER,
      });
    }

    return next({ ctx: { userId: user.id } });
  }

  // Production mode - use Cognito
  const currentUser = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (contextSpec) => getCurrentUser(contextSpec),
  });

  if (!currentUser) {
    throw new Error('Session is not valid!');
  }

  const user = await prisma.user.findUnique({
    where: {
      id: currentUser.userId,
    },
  });

  if (user == null) {
    throw new Error('user not found');
  }

  return next({ ctx: { userId: user.id } });
});
