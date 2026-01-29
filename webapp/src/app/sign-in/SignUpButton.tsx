'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Loader2 } from 'lucide-react';

export default function SignUpButton() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleClick = () => {
    setIsLoading(true);
    router.push('/api/auth/sign-up');
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className="group relative w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl text-base font-semibold text-white bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:via-teal-400 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 focus:ring-offset-slate-900 transition-all duration-300 shadow-xl shadow-emerald-500/25 hover:shadow-2xl hover:shadow-emerald-500/40 hover:scale-[1.02] overflow-hidden disabled:opacity-80 disabled:cursor-not-allowed disabled:hover:scale-100"
    >
      {/* Shimmer effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

      {isLoading ? (
        <Loader2 className="w-5 h-5 relative z-10 animate-spin" />
      ) : (
        <UserPlus className="w-5 h-5 relative z-10" />
      )}
      <span className="relative z-10">{isLoading ? 'Redirecting...' : 'Create Account'}</span>
    </button>
  );
}
