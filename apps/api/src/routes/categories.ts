import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { questionCategorySchema, type QuestionCategory } from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, parse } from '../lib/http.js';

/**
 * Question categories.
 *
 * A category owns the marks. Every question in it is worth the same, which is
 * how a marking scheme is actually published and how it stays auditable.
 *
 * Editing a category's marks changes future papers, never a published one:
 * `ExamCategoryAllocation` resolves the mark value at assembly time, and the
 * signed manifest fixes it permanently.
 */
export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async (request, reply) => {
    requirePermission(request, 'questions.read');
    const db = getDb();

    const items = [...db.categories.values()]
      .filter((c) => !c.archived)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((category) => {
        const questions = [...db.questions.values()].filter((q) => q.categoryId === category.id);
        return {
          ...category,
          questionCount: questions.length,
          approvedCount: questions.filter((q) => q.status === 'APPROVED' || q.status === 'PUBLISHED').length,
          draftCount: questions.filter((q) => q.status === 'DRAFT' || q.status === 'CHANGES_REQUESTED').length,
          inReviewCount: questions.filter((q) => q.status === 'IN_REVIEW').length,
        };
      });

    return noStore(reply).send({ items, total: items.length });
  });

  app.post('/categories', async (request, reply) => {
    const user = requirePermission(request, 'questions.write');
    const context = ctx(request);
    const body = parse(questionCategorySchema, request.body);
    const db = getDb();

    if ([...db.categories.values()].some((c) => c.code === body.code && !c.archived)) {
      throw Errors.conflict(
        `Category code ${body.code} is already in use.`,
        'Category codes appear on the paper and must be unique.',
      );
    }

    const now = new Date().toISOString();
    const category: QuestionCategory = {
      id: randomUUID(),
      ...body,
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    db.categories.set(category.id, category);

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'EXAM_UPDATED',
      targetType: 'QuestionCategory',
      targetId: category.id,
      targetLabel: `${category.code} — ${category.name}`,
      reason: `Category created. Every question in it is worth ${category.marksPerQuestion} mark(s).`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ category });
  });

  app.put('/categories/:categoryId', async (request, reply) => {
    const user = requirePermission(request, 'questions.write');
    const context = ctx(request);
    const { categoryId } = request.params as { categoryId: string };
    const body = parse(questionCategorySchema, request.body);
    const db = getDb();

    const category = db.categories.get(categoryId);
    if (!category) throw Errors.notFound('That category');

    const marksChanged = category.marksPerQuestion !== body.marksPerQuestion;
    const affected = [...db.questions.values()].filter((q) => q.categoryId === categoryId);
    const published = affected.filter((q) => q.status === 'PUBLISHED').length;

    const previousMarks = category.marksPerQuestion;
    Object.assign(category, body, { updatedAt: new Date().toISOString() });

    // Marks live on the category, so a change must propagate to every question
    // in it. Published papers are unaffected: the manifest fixed their value.
    if (marksChanged) {
      affected.forEach((question) => {
        question.marks = body.marksPerQuestion;
        [...db.questionVersions.values()]
          .filter((v) => v.questionId === question.id && !v.immutable)
          .forEach((version) => {
            version.marks = body.marksPerQuestion;
            version.negativeMarks = body.negativeMarksPerQuestion;
            version.paragraphWordLimit = body.paragraphWordLimit;
          });
      });
    }

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'EXAM_UPDATED',
      targetType: 'QuestionCategory',
      targetId: category.id,
      targetLabel: `${category.code} — ${category.name}`,
      reason: marksChanged
        ? `Marks changed from ${previousMarks} to ${body.marksPerQuestion} across ${affected.length} question(s). ${published} already-published question(s) keep the value fixed in their signed manifest.`
        : 'Category details updated.',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({
      category,
      affectedQuestions: affected.length,
      publishedUnaffected: published,
    });
  });

  app.post('/categories/:categoryId/archive', async (request, reply) => {
    const user = requirePermission(request, 'questions.write');
    const context = ctx(request);
    const { categoryId } = request.params as { categoryId: string };
    const db = getDb();

    const category = db.categories.get(categoryId);
    if (!category) throw Errors.notFound('That category');

    const live = [...db.questions.values()].filter(
      (q) => q.categoryId === categoryId && q.status !== 'RETIRED',
    ).length;
    if (live > 0) {
      throw Errors.conflict(
        `${live} question(s) still belong to this category.`,
        'Move or retire those questions before archiving the category, so no question is left without a mark value.',
      );
    }

    category.archived = true;
    category.updatedAt = new Date().toISOString();

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'EXAM_UPDATED',
      targetType: 'QuestionCategory',
      targetId: category.id,
      targetLabel: `${category.code} — ${category.name}`,
      reason: 'Category archived.',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ category });
  });

  /**
   * How many approved questions each category can actually supply, per
   * difficulty. The wizard uses this so an administrator cannot allocate 20
   * difficult questions from a category holding 6.
   */
  app.get('/categories/availability', async (request, reply) => {
    requirePermission(request, 'exams.read');
    const db = getDb();

    const items = [...db.categories.values()]
      .filter((c) => !c.archived)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((category) => {
        const usable = [...db.questions.values()].filter(
          (q) => q.categoryId === category.id && (q.status === 'APPROVED' || q.status === 'PUBLISHED'),
        );
        return {
          categoryId: category.id,
          categoryCode: category.code,
          categoryName: category.name,
          marksPerQuestion: category.marksPerQuestion,
          negativeMarksPerQuestion: category.negativeMarksPerQuestion,
          allowedTypes: category.allowedTypes,
          paragraphWordLimit: category.paragraphWordLimit,
          available: usable.length,
          byDifficulty: {
            EASY: usable.filter((q) => q.difficulty === 'EASY').length,
            MEDIUM: usable.filter((q) => q.difficulty === 'MEDIUM').length,
            DIFFICULT: usable.filter((q) => q.difficulty === 'DIFFICULT').length,
          },
        };
      });

    return noStore(reply).send({ items });
  });
}
