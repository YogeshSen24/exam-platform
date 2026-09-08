import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';
import { classNames } from '@/lib/format';

/**
 * Accessible form primitives.
 *
 * Every control has a real <label>, validation messages are announced via
 * aria-describedby and role="alert", and the error state is signalled by an
 * icon and text as well as colour.
 */

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
  trailing,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={classNames('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-support font-medium text-ink">
          {label}
          {required ? (
            <span className="ml-1 text-critical" aria-hidden>
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </label>
        {trailing}
      </div>
      {children}
      {hint && !error ? (
        <p id={`${htmlFor}-hint`} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1.5 text-meta text-critical">
          <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  'rounded-control border bg-white px-3 text-body text-ink placeholder:text-[#8A97A6] transition-colors ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 ' +
  'disabled:cursor-not-allowed disabled:bg-panel disabled:text-muted';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={classNames(CONTROL_BASE, /(?:^|\s)!?w-/.test(className ?? '') ? undefined : 'w-full', 'h-10', invalid ? 'border-critical' : 'border-line', className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={classNames(CONTROL_BASE, /(?:^|\s)!?w-/.test(className ?? '') ? undefined : 'w-full', 'h-10 pr-8', invalid ? 'border-critical' : 'border-line', className)}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function TextArea({ className, invalid, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={classNames(CONTROL_BASE, /(?:^|\s)!?w-/.test(className ?? '') ? undefined : 'w-full', 'py-2', invalid ? 'border-critical' : 'border-line', className)}
      {...rest}
    />
  );
});

export function Checkbox({
  label,
  description,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className="flex items-start gap-3">
      <input
        id={controlId}
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 rounded border-line text-brand focus:ring-2 focus:ring-brand/40"
        {...rest}
      />
      <label htmlFor={controlId} className="text-support text-ink">
        <span className="font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-meta font-normal text-muted">{description}</span> : null}
      </label>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={controlId} className="text-support text-ink">
        <span className="font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-meta font-normal text-muted">{description}</span> : null}
      </label>
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={classNames(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
          checked ? 'border-brand bg-brand' : 'border-line bg-panel',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={classNames(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform',
            'h-[18px] w-[18px]',
            checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
          )}
        />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

export function RadioCardGroup<T extends string>({
  name,
  value,
  onChange,
  options,
  columns = 1,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; description?: string; badge?: ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={classNames(
        'grid gap-3',
        columns === 2 ? 'sm:grid-cols-2' : columns === 3 ? 'sm:grid-cols-3' : 'grid-cols-1',
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={classNames(
              'flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors',
              selected ? 'border-brand bg-brand-50 shadow-card' : 'border-line bg-white hover:border-[#B9C4D2] hover:bg-page',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="mt-1 h-4 w-4 shrink-0 border-line text-brand focus:ring-2 focus:ring-brand/40"
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-support font-medium text-ink">
                {option.label}
                {option.badge}
              </span>
              {option.description ? (
                <span className="mt-1 block text-meta text-muted">{option.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
