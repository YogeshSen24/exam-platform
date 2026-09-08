import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudOff,
  Flag,
  Keyboard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Timer,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { SAVE_STATE_LABELS, useAnswerSaver, type SaveState } from '@/hooks/useAnswerSaver';
import { useCandidateStore } from '@/lib/candidateStore';
import { useDemoStore } from '@/lib/demoStore';
import { formatDuration } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Alert, FailureState, SkeletonText } from '@/components/ui/Feedback';
import { StatusPill } from '@/components/ui/Status';
import { Modal } from '@/components/ui/Overlay';
import { CameraMonitor, type MonitoringOutcome } from '@/components/domain/CameraMonitor';
import type { CandidateContextResponse } from './CandidateApp';

interface DeliveredQuestion {
  assignmentQuestionId: string;
  sequence: number;
  totalQuestions: number;
  stem: string;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_TEXT' | 'PARAGRAPH';
  paragraphWordLimit: number | null;
  options: { id: string; label: string; text: string }[];
  marks: number;
  negativeMarks: number;
  subject: string;
  topic: string;
  savedAnswer: string[] | null;
  savedText: string | null;
  answerVersion: number;
  flagged: boolean;
  visited: boolean;
}

interface NavigatorEntry {
  sequence: number;
  assignmentQuestionId: string;
  state: 'NOT_VISITED' | 'VISITED' | 'ANSWERED' | 'ANSWERED_FLAGGED' | 'FLAGGED';
  subject: string;
}

interface QuestionResponse {
  question: DeliveredQuestion;
  navigator: NavigatorEntry[];
  summary: { total: number; answered: number; unanswered: number; flagged: number; remainingSeconds: number };
  remainingSeconds: number;
  serverTime: string;
}

const NAV_STATE_META: Record<
  NavigatorEntry['state'],
  { label: string; classes: string; symbol: string; pattern?: string }
> = {
  NOT_VISITED: { label: 'Not visited', classes: 'border-line bg-white text-muted', symbol: '' },
  VISITED: { label: 'Visited, not answered', classes: 'border-muted bg-panel text-ink', symbol: '·' },
  ANSWERED: { label: 'Answered', classes: 'border-success bg-success text-white', symbol: '✓' },
  ANSWERED_FLAGGED: {
    label: 'Answered and flagged',
    classes: 'border-warning bg-warning text-white',
    symbol: '✓',
    pattern: 'flag',
  },
  FLAGGED: { label: 'Flagged for review', classes: 'border-warning bg-warning-soft text-[#9A6410]', symbol: '⚑' },
};

/**
 * The examination interface.
 *
 * Answers autosave on selection and again periodically. Each write carries an
 * idempotency key and the version it expects, so a retry is never applied twice
 * and a stale write is reported as a conflict rather than silently overwriting.
 */
export function ExamSessionScreen({ context }: { context: CandidateContextResponse }) {
  const navigate = useNavigate();
  const demo = useDemoStore();
  const { attemptId, workstationCode, setConnection } = useCandidateStore();

  const [sequence, setSequence] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [monitoring, setMonitoring] = useState<MonitoringOutcome | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

  const question = useQuery({
    queryKey: ['question', attemptId, sequence],
    queryFn: () => api.get<QuestionResponse>(`/attempts/${attemptId}/question/${sequence}`),
    enabled: Boolean(attemptId) && !restricted,
    retry: false,
  });

  const offline = demo.simulateOffline;

  // The save state machine lives in a hook so its rules — immediate send,
  // honest retry, reused idempotency key, conflict reported as "reloaded" —
  // are covered directly by tests.
  const saver = useAnswerSaver({
    attemptId: attemptId ?? '',
    assignmentQuestionId: question.data?.question.assignmentQuestionId ?? '',
    initialVersion: question.data?.question.answerVersion ?? 0,
    offline,
    forceRetryOnce: demo.forceAnswerRetry,
    slow: demo.slowNetwork,
    onSaved: () => void question.refetch(),
    onConflict: () => void question.refetch(),
  });

  /* ------------------------- load question state ------------------------ */

  const loadedQuestionRef = useRef<string | null>(null);

  useEffect(() => {
    const data = question.data?.question;
    if (!data) return;
    setSelected(data.savedAnswer ?? []);
    setFlagged(data.flagged);
    setTextAnswer(data.savedText ?? '');
    // Reset the saver only when the candidate moves to a different question,
    // so a refetch triggered by a successful save does not clear its state.
    if (loadedQuestionRef.current !== data.assignmentQuestionId) {
      loadedQuestionRef.current = data.assignmentQuestionId;
      saver.reset(data.answerVersion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.data?.question]);

  useEffect(() => {
    if (question.data?.remainingSeconds !== undefined) setTimeRemaining(question.data.remainingSeconds);
  }, [question.data?.remainingSeconds]);

  /* ------------------------------- timer -------------------------------- */

  useEffect(() => {
    if (timeRemaining === null) return;
    const timer = setInterval(() => {
      setTimeRemaining((current) => (current === null ? null : Math.max(0, current - 1)));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeRemaining === null]);

  useEffect(() => {
    if (timeRemaining === 0) navigate('/exam/review');
  }, [timeRemaining, navigate]);

  useEffect(() => {
    setConnection(offline ? 'OFFLINE' : 'ONLINE');
  }, [offline, setConnection]);

  /* ------------------------------ selection ----------------------------- */

  function choose(optionId: string) {
    if (busy) return;
    const current = question.data?.question;
    if (!current || restricted) return;
    const multiple = current.type === 'MULTIPLE_CHOICE';
    const next = multiple
      ? selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId]
      : [optionId];
    setSelected(next);
    void saver.save(next, flagged);
  }

  function toggleFlag() {
    if (busy || textDirty) return;
    const next = !flagged;
    setFlagged(next);
    void saver.save(selected, next, textAnswer || null);
  }

  function clearResponse() {
    if (busy) return;
    setSelected([]);
    setTextAnswer('');
    void saver.save([], flagged, null);
  }

  const busy = saver.state === 'SENDING' || saver.state === 'SAVING';
  const textDirty = textAnswer !== (question.data?.question.savedText ?? '');
  const navigationBlocked = busy || saver.hasPending || textDirty;
  function move(next: number) {
    if (navigationBlocked) return;
    if (context.exam.navigationMode === 'SEQUENTIAL' && next < sequence) return;
    setSequence(next);
  }

  /* ---------------------------- keyboard shortcuts ---------------------- */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (restricted) return;

      const current = question.data?.question;
      if (!current) return;

      if (event.key >= '1' && event.key <= '9') {
        const index = Number(event.key) - 1;
        const option = current.options[index];
        if (option) {
          event.preventDefault();
          choose(option.id);
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'n' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (sequence < current.totalQuestions) move(sequence + 1);
      } else if (key === 'p' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (sequence > 1) move(sequence - 1);
      } else if (key === 'f') {
        event.preventDefault();
        toggleFlag();
      } else if (key === 'c') {
        event.preventDefault();
        clearResponse();
      } else if (key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.data?.question, sequence, selected, flagged, restricted, navigationBlocked, textAnswer]);

  /* ------------------------------ monitoring ---------------------------- */

  const handleMonitoring = useCallback((outcome: MonitoringOutcome) => {
    setMonitoring(outcome);
    if (outcome.restricted) {
      setRestricted(true);
    }
  }, []);

  useEffect(() => {
    if (restricted) navigate('/exam/reverify');
  }, [restricted, navigate]);

  /* -------------------------------- render ------------------------------ */

  const navigatorEntries = question.data?.navigator ?? [];
  const summary = question.data?.summary;
  const current = question.data?.question;

  const timeWarning = timeRemaining !== null && timeRemaining <= 300;
  const timeCritical = timeRemaining !== null && timeRemaining <= 60;

  const groupedNavigator = useMemo(() => navigatorEntries, [navigatorEntries]);

  if (!attemptId) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-lg">
          <Alert tone="warning" title="No active examination on this workstation">
            Return to the instructions to prepare your examination.
          </Alert>
          <Button className="mt-4" variant="primary" onClick={() => navigate('/exam/instructions')}>
            Return to the instructions
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-support font-semibold text-ink">{context.exam.name}</p>
            <p className="truncate text-meta text-muted">
              {context.candidate.fullName} · {context.candidate.applicationId} · {workstationCode}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ConnectionIndicator offline={offline} />
            <SaveIndicator state={saver.state} />
            <div
              className={`flex items-center gap-2 rounded-control border px-3 py-1.5 ${
                timeCritical
                  ? 'border-critical bg-critical-soft text-critical'
                  : timeWarning
                    ? 'border-warning bg-warning-soft text-[#9A6410]'
                    : 'border-line bg-page text-ink'
              }`}
              role="timer"
              aria-live={timeCritical ? 'assertive' : 'off'}
            >
              <Timer aria-hidden className="h-4 w-4" />
              <span className="tnum text-body font-semibold">
                {timeRemaining === null ? '—:—' : formatDuration(timeRemaining)}
              </span>
              <span className="sr-only">remaining</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<CircleHelp aria-hidden className="h-4 w-4" />}
              onClick={() => setShortcutsOpen(true)}
            >
              <span className="hidden sm:inline">Help</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Banners */}
      <div className="mx-auto w-full max-w-[92rem] space-y-3 px-4 pt-4 sm:px-6">
        {timeWarning && !timeCritical ? (
          <Alert tone="warning" live title="Five minutes remaining">
            Everything you have answered is already saved. Use the review screen when you are ready to submit.
          </Alert>
        ) : null}
        {timeCritical ? (
          <Alert tone="critical" live title="Less than one minute remaining">
            Your examination will be submitted automatically when the time ends. Every saved answer is included.
          </Alert>
        ) : null}
        {offline ? (
          <Alert tone="warning" live icon={<WifiOff aria-hidden className="h-5 w-5 text-warning" />} title="Connection to the examination service lost">
            Keep working. Your answers are stored on this workstation and will be sent automatically as soon as the
            connection returns. Nothing will be lost.
          </Alert>
        ) : null}
        {monitoring && monitoring.response === 'SUBTLE_WARNING' ? (
          <Alert tone="info" live title="Please face the camera">
            {monitoring.message}
          </Alert>
        ) : null}
        {monitoring && monitoring.response === 'PROMINENT_WARNING' ? (
          <Alert tone="warning" live title="Camera check failed twice" icon={<AlertTriangle aria-hidden className="h-5 w-5 text-warning" />}>
            {monitoring.message}
          </Alert>
        ) : null}
        {saver.state === 'CONFLICT' && saver.error ? (
          <Alert tone="warning" live title="This answer was updated elsewhere">
            {saver.error.guidance} The latest saved value has been reloaded below.
          </Alert>
        ) : null}
      </div>

      <main id="exam-main" className="mx-auto w-full max-w-[92rem] flex-1 px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Question */}
          <div className="space-y-4">
            {question.isLoading ? (
              <div className="surface p-6">
                <SkeletonText lines={8} />
              </div>
            ) : question.error ? (
              <QuestionError error={question.error} onRetry={() => void question.refetch()} />
            ) : current ? (
              <>
                <article className="surface p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tnum rounded-control bg-navy px-2.5 py-1 text-support font-semibold text-white">
                        Question {current.sequence} of {current.totalQuestions}
                      </span>
                      <StatusPill tone="neutral" size="sm">
                        {current.subject}
                      </StatusPill>
                      <StatusPill tone="info" size="sm">
                        {current.marks} mark{current.marks === 1 ? '' : 's'}
                      </StatusPill>
                      {current.negativeMarks > 0 ? (
                        <StatusPill tone="warning" size="sm">
                          −{current.negativeMarks} if incorrect
                        </StatusPill>
                      ) : null}
                    </div>
                    <Button
                      variant={flagged ? 'primary' : 'secondary'}
                      size="sm"
                      icon={<Flag aria-hidden className="h-4 w-4" />}
                      disabled={busy || textDirty}
                      onClick={toggleFlag}
                      aria-pressed={flagged}
                    >
                      {flagged ? 'Flagged for review' : 'Flag for review'}
                    </Button>
                  </div>

                  <h1 className="mt-5 text-body-lg font-medium leading-relaxed text-ink">{current.stem}</h1>

                  {(current.type === 'PARAGRAPH' || current.type === 'SHORT_TEXT') && <div className="mt-6 space-y-3">
                    <label htmlFor="written-answer" className="font-medium">Your answer</label>
                    <textarea id="written-answer" rows={current.type === 'PARAGRAPH' ? 10 : 3} maxLength={20000}
                      disabled={busy} className="w-full rounded-card border border-line p-4" value={textAnswer}
                      onChange={event => setTextAnswer(event.target.value)} />
                    <p className="text-support text-muted">{textAnswer.trim().split(/\s+/).filter(Boolean).length} words{current.paragraphWordLimit ? ` / ${current.paragraphWordLimit} maximum` : ''}</p>
                    <Button variant="primary" disabled={busy || !textDirty || Boolean(current.paragraphWordLimit && textAnswer.trim().split(/\s+/).filter(Boolean).length > current.paragraphWordLimit)}
                      onClick={() => void saver.save([], flagged, textAnswer)}>Save written answer</Button>
                  </div>}
                  {navigationBlocked && <p role="status" className="mt-3 text-support">Save your answer and wait for confirmation before moving to another question.</p>}
                  <fieldset className="mt-6" disabled={busy}>
                    <legend className="sr-only">
                      {current.type === 'MULTIPLE_CHOICE' ? 'Select all correct options' : 'Select one option'}
                    </legend>
                    {current.type === 'MULTIPLE_CHOICE' ? (
                      <p className="mb-3 text-support text-muted">Select every option you believe is correct.</p>
                    ) : null}
                    <ul className="space-y-2.5">
                      {current.options.map((option, index) => {
                        const isSelected = selected.includes(option.id);
                        return (
                          <li key={option.id}>
                            <label
                              className={`flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors ${
                                isSelected
                                  ? 'border-brand bg-brand-50 shadow-card'
                                  : 'border-line bg-white hover:border-[#B9C4D2] hover:bg-page'
                              }`}
                            >
                              <input
                                type={current.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'}
                                name={`question-${current.sequence}`}
                                checked={isSelected}
                                onChange={() => choose(option.id)}
                                className="mt-1 h-4 w-4 shrink-0 border-line text-brand focus:ring-2 focus:ring-brand/40"
                              />
                              <span className="flex min-w-0 flex-1 items-start gap-3">
                                <span
                                  className={`tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-support font-semibold ${
                                    isSelected ? 'border-brand bg-brand text-white' : 'border-line bg-white text-muted'
                                  }`}
                                >
                                  {option.label}
                                </span>
                                <span className="text-body text-ink">{option.text}</span>
                              </span>
                              <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-meta text-muted sm:block">
                                {index + 1}
                              </kbd>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>

                  {saver.state === 'RETRY' && saver.error ? (
                    <Alert tone="warning" className="mt-5" live title="This answer has not reached the server yet">
                      <p>{saver.error.guidance}</p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<RefreshCw aria-hidden className="h-4 w-4" />}
                          onClick={() => void saver.retry()}
                        >
                          Send it now
                        </Button>
                      </div>
                    </Alert>
                  ) : null}

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                    <Button
                      variant="secondary"
                      icon={<ChevronLeft aria-hidden className="h-4 w-4" />}
                      disabled={navigationBlocked || sequence <= 1 || context.exam.navigationMode === 'SEQUENTIAL'}
                      onClick={() => move(sequence - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="ghost"
                      icon={<Trash2 aria-hidden className="h-4 w-4" />}
                      disabled={busy || (selected.length === 0 && textAnswer.length === 0)}
                      onClick={clearResponse}
                    >
                      Clear response
                    </Button>
                    {sequence < current.totalQuestions ? (
                      <Button
                        variant="primary"
                        iconRight={<ChevronRight aria-hidden className="h-4 w-4" />}
                        onClick={() => move(sequence + 1)}
                      >
                        Next
                      </Button>
                    ) : (
                      <Button variant="primary" disabled={navigationBlocked} onClick={() => navigate('/exam/review')}>
                        Review and submit
                      </Button>
                    )}
                  </div>
                </article>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Keyboard aria-hidden className="h-4 w-4" />}
                    onClick={() => setShortcutsOpen(true)}
                  >
                    Keyboard shortcuts
                  </Button>
                  <Button variant="secondary" disabled={navigationBlocked} onClick={() => navigate('/exam/review')}>
                    Review and submit
                  </Button>
                </div>
              </>
            ) : null}
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <section className="surface p-4">
              <h2 className="text-support font-semibold text-ink">Question navigator</h2>
              {summary ? (
                <p className="mt-1 text-meta text-muted">
                  {summary.answered} answered · {summary.unanswered} remaining · {summary.flagged} flagged
                </p>
              ) : null}

              <ol className="mt-4 grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-6">
                {groupedNavigator.map((entry) => {
                  const meta = NAV_STATE_META[entry.state];
                  const isCurrent = entry.sequence === sequence;
                  return (
                    <li key={entry.sequence}>
                      <button
                        type="button"
                        onClick={() => move(entry.sequence)}
                        aria-current={isCurrent ? 'true' : undefined}
                        aria-label={`Question ${entry.sequence}, ${meta.label}${isCurrent ? ', current question' : ''}`}
                        className={`tnum relative flex h-9 w-full items-center justify-center rounded-control border text-support font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                          meta.classes
                        } ${isCurrent ? 'ring-2 ring-brand ring-offset-1' : ''}`}
                      >
                        {entry.sequence}
                        {meta.symbol ? (
                          <span aria-hidden className="absolute -right-0.5 -top-1 text-meta">
                            {meta.symbol}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ol>

              {/* Legend — state is never conveyed by colour alone */}
              <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
                {(Object.keys(NAV_STATE_META) as NavigatorEntry['state'][]).map((state) => (
                  <li key={state} className="flex items-center gap-2 text-meta text-muted">
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 items-center justify-center rounded border text-[10px] font-semibold ${NAV_STATE_META[state].classes}`}
                    >
                      {NAV_STATE_META[state].symbol || '–'}
                    </span>
                    {NAV_STATE_META[state].label}
                  </li>
                ))}
              </ul>
            </section>

            {context.monitoring.cameraMonitoringEnabled && attemptId ? (
              <CameraMonitor
                attemptId={attemptId}
                deviceCode={workstationCode}
                intervalSeconds={context.monitoring.snapshotIntervalSeconds}
                enabled
                paused={restricted}
                onOutcome={handleMonitoring}
              />
            ) : null}

            <section className="surface p-4">
              <h2 className="text-support font-semibold text-ink">Your progress</h2>
              {summary ? (
                <dl className="mt-3 space-y-2">
                  {[
                    { term: 'Answered', value: summary.answered, tone: 'text-success' },
                    { term: 'Not answered', value: summary.unanswered, tone: 'text-ink' },
                    { term: 'Flagged for review', value: summary.flagged, tone: 'text-warning' },
                  ].map((item) => (
                    <div key={item.term} className="flex items-center justify-between text-support">
                      <dt className="text-muted">{item.term}</dt>
                      <dd className={`tnum font-semibold ${item.tone}`}>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <Button className="mt-4" variant="secondary" fullWidth disabled={navigationBlocked} onClick={() => navigate('/exam/review')}>
                Go to review and submit
              </Button>
            </section>
          </aside>
        </div>
      </main>

      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts and help"
        description="This examination can be completed entirely with the keyboard."
        footer={
          <Button variant="primary" onClick={() => setShortcutsOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-5">
          <dl className="grid gap-2">
            {[
              { keys: '1 – 9', action: 'Select the corresponding answer option' },
              { keys: 'N or →', action: 'Next question' },
              { keys: 'P or ←', action: 'Previous question' },
              { keys: 'F', action: 'Flag or unflag this question for review' },
              { keys: 'C', action: 'Clear your response to this question' },
              { keys: 'Tab', action: 'Move through options and controls' },
              { keys: '?', action: 'Open this help panel' },
            ].map((item) => (
              <div key={item.keys} className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
                <dt>
                  <kbd className="rounded border border-line bg-panel px-2 py-1 font-mono text-meta text-navy">
                    {item.keys}
                  </kbd>
                </dt>
                <dd className="text-support text-muted">{item.action}</dd>
              </div>
            ))}
          </dl>
          <Alert tone="info" title="If you need a person">
            Raise your hand and stay at your workstation. An invigilator will attend. Your answers are safe.
          </Alert>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ConnectionIndicator({ offline }: { offline: boolean }) {
  return (
    <StatusPill
      tone={offline ? 'warning' : 'success'}
      size="sm"
      icon={offline ? <WifiOff aria-hidden className="h-3.5 w-3.5" /> : <Wifi aria-hidden className="h-3.5 w-3.5" />}
    >
      {offline ? 'Reconnecting' : 'Connected'}
    </StatusPill>
  );
}

export function SaveIndicator({ state }: { state: SaveState }) {
  const config: Record<SaveState, { tone: 'neutral' | 'success' | 'warning' | 'info'; icon: React.ReactNode }> = {
    IDLE: { tone: 'neutral', icon: <Cloud aria-hidden className="h-3.5 w-3.5" /> },
    SAVING: { tone: 'info', icon: <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> },
    SAVED_LOCALLY: { tone: 'warning', icon: <CloudOff aria-hidden className="h-3.5 w-3.5" /> },
    SENDING: { tone: 'info', icon: <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> },
    SAVED: { tone: 'success', icon: <Check aria-hidden className="h-3.5 w-3.5" /> },
    RETRY: { tone: 'warning', icon: <RefreshCw aria-hidden className="h-3.5 w-3.5" /> },
    RECONNECTED: { tone: 'success', icon: <Check aria-hidden className="h-3.5 w-3.5" /> },
    CONFLICT: { tone: 'warning', icon: <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> },
  };
  const entry = config[state];
  return (
    <StatusPill tone={entry.tone} size="sm" icon={entry.icon}>
      <span aria-live="polite">{SAVE_STATE_LABELS[state]}</span>
    </StatusPill>
  );
}

function QuestionError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError) {
    if (error.code === 'ATTEMPT_FINALISED') {
      return (
        <FailureState
          tone="info"
          title="This examination has already been submitted"
          whatHappened="Your attempt is locked, so questions can no longer be opened."
          answersSafe
          whatToDo="Your submission receipt is available from the receipt screen."
          invigilatorNotified={null}
        />
      );
    }
    return (
      <FailureState
        tone={error.code === 'CONFLICT' ? 'warning' : 'critical'}
        title={
          error.code === 'CONFLICT'
            ? 'Question navigation is paused'
            : error.isOffline
              ? 'This workstation cannot reach the examination service'
              : 'This question could not be loaded'
        }
        whatHappened={error.message}
        answersSafe={error.answersSafe}
        whatToDo={error.guidance || 'Raise your hand for the invigilator.'}
        invigilatorNotified={error.code === 'CONFLICT'}
        reference={error.traceId}
        actions={
          <Button size="sm" variant="secondary" icon={<ShieldAlert aria-hidden className="h-4 w-4" />} onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  return (
    <FailureState
      tone="critical"
      title="This question could not be loaded"
      whatHappened="An unexpected problem occurred while loading the question."
      answersSafe
      whatToDo="Try again. If the problem continues, raise your hand for the invigilator."
      invigilatorNotified={false}
      actions={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}
