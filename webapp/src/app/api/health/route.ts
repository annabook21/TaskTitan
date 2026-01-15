import { NextResponse } from 'next/server';

/**
 * Health check endpoint for ECS Fargate container health monitoring.
 * Returns HTTP 200 to indicate the application is healthy.
 */
export function GET() {
  return NextResponse.json({ status: 'healthy' });
}
