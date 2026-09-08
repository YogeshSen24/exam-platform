import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Feedback';
import { Field, TextArea } from '@/components/ui/Form';
import { rememberStation, stationTimeRemaining } from '@/lib/stationStore';

/**
 * Setting this machine up for an examination.
 *
 * A board runs several examinations at once, so a machine has to be told which
 * one it is. A moderator pastes the key the board sent, once, before the room
 * opens. Candidates never see this screen; they arrive to a machine that is
 * already set up and simply sign in.
 */

interface RuleLine {
  label: string;
  value: string;
  emphasis?: boolean;
}

interface RedeemResponse {
  station: { id: string; code: string; room: string; session: string; expiresAt: string };
  exam: { code: string; name: string };
  centre: { name: string; code: string };
  keyFingerprint: string;
  summary: string;
  rules: RuleLine[];
  note: string;
}

export function StationSetupScreen() {
  const [key, setKey] = useState('');
  const [result, setResult] = useState<RedeemResponse | null>(null);

  const redeem = useMutation({
    mutationFn: () => api.post<RedeemResponse>('/activation/station', { key: key.trim() }),
    // Deliberately does not refresh the application straight away. The
    // moderator reads what the machine has been set up to do and confirms it,
    // rather than being dropped onto a sign-in screen they never asked for and
    // never got to check.
    onSuccess: (response) => {
      // Kept beside the cookie so the machine can say what it is running and
      // how long it has left without asking the server. The key itself is
      // never written down here.
      rememberStation({
        stationCode: response.station.code,
        room: response.station.room,
        session: response.station.session,
        centreCode: response.centre.code,
        examCode: response.exam.code,
        examName: response.exam.name,
        expiresAt: response.station.expiresAt,
        setUpAt: new Date().toISOString(),
      });
      setResult(response);
    },
  });

  const error = redeem.error instanceof ApiError ? redeem.error : null;

  if (result) {
    return (
      <main id="exam-main" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
        <div className="rounded-card border border-success-border bg-success-soft p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck aria-hidden className="mt-0.5 h-6 w-6 text-success" />
            <div>
              <h1 className="text-heading font-semibold text-ink">This machine is ready</h1>
              <p className="mt-1 text-body text-ink">{result.summary}</p>
            </div>
          </div>
        </div>

        <dl className="mt-6 divide-y divide-line rounded-card border border-line bg-surface">
          {result.rules.map((rule) => (
            <div key={rule.label} className="grid grid-cols-[minmax(0,11rem)_1fr] gap-4 px-4 py-3">
              <dt className="text-support text-muted">{rule.label}</dt>
              <dd className={rule.emphasis ? 'text-support font-medium text-ink' : 'text-support text-ink'}>
                {rule.value}
              </dd>
            </div>
          ))}
        </dl>

        {result.note ? (
          <Alert tone="info" title="Note from the examination board" className="mt-4">
            {result.note}
          </Alert>
        ) : null}

        <Alert tone="info" title="This setup lapses on its own" className="mt-4">
          The machine stays set up for {stationTimeRemaining(result.station.expiresAt).label}, then asks for the key
          again. That way a machine left switched on after the sitting is not still armed in the morning.
        </Alert>

        <p className="mt-6 text-support text-muted">
          Machine <span className="font-mono">{result.station.code}</span> &middot; key reference{' '}
          <span className="font-mono">{result.keyFingerprint}</span>
        </p>

        <Button variant="primary" className="mt-6 self-start" onClick={() => window.location.reload()}>
          Open the sign-in screen for candidates
        </Button>
      </main>
    );
  }

  return (
    <main id="exam-main" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <div className="flex items-start gap-3">
        <KeyRound aria-hidden className="mt-1 h-6 w-6 text-brand" />
        <div>
          <h1 className="text-display font-semibold text-ink">This machine is not set up yet</h1>
          <p className="mt-2 text-body text-muted">
            An invigilator needs to paste the examination key before candidates can sign in. The board sends one key per
            room; the same key sets up every machine in it.
          </p>
        </div>
      </div>

      <form
        className="mt-8 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim()) redeem.mutate();
        }}
      >
        <Field
          label="Examination key"
          htmlFor="activation-key"
          hint="Begins with SEPKEY1. Paste the whole thing, including every character."
        >
          <TextArea
            id="activation-key"
            rows={6}
            spellCheck={false}
            autoComplete="off"
            value={key}
            placeholder="SEPKEY1...."
            onChange={(event) => setKey(event.target.value)}
            className="font-mono text-meta"
          />
        </Field>

        {error ? (
          <Alert tone="critical" title={error.message}>
            {error.guidance}
          </Alert>
        ) : null}

        <Button type="submit" variant="primary" disabled={!key.trim() || redeem.isPending}>
          {redeem.isPending ? 'Checking the key…' : 'Set this machine up'}
        </Button>
      </form>

      <p className="mt-8 text-meta text-muted">
        Nothing is stored on this machine except which examination it is running. Question content never travels in a
        key.
      </p>
    </main>
  );
}
