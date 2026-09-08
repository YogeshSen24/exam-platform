import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Filter, ShieldCheck } from 'lucide-react';
import { INCIDENT_TYPE_LABELS, type Incident, type IncidentType } from '@sep/shared';
import { api } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState, SkeletonText } from '@/components/ui/Feedback';
import { SeverityPill, StatusPill } from '@/components/ui/Status';
import { Select } from '@/components/ui/Form';
import { Loadable } from '@/components/ui/QueryState';

type AlertRow = Incident & {
  candidateName: string | null;
  applicationId: string | null;
  centreName: string | null;
  deviceCode: string | null;
};

export function AlertQueuePage() {
  const [filters, setFilters] = useState({ severity: '', status: '', type: '' });

  const query = useQuery({
    queryKey: ['alerts', filters],
    queryFn: () => api.get<{ items: AlertRow[]; total: number }>('/invigilator/alerts', { ...filters, pageSize: 100 }),
    refetchInterval: 20_000,
  });

  const rows = query.data?.items ?? [];
  const critical = rows.filter((row) => row.severity === 'CRITICAL' && row.status !== 'RESOLVED').length;
  const open = rows.filter((row) => row.status === 'OPEN').length;
  const acknowledged = rows.filter((row) => row.status === 'ACKNOWLEDGED').length;

  return (
    <div>
      <PageHeader
        title="Alert queue"
        description="Everything monitoring, device health and network policy have raised, newest first."
        meta={
          <StatusPill tone={critical > 0 ? 'critical' : 'success'} size="sm">
            {critical} critical open
          </StatusPill>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open" value={open} tone={open > 0 ? 'warning' : 'success'} icon={<BellRing aria-hidden className="h-4 w-4" />} />
        <StatTile label="Acknowledged" value={acknowledged} tone="info" />
        <StatTile label="Critical outstanding" value={critical} tone={critical > 0 ? 'critical' : 'success'} />
        <StatTile
          label="Total in view"
          value={rows.length}
          icon={<ShieldCheck aria-hidden className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader
          icon={<Filter aria-hidden className="h-5 w-5" />}
          title="Alerts"
          description="Filter by severity, status or event type."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-40"
                value={filters.severity}
                onChange={(event) => setFilters({ ...filters, severity: event.target.value })}
                aria-label="Filter by severity"
              >
                <option value="">All severities</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARNING">Warning</option>
                <option value="INFO">Information</option>
              </Select>
              <Select
                className="w-40"
                value={filters.status}
                onChange={(event) => setFilters({ ...filters, status: event.target.value })}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="RESOLVED">Resolved</option>
              </Select>
              <Select
                className="w-56"
                value={filters.type}
                onChange={(event) => setFilters({ ...filters, type: event.target.value })}
                aria-label="Filter by event type"
              >
                <option value="">All event types</option>
                {Object.entries(INCIDENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />

        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="The alert queue"
          skeleton={
            <CardBody>
              <SkeletonText lines={8} />
            </CardBody>
          }
        >
          {rows.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck aria-hidden className="h-6 w-6" />}
              title="Nothing in the queue"
              description="Alerts from presence monitoring, device health, network policy and the operations console appear here."
              action={
                Object.values(filters).some(Boolean) ? (
                  <Button variant="secondary" onClick={() => setFilters({ severity: '', status: '', type: '' })}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityPill severity={row.severity} />
                        <StatusPill
                          size="sm"
                          tone={row.status === 'OPEN' ? 'warning' : row.status === 'ACKNOWLEDGED' ? 'info' : 'success'}
                        >
                          {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                        </StatusPill>
                        <span className="text-meta text-muted">
                          {INCIDENT_TYPE_LABELS[row.type as IncidentType] ?? row.type}
                        </span>
                      </div>
                      <p className="mt-2 text-support font-semibold text-ink">{row.title}</p>
                      <p className="mt-0.5 max-w-prose text-support text-muted">{row.detail}</p>
                      <p className="mt-1.5 text-meta text-muted">
                        {[
                          row.candidateName ? `${row.candidateName} (${row.applicationId})` : null,
                          row.deviceCode,
                          row.centreName,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-meta text-muted">{relativeTime(row.createdAt)}</p>
                      <p className="text-meta text-muted">{formatDateTime(row.createdAt)}</p>
                      <div className="mt-2 flex flex-col items-end gap-1">
                        <Link
                          to={`/invigilator/incidents/${row.id}`}
                          className="text-meta font-medium text-brand hover:underline"
                        >
                          Open incident →
                        </Link>
                        {row.attemptId ? (
                          <Link
                            to={`/invigilator/sessions/${row.attemptId}`}
                            className="text-meta font-medium text-brand hover:underline"
                          >
                            Open session →
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Loadable>
      </Card>
    </div>
  );
}
