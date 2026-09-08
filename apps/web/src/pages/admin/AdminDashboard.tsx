import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  BookOpenCheck,
  Building2,
  CalendarClock,
  FileEdit,
  MonitorSmartphone,
  Plus,
  ShieldAlert,
  UserSquare2,
  Users,
} from 'lucide-react';
import { AUDIT_ACTION_LABELS, SECURITY_PROFILE_DEFINITIONS, type AuditEvent } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { EmptyState, SkeletonCards, SkeletonText } from '@/components/ui/Feedback';
import { ExamStatusPill, SeverityPill, StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { ProgressBar } from '@/components/ui/Misc';

interface DashboardResponse {
  counters: {
    upcomingExams: number;
    activeExams: number;
    draftExams: number;
    registeredCandidates: number;
    centres: number;
    workstations: number;
    approvedWorkstations: number;
    securityAlerts: number;
    pendingQuestionApprovals: number;
  };
  activeExaminations: {
    id: string;
    name: string;
    code: string;
    centreName: string;
    startsAt: string;
    durationMinutes: number;
    securityProfileId: keyof typeof SECURITY_PROFILE_DEFINITIONS;
    registered: number;
    active: number;
    submitted: number;
    requiresReview: number;
  }[];
  upcomingExaminations: {
    id: string;
    name: string;
    code: string;
    startsAt: string;
    centreName: string;
    securityProfileId: keyof typeof SECURITY_PROFILE_DEFINITIONS;
    candidateCount: number;
    status: string;
  }[];
  draftExaminations: { id: string; name: string; code: string; startsAt: string; status: string; totalQuestions: number }[];
  securityAlerts: { id: string; title: string; detail: string; severity: string; createdAt: string }[];
  pendingApprovals: {
    id: string;
    code: string;
    subject: string;
    difficulty: string;
    authorName: string;
    updatedAt: string;
  }[];
  recentActivity: AuditEvent[];
}

export function AdminDashboard() {
  const { can, user } = useSession();
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardResponse>('/dashboard'),
    refetchInterval: 30_000,
  });

  const data = query.data;

  return (
    <div>
      <PageHeader
        title={`Good day, ${user?.fullName.split(' ')[0] ?? 'there'}`}
        description="Examination readiness, live delivery and anything needing attention across your centres."
        actions={
          can('exams.write') ? (
            <Link to="/admin/exams/new">
              <Button variant="primary" icon={<Plus aria-hidden className="h-4 w-4" />}>
                Create examination
              </Button>
            </Link>
          ) : null
        }
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="The dashboard"
        skeleton={<SkeletonCards count={4} />}
      >
        {data ? (
          <div className="space-y-6">
            {/* Counters */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Active examinations"
                value={data.counters.activeExams}
                hint="Running right now"
                tone={data.counters.activeExams > 0 ? 'info' : 'neutral'}
                icon={<Activity aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Upcoming"
                value={data.counters.upcomingExams}
                hint="Published and scheduled"
                icon={<CalendarClock aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Registered candidates"
                value={formatNumber(data.counters.registeredCandidates)}
                hint="Across all examinations"
                icon={<UserSquare2 aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Security alerts"
                value={data.counters.securityAlerts}
                hint={data.counters.securityAlerts > 0 ? 'Require attention' : 'Nothing outstanding'}
                tone={data.counters.securityAlerts > 0 ? 'critical' : 'success'}
                icon={<ShieldAlert aria-hidden className="h-4 w-4" />}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Draft examinations"
                value={data.counters.draftExams}
                hint="Not yet published"
                icon={<FileEdit aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Examination centres"
                value={data.counters.centres}
                hint="Active"
                icon={<Building2 aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Registered workstations"
                value={`${data.counters.approvedWorkstations} / ${data.counters.workstations}`}
                hint="Approved of registered"
                tone={data.counters.approvedWorkstations < data.counters.workstations ? 'warning' : 'success'}
                icon={<MonitorSmartphone aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Pending question approvals"
                value={data.counters.pendingQuestionApprovals}
                hint="Awaiting a reviewer"
                tone={data.counters.pendingQuestionApprovals > 0 ? 'warning' : 'neutral'}
                icon={<BookOpenCheck aria-hidden className="h-4 w-4" />}
              />
            </div>

            {/* Active examinations */}
            <Card>
              <CardHeader
                title="Active examinations"
                description="Live delivery progress. Open the invigilator view for candidate-level detail."
                actions={
                  can('invigilation.read') ? (
                    <Link to="/invigilator">
                      <Button size="sm" variant="secondary">
                        Open live dashboard
                      </Button>
                    </Link>
                  ) : null
                }
              />
              {data.activeExaminations.length === 0 ? (
                <EmptyState
                  icon={<Activity aria-hidden className="h-6 w-6" />}
                  title="No examination is running"
                  description="Active examinations appear here with live delivery counts once candidates begin."
                />
              ) : (
                <CardBody className="space-y-5">
                  {data.activeExaminations.map((exam) => (
                    <div key={exam.id} className="rounded-card border border-line bg-page p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={`/admin/exams/${exam.id}`}
                            className="text-card font-semibold text-ink hover:text-brand hover:underline"
                          >
                            {exam.name}
                          </Link>
                          <p className="mt-1 text-support text-muted">
                            {exam.code} · {exam.centreName} · {exam.durationMinutes} minutes · started{' '}
                            {relativeTime(exam.startsAt)}
                          </p>
                        </div>
                        <StatusPill tone="brand" size="sm">
                          {SECURITY_PROFILE_DEFINITIONS[exam.securityProfileId]?.name ?? exam.securityProfileId}
                        </StatusPill>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-4">
                        {[
                          { label: 'Registered', value: exam.registered, tone: 'neutral' as const },
                          { label: 'Active now', value: exam.active, tone: 'success' as const },
                          { label: 'Submitted', value: exam.submitted, tone: 'info' as const },
                          { label: 'Need review', value: exam.requiresReview, tone: 'critical' as const },
                        ].map((item) => (
                          <div key={item.label}>
                            <p className="text-meta uppercase tracking-wide text-muted">{item.label}</p>
                            <p
                              className={`tnum mt-0.5 text-card-lg font-semibold ${
                                item.tone === 'critical' && item.value > 0
                                  ? 'text-critical'
                                  : item.tone === 'success'
                                    ? 'text-success'
                                    : 'text-ink'
                              }`}
                            >
                              {formatNumber(item.value)}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4">
                        <ProgressBar
                          label="Submitted so far"
                          value={exam.submitted}
                          max={exam.registered || 1}
                          tone="brand"
                        />
                      </div>
                    </div>
                  ))}
                </CardBody>
              )}
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Upcoming and drafts */}
              <Card>
                <CardHeader
                  title="Upcoming and draft examinations"
                  description="Scheduled examinations and work in progress."
                  actions={
                    <Link to="/admin/exams">
                      <Button size="sm" variant="ghost">
                        View all
                      </Button>
                    </Link>
                  }
                />
                <CardBody className="space-y-3">
                  {[...data.upcomingExaminations, ...data.draftExaminations].length === 0 ? (
                    <EmptyState
                      icon={<CalendarClock aria-hidden className="h-6 w-6" />}
                      title="No examinations scheduled"
                      description="Create an examination to begin the authoring and approval workflow."
                      action={
                        can('exams.write') ? (
                          <Link to="/admin/exams/new">
                            <Button variant="primary">Create examination</Button>
                          </Link>
                        ) : null
                      }
                    />
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.upcomingExaminations.map((exam) => (
                        <li key={exam.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                          <div className="min-w-0">
                            <Link
                              to={`/admin/exams/${exam.id}`}
                              className="text-support font-medium text-ink hover:text-brand hover:underline"
                            >
                              {exam.name}
                            </Link>
                            <p className="text-meta text-muted">
                              {formatDateTime(exam.startsAt)} · {exam.centreName} ·{' '}
                              {formatNumber(exam.candidateCount)} candidates
                            </p>
                          </div>
                          <ExamStatusPill status={exam.status} />
                        </li>
                      ))}
                      {data.draftExaminations.map((exam) => (
                        <li key={exam.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <Link
                              to={`/admin/exams/${exam.id}`}
                              className="text-support font-medium text-ink hover:text-brand hover:underline"
                            >
                              {exam.name}
                            </Link>
                            <p className="text-meta text-muted">
                              {exam.code} · {exam.totalQuestions} questions planned
                            </p>
                          </div>
                          <ExamStatusPill status={exam.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              {/* Alerts */}
              <Card>
                <CardHeader
                  title="Security alerts requiring attention"
                  description="Open items raised by monitoring, devices or the operations console."
                  actions={
                    can('invigilation.read') ? (
                      <Link to="/invigilator/alerts">
                        <Button size="sm" variant="ghost">
                          Alert queue
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                <CardBody>
                  {data.securityAlerts.length === 0 ? (
                    <EmptyState
                      icon={<ShieldAlert aria-hidden className="h-6 w-6" />}
                      title="No alerts outstanding"
                      description="Warnings from presence monitoring, device health and network policy appear here."
                    />
                  ) : (
                    <ul className="space-y-3">
                      {data.securityAlerts.map((alert) => (
                        <li key={alert.id} className="rounded-card border border-line bg-page px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <SeverityPill severity={alert.severity} />
                            <span className="text-meta text-muted">{relativeTime(alert.createdAt)}</span>
                          </div>
                          <p className="mt-1.5 text-support font-medium text-ink">{alert.title}</p>
                          <p className="mt-0.5 text-support text-muted">{alert.detail}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Pending approvals */}
              <Card>
                <CardHeader
                  title="Questions awaiting approval"
                  description="A different person must approve each question before it can enter a paper."
                  actions={
                    can('questions.review') ? (
                      <Link to="/admin/review">
                        <Button size="sm" variant="ghost">
                          Review queue
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                <CardBody>
                  {data.pendingApprovals.length === 0 ? (
                    <EmptyState
                      icon={<BookOpenCheck aria-hidden className="h-6 w-6" />}
                      title="Nothing awaiting review"
                      description="Questions submitted by authors appear here for a reviewer to approve."
                    />
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.pendingApprovals.map((question) => (
                        <li key={question.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                          <div className="min-w-0">
                            <p className="text-support font-medium text-ink">{question.code}</p>
                            <p className="text-meta text-muted">
                              {question.subject} · {question.difficulty.toLowerCase()} · by {question.authorName}
                            </p>
                          </div>
                          <span className="text-meta text-muted">{relativeTime(question.updatedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              {/* Activity */}
              <Card>
                <CardHeader
                  title="Recent administrative activity"
                  description="Drawn from the append-only audit trail."
                  actions={
                    can('audit.read') ? (
                      <Link to="/admin/audit">
                        <Button size="sm" variant="ghost">
                          Full audit log
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                <CardBody>
                  {query.isLoading ? (
                    <SkeletonText lines={6} />
                  ) : (
                    <ol className="space-y-3">
                      {data.recentActivity.map((event) => (
                        <li key={event.id} className="flex gap-3">
                          <span
                            aria-hidden
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              event.result === 'BLOCKED'
                                ? 'bg-critical'
                                : event.result === 'FAILURE'
                                  ? 'bg-warning'
                                  : 'bg-success'
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-support text-ink">
                              <span className="font-medium">{event.actorName}</span>{' '}
                              <span className="text-muted">
                                — {AUDIT_ACTION_LABELS[event.action] ?? event.action}
                              </span>
                            </p>
                            <p className="truncate text-meta text-muted">{event.targetLabel}</p>
                            <p className="text-meta text-muted">{relativeTime(event.timestamp)}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader
                icon={<Users aria-hidden className="h-5 w-5" />}
                title="Recommended demonstration route"
                description="A ten-to-fifteen-minute walkthrough of the complete examination lifecycle."
              />
              <CardBody>
                <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { step: 1, label: 'Review the 500-candidate examination', to: '/admin/exams' },
                    { step: 2, label: 'Explain the Maximum Assurance profile', to: '/admin/security' },
                    { step: 3, label: 'Show the signed, encrypted paper', to: '/admin/paper' },
                    { step: 4, label: 'Run a workstation readiness report', to: '/admin/devices' },
                    { step: 5, label: 'Sign in as a candidate', to: '/exam' },
                    { step: 6, label: 'Review the live invigilator dashboard', to: '/invigilator' },
                    { step: 7, label: 'Simulate an attack and show the controls', to: '/admin/health' },
                    { step: 8, label: 'Open the immutable audit timeline', to: '/admin/audit' },
                  ].map((item) => (
                    <li key={item.step}>
                      <Link
                        to={item.to}
                        className="flex items-center gap-3 rounded-card border border-line bg-page px-4 py-3 transition-colors hover:border-brand-200 hover:bg-brand-50"
                      >
                        <span className="tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-meta font-semibold text-white">
                          {item.step}
                        </span>
                        <span className="text-support text-ink">{item.label}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          </div>
        ) : null}
      </Loadable>
    </div>
  );
}
