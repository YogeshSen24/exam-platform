import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp, Lock, Monitor, ShieldCheck, Wifi } from 'lucide-react';
import { candidateLoginSchema, type CandidateLoginInput } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCandidateStore, WORKSTATIONS } from '@/lib/candidateStore';
import { deviceSecurity } from '@/lib/deviceSecurity';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Modal } from '@/components/ui/Overlay';

interface DemoAccounts {
  candidate: { applicationId: string; password: string; note: string };
}

/**
 * Candidate sign-in.
 *
 * No global navigation, no links out of the examination. The only auxiliary
 * control is an accessible help panel that tells the candidate to raise their
 * hand — which is exactly what they should do in a supervised hall.
 */
export function CandidateLoginScreen() {
  const navigate = useNavigate();
  const { loginCandidate } = useSession();
  const { workstationCode, setWorkstationCode } = useCandidateStore();
  const [error, setError] = useState<ApiError | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [kioskNote, setKioskNote] = useState<string | null>(null);

  const demo = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => api.get<DemoAccounts>('/auth/demo-accounts'),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CandidateLoginInput>({
    resolver: zodResolver(candidateLoginSchema),
    defaultValues: { applicationId: '', password: '', workstationCode },
  });

  useEffect(() => {
    setValue('workstationCode', workstationCode);
  }, [workstationCode, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      setWorkstationCode(values.workstationCode ?? '');
      await loginCandidate({ ...values, workstationCode: values.workstationCode ?? '' });
      navigate('/exam/verify', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) setError(caught);
      else
        setError(
          new ApiError(0, {
            code: 'UNKNOWN',
            message: 'Sign-in could not be completed.',
            guidance: 'Raise your hand and the examination-centre operator will help.',
            traceId: 'client',
          }),
        );
    }
  });

  return (
    <main id="exam-main" className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Institution identity */}
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-panel bg-navy">
            <ShieldCheck aria-hidden className="h-7 w-7 text-sky" />
          </span>
          <p className="mt-3 text-card font-semibold text-ink">Examination Board</p>
          <h1 className="mt-1 text-section font-semibold text-ink">National Technical Aptitude Examination 2026</h1>
          <p className="mt-1 text-support text-muted">Sign in with the details printed on your admit card.</p>
        </div>

        <div className="surface p-6 sm:p-8">
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {error ? (
              <Alert tone="critical" title={error.message} live>
                {error.guidance}
              </Alert>
            ) : null}

            <Field
              label="Application ID"
              htmlFor="applicationId"
              required
              error={errors.applicationId?.message}
              hint="Printed at the top of your admit card, for example NTAE26-000001."
            >
              <TextInput
                id="applicationId"
                autoFocus
                autoComplete="username"
                inputMode="text"
                placeholder="NTAE26-000001"
                className="font-mono text-body-lg"
                invalid={Boolean(errors.applicationId)}
                {...register('applicationId')}
              />
            </Field>

            <Field label="Examination password" htmlFor="password" required error={errors.password?.message}>
              <TextInput
                id="password"
                type="password"
                autoComplete="current-password"
                className="text-body-lg"
                invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </Field>

            <Field
              label="Workstation identifier"
              htmlFor="workstationCode"
              required
              error={errors.workstationCode?.message}
              hint="Shown on the label attached to this computer."
            >
              <Select
                id="workstationCode"
                className="font-mono"
                invalid={Boolean(errors.workstationCode)}
                {...register('workstationCode', {
                  onChange: (event) => setWorkstationCode(event.target.value),
                })}
              >
                {WORKSTATIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
                <option value="LAPTOP-UNKNOWN">LAPTOP-UNKNOWN (unregistered — demonstration)</option>
              </Select>
            </Field>

            <Button type="submit" variant="primary" size="lg" fullWidth loading={isSubmitting} loadingText="Signing in…">
              Sign in
            </Button>
          </form>

          {/* Workstation status strip */}
          <div className="mt-6 grid gap-2 border-t border-line pt-5 sm:grid-cols-3">
            <StatusRow icon={<Monitor aria-hidden className="h-4 w-4" />} label="Workstation" value={workstationCode} tone="neutral" />
            <StatusRow icon={<Wifi aria-hidden className="h-4 w-4" />} label="Network" value="Examination network" tone="success" />
            <StatusRow
              icon={<Lock aria-hidden className="h-4 w-4" />}
              label="Device check"
              value="Verified at sign-in"
              tone="success"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              icon={<CircleHelp aria-hidden className="h-4 w-4" />}
              onClick={() => setHelpOpen(true)}
            >
              I need help
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const result = await deviceSecurity().enterKioskMode();
                setKioskNote(result.note);
              }}
            >
              Enter full-screen examination mode
            </Button>
          </div>

          {kioskNote ? (
            <p className="mt-3 rounded-control border border-line bg-panel px-3 py-2 text-meta text-muted">{kioskNote}</p>
          ) : null}
        </div>

        {demo.data ? (
          <div className="mt-4 rounded-card border border-warning-border bg-warning-soft px-4 py-3">
            <p className="text-support font-semibold text-ink">Demonstration credentials — development only</p>
            <p className="mt-1 text-meta text-[#9A6410]">
              Application ID <code className="font-mono">{demo.data.candidate.applicationId}</code>, password{' '}
              <code className="font-mono">{demo.data.candidate.password}</code>. {demo.data.candidate.note}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                setValue('applicationId', demo.data!.candidate.applicationId, { shouldValidate: true });
                setValue('password', demo.data!.candidate.password, { shouldValidate: true });
              }}
            >
              Fill in the demonstration candidate
            </Button>
          </div>
        ) : null}

        <p className="mt-6 text-center text-meta text-muted">
          Proof of concept. This browser application simulates the kiosk experience and cannot enforce
          operating-system lockdown.
        </p>
      </div>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Help"
        description="What to do if something is not working."
        footer={
          <Button variant="primary" onClick={() => setHelpOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-4 text-support">
          <div>
            <p className="font-medium text-ink">Raise your hand</p>
            <p className="mt-0.5 text-muted">
              An invigilator is present in the hall. Raise your hand and wait at your seat — do not leave the
              workstation.
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">If your sign-in details are refused</p>
            <p className="mt-0.5 text-muted">
              Check the application ID and password against your admit card. After several failed attempts the account is
              locked briefly for your protection; the operator can help.
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">If this workstation has a fault</p>
            <p className="mt-0.5 text-muted">
              The operator can move you to another approved workstation. Any answers you have already given are stored on
              the server and will be there when you continue.
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">Accessibility</p>
            <p className="mt-0.5 text-muted">
              This application can be used entirely with the keyboard. If you have an approved accommodation, it is
              applied automatically once you sign in.
            </p>
          </div>
        </div>
      </Modal>
    </main>
  );
}

function StatusRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'neutral' | 'success';
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">{icon}</span>
      <div className="min-w-0">
        <p className="text-meta uppercase tracking-wide text-muted">{label}</p>
        <StatusPill tone={tone} size="sm" className="mt-0.5">
          {value}
        </StatusPill>
      </div>
    </div>
  );
}
