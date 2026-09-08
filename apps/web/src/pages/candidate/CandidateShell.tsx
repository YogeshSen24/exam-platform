import { useState, type ReactNode } from 'react';
import { CircleHelp, LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { useCandidateStore } from '@/lib/candidateStore';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Overlay';
import { StatusPill } from '@/components/ui/Status';
import type { CandidateContextResponse } from './CandidateApp';

const STEPS = [
  { id: 1, label: 'Verification' },
  { id: 2, label: 'Instructions' },
  { id: 3, label: 'Examination' },
  { id: 4, label: 'Submission' },
];

/**
 * The chrome around every pre-examination candidate screen.
 *
 * One task on screen, no navigation out, and a single always-available help
 * control. The examination screen itself uses its own header because it needs
 * the timer and saving state permanently visible.
 */
export function CandidateShell({
  context,
  title,
  subtitle,
  step,
  children,
}: {
  context: CandidateContextResponse;
  title: string;
  subtitle?: string;
  step: 1 | 2 | 3 | 4;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { logout } = useSession();
  const reset = useCandidateStore((state) => state.reset);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-navy">
            <ShieldCheck aria-hidden className="h-5 w-5 text-sky" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-support font-semibold text-ink">{context.exam.name}</p>
            <p className="truncate text-meta text-muted">
              {context.candidate.fullName} · {context.candidate.applicationId} · {context.workstation.deviceCode}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<CircleHelp aria-hidden className="h-4 w-4" />}
            onClick={() => setHelpOpen(true)}
          >
            <span className="hidden sm:inline">Help</span>
          </Button>
          <Button variant="ghost" size="sm" icon={<LogOut aria-hidden className="h-4 w-4" />} onClick={() => setExitOpen(true)}>
            <span className="hidden sm:inline">Exit</span>
          </Button>
        </div>

        {/* Progress */}
        <nav aria-label="Examination progress" className="border-t border-line bg-page">
          <ol className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2 sm:px-6">
            {STEPS.map((item) => {
              const state = item.id < step ? 'complete' : item.id === step ? 'current' : 'upcoming';
              return (
                <li key={item.id} className="flex flex-1 items-center gap-2">
                  <span
                    className={`tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-meta font-semibold ${
                      state === 'complete'
                        ? 'bg-success text-white'
                        : state === 'current'
                          ? 'bg-brand text-white'
                          : 'border border-line bg-white text-muted'
                    }`}
                  >
                    {item.id}
                  </span>
                  <span
                    className={`truncate text-meta ${state === 'current' ? 'font-semibold text-ink' : 'text-muted'}`}
                    aria-current={state === 'current' ? 'step' : undefined}
                  >
                    {item.label}
                  </span>
                  {item.id < STEPS.length ? <span aria-hidden className="h-px flex-1 bg-line" /> : null}
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <main id="exam-main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-heading font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-prose text-body text-muted">{subtitle}</p> : null}
        </div>
        {children}
      </main>

      <footer className="border-t border-line bg-white py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 sm:px-6">
          <p className="text-meta text-muted">
            {context.centre?.name} · {context.securityProfile.name} security profile
          </p>
          <StatusPill tone="warning" size="sm">
            Proof of concept — simulated controls are labelled
          </StatusPill>
        </div>
      </footer>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Help"
        description="What to do if you need assistance."
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
              An invigilator is present in the hall. Stay at your workstation and raise your hand — they will come to
              you.
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">Your answers are always safe</p>
            <p className="mt-0.5 text-muted">
              Every answer is saved to the examination server as soon as you select it. If the network drops, answers
              are queued on this workstation and sent automatically when it returns. Nothing is lost.
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">If a check fails</p>
            <p className="mt-0.5 text-muted">
              A failed identity or camera check never ends your examination on its own. A person always reviews it.
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">Reporting an incident</p>
            <p className="mt-0.5 text-muted">
              Tell the invigilator immediately. They record an incident note against your session, which is preserved in
              the examination record and available if you later appeal.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Leave the examination application?"
        description="This signs you out of this workstation."
        tone="critical"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExitOpen(false)}>
              Stay signed in
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                reset();
                await logout();
                navigate('/exam', { replace: true });
              }}
            >
              Sign out
            </Button>
          </>
        }
      >
        <p className="text-support text-muted">
          Any answers already saved on the server are kept. If your examination has started and you sign back in, you
          will receive exactly the same questions in the same order, with your answers as you left them.
        </p>
      </Modal>
    </div>
  );
}
