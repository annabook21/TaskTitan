/**
 * Lambda handler for deleting Cognito user as part of account deletion
 * Uses AdminDeleteUser to remove user from Cognito User Pool
 * AWS Documentation: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminDeleteUser.html
 */
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

interface DeleteUserInput {
  userId: string; // Cognito sub (user ID)
}

interface DeleteUserResult {
  success: boolean;
  message: string;
}

const client = new CognitoIdentityProviderClient({});

export const handler = async (event: DeleteUserInput): Promise<DeleteUserResult> => {
  console.log('Received delete user request:', JSON.stringify(event));
  const { userId } = event;
  const userPoolId = process.env.USER_POOL_ID;

  if (!userPoolId) {
    console.error('USER_POOL_ID environment variable not set');
    return {
      success: false,
      message: 'User deletion is not configured. Please contact support.',
    };
  }

  if (!userId) {
    console.error('No userId provided');
    return {
      success: false,
      message: 'User ID is required.',
    };
  }

  try {
    // AdminDeleteUser removes the user from the User Pool
    // This invalidates all tokens and prevents future sign-in
    await client.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: userId,
      }),
    );

    console.log('User deleted from Cognito successfully', { userId });

    return {
      success: true,
      message: 'User account deleted successfully.',
    };
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      // User already deleted from Cognito - consider this success
      console.warn('User not found in Cognito (already deleted?)', { userId });
      return {
        success: true,
        message: 'User account already deleted.',
      };
    }

    console.error('Failed to delete user from Cognito', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: 'Failed to delete user account. Please try again or contact support.',
    };
  }
};
