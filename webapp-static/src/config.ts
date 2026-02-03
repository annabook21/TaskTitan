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

export const config = {
  Auth: {
    Cognito: {
      userPoolId: userPoolId || '',
      userPoolClientId: userPoolClientId || '',
      identityPoolId: identityPoolId || '',
      allowGuestAccess: true,
      loginWith: {
        oauth: {
          domain: cognitoDomain || '',
          // AWS Amplify requires ALL possible redirect URLs in array
          // Amplify automatically selects the correct one based on current origin
          redirectSignIn: [
            'http://localhost:5173/auth-callback',
            'https://dxbbappo989sa.cloudfront.net/auth-callback',
            'https://tasktitan.live/auth-callback',
          ],
          redirectSignOut: [
            'http://localhost:5173',
            'https://dxbbappo989sa.cloudfront.net',
            'https://tasktitan.live',
          ],
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
