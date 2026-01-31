/**
 * Protected route wrapper that requires authentication.
 * AWS Best Practice: Check auth state before rendering protected content.
 * Redirects to sign-in page if user is not authenticated.
 * Optionally verifies AppSync user record exists; if not (e.g. post-confirmation delay),
 * still allows access (lenient) so Profile and other pages can handle "profile not ready".
 */
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import { Loader2 } from 'lucide-react';
import { fetchCurrentUser } from '../api/appsync';

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

export function ProtectedRoute() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const location = useLocation();

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        await getCurrentUser();
        if (!mounted) return;
        // Optionally verify user exists in AppSync; on failure still allow access (lenient)
        try {
          await fetchCurrentUser();
        } catch {
          // User record may not exist yet (e.g. post-confirmation); allow access
        }
        if (mounted) {
          setAuthState('authenticated');
        }
      } catch {
        if (mounted) {
          setAuthState('unauthenticated');
        }
      }
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, []);

  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    // Preserve the intended destination for redirect after login
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
