'use server';

import { z } from 'zod';
import { createSafeActionClient, DEFAULT_SERVER_ERROR_MESSAGE } from 'next-safe-action';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { logger } from '@/lib/logger';

class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationError';
  }
}

const actionClient = createSafeActionClient({
  handleServerError(e) {
    console.error('Registration error:', e.message);
    if (e instanceof RegistrationError) {
      return e.message;
    }
    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
});

const registerSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
});

let cognitoClient: CognitoIdentityProviderClient | null = null;

function getCognitoClient(): CognitoIdentityProviderClient {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({});
  }
  return cognitoClient;
}

export const registerUser = actionClient.schema(registerSchema).action(async ({ parsedInput }) => {
  const { email, name } = parsedInput;
  const start = performance.now();

  // Local dev mode - skip Cognito
  const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.USER_POOL_ID;
  if (isLocalDev) {
    logger.info('Registration skipped in local dev mode', { email });
    return {
      success: true,
      message: 'Local dev mode: User will be auto-created on sign-in.',
    };
  }

  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) {
    throw new RegistrationError('Registration is not configured. Please contact support.');
  }

  try {
    const client = getCognitoClient();

    // AdminCreateUser sends invitation email using User Pool's userInvitation template
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: name },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );

    const duration = performance.now() - start;
    logger.info('User registration successful', {
      email,
      duration_ms: Math.round(duration * 100) / 100,
    });

    return {
      success: true,
      message: 'Account created! Check your email for a temporary password.',
    };
  } catch (error) {
    const duration = performance.now() - start;

    if (error instanceof UsernameExistsException) {
      logger.warn('Registration attempted for existing user', {
        email,
        duration_ms: Math.round(duration * 100) / 100,
      });
      throw new RegistrationError('An account with this email already exists. Please sign in instead.');
    }

    logger.error('Registration failed', {
      email,
      duration_ms: Math.round(duration * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new RegistrationError('Registration failed. Please try again or contact support.');
  }
});
