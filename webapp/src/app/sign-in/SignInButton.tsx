'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';

export default function SignInButton() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleClick = () => {
    setIsLoading(true);
    router.push('/api/auth/sign-in');
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className="group relative w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl text-base font-semibold text-white bg-gradient-to-r from-cyan-500 via-violet-500 to-violet-600 hover:from-cyan-400 hover:via-violet-400 hover:to-violet-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 focus:ring-offset-slate-900 transition-all duration-300 shadow-xl shadow-violet-500/25 hover:shadow-2xl hover:shadow-violet-500/40 hover:scale-[1.02] overflow-hidden disabled:opacity-80 disabled:cursor-not-allowed disabled:hover:scale-100"
    >
      {/* Shimmer effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

      {isLoading ? (
        <Loader2 className="w-5 h-5 relative z-10 animate-spin" />
      ) : (
        <svg className="w-5 h-5 relative z-10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      )}
      <span className="relative z-10">{isLoading ? 'Redirecting...' : 'Continue with AWS Cognito'}</span>
      {!isLoading && (
        <ArrowRight className="w-5 h-5 relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
      )}
    </button>
  );
}
