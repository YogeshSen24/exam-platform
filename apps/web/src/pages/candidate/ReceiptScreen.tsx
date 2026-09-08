import { useFacialExport } from '@/components/domain/useFacialExport';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, Download, Printer, ShieldCheck } from 'lucide-react';
import type { SubmissionReceipt } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCandidateStore } from '@/lib/candidateStore';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Alert, SkeletonText } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { HashValue } from '@/components/ui/Explain';
import type { CandidateContextResponse } from './CandidateApp';
import { CandidateShell } from './CandidateShell';

/**
 * Submission receipt.
 *
 * The receipt is tamper-evident: it carries a fingerprint of the final answer
 * set, the fingerprint of the paper the candidate sat, an anchor into the audit
 * chain, and a signature over all of it.
 */
export function ReceiptScreen({ context }: { context: CandidateContextResponse }) {
  const navigate = useNavigate();
  const facial = useFacialExport();
  const { logout } = useSession();
  const { attemptId, reset } = useCandidateStore();

  const query = useQuery({
    queryKey: ['receipt', attemptId],
    queryFn: () => api.get<{ receipt: SubmissionReceipt }>(`/attempts/${attemptId}/receipt`),
    enabled: Boolean(attemptId),
  });

  const receipt = query.data?.receipt;

  function downloadReceipt() {
    if (!receipt) return;
    const lines = [
      'EXAMINATION SUBMISSION RECEIPT',
      '================================',
      '',
      `Receipt ID            ${receipt.receiptId}`,
      `Examination           ${receipt.examName}`,
      `Candidate             ${receipt.candidateName}`,
      `Application ID        ${receipt.applicationId}`,
      `Candidate ID          ${receipt.candidateId}`,
      `Centre                ${receipt.centreName}`,
      `Workstation           ${receipt.deviceCode}`,
      '',
      `Submitted (server)    ${receipt.submittedAt}`,
      `Questions answered    ${receipt.answeredCount} of ${receipt.totalQuestions}`,
      `Questions unanswered  ${receipt.unansweredCount}`,
      '',
      'INTEGRITY VALUES',
      `Answer-set fingerprint  ${receipt.answerSetHash}`,
      `Question paper          ${receipt.manifestHash}`,
      `Paper order reference   ${receipt.assignmentSeedHash}`,
      `Audit anchor            ${receipt.auditAnchorHash}`,
      `Signature               ${receipt.signature}`,
      `Signing key reference   ${receipt.signingKeyReference}`,
      '',
      'Keep this receipt. It proves what you submitted and when.',
      'Proof of concept — signing uses development keys, not a production HSM.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${receipt.receiptId}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
    {facial.dialog}
    <CandidateShell
      context={context}
      title="Your examination has been submitted"
      subtitle="Your answers are locked. Keep this receipt — it is your proof of what you submitted and when."
      step={4}
    >
      <div className="space-y-6">
        <Alert
          tone="success"
          live
          title="Submission complete"
          icon={<CheckCircle2 aria-hidden className="h-5 w-5 text-success" />}
        >
          Your answers were received and recorded by the examination server. No further changes are possible.
        </Alert>

        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="Your receipt"
          skeleton={
            <div className="surface p-6">
              <SkeletonText lines={8} />
            </div>
          }
        >
          {receipt ? (
            <article className="print-page surface p-6 sm:p-8">
              <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-control bg-navy">
                    <ShieldCheck aria-hidden className="h-6 w-6 text-sky" />
                  </span>
                  <div>
                    <p className="text-card font-semibold text-ink">Examination Board</p>
                    <p className="text-support text-muted">Submission receipt</p>
                  </div>
                </div>
                <StatusPill tone="success" icon={<BadgeCheck aria-hidden className="h-4 w-4" />}>
                  Submitted
                </StatusPill>
              </header>

              <div className="mt-6">
                <p className="text-meta uppercase tracking-wide text-muted">Receipt ID</p>
                <p className="mt-1 break-all font-mono text-card-lg font-semibold text-ink">{receipt.receiptId}</p>
              </div>

              <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {[
                  { term: 'Examination', value: receipt.examName },
                  { term: 'Candidate', value: receipt.candidateName },
                  { term: 'Application ID', value: receipt.applicationId },
                  { term: 'Candidate ID', value: receipt.candidateId },
                  { term: 'Examination centre', value: receipt.centreName },
                  { term: 'Workstation', value: receipt.deviceCode },
                  { term: 'Submitted (server time)', value: formatDateTime(receipt.serverTime) },
                  {
                    term: 'Questions answered',
                    value: `${receipt.answeredCount} of ${receipt.totalQuestions} (${receipt.unansweredCount} unanswered)`,
                  },
                ].map((item) => (
                  <div key={item.term}>
                    <dt className="text-meta uppercase tracking-wide text-muted">{item.term}</dt>
                    <dd className="mt-0.5 text-support font-medium text-ink">{item.value}</dd>
                  </div>
                ))}
              </dl>

              <section className="mt-8 rounded-card border border-line bg-page p-5">
                <h2 className="text-card font-semibold text-ink">Integrity values</h2>
                <p className="mt-1 text-support text-muted">
                  These codes let the examination board confirm later that your stored answers are exactly the ones you
                  submitted, and that you sat the approved paper.
                </p>
                <div className="mt-4 space-y-4">
                  <ReceiptHash
                    label="Answer-set fingerprint"
                    explanation="One code calculated from all of your final answers together."
                    value={receipt.answerSetHash}
                  />
                  <ReceiptHash
                    label="Question paper fingerprint"
                    explanation="Identifies the exact approved paper you were given."
                    value={receipt.manifestHash}
                  />
                  <ReceiptHash
                    label="Paper order reference"
                    explanation="Identifies your personal question and option order, without revealing it."
                    value={receipt.assignmentSeedHash}
                  />
                  <ReceiptHash
                    label="Audit anchor"
                    explanation="Ties this receipt to a specific point in the examination's audit history."
                    value={receipt.auditAnchorHash}
                  />
                  <ReceiptHash
                    label="Signature"
                    explanation="Proves this receipt was issued by the examination service and has not been altered."
                    value={receipt.signature}
                  />
                </div>
              </section>

              <footer className="mt-6 border-t border-line pt-4">
                <p className="text-meta text-muted">
                  Proof of concept: the signature above uses a development key held in application memory, not a
                  production hardware security module. In a live deployment the signing key would be held by a managed
                  key service and this receipt would be independently verifiable.
                </p>
              </footer>
            </article>
          ) : null}
        </Loadable>

        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Printer aria-hidden className="h-4 w-4" />} onClick={() => facial.begin(`print:${attemptId}`, () => window.print())}>
              Print receipt
            </Button>
            <Button
              variant="secondary"
              icon={<Download aria-hidden className="h-4 w-4" />}
              onClick={() => facial.begin(`receipt:${attemptId}`, downloadReceipt)}
              disabled={!receipt}
            >
              Download receipt
            </Button>
          </div>
          <Button
            variant="primary"
            onClick={async () => {
              reset();
              await logout();
              navigate('/exam', { replace: true });
            }}
          >
            Finish and sign out
          </Button>
        </div>

        <Alert tone="info" title="What happens next">
          Your answers are held securely for marking. Results are released according to the examination board’s
          published schedule. If you need to raise a concern about anything that happened during your examination, tell
          the invigilator before you leave the hall — they can record an incident note against your session while the
          detail is fresh.
        </Alert>
      </div>
    </CandidateShell></>
  );
}

function ReceiptHash({ label, explanation, value }: { label: string; explanation: string; value: string }) {
  return (
    <div>
      <p className="text-support font-medium text-ink">{label}</p>
      <p className="text-meta text-muted">{explanation}</p>
      <div className="mt-1.5">
        <HashValue value={value} full />
      </div>
    </div>
  );
}
