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
import {
  syncUserProfile,
  migrateGuestToUser,
  acceptTeamInvite,
  validateTeamInvite,
  acceptPendingInvitations,
  guestJoinProject,
  fetchCurrentUser,
} from '../api/appsync';

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

      // Auto-accept pending email invitations
      try {
        setStatus('Checking for pending invitations...');
        const accepted = await acceptPendingInvitations();
        if (accepted) {
          console.log('[AuthCallbackPage] Auto-accepted pending email invitations');
        }
      } catch (err) {
        console.warn('[AuthCallbackPage] Failed to accept pending invitations:', err);
        // Don't fail - user is still authenticated
      }

      // Check for pending guest migration
      const pendingMigration = localStorage.getItem('pendingGuestMigration');
      if (pendingMigration && isMounted) {
        let teamIdToRedirect: string | null = null;
        
        try {
          setStatus('Migrating guest data...');
          const { guestId, teamId } = JSON.parse(pendingMigration);
          teamIdToRedirect = teamId;
          console.log('[AuthCallbackPage] Migrating guest data:', { guestId, teamId });

          const result = await migrateGuestToUser(guestId, teamId);
          console.log('[AuthCallbackPage] Migration result:', result);

          // Clear the guest session from localStorage
          localStorage.removeItem('guestSession');

          if (result.success) {
            console.log('[AuthCallbackPage] Guest migration successful');
            // Redirect to the team after successful migration
            if (isMounted && teamId) {
              navigate(`/team/${teamId}`, { replace: true });
              return;
            }
          } else {
            console.warn('[AuthCallbackPage] Guest migration partial:', result.message);
          }
        } catch (err) {
          console.error('[AuthCallbackPage] Guest migration error:', err);
          // Still redirect to team even if migration had issues
          if (isMounted && teamIdToRedirect) {
            navigate(`/team/${teamIdToRedirect}`, { replace: true });
            return;
          }
        } finally {
          // Always clear the pending migration flag
          localStorage.removeItem('pendingGuestMigration');
        }
      }

      // Auto-detect and migrate existing guest sessions (fallback if flag is missing)
      // This handles cases where user cleared cache or flag was lost
      const guestSessionRaw = localStorage.getItem('tasktitan_guest_session');
      if (guestSessionRaw && !pendingMigration && isMounted) {
        try {
          const guestSession = JSON.parse(guestSessionRaw);
          if (guestSession.guestId && guestSession.teamId) {
            setStatus('Detected guest session, migrating...');
            console.log('[AuthCallbackPage] Auto-detected guest session:', guestSession);
            
            const result = await migrateGuestToUser(guestSession.guestId, guestSession.teamId);
            console.log('[AuthCallbackPage] Auto-migration result:', result);
            
            // Clear the guest session after migration
            localStorage.removeItem('tasktitan_guest_session');
            localStorage.removeItem('guestSession');
            
            if (result.success || result.message?.includes('already')) {
              // Redirect to team after migration (success or already migrated)
              if (isMounted && guestSession.teamId) {
                navigate(`/team/${guestSession.teamId}`, { replace: true });
                return;
              }
            } else {
              console.warn('[AuthCallbackPage] Auto-migration partial:', result.message);
            }
          }
        } catch (err) {
          console.error('[AuthCallbackPage] Auto-migration error:', err);
          // Don't fail - user is still authenticated
        }
      }

      // Check for pending team invite (user clicked "Sign In" on team invite page)
      const pendingTeamInvite = sessionStorage.getItem('pendingTeamInvite');
      if (pendingTeamInvite && isMounted) {
        // Validate OAuth state token and expiry (CSRF protection)
        const stateToken = sessionStorage.getItem('oauthStateToken');
        const stateExpiry = sessionStorage.getItem('oauthStateExpiry');

        if (!stateToken || !stateExpiry) {
          console.warn('[AuthCallbackPage] Pending invite missing state validation, ignoring');
          sessionStorage.removeItem('pendingTeamInvite');
          sessionStorage.removeItem('oauthStateToken');
          sessionStorage.removeItem('oauthStateExpiry');
        } else if (Date.now() > Number(stateExpiry)) {
          console.warn('[AuthCallbackPage] Pending invite expired, ignoring');
          sessionStorage.removeItem('pendingTeamInvite');
          sessionStorage.removeItem('oauthStateToken');
          sessionStorage.removeItem('oauthStateExpiry');
        } else {
          // State is valid, proceed with invite
          let teamIdToRedirect: string | null = null;

          try {
            setStatus('Accepting team invitation...');
            console.log('[AuthCallbackPage] Accepting pending team invite:', pendingTeamInvite);

            // First validate the invite to get the teamId (in case acceptTeamInvite fails)
            try {
              const inviteInfo = await validateTeamInvite(pendingTeamInvite);
              if (inviteInfo.valid && inviteInfo.teamId) {
                teamIdToRedirect = inviteInfo.teamId;
              }
            } catch (validateErr) {
              console.warn('[AuthCallbackPage] Could not validate invite:', validateErr);
            }

            const result = await acceptTeamInvite({ code: pendingTeamInvite });
            console.log('[AuthCallbackPage] Team invite accepted:', result);

            // Clear the pending invite and state tokens, then redirect to the team
            sessionStorage.removeItem('pendingTeamInvite');
            sessionStorage.removeItem('oauthStateToken');
            sessionStorage.removeItem('oauthStateExpiry');
            if (isMounted && result?.teamId) {
              navigate(`/team/${result.teamId}`, { replace: true });
              return;
            }
          } catch (err) {
            console.error('[AuthCallbackPage] Team invite accept error:', err);
            sessionStorage.removeItem('pendingTeamInvite');
            sessionStorage.removeItem('oauthStateToken');
            sessionStorage.removeItem('oauthStateExpiry');

            // Check if user is already a member - still redirect to team
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (errorMessage.includes('already') || errorMessage.includes('AlreadyMember')) {
              console.log('[AuthCallbackPage] User already a member, redirecting to team');
              if (isMounted && teamIdToRedirect) {
                navigate(`/team/${teamIdToRedirect}`, { replace: true });
                return;
              }
            }
          }
        }
      }

      // Check for pending project share code (authenticated user wants to join project)
      // Since project codes are guest-only, we auto-join as guest then immediately migrate
      const pendingProjectCode = sessionStorage.getItem('pendingProjectShareCode');
      if (pendingProjectCode && isMounted) {
        try {
          const { code, projectId } = JSON.parse(pendingProjectCode);
          setStatus('Joining project...');
          console.log('[AuthCallbackPage] Processing pending project share code:', { code, projectId });

          // Get user profile for display name
          const userProfile = await fetchCurrentUser();
          const displayName = userProfile?.name || userProfile?.email?.split('@')[0] || 'User';

          // Join as guest first (required by API)
          const guestSession = await guestJoinProject({
            code,
            displayName,
          });

          // Immediately migrate to authenticated user
          setStatus('Upgrading to authenticated member...');
          const migrationResult = await migrateGuestToUser(guestSession.guestId, guestSession.teamId);
          console.log('[AuthCallbackPage] Auto-migration after project join:', migrationResult);

          // Clear storage
          sessionStorage.removeItem('pendingProjectShareCode');
          localStorage.removeItem('guestSession');
          localStorage.removeItem('tasktitan_guest_session');

          // Redirect to team page
          if (isMounted && guestSession.teamId) {
            navigate(`/team/${guestSession.teamId}`, { replace: true });
            return;
          }
        } catch (err) {
          console.error('[AuthCallbackPage] Failed to join project with share code:', err);
          sessionStorage.removeItem('pendingProjectShareCode');
          // Continue to home - show error would be better UX
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
