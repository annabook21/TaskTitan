/**
 * Accept Team Invitation Page - Join a team using an invitation code.
 * 
 * Flow:
 * 1. User enters 6-character invitation code
 * 2. System validates code via API (API_KEY auth)
 * 3. User chooses to:
 *    - Join as guest (temporary access, IAM auth)
 *    - Create account and join permanently (Cognito auth)
 *    - Sign in and join permanently (if already have account)
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { signInWithRedirect } from 'aws-amplify/auth';
import { Users, ArrowRight, Loader2, AlertCircle, CheckCircle2, UserPlus, LogIn } from 'lucide-react';
import { useGuestAuth } from '../hooks/useGuestAuth';
import { useAuth } from '../hooks/useAuth';
import { 
  validateTeamInvite,
  guestJoinTeam,
  acceptTeamInvite,
  type TeamInviteInfo,
} from '../api/appsync';

type JoinStep = 'code' | 'options' | 'guest-name' | 'joining';

export function AcceptTeamInvitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { saveGuestSession, guestSession } = useGuestAuth();
  const { isAuthenticated, checkAuth, isLoading: authLoading } = useAuth();
  
  const [step, setStep] = useState<JoinStep>('code');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteInfo, setInviteInfo] = useState<TeamInviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  // Format code as user types (uppercase, max 6 chars)
  const handleCodeChange = (value: string) => {
    const formatted = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(formatted);
    setError(null);
  };

  // Validate invitation code with a specific value
  const handleValidateCodeWithValue = useCallback(async (codeValue: string) => {
    // Handle both 6 and 8 character codes (take first 6 if longer)
    // Some codes might be 8 chars, extract first 6
    const normalizedCode = codeValue.length >= 6 ? codeValue.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : codeValue.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalizedCode.length !== 6) {
      setError('Please enter a 6-character code');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const result = await validateTeamInvite(normalizedCode);
      
      if (result.valid) {
        setInviteInfo(result);
        // If authenticated, accept directly
        if (isAuthenticated) {
          setIsJoining(true);
          setStep('joining');
          try {
            await acceptTeamInvite({ code: normalizedCode });
            navigate(`/team/${result.teamId}`);
        } catch (err: unknown) {
          console.error('[AcceptTeamInvitePage] acceptTeamInvite error:', err);
            const message = err instanceof Error ? err.message : 'Failed to accept invitation';
            setError(message);
            setIsJoining(false);
            setStep('options');
          }
        } else {
          setStep('options');
        }
      } else {
        setError('Invalid or expired invitation code');
      }
    } catch (err) {
      console.error('[AcceptTeamInvitePage] validateTeamInvite error:', err);
      
      // Extract error message from various error formats
      let message = 'Failed to validate code';
      let errorType = '';
      
      if (err instanceof Error) {
        message = err.message;
      } else if (err && typeof err === 'object') {
        // Check for GraphQL error format
        const graphqlErr = err as { errors?: Array<{ message?: string; errorType?: string }>; data?: unknown };
        if (graphqlErr.errors && Array.isArray(graphqlErr.errors) && graphqlErr.errors.length > 0) {
          const firstError = graphqlErr.errors[0];
          message = firstError.message || 'Unknown GraphQL error';
          errorType = firstError.errorType || '';
          console.error('[AcceptTeamInvitePage] GraphQL error details:', JSON.stringify(graphqlErr.errors, null, 2));
        } else if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
          message = (err as { message: string }).message;
        }
      }
      
      if (message.includes('Network') || message.includes('fetch')) {
        setError('Unable to connect. Please check your internet connection.');
      } else if (message.includes('InvalidTeamInvite') || errorType === 'InvalidTeamInvite') {
        setError('This code is invalid. Please check and try again.');
      } else if (message.includes('ExpiredTeamInvite') || errorType === 'ExpiredTeamInvite') {
        setError('This code has expired. Please ask your team owner for a new one.');
      } else if (message.includes('Unauthorized') || errorType === 'Unauthorized') {
        setError('Unable to validate code. Please check that the API key is configured.');
        console.error('[AcceptTeamInvitePage] Unauthorized error - API key may not be configured');
      } else {
        setError(message);
      }
    } finally {
      setIsValidating(false);
    }
  }, [isAuthenticated, navigate]);

  // Debug logging to help diagnose issues
  useEffect(() => {
    console.log('[AcceptTeamInvitePage] Mounted', {
      pathname: window.location.pathname,
      search: window.location.search,
      code: searchParams.get('code'),
      authLoading,
      isAuthenticated,
      guestSession: !!guestSession,
    });
  }, [authLoading, isAuthenticated, guestSession, searchParams]);

  // Check auth status in background (non-blocking - page works for unauthenticated users)
  // Don't wait for auth check - render page immediately
  useEffect(() => {
    // Run auth check in background without blocking render
    checkAuth().catch(() => {
      // Ignore errors - page works fine without auth
    });
  }, [checkAuth]);

  // If already in a guest session, redirect
  useEffect(() => {
    if (guestSession) {
      navigate('/guest');
    }
  }, [guestSession, navigate]);

  // If authenticated and we have a code, auto-accept
  useEffect(() => {
    if (isAuthenticated && code && inviteInfo?.valid && step === 'options') {
      setIsJoining(true);
      setStep('joining');
      acceptTeamInvite({ code })
        .then(() => {
          if (inviteInfo?.teamId) {
            navigate(`/team/${inviteInfo.teamId}`);
          } else {
            navigate('/home');
          }
        })
        .catch((err) => {
          console.error('[AcceptTeamInvitePage] acceptTeamInvite error:', err);
          const message = err instanceof Error ? err.message : 'Failed to accept invitation';
          setError(message);
          setIsJoining(false);
          setStep('options');
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, code, inviteInfo?.valid, step]);

  // Check for code in URL query params - auto-populate and validate
  useEffect(() => {
    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl && !code) {
      // Handle codes that might be longer (8 chars) or have formatting - extract first 6 chars
      const formattedCode = codeFromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      if (formattedCode.length === 6) {
        setCode(formattedCode);
        // Auto-validate immediately
        handleValidateCodeWithValue(formattedCode).catch(() => {
          // Ignore errors - they'll be shown in the UI
        });
      }
    }
  }, [searchParams, handleValidateCodeWithValue, code]);

  // Validate invitation code from form
  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleValidateCodeWithValue(code);
  };

  // Join as guest
  const handleJoinAsGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!inviteInfo || !code) {
      setError('Invalid invitation code');
      return;
    }

    setStep('joining');
    setError(null);

    try {
      const session = await guestJoinTeam({
        code: code,
        displayName: displayName.trim(),
      });
      
      // Save the guest session
      saveGuestSession({
        guestId: session.guestId,
        displayName: session.displayName,
        projectId: '', // Not applicable for team-only guests
        projectName: '',
        teamId: session.teamId,
        teamName: session.teamName || '',
        createdAt: new Date().toISOString(),
      });
      
      navigate('/guest');
    } catch (err) {
      console.error('[AcceptTeamInvitePage] guestJoinTeam error:', err);
      
      // Extract error message from various error formats
      let message = 'Failed to join team';
      let errorType = '';
      
      if (err instanceof Error) {
        message = err.message;
      } else if (err && typeof err === 'object') {
        // Check for GraphQL error format
        const graphqlErr = err as { errors?: Array<{ message?: string; errorType?: string }>; data?: unknown };
        if (graphqlErr.errors && Array.isArray(graphqlErr.errors) && graphqlErr.errors.length > 0) {
          const firstError = graphqlErr.errors[0];
          message = firstError.message || 'Unknown GraphQL error';
          errorType = firstError.errorType || '';
          console.error('[AcceptTeamInvitePage] GraphQL error details:', JSON.stringify(graphqlErr.errors, null, 2));
        } else if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
          message = (err as { message: string }).message;
        }
      }
      
      // Handle specific error types
      if (message.includes('InvalidTeamInvite') || errorType === 'InvalidTeamInvite') {
        setError('This code is no longer valid. Please ask your team owner for a new one.');
        setStep('code');
        setInviteInfo(null);
      } else if (message.includes('ExpiredTeamInvite') || errorType === 'ExpiredTeamInvite') {
        setError('This code has expired. Please ask your team owner for a new one.');
        setStep('code');
        setInviteInfo(null);
      } else if (message.includes('ConditionalCheckFailedException') || 
                 message.includes('MemberAlreadyExists') || 
                 message.includes('conditional request failed') ||
                 errorType === 'ConditionalCheckFailedException' ||
                 errorType === 'DynamoDB:ConditionalCheckFailedException') {
        // User already joined - this should be handled by backend, but if it reaches here, redirect
        setError('You have already joined this team. Redirecting...');
        // Redirect to guest dashboard or team page
        setTimeout(() => {
          if (inviteInfo?.teamId) {
            navigate(`/team/${inviteInfo.teamId}`);
          } else {
            navigate('/guest');
          }
        }, 2000);
        return; // Don't continue to set step back
      } else if (message.includes('Unauthorized') || errorType === 'Unauthorized') {
        setError('Authentication error. Please refresh and try again.');
        setStep('guest-name');
      } else {
        setError(`Failed to join team: ${message}`);
        setStep('guest-name');
      }
    } finally {
      setIsJoining(false);
    }
  };

  // Sign in and accept
  const handleSignInAndAccept = () => {
    // Store code in sessionStorage to retrieve after sign-in
    if (code) {
      sessionStorage.setItem('pendingTeamInvite', code);
    }
    signInWithRedirect();
  };

  // Don't block rendering on auth check - page works for unauthenticated users
  // Only show loading if we're actively joining (not just checking auth)
  // Auth check happens in background and doesn't block the UI

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 mb-4">
            <Users className="w-8 h-8 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Join Team</h1>
          <p className="text-slate-400">
            Enter the invitation code to join. <strong className="text-emerald-400">No account required!</strong>
          </p>
        </div>

        {/* Code Entry Step */}
        {step === 'code' && (
          <form onSubmit={handleValidateCode} className="space-y-6">
            <div className="component-card">
              <label htmlFor="code" className="block text-sm font-medium text-slate-300 mb-2">
                Invitation Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="ABC123"
                className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                autoFocus
                autoComplete="off"
                disabled={isValidating}
              />
              <p className="mt-2 text-sm text-slate-500">
                Enter the 6-character code shared by your team owner
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
              disabled={code.length !== 6 || isValidating}
              className="w-full btn-primary py-3 text-lg disabled:opacity-50"
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

        {/* Options Step */}
        {step === 'options' && inviteInfo && (
          <div className="space-y-6">
            {/* Code confirmed */}
            <div className="component-card border-emerald-500/30">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Code verified</span>
              </div>
              <div className="text-sm text-slate-400">
                <p>Team: <span className="text-white">{inviteInfo.teamName || 'Team'}</span></p>
                <p>Role: <span className="text-white">{inviteInfo.role || 'MEMBER'}</span></p>
              </div>
            </div>

            {/* Join Options */}
            <div className="component-card space-y-4">
              <h3 className="text-lg font-semibold text-white mb-2">Choose how to join</h3>
              <p className="text-sm text-slate-400 mb-4">
                You can join immediately as a guest, or create an account for permanent access.
              </p>
              
              {/* Option 1: Join as Guest (MOST PROMINENT - No account needed) */}
              <button
                onClick={() => setStep('guest-name')}
                className="w-full flex items-center gap-3 p-4 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-xl hover:border-emerald-500/50 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/30">
                  <Users className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-white flex items-center gap-2">
                    Join as Guest
                    <span className="text-xs font-normal text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full">No account needed</span>
                  </div>
                  <div className="text-sm text-slate-400">Start contributing immediately - just enter your name</div>
                </div>
                <ArrowRight className="w-5 h-5 text-emerald-400 group-hover:text-emerald-300" />
              </button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-700"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-slate-900 px-2 text-slate-500">Or create an account</span>
                </div>
              </div>

              {/* Option 2: Create Account */}
              <Link
                to={`/sign-up?redirect=/join-team?code=${code}`}
                className="w-full flex items-center gap-3 p-4 bg-slate-800 border border-slate-700 rounded-xl hover:border-violet-500/50 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center group-hover:bg-violet-500/20">
                  <UserPlus className="w-5 h-5 text-violet-400" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-white">Create Account</div>
                  <div className="text-sm text-slate-400">Sign up and join permanently</div>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-violet-400" />
              </Link>

              {/* Option 3: Sign In (if have account) */}
              <button
                onClick={handleSignInAndAccept}
                className="w-full flex items-center gap-3 p-4 bg-slate-800 border border-slate-700 rounded-xl hover:border-cyan-500/50 transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20">
                  <LogIn className="w-5 h-5 text-cyan-400" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-white">Sign In</div>
                  <div className="text-sm text-slate-400">Join permanently with your existing account</div>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-cyan-400" />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-600/30 rounded-lg text-red-400">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <button
              onClick={() => {
                setStep('code');
                setInviteInfo(null);
                setError(null);
              }}
              className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition-colors"
            >
              Back
            </button>
          </div>
        )}

        {/* Guest Name Entry Step */}
        {step === 'guest-name' && inviteInfo && (
          <form onSubmit={handleJoinAsGuest} className="space-y-6">
            <div className="component-card">
              <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2">
                Your Name
              </label>
              <input
                id="name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                autoFocus
                autoComplete="name"
              />
              <p className="mt-2 text-sm text-slate-500">
                This is how you'll appear to other team members
              </p>
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
                onClick={() => setStep('options')}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-medium transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={!displayName.trim() || isJoining}
                className="flex-1 btn-primary justify-center disabled:opacity-50"
              >
                {isJoining ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Joining...
                  </>
                ) : (
                  <>
                    Join as Guest
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Joining Step */}
        {step === 'joining' && (
          <div className="text-center py-12">
            <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400 text-lg">Joining team...</p>
          </div>
        )}
      </div>
    </div>
  );
}
