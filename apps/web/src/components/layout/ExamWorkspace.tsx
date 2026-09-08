import type { ReactNode } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Exam, Permission } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ExamStatusPill } from '@/components/ui/Status';
import { Loadable } from '@/components/ui/QueryState';
import { SkeletonText } from '@/components/ui/Feedback';
export function ExamWorkspace({ children }: { children: ReactNode }) {
  const { examId } = useParams(); const { can } = useSession();
  const query = useQuery({ queryKey: ['exam', examId], queryFn: () => api.get<{ exam: Exam }>(`/exams/${examId}`) });
  const tabs: { label: string; path: string; permission: Permission }[] = [
    { label: 'Overview', path: '', permission: 'exams.read' },
    { label: 'Candidates', path: '/candidates', permission: 'candidates.read' },
    { label: 'Question bank', path: '/questions', permission: 'questions.read' },
    { label: 'Paper builder', path: '/paper', permission: 'questions.read' },
    { label: 'Integrity & approvals', path: '/integrity', permission: 'exams.read' },
  ];
  return <Loadable isLoading={query.isPending} error={query.error} onRetry={() => void query.refetch()} context="Examination" skeleton={<SkeletonText />}>
    {query.data && <><div className="exam-context">
      <Link to="/admin/exams" className="text-support text-muted hover:text-brand">← All examinations</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div><p className="text-meta font-semibold uppercase tracking-wide text-brand">{query.data.exam.code}</p>
        <h2 className="mt-1 text-section font-semibold tracking-tight">{query.data.exam.name}</h2></div><ExamStatusPill status={query.data.exam.status} /></div>
      <nav aria-label="Examination navigation" className="mt-5 flex gap-1 overflow-x-auto border-t border-line pt-3">
        {tabs.filter(t => can(t.permission)).map(t => <NavLink key={t.path} end={!t.path} to={`/admin/exams/${examId}${t.path}`}
          className={({ isActive }) => `whitespace-nowrap rounded-control px-4 py-2 text-support font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-panel hover:text-ink'}`}>{t.label}</NavLink>)}
      </nav>
    </div><div className="exam-content">{children}</div></>}
  </Loadable>;
}
