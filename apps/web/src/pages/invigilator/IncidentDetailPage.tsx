import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquarePlus, ShieldAlert } from 'lucide-react';
import {
  AUDIT_ACTION_LABELS,
  INCIDENT_TYPE_LABELS,
  type AuditEvent,
  type Candidate,
  type ExamAttempt,
  type ExaminationDevice,
  type Incident,
} from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert, SkeletonText } from '@/components/ui/Feedback';
import { AttemptStatusPill, SeverityPill, StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { DescriptionList, useToast } from '@/components/ui/Misc';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { Field, TextArea } from '@/components/ui/Form';

interface IncidentDetail {
  incident: Incident;
  candidate: Candidate | null;
  attempt: ExamAttempt | null;
  device: ExaminationDevice | null;
  relatedAudit: AuditEvent[];
}

export function IncidentDetailPage() {
  const { incidentId = '' } = useParams();
  const toast = useToast();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [workstationApprovalOpen, setWorkstationApprovalOpen] = useState(false);
  const [reason, setReason] = useState('');

  const query = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => api.get<IncidentDetail>(`/incidents/${incidentId}`),
  });

  const data = query.data;
  const incident = data?.incident;
  const reportedDeviceCode =
    typeof incident?.metadata?.reportedDeviceCode === 'string' ? incident.metadata.reportedDeviceCode : null;
  const canApproveWorkstation = Boolean(
    incident && incident.type === 'UNAPPROVED_WORKSTATION' && incident.status !== 'RESOLVED' && can('devices.write'),
  );

  const act = useMutation({
    mutationFn: (action: 'ADD_NOTE' | 'APPROVE_RECOVERY') =>
      api.post('/invigilator/actions', {
        attemptId: data!.attempt!.id,
        action,
        reason,
        ...(action === 'ADD_NOTE' ? { note: reason } : {}),
      }),
    onSuccess: (_, action) => {
      toast.push({
        tone: 'success',
        title: action === 'ADD_NOTE' ? 'Note recorded' : 'Recovery approved',
        description: 'Your reason was written to the audit trail.',
      });
      setNoteOpen(false);
      setRecoveryOpen(false);
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

  const approveWorkstation = useMutation({
    mutationFn: () => api.post<{ outcome: string }>(`/incidents/${incidentId}/approve-workstation`, { reason }),
    onSuccess: (result) => {
      toast.push({
        tone: 'success',
        title: 'Workstation approved',
        description: result.outcome,
      });
      setWorkstationApprovalOpen(false);
      setReason('');
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Approval failed',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      }),
  });

  return (
    <div>
      <PageHeader
        title={incident?.title ?? 'Incident'}
        description={incident ? INCIDENT_TYPE_LABELS[incident.type] : undefined}
        breadcrumb={
          <Link to="/invigilator/alerts" className="hover:text-brand hover:underline">
            ← Back to the alert queue
          </Link>
        }
        meta={
          incident ? (
            <>
              <SeverityPill severity={incident.severity} />
              <StatusPill
                size="sm"
                tone={incident.status === 'OPEN' ? 'warning' : incident.status === 'ACKNOWLEDGED' ? 'info' : 'success'}
              >
                {incident.status.charAt(0) + incident.status.slice(1).toLowerCase()}
              </StatusPill>
            </>
          ) : null
        }
        actions={
          incident ? (
            <div className="flex flex-wrap gap-2">
              {canApproveWorkstation ? (
                <Button
                  variant="primary"
                  icon={<CheckCircle2 aria-hidden className="h-4 w-4" />}
                  onClick={() => setWorkstationApprovalOpen(true)}
                >
                  Approve workstation
                </Button>
              ) : null}
              {data?.attempt &&
              (data.attempt.status === 'RESTRICTED' || data.attempt.status === 'AWAITING_REVERIFICATION') ? (
                <Button
                  variant="primary"
                  icon={<CheckCircle2 aria-hidden className="h-4 w-4" />}
                  onClick={() => setRecoveryOpen(true)}
                >
                  Approve recovery
                </Button>
              ) : null}
              {data?.attempt ? (
                <>
                  <Button
                    variant="secondary"
                    icon={<MessageSquarePlus aria-hidden className="h-4 w-4" />}
                    onClick={() => setNoteOpen(true)}
                  >
                    Add note
                  </Button>
                  <Link to={`/invigilator/sessions/${data.attempt.id}`}>
                    <Button variant="ghost">Open session</Button>
                  </Link>
                </>
              ) : null}
            </div>
          ) : null
        }
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="This incident"
        skeleton={
          <Card>
            <CardBody>
              <SkeletonText lines={8} />
            </CardBody>
          </Card>
        }
      >
        {data && incident ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              {incident.severity === 'CRITICAL' && incident.status !== 'RESOLVED' ? (
                <Alert tone="critical" live title="This incident is critical and still open">
                  A person must decide what happens next. No examination is ended automatically on the strength of
                  automated analysis, and no candidate answers are affected by this incident.
                </Alert>
              ) : null}

              <Card>
                <CardHeader
                  icon={<ShieldAlert aria-hidden className="h-5 w-5" />}
                  title="What happened"
                />
                <CardBody className="space-y-4">
                  <p className="max-w-prose text-body text-ink">{incident.detail}</p>
                  <DescriptionList
                    columns={2}
                    items={[
                      { term: 'Incident type', value: INCIDENT_TYPE_LABELS[incident.type] },
                      { term: 'Raised', value: formatDateTime(incident.createdAt) },
                      { term: 'Last updated', value: formatDateTime(incident.updatedAt) },
                      { term: 'Assigned to', value: incident.assignedToUserId ?? 'Unassigned' },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Notes" description="Recorded by invigilators and the examination controller." />
                <CardBody>
                  {incident.notes.length === 0 ? (
                    <p className="text-support text-muted">No notes have been added to this incident.</p>
                  ) : (
                    <ul className="space-y-3">
                      {incident.notes.map((note) => (
                        <li key={note.id} className="rounded-card border border-line bg-page p-4">
                          <p className="text-support text-ink">{note.body}</p>
                          <p className="mt-1.5 text-meta text-muted">
                            {note.authorName} · {formatDateTime(note.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Related audit events" />
                <CardBody>
                  {data.relatedAudit.length === 0 ? (
                    <p className="text-support text-muted">No related audit events.</p>
                  ) : (
                    <ol className="space-y-3">
                      {data.relatedAudit.map((event) => (
                        <li key={event.id} className="flex gap-3">
                          <span
                            aria-hidden
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              event.result === 'BLOCKED' ? 'bg-critical' : event.result === 'FAILURE' ? 'bg-warning' : 'bg-success'
                            }`}
                          />
                          <div>
                            <p className="text-support font-medium text-ink">
                              {AUDIT_ACTION_LABELS[event.action] ?? event.action}
                            </p>
                            <p className="text-support text-muted">{event.reason}</p>
                            <p className="text-meta text-muted">
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
              {data.candidate ? (
                <Card as="aside">
                  <CardHeader title="Candidate" />
                  <CardBody>
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Name', value: data.candidate.fullName },
                        { term: 'Application ID', value: <code className="font-mono">{data.candidate.applicationId}</code> },
                        { term: 'Candidate ID', value: data.candidate.candidateId },
                      ]}
                    />
                    <Link
                      to={`/admin/candidates/${data.candidate.id}`}
                      className="mt-3 inline-block text-support font-medium text-brand hover:underline"
                    >
                      Open candidate record →
                    </Link>
                  </CardBody>
                </Card>
              ) : null}

              {data.attempt ? (
                <Card as="aside">
                  <CardHeader title="Attempt" />
                  <CardBody className="space-y-3">
                    <AttemptStatusPill status={data.attempt.status} />
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Started', value: formatDateTime(data.attempt.startedAt) },
                        { term: 'Answered', value: `${data.attempt.answeredCount}` },
                        { term: 'Identity status', value: data.attempt.identityStatus.toLowerCase() },
                        {
                          term: 'Consecutive failures',
                          value: <span className="tnum">{data.attempt.consecutiveMonitoringFailures}</span>,
                        },
                        { term: 'Restriction reason', value: data.attempt.restrictionReason ?? 'Not restricted' },
                      ]}
                    />
                  </CardBody>
                </Card>
              ) : null}

              {data.device ? (
                <Card as="aside">
                  <CardHeader title="Workstation" />
                  <CardBody>
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Identifier', value: <code className="font-mono">{data.device.deviceCode}</code> },
                        { term: 'Status', value: data.device.status.toLowerCase() },
                        { term: 'Camera', value: data.device.cameraStatus },
                        { term: 'Network', value: data.device.networkStatus },
                      ]}
                    />
                    <Link
                      to={`/admin/devices/${data.device.id}`}
                      className="mt-3 inline-block text-support font-medium text-brand hover:underline"
                    >
                      Open readiness report →
                    </Link>
                  </CardBody>
                </Card>
              ) : reportedDeviceCode ? (
                <Card as="aside">
                  <CardHeader title="Reported workstation" />
                  <CardBody>
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Identifier', value: <code className="font-mono">{reportedDeviceCode}</code> },
                        { term: 'Status', value: 'Not registered or not approved' },
                      ]}
                    />
                  </CardBody>
                </Card>
              ) : null}
            </div>
          </div>
        ) : null}
      </Loadable>

      <ConfirmDialog
        open={noteOpen}
        onClose={() => {
          setNoteOpen(false);
          setReason('');
        }}
        onConfirm={() => act.mutate('ADD_NOTE')}
        title="Add an incident note"
        description="Notes are permanent and appear in the audit trail."
        confirmLabel="Save note"
        loading={act.isPending}
        confirmDisabled={reason.trim().length < 5}
      >
        <Field label="Note" htmlFor="incident-note" required>
          <TextArea id="incident-note" rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={recoveryOpen}
        onClose={() => {
          setRecoveryOpen(false);
          setReason('');
        }}
        onConfirm={() => act.mutate('APPROVE_RECOVERY')}
        title="Approve recovery"
        description="The candidate resumes the same stored question sequence. Nothing is regenerated and no answer is lost."
        confirmLabel="Release the session"
        loading={act.isPending}
        confirmDisabled={reason.trim().length < 5}
      >
        <Field
          label="Reason"
          htmlFor="recovery-reason"
          required
          hint="Describe how you confirmed the candidate's identity."
        >
          <TextArea
            id="recovery-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Attended the workstation and confirmed identity against the admit card photograph."
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={workstationApprovalOpen}
        onClose={() => {
          setWorkstationApprovalOpen(false);
          setReason('');
        }}
        onConfirm={() => approveWorkstation.mutate()}
        title="Approve workstation"
        description="This creates or approves the reported workstation and resolves the incident. The reason is written to the audit trail."
        confirmLabel="Approve workstation"
        loading={approveWorkstation.isPending}
        confirmDisabled={reason.trim().length < 5}
      >
        <Field
          label="Reason"
          htmlFor="workstation-approval-reason"
          required
          hint="Describe what you checked before allowing the candidate to continue."
        >
          <TextArea
            id="workstation-approval-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Verified the physical workstation label and candidate desk assignment in person."
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
