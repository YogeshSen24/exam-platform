import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Database, HardDrive, KeyRound, Server, ShieldAlert, Siren, Zap } from 'lucide-react';
import type { SecuritySimulationResult, SystemHealth } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { Alert, SkeletonCards } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Loadable, ServerDegraded } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Misc';
import { PocDisclosure } from '@/components/ui/Explain';

interface HealthResponse {
  health: SystemHealth;
  keyProvider: { displayName: string; productionReady: boolean; warning: string | null };
  simulations: SecuritySimulationResult[];
  explanations: Record<string, string>;
}

const SCENARIOS = [
  { id: 'LOGIN_BURST', label: 'Login burst', description: 'Credential stuffing against candidate sign-in' },
  { id: 'DDOS_TRAFFIC', label: 'DDoS traffic', description: 'Volumetric flood aimed at the examination endpoint' },
  { id: 'SQL_INJECTION_ATTEMPT', label: 'SQL injection', description: 'Malicious payload in a search parameter' },
  { id: 'INVALID_EXAM_TOKEN', label: 'Invalid exam token', description: 'Forged session cookie at activation' },
  { id: 'MODIFIED_QUESTION_ENVELOPE', label: 'Modified question', description: 'Stored question changed after approval' },
  { id: 'REPLAYED_ANSWER_REQUEST', label: 'Replayed answer', description: 'Duplicate idempotency key' },
  { id: 'REVOKED_DEVICE', label: 'Revoked device', description: 'Revoked workstation attempts to start' },
  { id: 'DATABASE_SLOWDOWN', label: 'Database slowdown', description: 'Query latency spike across the pool' },
  { id: 'REDIS_UNAVAILABLE', label: 'Cache unavailable', description: 'Session cache health probe fails' },
  { id: 'INSTANCE_FAILURE', label: 'Instance failure', description: 'One application instance stops responding' },
] as const;

export function SystemHealthPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useSession();

  const query = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.get<HealthResponse>('/system-health'),
    refetchInterval: 15_000,
  });

  const simulate = useMutation({
    mutationFn: (scenario: string) =>
      api.post<{ result: SecuritySimulationResult; disclaimer: string }>('/demo-scenarios', { scenario }),
    onSuccess: (data) => {
      toast.push({
        tone: data.result.severity === 'CRITICAL' ? 'critical' : 'warning',
        title: data.result.title,
        description: data.result.controlActivated,
      });
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Scenario could not run',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      }),
  });

  const health = query.data?.health;
  const series = (health?.series ?? []).map((point) => ({
    time: new Date(point.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    requests: point.requestsPerMinute,
    answers: point.answerWrites,
    p95: point.p95,
  }));

  return (
    <div>
      <PageHeader
        title="Security operations"
        description="Service health, protective controls and a simulator that demonstrates how incidents are detected and handled."
        actions={
          <Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        }
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="System health"
        skeleton={<SkeletonCards count={4} />}
      >
        {health ? (
          <div className="space-y-6">
            {health.degraded && health.degradedReason ? <ServerDegraded reason={health.degradedReason} /> : null}

            {/* Service status */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <ServiceTile
                label="API"
                status={health.api.status}
                detail={`Up ${Math.floor(health.api.uptimeSeconds / 60)} min · v${health.api.version}`}
                icon={<Server aria-hidden className="h-4 w-4" />}
              />
              <ServiceTile
                label="Database"
                status={health.database.status}
                detail={`${health.database.latencyMs} ms · ${health.database.label}`}
                icon={<Database aria-hidden className="h-4 w-4" />}
              />
              <ServiceTile
                label="Session cache"
                status={health.redis.status}
                detail={health.redis.label}
                icon={<Zap aria-hidden className="h-4 w-4" />}
              />
              <ServiceTile
                label="Evidence storage"
                status={health.evidenceStorage.status}
                detail={
                  health.evidenceStorage.queuedObjects > 0
                    ? `${health.evidenceStorage.queuedObjects} objects queued`
                    : health.evidenceStorage.label
                }
                icon={<HardDrive aria-hidden className="h-4 w-4" />}
              />
              <ServiceTile
                label="Key service"
                status={health.keyService.status}
                detail={health.keyService.label}
                simulated
                icon={<KeyRound aria-hidden className="h-4 w-4" />}
              />
            </div>

            {/* Throughput */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Active sessions"
                value={formatNumber(health.activeSessions)}
                hint="Candidates currently in an examination"
                tone="info"
                icon={<Activity aria-hidden className="h-4 w-4" />}
              />
              <StatTile label="Requests per minute" value={formatNumber(health.requestsPerMinute)} />
              <StatTile label="Answer writes per minute" value={formatNumber(health.answerWritesPerMinute)} />
              <StatTile
                label="p95 response time"
                value={`${health.p95ResponseTimeMs} ms`}
                hint={query.data?.explanations.p95ResponseTimeMs}
                tone={health.p95ResponseTimeMs > 400 ? 'warning' : 'success'}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Request and answer throughput" description="Last 30 minutes." />
                <CardBody>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                        <defs>
                          <linearGradient id="requestsFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#176BFF" stopOpacity={0.28} />
                            <stop offset="100%" stopColor="#176BFF" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="answersFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#61C8F4" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#61C8F4" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#D1D9E2" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="time" tick={{ fill: '#52606D', fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#D1D9E2' }} minTickGap={28} />
                        <YAxis tick={{ fill: '#52606D', fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            border: '1px solid #D1D9E2',
                            boxShadow: '0 8px 20px rgba(7,17,31,0.08)',
                            fontSize: 13,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="requests"
                          name="Requests / min"
                          stroke="#176BFF"
                          fill="url(#requestsFill)"
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="answers"
                          name="Answer writes / min"
                          stroke="#61C8F4"
                          fill="url(#answersFill)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Response time (p95)" description="The time within which 95 of every 100 requests complete." />
                <CardBody>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                        <CartesianGrid stroke="#D1D9E2" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="time" tick={{ fill: '#52606D', fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#D1D9E2' }} minTickGap={28} />
                        <YAxis unit=" ms" tick={{ fill: '#52606D', fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            border: '1px solid #D1D9E2',
                            boxShadow: '0 8px 20px rgba(7,17,31,0.08)',
                            fontSize: 13,
                          }}
                        />
                        <Line type="monotone" dataKey="p95" name="p95 (ms)" stroke="#0A2342" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Protective controls */}
            <Card>
              <CardHeader
                icon={<ShieldAlert aria-hidden className="h-5 w-5" />}
                title="Protective controls"
                description="What has been filtered, throttled or refused, in plain language."
              />
              <CardBody className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  {
                    label: 'Requests blocked at the edge',
                    value: health.wafBlockedRequests,
                    explanation: query.data?.explanations.wafBlockedRequests,
                    tone: 'warning' as const,
                  },
                  {
                    label: 'Requests rate limited',
                    value: health.rateLimitedRequests,
                    explanation: query.data?.explanations.rateLimitedRequests,
                    tone: 'warning' as const,
                  },
                  {
                    label: 'Failed sign-ins',
                    value: health.failedLogins,
                    explanation: 'Repeated failures place the account under a temporary lockout.',
                    tone: 'neutral' as const,
                  },
                  {
                    label: 'Revoked devices',
                    value: health.revokedDevices,
                    explanation: 'Revoked workstations are refused before eligibility is even evaluated.',
                    tone: 'critical' as const,
                  },
                  {
                    label: 'Unusual key operations',
                    value: health.unusualCryptoOperations,
                    explanation: query.data?.explanations.unusualCryptoOperations,
                    tone: 'critical' as const,
                  },
                  {
                    label: 'Active examination sessions',
                    value: health.activeSessions,
                    explanation: 'Candidates currently working, across all centres.',
                    tone: 'info' as const,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-card border border-line bg-page px-4 py-3.5">
                    <p className="text-meta font-medium uppercase tracking-wide text-muted">{item.label}</p>
                    <p
                      className={`tnum mt-1 text-section font-semibold ${
                        item.value > 0 && item.tone === 'critical'
                          ? 'text-critical'
                          : item.value > 0 && item.tone === 'warning'
                            ? 'text-warning'
                            : 'text-ink'
                      }`}
                    >
                      {formatNumber(item.value)}
                    </p>
                    <p className="mt-1 text-meta text-muted">{item.explanation}</p>
                  </div>
                ))}
              </CardBody>
            </Card>

            {/* Simulator */}
            {can('system.health.read') ? (
              <Card>
                <CardHeader
                  icon={<Siren aria-hidden className="h-5 w-5" />}
                  title="Incident simulator"
                  description="Creates synthetic monitoring events so the detection, control, impact and recovery story can be shown. No attack traffic is generated."
                />
                <CardBody className="space-y-5">
                  <Alert tone="info" title="Nothing here executes a real attack">
                    Each scenario writes an audit event and updates the monitoring counters. The modified-question
                    scenario is the exception in one respect: it genuinely alters a stored question so you can watch the
                    integrity check fail and block release — exactly as it would in production.
                  </Alert>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {SCENARIOS.map((scenario) => (
                      <button
                        key={scenario.id}
                        type="button"
                        disabled={simulate.isPending}
                        onClick={() => simulate.mutate(scenario.id)}
                        className="rounded-card border border-line bg-white px-4 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
                      >
                        <p className="text-support font-medium text-ink">{scenario.label}</p>
                        <p className="mt-0.5 text-meta text-muted">{scenario.description}</p>
                      </button>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {/* Simulation history */}
            {query.data && query.data.simulations.length > 0 ? (
              <Card>
                <CardHeader title="Recent simulated incidents" description="Detection, control activated, user impact and recovery." />
                <CardBody>
                  <ul className="space-y-4">
                    {query.data.simulations.map((simulation) => (
                      <li key={simulation.id} className="rounded-card border border-line bg-page p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-support font-semibold text-ink">{simulation.title}</p>
                            <p className="mt-0.5 text-meta text-muted">
                              {relativeTime(simulation.startedAt)} · {formatDateTime(simulation.startedAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill
                              size="sm"
                              tone={
                                simulation.severity === 'CRITICAL'
                                  ? 'critical'
                                  : simulation.severity === 'WARNING'
                                    ? 'warning'
                                    : 'info'
                              }
                            >
                              {simulation.severity.charAt(0) + simulation.severity.slice(1).toLowerCase()}
                            </StatusPill>
                            <StatusPill size="sm" tone="neutral">
                              Simulated
                            </StatusPill>
                          </div>
                        </div>
                        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                          {[
                            { term: 'Detection', value: simulation.detection },
                            { term: 'Control activated', value: simulation.controlActivated },
                            { term: 'User impact', value: simulation.userImpact },
                            { term: 'Recovery', value: simulation.recoveryStatus },
                          ].map((item) => (
                            <div key={item.term}>
                              <dt className="text-meta font-medium uppercase tracking-wide text-muted">{item.term}</dt>
                              <dd className="mt-1 text-support text-ink">{item.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}

            {query.data?.keyProvider.warning ? (
              <PocDisclosure
                what={query.data.keyProvider.warning}
                production="a cloud key management service or a dedicated hardware security module"
              />
            ) : null}
          </div>
        ) : null}
      </Loadable>
    </div>
  );
}

function ServiceTile({
  label,
  status,
  detail,
  icon,
  simulated,
}: {
  label: string;
  status: string;
  detail: string;
  icon: React.ReactNode;
  simulated?: boolean;
}) {
  const tone = status === 'OK' ? 'success' : status === 'WARNING' ? 'warning' : status === 'FAIL' ? 'critical' : 'neutral';
  return (
    <div className="surface px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-meta font-medium uppercase tracking-wide text-muted">
          {icon}
          {label}
        </span>
        {simulated ? (
          <StatusPill tone="neutral" size="sm">
            Simulated
          </StatusPill>
        ) : null}
      </div>
      <div className="mt-2">
        <StatusPill tone={tone} size="sm">
          {status === 'OK' ? 'Healthy' : status === 'WARNING' ? 'Degraded' : status === 'FAIL' ? 'Unavailable' : 'Unknown'}
        </StatusPill>
      </div>
      <p className="mt-2 text-meta text-muted">{detail}</p>
    </div>
  );
}
