import { useEffect } from 'react';
import { signInWithRedirect } from 'aws-amplify/auth';
import { getCurrentUser } from 'aws-amplify/auth';
import { Link } from 'react-router-dom';

export function SignInPage() {
  useEffect(() => {
    getCurrentUser()
      .then(() => {
        window.location.href = '/';
      })
      .catch(() => {});
  }, []);

  const handleSignIn = () => {
    signInWithRedirect();
  };

  return (
    <div className="max-w-md mx-auto mt-12">
      <h1 className="text-2xl font-bold mb-4">Sign In</h1>
      <p className="text-slate-400 mb-6">
        Sign in with your TaskTitan account (Cognito Hosted UI).
      </p>
      <button
        type="button"
        onClick={handleSignIn}
        className="w-full px-4 py-3 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-500"
      >
        Sign In with Cognito
      </button>
      <p className="mt-4 text-sm text-slate-500">
        <Link to="/" className="text-cyan-400 hover:underline">
          Back to Home
        </Link>
      </p>
    </div>
  );
}
