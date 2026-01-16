'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Loader2 } from 'lucide-react';
import { initializeDemoMode } from '@/lib/demo';

export default function DemoButton() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const redirectUrl = initializeDemoMode();
      router.push(redirectUrl);
    } catch (error) {
      console.error('Failed to initialize demo:', error);
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className="group w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-xl text-sm font-medium text-slate-300 bg-slate-800/50 border border-slate-700 hover:bg-slate-800 hover:border-cyan-500/50 hover:text-cyan-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Play className="w-4 h-4 group-hover:scale-110 transition-transform" />
      )}
      <span>{isLoading ? 'Starting Demo...' : 'Try Demo'}</span>
      {!isLoading && (
        <span className="text-xs text-slate-500 group-hover:text-cyan-500/70 transition-colors">
          No signup required
        </span>
      )}
    </button>
  );
}
