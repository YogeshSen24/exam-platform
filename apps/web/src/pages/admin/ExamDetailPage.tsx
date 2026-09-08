import { ExamOperations } from '@/components/domain/ExamOperations';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Network, ShieldCheck, Users } from 'lucide-react';
import {
  NAVIGATION_MODE_LABELS,
  RESULT_MODE_LABELS,
  type Exam,
  type ExamManifest,
  type ExaminationCentre,
  type ExamPublicationApproval,
  type SecurityControl,
  type SecurityProfile,
} from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { Alert, SkeletonCards } from '@/components/ui/Feedback';
import { DescriptionList, Tabs, useToast } from '@/components/ui/Misc';
import { ExamStatusPill, StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { HashValue, InfoPanel } from '@/components/ui/Explain';
import { SecurityControlList } from '@/components/domain/SecurityControlList';

interface ExamDetailResponse {
  exam: Exam;
  centre: ExaminationCentre | null;
  profile: SecurityProfile;
  effectiveControls: SecurityControl[];
  manifest: ExamManifest | null;
  approvals: ExamPublicationApproval[];
  stats: { registered: number; started: number; submitted: number };
}

export function ExamDetailPage() {
  const { examId = '' } = useParams();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');

  const query = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => api.get<ExamDetailResponse>(`/exams/${examId}`),
  });

  const assemble = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/assemble-paper`),
    onSuccess: () => {
      toast.push({
        tone: 'success',
        title: 'Paper assembled',
        description: 'Every approved question was fingerprinted, signed as one manifest and encrypted.',
      });
      void queryClient.invalidateQueries({ queryKey: ['exam', examId] });
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Paper could not be assembled',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      }),
  });

  const requestPublication = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/request-publication`),
    onSuccess: () => {
      toast.push({
        tone: 'success',
        title: 'Publication requested',
        description: 'Authorised approvers can now review and approve the paper.',
      });
      void queryClient.invalidateQueries({ queryKey: ['exam', examId] });
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Request failed',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      }),
  });

  const data = query.data;
  const exam = data?.exam;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Schedule, readiness and delivery settings for this examination."
        meta={
          exam ? (
            <>
              <ExamStatusPill status={exam.status} />
              <StatusPill tone="neutral" size="sm">
                {exam.code}
              </StatusPill>
              <StatusPill tone="brand" size="sm">
                {data?.profile.name}
              </StatusPill>
            </>
          ) : null
        }
        actions={
          exam ? (
            <div className="flex flex-wrap gap-2">
              <Link to={`/admin/exams/${examId}/integrity`}>
                <Button variant="secondary" icon={<FileCheck2 aria-hidden className="h-4 w-4" />}>
                  Paper integrity
                </Button>
              </Link>
              {can('exams.write') && !exam.manifestId ? (
                <Button variant="primary" loading={assemble.isPending} onClick={() => assemble.mutate()}>
                  Assemble paper
                </Button>
              ) : null}
              {can('exams.publish.request') && exam.manifestId && data?.manifest?.publicationStatus === 'DRAFT' ? (
                <Button variant="primary" loading={requestPublication.isPending} onClick={() => requestPublication.mutate()}>
                  Request publication
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="This examination"
        skeleton={<SkeletonCards count={4} />}
      >
        {data && exam ? (
          <div className="space-y-6">
            {!exam.manifestId ? (
              <Card>
                <CardHeader title="Prepare this examination" description="Complete these steps before requesting publication." />
                <CardBody className="grid gap-4 md:grid-cols-3">
                  {[
                    { path: 'candidates', title: '1. Register candidates', text: 'Add candidates or import your register and seat assignments.' },
                    { path: 'questions', title: '2. Prepare questions', text: 'Create questions in this exam bank and send them for independent review.' },
                    { path: 'paper', title: '3. Build the paper', text: 'Check approved questions against the blueprint, then assemble the paper.' },
                  ].map(item => <Link key={item.path} to={`/admin/exams/${examId}/${item.path}`} className="rounded-card border border-line p-4 transition hover:border-brand hover:bg-brand/5 focus-visible:outline-brand"><p className="font-semibold text-brand">{item.title}</p><p className="mt-2 text-support text-muted">{item.text}</p></Link>)}
                </CardBody>
              </Card>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Registered candidates" value={formatNumber(data.stats.registered)} />
              <StatTile label="Attempts started" value={formatNumber(data.stats.started)} tone="info" />
              <StatTile label="Submitted" value={formatNumber(data.stats.submitted)} tone="success" />
              <StatTile
                label="Paper status"
                value={data.manifest ? data.manifest.publicationStatus.replace('_', ' ').toLowerCase() : 'not assembled'}
                tone={
                  data.manifest?.publicationStatus === 'PUBLISHED'
                    ? 'success'
                    : data.manifest?.publicationStatus === 'BLOCKED'
                      ? 'critical'
                      : 'warning'
                }
              />
            </div>

            {data.manifest?.publicationStatus === 'BLOCKED' ? (
              <Alert tone="critical" title="Paper release is blocked" live>
                The paper failed its integrity check and will not be released to any candidate. Open the paper
                integrity screen for the detail.
              </Alert>
            ) : null}

            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'blueprint', label: 'Blueprint' },
                { id: 'security', label: 'Security', count: data.effectiveControls.length },
                { id: 'network', label: 'Network and monitoring' },
                { id: 'approvals', label: 'Approvals', count: data.approvals.length },
              ]}
            />

            {tab === 'overview' ? (
              <Card>
                <CardHeader title="Examination details" />
                <CardBody>
                  <DescriptionList
                    columns={3}
                    items={[
                      { term: 'Code', value: exam.code },
                      { term: 'Subject', value: exam.subject },
                      { term: 'Centre', value: data.centre?.name ?? '—' },
                      { term: 'Starts', value: formatDateTime(exam.startsAt) },
                      { term: 'Duration', value: `${exam.durationMinutes} minutes` },
                      { term: 'Reporting time', value: exam.reportingTime },
                      { term: 'Navigation', value: NAVIGATION_MODE_LABELS[exam.navigationMode] },
                      { term: 'Results', value: RESULT_MODE_LABELS[exam.resultMode] },
                      { term: 'Time zone', value: exam.timeZone },
                      { term: 'Created', value: formatDateTime(exam.createdAt) },
                      { term: 'Last updated', value: formatDateTime(exam.updatedAt) },
                      {
                        term: 'Manifest',
                        value: data.manifest ? (
                          <HashValue value={data.manifest.manifestHash} />
                        ) : (
                          <span className="text-muted">Not assembled</span>
                        ),
                      },
                    ]}
                  />
                </CardBody>
              </Card>
            ) : null}

            {tab === 'blueprint' ? (
              <Card>
                <CardHeader title="Question blueprint" description="The agreed shape of the paper." />
                <CardBody className="space-y-6">
                  <DescriptionList
                    columns={3}
                    items={[
                      { term: 'Total questions', value: exam.blueprint.totalQuestions },
                      { term: 'Total marks', value: exam.blueprint.totalMarks },
                      {
                        term: 'Negative marking',
                        value: exam.blueprint.negativeMarking ? `−${exam.blueprint.negativeMarkValue}` : 'Off',
                      },
                      { term: 'Easy', value: exam.blueprint.difficultyDistribution.EASY },
                      { term: 'Medium', value: exam.blueprint.difficultyDistribution.MEDIUM },
                      { term: 'Difficult', value: exam.blueprint.difficultyDistribution.DIFFICULT },
                      {
                        term: 'Randomised question order',
                        value: exam.blueprint.randomizeQuestionOrder ? 'Enabled' : 'Disabled',
                      },
                      {
                        term: 'Randomised option order',
                        value: exam.blueprint.randomizeOptionOrder ? 'Enabled' : 'Disabled',
                      },
                    ]}
                  />

                  {exam.blueprint.subjectDistribution.length > 0 ? (
                    <div>
                      <p className="text-support font-medium text-ink">Subject distribution</p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {exam.blueprint.subjectDistribution.map((item) => (
                          <li key={item.subject}>
                            <StatusPill tone="neutral" size="sm">
                              {item.subject} — {item.count}
                            </StatusPill>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <InfoPanel title="How randomisation stays stable">
                    Each candidate’s question and option order is generated once when their attempt is activated and
                    then stored. If the workstation restarts or the network drops, the stored sequence is replayed
                    rather than regenerated, so the candidate always sees the same paper.
                  </InfoPanel>
                </CardBody>
              </Card>
            ) : null}

            {tab === 'security' ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <Card>
                  <CardHeader
                    icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
                    title={data.profile.name}
                    description={data.profile.tagline}
                  />
                  <CardBody className="space-y-4">
                    <p className="text-support text-muted">{data.profile.summary}</p>
                    <InfoPanel title="Recommended for">{data.profile.recommendedFor}</InfoPanel>
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Policy last updated', value: formatDateTime(exam.securityPolicy.updatedAt) },
                        {
                          term: 'Dual approval before publication',
                          value: data.profile.flags.dualApprovalBeforePublication ? 'Required' : 'Not required',
                        },
                        {
                          term: 'Fingerprint verification',
                          value: data.profile.flags.fingerprintVerification,
                        },
                      ]}
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Effective controls" description={`${data.effectiveControls.length} controls in force.`} />
                  <CardBody>
                    <SecurityControlList controls={data.effectiveControls} />
                  </CardBody>
                </Card>
              </div>
            ) : null}

            {tab === 'network' ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader
                    icon={<Network aria-hidden className="h-5 w-5" />}
                    title="Network and device policy"
                  />
                  <CardBody>
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Primary range', value: <code className="font-mono">{exam.securityPolicy.network.primaryCidr}</code> },
                        {
                          term: 'Backup range',
                          value: exam.securityPolicy.network.backupCidr ? (
                            <code className="font-mono">{exam.securityPolicy.network.backupCidr}</code>
                          ) : (
                            'None configured'
                          ),
                        },
                        {
                          term: 'IPv6 range',
                          value: exam.securityPolicy.network.ipv6Cidr ? (
                            <code className="font-mono">{exam.securityPolicy.network.ipv6Cidr}</code>
                          ) : (
                            'Not used'
                          ),
                        },
                        {
                          term: 'Device certificate',
                          value: exam.securityPolicy.network.deviceCertificateRequired ? 'Required' : 'Not required',
                        },
                        {
                          term: 'Minimum device policy',
                          value: exam.securityPolicy.network.minimumDevicePolicyVersion,
                        },
                        {
                          term: 'General internet',
                          value: exam.securityPolicy.network.blockGeneralInternet ? 'Blocked' : 'Allowed',
                        },
                        {
                          term: 'Workstation-to-workstation',
                          value: exam.securityPolicy.network.blockWorkstationToWorkstation ? 'Blocked' : 'Allowed',
                        },
                        { term: 'USB', value: exam.securityPolicy.network.usbPolicy },
                        { term: 'Bluetooth', value: exam.securityPolicy.network.bluetoothPolicy },
                      ]}
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Monitoring policy" description="Applies only while this examination is running." />
                  <CardBody className="space-y-4">
                    <DescriptionList
                      columns={1}
                      items={[
                        {
                          term: 'Camera monitoring',
                          value: exam.securityPolicy.monitoring.cameraMonitoringEnabled
                            ? `Every ${exam.securityPolicy.monitoring.snapshotIntervalSeconds} seconds`
                            : 'Disabled',
                        },
                        {
                          term: 'Sign-in photograph',
                          value: exam.securityPolicy.monitoring.loginSnapshotEnabled ? 'Enabled' : 'Disabled',
                        },
                        {
                          term: 'Warning threshold',
                          value: `${exam.securityPolicy.monitoring.consecutiveFailureThreshold} consecutive failures`,
                        },
                        {
                          term: 'Reverification',
                          value:
                            exam.securityPolicy.monitoring.reverificationMode === 'INVIGILATOR_APPROVED'
                              ? 'An invigilator must approve'
                              : 'Automatic on a successful check',
                        },
                        {
                          term: 'Evidence retention',
                          value: `${exam.securityPolicy.monitoring.evidenceRetentionDays} days`,
                        },
                      ]}
                    />
                    <div className="rounded-card border border-line bg-page px-4 py-3">
                      <p className="text-meta font-medium uppercase tracking-wide text-muted">Notice shown to candidates</p>
                      <p className="mt-1.5 text-support text-ink">{exam.securityPolicy.monitoring.candidateNotice}</p>
                    </div>
                  </CardBody>
                </Card>
              </div>
            ) : null}

            {tab === 'approvals' ? (
              <Card>
                <CardHeader
                  icon={<Users aria-hidden className="h-5 w-5" />}
                  title="Publication approvals"
                  description={
                    data.profile.flags.dualApprovalBeforePublication
                      ? 'This profile requires two different authorised approvers before the paper can be published.'
                      : 'This profile requires one authorised approver.'
                  }
                />
                <CardBody>
                  {data.approvals.length === 0 ? (
                    <p className="text-support text-muted">
                      No approval has been recorded yet. Request publication to start the approval workflow.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.approvals.map((approval) => (
                        <li key={approval.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0">
                          <div className="min-w-0">
                            <p className="text-support font-medium text-ink">{approval.approverName}</p>
                            <p className="text-meta text-muted">{approval.approverRole.replace(/_/g, ' ').toLowerCase()}</p>
                            <p className="mt-1.5 max-w-prose text-support text-muted">{approval.comment}</p>
                          </div>
                          <div className="text-right">
                            <StatusPill tone={approval.decision === 'APPROVED' ? 'success' : 'critical'} size="sm">
                              {approval.decision === 'APPROVED' ? 'Approved' : 'Rejected'}
                            </StatusPill>
                            <p className="mt-1 text-meta text-muted">{formatDateTime(approval.createdAt)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            ) : null}
          </div>
        ) : null}
      </Loadable>
      {exam && <ExamOperations examId={examId} />}
    </div>
  );
}
