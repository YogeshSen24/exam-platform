import type { FastifyInstance } from 'fastify';
import { demoScenarioSchema, GLOSSARY } from '@sep/shared';
import { env, isDemoEnabled } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, paginate, parse, readPageParams } from '../lib/http.js';
import { verifyAuditChain } from '../lib/audit.js';
import { keyProvider } from '../lib/crypto/keyProvider.js';
import { runSimulation, systemHealth } from '../services/opsService.js';
import { seedDatabase } from '../data/seed.js';

/** Audit trail, system health, glossary and the demonstration controls. */
export async function opsRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ audit ----------------------------- */

  app.get('/audit-events', async (request, reply) => {
    requirePermission(request, 'audit.read');
    const db = getDb();
    const q = (request.query ?? {}) as Record<string, string>;
    let items = [...db.auditEvents].reverse();

    if (q.action) items = items.filter((e) => e.action === q.action);
    if (q.actorId) items = items.filter((e) => e.actorId === q.actorId);
    if (q.result) items = items.filter((e) => e.result === q.result);
    if (q.targetId) items = items.filter((e) => e.targetId === q.targetId);
    if (q.from) items = items.filter((e) => e.timestamp >= q.from!);
    if (q.to) items = items.filter((e) => e.timestamp <= q.to!);
    if (q.search) {
      const needle = q.search.toLowerCase();
      items = items.filter(
        (e) =>
          e.actorName.toLowerCase().includes(needle) ||
          e.targetLabel.toLowerCase().includes(needle) ||
          e.reason.toLowerCase().includes(needle),
      );
    }

    const { page, pageSize } = readPageParams(q);
    return noStore(reply).send({
      ...paginate(items, page, pageSize),
      chain: verifyAuditChain(),
      immutabilityNote:
        'Audit entries cannot be edited or deleted through any application endpoint. Each entry carries the fingerprint of the entry before it, so an alteration breaks the chain. POC boundary: production deployments additionally write this chain to independent immutable (WORM) storage.',
    });
  });

  app.get('/audit-events/verify', async (request, reply) => {
    requirePermission(request, 'audit.read');
    return noStore(reply).send({ chain: verifyAuditChain() });
  });

  /* ---------------------------- system health ----------------------- */

  app.get('/system-health', async (request, reply) => {
    requirePermission(request, 'system.health.read');
    const db = getDb();
    return noStore(reply).send({
      health: systemHealth(),
      keyProvider: keyProvider().describe(),
      simulations: db.simulations.slice(0, 15),
      explanations: {
        p95ResponseTimeMs:
          'The time within which 95 of every 100 requests complete. A rising value means a minority of requests are slowing down.',
        wafBlockedRequests:
          'Requests rejected before reaching the application because they matched a known attack pattern.',
        rateLimitedRequests:
          'Requests slowed down because a single source sent too many in a short period. Genuine candidates are rarely affected.',
        unusualCryptoOperations:
          'Signing or decryption requests that did not match an expected examination workflow. Each one is investigated.',
      },
    });
  });

  /** Public liveness probe. No authentication, no sensitive detail. */
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', version: '0.1.0-poc', time: new Date().toISOString() });
  });

  /* ------------------------------ glossary -------------------------- */

  app.get('/glossary', async (_request, reply) => {
    return reply.send({ entries: GLOSSARY });
  });

  /* --------------------------- demo controls ------------------------ */

  app.post('/demo-scenarios', async (request, reply) => {
    if (!isDemoEnabled) throw Errors.demoDisabled();
    const user = requirePermission(request, 'system.health.read');
    const context = ctx(request);
    const body = parse(demoScenarioSchema, request.body);

    const role = user.roles.includes('SECURITY_ADMIN')
      ? 'SECURITY_ADMIN'
      : user.roles.includes('SUPER_ADMIN')
        ? 'SUPER_ADMIN'
        : 'EXAM_ADMIN';

    const result = await runSimulation(body.scenario, { id: user.id, name: user.fullName, role }, {
      ipAddress: context.ipAddress,
      traceId: context.traceId,
      examId: body.examId,
    });

    return noStore(reply).send({
      result,
      disclaimer:
        'No real attack was executed. The simulator only creates synthetic monitoring events so the detection, control, impact and recovery story can be demonstrated.',
    });
  });

  app.get('/demo-scenarios', async (_request, reply) => {
    if (!isDemoEnabled) throw Errors.demoDisabled();
    const db = getDb();
    return noStore(reply).send({ history: db.simulations });
  });

  app.post('/demo-scenarios/reset', async (request, reply) => {
    if (!isDemoEnabled) throw Errors.demoDisabled();
    requirePermission(request, 'system.security.write');
    const result = await seedDatabase();
    return noStore(reply).send({
      ok: true,
      message: 'Demonstration data has been rebuilt. All sessions were cleared, so please sign in again.',
      exam: { id: result.exam.id, name: result.exam.name, code: result.exam.code },
      candidateCount: result.candidateCount,
      questionCount: result.questionCount,
    });
  });

  app.get('/poc-disclosure', async (_request, reply) => {
    return reply.send({
      title: 'POC simulation versus production implementation',
      statement:
        'This is a proof of concept, not a production-certified security system. Controls marked as simulated demonstrate intended behaviour and must not be presented as production-ready.',
      capabilities: [
        {
          capability: 'Fingerprint verification',
          poc: 'Simulated scanner adapter with scripted outcomes',
          production: 'Certified scanner hardware and an accredited biometric matching service',
        },
        {
          capability: 'Facial recognition',
          poc: 'Camera capture UI with a simulated or local check',
          production: 'Validated liveness detection and a matching provider with published accuracy',
        },
        {
          capability: 'KMS / HSM',
          poc: 'Local development key provider, keys held in process memory',
          production: 'Cloud KMS or a dedicated hardware security module with policy-controlled release',
        },
        {
          capability: 'Mutual TLS',
          poc: 'Simulated device certificate status and local certificate records',
          production: 'Managed certificate authority with TPM-bound keys and real mTLS termination',
        },
        {
          capability: 'Kiosk mode',
          poc: 'Full-screen browser simulation',
          production: 'OS-level Assigned Access / WDAC or an equivalent managed lockdown',
        },
        {
          capability: 'DDoS protection',
          poc: 'Synthetic event simulation in the operations console',
          production: 'Managed upstream DDoS protection at the network edge',
        },
        {
          capability: 'Immutable audit',
          poc: 'Append-only hash-chained application model',
          production: 'Independent immutable / WORM storage outside the application’s control',
        },
        {
          capability: 'Device attestation',
          poc: 'Reported values from a simulated device agent',
          production: 'TPM-backed attestation verified by an attestation service',
        },
      ],
      environment: {
        keyProvider: keyProvider().describe(),
        demoModeEnabled: isDemoEnabled,
        selfApprovalAllowed: env.ALLOW_SELF_APPROVAL,
        persistence: env.PERSISTENCE_DRIVER,
      },
    });
  });
}
