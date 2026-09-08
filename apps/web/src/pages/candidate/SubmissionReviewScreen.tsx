import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, Flag, Lock, Timer } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useCandidateStore } from '@/lib/candidateStore';
import { formatDuration } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Alert, FailureState } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { ProgressBar } from '@/components/ui/Misc';
import type { CandidateContextResponse } from './CandidateApp';
import { CandidateShell } from './CandidateShell';

interface ReviewResponse {
  summary: { total: number; answered: number; unanswered: number; flagged: number; remainingSeconds: number };
  navigator: {
    sequence: number;
    assignmentQuestionId: string;
    state: 'NOT_VISITED' | 'VISITED' | 'ANSWERED' | 'ANSWERED_FLAGGED' | 'FLAGGED';
    subject: string;
  }[];
  remainingSeconds: number;
}

/**
 * Final review before submission.
 *
 * The candidate sees exactly what they are about to submit, and confirms once.
 * After submission the attempt is locked — this screen says so before, not after.
 */
export function SubmissionReviewScreen({ context }: { context: CandidateContextResponse }) {
  const navigate = useNavigate();
  const attemptId = useCandidateStore((state) => state.attemptId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const review = useQuery({
    queryKey: ['review', attemptId],
    queryFn: () => api.get<ReviewResponse>(`/attempts/${attemptId}/review`),
    enabled: Boolean(attemptId),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () => api.post<{ receipt: { receiptId: string } }>(`/attempts/${attemptId}/submit`, { confirmed: true }),
    onSuccess: () => navigate('/exam/receipt'),
    onError: (caught) => {
      if (caught instanceof ApiError) {
        if (caught.code === 'ATTEMPT_FINALISED') {
          navigate('/exam/receipt');
          return;
        }
        setError(caught);
      }
    },
  });

  const summary = review.data?.summary;
  const unanswered = summary?.unanswered ?? 0;
  const flagged = summary?.flagged ?? 0;

  const flaggedList = (review.data?.navigator ?? []).filter(
    (entry) => entry.state === 'FLAGGED' || entry.state === 'ANSWERED_FLAGGED',
  );
  const unansweredList = (review.data?.navigator ?? []).filter(
    (entry) => entry.state === 'NOT_VISITED' || entry.state === 'VISITED' || entry.state === 'FLAGGED',
  );

  if (review.error instanceof ApiError && review.error.code === 'ATTEMPT_FINALISED') {
    return (
      <CandidateShell context={context} title="This examination has already been submitted" step={4}>
        <Alert tone="info" title="Your attempt is locked">
          Your answers were submitted and cannot be changed. Your submission receipt is available below.
        </Alert>
        <Button className="mt-4" variant="primary" onClick={() => navigate('/exam/receipt')}>
          View my submission receipt
        </Button>
      </CandidateShell>
    );
  }

  return (
    <CandidateShell
      context={context}
      title="Review and submit"
      subtitle="Check what you are about to submit. You can return to the examination if you still have time."
      step={4}
    >
      <div className="space-y-6">
        {error ? (
          <FailureState
            title="Your examination could not be submitted"
            whatHappened={error.message}
            answersSafe={error.answersSafe}
            whatToDo={error.guidance || 'Try again. If it still fails, raise your hand for the invigilator.'}
            invigilatorNotified={false}
            reference={error.traceId}
            actions={
              <Button size="sm" variant="secondary" onClick={() => submit.mutate()}>
                Try again
              </Button>
            }
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile
            label="Answered"
            value={summary?.answered ?? 0}
            total={summary?.total}
            tone="success"
            icon={<CheckCircle2 aria-hidden className="h-4 w-4" />}
          />
          <SummaryTile
            label="Not answered"
            value={unanswered}
            total={summary?.total}
            tone={unanswered > 0 ? 'warning' : 'neutral'}
            icon={<AlertTriangle aria-hidden className="h-4 w-4" />}
          />
          <SummaryTile
            label="Flagged for review"
            value={flagged}
            total={summary?.total}
            tone={flagged > 0 ? 'warning' : 'neutral'}
            icon={<Flag aria-hidden className="h-4 w-4" />}
          />
          <div className="surface px-5 py-4">
            <p className="flex items-center gap-2 text-meta uppercase tracking-wide text-muted">
              <Timer aria-hidden className="h-4 w-4" />
              Time remaining
            </p>
            <p className="tnum mt-1.5 text-section-lg font-semibold text-ink">
              {formatDuration(summary?.remainingSeconds ?? 0)}
            </p>
          </div>
        </div>

        {summary ? (
          <div className="surface px-5 py-5">
            <ProgressBar
              label={`${summary.answered} of ${summary.total} questions answered`}
              value={summary.answered}
              max={summary.total || 1}
              tone={summary.answered === summary.total ? 'success' : 'brand'}
            />
          </div>
        ) : null}

        {unanswered > 0 ? (
          <Alert tone="warning" title={`${unanswered} question${unanswered === 1 ? '' : 's'} not answered`}>
            You can still return to them if you have time. Unanswered questions score zero but are not penalised.
            <div className="mt-3 flex flex-wrap gap-1.5">
              {unansweredList.slice(0, 24).map((entry) => (
                <button
                  key={entry.sequence}
                  type="button"
                  onClick={() => navigate('/exam/session')}
                  className="tnum rounded-control border border-warning-border bg-white px-2 py-1 text-meta font-semibold text-[#9A6410] hover:bg-warning-soft focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {entry.sequence}
                </button>
              ))}
              {unansweredList.length > 24 ? (
                <span className="px-2 py-1 text-meta text-muted">+{unansweredList.length - 24} more</span>
              ) : null}
            </div>
          </Alert>
        ) : (
          <Alert tone="success" title="Every question has an answer">
            You have answered all {summary?.total} questions.
          </Alert>
        )}

        {flaggedList.length > 0 ? (
          <div className="surface px-5 py-5">
            <h2 className="flex items-center gap-2 text-card font-semibold text-ink">
              <Flag aria-hidden className="h-5 w-5 text-warning" />
              Questions you flagged for review
            </h2>
            <p className="mt-1 text-support text-muted">
              Flags are for your own use — they are not sent to the examiner and do not affect marking.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {flaggedList.map((entry) => (
                <button
                  key={entry.sequence}
                  type="button"
                  onClick={() => navigate('/exam/session')}
                  className="tnum rounded-control border border-warning-border bg-warning-soft px-2.5 py-1.5 text-support font-semibold text-[#9A6410] hover:bg-white focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {entry.sequence}
                  {entry.state === 'ANSWERED_FLAGGED' ? <span className="ml-1 text-meta">✓</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="surface px-5 py-5">
          <h2 className="flex items-center gap-2 text-card font-semibold text-ink">
            <Lock aria-hidden className="h-5 w-5 text-brand" />
            What happens when you submit
          </h2>
          <ul className="mt-3 space-y-2 text-support text-muted">
            <li>Your attempt is locked immediately and no further changes are possible.</li>
            <li>
              The server calculates a single fingerprint over your final answers, so a later dispute can confirm exactly
              what was submitted.
            </li>
            <li>You receive a submission receipt with a receipt ID and the server’s own submission time.</li>
            <li>Camera monitoring stops.</li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white px-5 py-4">
          <Button
            variant="secondary"
            icon={<ArrowLeft aria-hidden className="h-4 w-4" />}
            onClick={() => navigate('/exam/session')}
          >
            Return to the examination
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={unanswered > 0 ? 'warning' : 'success'} size="sm">
              {summary?.answered ?? 0} of {summary?.total ?? 0} answered
            </StatusPill>
            <Button variant="primary" size="lg" onClick={() => setConfirmOpen(true)}>
              Submit my examination
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => submit.mutate()}
        title="Submit your examination?"
        description="Once submitted, your answers are locked and cannot be changed."
        confirmLabel="Yes, submit now"
        tone="critical"
        loading={submit.isPending}
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-meta uppercase tracking-wide text-muted">Answered</dt>
              <dd className="tnum text-section font-semibold text-success">{summary?.answered ?? 0}</dd>
            </div>
            <div>
              <dt className="text-meta uppercase tracking-wide text-muted">Not answered</dt>
              <dd className={`tnum text-section font-semibold ${unanswered > 0 ? 'text-warning' : 'text-ink'}`}>
                {unanswered}
              </dd>
            </div>
            <div>
              <dt className="text-meta uppercase tracking-wide text-muted">Flagged</dt>
              <dd className="tnum text-section font-semibold text-ink">{flagged}</dd>
            </div>
            <div>
              <dt className="text-meta uppercase tracking-wide text-muted">Time remaining</dt>
              <dd className="tnum text-section font-semibold text-ink">
                {formatDuration(summary?.remainingSeconds ?? 0)}
              </dd>
            </div>
          </dl>
          {unanswered > 0 ? (
            <Alert tone="warning" title={`${unanswered} question${unanswered === 1 ? '' : 's'} will be submitted unanswered`}>
              You still have {formatDuration(summary?.remainingSeconds ?? 0)} available if you would rather return to
              them.
            </Alert>
          ) : null}
        </div>
      </ConfirmDialog>
    </CandidateShell>
  );
}

function SummaryTile({
  label,
  value,
  total,
  tone,
  icon,
}: {
  label: string;
  value: number;
  total?: number;
  tone: 'success' | 'warning' | 'neutral';
  icon: React.ReactNode;
}) {
  const tones = { success: 'text-success', warning: 'text-warning', neutral: 'text-ink' };
  return (
    <div className="surface px-5 py-4">
      <p className="flex items-center gap-2 text-meta uppercase tracking-wide text-muted">
        {icon}
        {label}
      </p>
      <p className={`tnum mt-1.5 text-section-lg font-semibold ${tones[tone]}`}>
        {value}
        {total ? <span className="text-body font-normal text-muted"> / {total}</span> : null}
      </p>
    </div>
  );
}
