import { randomUUID } from 'node:crypto';
import type { Answer, AnswerEvent, Candidate, ExamAttempt, SaveAnswerInput } from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { assertAttemptAnswerable } from './attemptService.js';

/**
 * Answer persistence.
 *
 * Five server-side checks run on every save, in this order:
 *   1. the candidate owns the attempt          (checked by the caller)
 *   2. the attempt is active and in time
 *   3. the question belongs to this attempt's assignment
 *   4. every selected option belongs to that question's delivered option set
 *   5. the supplied version matches the stored version
 *
 * An idempotency key makes a retried save safe: the repeat is recorded as
 * `DUPLICATE_IGNORED` rather than applied twice.
 */

export interface SaveAnswerResult {
  answer: Answer;
  outcome: 'COMMITTED' | 'DUPLICATE_IGNORED';
  /** Server acknowledgement time, written only after the record is committed. */
  committedAt: string;
}

export function saveAnswer(input: {
  attempt: ExamAttempt;
  candidate: Candidate;
  assignmentQuestionId: string;
  payload: SaveAnswerInput;
  idempotencyKey: string;
  ipAddress: string;
  traceId: string;
}): SaveAnswerResult {
  const db = getDb();
  const { attempt, candidate, assignmentQuestionId, payload, idempotencyKey } = input;

  assertAttemptAnswerable(attempt);

  const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;
  if (!assignment) throw Errors.notFound('The question assignment for this attempt');

  // 3. Assignment membership — a candidate cannot answer a question that is not
  //    in their own paper, even if they know its identifier.
  const assigned = assignment.questions.find((q) => q.id === assignmentQuestionId);
  if (!assigned) {
    recordAudit({
      actorId: candidate.id,
      actorName: candidate.fullName,
      actorRole: 'CANDIDATE',
      action: 'ANSWER_SAVED',
      targetType: 'AssignedQuestion',
      targetId: assignmentQuestionId,
      targetLabel: 'Question outside the candidate assignment',
      result: 'BLOCKED',
      reason: 'The requested question does not belong to this attempt’s assignment.',
      deviceId: attempt.deviceId,
      ipAddress: input.ipAddress,
      traceId: input.traceId,
    });
    throw Errors.notFound('That question in your examination');
  }

  // 4a. Descriptive questions: text only, within the category's word limit.
  if (assigned.type === 'PARAGRAPH' || assigned.type === 'SHORT_TEXT') {
    if (payload.selectedOptionIds.length > 0) {
      throw Errors.validation({
        selectedOptionIds: 'This question is answered in writing and has no options.',
      });
    }
    const limit = assigned.paragraphWordLimit;
    if (limit && payload.textAnswer) {
      const words = payload.textAnswer.trim().split(/\s+/).filter(Boolean).length;
      if (words > limit) throw Errors.paragraphTooLong(words, limit);
    }
  } else {
    // 4b. Option membership — only options actually delivered for this question.
    if (payload.textAnswer && payload.textAnswer.trim().length > 0) {
      throw Errors.validation({ textAnswer: 'This question is answered by selecting an option.' });
    }
    const allowed = new Set(assigned.optionOrder);
    const invalid = payload.selectedOptionIds.filter((id) => !allowed.has(id));
    if (invalid.length > 0) {
      throw Errors.validation({
        selectedOptionIds: 'One or more selected options do not belong to this question.',
      });
    }
    if (assigned.type === 'SINGLE_CHOICE' || assigned.type === 'TRUE_FALSE') {
      if (payload.selectedOptionIds.length > 1) {
        throw Errors.validation({ selectedOptionIds: 'This question accepts a single option only.' });
      }
    }
  }

  const key = `${attempt.id}:${assigned.id}`;
  const existing = db.answers.get(key);

  // Idempotency: a replayed key returns the stored state without a second write.
  const ledgerKey = `${attempt.id}:${idempotencyKey}`;
  const replay = db.idempotency.get(ledgerKey);
  if (replay) {
    const answer = existing ?? emptyAnswer(attempt.id, assigned.id);
    db.answerEvents.push(
      event(attempt.id, assigned.id, answer.version, payload.selectedOptionIds, idempotencyKey, 'DUPLICATE_IGNORED'),
    );
    return { answer, outcome: 'DUPLICATE_IGNORED', committedAt: replay.at };
  }

  // 5. Optimistic concurrency.
  const currentVersion = existing?.version ?? 0;
  if (payload.expectedVersion !== currentVersion) {
    db.answerEvents.push(
      event(attempt.id, assigned.id, currentVersion, payload.selectedOptionIds, idempotencyKey, 'CONFLICT'),
    );
    throw Errors.answerConflict(currentVersion);
  }

  const committedAt = new Date().toISOString();
  const answer: Answer = {
    id: existing?.id ?? randomUUID(),
    attemptId: attempt.id,
    assignmentQuestionId: assigned.id,
    selectedOptionIds: payload.selectedOptionIds,
    textAnswer: payload.textAnswer,
    version: currentVersion + 1,
    flagged: payload.flagged,
    visited: true,
    updatedAt: committedAt,
    lastIdempotencyKey: idempotencyKey,
  };

  db.answers.set(key, answer);
  db.idempotency.set(ledgerKey, { at: committedAt, version: answer.version, attemptId: attempt.id });
  db.answerEvents.push(
    event(attempt.id, assigned.id, answer.version, payload.selectedOptionIds, idempotencyKey, 'COMMITTED'),
  );

  attempt.lastAnswerSavedAt = committedAt;
  const answered = [...db.answers.values()].filter(
    (a) =>
      a.attemptId === attempt.id &&
      (a.selectedOptionIds.length > 0 || (a.textAnswer ?? '').trim().length > 0),
  );
  attempt.answeredCount = answered.length;
  attempt.flaggedCount = [...db.answers.values()].filter((a) => a.attemptId === attempt.id && a.flagged).length;

  db.counters.answerWritesThisMinute += 1;

  return { answer, outcome: 'COMMITTED', committedAt };
}

/** Marks a question visited without changing the answer. */
export function markVisited(attempt: ExamAttempt, assignmentQuestionId: string): void {
  const db = getDb();
  const key = `${attempt.id}:${assignmentQuestionId}`;
  const existing = db.answers.get(key);
  if (existing) {
    existing.visited = true;
    return;
  }
  const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;
  if (!assignment?.questions.some((q) => q.id === assignmentQuestionId)) return;
  const answer = emptyAnswer(attempt.id, assignmentQuestionId);
  answer.visited = true;
  db.answers.set(key, answer);
}

function emptyAnswer(attemptId: string, assignmentQuestionId: string): Answer {
  return {
    id: randomUUID(),
    attemptId,
    assignmentQuestionId,
    selectedOptionIds: [],
    textAnswer: null,
    version: 0,
    flagged: false,
    visited: false,
    updatedAt: new Date().toISOString(),
    lastIdempotencyKey: null,
  };
}

function event(
  attemptId: string,
  assignmentQuestionId: string,
  version: number,
  selectedOptionIds: string[],
  idempotencyKey: string,
  outcome: AnswerEvent['outcome'],
): AnswerEvent {
  const at = new Date().toISOString();
  return {
    id: randomUUID(),
    attemptId,
    assignmentQuestionId,
    version,
    selectedOptionIds,
    idempotencyKey,
    receivedAt: at,
    committedAt: at,
    outcome,
  };
}
