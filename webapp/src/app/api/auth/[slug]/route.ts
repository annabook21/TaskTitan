import { createAuthRouteHandlers } from '@/lib/amplifyServerUtils';
import { tracer, addTraceAnnotation } from '@/lib/tracer';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

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
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const start = performance.now();
  const { slug } = await context.params;

  // Create X-Ray subsegment for auth route
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment(`auth-route-${slug}`);

  try {
    addTraceAnnotation('auth_action', slug);

    logger.info('Auth route handler started', {
      action: slug,
      path: request.nextUrl.pathname,
    });

    // Call the base Amplify auth handler
    const baseHandler = await getBaseHandler();
    const response = await baseHandler(request, context);

    subsegment?.close();

    const duration = performance.now() - start;
    logger.info('Auth route handler completed', {
      action: slug,
      duration_ms: Math.round(duration * 100) / 100,
      status: response.status,
      redirect_location: response.headers.get('location'),
    });

    return response;
  } catch (error) {
    subsegment?.addError(error as Error);
    subsegment?.close();

    const duration = performance.now() - start;
    logger.error('Auth route handler failed', {
      action: slug,
      duration_ms: Math.round(duration * 100) / 100,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
