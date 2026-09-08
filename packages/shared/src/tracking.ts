import type { ISODateString } from './types.js';

/**
 * Real-time examination tracking.
 *
 * A continuously-running service that watches a live examination and answers one
 * question repeatedly: is anything about this examination not as it should be?
 *
 * It is deliberately separate from the invigilator dashboard. The dashboard
 * shows what candidates are doing; tracking shows whether the *examination
 * itself* is healthy — paper integrity, device conformance, network
 * conformance, save health, session anomalies and delivery progress. An
 * invigilator watches people; tracking watches the system, and escalates to
 * people.
 */

export type TrackingCheckId =
  | 'PAPER_INTEGRITY'
  | 'MANIFEST_SIGNATURE'
  | 'DEVICE_CONFORMANCE'
  | 'NETWORK_CONFORMANCE'
  | 'DEVICE_ASSIGNMENT'
  | 'ANSWER_SAVE_HEALTH'
  | 'SESSION_ANOMALY'
  | 'MONITORING_COVERAGE'
  | 'CLOCK_CONSISTENCY'
  | 'AUDIT_CHAIN'
  | 'DELIVERY_PROGRESS'
  | 'CAPACITY';

export type TrackingSeverity = 'OK' | 'INFO' | 'WARNING' | 'CRITICAL';

export interface TrackingCheck {
  id: TrackingCheckId;
  label: string;
  /** What this check actually looks at, in plain language. */
  explanation: string;
  severity: TrackingSeverity;
  /** One-line verdict, written for a non-technical reader. */
  summary: string;
  /** Supporting numbers the operations team will want. */
  metrics: { label: string; value: string | number }[];
  /** Candidates or devices implicated, where the check found something. */
  affected: TrackingSubject[];
  /** What a person should do about it, if anything. */
  action: string | null;
  checkedAt: ISODateString;
  /** How long the check took, so a slow check is itself visible. */
  durationMs: number;
}

export interface TrackingSubject {
  kind: 'CANDIDATE' | 'DEVICE' | 'ATTEMPT' | 'EXAM' | 'QUESTION';
  id: string;
  label: string;
  detail: string;
}

export interface TrackingSnapshot {
  examId: string;
  examCode: string;
  examName: string;
  generatedAt: ISODateString;
  /** Worst severity across all checks. */
  overall: TrackingSeverity;
  /** Rising count while the examination is running. */
  sequence: number;
  checks: TrackingCheck[];
  /** Live delivery figures, refreshed with every sweep. */
  delivery: {
    registered: number;
    notStarted: number;
    active: number;
    restricted: number;
    awaitingReview: number;
    disconnected: number;
    submitted: number;
    answersSavedLastMinute: number;
    averageAnswered: number;
    completionPercent: number;
  };
  /** Anything the sweep raised that a person has not yet acknowledged. */
  openFindings: TrackingFinding[];
}

export interface TrackingFinding {
  id: string;
  examId: string;
  checkId: TrackingCheckId;
  severity: TrackingSeverity;
  title: string;
  detail: string;
  action: string;
  subjects: TrackingSubject[];
  firstSeenAt: ISODateString;
  lastSeenAt: ISODateString;
  /** How many consecutive sweeps have seen this. Persistent means real. */
  occurrences: number;
  acknowledgedByUserId: string | null;
  acknowledgedAt: ISODateString | null;
  acknowledgementReason: string | null;
  resolvedAt: ISODateString | null;
  /** The audit event written when this finding was first raised. */
  auditEventId: string | null;
}

export interface TrackingServiceStatus {
  running: boolean;
  intervalSeconds: number;
  examsTracked: number;
  lastSweepAt: ISODateString | null;
  lastSweepDurationMs: number | null;
  sweepsCompleted: number;
  findingsRaised: number;
  /** Set when the service itself failed, which must never be silent. */
  lastError: string | null;
}

export const TRACKING_CHECK_CATALOGUE: Record<
  TrackingCheckId,
  { label: string; explanation: string; action: string }
> = {
  PAPER_INTEGRITY: {
    label: 'Question paper integrity',
    explanation:
      'Recomputes every question fingerprint and compares it with the value recorded when the paper was approved.',
    action: 'Block release, notify the examination controller and re-approve the paper before continuing.',
  },
  MANIFEST_SIGNATURE: {
    label: 'Paper signature',
    explanation: 'Verifies the digital signature that proves who approved this exact paper.',
    action: 'Treat the paper as untrusted and escalate to the security administrator immediately.',
  },
  DEVICE_CONFORMANCE: {
    label: 'Workstation conformance',
    explanation:
      'Checks that every workstation running an attempt is still approved, has a valid certificate and meets the minimum kiosk-policy version.',
    action: 'Move affected candidates to a conforming workstation and record a recovery approval.',
  },
  NETWORK_CONFORMANCE: {
    label: 'Network conformance',
    explanation: 'Confirms every live session is connecting from an approved examination-centre range.',
    action: 'Investigate the connection path with the centre’s technical support before allowing it to continue.',
  },
  DEVICE_ASSIGNMENT: {
    label: 'Candidate seat assignment',
    explanation: 'Confirms each candidate is sitting at the workstation they were assigned.',
    action: 'Confirm the candidate’s identity in person, then either move them back or release the assignment.',
  },
  ANSWER_SAVE_HEALTH: {
    label: 'Answer saving',
    explanation:
      'Watches for active candidates whose answers have not reached the server recently, and for repeated write conflicts.',
    action: 'Check the centre’s network before candidates lose confidence. Saved answers are unaffected.',
  },
  SESSION_ANOMALY: {
    label: 'Session anomalies',
    explanation:
      'Looks for impossible or suspicious session states — duplicate active attempts, attempts past their deadline, or sessions with no recent activity at all.',
    action: 'Open the affected session and decide whether to extend, restrict or recover it.',
  },
  MONITORING_COVERAGE: {
    label: 'Monitoring coverage',
    explanation:
      'Confirms that presence checks are actually arriving for every session, when the examination requires them.',
    action: 'A silent camera is as significant as a failed check. Attend the workstation.',
  },
  CLOCK_CONSISTENCY: {
    label: 'Clock consistency',
    explanation:
      'Compares the times workstations report with the server clock. Remaining time is always taken from the server, so a drifting workstation clock is a signal, not a risk.',
    action: 'Correct time synchronisation on the affected workstations after the examination.',
  },
  AUDIT_CHAIN: {
    label: 'Audit chain',
    explanation: 'Recomputes the append-only audit chain end to end and reports the first broken link.',
    action: 'Stop and escalate. A broken chain means the record of this examination cannot be trusted.',
  },
  DELIVERY_PROGRESS: {
    label: 'Delivery progress',
    explanation:
      'Compares how far candidates have progressed against the time elapsed, so a stalled cohort is visible early.',
    action: 'Check for a centre-wide problem such as a network fault or a projector announcement interrupting the hall.',
  },
  CAPACITY: {
    label: 'Service capacity',
    explanation: 'Watches response time, answer write throughput and error rates against the live session count.',
    action: 'Add capacity or shed non-examination load before candidates notice.',
  },
};

export const SEVERITY_ORDER: Record<TrackingSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
  OK: 3,
};

export function worstSeverity(severities: TrackingSeverity[]): TrackingSeverity {
  return severities.reduce<TrackingSeverity>(
    (worst, current) => (SEVERITY_ORDER[current] < SEVERITY_ORDER[worst] ? current : worst),
    'OK',
  );
}
