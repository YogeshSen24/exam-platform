import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  activateAttemptSchema,
  deviceFingerprintSchema,
  enabledVerificationSteps,
  effectiveControls,
  profileFlags,
  saveAnswerSchema,
  SECURITY_PROFILE_DEFINITIONS,
  submitAttemptSchema,
} from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requireCandidate } from '../lib/session.js';
import { idempotencyKey, noStore, parse } from '../lib/http.js';
import {
  activateAttempt,
  assertAttemptAnswerable,
  assertAttemptOwnership,
  attemptSummary,
  buildNavigator,
  deliverQuestion,
  remainingSeconds,
  runPreflight,
  submitAttempt,
} from '../services/attemptService.js';
import { markVisited, saveAnswer } from '../services/answerService.js';
import { recordAudit } from '../lib/audit.js';
import { assignmentFor, fingerprintFromRequest, matchDevice } from '../services/deviceService.js';
import type { DeviceFingerprint, ExaminationDevice } from '@sep/shared';

/**
 * Resolves which workstation this request is coming from.
 *
 * Auto-detection first, because a machine identifying itself from its own
 * hardware is more trustworthy than a code a candidate typed. The supplied code
 * is only a fallback for a browser that cannot identify itself.
 */
function resolveDevice(
  request: Parameters<typeof ctx>[0],
  suppliedFingerprint: DeviceFingerprint | undefined,
  suppliedCode: string | undefined,
  autoDetect: boolean,
): { device: ExaminationDevice | undefined; fingerprint: DeviceFingerprint; deviceCode: string; detected: boolean } {
  const db = getDb();
  const context = ctx(request);
  const fingerprint =
    suppliedFingerprint ?? fingerprintFromRequest(request.headers as Record<string, string | undefined>);

  if (autoDetect) {
    const match = matchDevice(fingerprint);
    if (match.matched && match.deviceId) {
      const device = db.devices.get(match.deviceId);
      if (device) {
        return { device, fingerprint, deviceCode: device.deviceCode, detected: true };
      }
    }
  }

  const code = suppliedCode ?? context.deviceCode ?? '';
  const device = code ? [...db.devices.values()].find((d) => d.deviceCode === code) : undefined;
  return { device, fingerprint, deviceCode: code, detected: false };
}

/**
 * Candidate examination endpoints.
 *
 * Everything here derives the candidate from the authenticated session. A
 * candidate id, attempt id or remaining time supplied by the client is never
 * trusted for authorisation.
 */
export async function attemptRoutes(app: FastifyInstance): Promise<void> {
  /** Everything the candidate application needs before starting. */
  app.get('/attempts/context', async (request, reply) => {
    const user = requireCandidate(request);
    const context = ctx(request);
    const db = getDb();
    const candidate = db.candidates.get(user.candidateId!);
    if (!candidate) throw Errors.notFound('Your candidate record');
    const exam = candidate.examId ? db.exams.get(candidate.examId) : undefined;
    if (!exam) throw Errors.notFound('Your assigned examination');

    const attempt = [...db.attempts.values()].find(
      (a) => a.candidateId === candidate.id && a.examId === exam.id,
    );
    const resolved = resolveDevice(
      request,
      undefined,
      context.deviceCode ?? undefined,
      exam.securityPolicy.verification.autoDetectDevice,
    );
    const device = resolved.device;

    return noStore(reply).send({
      candidate: {
        id: candidate.id,
        candidateId: candidate.candidateId,
        applicationId: candidate.applicationId,
        fullName: candidate.fullName,
        photoSeed: candidate.photoSeed,
        fingerprintEnrolled: candidate.fingerprintEnrolled,
        faceEnrolled: candidate.faceEnrolled,
        accommodations: candidate.accommodations,
      },
      exam: {
        id: exam.id,
        name: exam.name,
        code: exam.code,
        durationMinutes: exam.durationMinutes,
        totalQuestions: exam.blueprint.totalQuestions,
        totalMarks: exam.blueprint.totalMarks,
        navigationMode: exam.navigationMode,
        negativeMarking: exam.blueprint.negativeMarking,
        negativeMarkValue: exam.blueprint.negativeMarkValue,
        startsAt: exam.startsAt,
        status: exam.status,
      },
      centre: db.centres.get(exam.centreId) ?? null,
      workstation: device
        ? {
            deviceCode: device.deviceCode,
            name: device.name,
            status: device.status,
            certificateStatus: device.certificate.status,
            cameraStatus: device.cameraStatus,
            fingerprintScannerStatus: device.fingerprintScannerStatus,
            networkStatus: device.networkStatus,
            autoDetected: resolved.detected,
          }
        : { deviceCode: resolved.deviceCode || 'unknown', status: 'UNREGISTERED', autoDetected: false },
      verification: exam.securityPolicy.verification,
      /** The steps this examination will actually ask the candidate for. */
      verificationSteps: enabledVerificationSteps(exam.securityPolicy.verification),
      seatAssignment: assignmentFor(exam.id, candidate.id),
      securityProfile: SECURITY_PROFILE_DEFINITIONS[exam.securityPolicy.profileId],
      controls: effectiveControls(exam.securityPolicy.profileId),
      flags: { ...profileFlags(exam.securityPolicy.profileId),
        fingerprintVerification: !exam.securityPolicy.verification.fingerprint.enabled || (!candidate.fingerprintEnrolled && exam.securityPolicy.verification.fingerprint.skipIfNotEnrolled)
          ? 'off' : exam.securityPolicy.verification.fingerprint.requirement === 'REQUIRED' ? 'required' : 'optional',
        requireFaceVerificationAtLogin: exam.securityPolicy.verification.face.enabled && (candidate.faceEnrolled || !exam.securityPolicy.verification.face.skipIfNotEnrolled),
      },
      monitoring: exam.securityPolicy.monitoring,
      network: { clientAddress: context.ipAddress, approvedRange: exam.securityPolicy.network.primaryCidr },
      attempt: attempt
        ? { ...attempt, remainingSeconds: remainingSeconds(attempt) }
        : null,
      serverTime: new Date().toISOString(),
    });
  });

  /** Runs the verification sequence without creating an attempt. */
  app.post('/attempts/preflight', async (request, reply) => {
    const user = requireCandidate(request);
    const context = ctx(request);
    const body = parse(
      z.object({
        deviceCode: z.string().max(32).optional(),
        fingerprint: deviceFingerprintSchema.optional(),
        verification: z.object({
          fingerprint: z.enum(['PASSED', 'SKIPPED', 'OVERRIDDEN', 'FAILED']).default('SKIPPED'),
          face: z.enum(['PASSED', 'SKIPPED', 'OVERRIDDEN', 'FAILED']).default('SKIPPED'),
        }),
      }),
      request.body,
    );
    const db = getDb();
    const candidate = db.candidates.get(user.candidateId!);
    if (!candidate) throw Errors.notFound('Your candidate record');
    const exam = candidate.examId ? db.exams.get(candidate.examId) : undefined;
    if (!exam) throw Errors.notFound('Your assigned examination');

    const resolved = resolveDevice(
      request,
      body.fingerprint,
      body.deviceCode,
      exam.securityPolicy.verification.autoDetectDevice,
    );

    const checks = await runPreflight({
      candidate,
      exam,
      device: resolved.device,
      fingerprint: resolved.fingerprint,
      deviceCode: resolved.deviceCode,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
      verification: body.verification,
    });

    recordAudit({
      actorId: candidate.id,
      actorName: candidate.fullName,
      actorRole: 'CANDIDATE',
      action: 'CANDIDATE_VERIFICATION',
      targetType: 'Candidate',
      targetId: candidate.id,
      targetLabel: candidate.applicationId,
      result: checks.some((c) => c.status === 'FAILED') ? 'FAILURE' : 'SUCCESS',
      reason: checks.map((c) => `${c.label}: ${c.status}`).join('; '),
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({
      checks,
      workstation: resolved.device
        ? { deviceCode: resolved.device.deviceCode, name: resolved.device.name, autoDetected: resolved.detected }
        : null,
    });
  });

  app.post('/attempts/activate', async (request, reply) => {
    const user = requireCandidate(request);
    const context = ctx(request);
    const body = parse(activateAttemptSchema, request.body);
    const db = getDb();

    const candidate = db.candidates.get(user.candidateId!);
    if (!candidate) throw Errors.notFound('Your candidate record');
    const exam = db.exams.get(body.examId);
    if (!exam) throw Errors.notFound('That examination');
    // Eligibility comes from the server record, not the request body.
    if (candidate.examId !== exam.id) throw Errors.forbidden('this examination');

    const resolved = resolveDevice(
      request,
      body.fingerprint,
      body.deviceCode,
      exam.securityPolicy.verification.autoDetectDevice,
    );

    const result = await activateAttempt({
      candidate,
      exam,
      device: resolved.device,
      fingerprint: resolved.fingerprint,
      deviceCode: resolved.deviceCode,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
      verification: body.verification,
    });

    return noStore(reply).status(201).send({
      attempt: { ...result.attempt, remainingSeconds: remainingSeconds(result.attempt) },
      summary: attemptSummary(result.attempt),
      navigator: buildNavigator(result.attempt),
      checks: result.checks,
    });
  });

  app.get('/attempts/:attemptId', async (request, reply) => {
    const user = requireCandidate(request);
    const { attemptId } = request.params as { attemptId: string };
    const attempt = assertAttemptOwnership(attemptId, user.candidateId!);
    const db = getDb();
    const exam = db.exams.get(attempt.examId);

    return noStore(reply).send({
      attempt: { ...attempt, remainingSeconds: remainingSeconds(attempt) },
      summary: attemptSummary(attempt),
      navigator: buildNavigator(attempt),
      monitoring: exam?.securityPolicy.monitoring ?? null,
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/attempts/:attemptId/question/:sequence', async (request, reply) => {
    const user = requireCandidate(request);
    const { attemptId, sequence } = request.params as { attemptId: string; sequence: string };
    const attempt = assertAttemptOwnership(attemptId, user.candidateId!);

    if (attempt.status === 'RESTRICTED') {
      throw Errors.conflict(
        'Question navigation is paused while your identity is confirmed.',
        'Every answer you have already given is saved on the server and will not be lost. Follow the on-screen verification steps; an invigilator has been notified.',
      );
    }
    if (attempt.status === 'SUBMITTED') throw Errors.attemptFinalised();

    const seq = Number(sequence);
    if (!Number.isInteger(seq) || seq < 1) throw Errors.validation({ sequence: 'Invalid question number.' });

    const db = getDb();
    const exam = db.exams.get(attempt.examId);
    // Sequential navigation is enforced server-side, not only in the UI.
    if (exam?.navigationMode === 'SEQUENTIAL') {
      const navigator = buildNavigator(attempt);
      const furthest = navigator.reduce((max, n) => (n.state !== 'NOT_VISITED' ? Math.max(max, n.sequence) : max), 0);
      if (seq < furthest) {
        throw Errors.conflict(
          'This examination uses sequential navigation.',
          'You cannot return to an earlier question. Your saved answers are unaffected.',
        );
      }
    }

    const question = deliverQuestion(attempt, seq);
    markVisited(attempt, question.assignmentQuestionId);

    return noStore(reply).send({
      question,
      navigator: buildNavigator(attempt),
      summary: attemptSummary(attempt),
      remainingSeconds: remainingSeconds(attempt),
      serverTime: new Date().toISOString(),
    });
  });

  app.put('/attempts/:attemptId/answers/:assignmentQuestionId', async (request, reply) => {
    const user = requireCandidate(request);
    const context = ctx(request);
    const { attemptId, assignmentQuestionId } = request.params as {
      attemptId: string;
      assignmentQuestionId: string;
    };
    const key = idempotencyKey(request);
    const payload = parse(saveAnswerSchema, request.body);

    const attempt = assertAttemptOwnership(attemptId, user.candidateId!);
    const db = getDb();
    const candidate = db.candidates.get(user.candidateId!);
    if (!candidate) throw Errors.notFound('Your candidate record');

    const result = saveAnswer({
      attempt,
      candidate,
      assignmentQuestionId,
      payload,
      idempotencyKey: key,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    // Server acknowledgement is only sent after the record is committed.
    return noStore(reply).send({
      answer: {
        assignmentQuestionId: result.answer.assignmentQuestionId,
        selectedOptionIds: result.answer.selectedOptionIds,
        textAnswer: result.answer.textAnswer,
        version: result.answer.version,
        flagged: result.answer.flagged,
      },
      outcome: result.outcome,
      committedAt: result.committedAt,
      summary: attemptSummary(attempt),
      navigator: buildNavigator(attempt),
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/attempts/:attemptId/review', async (request, reply) => {
    const user = requireCandidate(request);
    const { attemptId } = request.params as { attemptId: string };
    const attempt = assertAttemptOwnership(attemptId, user.candidateId!);
    assertAttemptAnswerable(attempt);
    return noStore(reply).send({
      summary: attemptSummary(attempt),
      navigator: buildNavigator(attempt),
      remainingSeconds: remainingSeconds(attempt),
    });
  });

  app.post('/attempts/:attemptId/submit', async (request, reply) => {
    const user = requireCandidate(request);
    const context = ctx(request);
    const { attemptId } = request.params as { attemptId: string };
    parse(submitAttemptSchema, request.body);

    const attempt = assertAttemptOwnership(attemptId, user.candidateId!);
    if (attempt.status === 'SUBMITTED') throw Errors.attemptFinalised();

    const db = getDb();
    const candidate = db.candidates.get(user.candidateId!)!;
    const exam = db.exams.get(attempt.examId);
    if (!exam) throw Errors.notFound('That examination');
    const device = db.devices.get(attempt.deviceId);

    const receipt = await submitAttempt(attempt, candidate, exam, device, {
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ receipt, attempt });
  });

  app.get('/attempts/:attemptId/receipt', async (request, reply) => {
    const user = requireCandidate(request);
    const { attemptId } = request.params as { attemptId: string };
    const attempt = assertAttemptOwnership(attemptId, user.candidateId!);
    const db = getDb();
    const receipt = [...db.receipts.values()].find((r) => r.attemptId === attempt.id);
    if (!receipt) throw Errors.notFound('A submission receipt for this attempt');
    return noStore(reply).send({ receipt });
  });

  /** Candidate-initiated reverification after a monitoring restriction. */
  app.post('/attempts/:attemptId/reverify', async (request, reply) => {
    const user = requireCandidate(request);
    const context = ctx(request);
    const { attemptId } = request.params as { attemptId: string };
    const body = parse(
      z.object({ result: z.enum(['PASSED', 'FAILED']), method: z.enum(['FACE', 'FINGERPRINT', 'LIVENESS']) }),
      request.body,
    );
    const attempt = assertAttemptOwnership(attemptId, user.candidateId!);
    const db = getDb();
    const candidate = db.candidates.get(user.candidateId!)!;
    const exam = db.exams.get(attempt.examId);
    const mode = exam?.securityPolicy.monitoring.reverificationMode ?? 'INVIGILATOR_APPROVED';

    if (body.result === 'PASSED') {
      attempt.consecutiveMonitoringFailures = 0;
      if (mode === 'AUTOMATIC') {
        attempt.status = 'ACTIVE';
        attempt.identityStatus = 'VERIFIED';
        attempt.alertLevel = 'NONE';
        attempt.restrictionReason = null;
      } else {
        attempt.status = 'AWAITING_REVERIFICATION';
        attempt.identityStatus = 'WARNING';
      }
    } else {
      attempt.status = 'AWAITING_REVERIFICATION';
      attempt.identityStatus = 'FAILED';
      attempt.alertLevel = 'CRITICAL';
    }

    recordAudit({
      actorId: candidate.id,
      actorName: candidate.fullName,
      actorRole: 'CANDIDATE',
      action: 'CANDIDATE_VERIFICATION',
      targetType: 'ExamAttempt',
      targetId: attempt.id,
      targetLabel: candidate.applicationId,
      result: body.result === 'PASSED' ? 'SUCCESS' : 'FAILURE',
      reason: `Reverification by ${body.method.toLowerCase()} returned ${body.result}. POC biometric simulation. Mode: ${mode}.`,
      deviceId: attempt.deviceId,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({
      attempt,
      awaitingInvigilator: attempt.status === 'AWAITING_REVERIFICATION',
      message:
        attempt.status === 'ACTIVE'
          ? 'Identity confirmed. Your examination has resumed and no answers were affected.'
          : 'Your check has been recorded. An invigilator will confirm and release your session. Your answers are safe.',
    });
  });
}
