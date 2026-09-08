import { randomUUID } from 'node:crypto';
import {
  TRACKING_CHECK_CATALOGUE,
  worstSeverity,
  type Exam,
  type TrackingCheck,
  type TrackingCheckId,
  type TrackingFinding,
  type TrackingServiceStatus,
  type TrackingSeverity,
  type TrackingSnapshot,
  type TrackingSubject,
} from '@sep/shared';
import { getDb } from '../lib/store/db.js';
import { recordAudit, verifyAuditChain } from '../lib/audit.js';
import { verifyPaperIntegrity } from '../lib/crypto/paper.js';
import { keyProvider } from '../lib/crypto/keyProvider.js';
import { evaluateNetwork } from '../lib/network.js';
import { assignmentFor } from './deviceService.js';
import { database } from '../lib/store/adapters.js';

/**
 * Real-time examination tracking.
 *
 * A sweep runs on a timer for every examination in progress and answers one
 * question repeatedly: is anything about this examination not as it should be?
 *
 * This is deliberately separate from the invigilator dashboard. The dashboard
 * watches people. Tracking watches the *system* — paper integrity, device and
 * network conformance, seat assignments, save health, monitoring coverage,
 * audit integrity and capacity — and escalates to people.
 *
 * Two design rules:
 *   - A finding that persists across sweeps is real; one that appears once may
 *     be a blip. `occurrences` makes that distinction visible rather than
 *     flooding staff with transient noise.
 *   - Tracking never changes an examination. It observes and raises. Every
 *     consequential action stays with a person.
 */

const SWEEP_INTERVAL_SECONDS = 20;

const status: TrackingServiceStatus = {
  running: false,
  intervalSeconds: SWEEP_INTERVAL_SECONDS,
  examsTracked: 0,
  lastSweepAt: null,
  lastSweepDurationMs: null,
  sweepsCompleted: 0,
  findingsRaised: 0,
  lastError: null,
};

let timer: NodeJS.Timeout | null = null;

export function trackingStatus(): TrackingServiceStatus {
  return { ...status };
}

export function startTracking(): void {
  if (timer) return;
  status.running = true;
  timer = setInterval(() => {
    void sweepAll();
  }, SWEEP_INTERVAL_SECONDS * 1000);
  timer.unref?.();
  void sweepAll();
}

export function stopTracking(): void {
  if (timer) clearInterval(timer);
  timer = null;
  status.running = false;
}

/** Examinations worth tracking: running now, or published and starting soon. */
function trackedExams(): Exam[] {
  const db = getDb();
  const soon = Date.now() + 60 * 60_000;
  return [...db.exams.values()].filter(
    (exam) =>
      exam.status === 'IN_PROGRESS' ||
      (exam.status === 'PUBLISHED' && new Date(exam.startsAt).getTime() <= soon),
  );
}

export async function sweepAll(): Promise<TrackingSnapshot[]> {
  const started = Date.now();
  const snapshots: TrackingSnapshot[] = [];
  try {
    for (const exam of trackedExams()) {
      snapshots.push(await sweepExam(exam));
    }
    status.examsTracked = snapshots.length;
    status.lastError = null;
  } catch (error) {
    // A failure in the watcher must never be silent — that would be the worst
    // possible failure mode for a service whose job is noticing problems.
    status.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    status.lastSweepAt = new Date().toISOString();
    status.lastSweepDurationMs = Date.now() - started;
    status.sweepsCompleted += 1;
  }
  return snapshots;
}

export async function sweepExam(exam: Exam): Promise<TrackingSnapshot> {
  const db = getDb();
  const checks: TrackingCheck[] = [];

  checks.push(await checkPaperIntegrity(exam));
  checks.push(await checkManifestSignature(exam));
  checks.push(checkDeviceConformance(exam));
  checks.push(checkNetworkConformance(exam));
  checks.push(checkDeviceAssignment(exam));
  checks.push(checkAnswerSaveHealth(exam));
  checks.push(checkSessionAnomalies(exam));
  checks.push(checkMonitoringCoverage(exam));
  checks.push(checkClockConsistency(exam));
  checks.push(checkAuditChain(exam));
  checks.push(checkDeliveryProgress(exam));
  checks.push(checkCapacity(exam));

  const previous = db.trackingSnapshots.get(exam.id);
  const registrations = [...db.registrations.values()].filter((r) => r.examId === exam.id);
  const attempts = [...db.attempts.values()].filter((a) => a.examId === exam.id);
  const byStatus = (s: string) => attempts.filter((a) => a.status === s).length;
  const minuteAgo = Date.now() - 60_000;

  const snapshot: TrackingSnapshot = {
    examId: exam.id,
    examCode: exam.code,
    examName: exam.name,
    generatedAt: new Date().toISOString(),
    overall: worstSeverity(checks.map((c) => c.severity)),
    sequence: (previous?.sequence ?? 0) + 1,
    checks,
    delivery: {
      registered: registrations.length,
      notStarted: registrations.length - attempts.length,
      active: byStatus('ACTIVE'),
      restricted: byStatus('RESTRICTED'),
      awaitingReview: byStatus('AWAITING_REVERIFICATION'),
      disconnected: byStatus('DISCONNECTED'),
      submitted: byStatus('SUBMITTED'),
      answersSavedLastMinute: db.answerEvents.filter(
        (e) => e.outcome === 'COMMITTED' && new Date(e.committedAt).getTime() > minuteAgo,
      ).length,
      averageAnswered:
        attempts.length === 0
          ? 0
          : Math.round(attempts.reduce((sum, a) => sum + a.answeredCount, 0) / attempts.length),
      completionPercent:
        registrations.length === 0 ? 0 : Math.round((byStatus('SUBMITTED') / registrations.length) * 100),
    },
    openFindings: [],
  };

  reconcileFindings(exam, checks);
  snapshot.openFindings = [...db.trackingFindings.values()]
    .filter((f) => f.examId === exam.id && f.resolvedAt === null)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  db.trackingSnapshots.set(exam.id, snapshot);
  return snapshot;
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Turns check results into durable findings.
 *
 * A finding seen again keeps its identity and increments `occurrences`, so
 * "this has failed for eleven consecutive sweeps" is visible. A check that
 * recovers resolves its finding rather than leaving it to rot.
 */
function reconcileFindings(exam: Exam, checks: TrackingCheck[]): void {
  const db = getDb();
  const now = new Date().toISOString();

  for (const check of checks) {
    const key = `${exam.id}:${check.id}`;
    const existing = [...db.trackingFindings.values()].find(
      (f) => f.examId === exam.id && f.checkId === check.id && f.resolvedAt === null,
    );

    if (check.severity === 'OK' || check.severity === 'INFO') {
      if (existing) {
        existing.resolvedAt = now;
        existing.lastSeenAt = now;
      }
      continue;
    }

    if (existing) {
      existing.lastSeenAt = now;
      existing.occurrences += 1;
      existing.severity = check.severity;
      existing.detail = check.summary;
      existing.subjects = check.affected;
      continue;
    }

    const audit = recordAudit({
      actorId: 'system',
      actorName: 'Examination tracking service',
      actorRole: 'SYSTEM',
      action: 'INTEGRITY_CHECK',
      targetType: 'Exam',
      targetId: exam.id,
      targetLabel: `${exam.code} — ${check.label}`,
      result: check.severity === 'CRITICAL' ? 'BLOCKED' : 'FAILURE',
      reason: `${check.summary} ${check.action ?? ''}`.trim(),
      ipAddress: 'internal',
    });

    const finding: TrackingFinding = {
      id: randomUUID(),
      examId: exam.id,
      checkId: check.id,
      severity: check.severity,
      title: check.label,
      detail: check.summary,
      action: check.action ?? TRACKING_CHECK_CATALOGUE[check.id].action,
      subjects: check.affected,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrences: 1,
      acknowledgedByUserId: null,
      acknowledgedAt: null,
      acknowledgementReason: null,
      resolvedAt: null,
      auditEventId: audit.id,
    };
    db.trackingFindings.set(finding.id, finding);
    status.findingsRaised += 1;
    void key;
  }
}

/* ------------------------------------------------------------------ */
/* Individual checks                                                   */
/* ------------------------------------------------------------------ */

function base(id: TrackingCheckId, startedAt: number) {
  const entry = TRACKING_CHECK_CATALOGUE[id];
  return {
    id,
    label: entry.label,
    explanation: entry.explanation,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  };
}

async function checkPaperIntegrity(exam: Exam): Promise<TrackingCheck> {
  const started = Date.now();
  const db = getDb();
  const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;

  if (!manifest) {
    return {
      ...base('PAPER_INTEGRITY', started),
      severity: exam.status === 'IN_PROGRESS' ? 'CRITICAL' : 'INFO',
      summary:
        exam.status === 'IN_PROGRESS'
          ? 'This examination is running but has no assembled question paper.'
          : 'No question paper has been assembled yet.',
      metrics: [],
      affected: [],
      action: exam.status === 'IN_PROGRESS' ? 'Escalate immediately to the examination controller.' : null,
    };
  }

  const report = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
  const affected: TrackingSubject[] = report.failedEntries.map((entry) => ({
    kind: 'QUESTION',
    id: entry.questionId,
    label: `Question ${entry.sequence}`,
    detail: entry.reason,
  }));

  return {
    ...base('PAPER_INTEGRITY', started),
    severity: report.ok ? 'OK' : 'CRITICAL',
    summary: report.summary,
    metrics: [
      { label: 'Questions verified', value: `${report.verifiedQuestionCount} / ${manifest.entries.length}` },
      { label: 'Publication status', value: manifest.publicationStatus },
    ],
    affected,
    action: report.ok ? null : TRACKING_CHECK_CATALOGUE.PAPER_INTEGRITY.action,
  };
}

async function checkManifestSignature(exam: Exam): Promise<TrackingCheck> {
  const started = Date.now();
  const db = getDb();
  const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;

  if (!manifest) {
    return {
      ...base('MANIFEST_SIGNATURE', started),
      severity: 'INFO',
      summary: 'No paper has been signed yet.',
      metrics: [],
      affected: [],
      action: null,
    };
  }

  const valid = await keyProvider().verify(Buffer.from(manifest.manifestHash, 'utf8'), manifest.signature);
  return {
    ...base('MANIFEST_SIGNATURE', started),
    severity: valid ? 'OK' : 'CRITICAL',
    summary: valid
      ? `The ${manifest.signatureAlgorithm} signature over the paper manifest is valid.`
      : 'The signature over the paper manifest could not be verified.',
    metrics: [
      { label: 'Algorithm', value: manifest.signatureAlgorithm },
      { label: 'Signing key', value: manifest.signingKeyReference },
    ],
    affected: valid ? [] : [{ kind: 'EXAM', id: exam.id, label: exam.code, detail: 'Manifest signature invalid.' }],
    action: valid ? null : TRACKING_CHECK_CATALOGUE.MANIFEST_SIGNATURE.action,
  };
}

function checkDeviceConformance(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const live = [...db.attempts.values()].filter(
    (a) => a.examId === exam.id && ['ACTIVE', 'RESTRICTED', 'VERIFYING', 'AWAITING_REVERIFICATION'].includes(a.status),
  );

  const affected: TrackingSubject[] = [];
  const minimumPolicy = exam.securityPolicy.network.minimumDevicePolicyVersion;

  for (const attempt of live) {
    const device = db.devices.get(attempt.deviceId);
    const candidate = db.candidates.get(attempt.candidateId);
    const label = device?.deviceCode ?? attempt.deviceId;

    if (!device) {
      affected.push({ kind: 'DEVICE', id: attempt.deviceId, label, detail: 'Workstation is not in the device register.' });
      continue;
    }
    if (device.status !== 'APPROVED') {
      affected.push({ kind: 'DEVICE', id: device.id, label, detail: `Workstation status is ${device.status}.` });
      continue;
    }
    if (device.certificate.status === 'REVOKED' || device.certificate.status === 'EXPIRED') {
      affected.push({
        kind: 'DEVICE',
        id: device.id,
        label,
        detail: `Device certificate is ${device.certificate.status.toLowerCase()}.`,
      });
      continue;
    }
    if (exam.securityPolicy.network.deviceCertificateRequired && device.kioskPolicyVersion < minimumPolicy) {
      affected.push({
        kind: 'DEVICE',
        id: device.id,
        label,
        detail: `Kiosk policy ${device.kioskPolicyVersion} is below the required ${minimumPolicy}${candidate ? ` (${candidate.applicationId})` : ''}.`,
      });
    }
  }

  return {
    ...base('DEVICE_CONFORMANCE', started),
    severity: affected.length === 0 ? 'OK' : affected.length > 3 ? 'CRITICAL' : 'WARNING',
    summary:
      affected.length === 0
        ? `All ${live.length} live sessions are on conforming workstations.`
        : `${affected.length} live session(s) are on a workstation that no longer meets policy.`,
    metrics: [
      { label: 'Live sessions', value: live.length },
      { label: 'Minimum kiosk policy', value: minimumPolicy },
    ],
    affected,
    action: affected.length === 0 ? null : TRACKING_CHECK_CATALOGUE.DEVICE_CONFORMANCE.action,
  };
}

function checkNetworkConformance(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const enforce = exam.securityPolicy.verification.requireAssignedNetwork;

  if (!enforce) {
    return {
      ...base('NETWORK_CONFORMANCE', started),
      severity: 'INFO',
      summary: 'Network allowlisting is not enabled for this examination.',
      metrics: [],
      affected: [],
      action: null,
    };
  }

  const live = [...db.attempts.values()].filter((a) => a.examId === exam.id && a.status !== 'SUBMITTED');
  const affected: TrackingSubject[] = [];

  for (const attempt of live) {
    const device = db.devices.get(attempt.deviceId);
    if (!device) continue;
    const decision = evaluateNetwork(
      device.ipAddress,
      [exam.securityPolicy.network.primaryCidr, exam.securityPolicy.network.backupCidr],
      true,
    );
    if (!decision.allowed) {
      const candidate = db.candidates.get(attempt.candidateId);
      affected.push({
        kind: 'ATTEMPT',
        id: attempt.id,
        label: candidate?.applicationId ?? attempt.id,
        detail: decision.reason,
      });
    }
  }

  return {
    ...base('NETWORK_CONFORMANCE', started),
    severity: affected.length === 0 ? 'OK' : 'CRITICAL',
    summary:
      affected.length === 0
        ? `All live sessions are connecting from approved ranges.`
        : `${affected.length} session(s) are connecting from outside the approved ranges.`,
    metrics: [
      { label: 'Primary range', value: exam.securityPolicy.network.primaryCidr },
      { label: 'Backup range', value: exam.securityPolicy.network.backupCidr ?? 'none' },
    ],
    affected,
    action: affected.length === 0 ? null : TRACKING_CHECK_CATALOGUE.NETWORK_CONFORMANCE.action,
  };
}

function checkDeviceAssignment(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const enforce = exam.securityPolicy.verification.requireAssignedDevice;

  if (!enforce) {
    return {
      ...base('DEVICE_ASSIGNMENT', started),
      severity: 'INFO',
      summary: 'Candidates are not bound to a specific workstation for this examination.',
      metrics: [],
      affected: [],
      action: null,
    };
  }

  const live = [...db.attempts.values()].filter((a) => a.examId === exam.id && a.status !== 'SUBMITTED');
  const affected: TrackingSubject[] = [];

  for (const attempt of live) {
    const assignment = assignmentFor(exam.id, attempt.candidateId);
    if (!assignment || assignment.allowAnyApprovedDevice || !assignment.deviceId) continue;
    if (assignment.deviceId !== attempt.deviceId) {
      const candidate = db.candidates.get(attempt.candidateId);
      affected.push({
        kind: 'CANDIDATE',
        id: attempt.candidateId,
        label: candidate?.applicationId ?? attempt.candidateId,
        detail: `Assigned ${assignment.deviceCode ?? 'a workstation'} but working on ${db.devices.get(attempt.deviceId)?.deviceCode ?? 'an unknown machine'}.`,
      });
    }
  }

  const assigned = [...db.deviceAssignments.values()].filter((a) => a.examId === exam.id && a.releasedAt === null);

  return {
    ...base('DEVICE_ASSIGNMENT', started),
    severity: affected.length === 0 ? 'OK' : 'WARNING',
    summary:
      affected.length === 0
        ? 'Every live candidate is at their assigned workstation.'
        : `${affected.length} candidate(s) are not at the workstation assigned to them.`,
    metrics: [
      { label: 'Seat assignments', value: assigned.length },
      { label: 'Live sessions', value: live.length },
    ],
    affected,
    action: affected.length === 0 ? null : TRACKING_CHECK_CATALOGUE.DEVICE_ASSIGNMENT.action,
  };
}

function checkAnswerSaveHealth(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const active = [...db.attempts.values()].filter((a) => a.examId === exam.id && a.status === 'ACTIVE');
  const stale = Date.now() - 5 * 60_000;

  const affected: TrackingSubject[] = active
    .filter((a) => a.startedAt && new Date(a.startedAt).getTime() < stale)
    .filter((a) => !a.lastAnswerSavedAt || new Date(a.lastAnswerSavedAt).getTime() < stale)
    .map((a) => {
      const candidate = db.candidates.get(a.candidateId);
      return {
        kind: 'ATTEMPT' as const,
        id: a.id,
        label: candidate?.applicationId ?? a.id,
        detail: a.lastAnswerSavedAt
          ? `No answer has reached the server since ${new Date(a.lastAnswerSavedAt).toLocaleTimeString()}.`
          : 'No answer has reached the server at all.',
      };
    });

  const recentConflicts = db.answerEvents.filter(
    (e) => e.outcome === 'CONFLICT' && new Date(e.receivedAt).getTime() > Date.now() - 5 * 60_000,
  ).length;

  const severity: TrackingSeverity =
    affected.length > Math.max(5, active.length * 0.1) || recentConflicts > 20
      ? 'CRITICAL'
      : affected.length > 0 || recentConflicts > 5
        ? 'WARNING'
        : 'OK';

  return {
    ...base('ANSWER_SAVE_HEALTH', started),
    severity,
    summary:
      severity === 'OK'
        ? 'Answers are reaching the server normally across all active sessions.'
        : `${affected.length} active session(s) have not saved an answer in five minutes; ${recentConflicts} write conflict(s) in the same period.`,
    metrics: [
      { label: 'Active sessions', value: active.length },
      { label: 'Quiet sessions', value: affected.length },
      { label: 'Conflicts (5 min)', value: recentConflicts },
    ],
    affected: affected.slice(0, 25),
    action: severity === 'OK' ? null : TRACKING_CHECK_CATALOGUE.ANSWER_SAVE_HEALTH.action,
  };
}

function checkSessionAnomalies(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const attempts = [...db.attempts.values()].filter((a) => a.examId === exam.id);
  const affected: TrackingSubject[] = [];

  // More than one live attempt for the same candidate should be impossible.
  const byCandidate = new Map<string, number>();
  attempts
    .filter((a) => a.status !== 'SUBMITTED' && a.status !== 'TERMINATED')
    .forEach((a) => byCandidate.set(a.candidateId, (byCandidate.get(a.candidateId) ?? 0) + 1));

  for (const [candidateId, count] of byCandidate) {
    if (count > 1) {
      const candidate = db.candidates.get(candidateId);
      affected.push({
        kind: 'CANDIDATE',
        id: candidateId,
        label: candidate?.applicationId ?? candidateId,
        detail: `${count} live attempts exist for this candidate. Only one is ever permitted.`,
      });
    }
  }

  // Attempts past their deadline that were never submitted.
  const now = Date.now();
  attempts
    .filter((a) => a.status === 'ACTIVE' && a.expiresAt && new Date(a.expiresAt).getTime() < now - 60_000)
    .forEach((a) => {
      const candidate = db.candidates.get(a.candidateId);
      affected.push({
        kind: 'ATTEMPT',
        id: a.id,
        label: candidate?.applicationId ?? a.id,
        detail: 'The attempt is past its deadline but is still marked active.',
      });
    });

  return {
    ...base('SESSION_ANOMALY', started),
    severity: affected.length === 0 ? 'OK' : 'CRITICAL',
    summary:
      affected.length === 0
        ? 'No impossible or stalled session states were found.'
        : `${affected.length} session anomal${affected.length === 1 ? 'y' : 'ies'} found.`,
    metrics: [{ label: 'Attempts examined', value: attempts.length }],
    affected: affected.slice(0, 25),
    action: affected.length === 0 ? null : TRACKING_CHECK_CATALOGUE.SESSION_ANOMALY.action,
  };
}

function checkMonitoringCoverage(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();

  if (!exam.securityPolicy.monitoring.cameraMonitoringEnabled) {
    return {
      ...base('MONITORING_COVERAGE', started),
      severity: 'INFO',
      summary: 'Camera monitoring is not enabled for this examination.',
      metrics: [],
      affected: [],
      action: null,
    };
  }

  const interval = exam.securityPolicy.monitoring.snapshotIntervalSeconds;
  // Allow three missed cycles before treating silence as a signal.
  const overdue = Date.now() - interval * 3 * 1000;
  const active = [...db.attempts.values()].filter(
    (a) => a.examId === exam.id && a.status === 'ACTIVE' && a.startedAt && new Date(a.startedAt).getTime() < overdue,
  );

  const affected: TrackingSubject[] = active
    .filter((attempt) => {
      const last = db.proctoringEvents.filter((e) => e.attemptId === attempt.id).slice(-1)[0];
      return !last || new Date(last.receivedAt).getTime() < overdue;
    })
    .map((attempt) => {
      const candidate = db.candidates.get(attempt.candidateId);
      return {
        kind: 'ATTEMPT' as const,
        id: attempt.id,
        label: candidate?.applicationId ?? attempt.id,
        detail: 'No presence check has arrived for three consecutive intervals.',
      };
    });

  return {
    ...base('MONITORING_COVERAGE', started),
    severity: affected.length === 0 ? 'OK' : affected.length > 10 ? 'CRITICAL' : 'WARNING',
    summary:
      affected.length === 0
        ? `Presence checks are arriving for all ${active.length} monitored session(s).`
        : `${affected.length} monitored session(s) have gone silent. A silent camera is as significant as a failed check.`,
    metrics: [
      { label: 'Interval', value: `${interval}s` },
      { label: 'Monitored sessions', value: active.length },
      { label: 'Events total', value: db.proctoringEvents.filter((e) => e.examId === exam.id).length },
    ],
    affected: affected.slice(0, 25),
    action: affected.length === 0 ? null : TRACKING_CHECK_CATALOGUE.MONITORING_COVERAGE.action,
  };
}

function checkClockConsistency(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const now = Date.now();

  // Captures timestamped noticeably ahead of or behind the server clock.
  const recent = db.proctoringEvents.filter(
    (e) => e.examId === exam.id && new Date(e.receivedAt).getTime() > now - 10 * 60_000,
  );
  const drifting = recent.filter((e) => Math.abs(new Date(e.capturedAt).getTime() - new Date(e.receivedAt).getTime()) > 120_000);

  const affected: TrackingSubject[] = [...new Set(drifting.map((e) => e.attemptId))].slice(0, 25).map((attemptId) => {
    const attempt = db.attempts.get(attemptId);
    const candidate = attempt ? db.candidates.get(attempt.candidateId) : undefined;
    return {
      kind: 'ATTEMPT' as const,
      id: attemptId,
      label: candidate?.applicationId ?? attemptId,
      detail: 'The workstation clock differs from the server clock by more than two minutes.',
    };
  });

  return {
    ...base('CLOCK_CONSISTENCY', started),
    severity: affected.length === 0 ? 'OK' : 'INFO',
    summary:
      affected.length === 0
        ? 'Workstation clocks agree with the server.'
        : `${affected.length} workstation clock(s) differ from the server. Remaining time is taken from the server, so no candidate is disadvantaged.`,
    metrics: [{ label: 'Captures examined', value: recent.length }],
    affected,
    action: affected.length === 0 ? null : TRACKING_CHECK_CATALOGUE.CLOCK_CONSISTENCY.action,
  };
}

function checkAuditChain(exam: Exam): TrackingCheck {
  const started = Date.now();
  const chain = verifyAuditChain();
  return {
    ...base('AUDIT_CHAIN', started),
    severity: chain.intact ? 'OK' : 'CRITICAL',
    summary: chain.message,
    metrics: [
      { label: 'Events verified', value: chain.checkedEvents },
      { label: 'First broken entry', value: chain.brokenAtSequence ?? '—' },
    ],
    affected: chain.intact
      ? []
      : [{ kind: 'EXAM', id: exam.id, label: exam.code, detail: chain.message }],
    action: chain.intact ? null : TRACKING_CHECK_CATALOGUE.AUDIT_CHAIN.action,
  };
}

function checkDeliveryProgress(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const attempts = [...db.attempts.values()].filter((a) => a.examId === exam.id);
  const active = attempts.filter((a) => a.status === 'ACTIVE');
  const total = exam.blueprint.totalQuestions || 1;

  const elapsedMinutes = Math.max(0, (Date.now() - new Date(exam.startsAt).getTime()) / 60_000);
  const elapsedFraction = Math.min(1, elapsedMinutes / exam.durationMinutes);
  const expected = Math.round(elapsedFraction * total);
  const actual = active.length === 0 ? 0 : active.reduce((sum, a) => sum + a.answeredCount, 0) / active.length;

  // Only meaningful once the examination is properly under way.
  const meaningful = elapsedFraction > 0.15 && active.length > 0;
  const behind = meaningful && actual < expected * 0.5;

  return {
    ...base('DELIVERY_PROGRESS', started),
    severity: behind ? 'WARNING' : 'OK',
    summary: !meaningful
      ? 'Too early in the examination to judge progress.'
      : behind
        ? `Candidates average ${actual.toFixed(1)} answers against an expected ${expected} at this point. Check for a centre-wide interruption.`
        : `Candidates average ${actual.toFixed(1)} answers, in line with the ${Math.round(elapsedFraction * 100)}% of time elapsed.`,
    metrics: [
      { label: 'Time elapsed', value: `${Math.round(elapsedFraction * 100)}%` },
      { label: 'Average answered', value: actual.toFixed(1) },
      { label: 'Expected by now', value: expected },
      { label: 'Submitted', value: attempts.filter((a) => a.status === 'SUBMITTED').length },
    ],
    affected: [],
    action: behind ? TRACKING_CHECK_CATALOGUE.DELIVERY_PROGRESS.action : null,
  };
}

function checkCapacity(exam: Exam): TrackingCheck {
  const started = Date.now();
  const db = getDb();
  const sorted = [...db.metrics.responseTimes].sort((a, b) => a - b);
  const p95 = sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0) : 0;
  const latency = database.latencyMs();
  const live = [...db.attempts.values()].filter((a) => a.examId === exam.id && a.status === 'ACTIVE').length;

  const severity: TrackingSeverity =
    p95 > 800 || latency > 500 ? 'CRITICAL' : p95 > 350 || latency > 200 || db.degradation.degraded ? 'WARNING' : 'OK';

  return {
    ...base('CAPACITY', started),
    severity,
    summary:
      severity === 'OK'
        ? `Service is comfortable at ${live} live sessions.`
        : `Service is under strain: p95 ${p95} ms, database ${latency} ms, ${live} live sessions.`,
    metrics: [
      { label: 'p95 response', value: `${p95} ms` },
      { label: 'Database latency', value: `${latency} ms` },
      { label: 'Live sessions', value: live },
      { label: 'Degraded', value: db.degradation.degraded ? 'yes' : 'no' },
    ],
    affected: [],
    action: severity === 'OK' ? null : TRACKING_CHECK_CATALOGUE.CAPACITY.action,
  };
}

/* ------------------------------------------------------------------ */

export function acknowledgeFinding(input: {
  findingId: string;
  userId: string;
  userName: string;
  role: string;
  reason: string;
  ipAddress: string;
  traceId: string;
}): TrackingFinding | null {
  const db = getDb();
  const finding = db.trackingFindings.get(input.findingId);
  if (!finding) return null;

  finding.acknowledgedByUserId = input.userId;
  finding.acknowledgedAt = new Date().toISOString();
  finding.acknowledgementReason = input.reason;

  recordAudit({
    actorId: input.userId,
    actorName: input.userName,
    actorRole: input.role as never,
    action: 'ADMIN_OVERRIDE',
    targetType: 'TrackingFinding',
    targetId: finding.id,
    targetLabel: finding.title,
    reason: `Tracking finding acknowledged: ${input.reason}`,
    ipAddress: input.ipAddress,
    traceId: input.traceId,
  });

  return finding;
}
