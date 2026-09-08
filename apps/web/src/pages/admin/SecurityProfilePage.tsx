import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { GLOSSARY, type SecurityControl, type SecurityProfile } from '@sep/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { SkeletonCards } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { Tabs } from '@/components/ui/Misc';
import { InfoPanel } from '@/components/ui/Explain';
import { SecurityControlList } from '@/components/domain/SecurityControlList';

interface ProfilesResponse {
  profiles: (SecurityProfile & { effectiveControls: SecurityControl[] })[];
  recommended: string;
  recommendationReason: string;
}

interface DisclosureResponse {
  title: string;
  statement: string;
  capabilities: { capability: string; poc: string; production: string }[];
}

export function SecurityProfilePage() {
  const [tab, setTab] = useState('profiles');

  const query = useQuery({
    queryKey: ['security-profiles'],
    queryFn: () => api.get<ProfilesResponse>('/security-profiles'),
  });

  const disclosure = useQuery({
    queryKey: ['poc-disclosure'],
    queryFn: () => api.get<DisclosureResponse>('/poc-disclosure'),
  });

  return (
    <div>
      <PageHeader
        title="Security profiles"
        description="Named assurance levels an administrator can choose. The platform selects the cryptographic mechanisms — nobody picks raw algorithms."
      />

      <Tabs
        className="mb-6"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'profiles', label: 'Assurance levels', count: query.data?.profiles.length },
          { id: 'glossary', label: 'Plain-language glossary' },
          { id: 'disclosure', label: 'POC versus production' },
        ]}
      />

      {tab === 'profiles' ? (
        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="Security profiles"
          skeleton={<SkeletonCards count={4} />}
        >
          {query.data ? (
            <div className="space-y-6">
              <InfoPanel title={`Recommended: ${query.data.profiles.find((p) => p.id === query.data.recommended)?.name}`}>
                {query.data.recommendationReason}
              </InfoPanel>

              <div className="grid gap-6 lg:grid-cols-2">
                {query.data.profiles.map((profile) => (
                  <Card key={profile.id}>
                    <CardHeader
                      icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
                      title={profile.name}
                      description={profile.tagline}
                      actions={
                        profile.id === query.data.recommended ? (
                          <StatusPill tone="brand" size="sm">
                            Recommended
                          </StatusPill>
                        ) : null
                      }
                    />
                    <CardBody className="space-y-4">
                      <p className="text-support text-muted">{profile.summary}</p>
                      <div className="rounded-card border border-line bg-page px-4 py-3">
                        <p className="text-meta font-medium uppercase tracking-wide text-muted">Recommended for</p>
                        <p className="mt-1 text-support text-ink">{profile.recommendedFor}</p>
                      </div>
                      <div>
                        <p className="mb-3 text-support font-medium text-ink">
                          {profile.effectiveControls.length} effective controls
                          {profile.inherits ? ' (including inherited)' : ''}
                        </p>
                        <SecurityControlList controls={profile.effectiveControls} compact />
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}
        </Loadable>
      ) : null}

      {tab === 'glossary' ? (
        <Card>
          <CardHeader
            title="Plain-language glossary"
            description="Every technical term the interface uses, explained without jargon, with an honest note on what this proof of concept actually does."
          />
          <CardBody>
            <dl className="grid gap-5 md:grid-cols-2">
              {Object.entries(GLOSSARY).map(([key, entry]) => (
                <div key={key} className="rounded-card border border-line bg-page p-4">
                  <dt className="flex flex-wrap items-center gap-2 text-support font-semibold text-ink">
                    {entry.term}
                    <StatusPill
                      size="sm"
                      tone={
                        entry.pocStatus === 'implemented'
                          ? 'success'
                          : entry.pocStatus === 'partial'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {entry.pocStatus === 'implemented'
                        ? 'Implemented'
                        : entry.pocStatus === 'partial'
                          ? 'Partly implemented'
                          : 'Simulated'}
                    </StatusPill>
                  </dt>
                  <dd className="mt-1.5 text-support text-ink">{entry.short}</dd>
                  <dd className="mt-1.5 text-support text-muted">{entry.long}</dd>
                  {entry.pocNote ? <dd className="mt-2 text-meta text-muted">{entry.pocNote}</dd> : null}
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'disclosure' ? (
        <Loadable
          isLoading={disclosure.isLoading}
          error={disclosure.error}
          onRetry={() => void disclosure.refetch()}
          context="The POC disclosure"
          skeleton={<SkeletonCards count={2} />}
        >
          {disclosure.data ? (
            <Card>
              <CardHeader title={disclosure.data.title} description={disclosure.data.statement} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-page">
                      {['Capability', 'This proof of concept', 'Production requirement'].map((header) => (
                        <th
                          key={header}
                          scope="col"
                          className="px-6 py-3 text-meta font-semibold uppercase tracking-wide text-muted"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {disclosure.data.capabilities.map((row) => (
                      <tr key={row.capability} className="border-b border-line last:border-0">
                        <td className="px-6 py-4 align-top text-support font-medium text-ink">{row.capability}</td>
                        <td className="px-6 py-4 align-top text-support text-muted">{row.poc}</td>
                        <td className="px-6 py-4 align-top text-support text-muted">{row.production}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </Loadable>
      ) : null}
    </div>
  );
}
