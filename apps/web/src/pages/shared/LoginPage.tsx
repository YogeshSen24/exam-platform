import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react';
import { staffLoginSchema, type StaffLoginInput } from '@sep/shared';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Feedback';
import { Skeleton } from '@/components/ui/Feedback';

interface DemoAccountsResponse {
  warning: string;
  staff: { role: string; email: string; fullName: string; password: string; description: string }[];
  candidate: { applicationId: string; password: string; note: string };
}

export function LoginPage() {
  const { loginStaff, status, user } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StaffLoginInput>({
    resolver: zodResolver(staffLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const demoAccounts = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: () => api.get<DemoAccountsResponse>('/auth/demo-accounts'),
    retry: false,
  });

  useEffect(() => {
    document.title = 'Sign in — Secure Examination Platform';
  }, []);

  if (status === 'authenticated' && user) {
    if (user.kind === 'CANDIDATE') return <Navigate to="/exam" replace />;
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/admin'} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setGuidance(null);
    try {
      await loginStaff(values.email, values.password);
      navigate('/admin', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setGuidance(error.guidance);
      } else {
        setFormError('Sign-in could not be completed.');
        setGuidance('Check that the examination service is running, then try again.');
      }
    }
  });

  return (
    <div className="min-h-screen bg-page">
      <a href="#login-form" className="skip-link">
        Skip to the sign-in form
      </a>

      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 items-center gap-10 px-6 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        {/* Left: identity and context */}
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-panel bg-navy">
              <ShieldCheck aria-hidden className="h-6 w-6 text-sky" />
            </span>
            <div>
              <p className="text-card font-semibold text-ink">Examination Board</p>
              <p className="text-support text-muted">Secure Examination Management and Delivery Platform</p>
            </div>
          </div>

          <h1 className="mt-8 text-page-lg font-semibold tracking-tight text-ink">
            Administration and operations sign-in
          </h1>
          <p className="mt-3 max-w-prose text-body-lg text-muted">
            This portal is used by examination administrators, question authors and reviewers, security
            administrators and invigilators. Candidates sign in on the examination workstation application.
          </p>

          <dl className="mt-8 grid gap-5 sm:grid-cols-2">
            {[
              {
                title: 'The right student takes the examination',
                body: 'Application ID and password, with optional fingerprint and face verification at an approved workstation.',
              },
              {
                title: 'The right question paper is delivered',
                body: 'Approved questions are fingerprinted, assembled into a signed manifest and encrypted until the release window.',
              },
              {
                title: 'Answers belong to the correct attempt',
                body: 'Every answer is checked for ownership, assignment membership and version before it is stored.',
              },
              {
                title: 'The examination stays available',
                body: 'Continuous saving, reconnection to the same paper, and human review of anything a machine flags.',
              },
            ].map((item) => (
              <div key={item.title}>
                <dt className="text-support font-semibold text-ink">{item.title}</dt>
                <dd className="mt-1 text-support text-muted">{item.body}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 inline-flex items-center gap-2 rounded-card border border-warning-border bg-warning-soft px-3 py-2 text-support text-[#9A6410]">
            <TriangleAlert aria-hidden className="h-4 w-4" />
            Proof of concept — not a production-certified security system.
          </p>
        </div>

        {/* Right: the form */}
        <div className="order-1 lg:order-2">
          <div className="surface p-6 sm:p-8">
            <h2 className="text-section font-semibold text-ink">Sign in</h2>
            <p className="mt-1 text-support text-muted">Use your examination board account.</p>

            <form id="login-form" onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
              {formError ? (
                <Alert tone="critical" title={formError} live>
                  {guidance}
                </Alert>
              ) : null}

              <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
                <TextInput
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="name@examboard.demo"
                  invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  {...register('email')}
                />
              </Field>

              <Field label="Password" htmlFor="password" required error={errors.password?.message}>
                <TextInput
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                />
              </Field>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={isSubmitting}
                loadingText="Signing in…"
                iconRight={<ArrowRight aria-hidden className="h-4 w-4" />}
              >
                Sign in
              </Button>

              <p className="text-meta text-muted">
                Repeated failed attempts temporarily lock the account. Contact your administrator if you are locked out.
              </p>
            </form>
          </div>

          {/* Demo credentials — development builds only. */}
          <div className="mt-4 rounded-card border border-line bg-white p-5">
            <div className="flex items-center gap-2">
              <KeyRound aria-hidden className="h-4 w-4 text-muted" />
              <h3 className="text-support font-semibold text-ink">Demonstration credentials</h3>
              <span className="rounded border border-warning-border bg-warning-soft px-1.5 py-0.5 text-meta font-medium text-[#9A6410]">
                Development only
              </span>
            </div>

            {demoAccounts.isLoading ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-full" />
                ))}
              </div>
            ) : demoAccounts.isError ? (
              <p className="mt-3 text-meta text-muted">
                Demonstration accounts are disabled in this environment.
              </p>
            ) : (
              <>
                <p className="mt-2 text-meta text-muted">{demoAccounts.data?.warning}</p>
                <ul className="mt-3 divide-y divide-line">
                  {demoAccounts.data?.staff.map((account) => (
                    <li key={account.email} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-support font-medium text-ink">{account.fullName}</p>
                        <p className="truncate text-meta text-muted">{account.description}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setValue('email', account.email, { shouldValidate: true });
                          setValue('password', account.password, { shouldValidate: true });
                        }}
                      >
                        Use this account
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 rounded-control border border-line bg-page px-3 py-2.5">
                  <p className="text-meta font-medium text-ink">Candidate workstation</p>
                  <p className="mt-0.5 text-meta text-muted">
                    Application ID <code className="font-mono">{demoAccounts.data?.candidate.applicationId}</code>,
                    password <code className="font-mono">{demoAccounts.data?.candidate.password}</code>.{' '}
                    {demoAccounts.data?.candidate.note}
                  </p>
                  <a
                    href="/exam"
                    className="mt-2 inline-flex items-center gap-1 text-meta font-medium text-brand hover:underline"
                  >
                    Open the candidate application →
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
