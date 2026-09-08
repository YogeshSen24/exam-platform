import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BellOff, Inbox } from 'lucide-react';
import type { Incident } from '@sep/shared';
import { INCIDENT_TYPE_LABELS } from '@sep/shared';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, SkeletonText } from '@/components/ui/Feedback';
import { SeverityPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';

type AlertRow = Incident & { candidateName: string | null; applicationId: string | null };

export function NotificationsPage() {
  const query = useQuery({
    queryKey: ['alerts', 'notifications'],
    queryFn: () => api.get<{ items: AlertRow[]; total: number }>('/invigilator/alerts', { pageSize: 50 }),
  });

  return (
    <div>
      <PageHeader
        title="Notification centre"
        description="Everything that needs a person's attention, newest first. Acting on an item records an audit event."
      />

      <Card>
        <CardHeader
          icon={<Inbox aria-hidden className="h-5 w-5" />}
          title="Recent notifications"
          description="Monitoring warnings, device faults and operational events across all centres."
        />
        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="Notifications"
          skeleton={
            <CardBody>
              <SkeletonText lines={6} />
            </CardBody>
          }
        >
          {query.data && query.data.items.length > 0 ? (
            <ul className="divide-y divide-line">
              {query.data.items.map((item) => (
                <li key={item.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityPill severity={item.severity} />
                        <span className="text-meta text-muted">{INCIDENT_TYPE_LABELS[item.type] ?? item.type}</span>
                      </div>
                      <p className="mt-1.5 text-support font-medium text-ink">{item.title}</p>
                      <p className="mt-0.5 max-w-prose text-support text-muted">{item.detail}</p>
                      {item.candidateName ? (
                        <p className="mt-1 text-meta text-muted">
                          {item.candidateName} · {item.applicationId}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-meta text-muted">{relativeTime(item.createdAt)}</p>
                      <Link
                        to={`/invigilator/incidents/${item.id}`}
                        className="mt-1 inline-block text-meta font-medium text-brand hover:underline"
                      >
                        Open incident →
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<BellOff aria-hidden className="h-6 w-6" />}
              title="Nothing needs your attention"
              description="Monitoring warnings, device faults and operational events will appear here as they are raised."
            />
          )}
        </Loadable>
      </Card>
    </div>
  );
}
