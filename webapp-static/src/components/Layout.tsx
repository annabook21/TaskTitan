import { Outlet, Link } from 'react-router-dom';

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-cyan-400">
            TaskTitan
          </Link>
          <nav className="flex gap-4">
            <Link to="/" className="text-slate-300 hover:text-white">
              Home
            </Link>
            <Link to="/team" className="text-slate-300 hover:text-white">
              Teams
            </Link>
          </nav>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
