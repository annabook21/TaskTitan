/**
 * OAuth callback page - handles redirect from Cognito Hosted UI.
 * AWS Docs: https://docs.amplify.aws/gen1/react/build-a-backend/auth/add-social-provider/#required-for-multi-page-applications-complete-social-sign-in-after-redirect
 */
import 'aws-amplify/auth/enable-oauth-listener';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { Loader2 } from 'lucide-react';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // Check if user is already authenticated (e.g., page refresh)
    async function checkExistingAuth() {
      try {
        await getCurrentUser();
        if (mounted) {
          navigate('/home', { replace: true });
        }
      } catch {
        // Not authenticated yet - wait for OAuth flow via Hub
      }
    }

    // Listen for OAuth completion via Hub events
    const unsubscribe = Hub.listen('auth', (data) => {
      if (!mounted) return;

      const { event } = data.payload;

      if (event === 'signedIn' || event === 'signInWithRedirect') {
        // OAuth code exchange completed successfully
        navigate('/home', { replace: true });
      } else if (event === 'signInWithRedirect_failure') {
        // OAuth flow failed
        const err = data.payload.data as Error | undefined;
        console.error('[AuthCallbackPage] OAuth error:', err);
        setError(err?.message || 'Sign in failed. Please try again.');
      }
    });

    // Check existing auth (handles page refresh during callback)
    checkExistingAuth();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-red-500/30 rounded-2xl p-8 max-w-md text-center">
          <h2 className="text-xl font-semibold text-white mb-4">Sign In Failed</h2>
          <p className="text-slate-300 mb-6">{error}</p>
          <a 
            href="/signin" 
            className="inline-flex items-center justify-center px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-medium rounded-lg transition-colors"
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
        <p className="text-slate-300 text-lg">Completing sign in...</p>
      </div>
    </div>
  );
}
