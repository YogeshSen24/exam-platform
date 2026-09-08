import { useId, useState, type ReactNode } from 'react';
import { HelpCircle, Info } from 'lucide-react';
import { GLOSSARY, type GlossaryKey } from '@sep/shared';
import { classNames, shortHash } from '@/lib/format';
import { StatusPill } from './Status';

/**
 * Plain-language explanation of a technical term.
 *
 * Rendered as a keyboard-accessible disclosure rather than a hover-only
 * tooltip, so the explanation is reachable without a pointer.
 */
export function Explain({ term, children }: { term: GlossaryKey; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const entry = GLOSSARY[term];
  if (!entry) return <>{children}</>;

  return (
    <span className="relative inline-flex items-center gap-1">
      {children ?? entry.term}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full p-0.5 text-muted transition-colors hover:bg-panel hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
      >
        <HelpCircle aria-hidden className="h-3.5 w-3.5" />
        <span className="sr-only">What does “{entry.term}” mean?</span>
      </button>
      {open ? (
        <span
          id={id}
          role="note"
          className="absolute left-0 top-full z-30 mt-2 w-80 rounded-card border border-line bg-white p-4 text-left shadow-raised"
        >
          <span className="block text-support font-semibold text-ink">{entry.term}</span>
          <span className="mt-1 block text-support text-muted">{entry.long}</span>
          <span className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill
              size="sm"
              tone={entry.pocStatus === 'implemented' ? 'success' : entry.pocStatus === 'partial' ? 'warning' : 'neutral'}
            >
              {entry.pocStatus === 'implemented'
                ? 'Implemented in this POC'
                : entry.pocStatus === 'partial'
                  ? 'Partly implemented'
                  : 'Simulated in this POC'}
            </StatusPill>
          </span>
          {entry.pocNote ? <span className="mt-2 block text-meta text-muted">{entry.pocNote}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** Short inline definition without the disclosure control. */
export function TermHint({ term }: { term: GlossaryKey }) {
  const entry = GLOSSARY[term];
  if (!entry) return null;
  return <p className="text-meta text-muted">{entry.short}</p>;
}

/** Neutral information panel for policy explanations. */
export function InfoPanel({
  title,
  children,
  className,
  icon,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={classNames('rounded-card border border-info-border bg-info-soft px-4 py-3.5', className)}>
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-brand">{icon ?? <Info aria-hidden className="h-5 w-5" />}</span>
        <div className="min-w-0">
          <p className="text-support font-semibold text-ink">{title}</p>
          <div className="mt-1 text-support text-muted">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Monospace hash with a copy control and a plain-language caption. */
export function HashValue({
  value,
  label,
  full = false,
  caption,
}: {
  value: string | null | undefined;
  label?: string;
  full?: boolean;
  caption?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-2">
        {label ? <span className="text-meta text-muted">{label}</span> : null}
        <code className="rounded border border-line bg-panel px-2 py-1 font-mono text-meta text-navy">
          {full ? value : shortHash(value)}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="rounded px-1.5 py-0.5 text-meta text-brand transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </span>
      {caption ? <span className="text-meta text-muted">{caption}</span> : null}
    </span>
  );
}

/**
 * The disclosure banner shown wherever a simulated control is on screen.
 * It exists so no screen can be mistaken for a production-certified control.
 */
export function PocDisclosure({
  what,
  production,
  className,
}: {
  what: string;
  production: string;
  className?: string;
}) {
  return (
    <div className={classNames('rounded-card border border-warning-border bg-warning-soft px-4 py-3', className)}>
      <p className="flex items-start gap-2 text-support">
        <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span>
          <strong className="font-semibold text-ink">Simulated for this proof of concept.</strong>{' '}
          <span className="text-muted">{what}</span>{' '}
          <span className="text-muted">
            A production deployment requires {production}. This screen must not be presented as a
            production-certified control.
          </span>
        </span>
      </p>
    </div>
  );
}
