import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Network } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Overlay';
import { Field, TextArea, TextInput } from '@/components/ui/Form';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Misc';

export interface NetworkRanges {
  primaryCidr: string;
  backupCidr?: string | null;
  ipv6Cidr?: string | null;
}

/**
 * Edits the approved network ranges of a centre or of one examination.
 *
 * A bare address is accepted and stored as a single-host range, because the
 * usual reason to open this dialog is one machine reporting from one address.
 */
export function NetworkRangesDialog({
  title,
  description,
  endpoint,
  ranges,
  onClose,
}: {
  title: string;
  description: string;
  endpoint: string;
  ranges: NetworkRanges;
  onClose: () => void;
}) {
  const [primaryCidr, setPrimaryCidr] = useState(ranges.primaryCidr);
  const [backupCidr, setBackupCidr] = useState(ranges.backupCidr ?? '');
  const [ipv6Cidr, setIpv6Cidr] = useState(ranges.ipv6Cidr ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  const toast = useToast();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      const result = await api.post<{ realignedAssignments?: number }>(endpoint, {
        primaryCidr: primaryCidr.trim(),
        backupCidr: backupCidr.trim(),
        ipv6Cidr: ipv6Cidr.trim(),
        reason: reason.trim(),
      });
      await cache.invalidateQueries();
      toast.push({
        tone: 'success',
        title: 'Approved networks updated',
        description:
          result.realignedAssignments && result.realignedAssignments > 0
            ? `${result.realignedAssignments} candidate assignment${
                result.realignedAssignments === 1 ? '' : 's'
              } followed the change. Candidates on their own ranges were left alone.`
            : 'The change is recorded in the audit trail.',
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? `${caught.message} ${caught.guidance}` : 'Unable to save. Please try again.');
      if (caught instanceof ApiError) {
        const details = caught.details as { fieldErrors?: Record<string, string[]> } | undefined;
        setFieldErrors(
          Object.fromEntries(Object.entries(details?.fieldErrors ?? {}).map(([key, errors]) => [key, errors.join(' ')])),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={title}
      description={description}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="flex gap-3 rounded-card border border-line bg-panel px-4 py-3">
          <Network aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
          <p className="text-support text-ink">
            An examination that enables IP allowlisting accepts examination traffic only from these ranges. Enter a
            range in CIDR form, or a single address to approve one machine.
          </p>
        </div>

        <Field
          label="Primary range"
          htmlFor="range-primary"
          required
          hint="For example 10.42.0.0/16, or 203.0.113.9 for a single address."
          error={fieldErrors.primaryCidr}
        >
          <TextInput
            id="range-primary"
            required
            value={primaryCidr}
            onChange={(event) => setPrimaryCidr(event.target.value)}
            disabled={busy}
            placeholder="10.42.0.0/16"
          />
        </Field>

        <Field
          label="Backup range"
          htmlFor="range-backup"
          hint="Optional. Used when a centre fails over to a second network."
          error={fieldErrors.backupCidr}
        >
          <TextInput
            id="range-backup"
            value={backupCidr}
            onChange={(event) => setBackupCidr(event.target.value)}
            disabled={busy}
            placeholder="10.43.0.0/16"
          />
        </Field>

        <Field
          label="IPv6 range"
          htmlFor="range-ipv6"
          hint="Optional. Needed when workstations reach the service over IPv6."
          error={fieldErrors.ipv6Cidr}
        >
          <TextInput
            id="range-ipv6"
            value={ipv6Cidr}
            onChange={(event) => setIpv6Cidr(event.target.value)}
            disabled={busy}
            placeholder="2001:db8::/48"
          />
        </Field>

        <Field
          label="Reason"
          htmlFor="range-reason"
          required
          hint="Written to the audit trail. At least five characters."
          error={fieldErrors.reason}
        >
          <TextArea
            id="range-reason"
            rows={3}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            placeholder="Hall B moved to the new examination VLAN."
          />
        </Field>

        {error ? (
          <Alert tone="critical" title="Please check the details">
            {error}
          </Alert>
        ) : null}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={reason.trim().length < 5}>
            Save approved networks
          </Button>
        </div>
      </form>
    </Modal>
  );
}
