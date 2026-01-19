import { vi } from 'vitest';

/**
 * Sets up mocks for testing server actions
 * Returns a cleanup function to restore all mocks
 */
export function setupActionTest(options: {
  userId?: string;
  isDemo?: boolean;
  prismaMock: unknown;
}) {
  const { userId = 'user-123', isDemo = false, prismaMock } = options;

  // Mock the prisma module
  vi.doMock('@/lib/prisma', () => ({
    prisma: prismaMock,
  }));

  // Mock cookies to control demo mode
  vi.doMock('next/headers', () => ({
    cookies: vi.fn(() => ({
      get: vi.fn((name: string) => {
        if (name === 'tasktitan-demo' && isDemo) {
          return { value: 'true' };
        }
        return undefined;
      }),
      set: vi.fn(),
      delete: vi.fn(),
    })),
    headers: vi.fn(() => new Map()),
  }));

  // Mock the auth context
  // In local dev mode (no USER_POOL_ID), it uses the mock user
  const originalEnv = process.env.NODE_ENV;
  const originalUserPoolId = process.env.USER_POOL_ID;

  // Force local dev mode for testing
  process.env.NODE_ENV = 'development';
  delete process.env.USER_POOL_ID;

  // Mock the user lookup in safe-action
  if (prismaMock && typeof prismaMock === 'object' && 'user' in prismaMock) {
    const prisma = prismaMock as { user: { findUnique: ReturnType<typeof vi.fn> } };
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      email: 'test@example.com',
      name: 'Test User',
    });
  }

  return () => {
    process.env.NODE_ENV = originalEnv;
    if (originalUserPoolId) {
      process.env.USER_POOL_ID = originalUserPoolId;
    }
    vi.resetModules();
  };
}

/**
 * Extracts the result from a safe-action response
 */
export function extractActionResult<T>(
  response: { data?: T; serverError?: string; validationErrors?: unknown } | undefined
): T {
  if (!response) {
    throw new Error('Action returned undefined');
  }
  if (response.serverError) {
    throw new Error(response.serverError);
  }
  if (response.validationErrors) {
    throw new Error(`Validation error: ${JSON.stringify(response.validationErrors)}`);
  }
  if (!response.data) {
    throw new Error('Action returned no data');
  }
  return response.data;
}

/**
 * Expects an action to fail with a specific error message
 */
export function expectActionError(
  response: { data?: unknown; serverError?: string; validationErrors?: unknown } | undefined,
  expectedMessage: string
): void {
  if (!response) {
    throw new Error('Action returned undefined, expected error');
  }
  if (response.data && !response.serverError) {
    throw new Error(`Expected error "${expectedMessage}" but action succeeded`);
  }
  if (!response.serverError?.includes(expectedMessage)) {
    throw new Error(`Expected error "${expectedMessage}" but got "${response.serverError}"`);
  }
}
