/**
 * Join Team Page - Use invite code to join a team as an authenticated user.
 *
 * Flow:
 * 1. User visits /join-team?code=<code> or enters code manually
 * 2. System validates code via API (Cognito auth required)
 * 3. If valid, user sees team name and role they'll receive
 * 4. User clicks "Join Team" to confirm
 * 5. System creates team membership
 * 6. User redirected to team page
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Users, ArrowRight, Loader2, AlertCircle, CheckCircle2, UserPlus, LogIn } from 'lucide-react';
import { getCurrentUser, signInWithRedirect } from 'aws-amplify/auth';
import {
  validateTeamInvite,
  joinTeamWithCode,
  type TeamInviteValidation,
  type MemberRole,
} from '../api/appsync';

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';
type JoinStep = 'code' | 'confirm' | 'joining' | 'success' | 'unauthenticated';

const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
  GUEST: 'Guest',
};

export function JoinTeamPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [authState, setAuthState] = useState<AuthState>('loading');
  const [step, setStep] = useState<JoinStep>('code');
  const [code, setCode] = useState('');
  const [inviteInfo, setInviteInfo] = useState<TeamInviteValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [joinedTeamId, setJoinedTeamId] = useState<string | null>(null);

  // Check if user is authenticated
  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        await getCurrentUser();
        if (mounted) {
          setAuthState('authenticated');
        }
      } catch {
        if (mounted) {
          setAuthState('unauthenticated');
          setStep('unauthenticated');
        }
      }
    }

    checkAuth();

    return () => {
      mounted = false;
    };
  }, []);

  // Check for code in URL query params (e.g., /join-team?code=ABC12345)
  useEffect(() => {
    if (authState !== 'authenticated') return;

    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl && codeFromUrl.length === 8) {
      setCode(codeFromUrl.toUpperCase());
      // Auto-validate if code is in URL
      handleValidateCodeWithValue(codeFromUrl.toUpperCase());
    }
  }, [searchParams, authState]);

  // Format code as user types (uppercase, max 8 chars)
  const handleCodeChange = (value: string) => {
    const formatted = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(formatted);
    setError(null);
  };

  // Validate invite code with a specific value
  const handleValidateCodeWithValue = async (codeValue: string) => {
    if (codeValue.length !== 8) {
      setError('Please enter an 8-character invite code');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const result = await validateTeamInvite(codeValue);

      if (result.valid) {
        setInviteInfo(result);
        setStep('confirm');
      } else {
        setError('Invalid or expired invite code');
      }
    } catch (err) {
      console.error('[JoinTeamPage] validateTeamInvite error:', err);
      const message = err instanceof Error ? err.message : 'Failed to validate code';

      // User-friendly error messages
      if (message.includes('Network') || message.includes('fetch')) {
        setError('Unable to connect. Please check your internet connection.');
      } else if (message.includes('Unauthorized')) {
        setError('Please sign in to join a team.');
        setStep('unauthenticated');
      } else {
        setError(message);
      }
    } finally {
      setIsValidating(false);
    }
  };

  // Validate code from form
  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleValidateCodeWithValue(code);
  };

  // Join team
  const handleJoinTeam = async () => {
    setStep('joining');
    setError(null);

    try {
      const membership = await joinTeamWithCode(code);

      // Extract teamId from membership response
      // membership.teamId should be available based on Membership type
      setJoinedTeamId(membership.teamId);
      setStep('success');

      // Auto-redirect after short delay
      setTimeout(() => {
        navigate(`/team/${membership.teamId}`);
      }, 2000);
    } catch (err) {
      console.error('[JoinTeamPage] joinTeamWithCode error:', err);
      const message = err instanceof Error ? err.message : 'Failed to join team';

      if (message.includes('already a member')) {
        setError('You are already a member of this team.');
        setStep('confirm');
      } else if (message.includes('Invalid') || message.includes('expired')) {
        setError('This invite code is no longer valid.');
        setStep('code');
        setInviteInfo(null);
      } else if (message.includes('max uses')) {
        setError('This invite code has reached its maximum number of uses.');
        setStep('code');
        setInviteInfo(null);
      } else {
        setError(message);
        setStep('confirm');
      }
    }
  };

  // Handle sign-in redirect with invite code preservation
  const handleSignIn = () => {
    // Store code in sessionStorage to retrieve after sign-in
    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl) {
      // Generate random state token for validation (CSRF protection)
      const stateToken = crypto.randomUUID();
      
      sessionStorage.setItem('pendingTeamInvite', codeFromUrl.toUpperCase());
      sessionStorage.setItem('oauthStateToken', stateToken);
      // Set expiry to 10 minutes from now
      sessionStorage.setItem('oauthStateExpiry', String(Date.now() + 600000));
    }
    signInWithRedirect();
  };

  // Loading state while checking auth
  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  // Unauthenticated state - prompt to sign in
  if (step === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 mb-4">
              <UserPlus className="w-8 h-8 text-violet-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Join Team</h1>
            <p className="text-slate-400">
              Sign in to join with your invite code
            </p>
          </div>

          <div className="component-card text-center py-8">
            <LogIn className="w-12 h-12 text-slate-500 mx-auto mb-4" />
            <p className="text-slate-300 mb-4">
              You need to sign in to join a team.
            </p>
            <button
              onClick={handleSignIn}
              className="inline-flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors"
            >
              Sign In
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          {/* Footer - link to guest join */}
          <p className="mt-8 text-center text-sm text-slate-500">
            Have a project share code?{' '}
            <Link to="/join" className="text-cyan-400 hover:text-cyan-300">
              Join as guest
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 mb-4">
            <UserPlus className="w-8 h-8 text-violet-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Join Team</h1>
          <p className="text-slate-400">
            Enter your invite code to join a team
          </p>
        </div>

        {/* Code Entry Step */}
        {step === 'code' && (
          <form onSubmit={handleValidateCode} className="space-y-6">
            <div className="component-card">
              <label htmlFor="code" className="block text-sm font-medium text-slate-300 mb-2">
                Invite Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="ABC12345"
                className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                autoFocus
                autoComplete="off"
                disabled={isValidating}
              />
              <p className="mt-2 text-sm text-slate-500">
                Enter the 8-character code shared by your team admin
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-600/30 rounded-lg text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={code.length !== 8 || isValidating}
              className="w-full px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium text-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Confirm Step */}
        {step === 'confirm' && inviteInfo && (
          <div className="space-y-6">
            {/* Invite details */}
            <div className="component-card border-emerald-500/30">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Valid invite code</span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Team</span>
                  <span className="text-white font-medium">{inviteInfo.teamName || 'Team'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Your role</span>
                  <span className="px-2 py-0.5 bg-violet-500/20 text-violet-300 rounded text-sm font-medium">
                    {inviteInfo.role ? ROLE_LABELS[inviteInfo.role] : 'Member'}
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-600/30 rounded-lg text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep('code');
                  setInviteInfo(null);
                  setError(null);
                }}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleJoinTeam}
                className="flex-1 px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Users className="w-5 h-5" />
                Join Team
              </button>
            </div>
          </div>
        )}

        {/* Joining Step */}
        {step === 'joining' && (
          <div className="component-card text-center py-12">
            <Loader2 className="w-12 h-12 text-violet-400 animate-spin mx-auto mb-4" />
            <p className="text-lg text-slate-300">Joining team...</p>
          </div>
        )}

        {/* Success Step */}
        {step === 'success' && (
          <div className="component-card text-center py-12 border-emerald-500/30">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <p className="text-lg text-white mb-2">Welcome to the team!</p>
            <p className="text-slate-400 mb-4">Redirecting you to your new team...</p>
            {joinedTeamId && (
              <Link
                to={`/team/${joinedTeamId}`}
                className="text-violet-400 hover:text-violet-300"
              >
                Go to team now
              </Link>
            )}
          </div>
        )}

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-slate-500">
          Have a project share code instead?{' '}
          <Link to="/join" className="text-cyan-400 hover:text-cyan-300">
            Join as guest
          </Link>
        </p>
      </div>
    </div>
  );
}
