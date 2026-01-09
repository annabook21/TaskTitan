import Link from 'next/link';
import { Layers, GitBranch, Users, Calendar, Sparkles, ArrowRight, Zap, Shield } from 'lucide-react';

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex">
      {/* Left side - Visual/Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-slate-900 to-slate-950" />

        {/* Animated grid pattern */}
        <div className="absolute inset-0 grid-pattern opacity-40" />

        {/* Floating orbs */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-cyan-500/20 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: '1s' }}
        />
        <div
          className="absolute top-1/2 right-1/3 w-48 h-48 bg-violet-500/15 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: '2s' }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          {/* Logo */}
          <div className="flex items-center gap-4 mb-12">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-2xl shadow-cyan-500/30">
              <span className="text-white font-bold text-2xl">T</span>
            </div>
            <span className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              TaskTitan
            </span>
          </div>

          {/* Tagline */}
          <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-6">
            Plan projects{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              component by component
            </span>
          </h1>

          <p className="text-lg text-slate-400 mb-12 max-w-md">
            AI-powered project decomposition that eliminates merge conflicts before they happen.
          </p>

          {/* Feature cards */}
          <div className="space-y-4">
            <FeatureCard
              icon={<Sparkles className="w-5 h-5" />}
              title="AI Component Generation"
              description="Describe your project, get instant architecture suggestions"
              delay={0}
            />
            <FeatureCard
              icon={<GitBranch className="w-5 h-5" />}
              title="Dependency Mapping"
              description="Visualize relationships and integration points"
              delay={100}
            />
            <FeatureCard
              icon={<Users className="w-5 h-5" />}
              title="Team Assignment"
              description="Clear ownership prevents stepping on toes"
              delay={200}
            />
            <FeatureCard
              icon={<Calendar className="w-5 h-5" />}
              title="Timeline Planning"
              description="Coordinate integration without conflicts"
              delay={300}
            />
          </div>
        </div>

        {/* Bottom decorative element */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
      </div>

      {/* Right side - Sign in form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center relative">
        {/* Background for mobile */}
        <div className="absolute inset-0 lg:hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/50 via-slate-900 to-slate-950" />
          <div className="absolute inset-0 grid-pattern opacity-20" />
        </div>

        {/* Subtle gradient accent */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />

        <div className="relative z-10 w-full max-w-md mx-auto px-6 sm:px-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
              <span className="text-white font-bold text-xl">T</span>
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-cyan-300 to-emerald-400 bg-clip-text text-transparent">
              TaskTitan
            </span>
          </div>

          {/* Welcome text */}
          <div className="text-center lg:text-left mb-8">
            <h2 className="text-3xl font-bold text-white mb-3">Welcome back</h2>
            <p className="text-slate-400">Sign in to continue planning your projects</p>
          </div>

          {/* Sign in card */}
          <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 shadow-2xl shadow-black/20">
            {/* Trust indicators */}
            <div className="flex items-center justify-center gap-6 mb-8 pb-6 border-b border-slate-800">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span>Secure</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Fast</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Simple</span>
              </div>
            </div>

            {/* Cognito Sign In Button */}
            <Link
              href="/api/auth/sign-in"
              className="group w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl text-base font-semibold text-white bg-gradient-to-r from-cyan-500 via-cyan-500 to-emerald-500 hover:from-cyan-400 hover:via-cyan-400 hover:to-emerald-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg shadow-cyan-500/25 hover:shadow-xl hover:shadow-cyan-500/30 hover:scale-[1.02]"
              prefetch={false}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
              Continue with AWS Cognito
              <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700/50"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-slate-900/60 text-slate-500">Powered by AWS</span>
              </div>
            </div>

            {/* Info text */}
            <p className="text-center text-sm text-slate-400">
              New to TaskTitan? <span className="text-cyan-400">Create an account</span> during sign-in.
            </p>
          </div>

          {/* Additional info */}
          <div className="mt-8 text-center">
            <p className="text-sm text-slate-500">
              By signing in, you agree to our{' '}
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                Terms
              </a>{' '}
              and{' '}
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                Privacy Policy
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="absolute bottom-6 left-0 right-0 text-center">
          <p className="text-sm text-slate-600">
            © {new Date().getFullYear()} TaskTitan • Built with <span className="text-slate-500">AWS Serverless</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <div
      className="group flex items-start gap-4 p-4 rounded-xl bg-slate-800/30 border border-slate-700/50 backdrop-blur-sm hover:bg-slate-800/50 hover:border-slate-600/50 transition-all duration-300"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <div>
        <h3 className="font-semibold text-white mb-1">{title}</h3>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
    </div>
  );
}
