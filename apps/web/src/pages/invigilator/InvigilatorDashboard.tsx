import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Eye, RefreshCw, Search, Users, Wifi, WifiOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDuration, formatNumber, relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { EmptyState, SkeletonCards, SkeletonTable } from '@/components/ui/Feedback';
import { AttemptStatusPill, SeverityPill, StatusPill } from '@/components/ui/Status';
import { Select, TextInput, Field, TextArea } from '@/components/ui/Form';
import { Loadable } from '@/components/ui/QueryState';
import { Avatar, useToast } from '@/components/ui/Misc';
import { ConfirmDialog } from '@/components/ui/Overlay';
import { InfoPanel } from '@/components/ui/Explain';

interface SummaryResponse {
  exam: {
    id: string;
    name: string;
    code: string;
    startsAt: string;
    durationMinutes: number;
    centreName: string;
    securityProfileId: string;
  } | null;
  totals: {
    candidates: number;
    notStarted: number;
    verifying: number;
    active: number;
    restricted: number;
    requiresReview: number;
    disconnected: number;
    submitted: number;
  };
  openIncidents: number;
  serverTime: string;
}

interface SessionRow {
  attemptId: string;
  candidateName: string;
  candidateId: string;
  applicationId: string;
  photoSeed: string;
  workstation: string;
  status: string;
  identityStatus: string;
  lastAnswerSavedAt: string | null;
  connectionStatus: string;
  remainingSeconds: number;
  alertLevel: string;
  answeredCount: number;
  consecutiveMonitoringFailures: number;
  restrictionReason: string | null;
}

type ActionType =
  | 'REQUEST_REVERIFICATION'
  | 'APPROVE_RECOVERY'
  | 'EXTEND_TIME'
  | 'RESTRICT_SESSION'
  | 'RELEASE_RESTRICTION'
  | 'ESCALATE'
  | 'ADD_NOTE';

const ACTION_LABELS: Record<ActionType, { title: string; confirm: string; tone: 'default' | 'critical'; body: string }> = {
  REQUEST_REVERIFICATION: {
    title: 'Request reverification',
    confirm: 'Request reverification',
    tone: 'default',
    body: 'The candidate is asked to complete a verification step. Their answers are unaffected.',
  },
  APPROVE_RECOVERY: {
    title: 'Approve recovery',
    confirm: 'Release the session',
    tone: 'default',
    body: 'The candidate resumes the same stored question sequence. Nothing is regenerated and no answer is lost.',
  },
  EXTEND_TIME: {
    title: 'Extend time',
    confirm: 'Grant additional time',
    tone: 'default',
    body: 'Additional minutes are added to this attempt only.',
  },
  RESTRICT_SESSION: {
    title: 'Restrict session',
    confirm: 'Restrict navigation',
    tone: 'critical',
    body: 'Question navigation is paused. No answers are discarded and the attempt is not ended.',
  },
  RELEASE_RESTRICTION: {
    title: 'Release restriction',
    confirm: 'Release the session',
    tone: 'default',
    body: 'The candidate can continue from where they were.',
  },
  ESCALATE: {
    title: 'Escalate to the examination controller',
    confirm: 'Escalate',
    tone: 'critical',
    body: 'A critical incident is raised for the examination controller to handle.',
  },
  ADD_NOTE: {
    title: 'Add an incident note',
    confirm: 'Save note',
    tone: 'default',
    body: 'The note is recorded against this session and appears in the audit trail.',
  },
};

export function InvigilatorDashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [alertLevel, setAlertLevel] = useState('');
  const [action, setAction] = useState<{ row: SessionRow; type: ActionType } | null>(null);
  const [reason, setReason] = useState('');
  const [extraMinutes, setExtraMinutes] = useState(10);

  const summary = useQuery({
    queryKey: ['invigilator-summary'],
    queryFn: () => api.get<SummaryResponse>('/invigilator/summary'),
    refetchInterval: 15_000,
  });

  const sessions = useQuery({
    queryKey: ['invigilator-sessions', { search, status, alertLevel, page }],
    queryFn: () =>
      api.get<{ items: SessionRow[]; total: number; page: number; pageSize: number }>('/invigilator/sessions', {
        search,
        status,
        alertLevel,
        page,
        pageSize: 25,
      }),
    refetchInterval: 15_000,
  });

  const act = useMutation({
    mutationFn: () =>
      api.post('/invigilator/actions', {
        attemptId: action!.row.attemptId,
        action: action!.type,
        reason,
        ...(action!.type === 'EXTEND_TIME' ? { extraMinutes } : {}),
        ...(action!.type === 'ADD_NOTE' ? { note: reason } : {}),
      }),
    onSuccess: () => {
      toast.push({
        tone: 'success',
        title: `${ACTION_LABELS[action!.type].title} recorded`,
        description: 'Your reason was written to the audit trail.',
      });
      setAction(null);
      setReason('');
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Action failed',
        description: error instanceof ApiError ? `${error.message} ${error.guidance}` : 'Unexpected error',
      }),
  });

  const totals = summary.data?.totals;
  const distribution = totals
    ? [
        { name: 'Active', value: totals.active, color: '#18A36B' },
        { name: 'Submitted', value: totals.submitted, color: '#176BFF' },
        { name: 'Disconnected', value: totals.disconnected, color: '#E89A20' },
        { name: 'Verifying', value: totals.verifying, color: '#61C8F4' },
        { name: 'Requires review', value: totals.requiresReview, color: '#D64545' },
        { name: 'Restricted', value: totals.restricted, color: '#A83232' },
        { name: 'Not started', value: totals.notStarted, color: '#D1D9E2' },
      ].filter((slice) => slice.value > 0)
    : [];

  const columns: Column<SessionRow>[] = [
    {
      key: 'candidate',
      header: 'Candidate',
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.candidateName} seed={row.photoSeed} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-ink">{row.candidateName}</p>
            <p className="font-mono text-meta text-muted">{row.applicationId}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'workstation',
      header: 'Workstation',
      hideBelow: 'md',
      render: (row) => <code className="font-mono text-meta">{row.workstation}</code>,
    },
    { key: 'status', header: 'Session', render: (row) => <AttemptStatusPill status={row.status} /> },
    {
      key: 'identity',
      header: 'Identity',
      hideBelow: 'lg',
      render: (row) => (
        <StatusPill
          size="sm"
          tone={
            row.identityStatus === 'VERIFIED'
              ? 'success'
              : row.identityStatus === 'WARNING'
                ? 'warning'
                : row.identityStatus === 'FAILED'
                  ? 'critical'
                  : 'neutral'
          }
        >
          {row.identityStatus.charAt(0) + row.identityStatus.slice(1).toLowerCase()}
        </StatusPill>
      ),
    },
    {
      key: 'saved',
      header: 'Last answer saved',
      hideBelow: 'lg',
      render: (row) => <span className="text-muted">{relativeTime(row.lastAnswerSavedAt)}</span>,
    },
    {
      key: 'connection',
      header: 'Connection',
      hideBelow: 'xl',
      render: (row) => (
        <StatusPill
          size="sm"
          tone={row.connectionStatus === 'ONLINE' ? 'success' : row.connectionStatus === 'RECONNECTING' ? 'warning' : 'critical'}
          icon={
            row.connectionStatus === 'ONLINE' ? (
              <Wifi aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <WifiOff aria-hidden className="h-3.5 w-3.5" />
            )
          }
        >
          {row.connectionStatus.charAt(0) + row.connectionStatus.slice(1).toLowerCase()}
        </StatusPill>
      ),
    },
    {
      key: 'remaining',
      header: 'Remaining',
      hideBelow: 'md',
      render: (row) => <span className="tnum">{formatDuration(row.remainingSeconds)}</span>,
    },
    { key: 'alert', header: 'Alert', render: (row) => <SeverityPill severity={row.alertLevel} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      render: (row) => (
        <div className="flex justify-end gap-1.5">
          {row.status === 'RESTRICTED' || row.status === 'AWAITING_REVERIFICATION' ? (
            <Button
              size="sm"
              variant="primary"
              onClick={(event) => {
                event.stopPropagation();
                setAction({ row, type: 'APPROVE_RECOVERY' });
              }}
            >
              Approve recovery
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                setAction({ row, type: 'REQUEST_REVERIFICATION' });
              }}
            >
              Reverify
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/invigilator/sessions/${row.attemptId}`);
            }}
          >
            <Eye aria-hidden className="h-4 w-4" />
            <span className="sr-only">View {row.candidateName}</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Live examination dashboard"
        description={
          summary.data?.exam
            ? `${summary.data.exam.name} · ${summary.data.exam.centreName} · ${summary.data.exam.durationMinutes} minutes`
            : 'Live candidate sessions across the centre.'
        }
        meta={
          summary.data?.exam ? (
            <>
              <StatusPill tone="brand" size="sm">
                {summary.data.exam.code}
              </StatusPill>
              <StatusPill tone={summary.data.openIncidents > 0 ? 'critical' : 'success'} size="sm">
                {summary.data.openIncidents} open incident{summary.data.openIncidents === 1 ? '' : 's'}
              </StatusPill>
            </>
          ) : null
        }
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw aria-hidden className="h-4 w-4" />}
            loading={summary.isFetching || sessions.isFetching}
            onClick={() => {
              void summary.refetch();
              void sessions.refetch();
            }}
          >
            Refresh
          </Button>
        }
      />

      <Loadable
        isLoading={summary.isLoading}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        context="The live dashboard"
        skeleton={<SkeletonCards count={4} />}
      >
        {totals ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <StatTile label="Candidates" value={formatNumber(totals.candidates)} />
              <StatTile label="Not started" value={formatNumber(totals.notStarted)} />
              <StatTile label="Verifying" value={formatNumber(totals.verifying)} tone="info" />
              <StatTile label="Active" value={formatNumber(totals.active)} tone="success" />
              <StatTile
                label="Restricted"
                value={formatNumber(totals.restricted)}
                tone={totals.restricted > 0 ? 'critical' : 'neutral'}
              />
              <StatTile
                label="Requires review"
                value={formatNumber(totals.requiresReview)}
                tone={totals.requiresReview > 0 ? 'warning' : 'neutral'}
                onClick={() => {
                  setStatus('AWAITING_REVERIFICATION');
                  setPage(1);
                }}
              />
              <StatTile
                label="Disconnected"
                value={formatNumber(totals.disconnected)}
                tone={totals.disconnected > 0 ? 'warning' : 'neutral'}
              />
              <StatTile label="Submitted" value={formatNumber(totals.submitted)} tone="info" />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Card>
                <CardHeader title="Session distribution" description="Every registered candidate is in exactly one state." />
                <div className="px-6 py-5">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={distribution}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={54}
                          outerRadius={84}
                          paddingAngle={2}
                          strokeWidth={1}
                        >
                          {distribution.map((slice) => (
                            <Cell key={slice.name} fill={slice.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            borderRadius: 12,
                            border: '1px solid #D1D9E2',
                            boxShadow: '0 8px 20px rgba(7,17,31,0.08)',
                            fontSize: 13,
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {distribution.map((slice) => (
                      <li key={slice.name} className="flex items-center justify-between gap-3 text-support">
                        <span className="flex items-center gap-2 text-ink">
                          <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: slice.color }} />
                          {slice.name}
                        </span>
                        <span className="tnum text-muted">{formatNumber(slice.value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              <div className="space-y-6">
                <InfoPanel title="What an invigilator can and cannot see">
                  You can see session state, identity events, device health and answer-save progress. You cannot see
                  question content or the candidate’s answers — that separation is enforced by the examination service,
                  not by this screen.
                </InfoPanel>

                <Card>
                  <CardHeader
                    icon={<Users aria-hidden className="h-5 w-5" />}
                    title="Candidate sessions"
                    description="Sorted with the most urgent first."
                  />
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3">
                    <div className="relative min-w-[14rem] flex-1">
                      <Search
                        aria-hidden
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                      />
                      <TextInput
                        className="pl-9"
                        placeholder="Search name, ID or workstation"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setPage(1);
                        }}
                        aria-label="Search sessions"
                      />
                    </div>
                    <Select
                      className="w-48"
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value);
                        setPage(1);
                      }}
                      aria-label="Filter by session status"
                    >
                      <option value="">All statuses</option>
                      <option value="ACTIVE">Active</option>
                      <option value="RESTRICTED">Restricted</option>
                      <option value="AWAITING_REVERIFICATION">Requires review</option>
                      <option value="DISCONNECTED">Disconnected</option>
                      <option value="SUBMITTED">Submitted</option>
                      <option value="VERIFYING">Verifying</option>
                    </Select>
                    <Select
                      className="w-40"
                      value={alertLevel}
                      onChange={(event) => {
                        setAlertLevel(event.target.value);
                        setPage(1);
                      }}
                      aria-label="Filter by alert level"
                    >
                      <option value="">All alerts</option>
                      <option value="CRITICAL">Critical</option>
                      <option value="WARNING">Warning</option>
                      <option value="INFO">Information</option>
                      <option value="NONE">No alert</option>
                    </Select>
                  </div>
                  <Loadable
                    isLoading={sessions.isLoading}
                    error={sessions.error}
                    onRetry={() => void sessions.refetch()}
                    context="Candidate sessions"
                    skeleton={<SkeletonTable rows={8} columns={6} />}
                  >
                    <>
                      <DataTable
                        columns={columns}
                        rows={sessions.data?.items ?? []}
                        getRowKey={(row) => row.attemptId}
                        onRowClick={(row) => navigate(`/invigilator/sessions/${row.attemptId}`)}
                        caption="Live candidate sessions"
                        dense
                        emptyState={
                          <EmptyState
                            icon={<Users aria-hidden className="h-6 w-6" />}
                            title="No sessions match those filters"
                            description="Clear the filters to see every candidate session."
                            action={
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setSearch('');
                                  setStatus('');
                                  setAlertLevel('');
                                }}
                              >
                                Clear filters
                              </Button>
                            }
                          />
                        }
                      />
                      {sessions.data && sessions.data.total > sessions.data.pageSize ? (
                        <Pagination
                          page={sessions.data.page}
                          pageSize={sessions.data.pageSize}
                          total={sessions.data.total}
                          onPageChange={setPage}
                          label="sessions"
                        />
                      ) : null}
                    </>
                  </Loadable>
                </Card>
              </div>
            </div>
          </div>
        ) : null}
      </Loadable>

      <ConfirmDialog
        open={Boolean(action)}
        onClose={() => {
          setAction(null);
          setReason('');
        }}
        onConfirm={() => act.mutate()}
        title={action ? `${ACTION_LABELS[action.type].title} — ${action.row.candidateName}` : ''}
        description={action ? ACTION_LABELS[action.type].body : undefined}
        confirmLabel={action ? ACTION_LABELS[action.type].confirm : 'Confirm'}
        tone={action ? ACTION_LABELS[action.type].tone : 'default'}
        loading={act.isPending}
        confirmDisabled={reason.trim().length < 5}
      >
        <div className="space-y-4">
          {action?.row.restrictionReason ? (
            <div className="rounded-card border border-warning-border bg-warning-soft px-4 py-3 text-support text-ink">
              <p className="font-medium">Why this session is restricted</p>
              <p className="mt-0.5 text-muted">{action.row.restrictionReason}</p>
            </div>
          ) : null}

          {action?.type === 'EXTEND_TIME' ? (
            <Field label="Additional minutes" htmlFor="extra-minutes" required>
              <TextInput
                id="extra-minutes"
                type="number"
                min={1}
                max={120}
                className="max-w-[10rem]"
                value={extraMinutes}
                onChange={(event) => setExtraMinutes(Number(event.target.value))}
              />
            </Field>
          ) : null}

          <Field
            label="Reason"
            htmlFor="action-reason"
            required
            hint="Mandatory. Recorded in the audit trail with your name and the time."
          >
            <TextArea
              id="action-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Attended the workstation and confirmed identity against the admit card photograph."
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
