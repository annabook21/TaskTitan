/**
 * Cognito Identity Pool for Guest (Unauthenticated) Access
 *
 * AWS Best Practice: Use Identity Pool with unauthenticated role for guest access
 * instead of API keys. Provides temporary credentials, IAM-scoped permissions,
 * and CloudTrail audit trail.
 *
 * Security measures implemented:
 * 1. Trust policy conditions restrict role assumption to this specific identity pool
 * 2. Least-privilege IAM policy allows only specific AppSync operations
 * 3. Credentials auto-expire after 1 hour (Cognito default)
 * 4. All API calls logged via CloudTrail
 *
 * Reference: https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools-security-best-practices.html
 * Reference: https://github.com/focusOtter/cdk-appsync-guests
 */

import { CfnOutput, Stack } from 'aws-cdk-lib';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool, UserPoolAuthenticationProvider } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { GraphqlApi } from 'aws-cdk-lib/aws-appsync';
import { Construct } from 'constructs';

export interface GuestIdentityPoolProps {
  /**
   * The AppSync GraphQL API to grant guest access to
   */
  readonly appSyncApi: GraphqlApi;

  /**
   * The Cognito User Pool for authenticated identity federation.
   * Required for Amplify v6 to properly handle guest/authenticated flows.
   */
  readonly userPool: IUserPool;

  /**
   * The Cognito User Pool Client for the frontend app.
   */
  readonly userPoolClient: IUserPoolClient;
}

export class GuestIdentityPool extends Construct {
  public readonly identityPool: IdentityPool;
  public readonly identityPoolId: string;
  public readonly unauthenticatedRoleArn: string;

  constructor(scope: Construct, id: string, props: GuestIdentityPoolProps) {
    super(scope, id);

    const { appSyncApi, userPool, userPoolClient } = props;

    // Create Identity Pool with unauthenticated (guest) access enabled
    // AWS Best Practice: Separate roles for authenticated vs unauthenticated users
    // Guests use temporary IAM credentials instead of User Pool authentication
    //
    // The CDK IdentityPool construct automatically creates trust policies with:
    // - cognito-identity.amazonaws.com:aud condition (restricts to this pool)
    // - cognito-identity.amazonaws.com:amr condition (restricts to unauthenticated)
    // Reference: https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html
    //
    // IMPORTANT: For Amplify v6, the Identity Pool must be linked to the User Pool
    // even for guest access. This allows Amplify to properly handle both authenticated
    // and unauthenticated flows using the same Identity Pool.
    // Reference: https://docs.amplify.aws/gen2/build-a-backend/auth/connect-your-frontend/fetch-user-session/
    this.identityPool = new IdentityPool(this, 'IdentityPool', {
      identityPoolName: `${Stack.of(this).stackName}-GuestPool`,
      allowUnauthenticatedIdentities: true,
      // Link to User Pool for Amplify v6 compatibility
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({ userPool, userPoolClient }),
        ],
      },
    });

    // Guest AppSync permissions - applied to BOTH roles
    // Amplify v6 may use authenticated role credentials even for unauthenticated users
    // when the Identity Pool is linked to a User Pool
    const guestAppSyncPolicy = new PolicyStatement({
      sid: 'AllowGuestAppSyncOperations',
      effect: Effect.ALLOW,
      actions: ['appsync:GraphQL'],
      resources: [
        // Query operations for guests
        `${appSyncApi.arn}/types/Query/fields/guestGetProject`,
        `${appSyncApi.arn}/types/Query/fields/guestListComponents`,
        `${appSyncApi.arn}/types/Query/fields/guestListAssignments`,
        `${appSyncApi.arn}/types/Query/fields/guestListComments`,
        `${appSyncApi.arn}/types/Query/fields/guestListNotifications`,
        `${appSyncApi.arn}/types/Query/fields/guestCountUnreadNotifications`,
        `${appSyncApi.arn}/types/Query/fields/guestListActivityFeed`,
        // Mutation operations for guests
        `${appSyncApi.arn}/types/Mutation/fields/guestJoinTeam`,
        `${appSyncApi.arn}/types/Mutation/fields/guestJoinProject`,
        `${appSyncApi.arn}/types/Mutation/fields/guestAssignSelf`,
        `${appSyncApi.arn}/types/Mutation/fields/guestUnassignSelf`,
        `${appSyncApi.arn}/types/Mutation/fields/guestUpdateStatus`,
        `${appSyncApi.arn}/types/Mutation/fields/guestRefineComponent`,
        `${appSyncApi.arn}/types/Mutation/fields/guestUpdateComponent`,
        `${appSyncApi.arn}/types/Mutation/fields/guestCreateComment`,
        `${appSyncApi.arn}/types/Mutation/fields/guestMarkNotificationRead`,
        `${appSyncApi.arn}/types/Mutation/fields/guestMarkAllNotificationsRead`,
      ],
    });

    // Add to unauthenticated role (for true guest access)
    this.identityPool.unauthenticatedRole.addToPrincipalPolicy(guestAppSyncPolicy);

    // Add to authenticated role as well (Amplify v6 may use this role)
    this.identityPool.authenticatedRole.addToPrincipalPolicy(guestAppSyncPolicy);

    // Store references for monitoring and exports
    this.identityPoolId = this.identityPool.identityPoolId;
    this.unauthenticatedRoleArn = this.identityPool.unauthenticatedRole.roleArn;

    // Output the Identity Pool ID for frontend configuration
    new CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPoolId,
      description: 'Cognito Identity Pool ID for guest access',
    });

    // Output the unauthenticated role ARN for monitoring and IAM analysis
    new CfnOutput(this, 'GuestRoleArn', {
      value: this.unauthenticatedRoleArn,
      description: 'IAM Role ARN for guest (unauthenticated) access - monitor via CloudTrail',
    });
  }
}
