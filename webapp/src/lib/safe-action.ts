import { getEntities } from '@/lib/dynamodb/service';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';
import { getCurrentUser } from 'aws-amplify/auth/server';
import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action';
import { cookies } from 'next/headers';
import { DEMO_COOKIE_NAME, DEMO_USER } from '@/lib/demo/constants';

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
  // Check for demo mode first (works in both dev and production)
  const cookieStore = await cookies();
  const demoCookie = cookieStore.get(DEMO_COOKIE_NAME);
  if (demoCookie?.value) {
    // Demo mode - return demo user context with isDemo flag
    // Server actions will check this flag and return markers for client-side handling
    return next({ ctx: { userId: DEMO_USER.id, isDemo: true } });
  }

  // Local development mode - use mock user
  if (IS_LOCAL_DEV) {
    const entities = getEntities();
    
    // Ensure local dev user exists
    const userResult = await entities.user.get({ id: LOCAL_DEV_USER.id }).go();

    if (!userResult.data) {
      const now = new Date().toISOString();
      await entities.user.create({
        id: LOCAL_DEV_USER.id,
        email: LOCAL_DEV_USER.email,
        name: LOCAL_DEV_USER.name,
        createdAt: now,
        updatedAt: now,
      }).go();
    }

    return next({ ctx: { userId: LOCAL_DEV_USER.id, isDemo: false } });
  }

  // Production mode - use Cognito
  const currentUser = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: (contextSpec) => getCurrentUser(contextSpec),
  });

  if (!currentUser) {
    throw new MyCustomError('Session is not valid!');
  }

  const entities = getEntities();
  const userResult = await entities.user.get({ id: currentUser.userId }).go();

  if (userResult.data == null) {
    throw new MyCustomError('User not found');
  }

  return next({ ctx: { userId: userResult.data.id, isDemo: false } });
});
