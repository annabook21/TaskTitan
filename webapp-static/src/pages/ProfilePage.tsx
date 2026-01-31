/**
 * ProfilePage - displays the current authenticated user's profile.
 * Uses useAuth hook to get user data from AppSync.
 */
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';

export function ProfilePage() {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated, user, cognitoUserId, error, signOut } = useAuth();

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Profile</h1>
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Profile</h1>
        <p className="text-slate-400 mb-4">You need to sign in to view your profile.</p>
        <button
          onClick={() => signInWithRedirect()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium"
        >
          Sign In
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Profile</h1>
        <p className="text-red-400 mb-4">Error: {error}</p>
      </div>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Profile</h1>

      <div className="bg-slate-800 rounded-lg p-6 mb-6">
        <div className="flex items-start gap-6">
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt="Avatar"
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center text-2xl text-slate-400">
              {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
            </div>
          )}

          <div className="flex-1">
            <h2 className="text-xl font-semibold text-white mb-1">
              {user?.name || 'No name set'}
            </h2>
            <p className="text-slate-400 mb-4">{user?.email || cognitoUserId}</p>

            <div className="space-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-slate-500">User ID:</span>
                <span className="text-slate-300 font-mono">{user?.id || cognitoUserId}</span>
              </div>
              {user?.createdAt && (
                <div className="flex gap-2">
                  <span className="text-slate-500">Joined:</span>
                  <span className="text-slate-300">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {!user && (
        <div className="bg-yellow-900/30 border border-yellow-600/30 rounded-lg p-4 mb-6">
          <p className="text-yellow-400 text-sm">
            Your profile has not been created in the database yet. This happens when you first sign in.
            Profile data will be created when you perform your first action.
          </p>
        </div>
      )}

      <button
        onClick={handleSignOut}
        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium"
      >
        Sign Out
      </button>
    </div>
  );
}
