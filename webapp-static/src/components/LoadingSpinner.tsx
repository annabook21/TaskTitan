interface LoadingSpinnerProps {
  /** Size of the spinner: sm (16px), md (24px), lg (32px), xl (48px) */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Optional text to display below the spinner */
  text?: string;
  /** Whether to center the spinner in its container */
  centered?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

export function LoadingSpinner({
  size = 'md',
  text,
  centered = false,
  className = '',
}: LoadingSpinnerProps) {
  const spinner = (
    <div className={`${centered ? 'flex flex-col items-center justify-center' : ''} ${className}`}>
      <svg
        className={`animate-spin ${sizeClasses[size]} text-cyan-500`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      {text && (
        <p className={`mt-2 text-slate-400 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
          {text}
        </p>
      )}
    </div>
  );

  return spinner;
}

/** Full page loading state */
export function PageLoader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <LoadingSpinner size="lg" text={text} centered />
    </div>
  );
}

/** Inline loading for buttons or small areas */
export function InlineLoader({ className = '' }: { className?: string }) {
  return <LoadingSpinner size="sm" className={className} />;
}
