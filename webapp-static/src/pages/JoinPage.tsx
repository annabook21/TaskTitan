/**
 * Join Page - Enter share code to join a project as a guest.
 * 
 * Flow:
 * 1. User enters 6-character share code
 * 2. System validates code via API (API_KEY auth)
 * 3. If valid, user enters display name
 * 4. System creates guest session via Identity Pool (IAM auth)
 * 5. User redirected to GuestDashboard
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Users, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useGuestAuth } from '../hooks/useGuestAuth';
import {
  validateShareCode as apiValidateShareCode,
  guestJoinProject,
  type ShareCodeInfo,
} from '../api/appsync';

type JoinStep = 'code' | 'name' | 'joining';

export function JoinPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { saveGuestSession, guestSession } = useGuestAuth();
  
  const [step, setStep] = useState<JoinStep>('code');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [codeInfo, setCodeInfo] = useState<ShareCodeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // If already in a guest session, redirect to dashboard
  useEffect(() => {
    if (guestSession) {
      navigate('/guest');
    }
  }, [guestSession, navigate]);

  // Check for code in URL query params (e.g., /join?code=ABC123)
  useEffect(() => {
    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl && codeFromUrl.length === 6) {
      setCode(codeFromUrl.toUpperCase());
      // Auto-validate if code is in URL
      handleValidateCodeWithValue(codeFromUrl.toUpperCase());
    }
  }, [searchParams]);

  // Format code as user types (uppercase, max 6 chars)
  const handleCodeChange = (value: string) => {
    const formatted = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(formatted);
    setError(null);
  };

  // Validate share code with a specific value
  const handleValidateCodeWithValue = async (codeValue: string) => {
    if (codeValue.length !== 6) {
      setError('Please enter a 6-character code');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      // Call the real API with API_KEY auth
      const result = await apiValidateShareCode(codeValue);
      
      if (result.valid) {
        setCodeInfo(result);
        setStep('name');
      } else {
        setError('Invalid or expired share code');
      }
    } catch (err) {
      console.error('[JoinPage] validateShareCode error:', err);
      const message = err instanceof Error ? err.message : 'Failed to validate code';
      
      // User-friendly error messages
      if (message.includes('Network') || message.includes('fetch')) {
        setError('Unable to connect. Please check your internet connection.');
      } else if (message.includes('InvalidShareCode')) {
        setError('This code is invalid. Please check and try again.');
      } else if (message.includes('ExpiredShareCode')) {
        setError('This code has expired. Please ask your project owner for a new one.');
      } else {
        setError(message);
      }
    } finally {
      setIsValidating(false);
    }
  };

  // Validate share code from form
  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleValidateCodeWithValue(code);
  };

  // Join project with display name
  const handleJoinProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }

    setStep('joining');
    setError(null);

    try {
      // Explicitly fetch guest credentials from Identity Pool before making IAM API call
      // Amplify v6 requires this to ensure unauthenticated credentials are available
      console.log('[JoinPage] Fetching guest credentials...');
      const authSession = await fetchAuthSession();
      console.log('[JoinPage] Auth session:', {
        hasCredentials: !!authSession.credentials,
        identityId: authSession.identityId,
        credentials: authSession.credentials ? {
          accessKeyId: authSession.credentials.accessKeyId?.substring(0, 10) + '...',
          expiration: authSession.credentials.expiration,
        } : null,
        tokens: authSession.tokens ? 'present (authenticated)' : 'none (guest)',
        userSub: authSession.userSub || 'none (guest)',
      });

      if (!authSession.credentials) {
        throw new Error('Unable to obtain guest credentials. Please refresh and try again.');
      }

      // Log if we're in authenticated or unauthenticated mode
      const isAuthenticated = !!authSession.tokens;
      console.log('[JoinPage] Auth mode:', isAuthenticated ? 'AUTHENTICATED (User Pool)' : 'UNAUTHENTICATED (Guest)');

      // Call the real API with IAM auth (Cognito Identity Pool)
      const session = await guestJoinProject({
        code: code,
        displayName: displayName.trim(),
      });
      
      // Save the guest session to localStorage
      saveGuestSession({
        guestId: session.guestId,
        displayName: session.displayName,
        projectId: session.projectId,
        projectName: session.projectName,
        teamId: session.teamId,
        teamName: session.teamName,
        createdAt: new Date().toISOString(),
      });
      
      navigate('/guest');
    } catch (err) {
      console.error('[JoinPage] guestJoinProject error:', err);
      const message = err instanceof Error ? err.message : 'Failed to join project';
      
      // User-friendly error messages
      if (message.includes('InvalidShareCode')) {
        setError('This code is no longer valid. Please ask your project owner for a new one.');
        setStep('code');
        setCodeInfo(null);
      } else if (message.includes('ExpiredShareCode')) {
        setError('This code has expired. Please ask your project owner for a new one.');
        setStep('code');
        setCodeInfo(null);
      } else if (message.includes('Unauthorized')) {
        setError('Authentication error. Please refresh and try again.');
        setStep('name');
      } else {
        setError(message);
        setStep('name');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 mb-4">
            <Users className="w-8 h-8 text-cyan-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Join Project</h1>
          <p className="text-slate-400">
            Enter the share code to join as a team member
          </p>
        </div>

        {/* Code Entry Step */}
        {step === 'code' && (
          <form onSubmit={handleValidateCode} className="space-y-6">
            <div className="component-card">
              <label htmlFor="code" className="block text-sm font-medium text-slate-300 mb-2">
                Share Code
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

        {/* Name Entry Step */}
        {step === 'name' && codeInfo && (
          <form onSubmit={handleJoinProject} className="space-y-6">
            {/* Code confirmed */}
            <div className="component-card border-emerald-500/30">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Code verified</span>
              </div>
              <div className="text-sm text-slate-400">
                <p>Project: <span className="text-white">{codeInfo.projectName || 'Project'}</span></p>
                <p>Team: <span className="text-white">{codeInfo.teamName || 'Team'}</span></p>
              </div>
            </div>

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
                onClick={() => {
                  setStep('code');
                  setCodeInfo(null);
                  setError(null);
                }}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={!displayName.trim()}
                className="flex-1 btn-primary py-3 disabled:opacity-50"
              >
                Join Project
              </button>
            </div>
          </form>
        )}

        {/* Joining Step */}
        {step === 'joining' && (
          <div className="component-card text-center py-12">
            <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-lg text-slate-300">Joining project...</p>
          </div>
        )}

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-slate-500">
          Have an account?{' '}
          <Link to="/" className="text-cyan-400 hover:text-cyan-300">
            Sign in instead
          </Link>
        </p>
      </div>
    </div>
  );
}
