import { randomUUID } from 'node:crypto';
import type { SecuritySimulationResult, SystemHealth } from '@sep/shared';
import { getDb } from '../lib/store/db.js';
import { cache, database, objectStore } from '../lib/store/adapters.js';
import { keyProvider } from '../lib/crypto/keyProvider.js';
import { recordAudit } from '../lib/audit.js';
import { verifyPaperIntegrity } from '../lib/crypto/paper.js';

/**
 * Operations telemetry and the incident simulator.
 *
 * The simulator never executes an attack. It creates synthetic monitoring
 * events so a stakeholder can see how detection, control activation, user
 * impact and recovery are presented.
 */

export function systemHealth(): SystemHealth {
  const db = getDb();
  const sorted = [...db.metrics.responseTimes].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0 : 42;

  const activeSessions = [...db.attempts.values()].filter(
    (a) => a.status === 'ACTIVE' || a.status === 'RESTRICTED' || a.status === 'VERIFYING',
  ).length;

  const dbLatency = database.latencyMs();
  const cacheUp = cache.isAvailable();
  const queued = objectStore.queuedCount();

  return {
    generatedAt: new Date().toISOString(),
    api: {
      status: db.degradation.degraded ? 'WARNING' : 'OK',
      uptimeSeconds: Math.floor((Date.now() - db.metrics.startedAt) / 1000),
      version: '0.1.0-poc',
    },
    database: {
      status: dbLatency > 400 ? 'WARNING' : 'OK',
      label: database.label,
      latencyMs: dbLatency,
    },
    redis: {
      status: cacheUp ? 'OK' : 'FAIL',
      label: cache.label,
      latencyMs: cacheUp ? 1 : 0,
    },
    evidenceStorage: {
      status: queued > 0 ? 'WARNING' : 'OK',
      label: objectStore.label,
      queuedObjects: queued,
    },
    keyService: {
      status: 'OK',
      label: keyProvider().describe().displayName,
      simulated: true,
    },
    activeSessions,
    requestsPerMinute: db.counters.requestsThisMinute,
    answerWritesPerMinute: db.counters.answerWritesThisMinute,
    p95ResponseTimeMs: Math.round(p95 ?? 42),
    wafBlockedRequests: db.counters.wafBlocked,
    rateLimitedRequests: db.counters.rateLimited,
    failedLogins: db.counters.failedLogins,
    revokedDevices: [...db.devices.values()].filter((d) => d.status === 'REVOKED').length,
    unusualCryptoOperations: db.simulations.filter((s) => s.scenario === 'MODIFIED_QUESTION_ENVELOPE').length,
    series: db.metrics.series.slice(-30),
    degraded: db.degradation.degraded,
    degradedReason: db.degradation.reason,
  };
}

/** Rolls the per-minute counters and appends a point to the trend series. */
export function rollMetrics(): void {
  const db = getDb();
  db.metrics.series.push({
    at: new Date().toISOString(),
    requestsPerMinute: db.counters.requestsThisMinute,
    answerWrites: db.counters.answerWritesThisMinute,
    p95: systemHealthP95(),
  });
  if (db.metrics.series.length > 60) db.metrics.series.shift();
  db.counters.requestsThisMinute = 0;
  db.counters.answerWritesThisMinute = 0;
  db.metrics.responseTimes = [];
}

function systemHealthP95(): number {
  const db = getDb();
  const sorted = [...db.metrics.responseTimes].sort((a, b) => a - b);
  if (!sorted.length) return 40 + Math.round(Math.random() * 15);
  return Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] ?? 0);
}

/** Pre-populates the trend chart so the operations view is never empty. */
export function primeMetricsSeries(): void {
  const db = getDb();
  if (db.metrics.series.length > 0) return;
  const base = Date.now() - 30 * 60_000;
  for (let i = 0; i < 30; i += 1) {
    db.metrics.series.push({
      at: new Date(base + i * 60_000).toISOString(),
      requestsPerMinute: 1100 + Math.round(Math.sin(i / 3) * 180 + Math.random() * 90),
      answerWrites: 380 + Math.round(Math.cos(i / 4) * 70 + Math.random() * 40),
      p95: 38 + Math.round(Math.abs(Math.sin(i / 5)) * 22 + Math.random() * 8),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Incident simulator                                                  */
/* ------------------------------------------------------------------ */

export type ScenarioId =
  | 'LOGIN_BURST'
  | 'DDOS_TRAFFIC'
  | 'SQL_INJECTION_ATTEMPT'
  | 'INVALID_EXAM_TOKEN'
  | 'MODIFIED_QUESTION_ENVELOPE'
  | 'REPLAYED_ANSWER_REQUEST'
  | 'REVOKED_DEVICE'
  | 'DATABASE_SLOWDOWN'
  | 'REDIS_UNAVAILABLE'
  | 'INSTANCE_FAILURE';

interface ScenarioDefinition {
  title: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  detection: string;
  controlActivated: string;
  userImpact: string;
  recoveryStatus: string;
  apply: () => void | Promise<void>;
}

export async function runSimulation(
  scenario: ScenarioId,
  actor: { id: string; name: string; role: 'SUPER_ADMIN' | 'SECURITY_ADMIN' | 'EXAM_ADMIN' },
  meta: { ipAddress: string; traceId: string; examId?: string },
): Promise<SecuritySimulationResult> {
  const db = getDb();
  const definitions: Record<ScenarioId, ScenarioDefinition> = {
    LOGIN_BURST: {
      title: 'Credential-stuffing burst against the candidate sign-in endpoint',
      severity: 'WARNING',
      detection: '412 failed sign-ins from 6 addresses in 40 seconds, all targeting valid application IDs.',
      controlActivated:
        'Per-address rate limiting engaged and the targeted accounts were placed under a temporary lockout.',
      userImpact: 'No genuine candidate session was interrupted. Affected accounts show a lockout notice with a wait time.',
      recoveryStatus: 'Rate limit released automatically after the burst subsided. Lockouts expire on their own timer.',
      apply: () => {
        db.counters.failedLogins += 412;
        db.counters.rateLimited += 380;
      },
    },
    DDOS_TRAFFIC: {
      title: 'Volumetric traffic flood aimed at the examination endpoint',
      severity: 'CRITICAL',
      detection: 'Inbound request rate rose from 1,200/min to 48,000/min with no matching session growth.',
      controlActivated:
        'Upstream DDoS protection absorbed the flood and the edge began challenge-based filtering. SIMULATED — no managed DDoS service is attached to this POC.',
      userImpact: 'Candidate sessions continued. Median response time rose by 40 ms for roughly 90 seconds.',
      recoveryStatus: 'Traffic normalised. No attempt was terminated and no answer was lost.',
      apply: () => {
        db.counters.wafBlocked += 46800;
        db.metrics.series.push({
          at: new Date().toISOString(),
          requestsPerMinute: 48000,
          answerWrites: 402,
          p95: 96,
        });
      },
    },
    SQL_INJECTION_ATTEMPT: {
      title: 'SQL injection attempted through a candidate search parameter',
      severity: 'WARNING',
      detection: 'Request containing a UNION SELECT payload was rejected by schema validation before reaching the data layer.',
      controlActivated:
        'Strict request validation rejected the input, and all database access uses parameterised queries, so the payload was never interpreted as SQL.',
      userImpact: 'None. The caller received a validation error.',
      recoveryStatus: 'No action required. The source address was added to the watch list.',
      apply: () => {
        db.counters.wafBlocked += 1;
      },
    },
    INVALID_EXAM_TOKEN: {
      title: 'Attempt to activate an examination with a forged session token',
      severity: 'WARNING',
      detection: 'A session cookie failed signature verification during attempt activation.',
      controlActivated: 'The request was rejected before any paper metadata was read. Nothing was decrypted.',
      userImpact: 'None. The workstation was returned to the sign-in screen.',
      recoveryStatus: 'Closed. The workstation identifier was recorded for the centre operator.',
      apply: () => {
        db.counters.wafBlocked += 1;
      },
    },
    MODIFIED_QUESTION_ENVELOPE: {
      title: 'Stored question modified after approval',
      severity: 'CRITICAL',
      detection:
        'The pre-release integrity check found a question whose fingerprint no longer matches the value recorded when the paper was approved.',
      controlActivated:
        'Paper release was blocked. No candidate received the affected paper, and the manifest was marked as failing verification.',
      userImpact: 'Affected examinations cannot start until the paper is re-approved by authorised reviewers.',
      recoveryStatus: 'Awaiting review by the examination controller and the security administrator.',
      apply: async () => {
        const examId = meta.examId ?? [...db.exams.values()].find((e) => e.manifestId)?.id;
        const exam = examId ? db.exams.get(examId) : undefined;
        const manifest = exam?.manifestId ? db.manifests.get(exam.manifestId) : undefined;
        if (!manifest) return;
        // Tamper with a stored question so the hash comparison genuinely fails.
        const target = manifest.entries[0];
        const version = target ? db.questionVersions.get(target.questionVersionId) : undefined;
        if (version) {
          version.stem = `${version.stem} [modified after approval — demonstration only]`;
        }
        const report = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
        manifest.integrityStatus = report.ok ? 'VERIFIED' : 'FAILED';
        manifest.integrityCheckedAt = report.checkedAt;
        manifest.verifiedQuestionCount = report.verifiedQuestionCount;
        manifest.publicationStatus = report.ok ? manifest.publicationStatus : 'BLOCKED';
        manifest.tamperSimulated = true;
      },
    },
    REPLAYED_ANSWER_REQUEST: {
      title: 'Answer save replayed with the same idempotency key',
      severity: 'INFO',
      detection: 'A duplicate idempotency key arrived 400 ms after the original save.',
      controlActivated: 'The idempotency ledger recognised the key and returned the original result without a second write.',
      userImpact: 'None. The candidate saw one saved answer, not two.',
      recoveryStatus: 'Closed. The duplicate was recorded as an answer event with outcome DUPLICATE_IGNORED.',
      apply: () => {
        const attempt = [...db.attempts.values()].find((a) => a.status === 'ACTIVE');
        if (!attempt) return;
        db.answerEvents.push({
          id: randomUUID(),
          attemptId: attempt.id,
          assignmentQuestionId: 'simulated',
          version: 1,
          selectedOptionIds: [],
          idempotencyKey: `simulated-${randomUUID()}`,
          receivedAt: new Date().toISOString(),
          committedAt: new Date().toISOString(),
          outcome: 'DUPLICATE_IGNORED',
        });
      },
    },
    REVOKED_DEVICE: {
      title: 'Revoked workstation attempted to start an examination',
      severity: 'CRITICAL',
      detection: 'Workstation WS-CEC-024 presented a certificate that appears on the revocation list.',
      controlActivated: 'Attempt activation was refused before eligibility was evaluated or any paper was released.',
      userImpact: 'The candidate at that workstation was moved to an approved machine by the centre operator.',
      recoveryStatus: 'Closed. The device remains revoked pending hardware inspection.',
      apply: () => {
        const device = [...db.devices.values()].find((d) => d.status === 'REVOKED');
        if (device) device.lastHealthCheckAt = new Date().toISOString();
      },
    },
    DATABASE_SLOWDOWN: {
      title: 'Database latency spike',
      severity: 'WARNING',
      detection: 'Query latency rose from 4 ms to 640 ms across the connection pool.',
      controlActivated:
        'Answer writes were queued client-side and retried with their idempotency keys. The service reported "degraded but available".',
      userImpact: 'Candidates saw "Saving…" for longer than usual. No answer was lost.',
      recoveryStatus: 'Latency recovered. Queued writes were flushed and acknowledged.',
      apply: () => {
        database.setLatency(640);
        db.degradation.degraded = true;
        db.degradation.reason = 'Database latency elevated. Examinations continue; answer saves may take longer.';
        setTimeout(() => {
          database.setLatency(3);
          db.degradation.degraded = false;
          db.degradation.reason = null;
        }, 45_000).unref?.();
      },
    },
    REDIS_UNAVAILABLE: {
      title: 'Session cache unavailable',
      severity: 'WARNING',
      detection: 'Cache health probe failed three consecutive times.',
      controlActivated:
        'The service fell back to database-backed session lookups. Rate-limit counters switched to a local window.',
      userImpact: 'Sign-in took slightly longer. Active examinations were unaffected.',
      recoveryStatus: 'Cache restored automatically after 60 seconds.',
      apply: () => {
        cache.setAvailability(false);
        db.degradation.degraded = true;
        db.degradation.reason = 'Session cache unavailable. Examinations continue on the fallback path.';
        setTimeout(() => {
          cache.setAvailability(true);
          db.degradation.degraded = false;
          db.degradation.reason = null;
        }, 60_000).unref?.();
      },
    },
    INSTANCE_FAILURE: {
      title: 'Application instance failure',
      severity: 'WARNING',
      detection: 'One of three application instances stopped responding to health checks.',
      controlActivated: 'The instance was removed from the load balancer and a replacement was started.',
      userImpact:
        'Workstations connected to that instance reconnected within 5 seconds and resumed the same stored question sequence.',
      recoveryStatus: 'Replacement instance healthy. Capacity restored.',
      apply: () => {
        db.degradation.degraded = true;
        db.degradation.reason = 'Running on reduced capacity while a replacement instance starts.';
        setTimeout(() => {
          db.degradation.degraded = false;
          db.degradation.reason = null;
        }, 30_000).unref?.();
      },
    },
  };

  const definition = definitions[scenario];
  await definition.apply();

  const audit = recordAudit({
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action: 'SECURITY_SIMULATION',
    targetType: 'SecurityScenario',
    targetId: scenario,
    targetLabel: definition.title,
    result: definition.severity === 'CRITICAL' ? 'BLOCKED' : 'SUCCESS',
    reason: `Synthetic monitoring event generated for demonstration. ${definition.detection}`,
    ipAddress: meta.ipAddress,
    traceId: meta.traceId,
  });

  const result: SecuritySimulationResult = {
    id: randomUUID(),
    scenario,
    title: definition.title,
    startedAt: new Date().toISOString(),
    detection: definition.detection,
    controlActivated: definition.controlActivated,
    userImpact: definition.userImpact,
    recoveryStatus: definition.recoveryStatus,
    auditEventId: audit.id,
    severity: definition.severity,
    simulated: true,
  };
  db.simulations.unshift(result);
  if (db.simulations.length > 50) db.simulations.pop();
  return result;
}
