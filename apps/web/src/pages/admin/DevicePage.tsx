import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Fingerprint, MonitorSmartphone, Plus, Search, ShieldOff } from 'lucide-react';
import type { ExaminationDevice } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate, relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, SkeletonTable } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Form';
import { Loadable } from '@/components/ui/QueryState';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { useToast } from '@/components/ui/Misc';
import { PocDisclosure } from '@/components/ui/Explain';

type DeviceRow = ExaminationDevice & { centreName: string };

export function DevicePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams(); const centreId = searchParams.get('centreId') ?? '';
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useSession();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [action, setAction] = useState<{ device: DeviceRow; type: 'APPROVE' | 'REVOKE' | 'ROTATE_CERTIFICATE' } | null>(
    null,
  );
  const [reason, setReason] = useState('');

  const [draft, setDraft] = useState({
    deviceCode: '',
    name: '',
    centreId,
    operatingSystem: 'Windows 11 Enterprise 23H2',
    ipAddress: '',
    kioskPolicyVersion: '2026.01.3',
  });

  const centres = useQuery({
    queryKey: ['centres'],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/centres'),
  });

  const query = useQuery({
    queryKey: ['devices', { search, status, centreId }],
    queryFn: () => api.get<{ items: DeviceRow[]; total: number }>('/devices', { search, status, centreId, pageSize: 100 }),
  });

  const register = useMutation({
    mutationFn: () => api.post('/devices', draft),
    onSuccess: () => {
      toast.push({
        tone: 'success',
        title: 'Workstation registered',
        description: 'A device certificate was issued. It must be approved before it can run an examination.',
      });
      setRegisterOpen(false);
      setDraft({ ...draft, deviceCode: '', name: '', ipAddress: '' });
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Registration failed',
        description: error instanceof ApiError ? `${error.message} ${error.guidance}` : 'Unexpected error',
      }),
  });

  const act = useMutation({
    mutationFn: () => api.post(`/devices/${action!.device.id}/actions`, { action: action!.type, reason }),
    onSuccess: () => {
      toast.push({
        tone: action?.type === 'REVOKE' ? 'warning' : 'success',
        title:
          action?.type === 'APPROVE'
            ? 'Workstation approved'
            : action?.type === 'REVOKE'
              ? 'Workstation revoked'
              : 'Certificate rotated',
        description: 'Your reason was written to the audit trail.',
      });
      setAction(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Action failed',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      }),
  });

  const rows = query.data?.items ?? [];
  const approved = rows.filter((d) => d.status === 'APPROVED').length;
  const revoked = rows.filter((d) => d.status === 'REVOKED').length;
  const pending = rows.filter((d) => d.status === 'PENDING').length;
  const faulty = rows.filter((d) => d.cameraStatus === 'FAIL' || d.fingerprintScannerStatus === 'FAIL').length;

  const columns: Column<DeviceRow>[] = [
    {
      key: 'device',
      header: 'Workstation',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono font-medium text-ink">{row.deviceCode}</p>
          <p className="text-meta text-muted">{row.name}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusPill
          size="sm"
          tone={row.status === 'APPROVED' ? 'success' : row.status === 'PENDING' ? 'warning' : 'critical'}
        >
          {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
        </StatusPill>
      ),
    },
    { key: 'centre', header: 'Centre', hideBelow: 'lg', render: (row) => row.centreName },
    {
      key: 'certificate',
      header: 'Certificate',
      hideBelow: 'md',
      render: (row) => (
        <div>
          <StatusPill
            size="sm"
            tone={
              row.certificate.status === 'VALID'
                ? 'success'
                : row.certificate.status === 'EXPIRING'
                  ? 'warning'
                  : 'critical'
            }
          >
            {row.certificate.status.charAt(0) + row.certificate.status.slice(1).toLowerCase()}
          </StatusPill>
          <p className="mt-1 text-meta text-muted">Expires {formatDate(row.certificate.expiresAt)}</p>
        </div>
      ),
    },
    {
      key: 'peripherals',
      header: 'Peripherals',
      hideBelow: 'lg',
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusPill
            size="sm"
            tone={row.cameraStatus === 'OK' ? 'success' : row.cameraStatus === 'WARNING' ? 'warning' : 'critical'}
            icon={<Camera aria-hidden className="h-3.5 w-3.5" />}
          >
            {row.cameraStatus}
          </StatusPill>
          <StatusPill
            size="sm"
            tone={
              row.fingerprintScannerStatus === 'OK'
                ? 'success'
                : row.fingerprintScannerStatus === 'WARNING'
                  ? 'warning'
                  : 'critical'
            }
            icon={<Fingerprint aria-hidden className="h-3.5 w-3.5" />}
          >
            {row.fingerprintScannerStatus}
          </StatusPill>
        </div>
      ),
    },
    { key: 'policy', header: 'Kiosk policy', hideBelow: 'xl', render: (row) => row.kioskPolicyVersion },
    {
      key: 'health',
      header: 'Last check',
      hideBelow: 'xl',
      render: (row) => relativeTime(row.lastHealthCheckAt),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          <Link to={`/admin/devices/${row.id}`}>
            <Button size="sm" variant="ghost">
              Readiness
            </Button>
          </Link>
          {can('devices.write') && row.status === 'PENDING' ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                setAction({ device: row, type: 'APPROVE' });
              }}
            >
              Approve
            </Button>
          ) : null}
          {can('devices.revoke') && row.status === 'APPROVED' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                setAction({ device: row, type: 'REVOKE' });
              }}
            >
              Revoke
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Examination workstations"
        description="Registered machines, their device certificates, peripheral health and approval state."
        actions={
          can('devices.write') ? (
            <Button variant="primary" icon={<Plus aria-hidden className="h-4 w-4" />} onClick={() => setRegisterOpen(true)}>
              Register workstation
            </Button>
          ) : null
        }
      />

      <PocDisclosure
        className="mb-6"
        what="Secure boot, disk encryption, kiosk policy, application signature and device attestation are reported by a simulated device agent. A browser cannot inspect the operating system."
        production="a native Windows shell reporting TPM-backed attestation, verified by an attestation service"
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Approved" value={approved} tone="success" hint="Ready for delivery" />
        <StatTile label="Awaiting approval" value={pending} tone={pending > 0 ? 'warning' : 'neutral'} />
        <StatTile label="Revoked" value={revoked} tone={revoked > 0 ? 'critical' : 'neutral'} />
        <StatTile label="Peripheral faults" value={faulty} tone={faulty > 0 ? 'warning' : 'success'} />
      </div>

      <Card>
        <CardHeader
          icon={<MonitorSmartphone aria-hidden className="h-5 w-5" />}
          title={`${rows.length} workstation${rows.length === 1 ? '' : 's'}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <TextInput
                  className="w-56 pl-9"
                  placeholder="Search code or name"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search workstations"
                />
              </div>
              <Select
                className="w-44"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                <option value="APPROVED">Approved</option>
                <option value="PENDING">Awaiting approval</option>
                <option value="REVOKED">Revoked</option>
              </Select>
            </div>
          }
        />
        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="Workstations"
          skeleton={<SkeletonTable rows={8} columns={6} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/admin/devices/${row.id}`)}
            caption="Registered examination workstations"
            emptyState={
              <EmptyState
                icon={<MonitorSmartphone aria-hidden className="h-6 w-6" />}
                title="No workstations match those filters"
                description="Register a workstation, or clear the filters to see the full list."
              />
            }
          />
        </Loadable>
      </Card>

      {/* Register */}
      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="Register an examination workstation"
        description="A device certificate is issued on registration. The workstation must then be approved before it can run an examination."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRegisterOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={register.isPending}
              disabled={!draft.deviceCode || !draft.name || !draft.centreId || !draft.ipAddress}
              onClick={() => register.mutate()}
            >
              Register workstation
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Workstation identifier" htmlFor="deviceCode" required hint="Printed on the machine, e.g. WS-CEC-026.">
            <TextInput
              id="deviceCode"
              value={draft.deviceCode}
              onChange={(event) => setDraft({ ...draft, deviceCode: event.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Display name" htmlFor="deviceName" required>
            <TextInput
              id="deviceName"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label="Centre" htmlFor="deviceCentre" required>
            <Select
              id="deviceCentre"
              value={draft.centreId}
              onChange={(event) => setDraft({ ...draft, centreId: event.target.value })}
            >
              <option value="">Select a centre</option>
              {(centres.data?.items ?? []).map((centre) => (
                <option key={centre.id} value={centre.id}>
                  {centre.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Operating system" htmlFor="deviceOs" required>
            <TextInput
              id="deviceOs"
              value={draft.operatingSystem}
              onChange={(event) => setDraft({ ...draft, operatingSystem: event.target.value })}
            />
          </Field>
          <Field label="IP address" htmlFor="deviceIp" required hint="Must sit inside the centre's approved range.">
            <TextInput
              id="deviceIp"
              value={draft.ipAddress}
              placeholder="10.42.10.36"
              onChange={(event) => setDraft({ ...draft, ipAddress: event.target.value })}
            />
          </Field>
          <Field label="Kiosk policy version" htmlFor="devicePolicy" required>
            <TextInput
              id="devicePolicy"
              value={draft.kioskPolicyVersion}
              onChange={(event) => setDraft({ ...draft, kioskPolicyVersion: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      {/* Approve / revoke / rotate */}
      <ConfirmDialog
        open={Boolean(action)}
        onClose={() => {
          setAction(null);
          setReason('');
        }}
        onConfirm={() => act.mutate()}
        title={
          action?.type === 'APPROVE'
            ? `Approve ${action.device.deviceCode}`
            : action?.type === 'REVOKE'
              ? `Revoke ${action.device.deviceCode}`
              : `Rotate the certificate for ${action?.device.deviceCode}`
        }
        description={
          action?.type === 'REVOKE'
            ? 'A revoked workstation cannot start any examination. Candidates using it must be moved to an approved machine.'
            : 'This action is recorded in the audit trail with your name and reason.'
        }
        confirmLabel={action?.type === 'REVOKE' ? 'Revoke workstation' : 'Confirm'}
        tone={action?.type === 'REVOKE' ? 'critical' : 'default'}
        loading={act.isPending}
        confirmDisabled={reason.trim().length < 5}
      >
        <div className="space-y-4">
          {action?.type === 'REVOKE' ? (
            <div className="flex gap-3 rounded-card border border-critical-border bg-critical-soft px-4 py-3">
              <ShieldOff aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-critical" />
              <p className="text-support text-ink">
                Any active attempt on this workstation will need an invigilator to approve a recovery on a different
                machine. Saved answers are unaffected.
              </p>
            </div>
          ) : null}
          <Field label="Reason" htmlFor="device-reason" required hint="Written to the audit trail. At least five characters.">
            <TextArea
              id="device-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                action?.type === 'REVOKE'
                  ? 'Chassis intrusion alert raised during the maintenance window.'
                  : 'Imaged and verified against the standard build.'
              }
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
