import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Hand, Loader2, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useCandidateStore } from '@/lib/candidateStore';
import { Button } from '@/components/ui/Button';
import { Alert, FailureState } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { FaceVerification } from '@/components/domain/FaceVerification';
import type { CandidateContextResponse } from './CandidateApp';
import { CandidateShell } from './CandidateShell';

interface AttemptResponse {
  attempt: { id: string; status: string; restrictionReason: string | null; consecutiveMonitoringFailures: number };
  summary: { answered: number; total: number };
}

/**
 * Reverification.
 *
 * Reached when repeated presence checks have failed. Navigation is paused, but
 * the examination is not ended and no answer is discarded. Where policy requires
 * it, a human — not the software — releases the session.
 */
export function ReverifyScreen({ context }: { context: CandidateContextResponse }) {
  const navigate = useNavigate();
  const attemptId = useCandidateStore((state) => state.attemptId);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const attempt = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => api.get<AttemptResponse>(`/attempts/${attemptId}`),
    enabled: Boolean(attemptId),
    refetchInterval: 5_000,
  });

  const reverify = useMutation({
    mutationFn: (result: 'PASSED' | 'FAILED') =>
      api.post<{ attempt: { status: string }; awaitingInvigilator: boolean; message: string }>(
        `/attempts/${attemptId}/reverify`,
        { result, method: 'FACE' },
      ),
    onSuccess: (data) => {
      setSubmitted(true);
      if (data.attempt.status === 'ACTIVE') {
        setTimeout(() => navigate('/exam/session'), 1400);
      }
    },
    onError: (caught) => {
      if (caught instanceof ApiError) setError(caught);
    },
  });

  const status = attempt.data?.attempt.status;
  const released = status === 'ACTIVE';
  const awaitingInvigilator = status === 'AWAITING_REVERIFICATION';

  // An invigilator releasing the session elsewhere returns the candidate here.
  if (released && submitted) {
    setTimeout(() => navigate('/exam/session'), 0);
  }

  return (
    <CandidateShell
      context={context}
      title="Your examination is paused while we confirm your identity"
      subtitle="This is not a penalty and your examination has not ended. Everything you have answered is saved on the server."
      step={3}
    >
      <div className="space-y-6">
        <FailureState
          tone="warning"
          title="Question navigation is paused"
          whatHappened={
            attempt.data?.attempt.restrictionReason ??
            `The workstation camera did not confirm your presence in ${context.monitoring.consecutiveFailureThreshold} consecutive checks.`
          }
          answersSafe
          whatToDo="Sit squarely in front of the camera and take a new photograph below. If it still does not succeed, raise your hand — an invigilator will confirm your identity in person."
          invigilatorNotified
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-white px-4 py-3.5">
            <p className="text-meta uppercase tracking-wide text-muted">Answers saved</p>
            <p className="tnum mt-1 text-section font-semibold text-success">
              {attempt.data?.summary.answered ?? 0}
              <span className="text-body font-normal text-muted"> / {attempt.data?.summary.total ?? 0}</span>
            </p>
            <p className="mt-1 text-meta text-muted">Nothing has been lost.</p>
          </div>
          <div className="rounded-card border border-line bg-white px-4 py-3.5">
            <p className="text-meta uppercase tracking-wide text-muted">Consecutive failed checks</p>
            <p className="tnum mt-1 text-section font-semibold text-warning">
              {attempt.data?.attempt.consecutiveMonitoringFailures ?? 0}
            </p>
            <p className="mt-1 text-meta text-muted">
              Threshold is {context.monitoring.consecutiveFailureThreshold}.
            </p>
          </div>
          <div className="rounded-card border border-line bg-white px-4 py-3.5">
            <p className="text-meta uppercase tracking-wide text-muted">Session status</p>
            <p className="mt-2">
              <StatusPill tone={released ? 'success' : awaitingInvigilator ? 'info' : 'critical'} size="sm">
                {released ? 'Released' : awaitingInvigilator ? 'Awaiting invigilator' : 'Restricted'}
              </StatusPill>
            </p>
          </div>
        </div>

        {error ? (
          <Alert tone="critical" live title={error.message}>
            {error.guidance}
          </Alert>
        ) : null}

        {released ? (
          <Alert tone="success" live title="Your identity has been confirmed">
            An invigilator released your session. You are being returned to your examination with exactly the same
            questions, in the same order, and your answers as you left them.
          </Alert>
        ) : awaitingInvigilator ? (
          <Alert
            tone="info"
            live
            title="An invigilator is reviewing your session"
            icon={<Loader2 aria-hidden className="h-5 w-5 animate-spin text-brand" />}
          >
            Your check has been recorded. Please stay at your workstation — an invigilator will attend shortly and
            release your session. Your remaining time continues to be tracked by the server, and staff can add time if
            the delay was not your fault.
          </Alert>
        ) : submitted ? (
          <Alert tone="info" live title="Your verification has been sent">
            Waiting for confirmation.
          </Alert>
        ) : (
          <section className="rounded-card border border-line bg-white">
            <header className="border-b border-line px-5 py-4">
              <h2 className="text-card font-semibold text-ink">Confirm you are still at the workstation</h2>
              <p className="mt-0.5 text-support text-muted">
                Take a clear photograph looking directly at the camera.
              </p>
            </header>
            <div className="px-5 py-5">
              <FaceVerification
                onResult={(outcome) => {
                  if (outcome === 'PASSED' || outcome === 'OVERRIDDEN') reverify.mutate('PASSED');
                  else reverify.mutate('FAILED');
                }}
              />
            </div>
          </section>
        )}

        <section className="rounded-card border border-line bg-page px-5 py-4">
          <h2 className="flex items-center gap-2 text-support font-semibold text-ink">
            <Hand aria-hidden className="h-4 w-4 text-muted" />
            If you need a person
          </h2>
          <p className="mt-1.5 max-w-prose text-support text-muted">
            Raise your hand and stay at your workstation. An invigilator will confirm your identity in person and
            release your session. Software never ends an examination on its own — a person always decides.
          </p>
        </section>

        {released ? (
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="lg"
              icon={<CheckCircle2 aria-hidden className="h-4 w-4" />}
              onClick={() => navigate('/exam/session')}
            >
              Return to my examination
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-meta text-muted">
            <ShieldAlert aria-hidden className="h-4 w-4" />
            This screen refreshes automatically. You do not need to do anything else.
          </div>
        )}
      </div>
    </CandidateShell>
  );
}
