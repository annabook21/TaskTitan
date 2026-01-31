import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Listens for auth:session-expired (dispatched by AppSync client on 401/unauthenticated).
 * Redirects to sign-in and signs out so the user can re-authenticate.
 */
export function AuthSessionExpiredListener() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    const handleSessionExpired = async () => {
      try {
        await signOut();
      } catch {
        // Ignore signOut errors
      }
      navigate('/', { replace: true });
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, [navigate, signOut]);

  return null;
}
