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

/**
 * Authorisation rules. Each test states the promise it protects.
 */
describe('authorisation and ownership', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a candidate cannot access another candidate’s attempt', async () => {
    const alice = await loginCandidate(app, 'NTAE26-000001', 'WS-CEC-001');
    const activated = await activate(alice);
    expect(activated.statusCode).toBe(201);
    const attemptId = activated.json().attempt.id;

    const bob = await loginCandidate(app, 'NTAE26-000002', 'WS-CEC-002');
    const response = await fetchQuestion(bob, attemptId, 1);

    // 404, not 403: Bob must not even learn that the attempt exists.
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('a candidate cannot answer a question outside their assignment', async () => {
    const alice = await loginCandidate(app, 'NTAE26-000003', 'WS-CEC-003');
    const activated = await activate(alice);
    const attemptId = activated.json().attempt.id;

    const bob = await loginCandidate(app, 'NTAE26-000004', 'WS-CEC-004');
    const bobAttemptId = (await activate(bob)).json().attempt.id;
    const bobQuestion = (await fetchQuestion(bob, bobAttemptId, 1)).json().question;

    const response = await saveAnswerRequest(alice, attemptId, bobQuestion.assignmentQuestionId, {
      selectedOptionIds: [],
      expectedVersion: 0,
      idempotencyKey: 'cross-assignment-attempt-1',
    });

    expect(response.statusCode).toBe(404);
  });

  it('a candidate cannot select an option that was not delivered for that question', async () => {
    const client = await loginCandidate(app, 'NTAE26-000005', 'WS-CEC-005');
    const attemptId = (await activate(client)).json().attempt.id;
    const question = (await fetchQuestion(client, attemptId, 1)).json().question;

    const response = await saveAnswerRequest(client, attemptId, question.assignmentQuestionId, {
      selectedOptionIds: ['question-999-opt-1'],
      expectedVersion: 0,
      idempotencyKey: 'foreign-option-key-1',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('a question author cannot approve their own question', async () => {
    const author = await loginStaff(app, 'author@examboard.demo');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers: authHeaders(author),
      payload: draftQuestion(),
    });
    expect(created.statusCode).toBe(201);
    const questionId = created.json().question.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${questionId}/submit`,
      headers: authHeaders(author),
      payload: {},
    });

    // The author holds no review permission at all.
    const selfReview = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${questionId}/review`,
      headers: authHeaders(author),
      payload: { decision: 'APPROVED', comment: 'Approving my own question' },
    });
    expect(selfReview.statusCode).toBe(403);

    const reviewer = await loginStaff(app, 'reviewer@examboard.demo');
    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${questionId}/review`,
      headers: authHeaders(reviewer),
      payload: { decision: 'APPROVED', comment: 'Blueprint coverage and key verified.' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().question.status).toBe('APPROVED');
  });

  it('a reviewer cannot modify an approved question', async () => {
    const reviewer = await loginStaff(app, 'reviewer@examboard.demo');
    const db = getDb();
    const approved = [...db.questions.values()].find((q) => (q.status === 'APPROVED' || q.status === 'PUBLISHED'));
    expect(approved).toBeDefined();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${approved!.id}`,
      headers: authHeaders(reviewer),
      payload: draftQuestion('Reviewer trying to rewrite an approved question directly.'),
    });

    // Reviewers hold no write permission, so this is refused outright.
    expect(response.statusCode).toBe(403);
  });

  it('an approved question cannot be edited even by its author', async () => {
    const author = await loginStaff(app, 'author@examboard.demo');
    const db = getDb();
    const approved = [...db.questions.values()].find(
      (q) => (q.status === 'APPROVED' || q.status === 'PUBLISHED') && q.authorUserId === 'user-question-author',
    );
    if (!approved) return;

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${approved.id}`,
      headers: authHeaders(author),
      payload: draftQuestion('Author trying to edit after approval.'),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('cannot be edited');
  });

  it('an invigilator cannot publish an examination', async () => {
    const invigilator = await loginStaff(app, 'invigilator@examboard.demo');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-ntae-2026-01/approve-publication',
      headers: authHeaders(invigilator),
      payload: { decision: 'APPROVED', comment: 'Attempting to publish without authority.' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('an invigilator cannot read the question bank', async () => {
    const invigilator = await loginStaff(app, 'invigilator@examboard.demo');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/questions',
      headers: { cookie: invigilator.cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('an administrator cannot edit or delete an audit event', async () => {
    const admin = await loginStaff(app, 'super.admin@examboard.demo');
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events?pageSize=1',
      headers: { cookie: admin.cookie },
    });
    const event = list.json().items[0];
    expect(event).toBeDefined();

    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1/audit-events/${event.id}`,
        headers: authHeaders(admin),
        payload: { reason: 'rewritten' },
      });
      // No such route exists — the model is append-only by construction.
      expect(response.statusCode).toBe(404);
    }

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-events/verify',
      headers: { cookie: admin.cookie },
    });
    expect(after.json().chain.intact).toBe(true);
  });

  it('treats a malformed request as a client error, not a server fault', async () => {
    const admin = await loginStaff(app, 'exam.admin@examboard.demo');

    // A command endpoint that takes no payload, called with a JSON content type
    // and an empty body — reasonable, and must not be a 500.
    const emptyBody = await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-ntae-2026-01/request-publication',
      headers: { ...authHeaders(admin), 'content-type': 'application/json' },
      payload: '',
    });
    expect(emptyBody.statusCode).toBe(200);

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('VALIDATION_FAILED');
    // An internal error would leak nothing useful and mislead the caller.
    expect(malformed.json().error.code).not.toBe('INTERNAL_ERROR');
  });

  it('mutations without a CSRF token are refused', async () => {
    const admin = await loginStaff(app, 'exam.admin@examboard.demo');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/exams/exam-ntae-2026-01/request-publication',
      headers: { cookie: admin.cookie }, // no x-csrf-token
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });
});

function draftQuestion(stem = 'Which control prevents a retried answer from being saved twice in an examination system?') {
  return {
    stem,
    type: 'SINGLE_CHOICE',
    options: [
      { label: 'A', text: 'An idempotency key', isCorrect: true },
      { label: 'B', text: 'A larger connection pool', isCorrect: false },
      { label: 'C', text: 'Response compression', isCorrect: false },
      { label: 'D', text: 'A longer session timeout', isCorrect: false },
    ],
    categoryId: 'category-cf',
    marks: 2,
    negativeMarks: 0.5,
    subject: 'Computer Fundamentals',
    topic: 'Networking',
    difficulty: 'MEDIUM',
    explanation: 'The key lets the server recognise a repeat and record it once.',
    reviewerNotes: '',
  };
}
