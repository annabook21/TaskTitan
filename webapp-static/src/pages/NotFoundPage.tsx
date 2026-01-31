import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { FileQuestion, Home } from 'lucide-react';

export function NotFoundPage() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-6">
          <FileQuestion className="w-8 h-8 text-slate-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
        <p className="text-slate-400 mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/home"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors"
        >
          <Home className="w-5 h-5" />
          Go to Home
        </Link>
      </div>
    </div>
  );
}
