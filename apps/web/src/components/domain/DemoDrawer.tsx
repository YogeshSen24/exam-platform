import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Fingerprint, RefreshCw, Wifi, Zap } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useDemoStore, type FaceOutcome } from '@/lib/demoStore';
import type { FingerprintOutcome } from '@/lib/deviceSecurity';
import { Drawer } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { useToast } from '@/components/ui/Misc';

const FINGERPRINT_OPTIONS: { value: FingerprintOutcome; label: string }[] = [
  { value: 'MATCH', label: 'Successful match' },
  { value: 'LOW_QUALITY', label: 'Low-quality scan' },
  { value: 'MISMATCH', label: 'Mismatch' },
  { value: 'SCANNER_UNAVAILABLE', label: 'Scanner unavailable' },
];

const FACE_OPTIONS: { value: FaceOutcome; label: string }[] = [
  { value: 'VERIFIED', label: 'Face verified' },
  { value: 'NO_FACE', label: 'No face detected' },
  { value: 'MULTIPLE_FACES', label: 'Multiple faces' },
  { value: 'UNCLEAR', label: 'Face unclear' },
  { value: 'LOW_LIGHT', label: 'Low light' },
  { value: 'MISMATCH', label: 'Identity mismatch' },
];

const SCENARIOS = [
  { id: 'LOGIN_BURST', label: 'Login burst' },
  { id: 'DDOS_TRAFFIC', label: 'DDoS traffic' },
  { id: 'SQL_INJECTION_ATTEMPT', label: 'SQL injection attempt' },
  { id: 'INVALID_EXAM_TOKEN', label: 'Invalid exam token' },
  { id: 'MODIFIED_QUESTION_ENVELOPE', label: 'Modified question envelope' },
  { id: 'REPLAYED_ANSWER_REQUEST', label: 'Replayed answer request' },
  { id: 'REVOKED_DEVICE', label: 'Revoked device' },
  { id: 'DATABASE_SLOWDOWN', label: 'Database slowdown' },
  { id: 'REDIS_UNAVAILABLE', label: 'Cache unavailable' },
  { id: 'INSTANCE_FAILURE', label: 'Instance failure' },
] as const;

/**
 * Presenter controls.
 *
 * Development builds only. These switches script simulated outcomes so a
 * demonstration is repeatable. Nothing here bypasses a server-side rule: an
 * off-network simulation is genuinely rejected by the API, and the tamper
 * scenario genuinely breaks the paper's integrity check.
 */
export function DemoDrawer() {
  const demo = useDemoStore();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [resetConfirm, setResetConfirm] = useState(false);

  const scenario = useMutation({
    mutationFn: (id: string) => api.post<{ result: { title: string; severity: string } }>('/demo-scenarios', { scenario: id }),
    onSuccess: (data) => {
      toast.push({
        tone: data.result.severity === 'CRITICAL' ? 'critical' : 'warning',
        title: 'Synthetic event created',
        description: data.result.title,
      });
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      toast.push({
        tone: 'critical',
        title: 'Scenario could not run',
        description: error instanceof ApiError ? error.message : 'Unexpected error',
      });
    },
  });

  const reset = useMutation({
    mutationFn: () => api.post<{ message: string }>('/demo-scenarios/reset'),
    onSuccess: (data) => {
      demo.reset();
      toast.push({ tone: 'success', title: 'Demonstration data rebuilt', description: data.message });
      setTimeout(() => window.location.assign('/login'), 1200);
    },
    onError: () =>
      toast.push({
        tone: 'critical',
        title: 'Reset not permitted',
        description: 'Sign in as the super administrator or security administrator to reset demonstration data.',
      }),
  });

  if (!demo.enabled) return null;

  return (
    <Drawer
      open={demo.open}
      onClose={() => demo.setOpen(false)}
      title="Demo mode"
      description="Presenter controls for a repeatable demonstration. Development builds only."
    >
      <div className="space-y-6">
        <Alert tone="warning" title="These controls script simulated outcomes only">
          Nothing here weakens a server-side rule. An off-network simulation is genuinely refused by the API, and the
          modified-question scenario genuinely breaks the paper’s integrity check and blocks release.
        </Alert>

        <section>
          <h3 className="flex items-center gap-2 text-support font-semibold text-ink">
            <Fingerprint aria-hidden className="h-4 w-4 text-muted" />
            Fingerprint scanner outcome
          </h3>
          <p className="mt-1 text-meta text-muted">
            Applied to the next fingerprint scan on the candidate workstation.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {FINGERPRINT_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={demo.fingerprint === option.value ? 'primary' : 'secondary'}
                onClick={() => demo.setFingerprint(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-support font-semibold text-ink">
            <Camera aria-hidden className="h-4 w-4 text-muted" />
            Camera presence-check outcome
          </h3>
          <p className="mt-1 text-meta text-muted">Applied to login verification and every periodic presence check.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {FACE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={demo.face === option.value ? 'primary' : 'secondary'}
                onClick={() => demo.setFace(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-card border border-line bg-page px-4 py-4">
          <h3 className="flex items-center gap-2 text-support font-semibold text-ink">
            <Wifi aria-hidden className="h-4 w-4 text-muted" />
            Workstation conditions
          </h3>
          <Toggle
            checked={demo.simulateOffline}
            onChange={demo.setSimulateOffline}
            label="Network disconnected"
            description="The candidate application queues answers locally and shows the reconnecting state."
          />
          <Toggle
            checked={demo.simulateOffNetwork}
            onChange={demo.setSimulateOffNetwork}
            label="Outside the approved network"
            description="Sends a client address of 203.0.113.55. The API refuses activation with UNAUTHORIZED_NETWORK."
          />
          <Toggle
            checked={demo.forceAnswerRetry}
            onChange={demo.setForceAnswerRetry}
            label="Force one answer-save retry"
            description="The next save fails once, then succeeds on retry with the same idempotency key."
          />
          <Toggle
            checked={demo.slowNetwork}
            onChange={demo.setSlowNetwork}
            label="Slow network"
            description="Adds latency so loading and saving states are visible during a presentation."
          />
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-support font-semibold text-ink">
            <Zap aria-hidden className="h-4 w-4 text-muted" />
            Security scenarios
          </h3>
          <p className="mt-1 text-meta text-muted">
            Creates a synthetic monitoring event. No attack traffic is generated.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SCENARIOS.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant="secondary"
                loading={scenario.isPending && scenario.variables === item.id}
                onClick={() => scenario.mutate(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="rounded-card border border-critical-border bg-critical-soft px-4 py-4">
          <h3 className="text-support font-semibold text-ink">Reset demonstration data</h3>
          <p className="mt-1 text-meta text-muted">
            Rebuilds every examination, question, candidate, workstation and audit record from the seed. All sessions
            are cleared, so everyone must sign in again.
          </p>
          {resetConfirm ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="danger" size="sm" loading={reset.isPending} onClick={() => reset.mutate()}>
                Yes, rebuild everything
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setResetConfirm(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              className="mt-3"
              variant="secondary"
              size="sm"
              icon={<RefreshCw aria-hidden className="h-4 w-4" />}
              onClick={() => setResetConfirm(true)}
            >
              Reset demo data
            </Button>
          )}
        </section>

        {demo.lastAction ? (
          <div className="flex items-center gap-2">
            <StatusPill tone="info" size="sm">
              Last action
            </StatusPill>
            <span className="text-meta text-muted">{demo.lastAction}</span>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
