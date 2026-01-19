import { vi } from 'vitest';

// Mock Next.js cache functions
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Mock Next.js headers/cookies
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(() => new Map()),
}));

// Mock Amplify server context
vi.mock('@/lib/amplifyServerUtils', () => ({
  runWithAmplifyServerContext: vi.fn(),
}));

// Mock AWS Amplify auth
vi.mock('aws-amplify/auth/server', () => ({
  getCurrentUser: vi.fn(),
}));
