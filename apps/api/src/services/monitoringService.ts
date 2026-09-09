import { randomUUID } from 'node:crypto';
import type {
  Candidate,
  EvidenceObject,
  Exam,
  ExamAttempt,
  Incident,
  MonitoringPolicy,
  ProctoringEvent,
  ProctoringResult,
} from '@sep/shared';
import { PROCTORING_RESULT_LABELS } from '@sep/shared';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { objectStore } from '../lib/store/adapters.js';
import { sha256Hex } from '../lib/crypto/canonical.js';
import { cache } from '../lib/store/adapters.js';

/**
 * Optional camera-presence monitoring.
 *
 * POC boundary: presence results are produced by a mock analyser on the client
 * and sent with the capture. A production system evaluates frames server-side
 * with a validated vision service and never trusts a client-declared verdict.
 * The escalation logic, evidence chain and invigilator workflow below are real.
 *
 * Two rules are absolute:
 *   - answers are never discarded while a session is restricted;
 *   - software never terminates an attempt on the strength of automated
 *     analysis alone. A human decides.
 */

const FAILURE_RESULTS: ProctoringResult[] = [
  'NO_FACE_DETECTED',
  'MULTIPLE_FACES',
  'FACE_UNCLEAR',
  'LOW_LIGHT',
  'CAMERA_BLOCKED',
  'IDENTITY_MISMATCH',
];

export interface CaptureChallenge {
  challengeId: string;
  attemptId: string;
  issuedAt: string;
  expiresAt: string;
  sequence: number;
}

/**
 * Server-issued capture challenge. Binding each capture to a challenge the
 * server issued makes a pre-recorded or replayed image detectable.
 */
export async function issueChallenge(attempt: ExamAttempt): Promise<CaptureChallenge> {
  const db = getDb();
  const previous = db.proctoringEvents.filter((e) => e.attemptId === attempt.id);
  const challenge: CaptureChallenge = {
    challengeId: randomUUID(),
    attemptId: attempt.id,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    sequence: previous.length + 1,
  };
  await cache.set(`challenge:${challenge.challengeId}`, challenge, 120).catch(() => undefined);
  return challenge;
}

export interface EvidenceSubmission {
  attempt: ExamAttempt;
  candidate: Candidate;
  exam: Exam;
  challengeId: string;
  sequence: number;
  capturedAt: string;
  previousEvidenceHash: string | null;
  result: ProctoringResult;
  imageBytes: number;
  deviceCode: string;
  ipAddress: string;
  traceId: string;
  monitoring?: MonitoringPolicy;
}

export interface EvidenceOutcome {
  event: ProctoringEvent;
  evidence: EvidenceObject;
  consecutiveFailures: number;
  /** What the candidate application should do next. */
  response: 'NONE' | 'SUBTLE_WARNING' | 'PROMINENT_WARNING' | 'RESTRICT_NAVIGATION';
  restricted: boolean;
  message: string;
  invigilatorNotified: boolean;
  answersSafe: true;
}

export async function recordEvidence(submission: EvidenceSubmission): Promise<EvidenceOutcome> {
  const db = getDb();
  const { attempt, candidate, exam, result } = submission;
  const monitoring = submission.monitoring ?? exam.securityPolicy.monitoring;
  const threshold = monitoring.consecutiveFailureThreshold;

  // Store the evidence object first; the local copy is only released once the
  // server acknowledges, which the client enforces on its side.
  const objectKey = `evidence/${exam.code}/${attempt.id}/${String(submission.sequence).padStart(5, '0')}.jpg`;
  const syntheticBody = Buffer.from(
    `${attempt.id}:${submission.challengeId}:${submission.sequence}:${submission.capturedAt}`,
    'utf8',
  );
  const stored = await objectStore.put(objectKey, syntheticBody, 'image/jpeg');

  const previousHash =
    submission.previousEvidenceHash ??
    db.proctoringEvents.filter((e) => e.attemptId === attempt.id).slice(-1)[0]?.evidenceHash ??
    null;

  // Chaining each capture to the one before it makes a removed frame detectable.
  const evidenceHash = sha256Hex(
    `${previousHash ?? 'genesis'}|${stored.sha256}|${submission.sequence}|${submission.capturedAt}`,
  );

  const evidence: EvidenceObject = {
    id: randomUUID(),
    attemptId: attempt.id,
    bucket: stored.bucket,
    objectKey: stored.key,
    contentType: stored.contentType,
    sizeBytes: submission.imageBytes,
    sha256: stored.sha256,
    createdAt: stored.createdAt,
    retentionUntil: new Date(Date.now() + monitoring.evidenceRetentionDays * 86_400_000).toISOString(),
    accessLog: [],
    uploadState: objectStore.queuedCount() > 0 ? 'DELAYED' : 'STORED',
  };
  db.evidenceObjects.set(evidence.id, evidence);

  const isFailure = FAILURE_RESULTS.includes(result);
  attempt.consecutiveMonitoringFailures = isFailure ? attempt.consecutiveMonitoringFailures + 1 : 0;
  const consecutive = attempt.consecutiveMonitoringFailures;

  const severity: ProctoringEvent['severity'] = !isFailure
    ? 'INFO'
    : consecutive >= threshold
      ? 'CRITICAL'
      : 'WARNING';

  const event: ProctoringEvent = {
    id: randomUUID(),
    attemptId: attempt.id,
    candidateId: candidate.id,
    examId: exam.id,
    sequence: submission.sequence,
    challengeId: submission.challengeId,
    result,
    confidence: isFailure ? 0.35 + Math.random() * 0.3 : 0.9 + Math.random() * 0.09,
    capturedAt: submission.capturedAt,
    receivedAt: new Date().toISOString(),
    evidenceObjectId: evidence.id,
    previousEvidenceHash: previousHash,
    evidenceHash,
    severity,
    reviewedByUserId: null,
    simulated: true,
  };
  db.proctoringEvents.push(event);

  // Progressive response. Restriction limits navigation only — it never
  // discards an answer and never ends the attempt.
  let response: EvidenceOutcome['response'] = 'NONE';
  let message = 'Presence confirmed.';
  let invigilatorNotified = false;

  if (isFailure) {
    if (consecutive === 1) {
      response = 'SUBTLE_WARNING';
      message = `${PROCTORING_RESULT_LABELS[result]}. Please face the camera. Your answers are saved and unaffected.`;
    } else if (consecutive === 2) {
      response = 'PROMINENT_WARNING';
      message = `${PROCTORING_RESULT_LABELS[result]} twice in a row. A camera preview is shown so you can reposition. Your answers are saved and unaffected.`;
    } else {
      response = 'RESTRICT_NAVIGATION';
      attempt.status = 'RESTRICTED';
      attempt.alertLevel = 'CRITICAL';
      attempt.identityStatus = 'WARNING';
      attempt.restrictionReason = `${consecutive} consecutive presence checks failed (${PROCTORING_RESULT_LABELS[result]}).`;
      invigilatorNotified = true;
      message =
        'Question navigation is paused while your identity is confirmed. Every answer you have given is saved on the server and will not be lost. An invigilator has been notified.';

      raiseIncident(db.incidents, {
        type: result === 'MULTIPLE_FACES' ? 'MULTIPLE_FACES' : result === 'CAMERA_BLOCKED' ? 'CAMERA_BLOCKED' : 'REPEATED_FACE_ABSENCE',
        severity: 'CRITICAL',
        examId: exam.id,
        centreId: exam.centreId,
        candidateId: candidate.id,
        attemptId: attempt.id,
        deviceId: attempt.deviceId,
        title: `${consecutive} consecutive presence checks failed`,
        detail: `${PROCTORING_RESULT_LABELS[result]} for ${candidate.fullName} (${candidate.applicationId}). Navigation restricted pending verification. Answers are unaffected.`,
      });
    }

    recordAudit({
      actorId: 'system',
      actorName: 'Presence monitoring',
      actorRole: 'SYSTEM',
      action: 'CAMERA_WARNING',
      targetType: 'ExamAttempt',
      targetId: attempt.id,
      targetLabel: `${candidate.applicationId} — check ${submission.sequence}`,
      result: consecutive >= threshold ? 'BLOCKED' : 'FAILURE',
      reason: `${PROCTORING_RESULT_LABELS[result]} (consecutive failures: ${consecutive}). Simulated analyser result.`,
      deviceId: attempt.deviceId,
      ipAddress: submission.ipAddress,
      traceId: submission.traceId,
    });
  } else if (attempt.status === 'RESTRICTED' && attempt.consecutiveMonitoringFailures === 0) {
    // Automatic restore only where policy allows it; otherwise a human decides.
    if (monitoring.reverificationMode === 'AUTOMATIC') {
      attempt.status = 'ACTIVE';
      attempt.alertLevel = 'NONE';
      attempt.restrictionReason = null;
      attempt.identityStatus = 'VERIFIED';
      message = 'Identity confirmed. The examination has resumed.';
    } else {
      attempt.status = 'AWAITING_REVERIFICATION';
      message =
        'Your camera check has passed. An invigilator will confirm and release your session shortly. Your answers are safe.';
      invigilatorNotified = true;
    }
  }

  return {
    event,
    evidence,
    consecutiveFailures: consecutive,
    response,
    restricted: attempt.status === 'RESTRICTED',
    message,
    invigilatorNotified,
    answersSafe: true,
  };
}

export function raiseIncident(
  incidents: Map<string, Incident>,
  input: Omit<Incident, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'assignedToUserId' | 'notes'>,
): Incident {
  const now = new Date().toISOString();
  const incident: Incident = {
    ...input,
    id: randomUUID(),
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
    assignedToUserId: null,
    notes: [],
  };
  incidents.set(incident.id, incident);
  return incident;
}
