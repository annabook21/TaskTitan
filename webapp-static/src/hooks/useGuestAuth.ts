/**
 * Guest authentication hook for share code access.
 * 
 * Uses Cognito Identity Pool for temporary AWS credentials (IAM auth).
 * Guest sessions are stored in localStorage for persistence.
 * 
 * AWS Best Practice: Identity Pool with unauthenticated role for guest access
 * Reference: https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools-security-best-practices.html
 * Reference: https://docs.amplify.aws/gen2/build-a-backend/auth/connect-your-frontend/fetch-user-session/
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

export interface GuestSession {
  guestId: string;           // Same as Cognito Identity ID
  displayName: string;
  projectId: string;
  projectName?: string | null;
  teamId: string;
  teamName?: string | null;
  createdAt: string;
}

export interface GuestCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

const GUEST_SESSION_KEY = 'tasktitan_guest_session';

/**
 * Hook for managing guest authentication state with Amplify Identity Pool.
 * 
 * Features:
 * - Persists guest session in localStorage
 * - Fetches temporary AWS credentials from Cognito Identity Pool
 * - Auto-refreshes credentials before expiry
 * - Provides methods to join/leave guest session
 */
export function useGuestAuth() {
  const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [credentialsExpiry, setCredentialsExpiry] = useState<Date | null>(null);

  // Load guest session from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GUEST_SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored) as GuestSession;
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
   * Get guest credentials from Cognito Identity Pool.
   * This is called automatically by Amplify when making IAM-authenticated requests.
   * 
   * For manual credential access (e.g., for AWS SDK calls), use this function.
   */
  const getGuestCredentials = useCallback(async (): Promise<GuestCredentials | null> => {
    try {
      // Fetch auth session - Amplify handles guest (unauthenticated) credentials
      // when allowGuestAccess is enabled in the config
      const session = await fetchAuthSession();
      
      if (session.credentials) {
        setCredentialsExpiry(session.credentials.expiration || null);
        return {
          accessKeyId: session.credentials.accessKeyId,
          secretAccessKey: session.credentials.secretAccessKey,
          sessionToken: session.credentials.sessionToken,
          expiration: session.credentials.expiration,
        };
      }
      
      return null;
    } catch (err) {
      console.error('Failed to get guest credentials:', err);
      return null;
    }
  }, []);

  /**
   * Get the Cognito Identity ID for the current guest.
   * This is used as the guestId for all guest operations.
   */
  const getCognitoIdentityId = useCallback(async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession();
      return session.identityId || null;
    } catch (err) {
      console.error('Failed to get Cognito Identity ID:', err);
      return null;
    }
  }, []);

  /**
   * Save guest session after successful join.
   * The guestId should be the Cognito Identity ID from the backend response.
   */
  const saveGuestSession = useCallback((session: GuestSession) => {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
    setGuestSession(session);
  }, []);

  /**
   * Clear guest session (logout).
   * Note: This clears local storage but doesn't invalidate the Cognito Identity.
   * The same Identity ID will be used if the user joins again from the same browser.
   */
  const clearGuestSession = useCallback(() => {
    localStorage.removeItem(GUEST_SESSION_KEY);
    setGuestSession(null);
    setCredentialsExpiry(null);
  }, []);

  /**
   * Check if credentials are expired or will expire soon (within 5 minutes).
   */
  const needsCredentialRefresh = useCallback((): boolean => {
    if (!credentialsExpiry) return true;
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return credentialsExpiry < fiveMinutesFromNow;
  }, [credentialsExpiry]);

  /**
   * Refresh credentials if they're expired or expiring soon.
   * Call this before making IAM-authenticated API calls.
   */
  const ensureValidCredentials = useCallback(async (): Promise<boolean> => {
    if (!guestSession) return false;
    
    if (needsCredentialRefresh()) {
      const creds = await getGuestCredentials();
      return creds !== null;
    }
    
    return true;
  }, [guestSession, needsCredentialRefresh, getGuestCredentials]);

  /**
   * Check if user is in guest mode
   */
  const isGuest = Boolean(guestSession);

  return {
    guestSession,
    isGuest,
    isLoading,
    credentialsExpiry,
    saveGuestSession,
    clearGuestSession,
    getGuestCredentials,
    getCognitoIdentityId,
    ensureValidCredentials,
    needsCredentialRefresh,
  };
}
