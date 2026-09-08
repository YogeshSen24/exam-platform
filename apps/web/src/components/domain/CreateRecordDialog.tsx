import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Overlay';
import { Field, TextInput } from '@/components/ui/Form';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Misc';
export function CreateRecordDialog({ title, endpoint, fields, extra = {}, onClose }: {
  title: string; endpoint: string; fields: { key: string; label: string; type?: 'text' | 'email' | 'number'; hint?: string; min?: number; value?: string }[];
  extra?: Record<string, unknown>; onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string,string>>(Object.fromEntries(fields.map(f => [f.key, f.value ?? ''])));
  const [error, setError] = useState(''); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const cache = useQueryClient(); const toast = useToast();
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setFieldErrors({});
    try { await api.post(endpoint, { ...extra, ...Object.fromEntries(fields.map(f => [f.key, f.type === 'number' ? Number(values[f.key]) : values[f.key]?.trim()])) });
      await cache.invalidateQueries(); toast.push({ tone: 'success', title: `${title.replace(/^Add /, '')} created` }); onClose();
    } catch (e) { setError(e instanceof ApiError ? `${e.message} ${e.guidance}` : 'Unable to save. Please try again.');
      if (e instanceof ApiError) { const details = e.details as { fieldErrors?: Record<string, string[]> } | undefined; setFieldErrors(Object.fromEntries(Object.entries(details?.fieldErrors ?? {}).map(([key, errors]) => [key, errors.join(' ')]))); } } finally { setBusy(false); }
  }
  return <Modal open title={title} description="Complete the details below. Required fields are marked." onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={submit} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2">
      {fields.map(f => <Field key={f.key} label={f.label} htmlFor={`create-${f.key}`} required hint={f.hint} error={fieldErrors[f.key]}>
        <TextInput id={`create-${f.key}`} type={f.type ?? 'text'} required min={f.min} value={values[f.key] ?? ''} onChange={e => setValues({ ...values, [f.key]: e.target.value })} disabled={busy} />
      </Field>)}
    </div>{error && <Alert tone="critical" title="Please check the details">{error}</Alert>}
    <div className="flex justify-end gap-3 border-t border-line pt-4"><Button type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>{title}</Button></div>
    </form>
  </Modal>;
}
