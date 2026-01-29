import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Redirects to the new sign-up page.
 * Self-registration via Cognito Hosted UI is disabled.
 * Users now register via AdminCreateUser flow on /sign-up.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin =
    process.env.AMPLIFY_APP_ORIGIN ||
    request.headers.get('origin') ||
    request.nextUrl.origin;

  return NextResponse.redirect(new URL('/sign-up', origin));
}
