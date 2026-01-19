import { createAuthRouteHandlers } from '@/lib/amplifyServerUtils';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { DEMO_COOKIE_NAME } from '@/lib/demo/constants';

type BaseAuthHandler = (request: NextRequest, context: { params: Promise<{ slug: string }> }) => Promise<NextResponse>;

let baseHandlerPromise: Promise<BaseAuthHandler> | null = null;

async function getBaseHandler() {
  if (!baseHandlerPromise) {
    baseHandlerPromise = createAuthRouteHandlers({
      redirectOnSignInComplete: '/auth-callback',
      redirectOnSignOutComplete: '/sign-in',
    }) as Promise<BaseAuthHandler>;
  }
  return baseHandlerPromise;
}

// Wrap with timing instrumentation
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const start = performance.now();
  const { slug } = await context.params;

  try {
    logger.info('Auth route handler started', {
      action: slug,
      path: request.nextUrl.pathname,
    });

    // Call the base Amplify auth handler
    const baseHandler = await getBaseHandler();
    const response = await baseHandler(request, context);

    // Clear demo cookie on sign-in-callback to ensure real auth takes precedence
    if (slug === 'sign-in-callback') {
      response.headers.append(
        'Set-Cookie',
        `${DEMO_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`,
      );
      logger.info('Demo cookie cleared on sign-in-callback');
    }

    const duration = performance.now() - start;
    logger.info('Auth route handler completed', {
      action: slug,
      duration_ms: Math.round(duration * 100) / 100,
      status: response.status,
      redirect_location: response.headers.get('location'),
    });

    return response;
  } catch (error) {
    const duration = performance.now() - start;
    logger.error('Auth route handler failed', {
      action: slug,
      duration_ms: Math.round(duration * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
