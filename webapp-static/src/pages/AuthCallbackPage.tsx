/**
 * OAuth callback page - handles redirect from Cognito Hosted UI.
 *
 * Uses Amplify Hub to listen for OAuth completion events.
 * This is the recommended Amplify v6 approach for handling OAuth callbacks.
 *
 * @see https://docs.amplify.aws/react/build-a-backend/auth/connect-your-frontend/sign-in/#redirect-handling
 */
import 'aws-amplify/auth/enable-oauth-listener';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { Loader2 } from 'lucide-react';
import { syncUserProfile, migrateGuestToUser, acceptTeamInvite } from '../api/appsync';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Completing sign-in...');

  useEffect(() => {
    let isMounted = true;

    // Check if we have the auth code in URL
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Handle OAuth errors from Cognito
    if (errorParam) {
      console.error('[AuthCallbackPage] OAuth error:', errorParam, errorDescription);
      setError(errorDescription || `Authentication error: ${errorParam}`);
      return;
    }

    if (!code) {
      console.error('[AuthCallbackPage] No authorization code in URL');
      setError('No authorization code received. Please try signing in again.');
      return;
    }

    console.log('[AuthCallbackPage] Authorization code received, waiting for Amplify to process...');

    // Listen for auth events from Amplify Hub
    const hubListener = Hub.listen('auth', async (data) => {
      const { event } = data.payload;
      console.log('[AuthCallbackPage] Hub event:', event, data.payload);

      if (!isMounted) return;

      switch (event) {
        case 'signedIn':
        case 'signInWithRedirect':
          // OAuth completed successfully
          setStatus('Syncing profile...');
          try {
            await handleSuccessfulAuth();
          } catch (err) {
            console.error('[AuthCallbackPage] Post-auth error:', err);
            // Don't show error - redirect anyway since auth succeeded
            if (isMounted) {
              navigate('/home', { replace: true });
            }
          }
          break;

        case 'signInWithRedirect_failure':
          console.error('[AuthCallbackPage] signInWithRedirect_failure:', data.payload);
          if (isMounted) {
            setError('Sign-in failed. Please try again.');
          }
          break;
      }
    });

    // Also try direct auth check in case the Hub event already fired
    // (e.g., if Amplify processed the code before our listener was set up)
    async function checkExistingAuth() {
      try {
        // Small delay to let Amplify process the code
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (!isMounted) return;

        // Try to get current user - this will work if Amplify already processed the code
        await getCurrentUser();

        if (!isMounted) return;

        // User is authenticated - handle success
        setStatus('Syncing profile...');
        await handleSuccessfulAuth();
      } catch (err) {
        // User not authenticated yet - wait for Hub event
        console.log('[AuthCallbackPage] Waiting for Amplify to process OAuth code...');
        // Don't set error yet - Hub listener might still fire
      }
    }

    async function handleSuccessfulAuth() {
      if (!isMounted) return;

      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken;

        if (idToken) {
          const email = idToken.payload.email as string | undefined;
          const name = idToken.payload.name as string | undefined;

          if (email && name && isMounted) {
            await syncUserProfile({ email, name });
          }
        }
      } catch (err) {
        console.error('[AuthCallbackPage] Profile sync error:', err);
        // Don't fail - user is still authenticated
      }

      // Check for pending guest migration
      const pendingMigration = localStorage.getItem('pendingGuestMigration');
      if (pendingMigration && isMounted) {
        try {
          setStatus('Migrating guest data...');
          const { guestId, teamId } = JSON.parse(pendingMigration);
          console.log('[AuthCallbackPage] Migrating guest data:', { guestId, teamId });

          const result = await migrateGuestToUser(guestId, teamId);
          console.log('[AuthCallbackPage] Migration result:', result);

          // Clear the guest session from localStorage
          localStorage.removeItem('guestSession');

          if (result.success) {
            console.log('[AuthCallbackPage] Guest migration successful');
          } else {
            console.warn('[AuthCallbackPage] Guest migration partial:', result.message);
          }
        } catch (err) {
          console.error('[AuthCallbackPage] Guest migration error:', err);
          // Don't fail - user is still authenticated
        } finally {
          // Always clear the pending migration flag
          localStorage.removeItem('pendingGuestMigration');
        }
      }

      // Check for pending team invite (user clicked "Sign In" on team invite page)
      const pendingTeamInvite = sessionStorage.getItem('pendingTeamInvite');
      if (pendingTeamInvite && isMounted) {
        try {
          setStatus('Accepting team invitation...');
          console.log('[AuthCallbackPage] Accepting pending team invite:', pendingTeamInvite);

          const result = await acceptTeamInvite({ code: pendingTeamInvite });
          console.log('[AuthCallbackPage] Team invite accepted:', result);

          // Clear the pending invite and redirect to the team
          sessionStorage.removeItem('pendingTeamInvite');
          if (isMounted && result?.teamId) {
            navigate(`/team/${result.teamId}`, { replace: true });
            return;
          }
        } catch (err) {
          console.error('[AuthCallbackPage] Team invite accept error:', err);
          // Don't fail - user is still authenticated, they can try again
          sessionStorage.removeItem('pendingTeamInvite');
        }
      }

      if (isMounted) {
        navigate('/home', { replace: true });
      }
    }

    checkExistingAuth();

    // Timeout fallback - if nothing happens after 10 seconds, show error
    const timeout = setTimeout(() => {
      if (isMounted && !error) {
        setError('Sign-in is taking too long. Please try again.');
      }
    }, 10000);

    return () => {
      isMounted = false;
      hubListener();
      clearTimeout(timeout);
    };
  }, [navigate, searchParams, error]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/70 backdrop-blur-2xl border border-red-500/30 rounded-3xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Sign-in Failed</h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-base font-semibold text-white bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 transition-all"
          >
            Try Again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-lg">{status}</p>
      </div>
    </div>
  );
}
