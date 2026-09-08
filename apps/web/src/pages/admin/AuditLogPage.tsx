import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Link2, Lock, Printer, ScrollText, ShieldCheck, ShieldX } from 'lucide-react';
import { AUDIT_ACTION_LABELS, type AuditEvent } from '@sep/shared';
import { api } from '@/lib/api';
import { formatDateTime, shortHash } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { Alert, EmptyState, SkeletonTable } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Select, TextInput } from '@/components/ui/Form';
import { Pagination } from '@/components/ui/DataTable';
import { Loadable } from '@/components/ui/QueryState';
import { Explain, HashValue } from '@/components/ui/Explain';
import { Drawer } from '@/components/ui/Overlay';
import { DescriptionList } from '@/components/ui/Misc';

interface AuditResponse {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  chain: { intact: boolean; checkedEvents: number; brokenAtSequence: number | null; message: string };
  immutabilityNote: string;
}

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', action: '', result: '' });
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const query = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () => api.get<AuditResponse>('/audit-events', { ...filters, page, pageSize: 25 }),
    refetchInterval: 30_000,
  });

  const data = query.data;

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="An append-only history of every significant action. Entries cannot be edited or deleted through any part of this application."
        actions={
          <Button variant="secondary" icon={<Printer aria-hidden className="h-4 w-4" />} onClick={() => window.print()}>
            Print report
          </Button>
        }
      />

      {data ? (
        data.chain.intact ? (
          <Alert
            tone="success"
            className="mb-6"
            title="The audit chain is intact"
            icon={<ShieldCheck aria-hidden className="h-5 w-5 text-success" />}
          >
            {data.chain.message} Each entry carries the fingerprint of the entry before it, so removing or altering any
            record would break every link that follows.
          </Alert>
        ) : (
          <Alert
            tone="critical"
            className="mb-6"
            live
            title="The audit chain is broken"
            icon={<ShieldX aria-hidden className="h-5 w-5 text-critical" />}
          >
            {data.chain.message} Treat every record after this point as unverified and escalate to the examination
            controller immediately.
          </Alert>
        )
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Recorded events" value={data?.total ?? '—'} icon={<ScrollText aria-hidden className="h-4 w-4" />} />
        <StatTile
          label="Chain verification"
          value={data?.chain.intact ? 'Intact' : 'Broken'}
          tone={data?.chain.intact ? 'success' : 'critical'}
          icon={<Link2 aria-hidden className="h-4 w-4" />}
        />
        <StatTile
          label="Events verified"
          value={data?.chain.checkedEvents ?? '—'}
          icon={<KeyRound aria-hidden className="h-4 w-4" />}
        />
        <StatTile
          label="Editable through this app"
          value="None"
          tone="success"
          hint="No update or delete route exists"
          icon={<Lock aria-hidden className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader
          title="Audit events"
          description="Newest first. Select any row to see its full record, including the hash chain."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                className="w-56"
                placeholder="Search actor, target or reason"
                value={filters.search}
                onChange={(event) => {
                  setFilters({ ...filters, search: event.target.value });
                  setPage(1);
                }}
                aria-label="Search audit events"
              />
              <Select
                className="w-52"
                value={filters.action}
                onChange={(event) => {
                  setFilters({ ...filters, action: event.target.value });
                  setPage(1);
                }}
                aria-label="Filter by action"
              >
                <option value="">All actions</option>
                {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                className="w-36"
                value={filters.result}
                onChange={(event) => {
                  setFilters({ ...filters, result: event.target.value });
                  setPage(1);
                }}
                aria-label="Filter by result"
              >
                <option value="">All results</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILURE">Failure</option>
                <option value="BLOCKED">Blocked</option>
              </Select>
            </div>
          }
        />

        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="The audit log"
          skeleton={<SkeletonTable rows={10} columns={6} />}
        >
          <>
            {data && data.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] border-collapse text-left">
                  <caption className="sr-only">Audit events</caption>
                  <thead>
                    <tr className="border-b border-line bg-page">
                      {['#', 'Time', 'Actor', 'Action', 'Target', 'Result', 'Chain'].map((header) => (
                        <th
                          key={header}
                          scope="col"
                          className="px-4 py-3 text-meta font-semibold uppercase tracking-wide text-muted"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((event) => (
                      <tr
                        key={event.id}
                        tabIndex={0}
                        onClick={() => setSelected(event)}
                        onKeyDown={(keyEvent) => {
                          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                            keyEvent.preventDefault();
                            setSelected(event);
                          }
                        }}
                        className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-page focus:bg-brand-50 focus:outline-none"
                      >
                        <td className="tnum px-4 py-3 text-meta text-muted">{event.sequence}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-support text-muted">
                          {formatDateTime(event.timestamp)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-support font-medium text-ink">{event.actorName}</p>
                          <p className="text-meta text-muted">{event.actorRole.replace(/_/g, ' ').toLowerCase()}</p>
                        </td>
                        <td className="px-4 py-3 text-support text-ink">
                          {AUDIT_ACTION_LABELS[event.action] ?? event.action}
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          <p className="truncate text-support text-ink">{event.targetLabel}</p>
                          <p className="truncate text-meta text-muted">{event.reason}</p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            size="sm"
                            tone={
                              event.result === 'SUCCESS' ? 'success' : event.result === 'BLOCKED' ? 'critical' : 'warning'
                            }
                          >
                            {event.result.charAt(0) + event.result.slice(1).toLowerCase()}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3">
                          <code className="font-mono text-meta text-muted">{shortHash(event.hash, 5)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<ScrollText aria-hidden className="h-6 w-6" />}
                title="No audit events match those filters"
                description="Clear the filters to see the full history."
                action={
                  <Button variant="secondary" onClick={() => setFilters({ search: '', action: '', result: '' })}>
                    Clear filters
                  </Button>
                }
              />
            )}

            {data && data.total > data.pageSize ? (
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={setPage}
                label="events"
              />
            ) : null}
          </>
        </Loadable>

        {data ? (
          <CardBody className="border-t border-line bg-page">
            <p className="text-support text-muted">
              <Explain term="immutableAudit">
                <strong className="font-semibold text-ink">Immutable audit log</strong>
              </Explain>{' '}
              — {data.immutabilityNote}
            </p>
          </CardBody>
        ) : null}
      </Card>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? (AUDIT_ACTION_LABELS[selected.action] ?? selected.action) : ''}
        description={selected ? `Event ${selected.sequence}` : undefined}
      >
        {selected ? (
          <div className="space-y-6">
            <DescriptionList
              columns={1}
              items={[
                { term: 'Event ID', value: <code className="font-mono text-meta">{selected.id}</code> },
                { term: 'Sequence', value: <span className="tnum">{selected.sequence}</span> },
                { term: 'Timestamp', value: formatDateTime(selected.timestamp) },
                { term: 'Actor', value: `${selected.actorName} (${selected.actorId})` },
                { term: 'Role', value: selected.actorRole.replace(/_/g, ' ').toLowerCase() },
                { term: 'Action', value: AUDIT_ACTION_LABELS[selected.action] ?? selected.action },
                { term: 'Target', value: `${selected.targetType} — ${selected.targetLabel}` },
                { term: 'Target ID', value: <code className="font-mono text-meta">{selected.targetId}</code> },
                {
                  term: 'Result',
                  value: (
                    <StatusPill
                      size="sm"
                      tone={
                        selected.result === 'SUCCESS' ? 'success' : selected.result === 'BLOCKED' ? 'critical' : 'warning'
                      }
                    >
                      {selected.result}
                    </StatusPill>
                  ),
                },
                { term: 'Reason', value: selected.reason },
                { term: 'Device', value: selected.deviceId ?? '—' },
                { term: 'Network address', value: <code className="font-mono text-meta">{selected.ipAddress}</code> },
                { term: 'Trace ID', value: <code className="font-mono text-meta">{selected.traceId}</code> },
              ]}
            />

            <div className="rounded-card border border-line bg-page p-4">
              <p className="text-support font-semibold text-ink">Hash chain</p>
              <p className="mt-1 text-meta text-muted">
                This entry’s fingerprint is calculated from its own content plus the fingerprint of the entry before it.
              </p>
              <div className="mt-3 space-y-3">
                <HashValue value={selected.previousHash} label="Previous entry" full />
                <HashValue value={selected.hash} label="This entry" full />
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
