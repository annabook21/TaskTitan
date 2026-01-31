import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithRedirect, getCurrentUser } from 'aws-amplify/auth';
import {
  GitBranch,
  Sparkles,
  Zap,
  Shield,
  Brain,
  Eye,
  ArrowRight,
  Loader2,
} from 'lucide-react';

export function SignInPage() {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getCurrentUser()
      .then(() => {
        // User is already signed in, redirect to dashboard
        navigate('/home', { replace: true });
      })
      .catch(() => {
        // Not signed in, stay on sign-in page
      });
  }, [navigate]);

  const handleSignIn = () => {
    setIsLoading(true);
    signInWithRedirect();
  };

  return (
    <div className="min-h-screen bg-slate-950 flex overflow-hidden">
      {/* Left side - Visual/Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Animated gradient background with multiple layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950 via-slate-900 to-slate-950" />
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-950/50 via-transparent to-emerald-950/30" />

        {/* Animated grid pattern */}
        <div className="absolute inset-0 grid-pattern opacity-30" />
        <div
          className="absolute inset-0 grid-pattern opacity-20"
          style={{ transform: 'rotate(45deg) scale(1.5)' }}
        />

        {/* Floating orbs with improved animation */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-[32rem] h-[32rem] bg-violet-500/15 rounded-full blur-3xl animate-float-delayed" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] bg-emerald-500/10 rounded-full blur-3xl animate-float-slow" />

        {/* Sparkle effects */}
        <div className="absolute top-20 left-20 w-2 h-2 bg-cyan-400 rounded-full animate-twinkle" />
        <div
          className="absolute top-40 right-32 w-1.5 h-1.5 bg-violet-400 rounded-full animate-twinkle"
          style={{ animationDelay: '0.5s' }}
        />
        <div
          className="absolute bottom-32 left-40 w-1 h-1 bg-emerald-400 rounded-full animate-twinkle"
          style={{ animationDelay: '1s' }}
        />
        <div
          className="absolute top-1/3 right-20 w-1.5 h-1.5 bg-cyan-300 rounded-full animate-twinkle"
          style={{ animationDelay: '1.5s' }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20 animate-fade-in">
          {/* Logo with enhanced styling */}
          <div className="flex items-center gap-4 mb-16 group">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-cyan-500/40 group-hover:shadow-cyan-500/60 transition-shadow duration-300 group-hover:scale-105">
              <span className="text-white font-bold text-3xl">T</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-bold bg-gradient-to-r from-cyan-300 via-cyan-400 to-violet-400 bg-clip-text text-transparent">
                TaskTitan
              </span>
              <span className="text-xs text-slate-500 tracking-wider uppercase">
                Project Intelligence
              </span>
            </div>
          </div>

          {/* Tagline with improved typography */}
          <h1 className="text-5xl xl:text-6xl font-bold text-white leading-[1.1] mb-6">
            Build software{' '}
            <span className="relative inline-block">
              <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
                the smart way
              </span>
              <div className="absolute -bottom-2 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400/50 via-violet-400/50 to-emerald-400/50 blur-sm" />
            </span>
          </h1>

          <p className="text-xl text-slate-300 mb-4 max-w-lg leading-relaxed">
            AI-powered project planning that preserves{' '}
            <span className="text-cyan-400 font-semibold">context</span>, eliminates{' '}
            <span className="text-violet-400 font-semibold">conflicts</span>, and keeps teams{' '}
            <span className="text-emerald-400 font-semibold">aligned</span>.
          </p>

          <p className="text-sm text-slate-500 mb-12 max-w-lg">
            The first PM tool that documents <span className="italic">why</span> decisions were
            made, not just <span className="italic">what</span> needs doing.
          </p>

          {/* Feature cards with enhanced design */}
          <div className="space-y-3">
            <FeatureCard
              icon={<Brain className="w-5 h-5" />}
              title="Decision Memory"
              description="AI captures WHY decisions were made for future context"
              delay={0}
              gradient="from-violet-500/20 to-purple-500/20"
              iconGradient="from-violet-500/30 to-purple-500/30"
              iconColor="text-violet-400"
            />
            <FeatureCard
              icon={<Sparkles className="w-5 h-5" />}
              title="Smart Decomposition"
              description="Break epics into features with AI-powered suggestions"
              delay={100}
              gradient="from-cyan-500/20 to-blue-500/20"
              iconGradient="from-cyan-500/30 to-blue-500/30"
              iconColor="text-cyan-400"
            />
            <FeatureCard
              icon={<Eye className="w-5 h-5" />}
              title="Wireframe Preview"
              description="Generate visual mockups from component descriptions"
              delay={200}
              gradient="from-emerald-500/20 to-green-500/20"
              iconGradient="from-emerald-500/30 to-green-500/30"
              iconColor="text-emerald-400"
            />
            <FeatureCard
              icon={<GitBranch className="w-5 h-5" />}
              title="Conflict Prevention"
              description="Dependency mapping prevents merge conflicts before coding"
              delay={300}
              gradient="from-amber-500/20 to-orange-500/20"
              iconGradient="from-amber-500/30 to-orange-500/30"
              iconColor="text-amber-400"
            />
          </div>
        </div>

        {/* Bottom decorative elements */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-950/80 to-transparent" />
      </div>

      {/* Right side - Sign in form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center relative">
        {/* Background for mobile */}
        <div className="absolute inset-0 lg:hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-950/50 via-slate-900 to-slate-950" />
          <div className="absolute inset-0 grid-pattern opacity-20" />
        </div>

        {/* Subtle gradient accents */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 w-full max-w-md mx-auto px-6 sm:px-8 animate-slide-up">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-10">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-violet-600 flex items-center justify-center shadow-xl shadow-cyan-500/30">
              <span className="text-white font-bold text-2xl">T</span>
            </div>
            <div className="flex flex-col">
              <span className="text-3xl font-bold bg-gradient-to-r from-cyan-300 via-cyan-400 to-violet-400 bg-clip-text text-transparent">
                TaskTitan
              </span>
              <span className="text-xs text-slate-500 tracking-wider uppercase">
                Project Intelligence
              </span>
            </div>
          </div>

          {/* Welcome text with improved styling */}
          <div className="text-center lg:text-left mb-10">
            <h2 className="text-4xl font-bold text-white mb-3 tracking-tight">Welcome back</h2>
            <p className="text-lg text-slate-400">
              Continue building <span className="text-violet-400">intelligent</span> projects
            </p>
          </div>

          {/* Sign in card with enhanced glassmorphism */}
          <div className="bg-slate-900/70 backdrop-blur-2xl border border-slate-800/80 rounded-3xl p-8 shadow-2xl shadow-black/40 hover:border-slate-700/80 transition-all duration-300">
            {/* Trust indicators with better spacing */}
            <div className="flex items-center justify-center gap-8 mb-8 pb-8 border-b border-slate-800/50">
              <div className="flex flex-col items-center gap-1.5 group cursor-default">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                  <Shield className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="text-xs text-slate-400 font-medium">Secure</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 group cursor-default">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
                  <Zap className="w-5 h-5 text-amber-400" />
                </div>
                <span className="text-xs text-slate-400 font-medium">Lightning Fast</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 group cursor-default">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                  <Brain className="w-5 h-5 text-cyan-400" />
                </div>
                <span className="text-xs text-slate-400 font-medium">AI-Powered</span>
              </div>
            </div>

            {/* Cognito Sign In Button */}
            <button
              onClick={handleSignIn}
              disabled={isLoading}
              className="group relative w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl text-base font-semibold text-white bg-gradient-to-r from-cyan-500 via-violet-500 to-violet-600 hover:from-cyan-400 hover:via-violet-400 hover:to-violet-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 focus:ring-offset-slate-900 transition-all duration-300 shadow-xl shadow-violet-500/25 hover:shadow-2xl hover:shadow-violet-500/40 hover:scale-[1.02] overflow-hidden disabled:opacity-80 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

              {isLoading ? (
                <Loader2 className="w-5 h-5 relative z-10 animate-spin" />
              ) : (
                <svg
                  className="w-5 h-5 relative z-10"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                </svg>
              )}
              <span className="relative z-10">
                {isLoading ? 'Redirecting...' : 'Sign In'}
              </span>
              {!isLoading && (
                <ArrowRight className="w-5 h-5 relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
              )}
            </button>

            {/* Sign Up Link */}
            <div className="mt-4 text-center">
              <span className="text-slate-400 text-sm">Don't have an account? </span>
              <Link
                to="/sign-up"
                className="text-cyan-400 hover:text-cyan-300 text-sm font-medium transition-colors"
              >
                Create one
              </Link>
            </div>

            {/* Divider with better styling */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700/50"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-4 py-1 bg-slate-900/70 text-slate-500 rounded-full border border-slate-800/50">
                  Powered by AWS Serverless
                </span>
              </div>
            </div>

            {/* Info text with improved styling */}
            <div className="text-center">
              <p className="text-xs text-slate-500">
                Free tier includes unlimited projects and AI features
              </p>
            </div>
          </div>

          {/* Additional info with links */}
          <div className="mt-8 text-center space-y-3">
            <div className="flex items-center justify-center gap-4">
              <Link
                to="/privacy"
                className="text-sm text-slate-500 hover:text-cyan-400 transition-colors"
              >
                Privacy
              </Link>
              <span className="text-slate-700">•</span>
              <Link
                to="/docs"
                className="text-sm text-slate-500 hover:text-cyan-400 transition-colors"
              >
                Documentation
              </Link>
              <span className="text-slate-700">•</span>
              <a
                href="mailto:support@tasktitan.live"
                className="text-sm text-slate-500 hover:text-cyan-400 transition-colors"
              >
                Support
              </a>
            </div>
          </div>
        </div>

        {/* Footer with enhanced styling */}
        <footer className="absolute bottom-6 left-0 right-0 text-center">
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} TaskTitan • Built with{' '}
            <span className="text-slate-500 font-medium">AWS Serverless Architecture</span>
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
  gradient,
  iconGradient,
  iconColor,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
  gradient: string;
  iconGradient: string;
  iconColor: string;
}) {
  return (
    <div
      className={`group relative flex items-start gap-4 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 backdrop-blur-sm hover:bg-slate-800/60 hover:border-slate-600/50 transition-all duration-300 hover:scale-[1.02] animate-fade-in-up`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'both' }}
    >
      {/* Subtle glow effect */}
      <div
        className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xl`}
      />

      <div
        className={`relative flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${iconGradient} flex items-center justify-center ${iconColor} group-hover:scale-110 group-hover:rotate-6 transition-all duration-300 shadow-lg`}
      >
        {icon}
      </div>
      <div className="relative">
        <h3 className="font-semibold text-white mb-1.5 text-base">{title}</h3>
        <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
