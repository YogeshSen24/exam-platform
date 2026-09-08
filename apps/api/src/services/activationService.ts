import { createHash, randomUUID } from 'node:crypto';
import {
  keyringFromSecret,
  openActivationKey,
  sealActivationKey,
  validateActivation,
  type ActivationPayload,
  type ActivationRules,
  type DeploymentKeyring,
} from '@sep/activation';
import {
  profileFlags,
  type ActivationKeyRecord,
  type AttemptProvenance,
  type Exam,
  type ExaminationCentre,
  type ExamManifest,
  type StationRecord,
} from '@sep/shared';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { getDb } from '../lib/store/db.js';
import { recordAudit } from '../lib/audit.js';

/**
 * Examination keys.
 *
 * A board runs several examinations at once, so a machine in a room has to be
 * told which one it is running. That is what a key is for: a moderator pastes
 * it in, the machine becomes a station for that examination, and every attempt
 * started there is stamped with where it happened.
 *
 * Issuing a key is also the moment the rules are decided, and deliberately the
 * only such moment. A station cannot loosen a rule locally, because it takes
 * its rules from the key and nowhere else.
 */

let cachedKeyring: DeploymentKeyring | null = null;

export function deploymentKeyring(): DeploymentKeyring {
  if (!cachedKeyring || cachedKeyring.deploymentId !== env.DEPLOYMENT_ID) {
    cachedKeyring = keyringFromSecret(env.DEPLOYMENT_ID, env.DEPLOYMENT_SECRET);
  }
  return cachedKeyring;
}

export interface IssueKeyOptions {
  examId: string;
  centreId: string;
  issuedByUserId: string;
  issuedByName: string;
  /** How long the key itself remains usable, in days. */
  validForDays: number;
  maxStations: number;
  /** Metadata carried onto every result from a station set up with this key. */
  room: string;
  session: string;
  tags: Record<string, string>;
  note: string;
  /** Overrides on top of the examination's own security policy. */
  overrides?: Partial<{
    fingerprint: ActivationRules['verification']['fingerprint'];
    faceAtLogin: boolean;
    cameraMonitoring: boolean;
  }>;
}

export interface IssuedKey {
  /** The pasteable key. Returned once, at issue time, and never stored. */
  key: string;
  record: ActivationKeyRecord;
  payload: ActivationPayload;
}

/**
 * Translates an examination's security policy into the rules a station will
 * actually enforce.
 *
 * The policy is the source of truth. Overrides exist because a centre
 * sometimes genuinely differs - one site has fingerprint readers and another
 * does not - but every override is sealed into the key and recorded in the
 * audit trail.
 */
function buildRules(exam: Exam, manifest: ExamManifest, options: IssueKeyOptions): ActivationRules {
  const flags = profileFlags(exam.securityPolicy.profileId);
  const monitoring = exam.securityPolicy.monitoring;
  const overrides = options.overrides ?? {};

  return {
    verification: {
      fingerprint:
        overrides.fingerprint ??
        (flags.fingerprintVerification.toUpperCase() as ActivationRules['verification']['fingerprint']),
      faceAtLogin: overrides.faceAtLogin ?? flags.requireFaceVerificationAtLogin,
      facePresenceDuringExam: flags.periodicFacePresence,
      invigilatorResolvesFailures: flags.invigilatorReviewWorkflow,
    },
    monitoring: {
      cameraMonitoring: overrides.cameraMonitoring ?? monitoring.cameraMonitoringEnabled,
      loginSnapshot: monitoring.loginSnapshotEnabled,
      snapshotIntervalSeconds: monitoring.snapshotIntervalSeconds,
      multipleFaceDetection: monitoring.multipleFaceDetection,
      evidenceRetentionDays: monitoring.evidenceRetentionDays,
    },
    delivery: {
      quotas: manifest.quotas,
      totalDelivered: manifest.deliveredQuestionCount,
      totalMarks: manifest.deliveredTotalMarks,
      randomizeQuestionOrder: exam.blueprint.randomizeQuestionOrder,
      randomizeOptionOrder: exam.blueprint.randomizeOptionOrder,
      negativeMarking: exam.blueprint.negativeMarking,
      allowFlagForReview: true,
      allowBackNavigation: true,
    },
    station: {
      trackStation: true,
      maxStations: options.maxStations,
      fullScreenExamShell: true,
      reportFocusLoss: true,
      allowedCidrs: [exam.securityPolicy.network.primaryCidr, exam.securityPolicy.network.backupCidr].filter(
        (cidr): cidr is string => Boolean(cidr),
      ),
    },
  };
}

export function issueActivationKey(options: IssueKeyOptions): IssuedKey {
  const db = getDb();
  const keyring = deploymentKeyring();

  const exam = db.exams.get(options.examId);
  if (!exam) throw Errors.notFound('That examination');

  const centre = db.centres.get(options.centreId);
  if (!centre) throw Errors.notFound('That examination centre');

  const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
  if (!manifest) {
    throw Errors.conflict(
      'This examination has no sealed paper yet.',
      'Assemble and publish the paper before issuing keys, otherwise a machine would be set up for questions that do not exist.',
    );
  }
  if (manifest.publicationStatus !== 'PUBLISHED') {
    throw Errors.conflict('This paper has not been published yet.', 'Complete the approval steps before issuing keys.');
  }

  const now = new Date();
  const startsAt = new Date(exam.startsAt);
  const closesAt = new Date(startsAt.getTime() + (exam.durationMinutes + 120) * 60_000);
  const expiresAt = new Date(now.getTime() + options.validForDays * 86_400_000);

  const payload: ActivationPayload = {
    formatVersion: 1,
    keyId: randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    issuedByUserId: options.issuedByUserId,
    issuedByName: options.issuedByName,
    deploymentId: env.DEPLOYMENT_ID,
    centre: { id: centre.id, code: centre.code, name: centre.name },
    exam: {
      id: exam.id,
      code: exam.code,
      name: exam.name,
      manifestId: manifest.id,
      examVersion: manifest.examVersion,
      securityProfileId: exam.securityPolicy.profileId,
    },
    window: {
      opensAt: startsAt.toISOString(),
      closesAt: closesAt.toISOString(),
      durationMinutes: exam.durationMinutes,
    },
    rules: buildRules(exam, manifest, options),
    labels: { room: options.room, session: options.session, tags: options.tags },
    note: options.note,
  };

  const key = sealActivationKey(payload, keyring);

  const record: ActivationKeyRecord = {
    id: payload.keyId,
    // The fingerprint is what gets stored and displayed. The key does not.
    fingerprint: createHash('sha256').update(key).digest('hex'),
    examId: exam.id,
    examCode: exam.code,
    examName: exam.name,
    centreId: centre.id,
    centreCode: centre.code,
    centreName: centre.name,
    status: 'ISSUED',
    issuedAt: payload.issuedAt,
    issuedByUserId: options.issuedByUserId,
    issuedByName: options.issuedByName,
    expiresAt: payload.expiresAt,
    activatedAt: null,
    activatedByStation: null,
    maxStations: options.maxStations,
    activationCount: 0,
    revokedAt: null,
    revokedByUserId: null,
    revokedReason: null,
    room: options.room,
    session: options.session,
    tags: options.tags,
    note: options.note,
  };

  db.activationKeys.set(record.id, record);
  return { key, record, payload };
}

export function revokeActivationKey(keyId: string, userId: string, reason: string): ActivationKeyRecord {
  const db = getDb();
  const record = db.activationKeys.get(keyId);
  if (!record) throw Errors.notFound('That examination key');
  if (record.status === 'REVOKED') {
    throw Errors.conflict('This key has already been revoked.', 'No further action is needed.');
  }

  record.status = 'REVOKED';
  record.revokedAt = new Date().toISOString();
  record.revokedByUserId = userId;
  record.revokedReason = reason;

  // Machines set up with this key stop being able to start new attempts. An
  // attempt already in progress is left alone: ending someone's examination
  // mid-question is an invigilator's decision, not a side effect of a revoke.
  for (const station of db.stations.values()) {
    if (station.activationKeyId === keyId) station.status = 'RETIRED';
  }

  return record;
}

/** Marks keys past their expiry, so the register reflects reality when read. */
export function expireStaleKeys(now = new Date()): number {
  const db = getDb();
  let expired = 0;
  for (const record of db.activationKeys.values()) {
    if (record.status === 'ISSUED' && new Date(record.expiresAt).getTime() <= now.getTime()) {
      record.status = 'EXPIRED';
      expired += 1;
    }
  }
  return expired;
}

export function listActivationKeys(filter: { examId?: string; centreId?: string } = {}): ActivationKeyRecord[] {
  expireStaleKeys();
  return [...getDb().activationKeys.values()]
    .filter((r) => (filter.examId ? r.examId === filter.examId : true))
    .filter((r) => (filter.centreId ? r.centreId === filter.centreId : true))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/* ------------------------------------------------------------------ */
/* Redeeming a key                                                     */
/* ------------------------------------------------------------------ */

export interface RedeemResult {
  station: StationRecord;
  payload: ActivationPayload;
  keyFingerprint: string;
}

/**
 * A machine stays set up for four hours by default.
 *
 * Long enough for a sitting and the setting-up before it, short enough that a
 * machine left switched on overnight is not still armed in the morning.
 */
const DEFAULT_STATION_HOURS = 4;

/**
 * How long this machine should stay set up.
 *
 * Four hours, or the examination window if that runs longer than four hours,
 * so a long paper is never cut short by the setup lapsing underneath it. Never
 * longer than the key itself is valid.
 */
export function stationLifetime(payload: ActivationPayload, now = new Date()): string {
  const fourHours = now.getTime() + DEFAULT_STATION_HOURS * 3_600_000;
  const windowCloses = new Date(payload.window.closesAt).getTime();
  const keyExpires = new Date(payload.expiresAt).getTime();

  const wanted = Number.isNaN(windowCloses) ? fourHours : Math.max(fourHours, windowCloses);
  return new Date(Math.min(wanted, keyExpires)).toISOString();
}

/**
 * Turns a pasted key into a station.
 *
 * Everything is checked here, on the server: that the key is genuine, that it
 * belongs to this board, that it has not expired or been revoked, and that it
 * has not already set up more machines than it is allowed to. A browser is
 * never trusted to decide any of that for itself.
 */
export function redeemActivationKey(
  keyText: string,
  context: { ipAddress: string; userAgent: string; traceId: string },
): RedeemResult {
  const db = getDb();
  const keyring = deploymentKeyring();

  // Throws InvalidKeyError, which the error handler turns into a 400 carrying
  // the remedy a moderator needs.
  const { payload, keyFingerprint } = openActivationKey(keyText, keyring);

  const problem = validateActivation(payload, { now: new Date(), deploymentId: keyring.deploymentId });
  if (problem) throw Errors.conflict(problem.message, problem.remedy);

  const record = db.activationKeys.get(payload.keyId);
  if (!record) {
    throw Errors.forbidden(
      'This key is not recognised by the examination board. It may have been reissued since it was sent.',
    );
  }
  if (record.status === 'REVOKED') {
    throw Errors.forbidden(
      `This key has been revoked and can no longer set up a machine. ${record.revokedReason ?? 'Contact the examination board for a replacement.'}`,
    );
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    record.status = 'EXPIRED';
    throw Errors.forbidden('This key has expired. Ask the examination board for a fresh key.');
  }
  if (record.activationCount >= record.maxStations) {
    throw Errors.forbidden(
      `This key has already set up ${record.activationCount} of a permitted ${record.maxStations} machines. Ask the examination board to raise the limit or issue another key.`,
    );
  }

  const sequence = record.activationCount + 1;
  const station: StationRecord = {
    id: randomUUID(),
    // Readable, so an invigilator can find the machine in the room.
    code: [payload.centre.code, payload.labels.room, String(sequence).padStart(2, '0')]
      .filter(Boolean)
      .join('-')
      .toUpperCase()
      .replace(/\s+/g, ''),
    activationKeyId: record.id,
    examId: payload.exam.id,
    centreId: payload.centre.id,
    centreCode: payload.centre.code,
    room: payload.labels.room,
    session: payload.labels.session,
    tags: payload.labels.tags,
    redeemedAt: new Date().toISOString(),
    expiresAt: stationLifetime(payload),
    lastSeenAt: new Date().toISOString(),
    ipAddress: context.ipAddress,
    userAgent: context.userAgent.slice(0, 200),
    status: 'ACTIVE',
    attemptCount: 0,
  };

  db.stations.set(station.id, station);

  record.activationCount = sequence;
  record.status = 'ACTIVATED';
  record.activatedAt = record.activatedAt ?? station.redeemedAt;
  record.activatedByStation = record.activatedByStation ?? station.code;

  recordAudit({
    actorId: station.id,
    actorName: station.code,
    actorRole: 'SYSTEM',
    action: 'STATION_REDEEMED',
    targetType: 'Station',
    targetId: station.id,
    targetLabel: `${record.examCode} at ${station.code}`,
    reason: `Machine set up for ${record.examName} at ${record.centreName} (${sequence} of ${record.maxStations} permitted).`,
    ipAddress: context.ipAddress,
    traceId: context.traceId,
  });

  return { station, payload, keyFingerprint };
}

/** Resolves a station and confirms it may still run its examination. */
export function requireActiveStation(stationId: string | undefined): StationRecord {
  if (!stationId) {
    throw Errors.forbidden('This machine has not been set up for an examination yet.');
  }
  const station = getDb().stations.get(stationId);
  if (!station) {
    throw Errors.forbidden(
      'This machine is no longer set up for an examination. Ask the invigilator to set it up again.',
    );
  }
  if (station.status !== 'ACTIVE') {
    throw Errors.forbidden(
      'The key this machine was set up with has been withdrawn. Ask the invigilator to set it up again.',
    );
  }
  if (new Date(station.expiresAt).getTime() <= Date.now()) {
    station.status = 'RETIRED';
    throw Errors.forbidden(
      'This machine has not been used for some time and its setup has lapsed. Ask the invigilator to set it up again.',
    );
  }

  station.lastSeenAt = new Date().toISOString();
  return station;
}

/** The record stamped onto an attempt, so a result knows where it came from. */
export function stationProvenance(station: StationRecord): AttemptProvenance {
  return {
    stationId: station.id,
    stationCode: station.code,
    activationKeyId: station.activationKeyId,
    centreId: station.centreId,
    centreCode: station.centreCode,
    room: station.room,
    session: station.session,
    tags: station.tags,
  };
}

/** Everything the key-issuing screen needs to offer sensible choices. */
export function issuableExams(): {
  exam: Exam;
  manifest: ExamManifest | null;
  centres: ExaminationCentre[];
  issuable: boolean;
  blockedReason: string | null;
}[] {
  const db = getDb();
  const centres = [...db.centres.values()];

  return [...db.exams.values()].map((exam) => {
    const manifest = exam.manifestId ? (db.manifests.get(exam.manifestId) ?? null) : null;
    const blockedReason = !manifest
      ? 'No paper has been assembled for this examination yet.'
      : manifest.publicationStatus !== 'PUBLISHED'
        ? 'The paper for this examination has not been published yet.'
        : null;

    return { exam, manifest, centres, issuable: blockedReason === null, blockedReason };
  });
}
