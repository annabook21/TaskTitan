/**
 * useAuth hook - provides authentication state and user profile data.
 * Combines Amplify auth state with AppSync user profile.
 *
 * Uses Amplify Hub to listen for auth events and update state reactively.
 */
import { useState, useEffect, useCallback } from 'react';
import { getCurrentUser as getAmplifyUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { fetchCurrentUser, type User } from '../api/appsync';

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
      // First check Amplify auth state (Cognito)
      const amplifyUser = await getAmplifyUser();
      const cognitoUserId = amplifyUser?.userId ?? null;

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
      // Try to fetch user profile from AppSync (optional - may not exist yet)
      let user: User | null = null;
      try {
        user = await fetchCurrentUser();
      } catch {
        // User profile may not exist yet (e.g., post-registration delay)
        // This is OK - they're still authenticated via Cognito
      }

      setState({
        isLoading: false,
        isAuthenticated: true, // Cognito is the source of truth
        cognitoUserId,
        user,
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
