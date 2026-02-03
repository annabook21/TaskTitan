/**
 * Team Invite Modal - Generate and manage invite codes for a team.
 *
 * Used by team owners/admins to create shareable codes that allow
 * authenticated users to join the team.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Copy, Check, Clock, Users, AlertTriangle, Trash2, Link2, MessageSquare, UserPlus } from 'lucide-react';
import {
  generateTeamInvite,
  revokeTeamInvite,
  listTeamInviteCodes,
  type TeamInviteCode,
  type GenerateTeamInviteInput,
  type MemberRole,
} from '../api/appsync';

interface TeamInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  teamName: string;
}

const ROLE_OPTIONS: { value: MemberRole; label: string; description: string }[] = [
  { value: 'MEMBER', label: 'Member', description: 'Can view and edit projects' },
  { value: 'VIEWER', label: 'Viewer', description: 'Can only view projects' },
  { value: 'ADMIN', label: 'Admin', description: 'Can manage team settings' },
];

export function TeamInviteModal({
  isOpen,
  onClose,
  teamId,
  teamName,
}: TeamInviteModalProps) {
  const [codes, setCodes] = useState<TeamInviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiryHours, setExpiryHours] = useState(168); // 7 days default
  const [role, setRole] = useState<MemberRole>('MEMBER');
  const [maxUses, setMaxUses] = useState<number | null>(null); // null = unlimited

  // Load existing invite codes on open
  const loadCodes = useCallback(async () => {
    if (!isOpen) return;

    setLoading(true);
    setError(null);

    try {
      const existingCodes = await listTeamInviteCodes(teamId);
      setCodes(existingCodes);
    } catch (err) {
      console.error('[TeamInviteModal] loadCodes error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load invite codes');
    } finally {
      setLoading(false);
    }
  }, [isOpen, teamId]);

  useEffect(() => {
    loadCodes();
  }, [loadCodes]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);

    try {
      const input: GenerateTeamInviteInput = {
        teamId,
        role,
        expiresInHours: expiryHours,
        maxUses: maxUses ?? undefined,
      };

      const newCode = await generateTeamInvite(input);

      // Add new code to list
      setCodes(prev => [newCode, ...prev]);
    } catch (err) {
      console.error('[TeamInviteModal] generateTeamInvite error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (code: string) => {
    setRevokingCode(code);
    setError(null);

    try {
      await revokeTeamInvite(code);

      // Remove code from list
      setCodes(prev => prev.filter(c => c.code !== code));
    } catch (err) {
      console.error('[TeamInviteModal] revokeTeamInvite error:', err);
      setError(err instanceof Error ? err.message : 'Failed to revoke code');
    } finally {
      setRevokingCode(null);
    }
  };

  const handleCopy = async (code: string) => {
    const shareUrl = `${window.location.origin}/join-team?code=${code}`;

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

  const formatRole = (roleValue: MemberRole) => {
    const option = ROLE_OPTIONS.find(r => r.value === roleValue);
    return option?.label || roleValue;
  };

  const formatMaxUses = (inviteCode: TeamInviteCode) => {
    if (inviteCode.maxUses === null || inviteCode.maxUses === undefined) {
      return `${inviteCode.usageCount} uses`;
    }
    return `${inviteCode.usageCount}/${inviteCode.maxUses} uses`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-2xl border border-slate-800 w-full max-w-md overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">
              <UserPlus className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Invite Team Members</h2>
              <p className="text-sm text-slate-400">{teamName}</p>
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
              <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
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
              {/* Generate new invite link section */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-slate-300">Create Invite Link</h3>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as MemberRole)}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      {ROLE_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Expires in</label>
                    <select
                      value={expiryHours}
                      onChange={(e) => setExpiryHours(Number(e.target.value))}
                      className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                      <option value={24}>1 day</option>
                      <option value={72}>3 days</option>
                      <option value={168}>1 week</option>
                      <option value={336}>2 weeks</option>
                      <option value={720}>30 days</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Max uses (optional)</label>
                  <select
                    value={maxUses === null ? 'unlimited' : maxUses}
                    onChange={(e) => setMaxUses(e.target.value === 'unlimited' ? null : Number(e.target.value))}
                    className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="unlimited">Unlimited</option>
                    <option value={1}>1 use</option>
                    <option value={5}>5 uses</option>
                    <option value={10}>10 uses</option>
                    <option value={25}>25 uses</option>
                    <option value={50}>50 uses</option>
                  </select>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="w-full px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4" />
                  )}
                  Generate Invite Link
                </button>
              </div>

              {/* Active codes section */}
              {codes.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-slate-300">
                    Active Invite Links ({codes.length})
                  </h3>

                  <div className="space-y-3">
                    {codes.map((inviteCode) => {
                      const shareUrl = `${window.location.origin}/join-team?code=${inviteCode.code}`;
                      return (
                        <div
                          key={inviteCode.code}
                          className="bg-slate-800 rounded-lg p-4 space-y-3"
                        >
                          {/* Code display */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xl font-mono font-bold tracking-wider text-violet-400">
                                {inviteCode.code}
                              </span>
                              <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-300 rounded">
                                {formatRole(inviteCode.role)}
                              </span>
                            </div>
                            <button
                              onClick={() => handleRevoke(inviteCode.code)}
                              disabled={revokingCode === inviteCode.code}
                              className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                              title="Revoke code"
                            >
                              {revokingCode === inviteCode.code ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>

                          {/* Metadata */}
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatExpiry(inviteCode.expiresAt)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {formatMaxUses(inviteCode)}
                            </span>
                          </div>

                          {/* Shareable URL with copy button */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
                              <Link2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                              <span className="text-sm text-slate-400 truncate font-mono">
                                {shareUrl}
                              </span>
                            </div>
                            <button
                              onClick={() => handleCopy(inviteCode.code)}
                              className={`px-3 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
                                copiedCode === inviteCode.code
                                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'
                                  : 'bg-violet-600 hover:bg-violet-500 text-white'
                              }`}
                            >
                              {copiedCode === inviteCode.code ? (
                                <>
                                  <Check className="w-4 h-4" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4" />
                                  Copy
                                </>
                              )}
                            </button>
                          </div>

                          {/* Quick tip on first code */}
                          {codes.indexOf(inviteCode) === 0 && copiedCode === inviteCode.code && (
                            <div className="flex items-start gap-2 p-2 bg-emerald-900/20 rounded-lg border border-emerald-600/20">
                              <MessageSquare className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-emerald-300">
                                Link copied! Share it via Slack, email, or any messaging app.
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* No codes message */}
              {codes.length === 0 && (
                <div className="text-center py-6">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3">
                    <UserPlus className="w-6 h-6 text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-400 mb-1">
                    No active invite links yet
                  </p>
                  <p className="text-xs text-slate-500">
                    Generate a link above to invite team members
                  </p>
                </div>
              )}

              {/* How it works */}
              <div className="text-sm pt-4 border-t border-slate-800">
                <p className="font-medium text-slate-300 mb-3">How it works</p>
                <div className="space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</div>
                    <p className="text-slate-400">Generate an invite link with the desired role and expiry</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</div>
                    <p className="text-slate-400">Copy and share the link with your colleagues</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</div>
                    <p className="text-slate-400">They sign in and click the link to join your team</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  Members must have an account to join. Revoke access anytime from this modal.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
