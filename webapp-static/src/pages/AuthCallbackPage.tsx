import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then(() => {
        navigate('/', { replace: true });
      })
      .catch((err) => {
        setError(err?.message ?? 'Sign-in failed');
      });
  }, [navigate]);

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-12">
        <p className="text-red-400 mb-4">{error}</p>
        <a href="/" className="text-cyan-400 hover:underline">
          Return home
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-12">
      <p className="text-slate-400">Completing sign-in...</p>
    </div>
  );
}
