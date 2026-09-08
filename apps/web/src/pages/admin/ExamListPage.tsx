import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Plus, Search } from 'lucide-react';
import { SECURITY_PROFILE_DEFINITIONS, type SecurityProfileId } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatDateTime, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, SkeletonTable } from '@/components/ui/Feedback';
import { ExamStatusPill, StatusPill } from '@/components/ui/Status';
import { Select, TextInput } from '@/components/ui/Form';
import { Loadable } from '@/components/ui/QueryState';

interface ExamRow {
  id: string;
  name: string;
  code: string;
  subject: string;
  status: string;
  startsAt: string;
  durationMinutes: number;
  centreName: string;
  securityProfileId: SecurityProfileId;
  totalQuestions: number;
  totalMarks: number;
  candidateCount: number;
  activeAttempts: number;
  submitted: number;
  manifestId: string | null;
}

export function ExamListPage() {
  const navigate = useNavigate();
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const query = useQuery({
    queryKey: ['exams'],
    queryFn: () => api.get<{ items: ExamRow[]; total: number }>('/exams'),
  });

  const rows = (query.data?.items ?? []).filter((exam) => {
    const matchesSearch =
      !search ||
      exam.name.toLowerCase().includes(search.toLowerCase()) ||
      exam.code.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (!status || exam.status === status);
  });

  const columns: Column<ExamRow>[] = [
    {
      key: 'name',
      header: 'Examination',
      render: (exam) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{exam.name}</p>
          <p className="text-meta text-muted">
            {exam.code} · {exam.subject}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (exam) => <ExamStatusPill status={exam.status} /> },
    {
      key: 'schedule',
      header: 'Starts',
      hideBelow: 'md',
      render: (exam) => (
        <div>
          <p className="text-ink">{formatDateTime(exam.startsAt)}</p>
          <p className="text-meta text-muted">{exam.durationMinutes} minutes</p>
        </div>
      ),
    },
    { key: 'centre', header: 'Centre', hideBelow: 'lg', render: (exam) => exam.centreName },
    {
      key: 'candidates',
      header: 'Candidates',
      render: (exam) => <span className="tnum">{formatNumber(exam.candidateCount)}</span>,
    },
    {
      key: 'paper',
      header: 'Paper',
      hideBelow: 'lg',
      render: (exam) => (
        <span className="tnum text-muted">
          {exam.totalQuestions} questions · {exam.totalMarks} marks
        </span>
      ),
    },
    {
      key: 'profile',
      header: 'Security profile',
      hideBelow: 'xl',
      render: (exam) => (
        <StatusPill tone={exam.securityProfileId === 'MAXIMUM_ASSURANCE' ? 'brand' : 'neutral'} size="sm">
          {SECURITY_PROFILE_DEFINITIONS[exam.securityProfileId]?.name ?? exam.securityProfileId}
        </StatusPill>
      ),
    },
    {
      key: 'action',
      header: <span className="sr-only">Open</span>,
      className: 'text-right',
      render: (exam) => (
        <Link to={`/admin/exams/${exam.id}`} className="text-support font-medium text-brand hover:underline">
          Open
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Examinations"
        description="Every examination in the cycle, with its schedule, candidate count, paper size and security profile."
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

      <Card>
        <CardHeader
          title={`${rows.length} examination${rows.length === 1 ? '' : 's'}`}
          description="Filter by status or search by name and code."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                />
                <TextInput
                  className="w-56 pl-9"
                  placeholder="Search name or code"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search examinations"
                />
              </div>
              <Select
                className="w-44"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PENDING_APPROVAL">Awaiting approval</option>
                <option value="PUBLISHED">Published</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            </div>
          }
        />

        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="Examinations"
          skeleton={<SkeletonTable rows={5} columns={6} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(exam) => exam.id}
            onRowClick={(exam) => navigate(`/admin/exams/${exam.id}`)}
            caption="Examinations"
            emptyState={
              <EmptyState
                icon={<CalendarClock aria-hidden className="h-6 w-6" />}
                title={search || status ? 'No examinations match those filters' : 'No examinations yet'}
                description={
                  search || status
                    ? 'Clear the search or status filter to see the full list.'
                    : 'Create an examination to begin authoring, approval and publication.'
                }
                action={
                  search || status ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        setStatus('');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : can('exams.write') ? (
                    <Link to="/admin/exams/new">
                      <Button variant="primary">Create examination</Button>
                    </Link>
                  ) : null
                }
              />
            }
          />
        </Loadable>
      </Card>
    </div>
  );
}
