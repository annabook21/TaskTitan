'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Loader2, Sparkles } from 'lucide-react';

interface Props {
  teamId: string;
}

export default function SeedDemoButton({ teamId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  const handleSeed = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/seed-demo', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        setResult(`✅ Added ${data.team.members.length} members to team!`);
        router.refresh();
      } else {
        setResult(`❌ ${data.error}`);
      }
    } catch (error) {
      setResult(`❌ ${error instanceof Error ? error.message : 'Failed'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="component-card border-dashed border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-amber-300">Demo Mode</h3>
          <p className="text-sm text-slate-400 mt-1">
            Add 6 sample team members with realistic profiles for demo purposes.
          </p>

          {result && <p className="text-sm mt-2 font-medium">{result}</p>}

          <button
            onClick={handleSeed}
            disabled={loading}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg text-amber-300 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Adding demo users...
              </>
            ) : (
              <>
                <Users className="w-4 h-4" />
                Seed Demo Team Members
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
