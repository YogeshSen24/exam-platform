import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startApp, loginStaff, loginCandidate, authHeaders } from './helpers.js';
import { getDb } from '../lib/store/db.js';
import { ctx } from '../lib/session.js';

describe('exam workspace and export verification', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await startApp(); });
  afterAll(async () => { await app.close(); });
  it('lets the super administrator create centres, workstations and examinations', async () => {
    const admin = await loginStaff(app, 'super.admin@examboard.demo');
    const centre = await app.inject({ method: 'POST', url: '/api/v1/centres', headers: authHeaders(admin), payload: {
      code: 'UX-01', name: 'UX examination centre', city: 'Bengaluru', region: 'Karnataka', address: 'Test campus, Hall A', capacity: 500, primaryCidr: '10.80.0.0/16', contactName: 'Centre manager', contactPhone: '08012345678',
    } });
    expect(centre.statusCode).toBe(201);
    const device = await app.inject({ method: 'POST', url: '/api/v1/devices', headers: authHeaders(admin), payload: { deviceCode: 'WS-UX-001', name: 'Hall A workstation', centreId: centre.json().centre.id, operatingSystem: 'Windows 11', ipAddress: '10.80.1.10', kioskPolicyVersion: '2026.01.3' } });
    expect(device.statusCode).toBe(201);
    const original = getDb().exams.get('exam-ntae-2026-01')!;
    const exam = await app.inject({ method: 'POST', url: '/api/v1/exams', headers: authHeaders(admin), payload: { basics: { ...original, name: 'UX examination', code: 'UX-EXAM-01', centreId: centre.json().centre.id }, blueprint: original.blueprint, securityProfileId: original.securityPolicy.profileId, verification: original.securityPolicy.verification, monitoring: original.securityPolicy.monitoring, network: { ...original.securityPolicy.network, centreId: centre.json().centre.id }, candidateIds: [] } });
    expect(exam.statusCode).toBe(201);
  });
  it('creates an exam-scoped candidate who can sign in and rejects cross-exam detail access', async () => {
    const admin = await loginStaff(app, 'exam.admin@examboard.demo'); const examId = 'exam-nsca-2026-02';
    const created = await app.inject({ method: 'POST', url: '/api/v1/candidates', headers: authHeaders(admin), payload: { examId, fullName: 'UX Candidate', applicationId: 'UX-CAND-01', email: 'ux@example.test' } });
    expect(created.statusCode).toBe(201);
    const candidate = created.json().candidate;
    expect(candidate.examId).toBe(examId);
    expect((await loginCandidate(app, 'UX-CAND-01')).examId).toBe(examId);
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/candidates/${candidate.id}?examId=exam-ntae-2026-01`, headers: authHeaders(admin) });
    expect(foreign.statusCode).toBe(404);
  });
  it('keeps questions inside their examination bank', async () => {
    const author = await loginStaff(app, 'author@examboard.demo');
    const created = await app.inject({ method: 'POST', url: '/api/v1/questions', headers: authHeaders(author), payload: { examId: 'exam-nsca-2026-02', categoryId: 'category-desc', type: 'PARAGRAPH', stem: 'Explain the purpose of a transaction in a database.', subject: 'Computer Fundamentals', topic: 'Databases', difficulty: 'MEDIUM', markingGuidance: 'Award marks for atomicity and durability.', options: [] } });
    expect(created.statusCode).toBe(201);
    const other = await app.inject({ method: 'GET', url: `/api/v1/questions/${created.json().question.id}?examId=exam-ntae-2026-01`, headers: authHeaders(author) });
    expect(other.statusCode).toBe(404);
  });
  it('requires a fresh session-bound, scope-bound, single-use facial check for exports', async () => {
    const admin = await loginStaff(app, 'super.admin@examboard.demo');
    const request = { method: 'POST' as const, url: '/api/v1/exams/exam-ntae-2026-01/export', headers: authHeaders(admin), payload: { sections: ['EXAM_CONFIGURATION'], format: 'JSON', reason: 'Review examination setup.', pseudonymise: true } };
    expect((await app.inject(request)).statusCode).toBe(403);
    async function grant(outcome: string) {
      const challenge = await app.inject({ method: 'POST', url: '/api/v1/export-verification/challenge', headers: authHeaders(admin), payload: { scope: 'exam:exam-ntae-2026-01' } });
      return app.inject({ method: 'POST', url: '/api/v1/export-verification/verify', headers: authHeaders(admin), payload: { challengeId: challenge.json().challengeId, image: 'data:image/jpeg;base64,' + 'A'.repeat(120), demoOutcome: outcome } });
    }
    expect((await grant('MISMATCH')).statusCode).toBe(403);
    const verified = await grant('MATCH'); expect(verified.statusCode).toBe(200);
    const token = verified.json().token;
    const another = await loginStaff(app, 'exam.admin@examboard.demo');
    expect((await app.inject({ ...request, headers: authHeaders(another, { 'x-export-verification': token }) })).statusCode).toBe(403);
    const scoped = { ...request, headers: authHeaders(admin, { 'x-export-verification': token }) };
    expect((await app.inject({ ...scoped, url: '/api/v1/exams/exam-nsca-2026-02/export' })).statusCode).toBe(403);
    expect((await app.inject(scoped)).statusCode).toBe(200);
    expect((await app.inject(scoped)).statusCode).toBe(403);
    const expired = await grant('MATCH');
    for (const session of getDb().sessions.values()) if (session.exportGrant) session.exportGrant.expiresAt = 0;
    expect((await app.inject({ ...request, headers: authHeaders(admin, { 'x-export-verification': expired.json().token }) })).statusCode).toBe(403);
  });
});
