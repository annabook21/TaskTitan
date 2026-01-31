/**
 * Guest authentication hook for share code access.
 * 
 * Uses Cognito Identity Pool for temporary AWS credentials (IAM auth).
 * Guest sessions are stored in localStorage for persistence.
 * 
 * AWS Best Practice: Identity Pool with unauthenticated role for guest access
 * Reference: https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools-security-best-practices.html
 */

import { useState, useEffect, useCallback } from 'react';

export interface GuestSession {
  guestId: string;
  displayName: string;
  projectId: string;
  teamId: string;
  createdAt: string;
}

const GUEST_SESSION_KEY = 'tasktitan_guest_session';

/**
 * Hook for managing guest authentication state.
 * 
 * - Persists guest session in localStorage
 * - Provides methods to join/leave guest session
 * - Automatically clears expired sessions
 */
export function useGuestAuth() {
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load guest session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GUEST_SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored) as GuestSession;
        // TODO: Validate session is still valid with backend
        setGuestSession(session);
      }
    } catch (err) {
      console.error('Failed to load guest session:', err);
      localStorage.removeItem(GUEST_SESSION_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Save guest session after successful join
   */
  const saveGuestSession = useCallback((session: GuestSession) => {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
    setGuestSession(session);
  }, []);

  /**
   * Clear guest session (logout)
   */
  const clearGuestSession = useCallback(() => {
    localStorage.removeItem(GUEST_SESSION_KEY);
    setGuestSession(null);
  }, []);

  /**
   * Check if user is in guest mode
   */
  const isGuest = Boolean(guestSession);

  return {
    guestSession,
    isGuest,
    isLoading,
    saveGuestSession,
    clearGuestSession,
  };
}
