import type { CategoryQuota, SecurityProfileId } from '@sep/shared';

export type { CategoryQuota };

/**
 * The examination key.
 *
 * One key sets a machine up for one examination at one centre. A board runs
 * many examinations at once, so the key is how a machine knows *which* one it
 * is running: a moderator pastes it in, and that station is bound to that
 * examination until the key expires.
 *
 * The key carries the rules and the metadata, never the questions. Question
 * content stays in the separately sealed package and is released on its own
 * schedule, so a key that leaks does not leak an examination.
 */

export interface ActivationCentre {
  id: string;
  code: string;
  name: string;
}

export interface ActivationExam {
  id: string;
  code: string;
  name: string;
  /** The sealed paper this key expects. A station refuses a paper that disagrees. */
  manifestId: string;
  examVersion: number;
  securityProfileId: SecurityProfileId;
}

export interface ActivationWindow {
  /** No candidate may start before this instant. */
  opensAt: string;
  closesAt: string;
  durationMinutes: number;
}

/** Identity checks this examination demands, in plain terms. */
export interface VerificationRules {
  fingerprint: 'OFF' | 'OPTIONAL' | 'REQUIRED';
  faceAtLogin: boolean;
  /** Require the station to match an approved workstation in the device register. */
  registeredWorkstation: boolean;
  /** Require the candidate to sit at the workstation assigned to them. */
  assignedWorkstation: boolean;
  /** Require the request to come from the approved examination network. */
  approvedNetwork: boolean;
  /** Require the managed Windows examination application rather than a browser. */
  managedClient: boolean;
  /** Face checks repeated during the examination, not just at sign-in. */
  facePresenceDuringExam: boolean;
  /** A failed check raises an invigilator alert instead of ejecting the candidate. */
  invigilatorResolvesFailures: boolean;
}

export interface MonitoringRules {
  cameraMonitoring: boolean;
  loginSnapshot: boolean;
  snapshotIntervalSeconds: number;
  multipleFaceDetection: boolean;
  /** How long evidence is kept before it may be discarded. */
  evidenceRetentionDays: number;
}

export interface DeliveryRules {
  quotas: CategoryQuota[];
  totalDelivered: number;
  totalMarks: number;
  randomizeQuestionOrder: boolean;
  randomizeOptionOrder: boolean;
  negativeMarking: boolean;
  allowFlagForReview: boolean;
  allowBackNavigation: boolean;
}

/** What a station set up with this key is allowed to do, and what is recorded. */
export interface StationRules {
  /** Every station that redeems this key is recorded and reported. */
  trackStation: boolean;
  /** Maximum stations this key may set up. Guards against key sharing. */
  maxStations: number;
  /** Run full screen with a single task on screen. Not operating-system lockdown. */
  fullScreenExamShell: boolean;
  /** Report focus loss and tab switching to the invigilator. */
  reportFocusLoss: boolean;
  /** Networks a station may be redeemed from. Empty means anywhere. */
  allowedCidrs: string[];
}

export interface ActivationRules {
  verification: VerificationRules;
  monitoring: MonitoringRules;
  delivery: DeliveryRules;
  station: StationRules;
}

/**
 * Free-form metadata the board attaches to a key.
 *
 * A board runs the same examination in many rooms on the same morning, and
 * needs to be able to tell the results apart afterwards. Whatever is put here
 * is stamped onto every attempt started from a station set up with this key.
 */
export interface ActivationLabels {
  /** Room, hall or laboratory this key is for. */
  room: string;
  /** Morning, afternoon, or a named sitting. */
  session: string;
  /** Anything else the board wants carried through to the results. */
  tags: Record<string, string>;
}

/** The complete decrypted contents of an examination key. */
export interface ActivationPayload {
  formatVersion: 1;
  /** Unique id, recorded centrally so a key can be traced or revoked. */
  keyId: string;
  issuedAt: string;
  expiresAt: string;
  issuedByUserId: string;
  issuedByName: string;
  deploymentId: string;
  centre: ActivationCentre;
  exam: ActivationExam;
  window: ActivationWindow;
  rules: ActivationRules;
  labels: ActivationLabels;
  /** Free-text note shown to the moderator after a successful setup. */
  note: string;
}

/** Result of opening a key, ready to be shown to a human. */
export interface OpenedKey {
  payload: ActivationPayload;
  /** Fingerprint of the key itself, for the audit trail and support calls. */
  keyFingerprint: string;
}
