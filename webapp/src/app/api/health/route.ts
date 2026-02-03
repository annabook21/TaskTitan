import { NextResponse } from 'next/server';
import { getEntities } from '@/lib/dynamodb/service';

/**
 * Health check endpoint for container health monitoring.
 * Returns HTTP 200 if healthy, 503 if DynamoDB is unreachable.
 */
export async function GET() {
  try {
    // Test DynamoDB connectivity by scanning teams (limit 1)
    const entities = getEntities();
    await entities.team.scan.go({ limit: 1 });

    return NextResponse.json({
      status: 'healthy',
      database: 'connected',
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 },
    );
  }
}
