import { useSession } from '@/lib/session';
import { CreateRecordDialog } from '@/components/domain/CreateRecordDialog';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Accessibility, Search, UserSquare2 } from 'lucide-react';
import type { Candidate } from '@sep/shared';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardHeader } from '@/components/ui/Card';
import { DataTable, Pagination, type Column } from '@/components/ui/DataTable';
import { EmptyState, SkeletonTable } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Select, TextInput } from '@/components/ui/Form';
import { Loadable } from '@/components/ui/QueryState';
import { Avatar } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { InfoPanel } from '@/components/ui/Explain';

type CandidateRow = Candidate & { centreName: string | null; examName: string | null };

export function CandidateListPage() {
  const navigate = useNavigate();
  const { examId } = useParams();
  const base = `/admin/exams/${examId}/candidates`;
  const { can } = useSession(); const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [accommodations, setAccommodations] = useState('');

  const query = useQuery({
    queryKey: ['candidates', { examId, search, eligibility, accommodations, page }],
    queryFn: () =>
      api.get<{ items: CandidateRow[]; total: number; page: number; pageSize: number }>('/candidates', {
        examId,
        search,
        eligibility,
        accommodations,
        page,
        pageSize: 25,
      }),
  });

  const columns: Column<CandidateRow>[] = [
    {
      key: 'candidate',
      header: 'Candidate',
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.fullName} seed={row.photoSeed} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-ink">{row.fullName}</p>
            <p className="font-mono text-meta text-muted">{row.applicationId}</p>
          </div>
        </div>
      ),
    },
    { key: 'candidateId', header: 'Candidate ID', hideBelow: 'md', render: (row) => <code className="font-mono text-meta">{row.candidateId}</code> },
    {
      key: 'eligibility',
      header: 'Eligibility',
      render: (row) => (
        <StatusPill
          size="sm"
          tone={row.eligibility === 'ELIGIBLE' ? 'success' : row.eligibility === 'PROVISIONAL' ? 'warning' : 'critical'}
        >
          {row.eligibility.charAt(0) + row.eligibility.slice(1).toLowerCase()}
        </StatusPill>
      ),
    },
    {
      key: 'biometrics',
      header: 'Enrolment',
      hideBelow: 'lg',
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusPill size="sm" tone={row.faceEnrolled ? 'success' : 'neutral'}>
            {row.faceEnrolled ? 'Face enrolled' : 'No face'}
          </StatusPill>
          <StatusPill size="sm" tone={row.fingerprintEnrolled ? 'success' : 'neutral'}>
            {row.fingerprintEnrolled ? 'Fingerprint enrolled' : 'No fingerprint'}
          </StatusPill>
        </div>
      ),
    },
    {
      key: 'accommodations',
      header: 'Accommodations',
      hideBelow: 'xl',
      render: (row) =>
        row.accommodations.additionalTimeMinutes > 0 || row.accommodations.requirements.length > 0 ? (
          <StatusPill size="sm" tone="info" icon={<Accessibility aria-hidden className="h-3.5 w-3.5" />}>
            +{row.accommodations.additionalTimeMinutes} min
          </StatusPill>
        ) : (
          <span className="text-muted">None</span>
        ),
    },
    {
      key: 'open',
      header: <span className="sr-only">Open</span>,
      className: 'text-right',
      render: (row) => (
        <Link to={`${base}/${row.id}`} className="text-support font-medium text-brand hover:underline">
          Open
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Candidates"
        actions={can('candidates.write') && <div className="flex gap-2"><Link to={`/admin/exams/${examId}/import`}><Button>Import CSV</Button></Link><Button variant="primary" onClick={() => setCreating(true)}>Add candidate</Button></div>}
        description="Manage registration and accommodations for candidates in this examination."
        meta={<StatusPill tone="neutral" size="sm">{formatNumber(query.data?.total ?? 0)} registered</StatusPill>}
      />

      {creating && <CreateRecordDialog title="Add candidate" endpoint="/candidates" extra={{ examId }} onClose={() => setCreating(false)} fields={[
        { key: 'fullName', label: 'Full name' }, { key: 'applicationId', label: 'Application ID' },
        { key: 'email', label: 'Email address', type: 'email' }, { key: 'additionalTimeMinutes', label: 'Additional time (minutes)', type: 'number', min: 0, value: '0' },
      ]} />}
      <Card>
        <CardHeader
          title="Candidate register"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <TextInput
                  className="w-60 pl-9"
                  placeholder="Search name or application ID"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  aria-label="Search candidates"
                />
              </div>
              <Select
                className="w-40"
                value={eligibility}
                onChange={(event) => {
                  setEligibility(event.target.value);
                  setPage(1);
                }}
                aria-label="Filter by eligibility"
              >
                <option value="">All eligibility</option>
                <option value="ELIGIBLE">Eligible</option>
                <option value="PROVISIONAL">Provisional</option>
                <option value="INELIGIBLE">Ineligible</option>
              </Select>
              <Select
                className="w-48"
                value={accommodations}
                onChange={(event) => {
                  setAccommodations(event.target.value);
                  setPage(1);
                }}
                aria-label="Filter by accommodations"
              >
                <option value="">All candidates</option>
                <option value="true">With accommodations</option>
              </Select>
            </div>
          }
        />

        <Loadable
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          context="The candidate register"
          skeleton={<SkeletonTable rows={8} columns={6} />}
        >
          <>
            <DataTable
              columns={columns}
              rows={query.data?.items ?? []}
              getRowKey={(row) => row.id}
              onRowClick={(row) => navigate(`${base}/${row.id}`)}
              caption="Candidate register"
              emptyState={
                <EmptyState
                  icon={<UserSquare2 aria-hidden className="h-6 w-6" />}
                  title={search || eligibility || accommodations ? "No candidates match those filters" : "No candidates registered yet"}
                  description={search || eligibility || accommodations ? "Clear the search or filters to see the full register." : "Add your first candidate or import a CSV register for this examination."}
                  action={search || eligibility || accommodations ?
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        setEligibility('');
                        setAccommodations('');
                      }}
                    >
                      Clear filters
                    </Button> : can('candidates.write') ? <Button variant="primary" onClick={() => setCreating(true)}>Add candidate</Button> : undefined
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
                label="candidates"
              />
            ) : null}
          </>
        </Loadable>
      </Card>
    </div>
  );
}
