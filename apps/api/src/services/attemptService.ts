import { randomUUID } from 'node:crypto';
import {
  profileFlags,
  type DeviceFingerprint,
  type AssignedQuestion,
  type Candidate,
  type CandidateAssignment,
  type DeliveredQuestion,
  type Exam,
  type ExamAttempt,
  type ExaminationDevice,
  type Incident,
  type MonitoringPolicy,
  type AttemptProvenance,
  type ExamManifest,
  type ManifestEntry,
  type QuestionVersion,
  type SubmissionReceipt,
  type StationSecurityRules,
  type VerificationPolicy,
} from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { recordAudit, currentAnchorHash } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { evaluateCandidateNetwork, evaluateDeviceAssignment } from './deviceService.js';
import { attemptSeed, drawOptionOrder, drawPaper, DrawShortfallError } from '@sep/activation';
import { sha256Canonical, sha256Hex } from '../lib/crypto/canonical.js';
import { keyProvider } from '../lib/crypto/keyProvider.js';
import { releaseWindowOpen, verifyPaperIntegrity } from '../lib/crypto/paper.js';
import { env } from '../config/env.js';

/**
 * Server-authoritative attempt lifecycle.
 *
 * Nothing in this module trusts a client-supplied candidate id, attempt id,
 * remaining time, eligibility or mark. Every one of those is derived from the
 * authenticated session and the server's own records.
 */

export interface ActivationContext {
  candidate: Candidate;
  exam: Exam;
  /** Resolved workstation. Auto-detected where the policy enables it. */
  device: ExaminationDevice | undefined;
  /** What the client reported about itself, when it reported anything. */
  fingerprint: DeviceFingerprint | null;
  deviceCode: string;
  ipAddress: string;
  traceId: string;
  verification: { fingerprint: string; face: string };
  /** Effective rules sealed into the key that set this station up. */
  stationSecurity?: StationSecurityRules | null;
  /** Centre, room, sitting and machine, taken from the station's own key. */
  provenance?: AttemptProvenance | null;
}

export interface PreflightCheck {
  key: string;
  label: string;
  status: 'PASSED' | 'WARNING' | 'FAILED' | 'SKIPPED';
  detail: string;
  simulated: boolean;
}

export interface ActivationResult {
  attempt: ExamAttempt;
  assignment: CandidateAssignment;
  checks: PreflightCheck[];
}

export function effectiveVerificationPolicy(
  exam: Exam,
  stationSecurity?: StationSecurityRules | null,
): { policy: VerificationPolicy; requireRegisteredDevice: boolean } {
  const base = exam.securityPolicy.verification;
  if (!stationSecurity) {
    return {
      policy: base,
      requireRegisteredDevice: profileFlags(exam.securityPolicy.profileId).requireRegisteredDevice,
    };
  }

  const fingerprintEnabled = stationSecurity.fingerprint !== 'OFF';
  return {
    policy: {
      ...base,
      fingerprint: {
        ...base.fingerprint,
        enabled: fingerprintEnabled,
        requirement: stationSecurity.fingerprint === 'REQUIRED' ? 'REQUIRED' : 'OPTIONAL',
      },
      face: {
        ...base.face,
        enabled: stationSecurity.faceAtLogin,
      },
      requireAssignedDevice: stationSecurity.requireAssignedDevice,
      requireAssignedNetwork: stationSecurity.requireAssignedNetwork,
      autoDetectDevice: stationSecurity.requireRegisteredDevice && base.autoDetectDevice,
      requireNativeClient: stationSecurity.requireNativeClient,
    },
    requireRegisteredDevice: stationSecurity.requireRegisteredDevice,
  };
}

export function effectiveMonitoringPolicy(exam: Exam, stationSecurity?: StationSecurityRules | null): MonitoringPolicy {
  if (!stationSecurity) return exam.securityPolicy.monitoring;
  return {
    ...exam.securityPolicy.monitoring,
    cameraMonitoringEnabled: stationSecurity.cameraMonitoring,
    loginSnapshotEnabled: stationSecurity.loginSnapshot,
    facePresenceDetection: stationSecurity.facePresenceDuringExam,
    multipleFaceDetection: stationSecurity.multipleFaceDetection,
  };
}

const ALERTING_PREFLIGHT_CHECKS = new Set(['device', 'seat', 'network', 'client', 'paper']);

export function raisePreflightIncident(input: {
  candidate: Candidate;
  exam: Exam;
  device: ExaminationDevice | undefined;
  deviceCode: string;
  ipAddress: string;
  checks: PreflightCheck[];
}): Incident | null {
  const failed = input.checks.find((check) => check.status === 'FAILED' && ALERTING_PREFLIGHT_CHECKS.has(check.key));
  if (!failed) return null;

  const db = getDb();
  const centreId = input.exam.centreId ?? input.candidate.centreId ?? null;
  const type =
    failed.key === 'network'
      ? 'NETWORK_CHANGE'
      : failed.key === 'paper'
        ? 'PAPER_INTEGRITY_FAILURE'
        : failed.key === 'client'
          ? 'DEVICE_HEALTH_FAILURE'
          : 'UNAPPROVED_WORKSTATION';
  const severity = failed.key === 'paper' || failed.key === 'device' || failed.key === 'seat' ? 'CRITICAL' : 'WARNING';
  const reportedDeviceCode = input.device?.deviceCode ?? input.deviceCode;

  const existing = [...db.incidents.values()].find(
    (incident) =>
      incident.status !== 'RESOLVED' &&
      incident.type === type &&
      incident.examId === input.exam.id &&
      incident.candidateId === input.candidate.id &&
      incident.metadata?.checkKey === failed.key &&
      incident.metadata?.reportedDeviceCode === reportedDeviceCode,
  );

  const now = new Date().toISOString();
  const title =
    failed.key === 'network'
      ? 'Candidate workstation outside approved network'
      : failed.key === 'paper'
        ? 'Question paper integrity check failed'
        : failed.key === 'client'
          ? 'Candidate used an unmanaged examination client'
          : 'Candidate attempted an unapproved workstation';
  const detail = `${input.candidate.fullName} (${input.candidate.applicationId}) could not pass ${failed.label.toLowerCase()}. ${failed.detail}`;

  if (existing) {
    existing.detail = detail;
    existing.updatedAt = now;
    existing.metadata = {
      ...(existing.metadata ?? {}),
      reportedDeviceCode,
      reportedIpAddress: input.ipAddress,
      checkLabel: failed.label,
      checkDetail: failed.detail,
    };
    return existing;
  }

  const incident: Incident = {
    id: randomUUID(),
    type,
    severity,
    examId: input.exam.id,
    centreId,
    candidateId: input.candidate.id,
    attemptId: null,
    deviceId: input.device?.id ?? null,
    title,
    detail,
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
    assignedToUserId: null,
    notes: [],
    metadata: {
      checkKey: failed.key,
      checkLabel: failed.label,
      checkDetail: failed.detail,
      reportedDeviceCode,
      reportedIpAddress: input.ipAddress,
    },
  };
  db.incidents.set(incident.id, incident);
  return incident;
}

/* ------------------------------------------------------------------ */
/* Pre-flight verification                                             */
/* ------------------------------------------------------------------ */

/**
 * The verification sequence, driven entirely by the examination's own policy.
 *
 * Each check reports SKIPPED when the policy does not ask for it, so the
 * candidate sees exactly the steps this examination requires and no more. A
 * check that is enabled but non-blocking reports WARNING rather than FAILED, so
 * a fallible biometric never locks out a legitimate candidate on its own.
 */
export async function runPreflight(context: ActivationContext): Promise<PreflightCheck[]> {
  const db = getDb();
  const { candidate, exam, device, deviceCode, ipAddress } = context;
  const { policy, requireRegisteredDevice } = effectiveVerificationPolicy(exam, context.stationSecurity);
  const checks: PreflightCheck[] = [];

  // 1. Account
  checks.push({
    key: 'account',
    label: 'Account verified',
    status: candidate.accountStatus === 'ACTIVE' ? 'PASSED' : 'FAILED',
    detail:
      candidate.accountStatus === 'ACTIVE'
        ? `Signed in as ${candidate.fullName} (${candidate.applicationId}).`
        : 'This candidate account is not active. Contact the examination-centre operator.',
    simulated: false,
  });

  // 2. Eligibility — from the server record, never from the client.
  const eligible = candidate.eligibility !== 'INELIGIBLE' && candidate.examId === exam.id;
  checks.push({
    key: 'eligibility',
    label: 'Examination eligibility verified',
    status: eligible ? 'PASSED' : 'FAILED',
    detail: eligible
      ? `Registered for ${exam.name} at the assigned centre.`
      : 'This candidate is not registered for this examination.',
    simulated: false,
  });

  // 3. Managed client. A browser cannot enforce operating-system lockdown, so
  //    an examination may insist on the native Windows application.
  const client = context.fingerprint?.client ?? 'UNKNOWN';
  checks.push({
    key: 'client',
    label: 'Managed examination application',
    status: !policy.requireNativeClient ? 'SKIPPED' : client === 'WINDOWS_NATIVE' ? 'PASSED' : 'FAILED',
    detail: !policy.requireNativeClient
      ? 'This examination accepts either the managed application or a browser.'
      : client === 'WINDOWS_NATIVE'
        ? `Running in the managed Windows examination application${context.fingerprint?.clientVersion ? ` ${context.fingerprint.clientVersion}` : ''}.`
        : 'This examination requires the managed Windows examination application. A web browser cannot enforce operating-system lockdown and is refused.',
    simulated: false,
  });

  // 4. Workstation registration and certificate.
  const deviceOk = Boolean(
    device &&
      device.status === 'APPROVED' &&
      device.certificate.status !== 'REVOKED' &&
      device.certificate.status !== 'EXPIRED',
  );
  checks.push({
    key: 'device',
    label: policy.autoDetectDevice ? 'Workstation identified and verified' : 'Workstation certificate verified',
    status: !requireRegisteredDevice
      ? 'SKIPPED'
      : deviceOk
        ? 'PASSED'
        : 'FAILED',
    detail: !device
      ? policy.autoDetectDevice
        ? `This machine could not be matched to a registered workstation${deviceCode ? ` (reported as ${deviceCode})` : ''}.`
        : `Workstation ${deviceCode} is not registered with this centre.`
      : device.status === 'REVOKED'
        ? `Workstation ${device.deviceCode} has been revoked and cannot be used.`
        : device.status === 'PENDING'
          ? `Workstation ${device.deviceCode} is registered but not yet approved.`
          : `${device.deviceCode} — certificate ${device.certificate.serial} valid until ${new Date(device.certificate.expiresAt).toLocaleDateString()}.`,
    simulated: true,
  });

  // 5. Seat assignment: is this candidate permitted at *this* workstation?
  const seat = evaluateDeviceAssignment({
    examId: exam.id,
    candidateId: candidate.id,
    device,
    enforce: policy.requireAssignedDevice,
  });
  checks.push({
    key: 'seat',
    label: 'Assigned workstation verified',
    status: !policy.requireAssignedDevice ? 'SKIPPED' : seat.allowed ? 'PASSED' : 'FAILED',
    detail: seat.reason,
    simulated: false,
  });

  // 6. Approved network, using this candidate's ranges where they have their own.
  const network = evaluateCandidateNetwork({
    examId: exam.id,
    candidateId: candidate.id,
    ipAddress,
    examPrimary: exam.securityPolicy.network.primaryCidr,
    examBackup: exam.securityPolicy.network.backupCidr,
    examIpv6: exam.securityPolicy.network.ipv6Cidr,
    enforce: policy.requireAssignedNetwork,
  });
  checks.push({
    key: 'network',
    label: 'Approved network verified',
    status: !policy.requireAssignedNetwork ? 'SKIPPED' : network.allowed ? 'PASSED' : 'FAILED',
    detail: network.reason,
    simulated: false,
  });

  // 7. Fingerprint — POC biometric simulation, governed by the exam's policy.
  const fingerprintApplies =
    policy.fingerprint.enabled && (candidate.fingerprintEnrolled || !policy.fingerprint.skipIfNotEnrolled);
  const fingerprintOutcome = context.verification.fingerprint;
  checks.push({
    key: 'fingerprint',
    label: 'Fingerprint verification',
    status: !fingerprintApplies
      ? 'SKIPPED'
      : fingerprintOutcome === 'PASSED'
        ? 'PASSED'
        : fingerprintOutcome === 'OVERRIDDEN'
          ? 'WARNING'
          : fingerprintOutcome === 'FAILED'
            ? policy.fingerprint.requirement === 'REQUIRED' && !policy.fingerprint.allowInvigilatorOverride
              ? 'FAILED'
              : 'WARNING'
            : policy.fingerprint.requirement === 'REQUIRED'
              ? 'FAILED'
              : 'SKIPPED',
    detail: !policy.fingerprint.enabled
      ? 'Fingerprint verification is switched off for this examination.'
      : !candidate.fingerprintEnrolled
        ? 'No fingerprint is enrolled for this candidate, so the check was not required.'
        : fingerprintOutcome === 'OVERRIDDEN'
          ? 'Fingerprint could not be matched. An invigilator authorised the candidate to continue and the override is recorded.'
          : 'POC biometric simulation — a scanner adapter with scripted outcomes replaces real hardware.',
    simulated: true,
  });

  // 8. Face — POC biometric simulation, governed by the exam's policy.
  const faceApplies = policy.face.enabled && (candidate.faceEnrolled || !policy.face.skipIfNotEnrolled);
  const faceOutcome = context.verification.face;
  checks.push({
    key: 'face',
    label: 'Facial verification',
    status: !faceApplies
      ? 'SKIPPED'
      : faceOutcome === 'PASSED'
        ? 'PASSED'
        : faceOutcome === 'OVERRIDDEN'
          ? 'WARNING'
          : faceOutcome === 'FAILED'
            ? policy.face.requirement === 'REQUIRED' && !policy.face.allowInvigilatorOverride
              ? 'FAILED'
              : 'WARNING'
            : policy.face.requirement === 'REQUIRED'
              ? 'FAILED'
              : 'SKIPPED',
    detail: !policy.face.enabled
      ? 'Facial verification is switched off for this examination.'
      : !candidate.faceEnrolled
        ? 'No enrolment photograph is held for this candidate, so the check was not required.'
        : faceOutcome === 'OVERRIDDEN'
          ? 'Face comparison was inconclusive. An invigilator confirmed identity in person and the override is recorded.'
          : policy.face.compareToEnrolment
            ? 'POC biometric simulation — the comparison result is produced by a mock analyser, not a certified matching service.'
            : 'POC simulation — a presence-only check; no comparison against an enrolment photograph is made.',
    simulated: true,
  });

  // 9. Paper integrity — the paper is never released if this fails.
  const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
  if (!manifest) {
    checks.push({
      key: 'paper',
      label: 'Question paper verified',
      status: 'FAILED',
      detail: 'No published question paper is available for this examination.',
      simulated: false,
    });
  } else {
    const report = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
    checks.push({
      key: 'paper',
      label: 'Question paper verified',
      status: report.ok ? 'PASSED' : 'FAILED',
      detail: report.summary,
      simulated: false,
    });
  }

  return checks;
}

/* ------------------------------------------------------------------ */
/* Assignment                                                          */
/* ------------------------------------------------------------------ */

/**
 * Builds the one immutable assignment for an attempt.
 *
 * Each candidate draws their own paper from the sealed pool: the same number
 * of questions from each category, at the same spread of difficulty, but not
 * the same questions as the candidate at the next desk.
 *
 * Called exactly once. Reconnection replays the stored assignment rather than
 * regenerating it, so a candidate always sees the same paper in the same order.
 */
function buildAssignment(
  attempt: ExamAttempt,
  exam: Exam,
  manifest: ExamManifest,
  versions: Map<string, QuestionVersion>,
): CandidateAssignment {
  // The seed is derived, not random, so this exact paper can be reproduced
  // later from the attempt alone. That is what lets a centre running offline
  // hand back a paper the central server can independently check, and what
  // lets a candidate who loses power resume the paper they were sitting.
  const seed = attemptSeed({
    manifestHash: manifest.manifestHash,
    candidateId: attempt.candidateId,
    attemptId: attempt.id,
  });

  let entries: ManifestEntry[];
  try {
    entries = drawPaper(manifest.entries, manifest.quotas, seed, {
      randomizeQuestionOrder: exam.blueprint.randomizeQuestionOrder,
    });
  } catch (error) {
    if (error instanceof DrawShortfallError) {
      // The sealed pool cannot satisfy its own quotas. Refuse rather than hand
      // this candidate a shorter paper than everyone else received.
      throw Errors.paperIntegrity(error.message);
    }
    throw error;
  }

  const questions: AssignedQuestion[] = entries.map((entry, index) => {
    const version = versions.get(entry.questionVersionId);
    if (!version) {
      throw Errors.paperIntegrity('A question referenced by the manifest is missing.');
    }
    const optionIds = version.options.map((o) => o.id);
    const optionOrder = exam.blueprint.randomizeOptionOrder
      ? drawOptionOrder(optionIds, seed, entry.questionId)
      : optionIds;

    return {
      id: `${attempt.id}-aq-${index + 1}`,
      sequence: index + 1,
      questionId: entry.questionId,
      questionVersionId: entry.questionVersionId,
      optionOrder,
      // Marks come from the manifest entry, which fixed the category's value
      // when the paper was sealed. A later category edit cannot change them.
      marks: entry.marks,
      negativeMarks: exam.blueprint.negativeMarking ? entry.negativeMarks : 0,
      subject: version.subject,
      topic: version.topic,
      difficulty: version.difficulty,
      type: version.type,
      categoryId: version.categoryId,
      categoryCode: version.categoryCode,
      paragraphWordLimit: version.paragraphWordLimit,
    };
  });

  return {
    id: randomUUID(),
    attemptId: attempt.id,
    examId: exam.id,
    candidateId: attempt.candidateId,
    manifestId: manifest.id,
    seed,
    questions,
    createdAt: new Date().toISOString(),
    immutable: true,
  };
}

export async function activateAttempt(context: ActivationContext): Promise<ActivationResult> {
  const db = getDb();
  const { candidate, exam, device, deviceCode, ipAddress, traceId } = context;
  const flags = profileFlags(exam.securityPolicy.profileId);
  const bindAttemptToDevice = context.stationSecurity ? context.stationSecurity.requireRegisteredDevice : flags.bindAttemptToDevice;

  const checks = await runPreflight(context);
  const failed = checks.find((c) => c.status === 'FAILED');
  if (failed) {
    recordAudit({
      actorId: candidate.id,
      actorName: candidate.fullName,
      actorRole: 'CANDIDATE',
      action: 'ATTEMPT_ACTIVATED',
      targetType: 'ExamAttempt',
      targetId: 'n/a',
      targetLabel: `${exam.code} / ${candidate.applicationId}`,
      result: 'BLOCKED',
      reason: `Pre-flight check failed: ${failed.label}. ${failed.detail}`,
      ipAddress,
      traceId,
    });
    if (failed.key === 'device') throw Errors.unauthorizedDevice(deviceCode || 'this machine');
    if (failed.key === 'network') throw Errors.unauthorizedNetwork(ipAddress);
    if (failed.key === 'paper') throw Errors.paperIntegrity(failed.detail);
    if (failed.key === 'client') throw Errors.unmanagedClient();
    if (failed.key === 'seat') throw Errors.wrongWorkstation(failed.detail);
    throw Errors.conflict(failed.detail, 'Speak to the examination-centre operator before continuing.');
  }

  // One active attempt per candidate and exam.
  const existing = [...db.attempts.values()].find(
    (a) => a.candidateId === candidate.id && a.examId === exam.id,
  );
  if (existing) {
    if (existing.status === 'SUBMITTED' || existing.status === 'TERMINATED') {
      throw Errors.attemptFinalised();
    }
    if (bindAttemptToDevice) {
      const boundDevice = db.devices.get(existing.deviceId);
      if (boundDevice && device && boundDevice.id !== device.id) {
        throw Errors.conflict(
          `This examination was started on workstation ${boundDevice.deviceCode}.`,
          'An invigilator must approve a recovery before you can continue on a different workstation. Your saved answers are safe.',
        );
      }
    }
    // Reconnection: replay the stored assignment. Never regenerate it.
    const assignment = existing.assignmentId ? db.assignments.get(existing.assignmentId) : undefined;
    if (assignment) {
      existing.status = existing.status === 'DISCONNECTED' ? 'ACTIVE' : existing.status;
      existing.connectionStatus = 'ONLINE';
      recordAudit({
        actorId: candidate.id,
        actorName: candidate.fullName,
        actorRole: 'CANDIDATE',
        action: 'ATTEMPT_ACTIVATED',
        targetType: 'ExamAttempt',
        targetId: existing.id,
        targetLabel: `${exam.code} / ${candidate.applicationId}`,
        reason: 'Reconnected to an existing attempt. The stored question sequence was replayed unchanged.',
        deviceId: existing.deviceId,
        ipAddress,
        traceId,
      });
      return { attempt: existing, assignment, checks };
    }
  }

  const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
  if (!manifest) throw Errors.notFound('A published question paper for this examination');
  if (manifest.publicationStatus !== 'PUBLISHED') {
    throw Errors.conflict(
      'The question paper for this examination has not been published.',
      'The examination cannot start until publication is approved.',
    );
  }
  if (flags.hsmControlledRelease && !releaseWindowOpen(manifest)) {
    throw Errors.conflict(
      'The examination is outside its authorised release window.',
      'The key that unlocks the paper is only released during the scheduled examination window.',
    );
  }

  const attemptId = existing?.id ?? randomUUID();
  const startedAt = new Date();
  const totalMinutes = exam.durationMinutes + candidate.accommodations.additionalTimeMinutes;

  const attempt: ExamAttempt = existing ?? {
    id: attemptId,
    examId: exam.id,
    candidateId: candidate.id,
    deviceId: device?.id ?? 'device-unregistered',
    status: 'ACTIVE',
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(startedAt.getTime() + totalMinutes * 60_000).toISOString(),
    submittedAt: null,
    assignmentId: null,
    identityStatus: checks.some((c) => c.status === 'WARNING') ? 'WARNING' : 'VERIFIED',
    connectionStatus: 'ONLINE',
    consecutiveMonitoringFailures: 0,
    restrictionReason: null,
    alertLevel: checks.some((c) => c.status === 'WARNING') ? 'INFO' : 'NONE',
    lastAnswerSavedAt: null,
    additionalTimeMinutes: candidate.accommodations.additionalTimeMinutes,
    answeredCount: 0,
    flaggedCount: 0,
    reverificationRequestedAt: null,
    provenance: context.provenance ?? null,
  };
  attempt.status = 'ACTIVE';
  // Reconnecting to an existing attempt keeps the provenance it was started
  // with: a candidate who moves desk mid-examination did not sit a different
  // sitting, and the record should not claim they did.
  attempt.provenance = attempt.provenance ?? context.provenance ?? null;
  attempt.startedAt = attempt.startedAt ?? startedAt.toISOString();
  attempt.expiresAt = attempt.expiresAt ?? new Date(startedAt.getTime() + totalMinutes * 60_000).toISOString();

  const assignment = buildAssignment(attempt, exam, manifest, db.questionVersions);
  attempt.assignmentId = assignment.id;

  db.attempts.set(attempt.id, attempt);
  db.assignments.set(assignment.id, assignment);

  candidate.lastVerificationEvent = {
    type: 'ATTEMPT_ACTIVATION',
    result: attempt.identityStatus,
    at: new Date().toISOString(),
  };

  recordAudit({
    actorId: candidate.id,
    actorName: candidate.fullName,
    actorRole: 'CANDIDATE',
    action: 'ATTEMPT_ACTIVATED',
    targetType: 'ExamAttempt',
    targetId: attempt.id,
    targetLabel: `${exam.code} / ${candidate.applicationId}`,
    reason: 'Identity, device, network, eligibility and paper-integrity checks passed.',
    deviceId: attempt.deviceId,
    ipAddress,
    traceId,
  });
  recordAudit({
    actorId: 'system',
    actorName: 'Examination service',
    actorRole: 'SYSTEM',
    action: 'QUESTION_ASSIGNED',
    targetType: 'CandidateAssignment',
    targetId: assignment.id,
    targetLabel: `${assignment.questions.length} questions assigned to ${candidate.applicationId}`,
    reason: `Randomised question order: ${exam.blueprint.randomizeQuestionOrder ? 'enabled' : 'disabled'}; randomised option order: ${exam.blueprint.randomizeOptionOrder ? 'enabled' : 'disabled'}. The sequence is stored and replayed on reconnection.`,
    deviceId: attempt.deviceId,
    ipAddress,
    traceId,
  });

  return { attempt, assignment, checks };
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

export function assertAttemptOwnership(attemptId: string, candidateId: string): ExamAttempt {
  const db = getDb();
  const attempt = db.attempts.get(attemptId);
  // A candidate must never learn whether another candidate's attempt exists.
  if (!attempt || attempt.candidateId !== candidateId) {
    throw Errors.notFound('That examination attempt');
  }
  return attempt;
}

export function assertAttemptAnswerable(attempt: ExamAttempt): void {
  if (attempt.status === 'SUBMITTED' || attempt.status === 'TERMINATED') throw Errors.attemptFinalised();
  if (attempt.status !== 'ACTIVE') throw Errors.attemptNotActive(attempt.status);
  if (attempt.expiresAt && new Date(attempt.expiresAt) < new Date()) throw Errors.timeExpired();
}

/**
 * Builds the candidate-facing payload for one question.
 * Correct answers are deliberately absent: the client never receives the key.
 */
export function deliverQuestion(attempt: ExamAttempt, sequence: number): DeliveredQuestion {
  const db = getDb();
  const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;
  if (!assignment) throw Errors.notFound('The question assignment for this attempt');

  const assigned = assignment.questions.find((q) => q.sequence === sequence);
  if (!assigned) throw Errors.notFound(`Question ${sequence}`);

  const version = db.questionVersions.get(assigned.questionVersionId);
  if (!version) throw Errors.paperIntegrity('The approved question version is missing.');

  const byId = new Map(version.options.map((o) => [o.id, o]));
  const options = assigned.optionOrder
    .map((id, index) => {
      const option = byId.get(id);
      if (!option) return null;
      return {
        id: option.id,
        // Labels follow the delivered order, not the authored order.
        label: String.fromCharCode(65 + index),
        text: option.text,
      };
    })
    .filter((o): o is { id: string; label: string; text: string } => o !== null);

  const answer = db.answers.get(`${attempt.id}:${assigned.id}`);

  return {
    assignmentQuestionId: assigned.id,
    sequence: assigned.sequence,
    totalQuestions: assignment.questions.length,
    stem: version.stem,
    type: version.type,
    options,
    marks: assigned.marks,
    negativeMarks: assigned.negativeMarks,
    subject: assigned.subject,
    topic: assigned.topic,
    difficulty: assigned.difficulty,
    categoryCode: version.categoryCode,
    // Paragraph questions carry their word limit so the candidate sees it while
    // writing rather than discovering it when the save is rejected.
    paragraphWordLimit: version.paragraphWordLimit,
    savedAnswer: answer?.selectedOptionIds ?? null,
    savedText: answer?.textAnswer ?? null,
    answerVersion: answer?.version ?? 0,
    flagged: answer?.flagged ?? false,
    visited: answer?.visited ?? false,
  };
}

export interface NavigatorEntry {
  sequence: number;
  assignmentQuestionId: string;
  state: 'NOT_VISITED' | 'VISITED' | 'ANSWERED' | 'ANSWERED_FLAGGED' | 'FLAGGED';
  subject: string;
}

export function buildNavigator(attempt: ExamAttempt): NavigatorEntry[] {
  const db = getDb();
  const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;
  if (!assignment) return [];

  return assignment.questions.map((q) => {
    const answer = db.answers.get(`${attempt.id}:${q.id}`);
    const answered = Boolean(
      answer && (answer.selectedOptionIds.length > 0 || (answer.textAnswer ?? '').trim().length > 0),
    );
    const flagged = answer?.flagged ?? false;
    const state: NavigatorEntry['state'] = answered
      ? flagged
        ? 'ANSWERED_FLAGGED'
        : 'ANSWERED'
      : flagged
        ? 'FLAGGED'
        : answer?.visited
          ? 'VISITED'
          : 'NOT_VISITED';
    return { sequence: q.sequence, assignmentQuestionId: q.id, state, subject: q.subject };
  });
}

/* ------------------------------------------------------------------ */
/* Submission                                                          */
/* ------------------------------------------------------------------ */

export async function submitAttempt(
  attempt: ExamAttempt,
  candidate: Candidate,
  exam: Exam,
  device: ExaminationDevice | undefined,
  meta: { ipAddress: string; traceId: string; automatic?: boolean },
): Promise<SubmissionReceipt> {
  const db = getDb();
  if (attempt.status === 'SUBMITTED') {
    const existing = [...db.receipts.values()].find((r) => r.attemptId === attempt.id);
    if (existing) return existing;
  }

  const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;
  if (!assignment) throw Errors.notFound('The question assignment for this attempt');
  const manifest = db.manifests.get(assignment.manifestId);

  // The answer set is canonicalised before hashing so the fingerprint is stable.
  const finalAnswers = assignment.questions.map((q) => {
    const answer = db.answers.get(`${attempt.id}:${q.id}`);
    return {
      sequence: q.sequence,
      assignmentQuestionId: q.id,
      questionVersionId: q.questionVersionId,
      selectedOptionIds: [...(answer?.selectedOptionIds ?? [])].sort(),
      textAnswer: answer?.textAnswer ?? null,
      version: answer?.version ?? 0,
    };
  });

  const answeredCount = finalAnswers.filter(
    (a) => a.selectedOptionIds.length > 0 || (a.textAnswer && a.textAnswer.trim().length > 0),
  ).length;

  const answerSetHash = sha256Canonical({
    attemptId: attempt.id,
    candidateId: candidate.id,
    examId: exam.id,
    answers: finalAnswers,
  });

  const submittedAt = new Date();
  attempt.status = 'SUBMITTED';
  attempt.submittedAt = submittedAt.toISOString();
  attempt.answeredCount = answeredCount;
  attempt.alertLevel = 'NONE';
  attempt.restrictionReason = null;

  const receiptId = `RCPT-${exam.code}-${candidate.applicationId.split('-').pop() ?? '0'}-${submittedAt
    .getTime()
    .toString(36)
    .toUpperCase()}`;

  const kms = keyProvider();
  const anchorHash = currentAnchorHash();
  const receiptBody = {
    receiptId,
    attemptId: attempt.id,
    examId: exam.id,
    candidateId: candidate.id,
    applicationId: candidate.applicationId,
    submittedAt: submittedAt.toISOString(),
    answerSetHash,
    manifestHash: manifest?.manifestHash ?? 'unavailable',
    // Signed with the rest, so a result cannot later be moved to a different
    // centre, room or sitting without the signature failing.
    provenance: attempt.provenance ?? null,
    auditAnchorHash: anchorHash,
  };
  const signature = await kms.sign(Buffer.from(sha256Canonical(receiptBody), 'utf8'));

  const receipt: SubmissionReceipt = {
    id: randomUUID(),
    receiptId,
    attemptId: attempt.id,
    examId: exam.id,
    examName: exam.name,
    candidateId: candidate.candidateId,
    candidateName: candidate.fullName,
    applicationId: candidate.applicationId,
    centreName: db.centres.get(attempt.provenance?.centreId ?? exam.centreId)?.name ?? 'Unknown centre',
    deviceCode: attempt.provenance?.stationCode ?? device?.deviceCode ?? 'unregistered',
    provenance: attempt.provenance ?? null,
    submittedAt: submittedAt.toISOString(),
    serverTime: submittedAt.toISOString(),
    answeredCount,
    unansweredCount: assignment.questions.length - answeredCount,
    totalQuestions: assignment.questions.length,
    answerSetHash,
    manifestHash: manifest?.manifestHash ?? 'unavailable',
    assignmentSeedHash: sha256Hex(assignment.seed),
    signature,
    signingKeyReference: kms.signingKeyReference,
    auditAnchorHash: anchorHash,
  };

  db.receipts.set(receipt.id, receipt);

  recordAudit({
    actorId: candidate.id,
    actorName: candidate.fullName,
    actorRole: 'CANDIDATE',
    action: 'ATTEMPT_SUBMITTED',
    targetType: 'ExamAttempt',
    targetId: attempt.id,
    targetLabel: `${exam.code} / ${candidate.applicationId}`,
    reason: meta.automatic
      ? `Time expired. ${answeredCount} of ${assignment.questions.length} answered. Receipt ${receiptId}.`
      : `Submitted by the candidate. ${answeredCount} of ${assignment.questions.length} answered. Receipt ${receiptId}.`,
    deviceId: attempt.deviceId,
    ipAddress: meta.ipAddress,
    traceId: meta.traceId,
  });

  return receipt;
}

/** Server-authoritative remaining time. The client never supplies this. */
export function remainingSeconds(attempt: ExamAttempt): number {
  if (!attempt.expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - Date.now()) / 1000));
}

export function attemptSummary(attempt: ExamAttempt) {
  const db = getDb();
  const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;
  const total = assignment?.questions.length ?? 0;
  const navigator = buildNavigator(attempt);
  const answered = navigator.filter((n) => n.state === 'ANSWERED' || n.state === 'ANSWERED_FLAGGED').length;
  const flagged = navigator.filter((n) => n.state === 'FLAGGED' || n.state === 'ANSWERED_FLAGGED').length;
  return {
    total,
    answered,
    unanswered: total - answered,
    flagged,
    remainingSeconds: remainingSeconds(attempt),
    allowSelfApproval: env.ALLOW_SELF_APPROVAL,
  };
}
