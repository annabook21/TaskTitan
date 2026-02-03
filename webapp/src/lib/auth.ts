import { cookies } from 'next/headers';
import { fetchAuthSession } from 'aws-amplify/auth/server';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { getEntities } from '@/lib/dynamodb/service';
import { DEMO_COOKIE_NAME, DEMO_USER } from '@/lib/demo/constants';

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
  const entities = getEntities();

  // Create or get the local dev user
  const userResult = await entities.user.get({ id: LOCAL_DEV_USER.id }).go();

  if (!userResult.data) {
    const now = new Date().toISOString();
    await entities.user
      .create({
        id: LOCAL_DEV_USER.id,
        email: LOCAL_DEV_USER.email,
        name: LOCAL_DEV_USER.name,
        createdAt: now,
        updatedAt: now,
      })
      .go();

    return {
      id: LOCAL_DEV_USER.id,
      email: LOCAL_DEV_USER.email,
      name: LOCAL_DEV_USER.name,
      avatarUrl: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  return {
    id: userResult.data.id,
    email: userResult.data.email,
    name: userResult.data.name ?? null,
    avatarUrl: userResult.data.avatarUrl ?? null,
    createdAt: new Date(userResult.data.createdAt ?? Date.now()),
    updatedAt: new Date(userResult.data.updatedAt ?? Date.now()),
  };
}

export async function getSession() {
  // Check for demo mode first (works in both dev and production)
  const cookieStore = await cookies();
  const demoCookie = cookieStore.get(DEMO_COOKIE_NAME);
  if (demoCookie?.value) {
    // Demo mode - return demo user without database access
    const demoUser = {
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      name: DEMO_USER.name,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return {
      userId: DEMO_USER.id,
      email: DEMO_USER.email,
      accessToken: 'demo-token',
      user: demoUser,
      isDemo: true,
    };
  }

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

  const entities = getEntities();
  const userResult = await entities.user.get({ id: userId }).go();

  if (userResult.data == null) {
    throw new UserNotCreatedError(userId, email);
  }

  const user = {
    id: userResult.data.id,
    email: userResult.data.email,
    name: userResult.data.name ?? null,
    avatarUrl: userResult.data.avatarUrl ?? null,
    createdAt: new Date(userResult.data.createdAt ?? Date.now()),
    updatedAt: new Date(userResult.data.updatedAt ?? Date.now()),
  };

  return {
    userId: user.id,
    email,
    accessToken: session.tokens.accessToken.toString(),
    user,
  };
}
