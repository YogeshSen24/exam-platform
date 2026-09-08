import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  questionDraftSchema,
  reviewDecisionSchema,
  type Question,
  type QuestionVersion,
} from '@sep/shared';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, paginate, parse, readPageParams } from '../lib/http.js';
import { questionContentHash } from '../lib/crypto/paper.js';

export async function questionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/questions', async (request, reply) => {
    requirePermission(request, 'questions.read');
    const db = getDb();
    const q = (request.query ?? {}) as Record<string, string>;
    const { page, pageSize } = readPageParams(q);

    let items = [...db.questions.values()].map((question) => {
      const version = db.questionVersions.get(question.currentVersionId);
      const author = db.users.get(question.authorUserId);
      return {
        ...question,
        stem: version?.stem ?? '',
        version: version?.version ?? 1,
        authorName: author?.fullName ?? 'Unknown',
        contentHash: version?.contentHash ?? '',
        optionCount: version?.options.length ?? 0,
      };
    });

    if (q.examId) {
      if (!db.exams.has(q.examId)) throw Errors.notFound('That examination');
      items = items.filter(item => db.examQuestions.get(q.examId!)?.has(item.id));
    }
    if (q.search) {
      const needle = q.search.toLowerCase();
      items = items.filter(
        (i) => i.stem.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle),
      );
    }
    if (q.subject) items = items.filter((i) => i.subject === q.subject);
    if (q.topic) items = items.filter((i) => i.topic === q.topic);
    if (q.difficulty) items = items.filter((i) => i.difficulty === q.difficulty);
    if (q.status) items = items.filter((i) => i.status === q.status);
    if (q.author) items = items.filter((i) => i.authorUserId === q.author);
    if (q.type) items = items.filter((i) => i.type === q.type);

    items.sort((a, b) => a.code.localeCompare(b.code));
    return noStore(reply).send({ ...paginate(items, page, pageSize), summary: {
      total: items.length, approved: items.filter(q => q.status === 'APPROVED').length,
      published: items.filter(q => q.status === 'PUBLISHED').length,
      inReview: items.filter(q => q.status === 'IN_REVIEW').length,
      draft: items.filter(q => q.status === 'DRAFT' || q.status === 'CHANGES_REQUESTED').length,
    } });
  });

  app.get('/questions/:questionId', async (request, reply) => {
    requirePermission(request, 'questions.read');
    const db = getDb();
    const { questionId } = request.params as { questionId: string };
    const question = db.questions.get(questionId);
    if (!question) throw Errors.notFound('That question');

    const scope = (request.query as { examId?: string })?.examId;
    if (scope && !db.examQuestions.get(scope)?.has(questionId)) throw Errors.notFound('That question in this examination');
    const versions = [...db.questionVersions.values()]
      .filter((v) => v.questionId === questionId)
      .sort((a, b) => a.version - b.version);
    const reviews = [...db.questionReviews.values()].filter((r) => r.questionId === questionId);

    return noStore(reply).send({
      question,
      versions,
      current: db.questionVersions.get(question.currentVersionId) ?? null,
      reviews: reviews.map((r) => ({ ...r, reviewerName: db.users.get(r.reviewerUserId)?.fullName ?? 'Unknown' })),
      author: db.users.get(question.authorUserId)?.fullName ?? 'Unknown',
    });
  });

  app.post('/questions', async (request, reply) => {
    const user = requirePermission(request, 'questions.write');
    const context = ctx(request);
    const body = parse(questionDraftSchema, request.body);
    const db = getDb();

    if (body.examId && !db.exams.has(body.examId)) throw Errors.notFound('That examination');
    const questionId = randomUUID();
    const version = buildVersion(questionId, 1, body, user.id, 'DRAFT');
    db.questionVersions.set(version.id, version);

    const question: Question = {
      id: questionId,
      code: `Q-${String(db.questions.size + 1).padStart(4, '0')}`,
      currentVersionId: version.id,
      status: 'DRAFT',
      authorUserId: user.id,
      subject: body.subject,
      topic: body.topic,
      difficulty: body.difficulty,
      marks: version.marks,
      categoryId: version.categoryId,
      categoryCode: version.categoryCode,
      type: body.type,
      createdAt: version.createdAt,
      updatedAt: version.createdAt,
    };
    db.questions.set(question.id, question);
    if (body.examId) {
      const bank = db.examQuestions.get(body.examId) ?? new Set<string>();
      bank.add(question.id); db.examQuestions.set(body.examId, bank);
    }

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'QUESTION_CREATED',
      targetType: 'Question',
      targetId: question.id,
      targetLabel: question.code,
      reason: `Draft created (${body.subject} / ${body.topic}, ${body.difficulty.toLowerCase()}).`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ question, version });
  });

  app.put('/questions/:questionId', async (request, reply) => {
    const user = requirePermission(request, 'questions.write');
    const context = ctx(request);
    const body = parse(questionDraftSchema, request.body);
    const db = getDb();
    const { questionId } = request.params as { questionId: string };

    const question = db.questions.get(questionId);
    if (!question) throw Errors.notFound('That question');

    // Approved and published versions are immutable.
    if (question.status === 'APPROVED' || question.status === 'PUBLISHED') {
      throw Errors.conflict(
        'Approved questions cannot be edited.',
        'Approved content is frozen so the fingerprint recorded at approval stays valid. Retire this question and author a replacement instead.',
      );
    }
    // A reviewer must not edit the author's question directly.
    if (question.authorUserId !== user.id && !user.roles.includes('SUPER_ADMIN')) {
      throw Errors.forbidden('editing a question authored by someone else');
    }

    const current = db.questionVersions.get(question.currentVersionId);
    const nextNumber = (current?.version ?? 0) + 1;
    const version = buildVersion(questionId, nextNumber, body, user.id, 'DRAFT');
    db.questionVersions.set(version.id, version);
    question.currentVersionId = version.id;
    question.status = 'DRAFT';
    question.subject = body.subject;
    question.topic = body.topic;
    question.difficulty = body.difficulty;
    question.marks = version.marks;
    question.categoryId = version.categoryId;
    question.categoryCode = version.categoryCode;
    question.type = body.type;
    question.updatedAt = version.createdAt;

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'QUESTION_MODIFIED',
      targetType: 'Question',
      targetId: question.id,
      targetLabel: `${question.code} v${nextNumber}`,
      reason: 'Draft revised. A new immutable version record was created.',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ question, version });
  });

  app.post('/questions/:questionId/submit', async (request, reply) => {
    const user = requirePermission(request, 'questions.write');
    const context = ctx(request);
    const db = getDb();
    const { questionId } = request.params as { questionId: string };
    const question = db.questions.get(questionId);
    if (!question) throw Errors.notFound('That question');
    if (question.authorUserId !== user.id && !user.roles.includes('SUPER_ADMIN')) {
      throw Errors.forbidden('submitting a question authored by someone else');
    }
    if (question.status === 'APPROVED' || question.status === 'PUBLISHED') {
      throw Errors.conflict('This question has already been approved.', 'No further submission is required.');
    }

    question.status = 'IN_REVIEW';
    const version = db.questionVersions.get(question.currentVersionId);
    if (version) version.status = 'IN_REVIEW';

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'QUESTION_SUBMITTED_FOR_REVIEW',
      targetType: 'Question',
      targetId: question.id,
      targetLabel: question.code,
      reason: 'Submitted for reviewer approval.',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ question });
  });

  app.post('/questions/:questionId/review', async (request, reply) => {
    const user = requirePermission(request, 'questions.review');
    const context = ctx(request);
    const body = parse(reviewDecisionSchema, request.body);
    const db = getDb();
    const { questionId } = request.params as { questionId: string };
    const question = db.questions.get(questionId);
    if (!question) throw Errors.notFound('That question');

    // An author cannot approve their own question.
    if (question.authorUserId === user.id && !env.ALLOW_SELF_APPROVAL) {
      throw Errors.forbidden(
        'approving a question you authored — a different reviewer is required (separation of duties)',
      );
    }
    if (question.status !== 'IN_REVIEW') {
      throw Errors.conflict(
        `This question is currently "${question.status}" and is not awaiting review.`,
        'Only questions submitted for review can be approved or returned.',
      );
    }

    const version = db.questionVersions.get(question.currentVersionId);
    const id = randomUUID();
    db.questionReviews.set(id, {
      id,
      questionId,
      questionVersionId: question.currentVersionId,
      reviewerUserId: user.id,
      decision: body.decision,
      comment: body.comment,
      createdAt: new Date().toISOString(),
    });

    if (body.decision === 'APPROVED') {
      question.status = 'APPROVED';
      if (version) {
        version.status = 'APPROVED';
        // Freeze the content: from here the fingerprint must not change.
        version.immutable = true;
        version.contentHash = questionContentHash(version);
      }
    } else {
      question.status = 'CHANGES_REQUESTED';
      if (version) version.status = 'CHANGES_REQUESTED';
    }

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: body.decision === 'APPROVED' ? 'QUESTION_APPROVED' : 'QUESTION_CHANGES_REQUESTED',
      targetType: 'Question',
      targetId: question.id,
      targetLabel: question.code,
      reason: body.comment,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ question, contentHash: version?.contentHash ?? null });
  });

  /** Readable difference between two versions of the same question. */
  app.get('/questions/:questionId/diff', async (request, reply) => {
    requirePermission(request, 'questions.read');
    const db = getDb();
    const { questionId } = request.params as { questionId: string };
    const q = (request.query ?? {}) as { from?: string; to?: string };
    const versions = [...db.questionVersions.values()]
      .filter((v) => v.questionId === questionId)
      .sort((a, b) => a.version - b.version);
    if (versions.length < 1) throw Errors.notFound('Versions for that question');

    const from = versions.find((v) => String(v.version) === q.from) ?? versions[0];
    const to = versions.find((v) => String(v.version) === q.to) ?? versions[versions.length - 1];
    if (!from || !to) throw Errors.notFound('Those question versions');

    const fields: { field: string; before: string; after: string; changed: boolean }[] = [
      { field: 'Question text', before: from.stem, after: to.stem, changed: from.stem !== to.stem },
      { field: 'Marks', before: String(from.marks), after: String(to.marks), changed: from.marks !== to.marks },
      { field: 'Difficulty', before: from.difficulty, after: to.difficulty, changed: from.difficulty !== to.difficulty },
      { field: 'Topic', before: from.topic, after: to.topic, changed: from.topic !== to.topic },
      { field: 'Explanation', before: from.explanation, after: to.explanation, changed: from.explanation !== to.explanation },
      {
        field: 'Reviewer notes',
        before: from.reviewerNotes,
        after: to.reviewerNotes,
        changed: from.reviewerNotes !== to.reviewerNotes,
      },
    ];

    const optionDiff = to.options.map((option, index) => {
      const before = from.options[index];
      return {
        label: option.label,
        before: before?.text ?? '(added)',
        after: option.text,
        changed: before?.text !== option.text,
        correctBefore: before?.isCorrect ?? false,
        correctAfter: option.isCorrect,
      };
    });

    return noStore(reply).send({
      from: { version: from.version, contentHash: from.contentHash, createdAt: from.createdAt },
      to: { version: to.version, contentHash: to.contentHash, createdAt: to.createdAt },
      fields,
      options: optionDiff,
      versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt, status: v.status })),
    });
  });
}

function buildVersion(
  questionId: string,
  versionNumber: number,
  body: ReturnType<typeof questionDraftSchema.parse>,
  userId: string,
  status: QuestionVersion['status'],
): QuestionVersion {
  const category = getDb().categories.get(body.categoryId);
  if (!category || category.archived) throw Errors.validation({ categoryId: 'Select an active category.' });
  if (!category.allowedTypes.includes(body.type)) throw Errors.validation({ type: 'This question type is not allowed in the selected category.' });
  if (category.subject && category.subject !== body.subject) throw Errors.validation({ subject: 'The subject must match the selected category.' });
  const version: QuestionVersion = {
    id: randomUUID(),
    questionId,
    version: versionNumber,
    stem: body.stem,
    type: body.type,
    options: body.options.map((o, i) => ({
      id: o.id ?? `${questionId}-opt-${i + 1}`,
      label: o.label,
      text: o.text,
      isCorrect: o.isCorrect,
    })),
    marks: category.marksPerQuestion,
    categoryId: category.id,
    categoryCode: category.code,
    paragraphWordLimit: category.paragraphWordLimit,
    markingGuidance: body.markingGuidance,
    negativeMarks: category.negativeMarksPerQuestion,
    subject: body.subject,
    topic: body.topic,
    difficulty: body.difficulty,
    explanation: body.explanation,
    reviewerNotes: body.reviewerNotes,
    status,
    createdAt: new Date().toISOString(),
    createdByUserId: userId,
    contentHash: '',
    immutable: false,
  };
  version.contentHash = questionContentHash(version);
  return version;
}
