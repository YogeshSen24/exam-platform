import type { ReactNode } from 'react';
import { classNames } from '@/lib/format';

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return <Tag className={classNames('surface', className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={classNames(
        'flex flex-col gap-3 border-b border-line px-6 py-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 text-muted">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-card font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-1 text-support text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={classNames('px-6 py-5', className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={classNames('flex flex-wrap items-center gap-3 border-t border-line bg-page px-6 py-4', className)}>
      {children}
    </div>
  );
}

/** Compact metric tile used on dashboards. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'critical' | 'info';
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    neutral: 'text-ink',
    success: 'text-success',
    warning: 'text-warning',
    critical: 'text-critical',
    info: 'text-brand',
  };
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={classNames(
        'surface flex flex-col gap-1 px-5 py-4 text-left',
        onClick && 'transition-colors hover:border-[#B9C4D2] hover:bg-page focus-visible:ring-2 focus-visible:ring-brand',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-medium uppercase tracking-wide text-muted">{label}</span>
        {icon ? <span className="text-muted">{icon}</span> : null}
      </div>
      <span className={classNames('tnum text-section-lg font-semibold', tones[tone])}>{value}</span>
      {hint ? <span className="text-meta text-muted">{hint}</span> : null}
    </Wrapper>
  );
}
