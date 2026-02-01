/**
 * Amplify config for Cognito + AppSync (client-only).
 * Set via VITE_* env vars at build time.
 */
const graphqlUrl = import.meta.env.VITE_GRAPHQL_URL;
const userPoolId = import.meta.env.VITE_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
const apiKey = import.meta.env.VITE_APPSYNC_API_KEY;
const identityPoolId = import.meta.env.VITE_IDENTITY_POOL_ID;
const appOrigin = import.meta.env.VITE_APP_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');

export const config = {
  Auth: {
    Cognito: {
      userPoolId: userPoolId || '',
      userPoolClientId: userPoolClientId || '',
      // Identity Pool for guest (unauthenticated) access via share codes
      // AWS Best Practice: Use Identity Pool with IAM for temporary guest credentials
      identityPoolId: identityPoolId || '',
      // Enable guest access for Amplify v6 to use unauthenticated Identity Pool credentials
      // Reference: https://docs.amplify.aws/gen2/build-a-backend/auth/connect-your-frontend/guest-access/
      allowGuestAccess: true,
      loginWith: {
        oauth: {
          domain: cognitoDomain || '',
          redirectSignIn: [appOrigin ? `${appOrigin}/auth-callback` : 'http://localhost:5173/auth-callback'],
          redirectSignOut: [appOrigin || 'http://localhost:5173'],
          responseType: 'code' as const,
          scopes: ['profile', 'openid', 'email', 'aws.cognito.signin.user.admin'],
        },
      },
    },
  },
  API: {
    GraphQL: {
      endpoint: graphqlUrl || '',
      region: import.meta.env.VITE_AWS_REGION || 'us-east-2',
      defaultAuthMode: 'userPool' as const,
      apiKey: apiKey || '',
    },
  },
};

export const hasConfig = Boolean(graphqlUrl && userPoolId && userPoolClientId && cognitoDomain);

// API key for unauthenticated operations (registerUser, validateShareCode)
export const appSyncApiKey = apiKey || '';

// Identity Pool ID for guest access via share codes
export const guestIdentityPoolId = identityPoolId || '';

// Check if guest mode is available (Identity Pool configured)
export const hasGuestMode = Boolean(identityPoolId && graphqlUrl);
