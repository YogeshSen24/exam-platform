import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Minus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Select } from '@/components/ui/Form';
import { SkeletonText } from '@/components/ui/Feedback';
import { HashValue } from '@/components/ui/Explain';
import { StatusPill } from '@/components/ui/Status';
import { QueryError } from '@/components/ui/QueryState';

interface DiffResponse {
  from: { version: number; contentHash: string; createdAt: string };
  to: { version: number; contentHash: string; createdAt: string };
  fields: { field: string; before: string; after: string; changed: boolean }[];
  options: {
    label: string;
    before: string;
    after: string;
    changed: boolean;
    correctBefore: boolean;
    correctAfter: boolean;
  }[];
  versions: { version: number; createdAt: string; status: string }[];
}

/** Readable difference between two versions of one question. */
export function QuestionDiff({ questionId }: { questionId: string }) {
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  const query = useQuery({
    queryKey: ['question-diff', questionId, from, to],
    queryFn: () => api.get<DiffResponse>(`/questions/${questionId}/diff`, { from, to }),
  });

  if (query.isLoading) return <SkeletonText lines={6} />;
  if (query.error) return <QueryError error={query.error} onRetry={() => void query.refetch()} context="The comparison" />;
  if (!query.data) return null;

  const { versions, fields, options } = query.data;

  if (versions.length < 2) {
    return (
      <p className="text-support text-muted">
        This question has only one version, so there is nothing to compare yet. A new version is created each time the
        author saves a change.
      </p>
    );
  }

  const changedCount = fields.filter((f) => f.changed).length + options.filter((o) => o.changed).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-support font-medium text-ink">Compare from</span>
          <Select
            className="w-40"
            value={from || String(query.data.from.version)}
            onChange={(event) => setFrom(event.target.value)}
          >
            {versions.map((version) => (
              <option key={version.version} value={version.version}>
                Version {version.version}
              </option>
            ))}
          </Select>
        </label>
        <ArrowRight aria-hidden className="mb-2.5 h-5 w-5 text-muted" />
        <label className="flex flex-col gap-1.5">
          <span className="text-support font-medium text-ink">Compare to</span>
          <Select
            className="w-40"
            value={to || String(query.data.to.version)}
            onChange={(event) => setTo(event.target.value)}
          >
            {versions.map((version) => (
              <option key={version.version} value={version.version}>
                Version {version.version}
              </option>
            ))}
          </Select>
        </label>
        <StatusPill tone={changedCount === 0 ? 'neutral' : 'warning'} className="mb-2">
          {changedCount === 0 ? 'No differences' : `${changedCount} change${changedCount === 1 ? '' : 's'}`}
        </StatusPill>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-page px-4 py-3">
          <p className="text-meta uppercase tracking-wide text-muted">Version {query.data.from.version}</p>
          <p className="mt-1 text-meta text-muted">{formatDateTime(query.data.from.createdAt)}</p>
          <div className="mt-2">
            <HashValue value={query.data.from.contentHash} />
          </div>
        </div>
        <div className="rounded-card border border-line bg-page px-4 py-3">
          <p className="text-meta uppercase tracking-wide text-muted">Version {query.data.to.version}</p>
          <p className="mt-1 text-meta text-muted">{formatDateTime(query.data.to.createdAt)}</p>
          <div className="mt-2">
            <HashValue value={query.data.to.contentHash} />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-page">
              <th scope="col" className="px-4 py-2.5 text-meta font-semibold uppercase tracking-wide text-muted">
                Field
              </th>
              <th scope="col" className="px-4 py-2.5 text-meta font-semibold uppercase tracking-wide text-muted">
                Before
              </th>
              <th scope="col" className="px-4 py-2.5 text-meta font-semibold uppercase tracking-wide text-muted">
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.field} className="border-b border-line last:border-0">
                <td className="px-4 py-3 align-top text-support font-medium text-ink">
                  <span className="flex items-center gap-2">
                    {field.field}
                    {field.changed ? (
                      <StatusPill tone="warning" size="sm">
                        Changed
                      </StatusPill>
                    ) : null}
                  </span>
                </td>
                <td
                  className={`px-4 py-3 align-top text-support ${
                    field.changed ? 'bg-critical-soft text-ink' : 'text-muted'
                  }`}
                >
                  {field.before || <Minus aria-hidden className="h-4 w-4 text-muted" />}
                </td>
                <td
                  className={`px-4 py-3 align-top text-support ${
                    field.changed ? 'bg-success-soft text-ink' : 'text-muted'
                  }`}
                >
                  {field.after || <Minus aria-hidden className="h-4 w-4 text-muted" />}
                </td>
              </tr>
            ))}
            {options.map((option) => (
              <tr key={`option-${option.label}`} className="border-b border-line last:border-0">
                <td className="px-4 py-3 align-top text-support font-medium text-ink">
                  <span className="flex items-center gap-2">
                    Option {option.label}
                    {option.changed ? (
                      <StatusPill tone="warning" size="sm">
                        Changed
                      </StatusPill>
                    ) : null}
                    {option.correctBefore !== option.correctAfter ? (
                      <StatusPill tone="critical" size="sm">
                        Answer key changed
                      </StatusPill>
                    ) : null}
                  </span>
                </td>
                <td
                  className={`px-4 py-3 align-top text-support ${
                    option.changed ? 'bg-critical-soft text-ink' : 'text-muted'
                  }`}
                >
                  {option.before}
                  {option.correctBefore ? <span className="ml-2 text-meta text-success">(correct)</span> : null}
                </td>
                <td
                  className={`px-4 py-3 align-top text-support ${
                    option.changed ? 'bg-success-soft text-ink' : 'text-muted'
                  }`}
                >
                  {option.after}
                  {option.correctAfter ? <span className="ml-2 text-meta text-success">(correct)</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
