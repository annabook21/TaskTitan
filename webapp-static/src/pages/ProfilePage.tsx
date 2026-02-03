/**
 * ProfilePage - displays the current authenticated user's profile.
 * Uses useAuth hook to get user data from AppSync.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { signInWithRedirect } from 'aws-amplify/auth';
import { deleteCurrentUser } from '../api/appsync';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';

export function ProfilePage() {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated, user, cognitoUserId, error, signOut, refreshUser } = useAuth();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch user profile when authenticated (also auto-creates if not exists)
  useEffect(() => {
    if (isAuthenticated && !user && !isLoading) {
      refreshUser();
    }
  }, [isAuthenticated, user, isLoading, refreshUser]);

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

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteCurrentUser();
      // Sign out after deletion
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('[ProfilePage] Delete account error:', err);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
      setIsDeleting(false);
    }
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

      <div className="flex gap-3">
        <button
          onClick={handleSignOut}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium"
        >
          Sign Out
        </button>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-400 hover:text-red-300 border border-red-600/30 rounded-lg font-medium flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Delete Account
        </button>
      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-md w-full p-6 border border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Delete Account</h3>
                <p className="text-sm text-slate-400">This action cannot be undone</p>
              </div>
            </div>

            <p className="text-slate-300 mb-4">
              Are you sure you want to delete your account? This will:
            </p>
            <ul className="list-disc list-inside text-slate-400 text-sm mb-6 space-y-1">
              <li>Remove your user profile</li>
              <li>Remove you from all teams</li>
              <li>Delete all your assignments</li>
            </ul>

            {deleteError && (
              <div className="p-3 bg-red-900/30 border border-red-600/30 rounded-lg text-red-400 text-sm mb-4">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Account'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
