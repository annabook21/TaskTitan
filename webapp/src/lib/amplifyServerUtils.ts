import { createServerRunner } from '@aws-amplify/adapter-nextjs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { logger } from '@/lib/logger';

if (process.env.AMPLIFY_APP_ORIGIN_SOURCE_PARAMETER) {
  const ssm = new SSMClient({});
  try {
    const res = await ssm.send(
      new GetParameterCommand({
        Name: process.env.AMPLIFY_APP_ORIGIN_SOURCE_PARAMETER,
      }),
    );

    if (!res.Parameter?.Value) {
      throw new Error(
        `SSM parameter ${process.env.AMPLIFY_APP_ORIGIN_SOURCE_PARAMETER} has no value`,
      );
    }

    process.env.AMPLIFY_APP_ORIGIN = res.Parameter.Value;
    console.log(`Loaded AMPLIFY_APP_ORIGIN from SSM: ${res.Parameter.Value}`);
  } catch (e) {
    console.error('FATAL: Cannot load AMPLIFY_APP_ORIGIN from SSM', e);
    throw e; // Fail fast instead of proceeding with undefined
  }
}

// Validate that AMPLIFY_APP_ORIGIN is set
if (!process.env.AMPLIFY_APP_ORIGIN) {
  throw new Error('AMPLIFY_APP_ORIGIN not set. Required for OAuth callback URLs.');
}


export const { runWithAmplifyServerContext, createAuthRouteHandlers } = createServerRunner({
  config: {
    Auth: {
      Cognito: {
        userPoolId: process.env.USER_POOL_ID!,
        userPoolClientId: process.env.USER_POOL_CLIENT_ID!,
        loginWith: {
          oauth: {
            redirectSignIn: [`${process.env.AMPLIFY_APP_ORIGIN!}/api/auth/sign-in-callback`],
            redirectSignOut: [`${process.env.AMPLIFY_APP_ORIGIN!}/api/auth/sign-out-callback`],
            responseType: 'code',
            domain: process.env.COGNITO_DOMAIN!,
            scopes: ['profile', 'openid', 'aws.cognito.signin.user.admin'],
          },
        },
      },
    },
  },
  runtimeOptions: {
    cookies: {
      sameSite: 'lax',
      // AWS Best Practice: Reduce maxAge to force more frequent token refresh
      // This minimizes cookie payload size sent to Lambda (6MB limit)
      // Trade-off: Users may need to re-authenticate more frequently
      maxAge: 60 * 60 * 2, // 2 hours (reduced from default 7 days)
    },
  },
});
