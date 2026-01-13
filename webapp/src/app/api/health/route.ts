import { NextResponse } from 'next/server';

/**
 * Health check endpoint for AWS Lambda Web Adapter readiness probe
 *
 * This endpoint is probed by AWS Lambda Web Adapter to determine if the
 * Next.js application is ready to serve traffic. Without this endpoint,
 * the adapter may timeout during initialization, causing cold start issues.
 *
 * Reference: https://github.com/awslabs/aws-lambda-web-adapter
 * Environment variable: AWS_LWA_READINESS_CHECK_PATH="/api/health"
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
