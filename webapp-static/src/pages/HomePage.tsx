import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';

export function HomePage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    getCurrentUser()
      .then(() => setSignedIn(true))
      .catch(() => setSignedIn(false));
  }, []);

  if (signedIn === null) {
    return <p className="text-slate-400">Loading...</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">TaskTitan</h1>
      <p className="text-slate-400 mb-6">
        AI-powered project planning. Static frontend (Vite + React) with AppSync + Cognito.
      </p>
      {signedIn ? (
        <div>
          <p className="text-emerald-400 mb-4">You are signed in.</p>
          <Link
            to="/team"
            className="inline-block px-4 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500"
          >
            Go to Teams
          </Link>
        </div>
      ) : (
        <Link
          to="/sign-in"
          className="inline-block px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-500"
        >
          Sign In
        </Link>
      )}
    </div>
  );
}
