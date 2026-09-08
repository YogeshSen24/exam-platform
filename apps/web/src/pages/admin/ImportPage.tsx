import { useFacialExport } from '@/components/domain/useFacialExport';
import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IMPORT_COLUMNS, type ImportKind, type ImportValidation, type ImportResult } from '@sep/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { parseCsv, downloadFile } from '@/lib/csv';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';

export function ImportPage() {
  const facial = useFacialExport();
  const { can } = useSession(); const cache = useQueryClient();
  const [kind, setKind] = useState<ImportKind>('CANDIDATES');
  const { examId = '' } = useParams(); const [reason, setReason] = useState('');
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/exams') });
  const kinds: ImportKind[] = ['CANDIDATES', 'CANDIDATE_DEVICE_ASSIGNMENTS', ...(can('devices.write') ? ['DEVICES', 'NETWORK_RANGES'] as ImportKind[] : [])];
  async function validate(file?: File) {
    setValidation(null); setError(''); setMessage(''); if (!file) return;
    setBusy(true);
    try {
      if (file.size > 5_000_000) throw new Error('Use a CSV smaller than 5 MB.');
      const parsed = parseCsv(await file.text());
      const rows = parsed.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [IMPORT_COLUMNS[kind].find(c => c.header === key)?.key ?? key, value])));
      const response = await api.post<{ validation: ImportValidation }>('/import/validate', { kind, examId: examId || undefined, fileName: file.name, rows });
      setValidation(response.validation);
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); } finally { setBusy(false); }
  }
  async function commit() {
    if (!validation) return; setBusy(true); setError('');
    try { const response = await api.post<{ result: ImportResult }>('/import/commit', { token: validation.token, reason });
      setMessage(response.result.summary); setValidation(null); await cache.invalidateQueries();
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); } finally { setBusy(false); }
  }
  return <div>{facial.dialog}<PageHeader title="Import records" description="Upload a CSV, review every validation issue, then apply the records." />
    <Card><CardBody className="space-y-5">
      <Field label="Record type" htmlFor="import-kind"><Select id="import-kind" disabled={busy} value={kind} onChange={e => { setKind(e.target.value as ImportKind); setValidation(null); }}>
        {kinds.map(k => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}
      </Select></Field>
      <Button onClick={() => facial.begin(`template:${kind}`, () => downloadFile(`${kind.toLowerCase()}-template.csv`, IMPORT_COLUMNS[kind].map(c => c.key).join(',') + '\n' + IMPORT_COLUMNS[kind].map(c => '"' + c.example.replaceAll('"', '""') + '"').join(','), 'text/csv'))}>Download CSV template</Button>
      <Field label="CSV file" htmlFor="import-file"><input id="import-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { void validate(e.target.files?.[0]); e.target.value = ''; }} /></Field>
      {busy && <p role="status">Processing records…</p>}
      {error && <Alert tone="critical" title="Import could not complete">{error}</Alert>}
      {message && <Alert tone="success" title="Import complete">{message}</Alert>}
      {validation && <div className="space-y-4"><p>{validation.summary}</p>
        <p>{validation.createCount} new · {validation.updateCount} updates · {validation.rejectCount} rejected</p>
        <ul>{validation.issues.map((issue, i) => <li key={i}>Row {issue.row}, {issue.column}: {issue.message}</li>)}</ul>
        <Field label="Reason for import" htmlFor="import-reason"><TextInput id="import-reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
        <Button variant="primary" disabled={busy || !validation.canCommit || reason.trim().length < 5} onClick={() => void commit()}>Apply validated records</Button>
      </div>}
    </CardBody></Card></div>;
}
