import { getSession } from '@/lib/auth';
import Header from '@/components/Header';
import Link from 'next/link';
import { ArrowLeft, BookOpen, FileText, Code, Zap } from 'lucide-react';

export default async function DocsPage() {
  let user = null;
  try {
    const session = await getSession();
    user = session.user;
  } catch {
    // Not logged in, that's fine for docs page
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 mb-8">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>

          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 flex items-center justify-center">
              <BookOpen className="w-7 h-7 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Documentation</h1>
              <p className="text-slate-400">Learn how to use TaskTitan effectively</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="component-card">
              <div className="flex items-center gap-3 mb-4">
                <Zap className="w-6 h-6 text-amber-400" />
                <h2 className="text-lg font-semibold">Getting Started</h2>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                Learn the basics of TaskTitan - creating teams, projects, and components.
              </p>
              <p className="text-xs text-slate-500 italic">Coming soon...</p>
            </div>

            <div className="component-card">
              <div className="flex items-center gap-3 mb-4">
                <FileText className="w-6 h-6 text-violet-400" />
                <h2 className="text-lg font-semibold">Component Planning</h2>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                Best practices for breaking down projects into manageable components.
              </p>
              <p className="text-xs text-slate-500 italic">Coming soon...</p>
            </div>

            <div className="component-card">
              <div className="flex items-center gap-3 mb-4">
                <Code className="w-6 h-6 text-emerald-400" />
                <h2 className="text-lg font-semibold">AI Generation</h2>
              </div>
              <p className="text-slate-400 text-sm mb-4">
                How to use AI to automatically suggest components for your projects.
              </p>
              <p className="text-xs text-slate-500 italic">Coming soon...</p>
            </div>

            <div className="component-card">
              <div className="flex items-center gap-3 mb-4">
                <BookOpen className="w-6 h-6 text-cyan-400" />
                <h2 className="text-lg font-semibold">API Reference</h2>
              </div>
              <p className="text-slate-400 text-sm mb-4">Technical documentation for integrating with TaskTitan.</p>
              <p className="text-xs text-slate-500 italic">Coming soon...</p>
            </div>
          </div>

          <div className="mt-12 p-6 bg-slate-900/50 border border-slate-800 rounded-xl text-center">
            <p className="text-slate-400">Documentation is under construction. Check back soon!</p>
          </div>
        </div>
      </main>
    </div>
  );
}
