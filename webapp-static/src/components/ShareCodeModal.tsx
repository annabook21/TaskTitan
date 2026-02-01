/**
 * Share Code Modal - Generate and manage share codes for a project.
 * 
 * Used by project owners to create shareable codes that allow
 * team members to join without authentication (guest access).
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Copy, Check, RefreshCw, Clock, Users, AlertTriangle, Trash2 } from 'lucide-react';
import {
  generateShareCode as apiGenerateShareCode,
  revokeShareCode as apiRevokeShareCode,
  listShareCodesForProject,
  type ShareCode,
  type GenerateShareCodeInput,
} from '../api/appsync';

interface ShareCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  teamId?: string;
  teamName?: string;
}

export function ShareCodeModal({ 
  isOpen, 
  onClose, 
  projectId, 
  projectName,
  teamId,
  teamName,
}: ShareCodeModalProps) {
  const [codes, setCodes] = useState<ShareCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiryHours, setExpiryHours] = useState(168); // 7 days default

  // Load existing share codes on open
  const loadCodes = useCallback(async () => {
    if (!isOpen) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const existingCodes = await listShareCodesForProject(projectId);
      setCodes(existingCodes);
    } catch (err) {
      console.error('[ShareCodeModal] loadCodes error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load share codes');
    } finally {
      setLoading(false);
    }
  }, [isOpen, projectId]);

  useEffect(() => {
    loadCodes();
  }, [loadCodes]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    
    try {
      const input: GenerateShareCodeInput = {
        projectId,
        projectName,
        teamId,
        teamName,
        expiresInHours: expiryHours,
      };
      
      const newCode = await apiGenerateShareCode(input);
      
      // Add new code to list
      setCodes(prev => [newCode, ...prev]);
    } catch (err) {
      console.error('[ShareCodeModal] generateShareCode error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (code: string) => {
    setRevokingCode(code);
    setError(null);
    
    try {
      await apiRevokeShareCode(code);
      
      // Remove code from list
      setCodes(prev => prev.filter(c => c.code !== code));
    } catch (err) {
      console.error('[ShareCodeModal] revokeShareCode error:', err);
      setError(err instanceof Error ? err.message : 'Failed to revoke code');
    } finally {
      setRevokingCode(null);
    }
  };

  const handleCopy = async (code: string) => {
    const shareUrl = `${window.location.origin}/join?code=${code}`;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
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
      <div className="bg-slate-900 rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
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
        <div className="px-6 py-6 overflow-y-auto flex-1">
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

          {!loading && (
            <div className="space-y-6">
              {/* Generate new code section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-slate-300">Generate New Code</h3>
                
                {/* Expiry selector */}
                <div className="flex gap-3">
                  <select
                    value={expiryHours}
                    onChange={(e) => setExpiryHours(Number(e.target.value))}
                    className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm"
                  >
                    <option value={24}>1 day</option>
                    <option value={72}>3 days</option>
                    <option value={168}>1 week</option>
                    <option value={336}>2 weeks</option>
                    <option value={720}>30 days</option>
                  </select>

                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {generating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Generate
                  </button>
                </div>
              </div>

              {/* Active codes section */}
              {codes.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-slate-300">
                    Active Codes ({codes.length})
                  </h3>
                  
                  <div className="space-y-3">
                    {codes.map((shareCode) => (
                      <div 
                        key={shareCode.code}
                        className="bg-slate-800 rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xl font-mono font-bold tracking-wider text-cyan-400">
                            {shareCode.code}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCopy(shareCode.code)}
                              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                              title="Copy link"
                            >
                              {copiedCode === shareCode.code ? (
                                <Check className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={() => handleRevoke(shareCode.code)}
                              disabled={revokingCode === shareCode.code}
                              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                              title="Revoke code"
                            >
                              {revokingCode === shareCode.code ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="w-3 h-3" />
                          {formatExpiry(shareCode.expiresAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No codes message */}
              {codes.length === 0 && (
                <div className="text-center py-6">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-400">
                    No active share codes. Generate one to invite team members.
                  </p>
                </div>
              )}

              {/* Instructions */}
              <div className="text-sm text-slate-500 pt-4 border-t border-slate-800">
                <p className="mb-2">Share codes allow team members to:</p>
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
