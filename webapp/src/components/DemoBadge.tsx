'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { isDemoMode, clearDemoMode } from '@/lib/demo';

export default function DemoBadge() {
  const [isDemo, setIsDemo] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Check demo mode on client side only
    setIsDemo(isDemoMode());
  }, []);

  if (!isDemo) return null;

  const handleExit = () => {
    setIsExiting(true);
    clearDemoMode();
    // Redirect to sign-in page
    window.location.href = '/sign-in';
  };

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg">
      <span className="text-xs font-semibold text-amber-400 tracking-wide">DEMO</span>
      <button
        onClick={handleExit}
        disabled={isExiting}
        className="p-0.5 hover:bg-amber-500/20 rounded transition-colors disabled:opacity-50"
        title="Exit demo mode"
        aria-label="Exit demo mode"
      >
        {isExiting ? (
          <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <X className="w-3 h-3 text-amber-400" />
        )}
      </button>
    </div>
  );
}
