import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Camera, ClipboardList, Clock, Save, ShieldAlert } from 'lucide-react';
import { NAVIGATION_MODE_HELP, NAVIGATION_MODE_LABELS, type NavigationMode } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useCandidateStore } from '@/lib/candidateStore';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Form';
import { Alert, FailureState } from '@/components/ui/Feedback';
import { Avatar } from '@/components/ui/Misc';
import { StatusPill } from '@/components/ui/Status';
import type { CandidateContextResponse } from './CandidateApp';
import { CandidateShell } from './CandidateShell';

/**
 * Instructions and consent.
 *
 * The wording is deliberately clear and neutral rather than threatening: the
 * candidate is told what happens, what is collected and what to do if something
 * goes wrong. The attempt is only created after explicit confirmation.
 */
export function InstructionsScreen({ context }: { context: CandidateContextResponse }) {
  const navigate = useNavigate();
  const { workstationCode, fingerprintResult, faceResult, setAttemptId, setConsentGiven } = useCandidateStore();

  const [consent, setConsent] = useState({
    identityConfirmed: false,
    rulesUnderstood: false,
    monitoringAcknowledged: !context.monitoring.cameraMonitoringEnabled,
    savingUnderstood: false,
  });
  const [error, setError] = useState<ApiError | null>(null);

  const allConfirmed =
    consent.identityConfirmed && consent.rulesUnderstood && consent.monitoringAcknowledged && consent.savingUnderstood;

  const activate = useMutation({
    mutationFn: () =>
      api.post<{ attempt: { id: string } }>('/attempts/activate', {
        examId: context.exam.id,
        deviceCode: workstationCode,
        verification: { fingerprint: fingerprintResult, face: faceResult },
        consent: {
          identityConfirmed: true,
          rulesUnderstood: true,
          monitoringAcknowledged: true,
          savingUnderstood: true,
        },
      }),
    onSuccess: (data) => {
      setAttemptId(data.attempt.id);
      setConsentGiven(true);
      navigate('/exam/waiting');
    },
    onError: (caught) => {
      if (caught instanceof ApiError) setError(caught);
    },
  });

  return (
    <CandidateShell
      context={context}
      title="Before you begin"
      subtitle="Please read these instructions. You will confirm four things at the bottom of the page, and your examination will then be prepared."
      step={2}
    >
      <div className="space-y-6">
        {error ? (
          <FailureState
            title="Your examination could not be started"
            whatHappened={error.message}
            answersSafe
            whatToDo={error.guidance || 'Raise your hand for the invigilator.'}
            invigilatorNotified={error.code === 'PAPER_INTEGRITY_FAILED'}
            reference={error.traceId}
            actions={
              <Button size="sm" variant="secondary" onClick={() => navigate('/exam/verify')}>
                Return to verification
              </Button>
            }
          />
        ) : null}

        {/* Identity confirmation */}
        <section className="rounded-card border border-line bg-white px-5 py-5">
          <h2 className="text-card font-semibold text-ink">Confirm this is you</h2>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Avatar name={context.candidate.fullName} seed={context.candidate.photoSeed} size="lg" />
            <dl className="grid flex-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-meta uppercase tracking-wide text-muted">Name</dt>
                <dd className="text-support font-medium text-ink">{context.candidate.fullName}</dd>
              </div>
              <div>
                <dt className="text-meta uppercase tracking-wide text-muted">Application ID</dt>
                <dd className="font-mono text-support text-ink">{context.candidate.applicationId}</dd>
              </div>
              <div>
                <dt className="text-meta uppercase tracking-wide text-muted">Candidate ID</dt>
                <dd className="font-mono text-support text-ink">{context.candidate.candidateId}</dd>
              </div>
              <div>
                <dt className="text-meta uppercase tracking-wide text-muted">Workstation</dt>
                <dd className="font-mono text-support text-ink">{context.workstation.deviceCode}</dd>
              </div>
            </dl>
          </div>
          <p className="mt-3 text-meta text-muted">
            If any of these details are not yours, raise your hand now and do not continue.
          </p>
        </section>

        {/* Examination facts */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: <Clock aria-hidden className="h-5 w-5 text-brand" />, label: 'Duration', value: `${context.exam.durationMinutes} minutes` },
            {
              icon: <ClipboardList aria-hidden className="h-5 w-5 text-brand" />,
              label: 'Questions',
              value: `${context.exam.totalQuestions}`,
            },
            { icon: <ClipboardList aria-hidden className="h-5 w-5 text-brand" />, label: 'Total marks', value: `${context.exam.totalMarks}` },
            {
              icon: <ShieldAlert aria-hidden className="h-5 w-5 text-brand" />,
              label: 'Negative marking',
              value: context.exam.negativeMarking ? 'Varies by category; shown on each question' : 'None',
            },
          ].map((item) => (
            <div key={item.label} className="rounded-card border border-line bg-white px-4 py-3.5">
              <span className="flex items-center gap-2 text-meta uppercase tracking-wide text-muted">
                {item.icon}
                {item.label}
              </span>
              <p className="mt-1.5 text-card font-semibold text-ink">{item.value}</p>
            </div>
          ))}
        </section>

        {context.candidate.accommodations.additionalTimeMinutes > 0 ? (
          <Alert tone="info" title="Your approved accommodation has been applied">
            You have {context.candidate.accommodations.additionalTimeMinutes} additional minutes, giving you{' '}
            {context.exam.durationMinutes + context.candidate.accommodations.additionalTimeMinutes} minutes in total.
            {context.candidate.accommodations.requirements.length > 0
              ? ` Also recorded: ${context.candidate.accommodations.requirements.join(', ')}.`
              : ''}
          </Alert>
        ) : null}

        {/* Rules */}
        <section className="rounded-card border border-line bg-white">
          <header className="border-b border-line px-5 py-4">
            <h2 className="text-card font-semibold text-ink">How this examination works</h2>
          </header>
          <div className="divide-y divide-line">
            <InstructionRow
              title="Moving between questions"
              body={NAVIGATION_MODE_HELP[context.exam.navigationMode as NavigationMode]}
              badge={NAVIGATION_MODE_LABELS[context.exam.navigationMode as NavigationMode]}
            />
            <InstructionRow
              title="Your answers are saved continuously"
              body="Every answer is sent to the examination server the moment you select it, and again periodically. You do not need to save anything yourself. If the network drops, answers are queued on this workstation and sent automatically when the connection returns."
              icon={<Save aria-hidden className="h-5 w-5 text-brand" />}
            />
            <InstructionRow
              title="Submitting"
              body="You can submit at any time from the review screen, which shows how many questions you have answered, left blank or flagged. When the time runs out, everything saved is submitted for you automatically. After submission your answers are locked and cannot be changed."
            />
            <InstructionRow
              title="What you may not do"
              body="Do not use any other device, material, application or website. Do not communicate with anyone else during the examination. Do not leave your workstation without permission from the invigilator. Do not attempt to photograph or copy the questions."
            />
            <InstructionRow
              title="If something goes wrong"
              body="Raise your hand and stay at your workstation. An invigilator will attend. A technical fault, a lost connection or a failed camera check will not lose your answers and will not end your examination on its own."
            />
          </div>
        </section>

        {/* Monitoring notice */}
        {context.monitoring.cameraMonitoringEnabled ? (
          <section className="rounded-card border border-info-border bg-info-soft px-5 py-5">
            <h2 className="flex items-center gap-2 text-card font-semibold text-ink">
              <Camera aria-hidden className="h-5 w-5 text-brand" />
              Camera monitoring during this examination
            </h2>
            <p className="mt-2 max-w-prose text-body text-ink">{context.monitoring.candidateNotice}</p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { term: 'How often', value: `Every ${context.monitoring.snapshotIntervalSeconds} seconds` },
                { term: 'What is collected', value: 'A low-resolution still image only' },
                { term: 'Who can see it', value: 'Authorised examination staff only' },
                { term: 'How long it is kept', value: `${context.monitoring.evidenceRetentionDays} days, then deleted` },
              ].map((item) => (
                <div key={item.term}>
                  <dt className="text-meta uppercase tracking-wide text-muted">{item.term}</dt>
                  <dd className="mt-0.5 text-support text-ink">{item.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-support text-muted">
              No audio, screen contents or keystrokes are recorded, and nothing about your race, emotion, age, gender or
              health is inferred. If a check fails {context.monitoring.consecutiveFailureThreshold} times in a row, your
              question navigation is paused while your identity is confirmed — your answers are kept and an invigilator
              reviews the situation in person.
            </p>
          </section>
        ) : (
          <Alert tone="info" title="Camera monitoring is not used for this examination">
            No images will be captured or stored during your examination.
          </Alert>
        )}

        {/* Consent */}
        <section className="rounded-card border border-line bg-white px-5 py-5">
          <h2 className="text-card font-semibold text-ink">Please confirm</h2>
          <p className="mt-1 text-support text-muted">
            Your confirmation is recorded with the time and this workstation’s identifier.
          </p>
          <div className="mt-4 space-y-4">
            <Checkbox
              checked={consent.identityConfirmed}
              onChange={(event) => setConsent({ ...consent, identityConfirmed: event.target.checked })}
              label={`I confirm I am ${context.candidate.fullName}, application ID ${context.candidate.applicationId}.`}
            />
            <Checkbox
              checked={consent.rulesUnderstood}
              onChange={(event) => setConsent({ ...consent, rulesUnderstood: event.target.checked })}
              label="I have read and understood the examination rules above."
            />
            {context.monitoring.cameraMonitoringEnabled ? (
              <Checkbox
                checked={consent.monitoringAcknowledged}
                onChange={(event) => setConsent({ ...consent, monitoringAcknowledged: event.target.checked })}
                label="I understand that camera monitoring is required for this examination and is active while I am working."
                description={`Images every ${context.monitoring.snapshotIntervalSeconds} seconds, kept for ${context.monitoring.evidenceRetentionDays} days.`}
              />
            ) : null}
            <Checkbox
              checked={consent.savingUnderstood}
              onChange={(event) => setConsent({ ...consent, savingUnderstood: event.target.checked })}
              label="I understand that my answers are saved continuously and are locked once I submit."
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white px-5 py-4">
          <div>
            <p className="text-support font-medium text-ink">
              {allConfirmed ? 'Ready to prepare your examination' : 'Confirm all of the statements above to continue'}
            </p>
            <p className="text-meta text-muted">
              Server time {formatDateTime(context.serverTime)} · {context.securityProfile.name} profile
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={allConfirmed ? 'success' : 'neutral'} size="sm">
              {Object.values(consent).filter(Boolean).length} of {Object.keys(consent).length} confirmed
            </StatusPill>
            <Button
              variant="primary"
              size="lg"
              disabled={!allConfirmed}
              loading={activate.isPending}
              loadingText="Preparing your paper…"
              iconRight={<ArrowRight aria-hidden className="h-4 w-4" />}
              onClick={() => activate.mutate()}
            >
              Prepare my examination
            </Button>
          </div>
        </div>
      </div>
    </CandidateShell>
  );
}

function InstructionRow({
  title,
  body,
  icon,
  badge,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="flex gap-4 px-5 py-4">
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-support font-semibold text-ink">
          {title}
          {badge ? (
            <StatusPill tone="info" size="sm">
              {badge}
            </StatusPill>
          ) : null}
        </p>
        <p className="mt-1 max-w-prose text-support text-muted">{body}</p>
      </div>
    </div>
  );
}
