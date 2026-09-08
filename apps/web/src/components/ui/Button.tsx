import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { classNames } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

/** Every state is covered: default, hover, focus, disabled and loading. */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-white border border-brand hover:bg-brand-600 hover:border-brand-600 active:bg-brand-700 disabled:bg-brand-200 disabled:border-brand-200',
  secondary:
    'bg-white text-navy border border-line hover:bg-panel hover:border-[#B9C4D2] active:bg-[#E4EBF2] disabled:bg-panel disabled:text-muted',
  ghost:
    'bg-transparent text-navy border border-transparent hover:bg-panel active:bg-[#E4EBF2] disabled:text-muted',
  danger:
    'bg-critical text-white border border-critical hover:bg-[#BE3A3A] active:bg-[#A83232] disabled:bg-critical-border disabled:border-critical-border',
  success:
    'bg-success text-white border border-success hover:bg-[#148757] active:bg-[#11744A] disabled:bg-success-border disabled:border-success-border',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-support gap-1.5',
  md: 'h-10 px-4 text-body gap-2',
  lg: 'h-12 px-6 text-body-lg gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    loadingText,
    icon,
    iconRight,
    fullWidth,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classNames(
        'inline-flex items-center justify-center rounded-control font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        <>
          {icon}
          {children}
          {iconRight}
        </>
      )}
    </button>
  );
});
