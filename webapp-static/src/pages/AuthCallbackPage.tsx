/**
 * OAuth callback page - handles redirect from Cognito Hosted UI.
 * AWS Best Practice: Use fetchAuthSession() to ensure OAuth code exchange completes
 * before checking user status.
 *
 * IMPORTANT: AppSync uses the access token for auth, which doesn't contain email/name.
 * We extract these from the ID token and sync to DynamoDB here.
 * @see https://docs.amplify.aws/react/build-a-backend/auth/connect-your-frontend/sign-in/#redirect-handling
 * @see https://github.com/aws-amplify/amplify-data/issues/485
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { Loader2 } from 'lucide-react';
import { syncUserProfile } from '../api/appsync';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // AWS Best Practice: Use AbortController to prevent state updates on unmounted component
    const controller = new AbortController();

    async function handleCallback() {
      try {
        // AWS Best Practice: fetchAuthSession ensures OAuth code exchange completes
        // and tokens are stored before we check user status
        const session = await fetchAuthSession();

        // Check if component was unmounted during async operation
        if (controller.signal.aborted) return;

        // Verify user is authenticated
        await getCurrentUser();

        if (controller.signal.aborted) return;

        // Extract email and name from ID token (not available in access token)
        // This fixes the issue where User records are created with null email/name
        // because AppSync uses the access token which doesn't contain these claims
        const idToken = session.tokens?.idToken;
        if (idToken) {
          const email = idToken.payload.email as string | undefined;
          const name = idToken.payload.name as string | undefined;

          if (email && name && !controller.signal.aborted) {
            // Sync user profile to DynamoDB with data from ID token
            await syncUserProfile({ email, name });
          }
        }

        // Redirect to dashboard on success (only if not aborted)
        if (!controller.signal.aborted) {
          navigate('/home', { replace: true });
        }
      } catch (err) {
        // Only set error if component is still mounted
        if (controller.signal.aborted) return;

        console.error('[AuthCallbackPage] Error:', err);

        // Categorize OAuth errors for better user feedback
        const errorMessage = extractAuthError(err);
        setError(errorMessage);
      }
    }

    handleCallback();

    // Cleanup: abort pending operations if component unmounts
    return () => controller.abort();
  }, [navigate]);

  // Helper to categorize OAuth errors for user-friendly messages
  function extractAuthError(err: unknown): string {
    if (err instanceof Error) {
      const message = err.message.toLowerCase();

      // OAuth code exchange errors from Cognito
      if (message.includes('invalid_grant') || message.includes('code has been consumed')) {
        return 'Your session has expired. Please try signing in again.';
      }
      if (message.includes('invalid_request')) {
        return 'Invalid sign-in request. Please check your network and try again.';
      }
      // Token parsing errors
      if (message.includes('payload') || message.includes('token')) {
        return 'Could not verify your identity. Please try signing in again.';
      }
      // Network errors
      if (message.includes('network') || message.includes('fetch')) {
        return 'Network error. Please check your connection and try again.';
      }

      return err.message;
    }
    return 'Sign-in failed. Please try again.';
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/70 backdrop-blur-2xl border border-red-500/30 rounded-3xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Sign-in Failed</h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-base font-semibold text-white bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 transition-all"
          >
            Return to Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-lg">Completing sign-in...</p>
      </div>
    </div>
  );
}
