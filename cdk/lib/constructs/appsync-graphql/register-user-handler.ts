/**
 * Lambda handler for registerUser mutation (AppSync)
 * Uses AdminCreateUser to create users (self-signup disabled in Cognito)
 * AWS Documentation: https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

interface RegisterUserInput {
  email: string;
  name: string;
}

// AppSync VTL lambdaRequest passes $ctx.arguments directly as the event payload
interface AppSyncEvent {
  input: RegisterUserInput;
}

interface RegisterUserResult {
  success: boolean;
  message: string;
}

const client = new CognitoIdentityProviderClient({});

export const handler = async (event: AppSyncEvent): Promise<RegisterUserResult> => {
  console.log('Received event:', JSON.stringify(event));
  const { email, name } = event.input;
  const userPoolId = process.env.USER_POOL_ID;

  if (!userPoolId) {
    console.error('USER_POOL_ID environment variable not set');
    return {
      success: false,
      message: 'Registration is not configured. Please contact support.',
    };
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      success: false,
      message: 'Please enter a valid email address.',
    };
  }

  if (!name || name.trim().length === 0) {
    return {
      success: false,
      message: 'Name is required.',
    };
  }

  if (name.length > 100) {
    return {
      success: false,
      message: 'Name is too long (max 100 characters).',
    };
  }

  try {
    // AdminCreateUser sends invitation email using User Pool's userInvitation template
    // AWS Documentation: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: name.trim() },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );

    console.log('User registration successful', { email });

    return {
      success: true,
      message: 'Account created! Check your email for a temporary password.',
    };
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      console.warn('Registration attempted for existing user', { email });
      return {
        success: false,
        message: 'An account with this email already exists. Please sign in instead.',
      };
    }

    console.error('Registration failed', {
      email,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: 'Registration failed. Please try again or contact support.',
    };
  }
};
