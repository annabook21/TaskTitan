import { cookies } from 'next/headers';
import { fetchAuthSession } from 'aws-amplify/auth/server';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { prisma } from '@/lib/prisma';

export class UserNotCreatedError {
  constructor(
    public readonly userId: string,
    public readonly email: string,
  ) {}
}

// Local development mode - bypasses Cognito auth
const IS_LOCAL_DEV = process.env.NODE_ENV === 'development' && !process.env.USER_POOL_ID;

// Mock user for local development
const LOCAL_DEV_USER = {
  id: 'local-dev-user-001',
  email: 'dev@tasktitan.local',
  name: 'Local Developer',
};

async function ensureLocalDevUser() {
  // Create or get the local dev user
  let user = await prisma.user.findUnique({
    where: { id: LOCAL_DEV_USER.id },
  });

  if (!user) {
    user = await prisma.user.create({
      data: LOCAL_DEV_USER,
    });
  }

  return user;
}

export async function getSession() {
  // Local development mode - use mock user
  if (IS_LOCAL_DEV) {
    const user = await ensureLocalDevUser();
    return {
      userId: user.id,
      email: user.email,
      accessToken: 'local-dev-token',
      user,
    };
  }

  // Production mode - use Cognito
  const session = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (contextSpec) => fetchAuthSession(contextSpec),
  });
  if (session.userSub == null || session.tokens?.idToken == null || session.tokens?.accessToken == null) {
    throw new Error('session not found');
  }
  const userId = session.userSub;
  const email = session.tokens.idToken.payload.email;
  if (typeof email != 'string') {
    throw new Error(`invalid email ${userId}.`);
  }
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });
  if (user == null) {
    throw new UserNotCreatedError(userId, email);
  }

  return {
    userId: user.id,
    email,
    accessToken: session.tokens.accessToken.toString(),
    user,
  };
}
