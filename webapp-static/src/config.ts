/**
 * Amplify config for Cognito + AppSync (client-only).
 * Set via VITE_* env vars at build time.
 */
const graphqlUrl = import.meta.env.VITE_GRAPHQL_URL;
const userPoolId = import.meta.env.VITE_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
const apiKey = import.meta.env.VITE_APPSYNC_API_KEY;
const appOrigin = import.meta.env.VITE_APP_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');

export const config = {
  Auth: {
    Cognito: {
      userPoolId: userPoolId || '',
      userPoolClientId: userPoolClientId || '',
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

// API key for unauthenticated operations (registerUser)
export const appSyncApiKey = apiKey || '';
