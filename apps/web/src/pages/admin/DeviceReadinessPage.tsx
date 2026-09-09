import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, PlayCircle, Wrench, XCircle } from 'lucide-react';
import { AUDIT_ACTION_LABELS, type AuditEvent, type DeviceReadinessReport, type ExaminationCentre, type ExaminationDevice } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert, SkeletonText } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { DescriptionList, useToast } from '@/components/ui/Misc';
import { PocDisclosure } from '@/components/ui/Explain';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { Field, TextArea } from '@/components/ui/Form';

interface DeviceDetail {
  device: ExaminationDevice;
  centre: ExaminationCentre | null;
  events: AuditEvent[];
  activeSessions: number;
}

export function DeviceReadinessPage() {
  const { deviceId = '' } = useParams();
  const { can } = useSession();
  const toast = useToast();
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [reason, setReason] = useState('Camera and fingerprint scanner checked by technician; peripherals are responding.');

  const query = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => api.get<DeviceDetail>(`/devices/${deviceId}`),
  });

  const readiness = useMutation({
    mutationFn: () => api.post<{ report: DeviceReadinessReport }>(`/devices/${deviceId}/readiness`),
  });

  const remediate = useMutation({
    mutationFn: () =>
      api.post<{ device: ExaminationDevice }>(`/devices/${deviceId}/actions`, {
        action: 'REMEDIATE_PERIPHERALS',
        reason,
      }),
    onSuccess: () => {
      toast.push({
        tone: 'success',
        title: 'Remediation recorded',
        description: 'Camera and fingerprint checks will be re-run with the updated workstation health.',
      });
      setRemediationOpen(false);
      void query.refetch();
      readiness.mutate();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Remediation failed',
        description: error instanceof ApiError ? `${error.message} ${error.guidance}` : 'Unexpected error',
      }),
  });

  useEffect(() => {
    if (deviceId) readiness.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const device = query.data?.device;
  const report = readiness.data?.report;

  return (
    <div>
      <PageHeader
        title={device ? `${device.deviceCode} readiness` : 'Workstation readiness'}
        description="Nine checks a workstation must satisfy before it can be allocated to a monitored examination."
        breadcrumb={
          <Link to="/admin/devices" className="hover:text-brand hover:underline">
            ← Back to workstations
          </Link>
        }
        actions={
          <div className="flex flex-wrap gap-3">
            {can('devices.write') && device && device.status !== 'REVOKED' ? (
              <Button
                variant="secondary"
                icon={<Wrench aria-hidden className="h-4 w-4" />}
                onClick={() => setRemediationOpen(true)}
              >
                Record peripheral remediation
              </Button>
            ) : null}
            <Button
              variant="primary"
              icon={<PlayCircle aria-hidden className="h-4 w-4" />}
              loading={readiness.isPending}
              loadingText="Running checks…"
              onClick={() => readiness.mutate()}
            >
              Run readiness check
            </Button>
          </div>
        }
      />

      <PocDisclosure
        className="mb-6"
        what="Secure boot, disk encryption, kiosk policy, application signature and peripheral results are produced by a simulated device agent."
        production="a native Windows shell that reports TPM-backed attestation evidence, verified independently by an attestation service"
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="This workstation"
        skeleton={
          <Card>
            <CardBody>
              <SkeletonText lines={8} />
            </CardBody>
          </Card>
        }
      >
        {device ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              {report ? (
                report.overall === 'PASS' ? (
                  <Alert tone="success" title="This workstation is ready for examination use" live>
                    All nine checks passed. The machine can be allocated to a candidate.
                  </Alert>
                ) : report.overall === 'WARNING' ? (
                  <Alert tone="warning" title="This workstation passed with warnings" live>
                    It can be used, but the items flagged below should be resolved before the next examination.
                  </Alert>
                ) : (
                  <Alert tone="critical" title="This workstation is not ready" live>
                    One or more checks failed. Do not allocate this machine to a candidate until the failures are
                    resolved.
                  </Alert>
                )
              ) : null}

              <Card>
                <CardHeader
                  title="Readiness checks"
                  description={report ? `Generated ${formatDateTime(report.generatedAt)}` : 'Running…'}
                />
                <CardBody>
                  {readiness.isPending || !report ? (
                    <SkeletonText lines={9} />
                  ) : (
                    <ul className="divide-y divide-line">
                      {report.checks.map((check) => (
                        <li key={check.key} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                          <span className="mt-0.5 shrink-0">
                            {check.status === 'PASS' ? (
                              <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />
                            ) : check.status === 'WARNING' ? (
                              <AlertTriangle aria-hidden className="h-5 w-5 text-warning" />
                            ) : (
                              <XCircle aria-hidden className="h-5 w-5 text-critical" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-support font-medium text-ink">
                              {check.label}
                              <StatusPill
                                size="sm"
                                tone={
                                  check.status === 'PASS' ? 'success' : check.status === 'WARNING' ? 'warning' : 'critical'
                                }
                              >
                                {check.status === 'PASS' ? 'Pass' : check.status === 'WARNING' ? 'Warning' : 'Fail'}
                              </StatusPill>
                              {check.simulated ? (
                                <StatusPill size="sm" tone="neutral">
                                  Simulated
                                </StatusPill>
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-support text-muted">{check.explanation}</p>
                            <p className="mt-1 text-meta text-muted">{check.detail}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Device events" description="Registration, approval, revocation and certificate changes." />
                <CardBody>
                  {query.data && query.data.events.length > 0 ? (
                    <ol className="space-y-3">
                      {query.data.events.map((event) => (
                        <li key={event.id} className="flex gap-3">
                          <span
                            aria-hidden
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              event.result === 'BLOCKED' ? 'bg-critical' : 'bg-success'
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
                  ) : (
                    <p className="text-support text-muted">No events recorded for this workstation.</p>
                  )}
                </CardBody>
              </Card>
            </div>

            <div className="space-y-6">
              <Card as="aside">
                <CardHeader title="Workstation" description={query.data?.centre?.name ?? ''} />
                <CardBody>
                  <DescriptionList
                    columns={1}
                    items={[
                      { term: 'Identifier', value: <code className="font-mono">{device.deviceCode}</code> },
                      { term: 'Name', value: device.name },
                      {
                        term: 'Status',
                        value: (
                          <StatusPill
                            size="sm"
                            tone={
                              device.status === 'APPROVED' ? 'success' : device.status === 'PENDING' ? 'warning' : 'critical'
                            }
                          >
                            {device.status.charAt(0) + device.status.slice(1).toLowerCase()}
                          </StatusPill>
                        ),
                      },
                      { term: 'Operating system', value: device.operatingSystem },
                      { term: 'Kiosk policy', value: device.kioskPolicyVersion },
                      { term: 'IP address', value: <code className="font-mono">{device.ipAddress}</code> },
                      { term: 'Active sessions', value: `${query.data?.activeSessions ?? 0}` },
                      { term: 'Last health check', value: formatDateTime(device.lastHealthCheckAt) },
                      { term: 'Notes', value: device.notes ?? '—' },
                    ]}
                  />
                </CardBody>
              </Card>

              <Card as="aside">
                <CardHeader title="Device certificate" description="The digital identity issued to this machine." />
                <CardBody>
                  <DescriptionList
                    columns={1}
                    items={[
                      {
                        term: 'Status',
                        value: (
                          <StatusPill
                            size="sm"
                            tone={
                              device.certificate.status === 'VALID'
                                ? 'success'
                                : device.certificate.status === 'EXPIRING'
                                  ? 'warning'
                                  : 'critical'
                            }
                          >
                            {device.certificate.status.charAt(0) + device.certificate.status.slice(1).toLowerCase()}
                          </StatusPill>
                        ),
                      },
                      { term: 'Serial', value: <code className="font-mono text-meta">{device.certificate.serial}</code> },
                      { term: 'Subject', value: <code className="font-mono text-meta">{device.certificate.subject}</code> },
                      { term: 'Issuer', value: <code className="font-mono text-meta">{device.certificate.issuer}</code> },
                      { term: 'Issued', value: formatDateTime(device.certificate.issuedAt) },
                      { term: 'Expires', value: formatDateTime(device.certificate.expiresAt) },
                      {
                        term: 'Thumbprint',
                        value: <code className="font-mono text-meta">{device.certificate.thumbprint}</code>,
                      },
                    ]}
                  />
                </CardBody>
              </Card>
            </div>
          </div>
        ) : null}
      </Loadable>

      <ConfirmDialog
        open={remediationOpen}
        onClose={() => setRemediationOpen(false)}
        onConfirm={() => remediate.mutate()}
        title={device ? `Record peripheral remediation for ${device.deviceCode}` : 'Record peripheral remediation'}
        description="Confirms a technician has checked the camera and fingerprint scanner on this workstation. The camera, fingerprint and network results are marked healthy and the readiness check is re-run."
        confirmLabel="Record remediation"
        loading={remediate.isPending}
        confirmDisabled={reason.trim().length < 5}
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-card border border-line bg-panel px-4 py-3">
            <Wrench aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
            <p className="text-support text-ink">
              Peripheral results come from the simulated device agent. Only record remediation once the peripherals have
              actually been checked — this stands in for the health report a native Windows shell would send.
            </p>
          </div>
          <Field
            label="Reason"
            htmlFor="remediation-reason"
            required
            hint="Written to the audit trail. At least five characters."
          >
            <TextArea
              id="remediation-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Camera and fingerprint scanner replaced and tested by the centre technician."
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
