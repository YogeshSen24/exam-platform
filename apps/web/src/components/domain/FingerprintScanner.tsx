import { useState } from 'react';
import { Fingerprint, ShieldQuestion } from 'lucide-react';
import { deviceSecurity, type FingerprintOutcome, type FingerprintResult } from '@/lib/deviceSecurity';
import { useDemoStore } from '@/lib/demoStore';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { PocDisclosure } from '@/components/ui/Explain';
import { Field, TextArea } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Overlay';

/**
 * Fingerprint verification, POC biometric simulation.
 *
 * A browser cannot read a fingerprint sensor, and this proof of concept never
 * handles raw biometric data. An external scanner is represented by a
 * `DeviceSecurityProvider` adapter with scripted outcomes; a production build
 * swaps in a certified scanner and an accredited matching service without
 * changing this screen.
 */
export function FingerprintScanner({
  required,
  onResult,
}: {
  required: boolean;
  onResult: (outcome: 'PASSED' | 'OVERRIDDEN' | 'FAILED' | 'SKIPPED') => void;
}) {
  const demo = useDemoStore();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<FingerprintResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  async function scan() {
    setScanning(true);
    setResult(null);
    const outcome: FingerprintOutcome = demo.fingerprint;
    const scan = await deviceSecurity().scanFingerprint(outcome);
    setResult(scan);
    setAttempts((count) => count + 1);
    setScanning(false);
    if (scan.outcome === 'MATCH') onResult('PASSED');
  }

  const failed = result && result.outcome !== 'MATCH';

  return (
    <div className="space-y-5">
      <PocDisclosure
        what="This is a simulated external fingerprint scanner. No fingerprint is read, transmitted or stored, and the match result is scripted."
        production="a certified scanner and an accredited biometric matching service, with the template held by that service and never by this application"
      />

      <div className="flex flex-col items-center rounded-card border border-line bg-page px-6 py-8">
        <div
          className={`flex h-28 w-28 items-center justify-center rounded-full border-4 transition-colors ${
            scanning
              ? 'animate-pulse border-brand bg-brand-50'
              : result?.outcome === 'MATCH'
                ? 'border-success bg-success-soft'
                : failed
                  ? 'border-critical bg-critical-soft'
                  : 'border-line bg-white'
          }`}
        >
          <Fingerprint
            aria-hidden
            className={`h-14 w-14 ${
              scanning ? 'text-brand' : result?.outcome === 'MATCH' ? 'text-success' : failed ? 'text-critical' : 'text-muted'
            }`}
          />
        </div>

        <p className="mt-4 text-support font-medium text-ink" role="status" aria-live="polite">
          {scanning
            ? 'Reading the fingerprint…'
            : result
              ? result.message
              : 'Place your finger flat on the scanner beside this workstation.'}
        </p>

        {result ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <StatusPill tone={result.outcome === 'MATCH' ? 'success' : 'critical'} size="sm">
              {result.outcome === 'MATCH'
                ? 'Match'
                : result.outcome === 'LOW_QUALITY'
                  ? 'Low-quality scan'
                  : result.outcome === 'MISMATCH'
                    ? 'No match'
                    : 'Scanner unavailable'}
            </StatusPill>
            <StatusPill tone="neutral" size="sm">
              Quality {(result.quality * 100).toFixed(0)}%
            </StatusPill>
            <StatusPill tone="neutral" size="sm">
              POC biometric simulation
            </StatusPill>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" loading={scanning} loadingText="Scanning…" onClick={scan}>
            {attempts === 0 ? 'Scan fingerprint' : 'Scan again'}
          </Button>
          {!required ? (
            <Button variant="secondary" onClick={() => onResult('SKIPPED')}>
              Skip — fingerprint is optional
            </Button>
          ) : null}
        </div>
      </div>

      {failed ? (
        <Alert
          tone="warning"
          title={
            result?.outcome === 'SCANNER_UNAVAILABLE'
              ? 'The fingerprint scanner did not respond'
              : result?.outcome === 'LOW_QUALITY'
                ? 'The scan quality was too low to compare'
                : 'The fingerprint did not match the enrolled reference'
          }
          live
        >
          <p>
            {result?.outcome === 'MISMATCH'
              ? 'This does not stop your examination on its own. An invigilator must confirm your identity in person before you continue.'
              : 'Try once more. If it still fails, an invigilator can confirm your identity in person and authorise you to continue.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={scan}>
              Try again
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<ShieldQuestion aria-hidden className="h-4 w-4" />}
              onClick={() => setOverrideOpen(true)}
            >
              Request an invigilator override
            </Button>
          </div>
        </Alert>
      ) : null}

      <ConfirmDialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        onConfirm={() => {
          setOverrideOpen(false);
          onResult('OVERRIDDEN');
        }}
        title="Invigilator override"
        description="An invigilator confirms the candidate's identity in person. The override and its reason are recorded in the audit trail."
        confirmLabel="Record the override"
        confirmDisabled={overrideReason.trim().length < 5}
      >
        <div className="space-y-4">
          <Alert tone="info" title="For the invigilator">
            Check the candidate’s admit card and photographic identity document against the person at this workstation
            before recording an override.
          </Alert>
          <Field label="How was identity confirmed?" htmlFor="fingerprint-override" required>
            <TextArea
              id="fingerprint-override"
              rows={3}
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              placeholder="Admit card and photographic identity document checked in person by the invigilator."
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
