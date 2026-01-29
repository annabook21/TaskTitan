'use client';

import { useAction } from 'next-safe-action/hooks';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Loader2, CheckCircle, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { registerUser } from './actions';

const formSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
});

type FormData = z.infer<typeof formSchema>;

export default function SignUpForm() {
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { execute, isPending } = useAction(registerUser, {
    onSuccess: (result) => {
      if (result.data?.success) {
        setSuccess(true);
        setErrorMessage(null);
      }
    },
    onError: (error) => {
      setErrorMessage(error.error.serverError ?? 'Registration failed. Please try again.');
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  const onSubmit = (data: FormData) => {
    setErrorMessage(null);
    execute(data);
  };

  if (success) {
    return (
      <div className="bg-slate-900/70 backdrop-blur-2xl border border-emerald-500/30 rounded-3xl p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
        <p className="text-slate-400 mb-6">
          We&apos;ve sent you a temporary password. Use it to sign in and set your permanent password.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-base font-semibold text-white bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 transition-all"
        >
          Go to Sign In
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
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
          {...register('name')}
          type="text"
          id="name"
          className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
          placeholder="John Doe"
          disabled={isPending}
        />
        {errors.name && <p className="mt-1 text-sm text-red-400">{errors.name.message}</p>}
      </div>

      {/* Email field */}
      <div className="mb-6">
        <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
          Email address
        </label>
        <input
          {...register('email')}
          type="email"
          id="email"
          className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
          placeholder="john@example.com"
          disabled={isPending}
        />
        {errors.email && <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>}
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl text-base font-semibold text-white bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-400 hover:via-teal-400 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 focus:ring-offset-slate-900 transition-all duration-300 shadow-xl shadow-emerald-500/25 hover:shadow-2xl hover:shadow-emerald-500/40 disabled:opacity-80 disabled:cursor-not-allowed"
      >
        {isPending ? (
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
  );
}
