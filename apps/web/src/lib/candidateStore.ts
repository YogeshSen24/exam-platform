import { create } from 'zustand';

/**
 * Candidate workstation state.
 *
 * Deliberately small: the server is authoritative for the attempt, the question
 * sequence and the remaining time. This store only remembers where the
 * candidate is in the on-screen flow, plus the verification outcomes the
 * presenter has scripted, so a page refresh does not lose the journey.
 */

export type VerificationOutcome = 'PASSED' | 'SKIPPED' | 'OVERRIDDEN' | 'FAILED';

interface CandidateState {
  workstationCode: string;
  attemptId: string | null;
  fingerprintResult: VerificationOutcome;
  faceResult: VerificationOutcome;
  consentGiven: boolean;
  /** Answers acknowledged by the server, kept for the offline indicator. */
  pendingWrites: number;
  connection: 'ONLINE' | 'RECONNECTING' | 'OFFLINE';

  setWorkstationCode: (code: string) => void;
  setAttemptId: (id: string | null) => void;
  setFingerprintResult: (result: VerificationOutcome) => void;
  setFaceResult: (result: VerificationOutcome) => void;
  setConsentGiven: (given: boolean) => void;
  setConnection: (status: CandidateState['connection']) => void;
  setPendingWrites: (count: number) => void;
  reset: () => void;
}

const STORAGE_KEY = 'sep.candidate.session';

function restore(): Partial<CandidateState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<CandidateState>) : {};
  } catch {
    return {};
  }
}

function persist(state: CandidateState) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        workstationCode: state.workstationCode,
        attemptId: state.attemptId,
        fingerprintResult: state.fingerprintResult,
        faceResult: state.faceResult,
        consentGiven: state.consentGiven,
      }),
    );
  } catch {
    // Session storage may be unavailable; the server remains authoritative.
  }
}

const restored = restore();

export const useCandidateStore = create<CandidateState>((set, get) => ({
  workstationCode: restored.workstationCode ?? 'WS-CEC-001',
  attemptId: restored.attemptId ?? null,
  fingerprintResult: restored.fingerprintResult ?? 'SKIPPED',
  faceResult: restored.faceResult ?? 'SKIPPED',
  consentGiven: restored.consentGiven ?? false,
  pendingWrites: 0,
  connection: 'ONLINE',

  setWorkstationCode: (workstationCode) => {
    set({ workstationCode });
    persist(get());
  },
  setAttemptId: (attemptId) => {
    set({ attemptId });
    persist(get());
  },
  setFingerprintResult: (fingerprintResult) => {
    set({ fingerprintResult });
    persist(get());
  },
  setFaceResult: (faceResult) => {
    set({ faceResult });
    persist(get());
  },
  setConsentGiven: (consentGiven) => {
    set({ consentGiven });
    persist(get());
  },
  setConnection: (connection) => set({ connection }),
  setPendingWrites: (pendingWrites) => set({ pendingWrites }),
  reset: () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    set({
      attemptId: null,
      fingerprintResult: 'SKIPPED',
      faceResult: 'SKIPPED',
      consentGiven: false,
      pendingWrites: 0,
      connection: 'ONLINE',
    });
  },
}));

export const WORKSTATIONS = Array.from({ length: 25 }, (_, index) => `WS-CEC-${String(index + 1).padStart(3, '0')}`);
