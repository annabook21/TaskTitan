/**
 * Lambda handler for inviteTeamMember mutation (AppSync)
 * Uses AdminCreateUser to create users and send invitation emails automatically
 * AWS Documentation: https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  UsernameExistsException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

interface InviteTeamMemberInput {
  email: string;
  teamId: string;
  role: string; // 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  title?: string | null;
}

// AppSync Lambda resolver receives: { version: "2018-05-29", operation: "Invoke", payload: {...} }
interface AppSyncLambdaEvent {
  version?: string;
  operation?: string;
  payload?: {
    input?: InviteTeamMemberInput;
  };
  // Handle direct payload (if AppSync unwraps it)
  input?: InviteTeamMemberInput;
}

interface InviteTeamMemberResult {
  success: boolean;
  message: string;
  userExists: boolean;
  userId?: string; // Cognito user sub if user already exists
}

const client = new CognitoIdentityProviderClient({});

export const handler = async (event: AppSyncLambdaEvent): Promise<InviteTeamMemberResult> => {
  console.log('Received inviteTeamMember event:', JSON.stringify(event));

  // Handle both wrapped and unwrapped payload structures
  const input = event.input || event.payload?.input;
  if (!input) {
    return {
      success: false,
      message: 'Invalid request: missing input',
      userExists: false,
    };
  }

  const { email, teamId, role } = input;
  const userPoolId = process.env.USER_POOL_ID;

  if (!userPoolId) {
    console.error('USER_POOL_ID environment variable not set');
    return {
      success: false,
      message: 'Invitation is not configured. Please contact support.',
      userExists: false,
    };
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      success: false,
      message: 'Please enter a valid email address.',
      userExists: false,
    };
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Extract name from email (use part before @) as fallback
  // AWS Best Practice: Include name attribute for consistency with registerUser
  const nameFromEmail = normalizedEmail.split('@')[0];
  const name = nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1);

  try {
    // Check if user already exists in Cognito
    let getUserResponse;
    try {
      getUserResponse = await client.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId,
          Username: normalizedEmail,
        }),
      );

      // User exists - return their user ID (sub) so AppSync can add them to team
      const userId = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;

      console.log('User already exists in Cognito', { email: normalizedEmail, userId });

      return {
        success: true,
        message: 'User already has an account. They will be added to the team.',
        userExists: true,
        userId: userId,
      };
    } catch (error) {
      // UserNotFoundException means user doesn't exist - that's fine, we'll create them
      if (!(error instanceof UserNotFoundException)) {
        throw error; // Re-throw if it's a different error
      }
    }

    // User doesn't exist - create them using AdminCreateUser
    // AWS Best Practice: Explicitly set MessageAction (default sends email, but being explicit is clearer)
    // This automatically sends an invitation email with temporary password
    let createUserResponse;
    try {
      createUserResponse = await client.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: normalizedEmail,
          UserAttributes: [
            { Name: 'email', Value: normalizedEmail },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: name },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
          // MessageAction defaults to sending email - explicit would be MessageAction: 'WELCOME'
          // but default behavior is correct, so we omit it
        }),
      );
    } catch (createError) {
      // AWS Best Practice: Handle race condition - if AdminCreateUser fails with UsernameExistsException,
      // retry AdminGetUser to get the userId
      if (createError instanceof UsernameExistsException) {
        console.warn('Race condition: User created between AdminGetUser and AdminCreateUser', {
          email: normalizedEmail,
        });
        try {
          getUserResponse = await client.send(
            new AdminGetUserCommand({
              UserPoolId: userPoolId,
              Username: normalizedEmail,
            }),
          );
          const userId = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
          return {
            success: true,
            message: 'User already has an account. They will be added to the team.',
            userExists: true,
            userId: userId,
          };
        } catch (retryError) {
          // If retry also fails, throw original error
          throw createError;
        }
      }
      throw createError;
    }

    const userId = createUserResponse.User?.Attributes?.find((attr) => attr.Name === 'sub')?.Value;

    console.log('User created successfully via AdminCreateUser', {
      email: normalizedEmail,
      userId,
      name,
      // Note: Cognito automatically sent invitation email with temporary password
    });

    return {
      success: true,
      message: 'Invitation sent! User will receive an email with instructions to sign in.',
      userExists: false,
      userId: userId,
    };
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      // Fallback: This shouldn't happen after our retry logic, but handle it anyway
      console.warn('User already exists (unexpected race condition)', { email: normalizedEmail });
      try {
        const getUserResponse = await client.send(
          new AdminGetUserCommand({
            UserPoolId: userPoolId,
            Username: normalizedEmail,
          }),
        );
        const userId = getUserResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;
        return {
          success: true,
          message: 'User already has an account. They will be added to the team.',
          userExists: true,
          userId: userId,
        };
      } catch {
        // If we can't get user, return error
      }
    }

    console.error('Invite team member failed', {
      email: normalizedEmail,
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: 'Failed to send invitation. Please try again or contact support.',
      userExists: false,
    };
  }
};
