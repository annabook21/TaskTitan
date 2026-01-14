import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchAuthSession } from 'aws-amplify/auth/server';
import { runWithAmplifyServerContext } from '@/lib/amplifyServerUtils';

// Local development mode - bypasses Cognito auth
const IS_LOCAL_DEV = process.env.NODE_ENV === 'development' && !process.env.USER_POOL_ID;

// Track cold starts for performance analysis
let isFirstInvocation = true;

export async function middleware(request: NextRequest) {
  const isColdStart = isFirstInvocation;
  isFirstInvocation = false;

  const response = NextResponse.next();
  const path = request.nextUrl.pathname;

  // Skip auth check in local development
  if (IS_LOCAL_DEV) {
    return response;
  }

  let authenticated = false;

  try {
    authenticated = await runWithAmplifyServerContext({
      nextServerContext: { request, response },
      operation: async (contextSpec) => {
        try {
          const session = await fetchAuthSession(contextSpec);
          return session.tokens?.accessToken !== undefined && session.tokens?.idToken !== undefined;
        } catch {
          return false;
        }
      },
    });
  } catch (error) {
    throw error;
  }

  if (authenticated) {
    return response;
  }

  // Cache unauthenticated redirects briefly at the CDN to reduce repeated cold-start exposure.
  // This is safe because authenticated requests include Cognito cookies and therefore have a different cache key.
  const redirect = NextResponse.redirect(new URL('/sign-in', request.url));
  if (path === '/') {
    redirect.headers.set('Cache-Control', 'public, max-age=0, s-maxage=30');
  }
  redirect.headers.set('x-cold-start', isColdStart ? '1' : '0');
  return redirect;
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (authentication routes)
     * - api/health (health check)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - sign-in (sign-in page)
     *
     * This protects ALL other routes including API routes like /api/clear-all-data
     */
    '/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|sign-in).*)',
  ],
};
