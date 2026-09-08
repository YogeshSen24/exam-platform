import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, RotateCcw } from 'lucide-react';
import { DIFFICULTY_LABELS, type Difficulty, type Question, type QuestionVersion } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Alert, EmptyState, SkeletonText } from '@/components/ui/Feedback';
import { Field, TextArea } from '@/components/ui/Form';
import { StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { useToast } from '@/components/ui/Misc';
import { HashValue, InfoPanel } from '@/components/ui/Explain';

interface QueueRow {
  id: string;
  code: string;
  stem: string;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  marks: number;
  authorName: string;
  updatedAt: string;
  contentHash: string;
}

interface QuestionDetail {
  question: Question;
  current: QuestionVersion | null;
  author: string;
}

export function QuestionReviewPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['questions', 'review-queue'],
    queryFn: () =>
      api.get<{ items: QueueRow[]; total: number }>('/questions', { status: 'IN_REVIEW', pageSize: 100 }),
  });

  const detail = useQuery({
    queryKey: ['question', selected],
    queryFn: () => api.get<QuestionDetail>(`/questions/${selected}`),
    enabled: Boolean(selected),
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'CHANGES_REQUESTED') =>
      api.post(`/questions/${selected}/review`, { decision, comment }),
    onSuccess: (_, decision) => {
      toast.push({
        tone: decision === 'APPROVED' ? 'success' : 'warning',
        title: decision === 'APPROVED' ? 'Question approved and frozen' : 'Returned to the author',
        description:
          decision === 'APPROVED'
            ? 'Its fingerprint is now recorded. Any later change would invalidate every paper containing it.'
            : 'The author can revise the draft and submit it again.',
      });
      setSelected(null);
      setComment('');
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.push({ tone: 'critical', title: error.message, description: error.guidance });
      }
    },
  });

  function submit(decision: 'APPROVED' | 'CHANGES_REQUESTED') {
    if (comment.trim().length < 5) {
      setCommentError('Add a review comment of at least five characters so the author knows your reasoning.');
      return;
    }
    setCommentError(null);
    decide.mutate(decision);
  }

  const rows = queue.data?.items ?? [];
  const current = detail.data;

  return (
    <div>
      <PageHeader
        title="Question review"
        description="Approve or return questions submitted by authors. You cannot edit an author's question directly, and you cannot approve one you wrote."
        meta={
          <StatusPill tone={rows.length > 0 ? 'warning' : 'success'} size="sm">
            {rows.length} awaiting review
          </StatusPill>
        }
      />

      <InfoPanel title="Separation of duties" className="mb-6">
        A question must be approved by someone other than its author. Approval freezes the content and records its
        fingerprint, which is what every published paper is signed against.
      </InfoPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader
            icon={<ClipboardCheck aria-hidden className="h-5 w-5" />}
            title="Review queue"
            description="Questions submitted and waiting for a decision."
          />
          <Loadable
            isLoading={queue.isLoading}
            error={queue.error}
            onRetry={() => void queue.refetch()}
            context="The review queue"
            skeleton={
              <CardBody>
                <SkeletonText lines={6} />
              </CardBody>
            }
          >
            {rows.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 aria-hidden className="h-6 w-6" />}
                title="Nothing awaiting review"
                description="When an author submits a question it appears here for approval."
                action={
                  <Link to="/admin/questions">
                    <Button variant="secondary">Open the question bank</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(row.id);
                        setComment('');
                        setCommentError(null);
                      }}
                      className={`w-full px-6 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
                        selected === row.id ? 'bg-brand-50' : 'hover:bg-page'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-meta text-muted">{row.code}</span>
                        <StatusPill
                          size="sm"
                          tone={row.difficulty === 'EASY' ? 'success' : row.difficulty === 'MEDIUM' ? 'info' : 'warning'}
                        >
                          {DIFFICULTY_LABELS[row.difficulty]}
                        </StatusPill>
                      </div>
                      <p className="mt-1 line-clamp-2 text-support text-ink">{row.stem}</p>
                      <p className="mt-1 text-meta text-muted">
                        {row.subject} · {row.topic} · {row.marks} marks · by {row.authorName}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Loadable>
        </Card>

        <Card>
          <CardHeader
            title={current ? `Reviewing ${current.question.code}` : 'Select a question'}
            description={
              current
                ? `Version ${current.current?.version ?? 1} by ${current.author}`
                : 'Choose a question from the queue to see its full content and answer key.'
            }
          />
          <CardBody>
            {!selected ? (
              <EmptyState
                icon={<ClipboardCheck aria-hidden className="h-6 w-6" />}
                title="No question selected"
                description="Pick an item from the review queue on the left."
              />
            ) : detail.isLoading ? (
              <SkeletonText lines={8} />
            ) : current?.current ? (
              <div className="space-y-6">
                <div>
                  <p className="text-meta font-medium uppercase tracking-wide text-muted">Question text</p>
                  <p className="mt-1.5 text-body-lg text-ink">{current.current.stem}</p>
                </div>

                <div>
                  <p className="text-meta font-medium uppercase tracking-wide text-muted">
                    Options and answer key
                  </p>
                  <ul className="mt-2 space-y-2">
                    {current.current.options.map((option) => (
                      <li
                        key={option.id}
                        className={`flex items-start gap-3 rounded-card border px-4 py-3 ${
                          option.isCorrect ? 'border-success-border bg-success-soft' : 'border-line bg-white'
                        }`}
                      >
                        <span className="w-5 shrink-0 text-support font-semibold text-muted">{option.label}</span>
                        <span className="flex-1 text-support text-ink">{option.text}</span>
                        {option.isCorrect ? (
                          <StatusPill tone="success" size="sm" icon={<CheckCircle2 aria-hidden className="h-3.5 w-3.5" />}>
                            Correct
                          </StatusPill>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                {current.current.explanation ? (
                  <div>
                    <p className="text-meta font-medium uppercase tracking-wide text-muted">Explanation</p>
                    <p className="mt-1.5 text-support text-muted">{current.current.explanation}</p>
                  </div>
                ) : null}

                {current.current.reviewerNotes ? (
                  <Alert tone="info" title="Note from the author">
                    {current.current.reviewerNotes}
                  </Alert>
                ) : null}

                <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-page px-4 py-3">
                  <HashValue value={current.current.contentHash} label="Fingerprint if approved" />
                  <span className="text-meta text-muted">Submitted {formatDateTime(current.current.createdAt)}</span>
                </div>

                <Field
                  label="Review comment"
                  htmlFor="review-comment"
                  required
                  error={commentError ?? undefined}
                  hint="Recorded against the question and written to the audit trail."
                >
                  <TextArea
                    id="review-comment"
                    rows={3}
                    value={comment}
                    invalid={Boolean(commentError)}
                    placeholder="Content, key and marks verified against the blueprint."
                    onChange={(event) => setComment(event.target.value)}
                  />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    loading={decide.isPending && decide.variables === 'APPROVED'}
                    icon={<CheckCircle2 aria-hidden className="h-4 w-4" />}
                    onClick={() => submit('APPROVED')}
                  >
                    Approve and freeze
                  </Button>
                  <Button
                    variant="secondary"
                    loading={decide.isPending && decide.variables === 'CHANGES_REQUESTED'}
                    icon={<RotateCcw aria-hidden className="h-4 w-4" />}
                    onClick={() => submit('CHANGES_REQUESTED')}
                  >
                    Request changes
                  </Button>
                  <Link to={`/admin/questions/${selected}`}>
                    <Button variant="ghost">Open full record</Button>
                  </Link>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
