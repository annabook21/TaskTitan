import { Sparkles, Plus, ArrowRight } from 'lucide-react';

// Skeleton loading state for the dashboard
// Shows immediately while session and data are being fetched
export default function DashboardLoading() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header Skeleton */}
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-700 animate-pulse" />
              <div className="w-24 h-6 rounded bg-slate-700 animate-pulse" />
            </div>
            <div className="flex items-center gap-4">
              <div className="w-32 h-8 rounded bg-slate-700 animate-pulse" />
              <div className="w-8 h-8 rounded-full bg-slate-700 animate-pulse" />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-slate-800">
          <div className="absolute inset-0 grid-pattern opacity-50" />
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4" />
                AI-Powered Project Planning
              </div>

              <h1 className="text-4xl lg:text-5xl font-bold mb-6 leading-tight">
                Plan Your Code Structure{' '}
                <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                  Before You Write a Line
                </span>
              </h1>

              <p className="text-lg text-slate-400 mb-8 max-w-2xl">
                TaskTitan helps teams break down projects into components, assign ownership, visualize dependencies, and
                coordinate integration — eliminating merge conflicts before they happen.
              </p>

              <div className="flex flex-wrap gap-4">
                <div className="btn-primary opacity-50 cursor-default">
                  <Plus className="w-5 h-5" />
                  Start New Project
                </div>
                <div className="btn-secondary opacity-50 cursor-default">
                  View All Projects
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Skeleton */}
        <section className="border-b border-slate-800 bg-slate-900/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="text-center">
                  <div className="w-12 h-8 mx-auto rounded bg-slate-700 animate-pulse" />
                  <div className="w-20 h-4 mx-auto mt-2 rounded bg-slate-800 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Content Skeleton */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Recent Projects Skeleton */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <div className="w-40 h-6 rounded bg-slate-700 animate-pulse" />
                <div className="w-24 h-4 rounded bg-slate-800 animate-pulse" />
              </div>
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="component-card p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="w-48 h-5 rounded bg-slate-700 animate-pulse mb-3" />
                        <div className="w-full h-4 rounded bg-slate-800 animate-pulse mb-2" />
                        <div className="w-3/4 h-4 rounded bg-slate-800 animate-pulse" />
                      </div>
                      <div className="w-16 h-6 rounded bg-slate-700 animate-pulse" />
                    </div>
                    <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-700/50">
                      <div className="w-24 h-4 rounded bg-slate-800 animate-pulse" />
                      <div className="w-20 h-4 rounded bg-slate-800 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Teams Skeleton */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="w-24 h-6 rounded bg-slate-700 animate-pulse" />
                <div className="w-20 h-4 rounded bg-slate-800 animate-pulse" />
              </div>
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="component-card p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-700 animate-pulse" />
                      <div className="flex-1">
                        <div className="w-32 h-4 rounded bg-slate-700 animate-pulse mb-2" />
                        <div className="w-20 h-3 rounded bg-slate-800 animate-pulse" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
