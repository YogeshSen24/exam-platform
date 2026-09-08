import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, EyeOff, MonitorSmartphone, ShieldCheck, Timer } from 'lucide-react';
import {
  AUDIT_ACTION_LABELS,
  PROCTORING_RESULT_LABELS,
  type AuditEvent,
  type Candidate,
  type ExamAttempt,
  type ExaminationDevice,
  type Incident,
  type ProctoringEvent,
} from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatDuration, relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert, SkeletonText } from '@/components/ui/Feedback';
import { AttemptStatusPill, SeverityPill, StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { Avatar, DescriptionList, ProgressBar, useToast } from '@/components/ui/Misc';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { Field, TextArea, TextInput } from '@/components/ui/Form';
import { InfoPanel } from '@/components/ui/Explain';

interface SessionDetail {
  attempt: ExamAttempt & { remainingSeconds: number };
  candidate: Pick<
    Candidate,
    | 'id'
    | 'candidateId'
    | 'applicationId'
    | 'fullName'
    | 'photoSeed'
    | 'accommodations'
    | 'fingerprintEnrolled'
    | 'faceEnrolled'
    | 'eligibility'
    | 'lastVerificationEvent'
  > | null;
  device: (Pick<ExaminationDevice, 'deviceCode' | 'name' | 'operatingSystem' | 'certificate' | 'kioskPolicyVersion' | 'cameraStatus' | 'fingerprintScannerStatus' | 'networkStatus' | 'ipAddress'>) | null;
  exam: { id: string; name: string; code: string; navigationMode: string } | null;
  progress: { totalQuestions: number; answered: number; flagged: number; lastAnswerSavedAt: string | null };
  cameraEvents: ProctoringEvent[];
  incidents: Incident[];
  auditTimeline: AuditEvent[];
  questionContentVisible: boolean;
  note: string;
}

type ActionType =
  | 'REQUEST_REVERIFICATION'
  | 'APPROVE_RECOVERY'
  | 'EXTEND_TIME'
  | 'RESTRICT_SESSION'
  | 'RELEASE_RESTRICTION'
  | 'ESCALATE'
  | 'ADD_NOTE';

export function SessionDetailPage() {
  const { attemptId = '' } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ActionType | null>(null);
  const [reason, setReason] = useState('');
  const [extraMinutes, setExtraMinutes] = useState(10);

  const query = useQuery({
    queryKey: ['session', attemptId],
    queryFn: () => api.get<SessionDetail>(`/invigilator/sessions/${attemptId}`),
    refetchInterval: 15_000,
  });

  const act = useMutation({
    mutationFn: () =>
      api.post('/invigilator/actions', {
        attemptId,
        action,
        reason,
        ...(action === 'EXTEND_TIME' ? { extraMinutes } : {}),
        ...(action === 'ADD_NOTE' ? { note: reason } : {}),
      }),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Action recorded', description: 'Your reason was written to the audit trail.' });
      setAction(null);
      setReason('');
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Action failed',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      }),
  });

  const data = query.data;
  const attempt = data?.attempt;

  return (
    <div>
      <PageHeader
        title={data?.candidate?.fullName ?? 'Candidate session'}
        description={data?.exam ? `${data.exam.name} · ${data.exam.code}` : undefined}
        breadcrumb={
          <Link to="/invigilator" className="hover:text-brand hover:underline">
            ← Back to the live dashboard
          </Link>
        }
        meta={
          attempt ? (
            <>
              <AttemptStatusPill status={attempt.status} />
              <SeverityPill severity={attempt.alertLevel} />
              <StatusPill tone="neutral" size="sm">
                {data?.candidate?.applicationId}
              </StatusPill>
              <StatusPill tone="neutral" size="sm" icon={<Timer aria-hidden className="h-3.5 w-3.5" />}>
                {formatDuration(attempt.remainingSeconds)} remaining
              </StatusPill>
            </>
          ) : null
        }
        actions={
          attempt ? (
            <div className="flex flex-wrap gap-2">
              {attempt.status === 'RESTRICTED' || attempt.status === 'AWAITING_REVERIFICATION' ? (
                <Button variant="primary" onClick={() => setAction('APPROVE_RECOVERY')}>
                  Approve recovery
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setAction('REQUEST_REVERIFICATION')}>
                  Request reverification
                </Button>
              )}
              <Button variant="secondary" onClick={() => setAction('EXTEND_TIME')}>
                Extend time
              </Button>
              <Button variant="secondary" onClick={() => setAction('ADD_NOTE')}>
                Add note
              </Button>
              <Button variant="ghost" onClick={() => setAction('ESCALATE')}>
                Escalate
              </Button>
            </div>
          ) : null
        }
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="This candidate session"
        skeleton={
          <Card>
            <CardBody>
              <SkeletonText lines={8} />
            </CardBody>
          </Card>
        }
      >
        {data && attempt ? (
          <div className="space-y-6">
            {attempt.restrictionReason ? (
              <Alert tone="critical" live title="This session is currently restricted">
                {attempt.restrictionReason} The candidate cannot move between questions until a person releases the
                session. Every answer they have given is safe on the server.
              </Alert>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Examination progress" description="Progress only — question content is not shown here." />
                  <CardBody className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <p className="text-meta uppercase tracking-wide text-muted">Answered</p>
                        <p className="tnum mt-0.5 text-section font-semibold text-ink">
                          {data.progress.answered}
                          <span className="text-body text-muted"> / {data.progress.totalQuestions}</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-meta uppercase tracking-wide text-muted">Flagged for review</p>
                        <p className="tnum mt-0.5 text-section font-semibold text-ink">{data.progress.flagged}</p>
                      </div>
                      <div>
                        <p className="text-meta uppercase tracking-wide text-muted">Last answer saved</p>
                        <p className="mt-0.5 text-support text-ink">{relativeTime(data.progress.lastAnswerSavedAt)}</p>
                      </div>
                    </div>
                    <ProgressBar
                      label="Questions answered"
                      value={data.progress.answered}
                      max={data.progress.totalQuestions || 1}
                      tone="brand"
                    />
                    <InfoPanel title="Why you cannot see the questions" icon={<EyeOff aria-hidden className="h-5 w-5" />}>
                      {data.note}
                    </InfoPanel>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader
                    icon={<Camera aria-hidden className="h-5 w-5" />}
                    title="Camera presence events"
                    description="Most recent first. Each capture is chained to the one before it."
                  />
                  <CardBody>
                    {data.cameraEvents.length === 0 ? (
                      <p className="text-support text-muted">
                        No presence checks have been recorded for this session yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {data.cameraEvents.map((event) => (
                          <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2 text-support font-medium text-ink">
                                {PROCTORING_RESULT_LABELS[event.result] ?? event.result}
                                <SeverityPill severity={event.severity} />
                                <StatusPill tone="neutral" size="sm">
                                  Simulated
                                </StatusPill>
                              </p>
                              <p className="mt-0.5 text-meta text-muted">
                                Check {event.sequence} · confidence {(event.confidence * 100).toFixed(0)}% ·{' '}
                                {formatDateTime(event.capturedAt)}
                              </p>
                              <p className="mt-1 font-mono text-meta text-muted">
                                chain {event.evidenceHash.slice(0, 12)}…
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Incidents and notes" description="Everything raised against this session." />
                  <CardBody>
                    {data.incidents.length === 0 ? (
                      <p className="text-support text-muted">No incident has been raised for this session.</p>
                    ) : (
                      <ul className="space-y-4">
                        {data.incidents.map((incident) => (
                          <li key={incident.id} className="rounded-card border border-line bg-page p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-support font-semibold text-ink">{incident.title}</p>
                              <div className="flex items-center gap-2">
                                <SeverityPill severity={incident.severity} />
                                <StatusPill tone="neutral" size="sm">
                                  {incident.status.charAt(0) + incident.status.slice(1).toLowerCase()}
                                </StatusPill>
                              </div>
                            </div>
                            <p className="mt-1.5 text-support text-muted">{incident.detail}</p>
                            {incident.notes.length > 0 ? (
                              <ul className="mt-3 space-y-2 border-t border-line pt-3">
                                {incident.notes.map((note) => (
                                  <li key={note.id}>
                                    <p className="text-support text-ink">{note.body}</p>
                                    <p className="text-meta text-muted">
                                      {note.authorName} · {formatDateTime(note.createdAt)}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            <Link
                              to={`/invigilator/incidents/${incident.id}`}
                              className="mt-3 inline-block text-meta font-medium text-brand hover:underline"
                            >
                              Open incident →
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Audit timeline" description="Every recorded action on this attempt." />
                  <CardBody>
                    {data.auditTimeline.length === 0 ? (
                      <p className="text-support text-muted">No audit events recorded yet.</p>
                    ) : (
                      <ol className="space-y-4">
                        {data.auditTimeline.map((event) => (
                          <li key={event.id} className="flex gap-3">
                            <span
                              aria-hidden
                              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                event.result === 'BLOCKED'
                                  ? 'bg-critical'
                                  : event.result === 'FAILURE'
                                    ? 'bg-warning'
                                    : 'bg-success'
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="text-support font-medium text-ink">
                                {AUDIT_ACTION_LABELS[event.action] ?? event.action}
                              </p>
                              <p className="text-support text-muted">{event.reason}</p>
                              <p className="mt-0.5 text-meta text-muted">
                                {event.actorName} · {formatDateTime(event.timestamp)}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </CardBody>
                </Card>
              </div>

              <div className="space-y-6">
                <Card as="aside">
                  <CardHeader title="Candidate" />
                  <CardBody className="space-y-4">
                    {data.candidate ? (
                      <>
                        <div className="flex items-center gap-4">
                          <Avatar name={data.candidate.fullName} seed={data.candidate.photoSeed} size="lg" />
                          <div>
                            <p className="text-card font-semibold text-ink">{data.candidate.fullName}</p>
                            <p className="font-mono text-meta text-muted">{data.candidate.applicationId}</p>
                          </div>
                        </div>
                        <DescriptionList
                          columns={1}
                          items={[
                            { term: 'Candidate ID', value: data.candidate.candidateId },
                            { term: 'Eligibility', value: data.candidate.eligibility.toLowerCase() },
                            {
                              term: 'Accommodations',
                              value:
                                data.candidate.accommodations.additionalTimeMinutes > 0
                                  ? `+${data.candidate.accommodations.additionalTimeMinutes} minutes${
                                      data.candidate.accommodations.requirements.length > 0
                                        ? ` · ${data.candidate.accommodations.requirements.join(', ')}`
                                        : ''
                                    }`
                                  : 'None',
                            },
                            {
                              term: 'Enrolment',
                              value: [
                                data.candidate.faceEnrolled ? 'Face' : null,
                                data.candidate.fingerprintEnrolled ? 'Fingerprint' : null,
                              ]
                                .filter(Boolean)
                                .join(' and ') || 'None',
                            },
                            {
                              term: 'Last verification',
                              value: data.candidate.lastVerificationEvent
                                ? `${data.candidate.lastVerificationEvent.result} — ${formatDateTime(
                                    data.candidate.lastVerificationEvent.at,
                                  )}`
                                : 'None recorded',
                            },
                          ]}
                        />
                        <Link
                          to={`/admin/candidates/${data.candidate.id}`}
                          className="text-support font-medium text-brand hover:underline"
                        >
                          Open the candidate record →
                        </Link>
                      </>
                    ) : null}
                  </CardBody>
                </Card>

                <Card as="aside">
                  <CardHeader
                    icon={<MonitorSmartphone aria-hidden className="h-5 w-5" />}
                    title="Workstation"
                    description="The machine this attempt is bound to."
                  />
                  <CardBody>
                    {data.device ? (
                      <DescriptionList
                        columns={1}
                        items={[
                          { term: 'Identifier', value: <code className="font-mono">{data.device.deviceCode}</code> },
                          { term: 'Operating system', value: data.device.operatingSystem },
                          { term: 'Kiosk policy', value: data.device.kioskPolicyVersion },
                          {
                            term: 'Certificate',
                            value: (
                              <StatusPill
                                size="sm"
                                tone={data.device.certificate.status === 'VALID' ? 'success' : 'warning'}
                              >
                                {data.device.certificate.status.toLowerCase()}
                              </StatusPill>
                            ),
                          },
                          { term: 'Camera', value: data.device.cameraStatus },
                          { term: 'Fingerprint scanner', value: data.device.fingerprintScannerStatus },
                          { term: 'Network address', value: <code className="font-mono text-meta">{data.device.ipAddress}</code> },
                        ]}
                      />
                    ) : (
                      <p className="text-support text-muted">No workstation is recorded for this attempt.</p>
                    )}
                  </CardBody>
                </Card>

                <Card as="aside">
                  <CardHeader
                    icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
                    title="Session state"
                  />
                  <CardBody>
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Started', value: formatDateTime(attempt.startedAt) },
                        { term: 'Expires', value: formatDateTime(attempt.expiresAt) },
                        { term: 'Remaining', value: formatDuration(attempt.remainingSeconds) },
                        { term: 'Identity status', value: attempt.identityStatus.toLowerCase() },
                        { term: 'Connection', value: attempt.connectionStatus.toLowerCase() },
                        {
                          term: 'Consecutive monitoring failures',
                          value: <span className="tnum">{attempt.consecutiveMonitoringFailures}</span>,
                        },
                        { term: 'Additional time granted', value: `${attempt.additionalTimeMinutes} minutes` },
                      ]}
                    />
                  </CardBody>
                </Card>
              </div>
            </div>
          </div>
        ) : null}
      </Loadable>

      <ConfirmDialog
        open={Boolean(action)}
        onClose={() => {
          setAction(null);
          setReason('');
        }}
        onConfirm={() => act.mutate()}
        title={
          action === 'APPROVE_RECOVERY'
            ? 'Approve recovery'
            : action === 'REQUEST_REVERIFICATION'
              ? 'Request reverification'
              : action === 'EXTEND_TIME'
                ? 'Extend time'
                : action === 'ESCALATE'
                  ? 'Escalate to the examination controller'
                  : 'Add an incident note'
        }
        description="Sensitive actions require a reason and are recorded in the audit trail."
        confirmLabel="Record action"
        tone={action === 'ESCALATE' ? 'critical' : 'default'}
        loading={act.isPending}
        confirmDisabled={reason.trim().length < 5}
      >
        <div className="space-y-4">
          {action === 'EXTEND_TIME' ? (
            <Field label="Additional minutes" htmlFor="detail-extra" required>
              <TextInput
                id="detail-extra"
                type="number"
                min={1}
                max={120}
                className="max-w-[10rem]"
                value={extraMinutes}
                onChange={(event) => setExtraMinutes(Number(event.target.value))}
              />
            </Field>
          ) : null}
          <Field label="Reason" htmlFor="detail-reason" required hint="At least five characters.">
            <TextArea
              id="detail-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
