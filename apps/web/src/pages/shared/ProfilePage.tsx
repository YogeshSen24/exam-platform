import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DescriptionList, Avatar } from '@/components/ui/Misc';
import { StatusPill } from '@/components/ui/Status';

export function ProfilePage() {
  const { user, expiresAt } = useSession();

  const disclosure = useQuery({
    queryKey: ['poc-disclosure'],
    queryFn: () => api.get<{ environment: { keyProvider: { displayName: string }; demoModeEnabled: boolean } }>('/poc-disclosure'),
  });

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="Your profile"
        description="Your roles decide what you can see and do. Every permission is enforced by the examination service on each request."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Account" description="Details held for your examination board account." />
          <CardBody>
            <div className="mb-6 flex items-center gap-4">
              <Avatar name={user.fullName} size="lg" />
              <div>
                <p className="text-card font-semibold text-ink">{user.fullName}</p>
                <p className="text-support text-muted">{user.email}</p>
              </div>
            </div>
            <DescriptionList
              items={[
                { term: 'Roles', value: user.roles.map((role) => ROLE_LABELS[role]).join(', ') },
                { term: 'Account type', value: user.kind === 'STAFF' ? 'Staff' : 'Candidate' },
                { term: 'Assigned centre', value: user.centreId ?? 'All centres' },
                { term: 'Session expires', value: formatDateTime(expiresAt) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
            title="Environment"
            description="What this build is running with."
          />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                {
                  term: 'Key provider',
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      {disclosure.data?.environment.keyProvider.displayName ?? '—'}
                      <StatusPill tone="warning" size="sm">
                        Simulated
                      </StatusPill>
                    </span>
                  ),
                },
                {
                  term: 'Demo mode',
                  value: disclosure.data?.environment.demoModeEnabled ? 'Enabled (development)' : 'Disabled',
                },
                { term: 'Build', value: 'Proof of concept 0.1.0' },
              ]}
            />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="What your roles allow"
            description="These are the permissions the examination service grants to your roles."
          />
          <CardBody className="space-y-6">
            {user.roles.map((role) => (
              <div key={role}>
                <p className="text-support font-semibold text-ink">{ROLE_LABELS[role]}</p>
                <p className="mt-1 max-w-prose text-support text-muted">{ROLE_DESCRIPTIONS[role]}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {ROLE_PERMISSIONS[role].map((permission) => (
                    <li key={permission}>
                      <StatusPill tone="neutral" size="sm" icon={<CheckCircle2 aria-hidden className="h-3.5 w-3.5" />}>
                        <code className="font-mono">{permission}</code>
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
