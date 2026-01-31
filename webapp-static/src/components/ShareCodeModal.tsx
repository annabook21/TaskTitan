/**
 * Share Code Modal - Generate and manage share codes for a project.
 * 
 * Used by project owners to create shareable codes that allow
 * team members to join without authentication (guest access).
 */

import { useState, useEffect } from 'react';
import { X, Loader2, Copy, Check, RefreshCw, Clock, Users, AlertTriangle } from 'lucide-react';

interface ShareCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

interface ShareCode {
  code: string;
  expiresAt: string;
  createdAt: string;
}

export function ShareCodeModal({ 
  isOpen, 
  onClose, 
  projectId, 
  projectName 
}: ShareCodeModalProps) {
  const [activeCode, setActiveCode] = useState<ShareCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiryHours, setExpiryHours] = useState(168); // 7 days default

  // Load existing share code on open
  useEffect(() => {
    if (!isOpen) return;

    async function loadCode() {
      setLoading(true);
      setError(null);
      
      try {
        // TODO: Call API to get existing active share code for project
        // For now, simulate no existing code
        await new Promise(resolve => setTimeout(resolve, 300));
        setActiveCode(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load share code');
      } finally {
        setLoading(false);
      }
    }

    loadCode();
  }, [isOpen, projectId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    
    try {
      // TODO: Call generateShareCode API
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Generate mock code (6 chars, no confusing characters)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);
      
      setActiveCode({
        code,
        expiresAt: expiresAt.toISOString(),
        createdAt: now.toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async () => {
    if (!activeCode) return;
    
    setRevoking(true);
    setError(null);
    
    try {
      // TODO: Call revokeShareCode API
      await new Promise(resolve => setTimeout(resolve, 300));
      setActiveCode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke code');
    } finally {
      setRevoking(false);
    }
  };

  const handleCopy = async () => {
    if (!activeCode) return;
    
    const shareUrl = `${window.location.origin}/join?code=${activeCode.code}`;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatExpiry = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'Expired';
    if (diffDays === 0) return 'Expires today';
    if (diffDays === 1) return 'Expires tomorrow';
    return `Expires in ${diffDays} days`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Share Project</h2>
              <p className="text-sm text-slate-400">{projectName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-600/30 rounded-lg flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {!loading && !activeCode && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-slate-500" />
                </div>
                <h3 className="text-lg font-medium text-slate-200 mb-2">
                  Invite team members
                </h3>
                <p className="text-sm text-slate-400">
                  Generate a share code that allows anyone to join this project without creating an account.
                </p>
              </div>

              {/* Expiry selector */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Code expires in
                </label>
                <select
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(Number(e.target.value))}
                  className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white"
                >
                  <option value={24}>1 day</option>
                  <option value={72}>3 days</option>
                  <option value={168}>1 week</option>
                  <option value={336}>2 weeks</option>
                  <option value={720}>30 days</option>
                </select>
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full btn-primary py-3 disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    Generate Share Code
                  </>
                )}
              </button>
            </div>
          )}

          {!loading && activeCode && (
            <div className="space-y-6">
              {/* Code display */}
              <div className="bg-slate-800 rounded-xl p-6 text-center">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Share Code</p>
                <div className="text-4xl font-mono font-bold tracking-[0.3em] text-cyan-400 mb-3">
                  {activeCode.code}
                </div>
                <div className="flex items-center justify-center gap-1 text-sm text-slate-400">
                  <Clock className="w-4 h-4" />
                  {formatExpiry(activeCode.expiresAt)}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-5 h-5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-5 h-5" />
                      Copy Invite Link
                    </>
                  )}
                </button>

                <button
                  onClick={handleRevoke}
                  disabled={revoking}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-transparent hover:bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {revoking ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Revoking...
                    </>
                  ) : (
                    'Revoke Code'
                  )}
                </button>
              </div>

              {/* Instructions */}
              <div className="text-sm text-slate-500 space-y-2">
                <p>Share this link with your team members. They can:</p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li>View all project components</li>
                  <li>Assign themselves to tasks</li>
                  <li>Update status on their tasks</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
