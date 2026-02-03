import { UpdateUserPoolClientCommandInput } from '@aws-sdk/client-cognito-identity-provider';
import { CfnOutput, CfnResource, CustomResource, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  ManagedLoginVersion,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
  VerificationEmailStyle,
} from 'aws-cdk-lib/aws-cognito';
import { Code, Runtime, SingletonFunction } from 'aws-cdk-lib/aws-lambda';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { join } from 'path';

// FORGE: Simplified auth - no custom domain support
export interface AuthProps {
  // No props needed - always uses Cognito default domain
}

export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly domainName: string;
  /**
   * The Cognito User Pool Domain resource.
   * When using a custom domain, this resource requires the parent domain to have an A record.
   * Use `cognitoDomain.node.addDependency()` to ensure the A record is created first.
   */
  readonly cognitoDomain: UserPoolDomain;

  private callbackUrlCount = 0;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    // FORGE: Always use Cognito default domain with random prefix
    // Generate unique domainPrefix to avoid collision in AWS region
    const generator = new SingletonFunction(this, 'RandomStringGenerator', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(5),
      lambdaPurpose: 'RandomStringGenerator',
      uuid: '11e9c903-f11a-4989-833c-985dddef5eb2',
      code: Code.fromInline(readFileSync(join(__dirname, 'prefix-generator.js')).toString()),
    });

    const domainPrefixResource = new CustomResource(this, 'DomainPrefix', {
      serviceToken: generator.functionArn,
      resourceType: 'Custom::RandomString',
      properties: { prefix: 'webapp-', length: 10 },
      serviceTimeout: Duration.seconds(10),
    });
    const domainPrefix = domainPrefixResource.getAttString('generated');

    this.domainName = `${domainPrefix}.auth.${Stack.of(this).region}.amazoncognito.com`;

    const userPool = new UserPool(this, 'UserPool', {
      passwordPolicy: {
        requireUppercase: true,
        requireSymbols: true,
        requireDigits: true,
        minLength: 8,
      },
      // AppSec: Self-sign-up disabled; users are created via AdminCreateUser from /sign-up server action
      selfSignUpEnabled: false,
      autoVerify: {
        email: true,
      },
      signInAliases: {
        username: false,
        email: true,
      },
      // AWS Best Practice: Email-only account recovery prevents phone-based attacks
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Note: standardAttributes cannot be modified on an existing User Pool
      // Email is already required via signInAliases.email: true
      // Custom verification email
      userVerification: {
        emailSubject: 'Verify your TaskTitan account',
        emailBody: 'Your TaskTitan verification code is {####}',
        emailStyle: VerificationEmailStyle.CODE,
      },
      removalPolicy: RemovalPolicy.RETAIN, // Protect user data in production
      // Admin-created user invitation email template
      userInvitation: {
        emailSubject: 'Welcome to TaskTitan - Your account is ready',
        emailBody: `Hello,

Your TaskTitan account has been created.

Username: {username}
Temporary Password: {####}

Please sign in and you will be prompted to set a permanent password.

This temporary password expires in 7 days.

Welcome to intelligent project planning!
- The TaskTitan Team`,
      },
    });

    // Note: Advanced security mode (Threat Protection) requires Cognito Plus tier ($0.05/MAU)
    // For now, we rely on other security measures:
    // - Email-only account recovery
    // - Strong password policy
    // - Token revocation
    // To enable advanced security, upgrade the user pool tier in AWS Console first

    const client = userPool.addClient(`Client`, {
      idTokenValidity: Duration.days(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        callbackUrls: ['http://localhost/dummy'],
        logoutUrls: ['http://localhost/dummy'],
      },
    });

    this.client = client;
    this.userPool = userPool;

    // FORGE: Always use Cognito default domain (no custom domain)
    this.cognitoDomain = userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix,
      },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    new CfnManagedLoginBranding(this, 'Branding', {
      userPoolId: this.userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'UserPoolDomainName', { value: this.domainName });
  }

  public addAllowedCallbackUrls(callbackUrl: string, logoutUrl: string) {
    const resource = this.client.node.defaultChild;
    if (!CfnResource.isCfnResource(resource)) {
      throw new Error('Expected CfnResource');
    }
    resource.addPropertyOverride(`CallbackURLs.${this.callbackUrlCount}`, callbackUrl);
    resource.addPropertyOverride(`LogoutURLs.${this.callbackUrlCount}`, logoutUrl);
    this.callbackUrlCount += 1;
  }

  public updateAllowedCallbackUrls(callbackUrls: string[], logoutUrls: string[]) {
    // Lambda depends on userPoolClientId but userPoolClient depends on the CloudFront domain name (callback URL) which depends on Lambda (fURL).
    // To avoid the circular dependency, we update the callback URL after a userPoolClientId is created.
    // We only use this when custom domain is not used.
    const updateParams = {
      ClientId: this.client.userPoolClientId,
      UserPoolId: this.userPool.userPoolId,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: ['profile', 'phone', 'email', 'openid', 'aws.cognito.signin.user.admin'],
      ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      CallbackURLs: callbackUrls,
      LogoutURLs: logoutUrls,
      SupportedIdentityProviders: ['COGNITO'],
      TokenValidityUnits: {
        IdToken: 'minutes',
      },
      IdTokenValidity: 1440,
    } satisfies UpdateUserPoolClientCommandInput;

    new AwsCustomResource(this, 'UpdateCallbackUrls', {
      onCreate: {
        service: '@aws-sdk/client-cognito-identity-provider',
        action: 'updateUserPoolClient',
        parameters: updateParams,
        physicalResourceId: PhysicalResourceId.of(`${this.userPool.userPoolId}-oauth-config`),
      },
      onUpdate: {
        service: '@aws-sdk/client-cognito-identity-provider',
        action: 'updateUserPoolClient',
        parameters: updateParams,
        physicalResourceId: PhysicalResourceId.of(`${this.userPool.userPoolId}-oauth-config`),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [this.userPool.userPoolArn],
      }),
    });
  }
}
