import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';

/**
 * Answer-saving state machine for the candidate examination screen.
 *
 * Rules this encodes, all of which the candidate depends on:
 *   - a selection is sent to the server immediately;
 *   - a failed send keeps the answer on the workstation and says so honestly;
 *   - a retry reuses the same idempotency key, so a duplicate can never be
 *     recorded as a second answer;
 *   - a version conflict is surfaced as "reloaded", never as "lost".
 */

export type SaveState =
  | 'IDLE'
  | 'SAVING'
  | 'SAVED_LOCALLY'
  | 'SENDING'
  | 'SAVED'
  | 'RETRY'
  | 'RECONNECTED'
  | 'CONFLICT';

export interface SaveResponse {
  answer: { version: number; selectedOptionIds: string[]; flagged: boolean };
  outcome: string;
  committedAt: string;
}

export type PutAnswer = (
  path: string,
  body: {
    selectedOptionIds: string[];
    textAnswer: string | null;
    flagged: boolean;
    expectedVersion: number;
    clientCapturedAt: string;
  },
  extra: { idempotencyKey: string },
) => Promise<SaveResponse>;

export interface AnswerSaverOptions {
  attemptId: string;
  assignmentQuestionId: string;
  initialVersion?: number;
  /** Injectable for tests; defaults to the real API client. */
  put?: PutAnswer;
  /** The workstation believes it has no connection. */
  offline?: boolean;
  /** Presenter control: fail the first send once so the retry path is visible. */
  forceRetryOnce?: boolean;
  /** Presenter control: add latency so the saving state is visible. */
  slow?: boolean;
  onSaved?: (response: SaveResponse) => void;
  onConflict?: () => void;
}

export interface AnswerSaver {
  state: SaveState;
  error: ApiError | null;
  version: number;
  hasPending: boolean;
  save: (selectedOptionIds: string[], flagged: boolean, textAnswer?: string | null) => Promise<void>;
  retry: () => Promise<void>;
  reset: (version: number) => void;
}

const defaultPut: PutAnswer = (path, body, extra) => api.put<SaveResponse>(path, body, extra);

export function useAnswerSaver(options: AnswerSaverOptions): AnswerSaver {
  const {
    attemptId,
    assignmentQuestionId,
    initialVersion = 0,
    put = defaultPut,
    offline = false,
    forceRetryOnce = false,
    slow = false,
    onSaved,
    onConflict,
  } = options;

  const [state, setState] = useState<SaveState>(initialVersion > 0 ? 'SAVED' : 'IDLE');
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(initialVersion);

  const keyRef = useRef<string | null>(null);
  const pendingRef = useRef<{ selectedOptionIds: string[]; flagged: boolean; textAnswer: string | null } | null>(null);
  const forcedRef = useRef(false);
  const versionRef = useRef(initialVersion);

  useEffect(() => {
    versionRef.current = version;
  }, [version]);

  const send = useCallback(
    async (selectedOptionIds: string[], flagged: boolean, isRetry: boolean, textAnswer: string | null = null) => {
      if (offline) {
        pendingRef.current = { selectedOptionIds, flagged, textAnswer };
        if (!keyRef.current) keyRef.current = newIdempotencyKey();
        setState('SAVED_LOCALLY');
        return;
      }

      // The key is generated once per pending write and reused on every retry.
      const key = keyRef.current && isRetry ? keyRef.current : (keyRef.current = newIdempotencyKey());

      setState('SENDING');
      setError(null);

      if (forceRetryOnce && !forcedRef.current && !isRetry) {
        forcedRef.current = true;
        pendingRef.current = { selectedOptionIds, flagged, textAnswer };
        setState('RETRY');
        setError(
          new ApiError(0, {
            code: 'NETWORK_UNAVAILABLE',
            message: 'The answer could not be sent to the examination server.',
            guidance:
              'It is stored on this workstation and will be sent again automatically. You can also send it now — the same key is reused, so it can never be saved twice.',
            answersSafe: true,
            traceId: 'demo-forced-retry',
          }),
        );
        return;
      }

      try {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 900));

        const response = await put(
          `/attempts/${attemptId}/answers/${assignmentQuestionId}`,
          {
            selectedOptionIds,
            textAnswer,
            flagged,
            expectedVersion: versionRef.current,
            clientCapturedAt: new Date().toISOString(),
          },
          { idempotencyKey: key },
        );

        setVersion(response.answer.version);
        versionRef.current = response.answer.version;
        pendingRef.current = null;
        keyRef.current = null;
        setState(isRetry ? 'RECONNECTED' : 'SAVED');
        onSaved?.(response);
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'ANSWER_VERSION_CONFLICT') {
          pendingRef.current = null;
          keyRef.current = null;
          setState('CONFLICT');
          setError(caught);
          onConflict?.();
          return;
        }
        pendingRef.current = { selectedOptionIds, flagged, textAnswer };
        setState('RETRY');
        setError(caught instanceof ApiError ? caught : null);
      }
    },
    [attemptId, assignmentQuestionId, forceRetryOnce, offline, onConflict, onSaved, put, slow],
  );

  const save = useCallback(
    async (selectedOptionIds: string[], flagged: boolean, textAnswer: string | null = null) => {
      setState('SAVING');
      await send(selectedOptionIds, flagged, false, textAnswer);
    },
    [send],
  );

  const retry = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    await send(pending.selectedOptionIds, pending.flagged, true, pending.textAnswer);
  }, [send]);

  const reset = useCallback((nextVersion: number) => {
    setVersion(nextVersion);
    versionRef.current = nextVersion;
    pendingRef.current = null;
    keyRef.current = null;
    forcedRef.current = false;
    setError(null);
    setState(nextVersion > 0 ? 'SAVED' : 'IDLE');
  }, []);

  // When the connection returns, flush anything held on the workstation.
  useEffect(() => {
    if (!offline && pendingRef.current) void retry();
  }, [offline, retry]);

  // Periodic sweep so a pending write is never left indefinitely.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!offline && pendingRef.current) void retry();
    }, 15_000);
    return () => clearInterval(timer);
  }, [offline, retry]);

  return { state, error, version, hasPending: pendingRef.current !== null, save, retry, reset };
}

export const SAVE_STATE_LABELS: Record<SaveState, string> = {
  IDLE: 'No changes',
  SAVING: 'Saving',
  SAVED_LOCALLY: 'Saved on this workstation',
  SENDING: 'Sending',
  SAVED: 'Saved to the server',
  RETRY: 'Retry required',
  RECONNECTED: 'Reconnected and saved',
  CONFLICT: 'Answer reloaded',
};
