import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, CircleDashed, Loader2, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useCandidateStore, type VerificationOutcome } from '@/lib/candidateStore';
import { Button } from '@/components/ui/Button';
import { Alert, FailureState } from '@/components/ui/Feedback';
import { CheckBadge, StatusPill } from '@/components/ui/Status';
import { Avatar } from '@/components/ui/Misc';
import { FingerprintScanner } from '@/components/domain/FingerprintScanner';
import { FaceVerification } from '@/components/domain/FaceVerification';
import type { CandidateContextResponse } from './CandidateApp';
import { CandidateShell } from './CandidateShell';

interface PreflightCheck {
  key: string;
  label: string;
  status: 'PASSED' | 'WARNING' | 'FAILED' | 'SKIPPED';
  detail: string;
  simulated: boolean;
}

type StepState = 'WAITING' | 'CHECKING' | 'PASSED' | 'WARNING' | 'FAILED' | 'SKIPPED';

/**
 * The verification sequence.
 *
 * Each check moves visibly through waiting → checking → passed / warning /
 * failed, so the candidate — and anyone watching a demonstration — can see
 * exactly what is being confirmed and in what order.
 */
export function VerificationScreen({ context }: { context: CandidateContextResponse }) {
  const navigate = useNavigate();
  const { workstationCode, fingerprintResult, faceResult, setFingerprintResult, setFaceResult } = useCandidateStore();

  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [progressIndex, setProgressIndex] = useState(-1);
  const [error, setError] = useState<ApiError | null>(null);

  const fingerprintRequired = context.flags.fingerprintVerification !== 'off';
  const faceRequired = context.flags.requireFaceVerificationAtLogin;

  const preflight = useMutation({
    mutationFn: (verification: { fingerprint: VerificationOutcome; face: VerificationOutcome }) =>
      api.post<{ checks: PreflightCheck[] }>('/attempts/preflight', {
        deviceCode: workstationCode,
        verification,
      }),
  });

  // Automatic checks run on arrival; biometrics are candidate-initiated below.
  useEffect(() => {
    void runAutomaticChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAutomaticChecks() {
    setRunning(true);
    setError(null);
    setProgressIndex(0);
    try {
      const result = await preflight.mutateAsync({ fingerprint: fingerprintResult, face: faceResult });
      // Reveal each result in sequence so the progression is visible.
      for (let index = 0; index < result.checks.length; index += 1) {
        setProgressIndex(index);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 260));
      }
      setChecks(result.checks);
      setProgressIndex(result.checks.length);
    } catch (caught) {
      if (caught instanceof ApiError) setError(caught);
    } finally {
      setRunning(false);
    }
  }

  const automaticChecks = useMemo(() => {
    const order = ['account', 'eligibility', 'device', 'network'];
    return order.map((key, index) => {
      const found = checks.find((check) => check.key === key);
      const state: StepState = found
        ? (found.status as StepState)
        : running && progressIndex >= index
          ? 'CHECKING'
          : 'WAITING';
      return {
        key,
        label:
          key === 'account'
            ? 'Account verified'
            : key === 'eligibility'
              ? 'Examination eligibility verified'
              : key === 'device'
                ? 'Workstation certificate verified'
                : 'Approved network verified',
        state,
        detail: found?.detail ?? 'Waiting for the examination service…',
        simulated: found?.simulated ?? false,
      };
    });
  }, [checks, running, progressIndex]);

  const blockingFailure = checks.find(
    (check) => check.status === 'FAILED' && ['account', 'eligibility', 'device', 'network', 'paper'].includes(check.key),
  );
  const adminAlertedFailure = blockingFailure ? ['device', 'network', 'paper'].includes(blockingFailure.key) : false;

  const fingerprintDone = !fingerprintRequired || fingerprintResult !== 'SKIPPED';
  const faceDone = !faceRequired || (faceResult !== 'SKIPPED' && faceResult !== 'FAILED');
  const automaticPassed = automaticChecks.every((step) => step.state === 'PASSED' || step.state === 'SKIPPED');
  const readyToContinue = automaticPassed && fingerprintDone && faceDone && !blockingFailure;

  return (
    <CandidateShell
      context={context}
      title="Verifying your identity and this workstation"
      subtitle="The examination service runs the checks required by this station key before releasing the paper."
      step={1}
    >
      <div className="space-y-6">
        {/* Who is signing in */}
        <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-white px-5 py-4">
          <Avatar name={context.candidate.fullName} seed={context.candidate.photoSeed} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-card font-semibold text-ink">{context.candidate.fullName}</p>
            <p className="font-mono text-support text-muted">{context.candidate.applicationId}</p>
            <p className="mt-1 text-meta text-muted">
              {context.exam.name} · {context.centre?.name} · workstation {context.workstation.deviceCode}
            </p>
          </div>
          {context.candidate.accommodations.additionalTimeMinutes > 0 ? (
            <StatusPill tone="info" size="sm">
              +{context.candidate.accommodations.additionalTimeMinutes} minutes accommodation applied
            </StatusPill>
          ) : null}
        </div>

        {error ? (
          <FailureState
            title="Verification could not be completed"
            whatHappened={error.message}
            answersSafe={error.answersSafe}
            whatToDo={error.guidance || 'Raise your hand for the invigilator.'}
            invigilatorNotified={false}
            reference={error.traceId}
            actions={
              <Button size="sm" variant="secondary" onClick={() => void runAutomaticChecks()}>
                Run the checks again
              </Button>
            }
          />
        ) : null}

        {blockingFailure ? (
          <FailureState
            title={
              blockingFailure.key === 'device'
                ? 'This workstation is not approved for your examination'
                : blockingFailure.key === 'network'
                  ? 'This workstation is not on the approved examination network'
                  : blockingFailure.key === 'paper'
                    ? 'The question paper failed its integrity check'
                    : 'A verification check did not pass'
            }
            whatHappened={blockingFailure.detail}
            answersSafe
            whatToDo={
              blockingFailure.key === 'device' || blockingFailure.key === 'network'
                ? 'Do not continue yet. Raise your hand. An alert has been sent to the admin queue, and an administrator can approve this workstation after checking it and recording a reason.'
                : blockingFailure.key === 'paper'
                  ? 'Release has been blocked automatically. No candidate will receive the affected paper. The examination controller has been notified.'
                  : 'Raise your hand and the invigilator will help.'
            }
            invigilatorNotified={adminAlertedFailure}
          />
        ) : null}

        {/* Automatic checks */}
        <section className="rounded-card border border-line bg-white">
          <header className="border-b border-line px-5 py-4">
            <h2 className="text-card font-semibold text-ink">Automatic checks</h2>
            <p className="mt-0.5 text-support text-muted">
              Run by the examination service. Nothing here relies on what this workstation claims about itself.
            </p>
          </header>
          <ol className="divide-y divide-line">
            {automaticChecks.map((step, index) => (
              <li key={step.key} className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 shrink-0">
                  {step.state === 'WAITING' ? (
                    <CircleDashed aria-hidden className="h-5 w-5 text-muted" />
                  ) : step.state === 'CHECKING' ? (
                    <Loader2 aria-hidden className="h-5 w-5 animate-spin text-brand" />
                  ) : null}
                  {step.state !== 'WAITING' && step.state !== 'CHECKING' ? (
                    <CheckBadge state={step.state} />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-support font-medium text-ink">
                    <span className="tnum text-muted">{index + 1}.</span>
                    {step.label}
                    {step.simulated ? (
                      <StatusPill tone="neutral" size="sm">
                        Simulated
                      </StatusPill>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-support text-muted" aria-live="polite">
                    {step.state === 'WAITING' ? 'Waiting…' : step.state === 'CHECKING' ? 'Checking…' : step.detail}
                  </p>
                </div>
              </li>
            ))}

            {/* Paper integrity is reported with the automatic checks */}
            {checks.find((check) => check.key === 'paper') ? (
              <li className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 shrink-0">
                  <CheckBadge state={checks.find((c) => c.key === 'paper')!.status as StepState} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-support font-medium text-ink">
                    <span className="tnum text-muted">5.</span>
                    Question paper verified
                  </p>
                  <p className="mt-0.5 text-support text-muted">{checks.find((c) => c.key === 'paper')!.detail}</p>
                </div>
              </li>
            ) : null}
          </ol>
        </section>

        {/* Fingerprint */}
        {fingerprintRequired ? (
          <section className="rounded-card border border-line bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-card font-semibold text-ink">
                  Fingerprint verification
                  <span className="ml-2 text-support font-normal text-muted">
                    {context.flags.fingerprintVerification === 'optional' ? 'Optional' : 'Required'}
                  </span>
                </h2>
                <p className="mt-0.5 text-support text-muted">
                  {context.candidate.fingerprintEnrolled
                    ? 'Confirms the fingerprint enrolled on your candidate record.'
                    : 'No fingerprint is enrolled for you, so this check is not required.'}
                </p>
              </div>
              {fingerprintResult !== 'SKIPPED' ? (
                <CheckBadge
                  state={fingerprintResult === 'PASSED' ? 'PASSED' : fingerprintResult === 'OVERRIDDEN' ? 'WARNING' : 'FAILED'}
                  label={
                    fingerprintResult === 'PASSED'
                      ? 'Matched'
                      : fingerprintResult === 'OVERRIDDEN'
                        ? 'Invigilator override'
                        : 'Not matched'
                  }
                />
              ) : null}
            </header>
            <div className="px-5 py-5">
              {!context.candidate.fingerprintEnrolled ? (
                <Alert tone="info" title="No fingerprint enrolment on record">
                  You will complete facial verification instead. This does not affect your examination in any way.
                </Alert>
              ) : fingerprintResult === 'PASSED' || fingerprintResult === 'OVERRIDDEN' ? (
                <Alert tone={fingerprintResult === 'PASSED' ? 'success' : 'warning'} title="Fingerprint step complete">
                  {fingerprintResult === 'PASSED'
                    ? 'Your fingerprint matched the enrolled reference.'
                    : 'An invigilator confirmed your identity in person. The override is recorded.'}
                </Alert>
              ) : (
                <FingerprintScanner
                  required={context.flags.fingerprintVerification === 'required'}
                  onResult={(outcome) => setFingerprintResult(outcome)}
                />
              )}
            </div>
          </section>
        ) : null}

        {/* Face */}
        {faceRequired ? (
          <section className="rounded-card border border-line bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-card font-semibold text-ink">Facial verification</h2>
                <p className="mt-0.5 text-support text-muted">
                  A photograph taken now is compared with the enrolment photograph on your candidate record.
                </p>
              </div>
              {faceResult !== 'SKIPPED' ? (
                <CheckBadge
                  state={faceResult === 'PASSED' ? 'PASSED' : faceResult === 'OVERRIDDEN' ? 'WARNING' : 'FAILED'}
                  label={
                    faceResult === 'PASSED'
                      ? 'Identity confirmed'
                      : faceResult === 'OVERRIDDEN'
                        ? 'Invigilator review'
                        : 'Not confirmed'
                  }
                />
              ) : null}
            </header>
            <div className="px-5 py-5">
              {faceResult === 'PASSED' || faceResult === 'OVERRIDDEN' ? (
                <Alert tone={faceResult === 'PASSED' ? 'success' : 'warning'} title="Facial verification complete">
                  {faceResult === 'PASSED'
                    ? 'Your photograph matched the enrolment photograph on your candidate record.'
                    : 'An invigilator confirmed your identity in person. The review outcome is recorded.'}
                </Alert>
              ) : (
                <FaceVerification onResult={(outcome) => setFaceResult(outcome)} />
              )}
            </div>
          </section>
        ) : null}

        {/* Continue */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <ShieldCheck
              aria-hidden
              className={`h-6 w-6 ${readyToContinue ? 'text-success' : 'text-muted'}`}
            />
            <div>
              <p className="text-support font-medium text-ink">
                {readyToContinue ? 'All required checks are complete' : 'Complete the checks above to continue'}
              </p>
              <p className="text-meta text-muted">
                Your attempt is created only after you have read the instructions and given consent.
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="lg"
            disabled={!readyToContinue}
            iconRight={<ArrowRight aria-hidden className="h-4 w-4" />}
            onClick={() => navigate('/exam/instructions')}
          >
            Continue to the instructions
          </Button>
        </div>
      </div>
    </CandidateShell>
  );
}
