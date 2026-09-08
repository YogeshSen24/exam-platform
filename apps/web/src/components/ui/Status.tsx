import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  Flag,
  Info,
  Loader2,
  MinusCircle,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { classNames } from '@/lib/format';

export type Tone = 'neutral' | 'success' | 'warning' | 'critical' | 'info' | 'brand';

const TONE_STYLES: Record<Tone, string> = {
  neutral: 'bg-panel text-muted border-line',
  success: 'bg-success-soft text-[#0F7B50] border-success-border',
  warning: 'bg-warning-soft text-[#9A6410] border-warning-border',
  critical: 'bg-critical-soft text-[#A83232] border-critical-border',
  info: 'bg-info-soft text-brand-700 border-info-border',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
};

/**
 * Status is never communicated by colour alone: every pill carries an icon and
 * a text label, so it remains readable for colour-blind users and in print.
 */
export function StatusPill({
  tone = 'neutral',
  icon,
  children,
  className,
  size = 'md',
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-meta' : 'px-2.5 py-1 text-support',
        TONE_STYLES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const CHECK_ICONS = {
  PASS: <CheckCircle2 aria-hidden className="h-4 w-4" />,
  PASSED: <CheckCircle2 aria-hidden className="h-4 w-4" />,
  WARNING: <AlertTriangle aria-hidden className="h-4 w-4" />,
  FAIL: <XCircle aria-hidden className="h-4 w-4" />,
  FAILED: <XCircle aria-hidden className="h-4 w-4" />,
  SKIPPED: <MinusCircle aria-hidden className="h-4 w-4" />,
  WAITING: <CircleDashed aria-hidden className="h-4 w-4" />,
  CHECKING: <Loader2 aria-hidden className="h-4 w-4 animate-spin" />,
} as const;

export type CheckState = keyof typeof CHECK_ICONS;

export function CheckBadge({ state, label }: { state: CheckState; label?: string }) {
  const tone: Tone =
    state === 'PASS' || state === 'PASSED'
      ? 'success'
      : state === 'WARNING'
        ? 'warning'
        : state === 'FAIL' || state === 'FAILED'
          ? 'critical'
          : state === 'CHECKING'
            ? 'info'
            : 'neutral';
  const text =
    label ??
    {
      PASS: 'Passed',
      PASSED: 'Passed',
      WARNING: 'Warning',
      FAIL: 'Failed',
      FAILED: 'Failed',
      SKIPPED: 'Not required',
      WAITING: 'Waiting',
      CHECKING: 'Checking',
    }[state];
  return (
    <StatusPill tone={tone} icon={CHECK_ICONS[state]}>
      {text}
    </StatusPill>
  );
}

/** Attempt status → pill. Shared by the invigilator table and detail views. */
export function AttemptStatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; icon: ReactNode; label: string }> = {
    NOT_STARTED: { tone: 'neutral', icon: <CircleDashed aria-hidden className="h-4 w-4" />, label: 'Not started' },
    VERIFYING: { tone: 'info', icon: <Loader2 aria-hidden className="h-4 w-4" />, label: 'Verifying' },
    ACTIVE: { tone: 'success', icon: <CircleDot aria-hidden className="h-4 w-4" />, label: 'Active' },
    RESTRICTED: { tone: 'critical', icon: <ShieldAlert aria-hidden className="h-4 w-4" />, label: 'Restricted' },
    AWAITING_REVERIFICATION: {
      tone: 'warning',
      icon: <AlertTriangle aria-hidden className="h-4 w-4" />,
      label: 'Requires review',
    },
    DISCONNECTED: { tone: 'warning', icon: <Clock aria-hidden className="h-4 w-4" />, label: 'Disconnected' },
    SUBMITTED: { tone: 'brand', icon: <CheckCircle2 aria-hidden className="h-4 w-4" />, label: 'Submitted' },
    TERMINATED: { tone: 'critical', icon: <XCircle aria-hidden className="h-4 w-4" />, label: 'Terminated' },
  };
  const entry = map[status] ?? { tone: 'neutral' as Tone, icon: <Info aria-hidden className="h-4 w-4" />, label: status };
  return (
    <StatusPill tone={entry.tone} icon={entry.icon} size="sm">
      {entry.label}
    </StatusPill>
  );
}

export function SeverityPill({ severity }: { severity: string }) {
  const map: Record<string, { tone: Tone; icon: ReactNode; label: string }> = {
    CRITICAL: { tone: 'critical', icon: <ShieldAlert aria-hidden className="h-4 w-4" />, label: 'Critical' },
    WARNING: { tone: 'warning', icon: <AlertTriangle aria-hidden className="h-4 w-4" />, label: 'Warning' },
    INFO: { tone: 'info', icon: <Info aria-hidden className="h-4 w-4" />, label: 'Information' },
    NONE: { tone: 'neutral', icon: <MinusCircle aria-hidden className="h-4 w-4" />, label: 'No alert' },
  };
  const entry = map[severity] ?? map.NONE!;
  return (
    <StatusPill tone={entry.tone} icon={entry.icon} size="sm">
      {entry.label}
    </StatusPill>
  );
}

export function QuestionStatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    DRAFT: { tone: 'neutral', label: 'Draft' },
    IN_REVIEW: { tone: 'info', label: 'In review' },
    CHANGES_REQUESTED: { tone: 'warning', label: 'Changes requested' },
    APPROVED: { tone: 'success', label: 'Approved' },
    PUBLISHED: { tone: 'brand', label: 'Published' },
    RETIRED: { tone: 'neutral', label: 'Retired' },
  };
  const entry = map[status] ?? { tone: 'neutral' as Tone, label: status };
  return (
    <StatusPill tone={entry.tone} size="sm" icon={<Flag aria-hidden className="h-3.5 w-3.5" />}>
      {entry.label}
    </StatusPill>
  );
}

export function ExamStatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    DRAFT: { tone: 'neutral', label: 'Draft' },
    PENDING_APPROVAL: { tone: 'warning', label: 'Awaiting approval' },
    PUBLISHED: { tone: 'success', label: 'Published' },
    IN_PROGRESS: { tone: 'brand', label: 'In progress' },
    COMPLETED: { tone: 'neutral', label: 'Completed' },
    ARCHIVED: { tone: 'neutral', label: 'Archived' },
  };
  const entry = map[status] ?? { tone: 'neutral' as Tone, label: status };
  return (
    <StatusPill tone={entry.tone} size="sm">
      {entry.label}
    </StatusPill>
  );
}

/** Marks anything the POC simulates rather than implements for real. */
export function SimulatedTag({ label = 'Simulated in this POC' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line bg-panel px-1.5 py-0.5 text-meta font-medium text-muted">
      <Info aria-hidden className="h-3 w-3" />
      {label}
    </span>
  );
}
