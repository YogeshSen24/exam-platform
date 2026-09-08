import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startApp, loginStaff, authHeaders, loginCandidate, activate, fetchQuestion } from './helpers.js';
import { getDb } from '../lib/store/db.js';
import { questionContentHash } from '../lib/crypto/paper.js';

describe('completed application workflows', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await startApp(); });
  afterAll(async () => { await app.close(); });
  it('serves seeded categories and resolves marks on authored questions', async () => {
    const author = await loginStaff(app, 'author@examboard.demo');
    const categories = await app.inject({ method: 'GET', url: '/api/v1/categories', headers: authHeaders(author) });
    expect(categories.statusCode).toBe(200); expect(categories.json().items.length).toBe(7);
    const response = await app.inject({ method: 'POST', url: '/api/v1/questions', headers: authHeaders(author), payload: {
      categoryId: 'category-desc', type: 'PARAGRAPH', stem: 'Explain how a database transaction protects examination answers.',
      subject: 'Computer Fundamentals', topic: 'Databases', difficulty: 'MEDIUM', options: [],
      markingGuidance: 'Award credit for atomicity, consistency, isolation and durability.', marks: 999,
    } });
    expect(response.statusCode).toBe(201); expect(response.json().version.marks).toBe(10);
    expect(response.json().version.paragraphWordLimit).toBe(300);
    const version = response.json().version;
    expect(questionContentHash({ ...version, paragraphWordLimit: 500 })).not.toBe(version.contentHash);
  });
  it('validates candidate CSV rows before committing and prevents replay', async () => {
    const admin = await loginStaff(app, 'exam.admin@examboard.demo');
    const validation = await app.inject({ method: 'POST', url: '/api/v1/import/validate', headers: authHeaders(admin), payload: {
      kind: 'CANDIDATES', fileName: 'new.csv', examId: 'exam-ntae-2026-01', rows: [{ applicationId: 'NEW-1001', fullName: 'New Candidate', email: 'new@example.test' }],
    } });
    expect(validation.statusCode).toBe(200); expect(validation.json().validation.canCommit).toBe(true);
    expect(getDb().candidateCredentials.has('NEW-1001')).toBe(false);
    const request = { method: 'POST' as const, url: '/api/v1/import/commit', headers: authHeaders(admin), payload: { token: validation.json().validation.token, reason: 'Add the new candidate cohort.' } };
    expect((await app.inject(request)).json().result.created).toBe(1);
    expect((await app.inject(request)).statusCode).toBe(409);
  });
  it('creates and assembles exactly the category and difficulty requested', async () => {
    const admin = await loginStaff(app, 'exam.admin@examboard.demo');
    const original = getDb().exams.get('exam-ntae-2026-01')!;
    const category = getDb().categories.get('category-qa')!;
    const version = [...getDb().questionVersions.values()].find(v => v.categoryId === category.id && v.status === 'PUBLISHED')!;
    const mix = { EASY: 0, MEDIUM: 0, DIFFICULT: 0 }; mix[version.difficulty] = 1;
    const payload = { basics: { ...original, name: 'Category integration exam', code: 'CATEGORY-TEST', startsAt: new Date(Date.now() + 86400000).toISOString() },
      blueprint: { ...original.blueprint, totalQuestions: 1, totalMarks: 2, difficultyDistribution: mix,
        categoryAllocations: [{ categoryId: category.id, categoryCode: category.code, categoryName: category.name, questionCount: 1, marksPerQuestion: 2, negativeMarksPerQuestion: 0.5, difficultyMix: mix, totalMarks: 2 }] },
      securityProfileId: original.securityPolicy.profileId, verification: original.securityPolicy.verification,
      monitoring: original.securityPolicy.monitoring, network: original.securityPolicy.network, candidateIds: [],
    };
    const created = await app.inject({ method: 'POST', url: '/api/v1/exams', headers: authHeaders(admin), payload });
    expect(created.statusCode).toBe(201);
    getDb().examQuestions.set(created.json().exam.id, new Set([version.questionId]));
    const assembled = await app.inject({ method: 'POST', url: `/api/v1/exams/${created.json().exam.id}/assemble-paper`, headers: authHeaders(admin), payload: {} });
    expect(assembled.statusCode).toBe(201); expect(assembled.json().manifest.entries).toHaveLength(1);
    const entry = assembled.json().manifest.entries[0]; expect(entry.difficulty).toBe(version.difficulty);
    expect(getDb().questionVersions.get(entry.questionVersionId)?.categoryId).toBe(category.id);
  });
  it('does not allow a live examination paper to be replaced', async () => {
    const admin = await loginStaff(app, 'exam.admin@examboard.demo');
    const result = await app.inject({ method: 'POST', url: '/api/v1/exams/exam-ntae-2026-01/assemble-paper', headers: authHeaders(admin), payload: {} });
    expect(result.statusCode).toBe(409);
  });
  it('exposes tracking and keeps answer keys out of candidate exports', async () => {
    const admin = await loginStaff(app, 'super.admin@examboard.demo');
    const result = await app.inject({ method: 'GET', url: '/api/v1/tracking/exams/exam-ntae-2026-01', headers: authHeaders(admin) });
    expect(result.statusCode).toBe(200); expect(result.json().snapshot.checks.length).toBeGreaterThan(0);
    const candidate = await loginCandidate(app, 'NTAE26-000021');
    const denied = await app.inject({ method: 'POST', url: '/api/v1/exams/exam-ntae-2026-01/export', headers: authHeaders(candidate), payload: { sections: ['ANSWER_KEY'], format: 'JSON', reason: 'Attempt to access answers.', pseudonymise: false } });
    expect(denied.statusCode).toBe(403);
  });
});
