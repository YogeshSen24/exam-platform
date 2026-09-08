import { CheckCircle2 } from 'lucide-react';
import type { SecurityControl } from '@sep/shared';
import { StatusPill } from '@/components/ui/Status';

/**
 * Renders the effective controls for a security profile, each one labelled with
 * whether the POC implements it for real or demonstrates it.
 */
export function SecurityControlList({
  controls,
  compact = false,
}: {
  controls: SecurityControl[];
  compact?: boolean;
}) {
  return (
    <ul className="space-y-3">
      {controls.map((control) => (
        <li key={control.key} className="flex gap-3">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-support font-medium text-ink">
              {control.label}
              <StatusPill
                size="sm"
                tone={
                  control.simulation === 'implemented'
                    ? 'success'
                    : control.simulation === 'partial'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {control.simulation === 'implemented'
                  ? 'Implemented'
                  : control.simulation === 'partial'
                    ? 'Partly implemented'
                    : 'Simulated'}
              </StatusPill>
            </p>
            {!compact ? <p className="mt-0.5 text-support text-muted">{control.explanation}</p> : null}
            {control.simulationNote ? (
              <p className="mt-1 text-meta text-muted">{control.simulationNote}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
