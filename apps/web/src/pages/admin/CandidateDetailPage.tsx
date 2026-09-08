import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Accessibility, Fingerprint, ScanFace, ShieldCheck } from 'lucide-react';
import { AUDIT_ACTION_LABELS, type AuditEvent, type Candidate, type Exam, type ExamAttempt, type ExaminationCentre, type ExamRegistration, type SubmissionReceipt } from '@sep/shared';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { SkeletonText } from '@/components/ui/Feedback';
import { AttemptStatusPill, StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { Avatar, DescriptionList } from '@/components/ui/Misc';
import { HashValue, InfoPanel } from '@/components/ui/Explain';

interface CandidateDetailResponse {
  candidate: Candidate;
  centre: ExaminationCentre | null;
  exam: Exam | null;
  registration: ExamRegistration | null;
  attempt: ExamAttempt | null;
  receipt: SubmissionReceipt | null;
  auditTimeline: AuditEvent[];
  privacyNote: string;
}

export function CandidateDetailPage() {
  const { candidateId = '', examId } = useParams();

  const query = useQuery({
    queryKey: ['candidate', candidateId, examId],
    queryFn: () => api.get<CandidateDetailResponse>(`/candidates/${candidateId}`, { examId }),
  });

  const data = query.data;
  const candidate = data?.candidate;

  return (
    <div>
      <PageHeader
        title={candidate?.fullName ?? 'Candidate'}
        description="Registration, accommodations, verification enrolment and the audit trail for this candidate."
        breadcrumb={
          <Link to={examId ? `/admin/exams/${examId}/candidates` : '/admin/exams'} className="hover:text-brand hover:underline">
            ← Back to candidates
          </Link>
        }
        meta={
          candidate ? (
            <>
              <StatusPill tone="neutral" size="sm">
                {candidate.applicationId}
              </StatusPill>
              <StatusPill
                size="sm"
                tone={candidate.eligibility === 'ELIGIBLE' ? 'success' : 'warning'}
              >
                {candidate.eligibility.charAt(0) + candidate.eligibility.slice(1).toLowerCase()}
              </StatusPill>
              <StatusPill size="sm" tone={candidate.accountStatus === 'ACTIVE' ? 'success' : 'critical'}>
                Account {candidate.accountStatus.toLowerCase()}
              </StatusPill>
            </>
          ) : null
        }
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="This candidate"
        skeleton={
          <Card>
            <CardBody>
              <SkeletonText lines={8} />
            </CardBody>
          </Card>
        }
      >
        {data && candidate ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <Card>
                <CardHeader title="Candidate record" />
                <CardBody>
                  <div className="mb-6 flex items-center gap-4">
                    <Avatar name={candidate.fullName} seed={candidate.photoSeed} size="lg" />
                    <div>
                      <p className="text-card font-semibold text-ink">{candidate.fullName}</p>
                      <p className="text-support text-muted">{candidate.email}</p>
                      <p className="mt-1 text-meta text-muted">
                        Enrolment photograph is a neutral generated avatar. No photograph of a real person is used.
                      </p>
                    </div>
                  </div>
                  <DescriptionList
                    columns={2}
                    items={[
                      { term: 'Candidate ID', value: <code className="font-mono">{candidate.candidateId}</code> },
                      { term: 'Application ID', value: <code className="font-mono">{candidate.applicationId}</code> },
                      { term: 'Assigned examination', value: data.exam?.name ?? 'None' },
                      { term: 'Assigned centre', value: data.centre?.name ?? 'None' },
                      { term: 'Seat number', value: data.registration?.seatNumber ?? '—' },
                      { term: 'Registered', value: formatDateTime(data.registration?.createdAt) },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  icon={<Accessibility aria-hidden className="h-5 w-5" />}
                  title="Accommodations"
                  description="Applied automatically to the attempt when it is activated."
                />
                <CardBody>
                  {candidate.accommodations.additionalTimeMinutes === 0 &&
                  candidate.accommodations.requirements.length === 0 ? (
                    <p className="text-support text-muted">No accommodations are recorded for this candidate.</p>
                  ) : (
                    <DescriptionList
                      columns={1}
                      items={[
                        {
                          term: 'Additional time',
                          value: `${candidate.accommodations.additionalTimeMinutes} minutes`,
                        },
                        {
                          term: 'Requirements',
                          value:
                            candidate.accommodations.requirements.length > 0 ? (
                              <ul className="flex flex-wrap gap-2">
                                {candidate.accommodations.requirements.map((requirement) => (
                                  <li key={requirement}>
                                    <StatusPill tone="info" size="sm">
                                      {requirement}
                                    </StatusPill>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              'None'
                            ),
                        },
                        { term: 'Notes', value: candidate.accommodations.notes || '—' },
                      ]}
                    />
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Audit timeline" description="Every recorded action involving this candidate." />
                <CardBody>
                  {data.auditTimeline.length === 0 ? (
                    <p className="text-support text-muted">No activity has been recorded for this candidate yet.</p>
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
                              {formatDateTime(event.timestamp)} · {event.ipAddress} · trace{' '}
                              <code className="font-mono">{event.traceId.slice(0, 8)}</code>
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
                <CardHeader
                  icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
                  title="Verification enrolment"
                  description="What this candidate can be verified against."
                />
                <CardBody className="space-y-4">
                  <ul className="space-y-3">
                    <li className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-support text-ink">
                        <ScanFace aria-hidden className="h-4 w-4 text-muted" />
                        Face enrolment
                      </span>
                      <StatusPill tone={candidate.faceEnrolled ? 'success' : 'neutral'} size="sm">
                        {candidate.faceEnrolled ? 'Enrolled' : 'Not enrolled'}
                      </StatusPill>
                    </li>
                    <li className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-support text-ink">
                        <Fingerprint aria-hidden className="h-4 w-4 text-muted" />
                        Fingerprint enrolment
                      </span>
                      <StatusPill tone={candidate.fingerprintEnrolled ? 'success' : 'neutral'} size="sm">
                        {candidate.fingerprintEnrolled ? 'Enrolled' : 'Not enrolled'}
                      </StatusPill>
                    </li>
                  </ul>

                  <DescriptionList
                    columns={1}
                    items={[
                      {
                        term: 'Biometric reference',
                        value: candidate.biometricReferenceId ? (
                          <code className="font-mono text-meta">{candidate.biometricReferenceId}</code>
                        ) : (
                          '—'
                        ),
                      },
                      {
                        term: 'Last verification event',
                        value: candidate.lastVerificationEvent
                          ? `${candidate.lastVerificationEvent.type} — ${candidate.lastVerificationEvent.result} (${formatDateTime(candidate.lastVerificationEvent.at)})`
                          : 'None recorded',
                      },
                    ]}
                  />

                  <InfoPanel title="POC biometric simulation">
                    {data.privacyNote}
                  </InfoPanel>
                </CardBody>
              </Card>

              {data.attempt ? (
                <Card as="aside">
                  <CardHeader title="Examination attempt" />
                  <CardBody className="space-y-4">
                    <AttemptStatusPill status={data.attempt.status} />
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Started', value: formatDateTime(data.attempt.startedAt) },
                        { term: 'Expires', value: formatDateTime(data.attempt.expiresAt) },
                        { term: 'Submitted', value: formatDateTime(data.attempt.submittedAt) },
                        { term: 'Answered', value: `${data.attempt.answeredCount}` },
                        { term: 'Identity status', value: data.attempt.identityStatus.toLowerCase() },
                        { term: 'Connection', value: data.attempt.connectionStatus.toLowerCase() },
                      ]}
                    />
                    <Link
                      to={`/invigilator/sessions/${data.attempt.id}`}
                      className="text-support font-medium text-brand hover:underline"
                    >
                      Open the live session view →
                    </Link>
                  </CardBody>
                </Card>
              ) : null}

              {data.receipt ? (
                <Card as="aside">
                  <CardHeader title="Submission receipt" description="Tamper-evident record of the final submission." />
                  <CardBody>
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Receipt ID', value: <code className="font-mono text-meta">{data.receipt.receiptId}</code> },
                        { term: 'Submitted', value: formatDateTime(data.receipt.submittedAt) },
                        {
                          term: 'Answered',
                          value: `${data.receipt.answeredCount} of ${data.receipt.totalQuestions}`,
                        },
                        { term: 'Answer-set fingerprint', value: <HashValue value={data.receipt.answerSetHash} /> },
                      ]}
                    />
                  </CardBody>
                </Card>
              ) : null}
            </div>
          </div>
        ) : null}
      </Loadable>
    </div>
  );
}
