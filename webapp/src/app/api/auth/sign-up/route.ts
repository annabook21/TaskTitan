import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Redirects to Cognito Hosted UI /signup endpoint.
 * The /signup endpoint accepts the same parameters as /oauth2/authorize.
 * @see https://docs.aws.amazon.com/cognito/latest/developerguide/managed-login-endpoints.html
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = performance.now();

  try {
    const cognitoDomain = process.env.COGNITO_DOMAIN;
    const clientId = process.env.USER_POOL_CLIENT_ID;
    // Use AMPLIFY_APP_ORIGIN for Lambda/App Runner, fall back to x-forwarded-host header, then origin header
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    const origin = process.env.AMPLIFY_APP_ORIGIN
      || (forwardedHost ? `${forwardedProto}://${forwardedHost}` : null)
      || request.headers.get('origin')
      || request.nextUrl.origin;

    if (!cognitoDomain || !clientId) {
      logger.error('Missing Cognito configuration', {
        hasDomain: !!cognitoDomain,
        hasClientId: !!clientId,
      });
      throw new Error('Cognito configuration missing');
    }

    // Construct the redirect URI (same as sign-in callback)
    const redirectUri = `${origin}/api/auth/sign-in-callback`;
    // Note: parameter is 'scope' (singular), not 'scopes'
    const scope = ['profile', 'openid', 'aws.cognito.signin.user.admin'].join(' ');

    // Build Cognito Hosted UI sign-up URL
    // Format: https://<domain>/signup?redirect_uri=...&response_type=code&client_id=...&scope=...
    const signUpUrl = new URL(`https://${cognitoDomain}/signup`);
    signUpUrl.searchParams.set('redirect_uri', redirectUri);
    signUpUrl.searchParams.set('response_type', 'code');
    signUpUrl.searchParams.set('client_id', clientId);
    signUpUrl.searchParams.set('scope', scope);

    const duration = performance.now() - start;
    logger.info('Sign-up redirect generated', {
      duration_ms: Math.round(duration * 100) / 100,
      redirect_to: signUpUrl.toString(),
    });

    return NextResponse.redirect(signUpUrl.toString());
  } catch (error) {
    const duration = performance.now() - start;
    logger.error('Sign-up redirect failed', {
      duration_ms: Math.round(duration * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    });

    // Redirect to sign-in page with error message
    const signInUrl = new URL('/sign-in', request.nextUrl.origin);
    signInUrl.searchParams.set('error', 'signup_failed');
    return NextResponse.redirect(signInUrl.toString());
  }
}
