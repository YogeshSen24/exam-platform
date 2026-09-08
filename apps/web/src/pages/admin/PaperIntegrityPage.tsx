import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  FileLock2,
  Fingerprint,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import type { ExamManifest, ExamPublicationApproval } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/Card';
import { Alert, EmptyState, SkeletonCards } from '@/components/ui/Feedback';
import { DescriptionList, useToast } from '@/components/ui/Misc';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { Explain, HashValue, InfoPanel, PocDisclosure } from '@/components/ui/Explain';
import { Field, TextArea } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Overlay';

interface IntegrityResponse {
  manifest: ExamManifest | null;
  report: {
    ok: boolean;
    checkedAt: string;
    signatureValid: boolean;
    manifestHashValid: boolean;
    verifiedQuestionCount: number;
    failedEntries: {
      sequence: number;
      questionId: string;
      expectedHash: string;
      actualHash: string | null;
      reason: string;
    }[];
    summary: string;
  } | null;
  approvals: ExamPublicationApproval[];
  keyProvider: {
    displayName: string;
    productionReady: boolean;
    signatureAlgorithm: string;
    encryptionAlgorithm: string;
    keyRotation: string;
    warning: string | null;
  };
  releaseWindowOpen: boolean;
  requiredApprovals: number;
}

export function PaperIntegrityPage() {
  const { examId = '' } = useParams();
  const { can, user } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [comment, setComment] = useState('');

  const query = useQuery({
    queryKey: ['integrity', examId],
    queryFn: () => api.get<IntegrityResponse>(`/exams/${examId}/integrity`),
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      api.post(`/exams/${examId}/approve-publication`, { decision, comment }),
    onSuccess: (_, decision) => {
      toast.push({
        tone: decision === 'APPROVED' ? 'success' : 'warning',
        title: decision === 'APPROVED' ? 'Approval recorded' : 'Publication rejected',
        description: 'The decision and your reason were written to the audit trail.',
      });
      setApproveOpen(false);
      setRejectOpen(false);
      setComment('');
      void queryClient.invalidateQueries();
    },
    onError: (error) =>
      toast.push({
        tone: 'critical',
        title: 'Decision could not be recorded',
        description: error instanceof ApiError ? `${error.message} ${error.guidance}` : 'Unexpected error',
      }),
  });

  const data = query.data;
  const manifest = data?.manifest;
  const report = data?.report;
  const alreadyDecided = data?.approvals.some((a) => a.approverUserId === user?.id);

  return (
    <div>
      <PageHeader
        title="Paper integrity and publication"
        description="How this examination proves that the questions delivered are exactly the questions that were approved."
        breadcrumb={
          <Link to={`/admin/exams/${examId}`} className="hover:text-brand hover:underline">
            ← Back to the examination
          </Link>
        }
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw aria-hidden className="h-4 w-4" />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Re-verify now
          </Button>
        }
      />

      <Loadable
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="Paper integrity"
        skeleton={<SkeletonCards count={4} />}
      >
        {!manifest || !report ? (
          <Card>
            <EmptyState
              icon={<FileLock2 aria-hidden className="h-6 w-6" />}
              title="No paper has been assembled yet"
              description="Once every question is approved, assemble the paper. The platform then fingerprints each question, builds a manifest, signs it and encrypts the package."
              action={
                <Link to={`/admin/exams/${examId}`}>
                  <Button variant="primary">Return to the examination</Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Verdict */}
            {report.ok ? (
              <Alert tone="success" title="This paper is intact" live>
                {report.summary} The paper may be released to candidates inside its authorised examination window.
              </Alert>
            ) : (
              <Alert tone="critical" title="Release is blocked — this paper failed verification" live>
                {report.summary} No candidate will receive this paper. The examination controller and the security
                administrator have been notified, and the failure is recorded in the audit trail.
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Integrity status"
                value={report.ok ? 'Verified' : 'Failed'}
                tone={report.ok ? 'success' : 'critical'}
                hint={`Checked ${formatDateTime(report.checkedAt)}`}
                icon={report.ok ? <ShieldCheck aria-hidden className="h-4 w-4" /> : <ShieldAlert aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Questions verified"
                value={`${report.verifiedQuestionCount} / ${manifest.entries.length}`}
                tone={report.verifiedQuestionCount === manifest.entries.length ? 'success' : 'critical'}
                icon={<Fingerprint aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Signature"
                value={report.signatureValid ? 'Valid' : 'Invalid'}
                tone={report.signatureValid ? 'success' : 'critical'}
                icon={<BadgeCheck aria-hidden className="h-4 w-4" />}
              />
              <StatTile
                label="Release window"
                value={data.releaseWindowOpen ? 'Open' : 'Closed'}
                tone={data.releaseWindowOpen ? 'info' : 'neutral'}
                hint={`${formatDateTime(manifest.releaseWindowStart)} → ${formatDateTime(manifest.releaseWindowEnd)}`}
                icon={<Timer aria-hidden className="h-4 w-4" />}
              />
            </div>

            {/* The four mechanisms, explained */}
            <Card>
              <CardHeader
                title="What protects this paper"
                description="Four mechanisms, each answering a different question."
              />
              <CardBody className="grid gap-5 md:grid-cols-2">
                {[
                  {
                    icon: <FileLock2 aria-hidden className="h-5 w-5 text-brand" />,
                    title: 'Encryption hides the question content',
                    body: 'The complete question package — including the answer key — is encrypted. A copy taken from storage or a backup reveals nothing readable.',
                    detail: manifest.encryptionProfile,
                  },
                  {
                    icon: <Fingerprint aria-hidden className="h-5 w-5 text-brand" />,
                    title: 'Hashes detect any change',
                    body: 'Each approved question has a fingerprint recorded at approval. Before any candidate is given the paper, the platform recomputes every fingerprint and compares.',
                    detail: `${manifest.entries.length} question fingerprints recorded`,
                  },
                  {
                    icon: <BadgeCheck aria-hidden className="h-5 w-5 text-brand" />,
                    title: 'The signature proves who approved it',
                    body: 'The manifest is signed by the approving authority. Anyone with the matching public key can confirm both who approved the paper and that the list has not changed.',
                    detail: `${manifest.signatureAlgorithm} signature over the manifest fingerprint`,
                  },
                  {
                    icon: <Timer aria-hidden className="h-5 w-5 text-brand" />,
                    title: 'The release window controls when it can be opened',
                    body: 'The key that unlocks the paper is only released inside the scheduled examination window. Outside that window, decryption is refused.',
                    detail: `${formatDateTime(manifest.releaseWindowStart)} → ${formatDateTime(manifest.releaseWindowEnd)}`,
                  },
                ].map((item) => (
                  <div key={item.title} className="rounded-card border border-line bg-page p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0">{item.icon}</span>
                      <div>
                        <p className="text-support font-semibold text-ink">{item.title}</p>
                        <p className="mt-1 text-support text-muted">{item.body}</p>
                        <p className="mt-2 font-mono text-meta text-muted">{item.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>

            {/* Failed entries */}
            {report.failedEntries.length > 0 ? (
              <Card>
                <CardHeader
                  icon={<ShieldAlert aria-hidden className="h-5 w-5 text-critical" />}
                  title={`${report.failedEntries.length} question${report.failedEntries.length === 1 ? '' : 's'} no longer match the approved fingerprint`}
                  description="These questions were changed after approval. The paper cannot be released until it is re-approved."
                />
                <CardBody>
                  <ul className="space-y-4">
                    {report.failedEntries.map((entry) => (
                      <li key={entry.questionId} className="rounded-card border border-critical-border bg-critical-soft p-4">
                        <p className="text-support font-semibold text-ink">
                          Question {entry.sequence} — {entry.questionId}
                        </p>
                        <p className="mt-1 text-support text-muted">{entry.reason}</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <HashValue value={entry.expectedHash} label="Fingerprint at approval" />
                          <HashValue value={entry.actualHash} label="Fingerprint now" />
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}

            {/* Metadata */}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader title="Paper metadata" description="No key material is ever exposed through this interface." />
                <CardBody>
                  <DescriptionList
                    columns={2}
                    items={[
                      { term: 'Exam version', value: `v${manifest.examVersion}` },
                      {
                        term: (
                          <Explain term="manifest">
                            <span>Manifest fingerprint</span>
                          </Explain>
                        ),
                        value: <HashValue value={manifest.manifestHash} />,
                        span: true,
                      },
                      {
                        term: (
                          <Explain term="digitalSignature">
                            <span>Signature</span>
                          </Explain>
                        ),
                        value: (
                          <span className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={report.signatureValid ? 'success' : 'critical'} size="sm">
                              {report.signatureValid ? 'Verified' : 'Invalid'}
                            </StatusPill>
                            <code className="font-mono text-meta text-muted">{manifest.signatureAlgorithm}</code>
                          </span>
                        ),
                      },
                      { term: 'Signing key reference', value: <code className="font-mono text-meta">{manifest.signingKeyReference}</code> },
                      {
                        term: (
                          <Explain term="encryption">
                            <span>Encryption profile</span>
                          </Explain>
                        ),
                        value: manifest.encryptionProfile,
                        span: true,
                      },
                      { term: 'Encryption key reference', value: <code className="font-mono text-meta">{manifest.encryptionKeyReference}</code> },
                      { term: 'Nonce (this operation)', value: <code className="font-mono text-meta">{manifest.nonce}</code> },
                      { term: 'Encrypted package size', value: `${formatNumber(manifest.ciphertextLength)} bytes` },
                      { term: 'Questions in the paper', value: `${manifest.entries.length}` },
                      { term: 'Assembled', value: formatDateTime(manifest.createdAt) },
                      { term: 'Publication status', value: manifest.publicationStatus.replace(/_/g, ' ').toLowerCase() },
                      { term: 'Last integrity check', value: formatDateTime(report.checkedAt) },
                    ]}
                  />
                </CardBody>
              </Card>

              <div className="space-y-6">
                <Card as="aside">
                  <CardHeader
                    icon={<KeyRound aria-hidden className="h-5 w-5" />}
                    title="Key management"
                    description="Where the keys that protect this paper live."
                  />
                  <CardBody className="space-y-4">
                    <DescriptionList
                      columns={1}
                      items={[
                        { term: 'Provider', value: data.keyProvider.displayName },
                        { term: 'Signature algorithm', value: data.keyProvider.signatureAlgorithm },
                        { term: 'Encryption algorithm', value: data.keyProvider.encryptionAlgorithm },
                        { term: 'Key rotation', value: data.keyProvider.keyRotation },
                      ]}
                    />
                    {data.keyProvider.warning ? (
                      <PocDisclosure
                        what={data.keyProvider.warning}
                        production="a cloud key management service or a dedicated hardware security module, with policy-controlled key release"
                      />
                    ) : null}
                  </CardBody>
                </Card>

                <Card as="aside">
                  <CardHeader
                    title="Publication approvals"
                    description={`${data.approvals.filter((a) => a.decision === 'APPROVED').length} of ${data.requiredApprovals} required.`}
                  />
                  <CardBody className="space-y-4">
                    {data.approvals.length === 0 ? (
                      <p className="text-support text-muted">No decision has been recorded yet.</p>
                    ) : (
                      <ul className="space-y-3">
                        {data.approvals.map((approval) => (
                          <li key={approval.id} className="rounded-card border border-line bg-page px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-support font-medium text-ink">{approval.approverName}</p>
                              <StatusPill tone={approval.decision === 'APPROVED' ? 'success' : 'critical'} size="sm">
                                {approval.decision === 'APPROVED' ? 'Approved' : 'Rejected'}
                              </StatusPill>
                            </div>
                            <p className="mt-1 text-meta text-muted">{approval.comment}</p>
                            <p className="mt-1 text-meta text-muted">{formatDateTime(approval.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}

                    {data.requiredApprovals > 1 ? (
                      <InfoPanel title="Why two approvers">
                        Separation of duties: the person who assembled the paper cannot approve it, and one person alone
                        cannot put a paper into production.
                      </InfoPanel>
                    ) : null}

                    {can('exams.publish.approve') && manifest.publicationStatus !== 'PUBLISHED' ? (
                      alreadyDecided ? (
                        <p className="text-support text-muted">
                          You have already recorded a decision on this paper. A different approver is required.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="primary" onClick={() => setApproveOpen(true)} disabled={!report.ok}>
                            Approve publication
                          </Button>
                          <Button variant="secondary" onClick={() => setRejectOpen(true)}>
                            Reject
                          </Button>
                        </div>
                      )
                    ) : null}

                    {can('exams.publish.approve') && !report.ok ? (
                      <p className="text-support text-critical">
                        Approval is disabled because the paper failed verification.
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </div>
            </div>

            {/* Manifest entries */}
            <Card>
              <CardHeader
                title="Manifest entries"
                description="Every question in the paper, with the fingerprint recorded when it was approved. Question content is not shown here."
              />
              <div className="max-h-[30rem] overflow-y-auto">
                <table className="w-full min-w-[40rem] border-collapse text-left">
                  <thead className="sticky top-0 bg-page">
                    <tr className="border-b border-line">
                      {['#', 'Question', 'Version', 'Subject', 'Difficulty', 'Marks', 'Fingerprint at approval'].map(
                        (header) => (
                          <th
                            key={header}
                            scope="col"
                            className="px-4 py-3 text-meta font-semibold uppercase tracking-wide text-muted"
                          >
                            {header}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {manifest.entries.map((entry) => {
                      const failed = report.failedEntries.some((f) => f.questionId === entry.questionId);
                      return (
                        <tr key={entry.questionVersionId} className={failed ? 'bg-critical-soft' : undefined}>
                          <td className="tnum px-4 py-2.5 text-support text-muted">{entry.sequence}</td>
                          <td className="px-4 py-2.5 font-mono text-meta text-ink">{entry.questionId}</td>
                          <td className="tnum px-4 py-2.5 text-support text-muted">v{entry.version}</td>
                          <td className="px-4 py-2.5 text-support text-muted">{entry.subject}</td>
                          <td className="px-4 py-2.5 text-support text-muted">
                            {entry.difficulty.charAt(0) + entry.difficulty.slice(1).toLowerCase()}
                          </td>
                          <td className="tnum px-4 py-2.5 text-support text-muted">{entry.marks}</td>
                          <td className="px-4 py-2.5">
                            <code className="font-mono text-meta text-navy">{entry.contentHash.slice(0, 16)}…</code>
                            {failed ? (
                              <StatusPill tone="critical" size="sm" className="ml-2">
                                Changed
                              </StatusPill>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </Loadable>

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        onConfirm={() => decide.mutate('APPROVED')}
        title="Approve publication"
        description="Your name, role, reason and the time are written to the audit trail."
        confirmLabel="Record approval"
        loading={decide.isPending}
        confirmDisabled={comment.trim().length < 5}
      >
        <Field
          label="What did you verify?"
          htmlFor="approve-comment"
          required
          hint="At least five characters. This is visible to anyone reviewing the publication history."
        >
          <TextArea
            id="approve-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Question content and marking scheme verified against the approved blueprint."
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onConfirm={() => decide.mutate('REJECTED')}
        title="Reject publication"
        description="The paper will be blocked from release until it is re-approved."
        confirmLabel="Reject publication"
        tone="critical"
        loading={decide.isPending}
        confirmDisabled={comment.trim().length < 5}
      >
        <Field label="Reason for rejection" htmlFor="reject-comment" required>
          <TextArea
            id="reject-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Explain what must change before this paper can be published."
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
