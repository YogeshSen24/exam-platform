import { useFacialExport } from './useFacialExport';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EXPORT_SECTIONS, type Permission, type ExportSection, type TrackingSnapshot } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { downloadFile } from '@/lib/csv';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';

export function ExamOperations({ examId }: { examId: string }) {
  const facial = useFacialExport();
  const { can } = useSession(); const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<ExportSection[]>(['EXAM_CONFIGURATION']);
  const [pseudonymise, setPseudonymise] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const tracking = useQuery({ queryKey: ['tracking', examId], queryFn: () => api.get<{ snapshot: TrackingSnapshot }>(`/tracking/exams/${examId}`), enabled: can('invigilation.read'), refetchInterval: 30000 });
  async function exportExam(token: string) {
    setBusy(true); setError('');
    try { const result = await api.post(`/exams/${examId}/export`, { sections: selected, format: 'JSON', reason, pseudonymise }, { exportVerification: token });
      downloadFile(`${examId}-export.json`, JSON.stringify(result, null, 2));
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed.'); } finally { setBusy(false); }
  }
  return <div className="my-6 grid gap-6 lg:grid-cols-2">{facial.dialog}
    <Card><CardHeader title="Export examination" description="Choose the records to include in a downloadable JSON report." /><CardBody className="space-y-4">
      {EXPORT_SECTIONS.filter(s => can(s.requiredPermission as Permission)).map(s => <label key={s.id} className="block text-support">
        <input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} /> {s.label}
      </label>)}
      <label className="block"><input type="checkbox" checked={pseudonymise} onChange={e => setPseudonymise(e.target.checked)} /> Replace personal identifiers with anonymous tokens</label>
      <Field label="Reason for export" htmlFor="export-reason"><TextInput id="export-reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {error && <Alert tone="critical" title="Export failed">{error}</Alert>}
      <Button variant="primary" disabled={busy || !selected.length || reason.trim().length < 10} onClick={() => facial.begin(`exam:${examId}`, exportExam)}>Download report</Button>
    </CardBody></Card>
    {can('invigilation.read') && <Card><CardHeader title="Live examination checks" description="Checks refresh every 30 seconds." /><CardBody className="space-y-4">
      {tracking.isPending && <p>Loading checks…</p>}
      {tracking.isError && <Alert tone="critical" title="Checks unavailable">{tracking.error.message}</Alert>}
      {tracking.data && <><p>{tracking.data.snapshot.overall} · {tracking.data.snapshot.delivery.active} active · {tracking.data.snapshot.delivery.submitted} submitted</p>
        {tracking.data.snapshot.openFindings.map(f => <div key={f.id} className="border-t border-line pt-3"><p className="font-medium">{f.title}</p><p>{f.detail}</p><p className="text-support text-muted">{f.action}</p></div>)}
        {!tracking.data.snapshot.openFindings.length && <p>No open findings.</p>}
      </>}
    </CardBody></Card>}
  </div>;
}
