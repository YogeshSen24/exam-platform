import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { classNames } from '@/lib/format';

/* ------------------------------- tabs ------------------------------ */

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={classNames('border-b border-line', className)}>
      <div role="tablist" className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={classNames(
                'relative whitespace-nowrap px-4 py-2.5 text-support font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
                selected ? 'text-brand' : 'text-muted hover:text-ink',
              )}
            >
              {tab.label}
              {typeof tab.count === 'number' ? (
                <span
                  className={classNames(
                    'ml-2 rounded-full px-1.5 py-0.5 text-meta tnum',
                    selected ? 'bg-brand-50 text-brand-700' : 'bg-panel text-muted',
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
              {selected ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-brand" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ stepper ---------------------------- */

export function Stepper({
  steps,
  current,
  onStepClick,
}: {
  steps: { id: number; label: string; short?: string }[];
  current: number;
  onStepClick?: (id: number) => void;
}) {
  return (
    <nav aria-label="Examination setup progress">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {steps.map((step, index) => {
          const state = step.id < current ? 'complete' : step.id === current ? 'current' : 'upcoming';
          const clickable = Boolean(onStepClick) && step.id <= current;
          return (
            <li key={step.id} className="flex items-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={clickable ? () => onStepClick?.(step.id) : undefined}
                aria-current={state === 'current' ? 'step' : undefined}
                className={classNames(
                  'flex items-center gap-2 rounded-control px-2.5 py-1.5 text-support transition-colors',
                  clickable && 'hover:bg-panel',
                  state === 'current' ? 'font-semibold text-ink' : 'text-muted',
                  !clickable && 'cursor-default',
                )}
              >
                <span
                  className={classNames(
                    'tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-meta font-semibold',
                    state === 'complete'
                      ? 'border-success bg-success text-white'
                      : state === 'current'
                        ? 'border-brand bg-brand text-white'
                        : 'border-line bg-white text-muted',
                  )}
                >
                  {state === 'complete' ? <CheckCircle2 aria-hidden className="h-4 w-4" /> : step.id}
                </span>
                <span className="hidden sm:inline">{step.label}</span>
                <span className="sm:hidden">{step.short ?? step.label}</span>
              </button>
              {index < steps.length - 1 ? (
                <span aria-hidden className="mx-1 hidden h-px w-6 bg-line sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------ progress --------------------------- */

export function ProgressBar({
  value,
  max = 100,
  label,
  tone = 'brand',
  showValue = true,
}: {
  value: number;
  max?: number;
  label: string;
  tone?: 'brand' | 'success' | 'warning' | 'critical';
  showValue?: boolean;
}) {
  const percent = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const tones = {
    brand: 'bg-brand',
    success: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-critical',
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-meta">
        <span className="text-muted">{label}</span>
        {showValue ? <span className="tnum font-medium text-ink">{percent}%</span> : null}
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-panel"
      >
        <div className={classNames('h-full rounded-full transition-all', tones[tone])} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------- toasts ---------------------------- */

interface Toast {
  id: string;
  tone: 'success' | 'warning' | 'critical' | 'info';
  title: string;
  description?: string;
}

interface ToastApi {
  push: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current, { ...toast, id }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  const icons = {
    success: <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />,
    warning: <AlertTriangle aria-hidden className="h-5 w-5 text-warning" />,
    critical: <AlertTriangle aria-hidden className="h-5 w-5 text-critical" />,
    info: <Info aria-hidden className="h-5 w-5 text-brand" />,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto animate-slide-up rounded-card border border-line bg-white p-4 shadow-raised"
          >
            <div className="flex gap-3">
              <span className="mt-0.5 shrink-0">{icons[toast.tone]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-support font-semibold text-ink">{toast.title}</p>
                {toast.description ? <p className="mt-0.5 text-meta text-muted">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
                aria-label="Dismiss notification"
                className="shrink-0 rounded p-1 text-muted hover:bg-panel hover:text-ink"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}

/* -------------------------- description list ----------------------- */

export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  items: { term: ReactNode; value: ReactNode; span?: boolean }[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={classNames(
        'grid gap-x-8 gap-y-4',
        columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1',
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className={item.span ? 'sm:col-span-full' : undefined}>
          <dt className="text-meta font-medium uppercase tracking-wide text-muted">{item.term}</dt>
          <dd className="mt-1 text-support text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------- avatar ------------------------------ */

export function Avatar({
  name,
  seed,
  size = 'md',
}: {
  name: string;
  seed?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'h-8 w-8 text-meta', md: 'h-10 w-10 text-support', lg: 'h-16 w-16 text-card' };
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part, index, arr) => (index === 0 || index === arr.length - 1 ? part[0] : ''))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const tones = [
    'bg-brand-100 text-brand-700',
    'bg-success-soft text-[#0F7B50]',
    'bg-warning-soft text-[#9A6410]',
    'bg-panel text-navy',
  ];
  const key = seed ?? name;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;

  return (
    <span
      aria-hidden
      className={classNames(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        sizes[size],
        tones[hash % tones.length],
      )}
      title={`${name} (generated avatar — no photograph of a real person is used)`}
    >
      {initials}
    </span>
  );
}
