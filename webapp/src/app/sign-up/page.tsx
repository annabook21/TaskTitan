import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import SignUpForm from './SignUpForm';

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/50 via-slate-900 to-slate-950" />
      <div className="absolute inset-0 grid-pattern opacity-20" />

      {/* Floating orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        {/* Back to sign-in link */}
        <Link
          href="/sign-in"
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
          Enter your details below and we&apos;ll send you a temporary password.
        </p>

        {/* Form */}
        <SignUpForm />

        {/* Terms */}
        <p className="mt-6 text-center text-xs text-slate-500">
          By creating an account, you agree to our{' '}
          <Link href="/docs" className="text-cyan-400 hover:underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-cyan-400 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
