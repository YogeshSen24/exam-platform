import type { ReactNode } from 'react';
import { RefreshCw, ServerCrash, WifiOff } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from './Button';
import { EmptyState, FailureState } from './Feedback';

/**
 * One place that turns a failed query into an honest, actionable panel.
 * Permission failures, offline failures and server failures each read
 * differently because the user needs to do something different about each.
 */
export function QueryError({
  error,
  onRetry,
  context,
}: {
  error: unknown;
  onRetry?: () => void;
  context?: string;
}) {
  const retry = onRetry ? (
    <Button size="sm" variant="secondary" icon={<RefreshCw aria-hidden className="h-4 w-4" />} onClick={onRetry}>
      Try again
    </Button>
  ) : null;

  if (error instanceof ApiError) {
    if (error.isOffline) {
      return (
        <FailureState
          tone="warning"
          title="The examination service could not be reached"
          whatHappened="This workstation lost its connection to the examination service."
          answersSafe
          whatToDo="Wait a few seconds — the application retries automatically. If the problem continues, notify technical support at the centre."
          invigilatorNotified={false}
          actions={retry}
        />
      );
    }
    if (error.isForbidden) {
      return (
        <FailureState
          tone="warning"
          title="You do not have permission to view this"
          whatHappened={error.message}
          answersSafe={null}
          whatToDo={error.guidance || 'Ask an administrator if you believe you should have access to this area.'}
          invigilatorNotified={null}
        />
      );
    }
    return (
      <FailureState
        tone={error.status >= 500 ? 'critical' : 'warning'}
        title={context ? `${context} could not be loaded` : 'This information could not be loaded'}
        whatHappened={error.message}
        answersSafe={error.answersSafe}
        whatToDo={error.guidance || 'Try again shortly.'}
        invigilatorNotified={null}
        reference={error.traceId}
        actions={retry}
      />
    );
  }

  return (
    <FailureState
      tone="critical"
      title="Something went wrong"
      whatHappened="The application encountered an unexpected problem while loading this page."
      answersSafe
      whatToDo="Try again. If the problem continues, notify technical support."
      invigilatorNotified={null}
      actions={retry}
    />
  );
}

export function OfflinePlaceholder({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<WifiOff aria-hidden className="h-6 w-6" />}
      title="Waiting for the connection to return"
      description="This view refreshes automatically as soon as the examination service is reachable again."
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry now
          </Button>
        ) : null
      }
    />
  );
}

export function ServerDegraded({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-warning-border bg-warning-soft px-4 py-3">
      <ServerCrash aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div>
        <p className="text-support font-semibold text-ink">System degraded — examinations continue</p>
        <p className="mt-0.5 text-support text-muted">{reason}</p>
      </div>
    </div>
  );
}

export function Loadable({
  isLoading,
  error,
  onRetry,
  skeleton,
  context,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  skeleton: ReactNode;
  context?: string;
  children: ReactNode;
}) {
  if (isLoading) return <>{skeleton}</>;
  if (error) return <QueryError error={error} onRetry={onRetry} context={context} />;
  return <>{children}</>;
}
