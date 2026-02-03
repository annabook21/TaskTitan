import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import { ArrowLeft, Loader2, UserPlus, CheckCircle } from 'lucide-react';
import { registerUser } from '../api/appsync';

export function SignUpPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', email: '' });
  const [formErrors, setFormErrors] = useState<{ name?: string; email?: string }>({});

  // Check if already authenticated
  useEffect(() => {
    async function checkAuth() {
      try {
        await getCurrentUser();
        // Already signed in, redirect to teams
        navigate('/team', { replace: true });
      } catch {
        // Not signed in, show page
        setIsCheckingAuth(false);
      }
    }
    checkAuth();
  }, [navigate]);

  const validateForm = (): boolean => {
    const errors: { name?: string; email?: string } = {};

    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    } else if (formData.name.length > 100) {
      errors.name = 'Name is too long (max 100 characters)';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await registerUser({
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
      });

      if (result.success) {
        setSuccess(true);
      } else {
        setErrorMessage(result.message);
      }
    } catch (error) {
      console.error('Registration error:', error);
      setErrorMessage('Registration failed. Please try again or contact support.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/50 via-slate-900 to-slate-950" />
      <div className="absolute inset-0 grid-pattern opacity-20" />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-float-delayed" />

      <div className="relative z-10 w-full max-w-md">
        {/* Back link */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sign in
        </Link>

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 via-cyan-500 to-violet-600 flex items-center justify-center shadow-xl shadow-cyan-500/30">
            <span className="text-white font-bold text-xl">T</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold bg-gradient-to-r from-cyan-300 via-cyan-400 to-violet-400 bg-clip-text text-transparent">
              TaskTitan
            </span>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-white mb-2">Create your account</h1>
        <p className="text-slate-400 mb-8">
          Enter your details below and we'll send you a temporary password.
        </p>

        {/* Success state */}
        {success ? (
          <div className="bg-slate-900/70 backdrop-blur-2xl border border-emerald-500/30 rounded-3xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
            <p className="text-slate-400 mb-6">
              We've sent you a temporary password. Use it to sign in and set your permanent password.
            </p>
            <Link
              to="/"
              onClick={() => {
                // If coming from team invite, store the code for auto-accept after sign-in
                const redirectUrl = searchParams.get('redirect');
                if (redirectUrl) {
                  const codeMatch = redirectUrl.match(/[?&]code=([A-Za-z0-9]+)/);
                  if (codeMatch) {
                    sessionStorage.setItem('pendingTeamInvite', codeMatch[1].toUpperCase());
                  }
                }
              }}
              className="inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-base font-semibold text-white bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 transition-all"
            >
              Go to Sign In
            </Link>
          </div>
        ) : (
          /* Form */
          <form
            onSubmit={handleSubmit}
            className="bg-slate-900/70 backdrop-blur-2xl border border-slate-800/80 rounded-3xl p-8"
          >
            {/* Error message */}
            {errorMessage && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {errorMessage}
              </div>
            )}

            {/* Name field */}
            <div className="mb-4">
              <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2">
                Full name
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (formErrors.name) setFormErrors({ ...formErrors, name: undefined });
                }}
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                placeholder="John Doe"
                disabled={isSubmitting}
              />
              {formErrors.name && <p className="mt-1 text-sm text-red-400">{formErrors.name}</p>}
            </div>

            {/* Email field */}
            <div className="mb-6">
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                Email address
              </label>
              <input
                type="email"
                id="email"
                value={formData.email}
                onChange={(e) => {
                  setFormData({ ...formData, email: e.target.value });
                  if (formErrors.email) setFormErrors({ ...formErrors, email: undefined });
                }}
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                placeholder="john@example.com"
                disabled={isSubmitting}
              />
              {formErrors.email && <p className="mt-1 text-sm text-red-400">{formErrors.email}</p>}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl text-base font-semibold text-white bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:via-teal-400 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 focus:ring-offset-slate-900 transition-all duration-300 shadow-xl shadow-emerald-500/25 hover:shadow-2xl hover:shadow-emerald-500/40 disabled:opacity-80 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  <UserPlus className="w-5 h-5" />
                  Create Account
                </>
              )}
            </button>
          </form>
        )}

        {/* Terms */}
        <p className="mt-6 text-center text-xs text-slate-500">
          By creating an account, you agree to our{' '}
          <Link to="/docs" className="text-cyan-400 hover:underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="text-cyan-400 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
