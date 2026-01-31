import { Outlet, Link, useNavigate } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '../hooks/useAuth';

export function Layout() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <Link to="/home" className="text-xl font-bold text-cyan-400">
            TaskTitan
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/home" className="text-slate-300 hover:text-white">
              Home
            </Link>
            <Link to="/my-tasks" className="text-slate-300 hover:text-white">
              My Tasks
            </Link>
            <Link to="/team" className="text-slate-300 hover:text-white">
              Teams
            </Link>
            <Link to="/project" className="text-slate-300 hover:text-white">
              Projects
            </Link>
            <Link to="/profile" className="text-slate-300 hover:text-white">
              Profile
            </Link>
            <NotificationBell />
            <button
              type="button"
              onClick={handleSignOut}
              className="text-slate-300 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="p-6 flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-800 px-6 py-4 mt-auto">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>&copy; {new Date().getFullYear()} TaskTitan</p>
          <nav className="flex items-center gap-4">
            <Link to="/docs" className="hover:text-slate-300 transition-colors">
              Documentation
            </Link>
            <Link to="/privacy" className="hover:text-slate-300 transition-colors">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
