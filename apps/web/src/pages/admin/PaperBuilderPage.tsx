import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, FileLock2, Layers, ShieldCheck } from 'lucide-react';
import { SECURITY_PROFILE_DEFINITIONS, type SecurityProfileId } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { Alert, EmptyState, SkeletonCards } from '@/components/ui/Feedback';
import { StatusPill, ExamStatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { useToast, ProgressBar, DescriptionList } from '@/components/ui/Misc';
import { HashValue, InfoPanel } from '@/components/ui/Explain';
import { Select } from '@/components/ui/Form';

interface ExamRow {
  id: string;
  name: string;
  code: string;
  status: string;
  totalQuestions: number;
  totalMarks: number;
  securityProfileId: SecurityProfileId;
  manifestId: string | null;
  candidateCount: number;
}

interface IntegrityResponse {
  manifest: {
    id: string;
    manifestHash: string;
    examVersion: number;
    entries: { sequence: number; subject: string; difficulty: string; marks: number }[];
    publicationStatus: string;
    createdAt: string;
    signatureAlgorithm: string;
    encryptionProfile: string;
  } | null;
  report: { ok: boolean; summary: string; verifiedQuestionCount: number } | null;
  approvals: { id: string; decision: string }[];
  requiredApprovals: number;
}

interface QuestionStats {
  total: number;
  approved: number;
  published: number;
  inReview: number;
  draft: number;
}

/**
 * Paper builder: shows how many approved questions exist, whether they satisfy
 * the blueprint, and drives assembly → publication request.
 */
export function PaperBuilderPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { examId = '' } = useParams();

  const exams = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get<{ items: ExamRow[] }>('/exams'),
  });

  const questions = useQuery({
    queryKey: ['questions', 'stats', examId],
    queryFn: async () => {
      const all = await api.get<{ summary: QuestionStats }>('/questions', { pageSize: 1, examId });
      return all.summary;
    },
  });

  const selectedExam = (exams.data?.items ?? []).find((exam) => exam.id === examId);

  const integrity = useQuery({
    queryKey: ['integrity', selectedExam?.id],
    queryFn: () => api.get<IntegrityResponse>(`/exams/${selectedExam!.id}/integrity`),
    enabled: Boolean(selectedExam?.id),
  });

  const assemble = useMutation({
    mutationFn: () => api.post(`/exams/${selectedExam!.id}/assemble-paper`),
    onSuccess: () => {
      toast.push({
        tone: 'success',
        title: 'Paper assembled, signed and encrypted',
        description: 'Request publication next. Approval by authorised people is required before release.',
      });
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Assembly failed',
        description: error instanceof ApiError ? `${error.message} ${error.guidance}` : 'Unexpected error',
      }),
  });

  const requestPublication = useMutation({
    mutationFn: () => api.post(`/exams/${selectedExam!.id}/request-publication`),
    onSuccess: () => {
      toast.push({ tone: 'success', title: 'Publication requested' });
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Request failed',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      }),
  });

  const availableApproved = (questions.data?.approved ?? 0) + (questions.data?.published ?? 0);
  const blueprintSatisfied = selectedExam ? availableApproved >= selectedExam.totalQuestions : false;

  const subjectBreakdown = (integrity.data?.manifest?.entries ?? []).reduce<Record<string, number>>((acc, entry) => {
    acc[entry.subject] = (acc[entry.subject] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Paper builder"
        description="Turn approved questions into a frozen, fingerprinted, signed and encrypted question paper."

      />

      <Loadable
        isLoading={exams.isLoading || questions.isLoading}
        error={exams.error ?? questions.error}
        onRetry={() => void exams.refetch()}
        context="The paper builder"
        skeleton={<SkeletonCards count={4} />}
      >
        {!selectedExam ? (
          <Card>
            <EmptyState
              icon={<Layers aria-hidden className="h-6 w-6" />}
              title="No examinations available"
              description="Create an examination before assembling a paper."
              action={
                can('exams.write') ? (
                  <Link to="/admin/exams/new">
                    <Button variant="primary">Create examination</Button>
                  </Link>
                ) : null
              }
            />
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Approved questions available"
                value={formatNumber(availableApproved)}
                hint={`${questions.data?.inReview ?? 0} still in review`}
                tone={blueprintSatisfied ? 'success' : 'warning'}
              />
              <StatTile
                label="Blueprint requires"
                value={formatNumber(selectedExam.totalQuestions)}
                hint={`${selectedExam.totalMarks} total marks`}
              />
              <StatTile
                label="Paper state"
                value={
                  integrity.data?.manifest
                    ? integrity.data.manifest.publicationStatus.replace(/_/g, ' ').toLowerCase()
                    : 'not assembled'
                }
                tone={
                  integrity.data?.manifest?.publicationStatus === 'PUBLISHED'
                    ? 'success'
                    : integrity.data?.manifest?.publicationStatus === 'BLOCKED'
                      ? 'critical'
                      : 'warning'
                }
              />
              <StatTile
                label="Approvals recorded"
                value={`${integrity.data?.approvals.filter((a) => a.decision === 'APPROVED').length ?? 0} / ${
                  integrity.data?.requiredApprovals ?? 1
                }`}
                tone="info"
              />
            </div>

            {!blueprintSatisfied ? (
              <Alert tone="warning" title="Not enough approved questions for this blueprint">
                {availableApproved} approved questions are available, but the blueprint requires{' '}
                {selectedExam.totalQuestions}. Approve more questions before assembling the paper.
              </Alert>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader
                  icon={<Layers aria-hidden className="h-5 w-5" />}
                  title="Assembly steps"
                  description="What happens when a paper is frozen."
                />
                <CardBody className="space-y-4">
                  <ol className="space-y-4">
                    {[
                      {
                        title: 'Collect approved questions',
                        body: 'Only questions a different reviewer has approved are eligible. Drafts and questions under review are excluded.',
                        done: blueprintSatisfied,
                      },
                      {
                        title: 'Fingerprint each question',
                        body: 'Each approved version is canonicalised and hashed with SHA-256, so any later change is detectable.',
                        done: Boolean(integrity.data?.manifest),
                      },
                      {
                        title: 'Build the manifest',
                        body: 'The list of question versions and their fingerprints becomes one document with its own fingerprint.',
                        done: Boolean(integrity.data?.manifest),
                      },
                      {
                        title: 'Sign the manifest',
                        body: 'A digital signature proves which authority approved this exact paper.',
                        done: Boolean(integrity.data?.manifest),
                      },
                      {
                        title: 'Encrypt the package',
                        body: 'The full question package, including the answer key, is encrypted under a fresh per-exam key.',
                        done: Boolean(integrity.data?.manifest),
                      },
                      {
                        title: 'Collect publication approvals',
                        body: 'Authorised approvers review and approve before the paper can be released.',
                        done: integrity.data
                          ? integrity.data.approvals.filter((a) => a.decision === 'APPROVED').length >=
                            integrity.data.requiredApprovals
                          : false,
                      },
                    ].map((step, index) => (
                      <li key={step.title} className="flex gap-3">
                        <span
                          className={`tnum mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-meta font-semibold ${
                            step.done ? 'border-success bg-success text-white' : 'border-line bg-white text-muted'
                          }`}
                        >
                          {index + 1}
                        </span>
                        <div>
                          <p className="text-support font-medium text-ink">{step.title}</p>
                          <p className="mt-0.5 text-support text-muted">{step.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                    {can('exams.write') && !selectedExam.manifestId ? (
                      <Button
                        variant="primary"
                        loading={assemble.isPending}
                        disabled={!blueprintSatisfied}
                        icon={<FileLock2 aria-hidden className="h-4 w-4" />}
                        onClick={() => assemble.mutate()}
                      >
                        Assemble, sign and encrypt
                      </Button>
                    ) : null}
                    {can('exams.publish.request') &&
                    integrity.data?.manifest &&
                    integrity.data.manifest.publicationStatus === 'DRAFT' ? (
                      <Button
                        variant="primary"
                        loading={requestPublication.isPending}
                        onClick={() => requestPublication.mutate()}
                      >
                        Request publication
                      </Button>
                    ) : null}
                    {selectedExam.manifestId ? (
                      <Link to={`/admin/exams/${selectedExam.id}/integrity`}>
                        <Button variant="secondary" icon={<FileCheck2 aria-hidden className="h-4 w-4" />}>
                          Open paper integrity
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </CardBody>
              </Card>

              <div className="space-y-6">
                <Card as="aside">
                  <CardHeader
                    icon={<ShieldCheck aria-hidden className="h-5 w-5" />}
                    title={selectedExam.name}
                    description={`${selectedExam.code} · ${formatNumber(selectedExam.candidateCount)} candidates`}
                  />
                  <CardBody className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <ExamStatusPill status={selectedExam.status} />
                      <StatusPill tone="brand" size="sm">
                        {SECURITY_PROFILE_DEFINITIONS[selectedExam.securityProfileId]?.name}
                      </StatusPill>
                    </div>
                    {integrity.data?.manifest ? (
                      <DescriptionList
                        columns={1}
                        items={[
                          { term: 'Manifest version', value: `v${integrity.data.manifest.examVersion}` },
                          { term: 'Manifest fingerprint', value: <HashValue value={integrity.data.manifest.manifestHash} /> },
                          { term: 'Signature', value: integrity.data.manifest.signatureAlgorithm },
                          { term: 'Encryption', value: integrity.data.manifest.encryptionProfile },
                          { term: 'Assembled', value: formatDateTime(integrity.data.manifest.createdAt) },
                          {
                            term: 'Integrity',
                            value: (
                              <StatusPill tone={integrity.data.report?.ok ? 'success' : 'critical'} size="sm">
                                {integrity.data.report?.ok ? 'Verified' : 'Failed'}
                              </StatusPill>
                            ),
                          },
                        ]}
                      />
                    ) : (
                      <p className="text-support text-muted">
                        No paper has been assembled for this examination yet.
                      </p>
                    )}
                  </CardBody>
                </Card>

                {Object.keys(subjectBreakdown).length > 0 ? (
                  <Card as="aside">
                    <CardHeader title="Composition of the assembled paper" />
                    <CardBody className="space-y-3">
                      {Object.entries(subjectBreakdown).map(([subject, count]) => (
                        <ProgressBar
                          key={subject}
                          label={`${subject} — ${count}`}
                          value={count}
                          max={integrity.data?.manifest?.entries.length ?? 1}
                          showValue={false}
                        />
                      ))}
                    </CardBody>
                  </Card>
                ) : null}

                <InfoPanel title="What “frozen” means">
                  Once a paper is assembled, every question in it is immutable. Editing an approved question would
                  change its fingerprint, the paper would fail verification, and release would be blocked automatically.
                </InfoPanel>
              </div>
            </div>
          </div>
        )}
      </Loadable>
    </div>
  );
}
