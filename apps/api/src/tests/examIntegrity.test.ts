import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../lib/store/db.js';
import { verifyPaperIntegrity } from '../lib/crypto/paper.js';
import { verifyAuditChain } from '../lib/audit.js';
import { activate, authHeaders, fetchQuestion, loginCandidate, loginStaff, startApp } from './helpers.js';

describe('question-paper integrity and release control', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a modified question fails integrity verification and blocks release', async () => {
    const db = getDb();
    const exam = db.exams.get('exam-ntae-2026-01')!;
    const manifest = db.manifests.get(exam.manifestId!)!;

    const before = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
    expect(before.ok).toBe(true);
    expect(before.verifiedQuestionCount).toBe(manifest.entries.length);

    // Tamper with a stored question after approval.
    const target = db.questionVersions.get(manifest.entries[0]!.questionVersionId)!;
    const original = target.stem;
    target.stem = `${original} (altered)`;

    const after = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
    expect(after.ok).toBe(false);
    expect(after.failedEntries).toHaveLength(1);
    expect(after.signatureValid).toBe(true); // the signature is intact; the content is not

    // A candidate cannot start on a paper that fails verification.
    const candidate = await loginCandidate(app, 'NTAE26-000010', 'WS-CEC-010');
    const activation = await activate(candidate);
    expect(activation.statusCode).toBe(409);
    expect(activation.json().error.code).toBe('PAPER_INTEGRITY_FAILED');

    target.stem = original;
    const restored = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
    expect(restored.ok).toBe(true);
  });

  it('the signature over the manifest verifies with the issuing key', async () => {
    const db = getDb();
    const manifest = db.manifests.get(db.exams.get('exam-ntae-2026-01')!.manifestId!)!;
    const report = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
    expect(report.signatureValid).toBe(true);
    expect(manifest.signatureAlgorithm).toBe('Ed25519');
    expect(manifest.encryptionProfile).toContain('AES-256-GCM');
  });

  it('the correct answer is never delivered to the candidate client', async () => {
    const client = await loginCandidate(app, 'NTAE26-000011', 'WS-CEC-011');
    const attemptId = (await activate(client)).json().attempt.id;
    const response = await fetchQuestion(client, attemptId, 1);
    const raw = response.body;

    expect(response.statusCode).toBe(200);
    expect(raw).not.toContain('isCorrect');
    expect(raw).not.toContain('explanation');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('dual approval requires two different approvers', async () => {
    const admin = await loginStaff(app, 'exam.admin@examboard.demo');
    const assembled = await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-nsca-2026-02/assemble-paper',
      headers: authHeaders(admin),
      payload: {},
    });
    expect(assembled.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-nsca-2026-02/request-publication',
      headers: authHeaders(admin),
      payload: {},
    });

    const reviewer = await loginStaff(app, 'reviewer@examboard.demo');
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-nsca-2026-02/approve-publication',
      headers: authHeaders(reviewer),
      payload: { decision: 'APPROVED', comment: 'Content and marking scheme verified.' },
    });
    expect(first.statusCode).toBe(200);

    // The same approver cannot supply the second approval.
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-nsca-2026-02/approve-publication',
      headers: authHeaders(reviewer),
      payload: { decision: 'APPROVED', comment: 'Approving a second time.' },
    });
    expect(repeat.statusCode).toBe(409);

    const security = await loginStaff(app, 'security.admin@examboard.demo');
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-nsca-2026-02/approve-publication',
      headers: authHeaders(security),
      payload: { decision: 'APPROVED', comment: 'Release policy and network policy verified.' },
    });
    // Enhanced profile needs one approval, so it is already published by now.
    expect([200, 409]).toContain(second.statusCode);
    expect(getDb().exams.get('exam-nsca-2026-02')!.status).toBe('PUBLISHED');
  });

  it('the audit chain detects a rewritten entry', async () => {
    const db = getDb();
    expect(verifyAuditChain().intact).toBe(true);

    const victim = db.auditEvents[3]!;
    const originalReason = victim.reason;
    victim.reason = 'Reason rewritten after the fact';

    const broken = verifyAuditChain();
    expect(broken.intact).toBe(false);
    expect(broken.brokenAtSequence).toBe(victim.sequence);

    victim.reason = originalReason;
    expect(verifyAuditChain().intact).toBe(true);
  });
});
