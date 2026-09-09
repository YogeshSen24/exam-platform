import { useState } from 'react';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { CreateRecordDialog } from '@/components/domain/CreateRecordDialog';
import { NetworkRangesDialog } from '@/components/domain/NetworkRangesDialog';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, MonitorSmartphone, Network, Phone } from 'lucide-react';
import type { ExaminationCentre } from '@sep/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState, SkeletonCards } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { DescriptionList, ProgressBar } from '@/components/ui/Misc';
import { InfoPanel } from '@/components/ui/Explain';

type CentreRow = ExaminationCentre & { deviceCount: number; approvedDevices: number };

export function CentrePage() {
  const { can } = useSession(); const [creating, setCreating] = useState(false);
  const [editingNetworks, setEditingNetworks] = useState<CentreRow | null>(null);
  const query = useQuery({
    queryKey: ['centres'],
    queryFn: () => api.get<{ items: CentreRow[]; total: number }>('/centres'),
  });

  return (
    <div>
      <PageHeader
        title="Examination centres"
        actions={can('centres.write') && <Button variant="primary" onClick={() => setCreating(true)}>Add centre</Button>}
        description="Organisation-controlled premises, their approved network ranges and their registered workstations."
      />

      {creating && <CreateRecordDialog title="Add centre" endpoint="/centres" onClose={() => setCreating(false)} fields={[
        { key: 'name', label: 'Centre name' }, { key: 'code', label: 'Centre code', hint: 'Capital letters, numbers and hyphens.' },
        { key: 'city', label: 'City' }, { key: 'region', label: 'State / region' }, { key: 'address', label: 'Address' },
        { key: 'capacity', label: 'Seating capacity', type: 'number', min: 1 }, { key: 'primaryCidr', label: 'Approved network', hint: 'For example 10.42.0.0/16' },
        { key: 'contactName', label: 'Contact name' }, { key: 'contactPhone', label: 'Contact phone' },
      ]} />}
      <InfoPanel title="Why the network range matters" className="mb-6">
        Each centre declares the network ranges its examination workstations use. When an examination enables IP
        allowlisting, the service accepts examination traffic only from those ranges. It does not replace encryption or
        candidate verification.
      </InfoPanel>

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="Examination centres"
        skeleton={<SkeletonCards count={3} />}
      >
        {query.data && query.data.items.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {query.data.items.map((centre) => (
              <Card key={centre.id}>
                <CardHeader
                  icon={<Building2 aria-hidden className="h-5 w-5" />}
                  title={centre.name}
                  description={`${centre.city} · ${centre.region} region`}
                  actions={
                    <StatusPill tone={centre.status === 'ACTIVE' ? 'success' : 'neutral'} size="sm">
                      {centre.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </StatusPill>
                  }
                />
                <CardBody className="space-y-4">
                  <DescriptionList
                    columns={1}
                    items={[
                      { term: 'Centre code', value: <code className="font-mono">{centre.code}</code> },
                      { term: 'Seating capacity', value: `${centre.capacity} candidates` },
                      {
                        term: 'Primary network',
                        value: <code className="font-mono text-meta">{centre.primaryCidr}</code>,
                      },
                      {
                        term: 'Backup network',
                        value: centre.backupCidr ? (
                          <code className="font-mono text-meta">{centre.backupCidr}</code>
                        ) : (
                          <span className="text-warning">Not configured</span>
                        ),
                      },
                      {
                        term: 'IPv6 range',
                        value: centre.ipv6Cidr ? (
                          <code className="font-mono text-meta">{centre.ipv6Cidr}</code>
                        ) : (
                          'Not used'
                        ),
                      },
                      {
                        term: 'Centre contact',
                        value: (
                          <span className="flex items-center gap-2">
                            {centre.contactName}
                            <span className="flex items-center gap-1 text-meta text-muted">
                              <Phone aria-hidden className="h-3.5 w-3.5" />
                              {centre.contactPhone}
                            </span>
                          </span>
                        ),
                      },
                    ]}
                  />

                  {can('centres.write') ? (
                    <Button
                      size="sm"
                      icon={<Network aria-hidden className="h-4 w-4" />}
                      onClick={() => setEditingNetworks(centre)}
                    >
                      Edit approved networks
                    </Button>
                  ) : null}

                  <div>
                    <ProgressBar
                      label={`${centre.approvedDevices} of ${centre.deviceCount} workstations approved`}
                      value={centre.approvedDevices}
                      max={centre.deviceCount || 1}
                      tone={centre.approvedDevices === centre.deviceCount ? 'success' : 'warning'}
                      showValue={false}
                    />
                  </div>

                  <Link
                    to={`/admin/devices?centreId=${centre.id}`}
                    className="inline-flex items-center gap-1.5 text-support font-medium text-brand hover:underline"
                  >
                    <MonitorSmartphone aria-hidden className="h-4 w-4" />
                    View workstations
                  </Link>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<Building2 aria-hidden className="h-6 w-6" />}
              title="No examination centres registered"
              description="Centres define the approved premises and network ranges for delivery."
            />
          </Card>
        )}
      </Loadable>

      {editingNetworks ? (
        <NetworkRangesDialog
          title={`Approved networks for ${editingNetworks.name}`}
          description="Examinations copy these ranges when they are created. Changing them here does not change an examination that is already running - edit that on the examination itself."
          endpoint={`/centres/${editingNetworks.id}/networks`}
          ranges={editingNetworks}
          onClose={() => setEditingNetworks(null)}
        />
      ) : null}
    </div>
  );
}
