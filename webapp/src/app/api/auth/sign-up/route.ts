import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Redirects to the sign-in flow.
 * Cognito Hosted UI doesn't have a separate /signup endpoint - it shows
 * a "Sign up" link on the login page when self-service sign-up is enabled.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return NextResponse.redirect(new URL('/api/auth/sign-in', request.nextUrl.origin));
}
