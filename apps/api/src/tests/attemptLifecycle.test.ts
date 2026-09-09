import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../lib/store/db.js';
import {
  activate,
  authHeaders,
  fetchQuestion,
  loginCandidate,
  loginStaff,
  saveAnswerRequest,
  startApp,
} from './helpers.js';

describe('attempt lifecycle, answers and receipts', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a revoked device cannot activate an attempt', async () => {
    // WS-CEC-024 is seeded as revoked.
    const client = await loginCandidate(app, 'NTAE26-000020', 'WS-CEC-024');
    const response = await activate(client, 'WS-CEC-024');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('UNAUTHORIZED_DEVICE');
    expect(response.json().error.guidance).toContain('Do not continue on this machine');
  });

  it('an unregistered workstation cannot activate an attempt', async () => {
    const client = await loginCandidate(app, 'NTAE26-000021', 'LAPTOP-UNKNOWN');
    const response = await activate(client, 'LAPTOP-UNKNOWN');
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('UNAUTHORIZED_DEVICE');
  });

  it('alerts admins when a workstation is not approved and lets them approve it with a reason', async () => {
    const client = await loginCandidate(app, 'NTAE26-000023', 'LAPTOP-UNKNOWN');
    const preflight = await client.app.inject({
      method: 'POST',
      url: '/api/v1/attempts/preflight',
      headers: authHeaders(client, { 'x-workstation-code': 'LAPTOP-UNKNOWN' }),
      payload: {
        deviceCode: 'LAPTOP-UNKNOWN',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
      },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.json().checks.find((check: { key: string }) => check.key === 'device').status).toBe('FAILED');

    const incident = [...getDb().incidents.values()].find(
      (entry) =>
        entry.type === 'UNAPPROVED_WORKSTATION' &&
        entry.candidateId === getDb().candidateCredentials.get('NTAE26-000023')?.candidateId &&
        entry.metadata?.reportedDeviceCode === 'LAPTOP-UNKNOWN',
    );
    expect(incident).toBeDefined();

    const admin = await loginStaff(app, 'exam.admin@examboard.demo');
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incident!.id}/approve-workstation`,
      headers: authHeaders(admin),
      payload: { reason: 'Verified the workstation label and allowed it for this demo sitting.' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().incident.status).toBe('RESOLVED');
    expect(approved.json().device.status).toBe('APPROVED');

    const retried = await client.app.inject({
      method: 'POST',
      url: '/api/v1/attempts/preflight',
      headers: authHeaders(client, { 'x-workstation-code': 'LAPTOP-UNKNOWN' }),
      payload: {
        deviceCode: 'LAPTOP-UNKNOWN',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
      },
    });
    expect(retried.json().checks.find((check: { key: string }) => check.key === 'device').status).toBe('PASSED');
    expect(getDb().auditEvents.at(-1)?.action).toBe('CANDIDATE_VERIFICATION');
    expect(getDb().auditEvents.some((event) => event.action === 'ADMIN_OVERRIDE' && event.reason.includes('Verified'))).toBe(true);
  });

  it('an unapproved network is rejected when allowlisting is enabled', async () => {
    const client = await loginCandidate(app, 'NTAE26-000022', 'WS-CEC-006');
    const response = await client.app.inject({
      method: 'POST',
      url: '/api/v1/attempts/activate',
      headers: authHeaders(client, {
        'x-workstation-code': 'WS-CEC-006',
        // Simulates a workstation outside the approved centre ranges.
        'x-demo-client-ip': '203.0.113.55',
      }),
      payload: {
        examId: client.examId,
        deviceCode: 'WS-CEC-006',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
        consent: {
          identityConfirmed: true,
          rulesUnderstood: true,
          monitoringAcknowledged: true,
          savingUnderstood: true,
        },
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('UNAUTHORIZED_NETWORK');
  });

  it('a reconnection restores exactly the same randomised paper', async () => {
    const client = await loginCandidate(app, 'NTAE26-000006', 'WS-CEC-013');
    const first = await activate(client, 'WS-CEC-013');
    const attemptId = first.json().attempt.id;

    const before = [] as { stem: string; options: string[] }[];
    for (const sequence of [1, 2, 3, 17, 50]) {
      const q = (await fetchQuestion(client, attemptId, sequence)).json().question;
      before.push({ stem: q.stem, options: q.options.map((o: { id: string }) => o.id) });
    }

    // Simulate an application restart / reconnection.
    const again = await activate(client, 'WS-CEC-013');
    expect(again.statusCode).toBe(201);
    expect(again.json().attempt.id).toBe(attemptId);

    const after = [] as { stem: string; options: string[] }[];
    for (const sequence of [1, 2, 3, 17, 50]) {
      const q = (await fetchQuestion(client, attemptId, sequence)).json().question;
      after.push({ stem: q.stem, options: q.options.map((o: { id: string }) => o.id) });
    }

    expect(after).toEqual(before);
    // Exactly one assignment exists for the attempt.
    const assignments = [...getDb().assignments.values()].filter((a) => a.attemptId === attemptId);
    expect(assignments).toHaveLength(1);
  });

  it('a replayed idempotency key does not duplicate an answer event', async () => {
    const client = await loginCandidate(app, 'NTAE26-000007', 'WS-CEC-014');
    const attemptId = (await activate(client, 'WS-CEC-014')).json().attempt.id;
    const question = (await fetchQuestion(client, attemptId, 1)).json().question;
    const optionId = question.options[0].id;
    const key = 'stable-retry-key-000001';

    const first = await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
      selectedOptionIds: [optionId],
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(first.json().outcome).toBe('COMMITTED');
    expect(first.json().answer.version).toBe(1);

    const replay = await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
      selectedOptionIds: [optionId],
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(replay.json().outcome).toBe('DUPLICATE_IGNORED');
    expect(replay.json().answer.version).toBe(1);

    const committed = getDb().answerEvents.filter(
      (e) => e.attemptId === attemptId && e.idempotencyKey === key && e.outcome === 'COMMITTED',
    );
    expect(committed).toHaveLength(1);
  });

  it('concurrent answer updates are version-controlled', async () => {
    const client = await loginCandidate(app, 'NTAE26-000008', 'WS-CEC-015');
    const attemptId = (await activate(client, 'WS-CEC-015')).json().attempt.id;
    const question = (await fetchQuestion(client, attemptId, 2)).json().question;
    const [first, second] = question.options;

    await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
      selectedOptionIds: [first.id],
      expectedVersion: 0,
      idempotencyKey: 'concurrency-key-a-0001',
    });

    // A second writer still believes the answer is at version 0.
    const stale = await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
      selectedOptionIds: [second.id],
      expectedVersion: 0,
      idempotencyKey: 'concurrency-key-b-0002',
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('ANSWER_VERSION_CONFLICT');
    expect(stale.json().error.answersSafe).toBe(true);
    expect(stale.json().error.details.serverVersion).toBe(1);

    // Retrying with the correct version succeeds.
    const retried = await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
      selectedOptionIds: [second.id],
      expectedVersion: 1,
      idempotencyKey: 'concurrency-key-c-0003',
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().answer.version).toBe(2);
  });

  it('a submitted attempt cannot be modified and its receipt matches the answer-set hash', async () => {
    const client = await loginCandidate(app, 'NTAE26-000009', 'WS-CEC-016');
    const attemptId = (await activate(client, 'WS-CEC-016')).json().attempt.id;

    const answered: string[] = [];
    for (const sequence of [1, 2, 3]) {
      const question = (await fetchQuestion(client, attemptId, sequence)).json().question;
      await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
        selectedOptionIds: [question.options[0].id],
        expectedVersion: 0,
        idempotencyKey: `submit-flow-key-${sequence}`,
      });
      answered.push(question.assignmentQuestionId);
    }

    const submitted = await client.app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/submit`,
      headers: authHeaders(client),
      payload: { confirmed: true },
    });
    expect(submitted.statusCode).toBe(201);
    const receipt = submitted.json().receipt;

    expect(receipt.answeredCount).toBe(3);
    expect(receipt.unansweredCount).toBe(47);
    expect(receipt.answerSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.receiptId).toContain('RCPT-NTAE-2026-01');

    // The stored receipt is the same one the candidate can retrieve later.
    const fetched = await client.app.inject({
      method: 'GET',
      url: `/api/v1/attempts/${attemptId}/receipt`,
      headers: { cookie: client.cookie },
    });
    expect(fetched.json().receipt.answerSetHash).toBe(receipt.answerSetHash);

    // No further answer changes are accepted.
    const afterSubmit = await saveAnswerRequest(client, attemptId, answered[0]!, {
      selectedOptionIds: [],
      expectedVersion: 1,
      idempotencyKey: 'after-submit-key-0001',
    });
    expect(afterSubmit.statusCode).toBe(409);
    expect(afterSubmit.json().error.code).toBe('ATTEMPT_FINALISED');

    // Resubmission returns the same receipt rather than creating a second one.
    const resubmit = await client.app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/submit`,
      headers: authHeaders(client),
      payload: { confirmed: true },
    });
    expect(resubmit.statusCode).toBe(409);
  });

  it('camera monitoring restricts navigation after the configured threshold without losing answers', async () => {
    const client = await loginCandidate(app, 'NTAE26-000012', 'WS-CEC-017');
    const attemptId = (await activate(client, 'WS-CEC-017')).json().attempt.id;

    const question = (await fetchQuestion(client, attemptId, 1)).json().question;
    await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
      selectedOptionIds: [question.options[0].id],
      expectedVersion: 0,
      idempotencyKey: 'monitoring-answer-key-1',
    });

    const responses: string[] = [];
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const challenge = (
        await client.app.inject({
          method: 'POST',
          url: '/api/v1/evidence/challenge',
          headers: authHeaders(client),
          payload: { attemptId },
        })
      ).json().challenge;

      const upload = await client.app.inject({
        method: 'POST',
        url: '/api/v1/evidence/upload-authorize',
        headers: authHeaders(client),
        payload: {
          attemptId,
          challengeId: challenge.challengeId,
          sequence,
          capturedAt: new Date().toISOString(),
          deviceCode: 'WS-CEC-017',
          previousEvidenceHash: null,
          simulatedResult: 'NO_FACE_DETECTED',
          imageBytes: 38000,
        },
      });
      responses.push(upload.json().response);
      expect(upload.json().answersSafe).toBe(true);
    }

    expect(responses).toEqual(['SUBTLE_WARNING', 'PROMINENT_WARNING', 'RESTRICT_NAVIGATION']);

    // Navigation is paused, but the saved answer is still there.
    const blocked = await fetchQuestion(client, attemptId, 5);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.guidance).toContain('saved on the server');

    const stored = getDb().answers.get(`${attemptId}:${question.assignmentQuestionId}`);
    expect(stored?.selectedOptionIds).toHaveLength(1);

    // An invigilator — a human — releases the session. Software never does.
    const invigilator = await loginStaff(app, 'invigilator@examboard.demo');
    const released = await app.inject({
      method: 'POST',
      url: '/api/v1/invigilator/actions',
      headers: authHeaders(invigilator),
      payload: {
        attemptId,
        action: 'APPROVE_RECOVERY',
        reason: 'Identity confirmed in person against the admit card photograph.',
      },
    });
    expect(released.statusCode).toBe(200);
    expect(released.json().attempt.status).toBe('ACTIVE');
    expect((await fetchQuestion(client, attemptId, 5)).statusCode).toBe(200);
  });

  it('every invigilator action records a reason in the audit trail', async () => {
    const invigilator = await loginStaff(app, 'invigilator@examboard.demo');
    const attempt = [...getDb().attempts.values()].find((a) => a.status === 'ACTIVE')!;

    const missingReason = await app.inject({
      method: 'POST',
      url: '/api/v1/invigilator/actions',
      headers: authHeaders(invigilator),
      payload: { attemptId: attempt.id, action: 'EXTEND_TIME', extraMinutes: 10 },
    });
    expect(missingReason.statusCode).toBe(400);

    const withReason = await app.inject({
      method: 'POST',
      url: '/api/v1/invigilator/actions',
      headers: authHeaders(invigilator),
      payload: {
        attemptId: attempt.id,
        action: 'EXTEND_TIME',
        extraMinutes: 10,
        reason: 'Centre-wide power interruption lasting nine minutes.',
      },
    });
    expect(withReason.statusCode).toBe(200);

    const audit = getDb().auditEvents.at(-1)!;
    expect(audit.action).toBe('TIME_EXTENDED');
    expect(audit.reason).toContain('power interruption');
  });
});
