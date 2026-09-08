import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileLock2, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useCandidateStore } from '@/lib/candidateStore';
import { formatDuration } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import type { CandidateContextResponse } from './CandidateApp';
import { CandidateShell } from './CandidateShell';

interface AttemptResponse {
  attempt: { id: string; status: string; remainingSeconds: number; expiresAt: string | null };
  summary: { total: number; answered: number; unanswered: number; flagged: number; remainingSeconds: number };
}

const PREPARATION_STEPS = [
  'Verifying the signature on the approved question paper',
  'Confirming every question still matches its approved fingerprint',
  'Releasing the decryption key for the examination window',
  'Generating your personal question and option order',
  'Storing your paper so it can be replayed exactly if you reconnect',
];

/**
 * Waiting room.
 *
 * Shown between attempt activation and the first question. It narrates what the
 * platform is doing, which is the moment in a demonstration where the integrity
 * story becomes concrete.
 */
export function WaitingRoomScreen({ context }: { context: CandidateContextResponse }) {
  const navigate = useNavigate();
  const attemptId = useCandidateStore((state) => state.attemptId);
  const [revealed, setRevealed] = useState(0);

  const attempt = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => api.get<AttemptResponse>(`/attempts/${attemptId}`),
    enabled: Boolean(attemptId),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (revealed >= PREPARATION_STEPS.length) return;
    const timer = setTimeout(() => setRevealed((count) => count + 1), 520);
    return () => clearTimeout(timer);
  }, [revealed]);

  const ready = revealed >= PREPARATION_STEPS.length && attempt.data?.attempt.status === 'ACTIVE';
  const examStarted = new Date(context.exam.startsAt).getTime() <= Date.now();

  if (!attemptId) {
    return (
      <CandidateShell context={context} title="Your examination has not been prepared yet" step={2}>
        <Alert tone="warning" title="No attempt is active for this workstation">
          Return to the instructions and confirm the statements to prepare your examination.
        </Alert>
        <Button className="mt-4" variant="primary" onClick={() => navigate('/exam/instructions')}>
          Return to the instructions
        </Button>
      </CandidateShell>
    );
  }

  return (
    <CandidateShell
      context={context}
      title="Preparing your examination"
      subtitle="Your paper is being verified and prepared for you. This takes a few seconds."
      step={2}
    >
      <div className="space-y-6">
        <section className="rounded-card border border-line bg-white px-5 py-5">
          <h2 className="flex items-center gap-2 text-card font-semibold text-ink">
            <FileLock2 aria-hidden className="h-5 w-5 text-brand" />
            What is happening now
          </h2>
          <ol className="mt-4 space-y-3">
            {PREPARATION_STEPS.map((step, index) => {
              const done = index < revealed;
              const active = index === revealed;
              return (
                <li key={step} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    {done ? (
                      <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />
                    ) : active ? (
                      <Loader2 aria-hidden className="h-5 w-5 animate-spin text-brand" />
                    ) : (
                      <span aria-hidden className="block h-5 w-5 rounded-full border-2 border-line" />
                    )}
                  </span>
                  <span className={`text-support ${done ? 'text-ink' : active ? 'text-ink' : 'text-muted'}`}>{step}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {!examStarted ? (
          <Alert tone="info" title="Your examination has not started yet">
            The paper is prepared and waiting. It unlocks at the scheduled start time — the decryption key is only
            released inside the authorised examination window.
          </Alert>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-white px-4 py-3.5">
            <p className="flex items-center gap-2 text-meta uppercase tracking-wide text-muted">
              <Clock aria-hidden className="h-4 w-4" />
              Time available
            </p>
            <p className="tnum mt-1.5 text-section font-semibold text-ink">
              {formatDuration(attempt.data?.summary.remainingSeconds ?? context.exam.durationMinutes * 60)}
            </p>
          </div>
          <div className="rounded-card border border-line bg-white px-4 py-3.5">
            <p className="text-meta uppercase tracking-wide text-muted">Questions in your paper</p>
            <p className="tnum mt-1.5 text-section font-semibold text-ink">
              {attempt.data?.summary.total ?? context.exam.totalQuestions}
            </p>
          </div>
          <div className="rounded-card border border-line bg-white px-4 py-3.5">
            <p className="text-meta uppercase tracking-wide text-muted">Security profile</p>
            <p className="mt-1.5">
              <StatusPill tone="brand" size="sm">
                {context.securityProfile.name}
              </StatusPill>
            </p>
          </div>
        </section>

        {context.monitoring.cameraMonitoringEnabled ? (
          <Alert tone="info" title="Camera monitoring will start when your examination begins">
            A low-resolution photograph is taken every {context.monitoring.snapshotIntervalSeconds} seconds to confirm
            you are present and alone. You will see a small indicator while it is running.
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <ShieldCheck aria-hidden className={`h-6 w-6 ${ready ? 'text-success' : 'text-muted'}`} />
            <div>
              <p className="text-support font-medium text-ink" role="status" aria-live="polite">
                {ready ? 'Your examination is ready' : 'Preparing…'}
              </p>
              <p className="text-meta text-muted">
                Your question order was generated once and stored. If this workstation restarts you will see exactly the
                same paper.
              </p>
            </div>
          </div>
          <Button variant="primary" size="lg" disabled={!ready} onClick={() => navigate('/exam/session')}>
            Start the examination
          </Button>
        </div>
      </div>
    </CandidateShell>
  );
}
