import { Loader2 } from 'lucide-react';

export default function AuthCallbackLoading() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800 mb-6">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Signing you in...</h2>
        <p className="text-gray-400">Please wait while we verify your session</p>
      </div>
    </div>
  );
}
