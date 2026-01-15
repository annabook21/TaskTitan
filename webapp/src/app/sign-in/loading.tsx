import { Loader2 } from 'lucide-react';

export default function SignInLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-800 mb-6">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
        </div>
        <p className="text-slate-400">Loading...</p>
      </div>
    </div>
  );
}
