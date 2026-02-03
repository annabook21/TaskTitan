/**
 * useAuth hook - provides authentication state and user profile data.
 * Combines Amplify auth state with AppSync user profile.
 *
 * Uses Amplify Hub to listen for auth events and update state reactively.
 */
import { useState, useEffect, useCallback } from 'react';
import { getCurrentUser as getAmplifyUser, signOut as amplifySignOut, fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { fetchCurrentUser, syncUserProfile, type User } from '../api/appsync';

export type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  cognitoUserId: string | null;
  user: User | null;
  error: string | null;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    cognitoUserId: null,
    user: null,
    error: null,
  });

  const checkAuth = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      // AWS Best Practice: Use fetchAuthSession to get user ID from token 'sub' claim
      // This is more reliable than getCurrentUser().userId when using signInWithRedirect
      // Reference: https://docs.amplify.aws/react/build-a-backend/auth/connect-your-frontend/manage-user-sessions/
      const session = await fetchAuthSession();
      const cognitoUserId = session.tokens?.idToken?.payload.sub as string | undefined;

      if (!cognitoUserId) {
        setState({
          isLoading: false,
          isAuthenticated: false,
          cognitoUserId: null,
          user: null,
          error: null,
        });
        return;
      }

      // Cognito auth is valid - user IS authenticated
      // Don't fetch AppSync user profile here - causes race condition after OAuth
      setState({
        isLoading: false,
        isAuthenticated: true, // Cognito is the source of truth
        cognitoUserId,
        user: null, // Will be loaded separately when needed
        error: null,
      });
    } catch (err) {
      // Cognito auth failed - not authenticated
      const message = err instanceof Error ? err.message : 'Auth check failed';
      // UserUnAuthenticatedException is expected when not logged in
      const isNotAuthError = message.includes('UserUnAuthenticatedException') || message.includes('not authenticated');

      setState({
        isLoading: false,
        isAuthenticated: false,
        cognitoUserId: null,
        user: null,
        error: isNotAuthError ? null : message,
      });
    }
  }, []);

  // Initial auth check + listen for auth events from Amplify Hub
  useEffect(() => {
    // Check auth on mount
    checkAuth();

    // Listen for auth events (signIn, signOut, tokenRefresh, etc.)
    const unsubscribe = Hub.listen('auth', (data) => {
      const { event } = data.payload;

      switch (event) {
        case 'signedIn':
        case 'tokenRefresh':
          // User signed in or tokens refreshed - recheck auth state
          checkAuth();
          break;
        case 'signedOut':
          // User signed out - clear state immediately
          setState({
            isLoading: false,
            isAuthenticated: false,
            cognitoUserId: null,
            user: null,
            error: null,
          });
          break;
        case 'tokenRefresh_failure':
        case 'signInWithRedirect_failure':
          // Auth failure - clear state
          setState({
            isLoading: false,
            isAuthenticated: false,
            cognitoUserId: null,
            user: null,
            error: 'Authentication failed',
          });
          break;
      }
    });

    return () => unsubscribe();
  }, [checkAuth]);

  const signOut = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      await amplifySignOut();
      setState({
        isLoading: false,
        isAuthenticated: false,
        cognitoUserId: null,
        user: null,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed';
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!state.isAuthenticated) return;
    try {
      // Get ID token to extract email/name claims (access token doesn't have them)
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;

      if (idToken) {
        // Extract claims from ID token payload
        const payload = idToken.payload;
        const email = payload.email as string | undefined;
        const name = payload.name as string | undefined;

        // Sync profile to DynamoDB if we have both email and name
        if (email && name) {
          await syncUserProfile({ email, name });
        } else if (email) {
          // At minimum sync email if available
          await syncUserProfile({ email, name: '' });
        }
      }

      // Fetch the updated user profile
      const user = await fetchCurrentUser();
      setState((prev) => ({ ...prev, user }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh user';
      setState((prev) => ({ ...prev, error: message }));
    }
  }, [state.isAuthenticated]);

  return {
    ...state,
    signOut,
    refreshUser,
    checkAuth,
  };
}
