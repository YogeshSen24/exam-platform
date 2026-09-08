import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GitCompare, Lock, Plus, Send, Trash2 } from 'lucide-react';
import {
  questionDraftSchema,
  SUBJECTS,
  TOPICS,
  type QuestionCategory,
  type Question,
  type QuestionDraftInput,
  type QuestionReview,
  type QuestionVersion,
} from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { Alert, SkeletonText } from '@/components/ui/Feedback';
import { Checkbox, Field, Select, TextArea, TextInput } from '@/components/ui/Form';
import { DescriptionList, Tabs, useToast } from '@/components/ui/Misc';
import { QuestionStatusPill, StatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { HashValue, InfoPanel } from '@/components/ui/Explain';
import { QuestionDiff } from '@/components/domain/QuestionDiff';

interface QuestionDetail {
  question: Question;
  versions: QuestionVersion[];
  current: QuestionVersion | null;
  reviews: (QuestionReview & { reviewerName: string })[];
  author: string;
}

const EMPTY_DRAFT: QuestionDraftInput = {
  stem: '',
  type: 'SINGLE_CHOICE',
  options: [
    { label: 'A', text: '', isCorrect: true },
    { label: 'B', text: '', isCorrect: false },
    { label: 'C', text: '', isCorrect: false },
    { label: 'D', text: '', isCorrect: false },
  ],
  categoryId: '',
  markingGuidance: '',
  subject: SUBJECTS[0],
  topic: TOPICS[SUBJECTS[0]]![0]!,
  difficulty: 'MEDIUM',
  explanation: '',
  reviewerNotes: '',
};

export function QuestionEditorPage() {
  const { questionId, examId } = useParams();
  const base = examId ? `/admin/exams/${examId}/questions` : '/admin/questions';
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useSession();
  const isNew = !questionId;

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: QuestionCategory[] }>('/categories') });
  const [tab, setTab] = useState('edit');
  const [draft, setDraft] = useState<QuestionDraftInput>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['question', questionId, examId],
    queryFn: () => api.get<QuestionDetail>(`/questions/${questionId}`, { examId }),
    enabled: !isNew,
  });

  useEffect(() => {
    const current = query.data?.current;
    if (!current) return;
    setDraft({
      stem: current.stem,
      type: current.type,
      options: current.options.map((option) => ({
        id: option.id,
        label: option.label,
        text: option.text,
        isCorrect: option.isCorrect,
      })),
      categoryId: current.categoryId,
      markingGuidance: current.markingGuidance,
      subject: current.subject,
      topic: current.topic,
      difficulty: current.difficulty,
      explanation: current.explanation,
      reviewerNotes: current.reviewerNotes,
    });
  }, [query.data?.current]);

  const locked =
    !isNew && (query.data?.question.status === 'APPROVED' || query.data?.question.status === 'PUBLISHED');
  const isAuthor = isNew || query.data?.question.authorUserId === user?.id;
  const editable = can('questions.write') && !locked && isAuthor;

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? api.post<{ question: Question }>('/questions', { ...draft, examId })
        : api.put<{ question: Question }>(`/questions/${questionId}`, draft),
    onSuccess: (data) => {
      toast.push({
        tone: 'success',
        title: isNew ? 'Question created' : 'New version saved',
        description: 'A new immutable version record was written. Submit it for review when it is ready.',
      });
      void queryClient.invalidateQueries({ queryKey: ['questions'] });
      if (isNew) navigate(`${base}/${data.question.id}`);
      else void queryClient.invalidateQueries({ queryKey: ['question', questionId, examId] });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.push({ tone: 'critical', title: error.message, description: error.guidance });
      }
    },
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/questions/${questionId}/submit`),
    onSuccess: () => {
      toast.push({
        tone: 'success',
        title: 'Submitted for review',
        description: 'A different person must approve this question before it can enter a paper.',
      });
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.push({ tone: 'critical', title: error.message, description: error.guidance });
    },
  });

  function validate(): boolean {
    const result = questionDraftSchema.safeParse(draft);
    if (result.success) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    result.error.issues.forEach((issue) => {
      next[String(issue.path[0])] = issue.message;
    });
    setErrors(next);
    return false;
  }

  const isChoice = draft.type !== 'SHORT_TEXT' && draft.type !== 'PARAGRAPH';

  return (
    <div>
      <PageHeader
        title={isNew ? 'New question' : (query.data?.question.code ?? 'Question')}
        description={
          isNew
            ? 'Author a question. It becomes an immutable version once a reviewer approves it.'
            : 'Edit the draft, review its version history, or compare two versions.'
        }
        breadcrumb={
          <Link to={base} className="hover:text-brand hover:underline">
            ← Back to the question bank
          </Link>
        }
        meta={
          query.data ? (
            <>
              <QuestionStatusPill status={query.data.question.status} />
              <StatusPill tone="neutral" size="sm">
                Version {query.data.current?.version ?? 1}
              </StatusPill>
              <StatusPill tone="neutral" size="sm">
                Author {query.data.author}
              </StatusPill>
            </>
          ) : null
        }
        actions={
          !isNew && editable && query.data?.question.status !== 'IN_REVIEW' ? (
            <Button
              variant="primary"
              icon={<Send aria-hidden className="h-4 w-4" />}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
            >
              Submit for review
            </Button>
          ) : null
        }
      />

      {locked ? (
        <Alert tone="info" className="mb-6" title="This question is frozen">
          Approved and published questions cannot be edited. The fingerprint recorded at approval must stay valid, so a
          change would invalidate every paper containing this question. Retire it and author a replacement instead.
        </Alert>
      ) : null}

      {!isNew && !isAuthor && can('questions.write') ? (
        <Alert tone="info" className="mb-6" title="You are not the author of this question">
          Only the author can edit a draft. A reviewer records comments instead of editing the text directly.
        </Alert>
      ) : null}

      {!isNew ? (
        <Tabs
          className="mb-6"
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'edit', label: locked ? 'Content' : 'Edit' },
            { id: 'versions', label: 'Version history', count: query.data?.versions.length },
            { id: 'diff', label: 'Compare versions' },
            { id: 'reviews', label: 'Review comments', count: query.data?.reviews.length },
          ]}
        />
      ) : null}

      <Loadable
        isLoading={!isNew && query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        context="This question"
        skeleton={
          <Card>
            <CardBody>
              <SkeletonText lines={8} />
            </CardBody>
          </Card>
        }
      >
        {tab === 'edit' ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Question content" description="What the candidate sees, and the key that stays private." />
              <CardBody className="space-y-5">
                <Field label="Question text" htmlFor="stem" required error={errors.stem}>
                  <TextArea
                    id="stem"
                    rows={4}
                    value={draft.stem}
                    disabled={!editable}
                    invalid={Boolean(errors.stem)}
                    placeholder="Write the question exactly as the candidate should read it."
                    onChange={(event) => setDraft({ ...draft, stem: event.target.value })}
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Question type" htmlFor="type" required error={errors.type}>
                    <Select
                      id="type"
                      value={draft.type}
                      disabled={!editable}
                      onChange={(event) => {
                        const type = event.target.value as QuestionDraftInput['type'];
                        setDraft({
                          ...draft,
                          type,
                          options:
                            type === 'TRUE_FALSE'
                              ? [
                                  { label: 'A', text: 'True', isCorrect: true },
                                  { label: 'B', text: 'False', isCorrect: false },
                                ]
                              : (type === 'SHORT_TEXT' || type === 'PARAGRAPH')
                                ? []
                                : draft.options.length >= 2
                                  ? draft.options
                                  : EMPTY_DRAFT.options,
                        });
                      }}
                    >
                      <option value="SINGLE_CHOICE">Single choice</option>
                      <option value="MULTIPLE_CHOICE">Multiple choice</option>
                      <option value="TRUE_FALSE">True / false</option>
                      <option value="SHORT_TEXT">Short text</option>
                      <option value="PARAGRAPH">Paragraph</option>
                    </Select>
                  </Field>

                  <Field label="Difficulty" htmlFor="difficulty" required>
                    <Select
                      id="difficulty"
                      value={draft.difficulty}
                      disabled={!editable}
                      onChange={(event) =>
                        setDraft({ ...draft, difficulty: event.target.value as QuestionDraftInput['difficulty'] })
                      }
                    >
                      <option value="EASY">Easy</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="DIFFICULT">Difficult</option>
                    </Select>
                  </Field>

                  <Field label="Subject" htmlFor="subject" required error={errors.subject}>
                    <Select
                      id="subject"
                      value={draft.subject}
                      disabled={!editable}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          subject: event.target.value,
                          topic: TOPICS[event.target.value]?.[0] ?? '',
                        })
                      }
                    >
                      {SUBJECTS.map((subject) => (
                        <option key={subject} value={subject}>
                          {subject}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Topic" htmlFor="topic" required error={errors.topic}>
                    <Select
                      id="topic"
                      value={draft.topic}
                      disabled={!editable}
                      onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
                    >
                      {(TOPICS[draft.subject] ?? []).map((topic) => (
                        <option key={topic} value={topic}>
                          {topic}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Category" htmlFor="categoryId" required error={errors.categoryId}>
                    <Select id="categoryId" value={draft.categoryId} disabled={!editable} onChange={event => {
                      const category = categories.data?.items.find(c => c.id === event.target.value);
                      setDraft({ ...draft, categoryId: event.target.value, subject: category?.subject ?? draft.subject,
                        topic: TOPICS[category?.subject ?? draft.subject]?.[0] ?? draft.topic });
                    }}>
                      <option value="">Select a category</option>
                      {(categories.data?.items ?? []).filter(c => c.allowedTypes.includes(draft.type)).map(c =>
                        <option key={c.id} value={c.id}>{c.code} — {c.name} ({c.marksPerQuestion} marks; −{c.negativeMarksPerQuestion} incorrect)</option>)}
                    </Select>
                  </Field>
                  {!isChoice && <Field label="Marking guidance" htmlFor="markingGuidance" error={errors.markingGuidance}>
                    <TextArea id="markingGuidance" value={draft.markingGuidance} disabled={!editable}
                      onChange={event => setDraft({ ...draft, markingGuidance: event.target.value })} />
                  </Field>}
                </div>

                {isChoice ? (
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-support font-medium text-ink">
                        Options
                        <span className="ml-2 font-normal text-muted">
                          {draft.type === 'MULTIPLE_CHOICE' ? 'Mark every correct option' : 'Mark exactly one correct option'}
                        </span>
                      </p>
                      {editable && draft.type !== 'TRUE_FALSE' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Plus aria-hidden className="h-4 w-4" />}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              options: [
                                ...draft.options,
                                {
                                  label: String.fromCharCode(65 + draft.options.length),
                                  text: '',
                                  isCorrect: false,
                                },
                              ],
                            })
                          }
                        >
                          Add option
                        </Button>
                      ) : null}
                    </div>

                    {errors.options ? (
                      <p role="alert" className="mt-2 text-meta text-critical">
                        {errors.options}
                      </p>
                    ) : null}

                    <ul className="mt-3 space-y-2">
                      {draft.options.map((option, index) => (
                        <li key={index} className="flex items-start gap-3 rounded-card border border-line bg-white p-3">
                          <span className="mt-2 w-6 shrink-0 text-center text-support font-semibold text-muted">
                            {option.label}
                          </span>
                          <div className="flex-1">
                            <TextInput
                              value={option.text}
                              disabled={!editable}
                              aria-label={`Option ${option.label} text`}
                              placeholder={`Option ${option.label}`}
                              onChange={(event) => {
                                const options = [...draft.options];
                                options[index] = { ...option, text: event.target.value };
                                setDraft({ ...draft, options });
                              }}
                            />
                            <div className="mt-2">
                              <Checkbox
                                checked={option.isCorrect}
                                disabled={!editable}
                                label="Correct answer"
                                onChange={(event) => {
                                  const single = draft.type === 'SINGLE_CHOICE' || draft.type === 'TRUE_FALSE';
                                  const options = draft.options.map((o, i) =>
                                    i === index
                                      ? { ...o, isCorrect: event.target.checked }
                                      : single
                                        ? { ...o, isCorrect: false }
                                        : o,
                                  );
                                  setDraft({ ...draft, options });
                                }}
                              />
                            </div>
                          </div>
                          {editable && draft.options.length > 2 && draft.type !== 'TRUE_FALSE' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Remove option ${option.label}`}
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  options: draft.options
                                    .filter((_, i) => i !== index)
                                    .map((o, i) => ({ ...o, label: String.fromCharCode(65 + i) })),
                                })
                              }
                            >
                              <Trash2 aria-hidden className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <Alert tone="info" title="Short-text questions are marked manually">
                    This proof of concept delivers single-choice and multiple-choice questions in the candidate
                    application. Short-text questions can be authored and approved, but automatic marking is out of
                    scope.
                  </Alert>
                )}

                <Field
                  label="Explanation"
                  htmlFor="explanation"
                  hint="Never sent to the candidate application during the examination."
                >
                  <TextArea
                    id="explanation"
                    rows={3}
                    value={draft.explanation}
                    disabled={!editable}
                    onChange={(event) => setDraft({ ...draft, explanation: event.target.value })}
                  />
                </Field>

                <Field
                  label="Internal reviewer notes"
                  htmlFor="reviewerNotes"
                  hint="Visible to reviewers only. Not part of the delivered question."
                >
                  <TextArea
                    id="reviewerNotes"
                    rows={2}
                    value={draft.reviewerNotes}
                    disabled={!editable}
                    onChange={(event) => setDraft({ ...draft, reviewerNotes: event.target.value })}
                  />
                </Field>
              </CardBody>

              {editable ? (
                <CardFooter className="justify-end">
                  <Button variant="secondary" onClick={() => navigate(base)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    loading={save.isPending}
                    loadingText="Saving…"
                    icon={<Check aria-hidden className="h-4 w-4" />}
                    onClick={() => {
                      if (validate()) save.mutate();
                    }}
                  >
                    {isNew ? 'Create question' : 'Save new version'}
                  </Button>
                </CardFooter>
              ) : (
                <CardFooter>
                  <p className="flex items-center gap-2 text-support text-muted">
                    <Lock aria-hidden className="h-4 w-4" />
                    This content is read-only for you.
                  </p>
                </CardFooter>
              )}
            </Card>

            <div className="space-y-6">
              <Card as="aside">
                <CardHeader title="Integrity" description="How this question is protected once approved." />
                <CardBody className="space-y-4">
                  {query.data?.current ? (
                    <DescriptionList
                      columns={1}
                      items={[
                        {
                          term: 'Fingerprint of this version',
                          value: <HashValue value={query.data.current.contentHash} />,
                        },
                        { term: 'Created', value: formatDateTime(query.data.current.createdAt) },
                        { term: 'Immutable', value: query.data.current.immutable ? 'Yes — frozen' : 'No — still a draft' },
                      ]}
                    />
                  ) : (
                    <p className="text-support text-muted">
                      A fingerprint is calculated as soon as the question is saved.
                    </p>
                  )}
                  <InfoPanel title="Why approved questions are frozen">
                    Approval records a fingerprint of the exact content. Every paper containing this question is signed
                    against that fingerprint, so any later edit would make the paper fail verification and block its
                    release.
                  </InfoPanel>
                </CardBody>
              </Card>

              <Card as="aside">
                <CardHeader title="Approval route" />
                <CardBody>
                  <ol className="space-y-3">
                    {[
                      { label: 'Author writes the draft', done: true },
                      { label: 'Author submits for review', done: query.data ? query.data.question.status !== 'DRAFT' : false },
                      {
                        label: 'A different reviewer approves',
                        done: query.data ? ['APPROVED', 'PUBLISHED'].includes(query.data.question.status) : false,
                      },
                      {
                        label: 'Question is frozen and can enter a paper',
                        done: query.data ? ['APPROVED', 'PUBLISHED'].includes(query.data.question.status) : false,
                      },
                    ].map((step, index) => (
                      <li key={step.label} className="flex items-start gap-3">
                        <span
                          className={`tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-meta font-semibold ${
                            step.done ? 'border-success bg-success text-white' : 'border-line bg-white text-muted'
                          }`}
                        >
                          {step.done ? <Check aria-hidden className="h-3.5 w-3.5" /> : index + 1}
                        </span>
                        <span className="text-support text-ink">{step.label}</span>
                      </li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'versions' && query.data ? (
          <Card>
            <CardHeader title="Version history" description="Every saved revision, with the fingerprint at that point." />
            <CardBody>
              <ol className="space-y-3">
                {[...query.data.versions].reverse().map((version) => (
                  <li key={version.id} className="rounded-card border border-line bg-page p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-support font-semibold text-ink">Version {version.version}</p>
                      <div className="flex items-center gap-2">
                        <QuestionStatusPill status={version.status} />
                        {version.immutable ? (
                          <StatusPill tone="neutral" size="sm" icon={<Lock aria-hidden className="h-3.5 w-3.5" />}>
                            Frozen
                          </StatusPill>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-support text-muted">{version.stem}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <HashValue value={version.contentHash} label="Fingerprint" />
                      <span className="text-meta text-muted">{formatDateTime(version.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        ) : null}

        {tab === 'diff' && questionId ? (
          <Card>
            <CardHeader
              icon={<GitCompare aria-hidden className="h-5 w-5" />}
              title="Compare versions"
              description="What changed between two revisions of this question."
            />
            <CardBody>
              <QuestionDiff questionId={questionId} />
            </CardBody>
          </Card>
        ) : null}

        {tab === 'reviews' && query.data ? (
          <Card>
            <CardHeader title="Review comments" description="Decisions recorded by reviewers." />
            <CardBody>
              {query.data.reviews.length === 0 ? (
                <p className="text-support text-muted">No review has been recorded for this question yet.</p>
              ) : (
                <ul className="space-y-3">
                  {query.data.reviews.map((review) => (
                    <li key={review.id} className="rounded-card border border-line bg-page p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-support font-medium text-ink">{review.reviewerName}</p>
                        <StatusPill tone={review.decision === 'APPROVED' ? 'success' : 'warning'} size="sm">
                          {review.decision === 'APPROVED' ? 'Approved' : 'Changes requested'}
                        </StatusPill>
                      </div>
                      <p className="mt-2 text-support text-muted">{review.comment}</p>
                      <p className="mt-2 text-meta text-muted">{formatDateTime(review.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : null}
      </Loadable>
    </div>
  );
}
