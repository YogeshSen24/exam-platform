import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { DIFFICULTY_LABELS, SUBJECTS, TOPICS, type Difficulty, type QuestionStatus, type QuestionType } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDate, shortHash } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { EmptyState, SkeletonTable } from '@/components/ui/Feedback';
import { QuestionStatusPill, StatusPill } from '@/components/ui/Status';
import { Select, TextInput } from '@/components/ui/Form';
import { Loadable } from '@/components/ui/QueryState';

interface QuestionRow {
  id: string;
  code: string;
  stem: string;
  status: QuestionStatus;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  marks: number;
  type: QuestionType;
  version: number;
  authorName: string;
  authorUserId: string;
  contentHash: string;
  optionCount: number;
  createdAt: string;
  updatedAt: string;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'Single choice',
  MULTIPLE_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True / false',
  SHORT_TEXT: 'Short text',
  PARAGRAPH: 'Paragraph',
};

export function QuestionBankPage() {
  const navigate = useNavigate();
  const { examId } = useParams();
  const base = `/admin/exams/${examId}/questions`;
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: '',
    subject: '',
    topic: '',
    difficulty: '',
    status: '',
    type: '',
  });

  const query = useQuery({
    queryKey: ['questions', examId, filters, page],
    queryFn: () =>
      api.get<{ items: QuestionRow[]; total: number; page: number; pageSize: number }>('/questions', {
        ...filters,
        examId,
        page,
        pageSize: 20,
      }),
  });

  const update = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value, ...(key === 'subject' ? { topic: '' } : {}) }));
    setPage(1);
  };

  const columns: Column<QuestionRow>[] = [
    {
      key: 'question',
      header: 'Question',
      render: (row) => (
        <div className="min-w-0 max-w-xl">
          <p className="flex items-center gap-2 font-medium text-ink">
            <span className="font-mono text-meta text-muted">{row.code}</span>
            <span className="text-meta text-muted">v{row.version}</span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-support text-muted">{row.stem}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <QuestionStatusPill status={row.status} /> },
    {
      key: 'classification',
      header: 'Subject and topic',
      hideBelow: 'md',
      render: (row) => (
        <div>
          <p className="text-ink">{row.subject}</p>
          <p className="text-meta text-muted">{row.topic}</p>
        </div>
      ),
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      hideBelow: 'lg',
      render: (row) => (
        <StatusPill
          size="sm"
          tone={row.difficulty === 'EASY' ? 'success' : row.difficulty === 'MEDIUM' ? 'info' : 'warning'}
        >
          {DIFFICULTY_LABELS[row.difficulty]}
        </StatusPill>
      ),
    },
    { key: 'marks', header: 'Marks', hideBelow: 'lg', render: (row) => <span className="tnum">{row.marks}</span> },
    { key: 'type', header: 'Type', hideBelow: 'xl', render: (row) => TYPE_LABELS[row.type] },
    { key: 'author', header: 'Author', hideBelow: 'xl', render: (row) => row.authorName },
    {
      key: 'hash',
      header: 'Fingerprint',
      hideBelow: 'xl',
      render: (row) => <code className="font-mono text-meta text-muted">{shortHash(row.contentHash, 6)}</code>,
    },
    { key: 'created', header: 'Created', hideBelow: 'xl', render: (row) => formatDate(row.createdAt) },
  ];

  const activeFilters = Object.values(filters).filter(Boolean).length;

  return (
    <div>
      <PageHeader
        title="Question bank"
        description="Every question, its review status and the fingerprint that will be checked before delivery."
        actions={
          can('questions.write') ? (
            <Link to={`${base}/new`}>
              <Button variant="primary" icon={<Plus aria-hidden className="h-4 w-4" />}>
                New question
              </Button>
            </Link>
          ) : null
        }
      />

      <Card>
        <CardHeader
          icon={<SlidersHorizontal aria-hidden className="h-5 w-5" />}
          title="Filters"
          description="Narrow the bank by subject, topic, difficulty, status or type."
          actions={
            activeFilters > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFilters({ search: '', subject: '', topic: '', difficulty: '', status: '', type: '' });
                  setPage(1);
                }}
              >
                Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
              </Button>
            ) : null
          }
        />
        <div className="grid gap-3 px-6 py-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <TextInput
              className="pl-9"
              placeholder="Search question text or code"
              value={filters.search}
              onChange={(event) => update('search', event.target.value)}
              aria-label="Search questions"
            />
          </div>
          <Select value={filters.subject} onChange={(event) => update('subject', event.target.value)} aria-label="Subject">
            <option value="">All subjects</option>
            {SUBJECTS.map((subject) => (
              <option key={subject} value={subject}>
                {subject}
              </option>
            ))}
          </Select>
          <Select
            value={filters.topic}
            onChange={(event) => update('topic', event.target.value)}
            aria-label="Topic"
            disabled={!filters.subject}
          >
            <option value="">All topics</option>
            {(TOPICS[filters.subject] ?? []).map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </Select>
          <Select
            value={filters.difficulty}
            onChange={(event) => update('difficulty', event.target.value)}
            aria-label="Difficulty"
          >
            <option value="">All difficulties</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="DIFFICULT">Difficult</option>
          </Select>
          <Select value={filters.status} onChange={(event) => update('status', event.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="IN_REVIEW">In review</option>
            <option value="CHANGES_REQUESTED">Changes requested</option>
            <option value="APPROVED">Approved</option>
            <option value="PUBLISHED">Published</option>
            <option value="RETIRED">Retired</option>
          </Select>
        </div>

        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="The question bank"
          skeleton={<SkeletonTable rows={8} columns={6} />}
        >
          <>
            <DataTable
              columns={columns}
              rows={query.data?.items ?? []}
              getRowKey={(row) => row.id}
              onRowClick={(row) => navigate(`${base}/${row.id}`)}
              caption="Question bank"
              emptyState={
                <EmptyState
                  icon={<BookOpenCheck aria-hidden className="h-6 w-6" />}
                  title={activeFilters > 0 ? 'No questions match those filters' : 'The question bank is empty'}
                  description={
                    activeFilters > 0
                      ? 'Clear one or more filters to widen the search.'
                      : 'Author a question to begin. Questions must be approved by a different person before they can enter a paper.'
                  }
                  action={
                    can('questions.write') && activeFilters === 0 ? (
                      <Link to={`${base}/new`}>
                        <Button variant="primary">Create the first question</Button>
                      </Link>
                    ) : null
                  }
                />
              }
            />
            {query.data && query.data.total > query.data.pageSize ? (
              <Pagination
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onPageChange={setPage}
                label="questions"
              />
            ) : null}
          </>
        </Loadable>
      </Card>
    </div>
  );
}
