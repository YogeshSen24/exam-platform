import { create } from 'zustand';
import type { FingerprintOutcome } from './deviceSecurity';
import { setSimulatedClientIp } from './api';

/**
 * Presenter controls.
 *
 * Available in development builds only. These switches script the outcome of
 * simulated checks so a demonstration is repeatable — they never bypass a
 * server-side authorisation or integrity rule.
 */

export type FaceOutcome = 'VERIFIED' | 'NO_FACE' | 'MULTIPLE_FACES' | 'UNCLEAR' | 'LOW_LIGHT' | 'MISMATCH';

interface DemoState {
  open: boolean;
  enabled: boolean;
  /** Scripted outcome for the next fingerprint scan. */
  fingerprint: FingerprintOutcome;
  /** Scripted outcome for the next face check. */
  face: FaceOutcome;
  /** Forces the client to behave as if the network has dropped. */
  simulateOffline: boolean;
  /** Sends a client address outside the approved centre range. */
  simulateOffNetwork: boolean;
  /** Forces the next answer save to fail once, exercising the retry path. */
  forceAnswerRetry: boolean;
  /** Slows responses so loading states are visible during a demonstration. */
  slowNetwork: boolean;
  lastAction: string | null;

  setOpen: (open: boolean) => void;
  setFingerprint: (outcome: FingerprintOutcome) => void;
  setFace: (outcome: FaceOutcome) => void;
  setSimulateOffline: (value: boolean) => void;
  setSimulateOffNetwork: (value: boolean) => void;
  setForceAnswerRetry: (value: boolean) => void;
  setSlowNetwork: (value: boolean) => void;
  note: (action: string) => void;
  reset: () => void;
}

const OFF_NETWORK_ADDRESS = '203.0.113.55';

export const useDemoStore = create<DemoState>((set) => ({
  open: false,
  enabled: import.meta.env.DEV,
  fingerprint: 'MATCH',
  face: 'VERIFIED',
  simulateOffline: false,
  simulateOffNetwork: false,
  forceAnswerRetry: false,
  slowNetwork: false,
  lastAction: null,

  setOpen: (open) => set({ open }),
  setFingerprint: (fingerprint) => set({ fingerprint, lastAction: `Fingerprint scanner set to ${fingerprint}` }),
  setFace: (face) => set({ face, lastAction: `Face check set to ${face}` }),
  setSimulateOffline: (simulateOffline) =>
    set({ simulateOffline, lastAction: simulateOffline ? 'Network disconnected' : 'Network restored' }),
  setSimulateOffNetwork: (simulateOffNetwork) => {
    setSimulatedClientIp(simulateOffNetwork ? OFF_NETWORK_ADDRESS : '');
    set({
      simulateOffNetwork,
      lastAction: simulateOffNetwork
        ? `Workstation reporting from ${OFF_NETWORK_ADDRESS} (outside the approved range)`
        : 'Workstation returned to the approved examination network',
    });
  },
  setForceAnswerRetry: (forceAnswerRetry) =>
    set({ forceAnswerRetry, lastAction: forceAnswerRetry ? 'Next answer save will need a retry' : 'Answer saving normal' }),
  setSlowNetwork: (slowNetwork) => set({ slowNetwork, lastAction: slowNetwork ? 'Slow network enabled' : 'Slow network disabled' }),
  note: (lastAction) => set({ lastAction }),
  reset: () => {
    setSimulatedClientIp('');
    set({
      fingerprint: 'MATCH',
      face: 'VERIFIED',
      simulateOffline: false,
      simulateOffNetwork: false,
      forceAnswerRetry: false,
      slowNetwork: false,
      lastAction: 'Presenter controls reset',
    });
  },
}));

export const FACE_OUTCOME_TO_RESULT: Record<FaceOutcome, string> = {
  VERIFIED: 'FACE_VERIFIED',
  NO_FACE: 'NO_FACE_DETECTED',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  UNCLEAR: 'FACE_UNCLEAR',
  LOW_LIGHT: 'LOW_LIGHT',
  MISMATCH: 'IDENTITY_MISMATCH',
};
