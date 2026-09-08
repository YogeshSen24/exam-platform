import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Eye, FileX2, Scale, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState, SkeletonCards } from '@/components/ui/Feedback';
import { Loadable } from '@/components/ui/QueryState';
import { StatusPill } from '@/components/ui/Status';
import { InfoPanel } from '@/components/ui/Explain';

interface EvidenceSummary {
  purpose: string;
  collected: string[];
  notCollected: string[];
  objectCount: number;
  totalBytes: number;
  nextScheduledDeletion: string | null;
  authorisedReviewerRoles: string[];
  accessHistory: { userId: string; userName: string; at: string; reason: string; objectKey: string }[];
  appealProcess: string;
  modelTrainingUse: string;
  publicUrls: string;
}

export function PrivacyPage() {
  const query = useQuery({
    queryKey: ['evidence-summary'],
    queryFn: () => api.get<EvidenceSummary>('/evidence/summary'),
  });

  const data = query.data;

  return (
    <div>
      <PageHeader
        title="Privacy and evidence management"
        description="What monitoring collects, why, who can see it, how long it is kept and how a candidate can challenge a decision."
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="The evidence summary"
        skeleton={<SkeletonCards count={4} />}
      >
        {data ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Evidence objects held" value={formatNumber(data.objectCount)} icon={<Eye aria-hidden className="h-4 w-4" />} />
              <StatTile label="Storage used" value={formatBytes(data.totalBytes)} />
              <StatTile
                label="Next scheduled deletion"
                value={data.nextScheduledDeletion ? formatDateTime(data.nextScheduledDeletion) : 'None due'}
                tone="info"
                icon={<CalendarClock aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Public URLs"
                value="None"
                tone="success"
                hint="Evidence is never reachable publicly"
                icon={<ShieldCheck aria-hidden className="h-4 w-4" />}
              />
            </div>

            <Card>
              <CardHeader
                icon={<Scale aria-hidden className="h-5 w-5" />}
                title="Purpose of monitoring"
                description="Monitoring is only lawful and proportionate if it has a stated purpose and collects nothing beyond it."
              />
              <CardBody className="space-y-5">
                <p className="max-w-prose text-body text-ink">{data.purpose}</p>

                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <p className="text-support font-semibold text-ink">What is collected</p>
                    <ul className="mt-2 space-y-2">
                      {data.collected.map((item) => (
                        <li key={item} className="flex gap-2 text-support text-muted">
                          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="flex items-center gap-2 text-support font-semibold text-ink">
                      <FileX2 aria-hidden className="h-4 w-4 text-muted" />
                      What is never collected
                    </p>
                    <ul className="mt-2 space-y-2">
                      {data.notCollected.map((item) => (
                        <li key={item} className="flex gap-2 text-support text-muted">
                          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <InfoPanel title="No sensitive attribute inference">
                  This platform does not infer race, emotion, age, gender, health or any other sensitive attribute from
                  a camera capture. Presence checking answers one question only: is the registered candidate present and
                  alone at this workstation?
                </InfoPanel>
              </CardBody>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader
                  icon={<Eye aria-hidden className="h-5 w-5" />}
                  title="Who may review evidence"
                  description="Access is restricted by role and every access is logged."
                />
                <CardBody className="space-y-4">
                  <ul className="flex flex-wrap gap-2">
                    {data.authorisedReviewerRoles.map((role) => (
                      <li key={role}>
                        <StatusPill tone="info" size="sm">
                          {role.replace(/_/g, ' ').toLowerCase()}
                        </StatusPill>
                      </li>
                    ))}
                  </ul>

                  <div>
                    <p className="text-support font-semibold text-ink">Evidence access history</p>
                    {data.accessHistory.length === 0 ? (
                      <p className="mt-2 text-support text-muted">
                        No evidence object has been opened by a reviewer. Any access is recorded here with the
                        reviewer’s name, the time and their stated reason.
                      </p>
                    ) : (
                      <ul className="mt-2 divide-y divide-line">
                        {data.accessHistory.map((entry, index) => (
                          <li key={index} className="py-2.5">
                            <p className="text-support text-ink">{entry.userName}</p>
                            <p className="text-meta text-muted">
                              {formatDateTime(entry.at)} · {entry.reason}
                            </p>
                            <code className="font-mono text-meta text-muted">{entry.objectKey}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  icon={<Trash2 aria-hidden className="h-5 w-5" />}
                  title="Retention and deletion"
                  description="Evidence is kept only as long as the stated purpose requires."
                />
                <CardBody className="space-y-4">
                  <p className="text-support text-muted">
                    Each capture carries a deletion date derived from the examination’s retention policy. When that date
                    passes the object is deleted automatically; nobody has to remember to do it.
                  </p>
                  <div className="rounded-card border border-line bg-page px-4 py-3">
                    <p className="text-meta font-medium uppercase tracking-wide text-muted">Next scheduled deletion</p>
                    <p className="mt-1 text-support text-ink">
                      {data.nextScheduledDeletion ? formatDateTime(data.nextScheduledDeletion) : 'Nothing is currently due for deletion.'}
                    </p>
                  </div>
                  <div className="rounded-card border border-line bg-page px-4 py-3">
                    <p className="text-meta font-medium uppercase tracking-wide text-muted">Use in model training</p>
                    <p className="mt-1 text-support text-ink">{data.modelTrainingUse}</p>
                  </div>
                  <div className="rounded-card border border-line bg-page px-4 py-3">
                    <p className="text-meta font-medium uppercase tracking-wide text-muted">Public exposure</p>
                    <p className="mt-1 text-support text-ink">{data.publicUrls}</p>
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader
                icon={<Scale aria-hidden className="h-5 w-5" />}
                title="Candidate notice and appeal"
                description="What a candidate is told, and what they can do if they disagree with a monitoring decision."
              />
              <CardBody className="space-y-4">
                <div className="rounded-card border border-line bg-page px-4 py-3">
                  <p className="text-meta font-medium uppercase tracking-wide text-muted">Appeal process</p>
                  <p className="mt-1 max-w-prose text-support text-ink">{data.appealProcess}</p>
                </div>
                <InfoPanel title="Software never ends an examination on its own">
                  A monitoring warning can pause navigation, but only a person can restrict, release or terminate a
                  session. Every such decision requires a reason and is written to the audit trail, so a candidate can
                  see exactly who decided what and why.
                </InfoPanel>
              </CardBody>
            </Card>
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<Eye aria-hidden className="h-6 w-6" />}
              title="No evidence policy available"
              description="Evidence management appears once a monitored examination has run."
            />
          </Card>
        )}
      </Loadable>
    </div>
  );
}
