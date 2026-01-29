import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getEntities } from '@/lib/dynamodb/service';

/**
 * Dev endpoint access guard
 *
 * Restricts access to development/debug endpoints to:
 * 1. Only in development mode (or when ALLOW_DEV_ENDPOINTS is set)
 * 2. Only users with OWNER role in at least one team
 *
 * This prevents destructive operations (clear-all-data, fix-ownership, etc.)
 * from being accessible by regular team members or in production environments.
 *
 * Usage:
 * ```typescript
 * import { requireDevAccess } from '@/lib/dev-guard';
 *
 * export async function POST(request: Request) {
 *   const accessDenied = await requireDevAccess();
 *   if (accessDenied) return accessDenied;
 *
 *   // Rest of endpoint logic...
 * }
 * ```
 *
 * AWS Best Practice Reference:
 * https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_securely_operate_env_separation.html
 */
export async function requireDevAccess() {
  // Block in production unless explicitly allowed via environment variable
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_ENDPOINTS) {
    return NextResponse.json({ error: 'Endpoint disabled in production' }, { status: 404 });
  }

  const { userId } = await getSession();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify user has OWNER role in at least one team
  const entities = getEntities();
  const membershipsResult = await entities.membership.query.byUser({ userId }).go();
  const ownerMemberships = membershipsResult.data.filter((m) => m.role === 'OWNER');

  if (ownerMemberships.length === 0) {
    return NextResponse.json(
      {
        error: 'Forbidden: OWNER role required',
        reason: 'This endpoint requires team owner permissions for safety',
      },
      { status: 403 },
    );
  }

  // Access granted
  return null;
}
