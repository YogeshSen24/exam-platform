import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, WifiOff } from 'lucide-react';
import { classNames } from '@/lib/format';
import type { Tone } from './Status';

/* ------------------------------- alerts ---------------------------- */

const ALERT_TONES: Record<Tone, { wrapper: string; icon: ReactNode }> = {
  neutral: { wrapper: 'border-line bg-panel text-ink', icon: <Info aria-hidden className="h-5 w-5 text-muted" /> },
  info: { wrapper: 'border-info-border bg-info-soft text-ink', icon: <Info aria-hidden className="h-5 w-5 text-brand" /> },
  brand: { wrapper: 'border-brand-200 bg-brand-50 text-ink', icon: <Info aria-hidden className="h-5 w-5 text-brand" /> },
  success: {
    wrapper: 'border-success-border bg-success-soft text-ink',
    icon: <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />,
  },
  warning: {
    wrapper: 'border-warning-border bg-warning-soft text-ink',
    icon: <AlertTriangle aria-hidden className="h-5 w-5 text-warning" />,
  },
  critical: {
    wrapper: 'border-critical-border bg-critical-soft text-ink',
    icon: <ShieldAlert aria-hidden className="h-5 w-5 text-critical" />,
  },
};

export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  className,
  icon,
  live,
}: {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  icon?: ReactNode;
  live?: boolean;
}) {
  const config = ALERT_TONES[tone];
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      aria-live={live ? (tone === 'critical' ? 'assertive' : 'polite') : undefined}
      className={classNames('flex gap-3 rounded-card border px-4 py-3.5', config.wrapper, className)}
    >
      <span className="mt-0.5 shrink-0">{icon ?? config.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-support font-semibold">{title}</p>
        {children ? <div className="mt-1 text-support text-muted [&_strong]:text-ink">{children}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/**
 * The standard failure panel.
 *
 * Every failure state in this product answers the same four questions, so the
 * component makes them mandatory rather than optional.
 */
export function FailureState({
  title,
  whatHappened,
  answersSafe,
  whatToDo,
  invigilatorNotified,
  tone = 'critical',
  actions,
  reference,
}: {
  title: string;
  whatHappened: string;
  answersSafe: boolean | null;
  whatToDo: string;
  invigilatorNotified: boolean | null;
  tone?: Tone;
  actions?: ReactNode;
  reference?: string;
}) {
  return (
    <div
      role="alert"
      className={classNames('rounded-card border px-5 py-4', ALERT_TONES[tone].wrapper)}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0">{ALERT_TONES[tone].icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-card font-semibold text-ink">{title}</h3>
          <dl className="mt-3 space-y-2.5 text-support">
            <div>
              <dt className="font-medium text-ink">What happened</dt>
              <dd className="text-muted">{whatHappened}</dd>
            </div>
            {answersSafe !== null ? (
              <div>
                <dt className="font-medium text-ink">Are your answers safe?</dt>
                <dd className={answersSafe ? 'text-[#0F7B50]' : 'text-critical'}>
                  {answersSafe
                    ? 'Yes. Every answer the server has acknowledged is stored and will not be lost.'
                    : 'Some recent answers may not have reached the server. Follow the steps below before continuing.'}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium text-ink">What to do next</dt>
              <dd className="text-muted">{whatToDo}</dd>
            </div>
            {invigilatorNotified !== null ? (
              <div>
                <dt className="font-medium text-ink">Has an invigilator been notified?</dt>
                <dd className="text-muted">
                  {invigilatorNotified
                    ? 'Yes. An invigilator has been alerted and will attend.'
                    : 'No. Raise your hand if you need an invigilator.'}
                </dd>
              </div>
            ) : null}
          </dl>
          {reference ? (
            <p className="mt-3 font-mono text-meta text-muted">Reference {reference}</p>
          ) : null}
          {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- empty ----------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon ? (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-panel text-muted">{icon}</span>
      ) : null}
      <p className="text-card font-semibold text-ink">{title}</p>
      {description ? <p className="mt-1.5 max-w-prose text-support text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ----------------------------- skeletons --------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={classNames('skeleton rounded', className)} aria-hidden />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={classNames('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="p-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {Array.from({ length: columns }).map((__, colIndex) => (
              <Skeleton key={colIndex} className="h-4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="surface px-5 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- connection --------------------------- */

export function OfflineBanner({ reconnecting }: { reconnecting: boolean }) {
  return (
    <Alert
      tone="warning"
      live
      icon={<WifiOff aria-hidden className="h-5 w-5 text-warning" />}
      title={reconnecting ? 'Reconnecting to the examination service' : 'Connection to the examination service lost'}
    >
      Your answers are stored on this workstation and will be sent automatically as soon as the connection returns.
      Keep working — nothing you have entered will be lost.
    </Alert>
  );
}
