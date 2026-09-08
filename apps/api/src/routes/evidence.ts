import type { FastifyInstance } from 'fastify';
import { evidenceChallengeSchema, evidenceUploadSchema } from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requireCandidate, requirePermission } from '../lib/session.js';
import { noStore, parse } from '../lib/http.js';
import { assertAttemptOwnership } from '../services/attemptService.js';
import { issueChallenge, recordEvidence } from '../services/monitoringService.js';

/**
 * Camera-presence evidence.
 *
 * Evidence is never exposed through a public URL. Objects are referenced by an
 * internal key, every read is written to an access log, and each object carries
 * a scheduled deletion date derived from the examination's retention policy.
 */
export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/evidence/challenge', async (request, reply) => {
    const user = requireCandidate(request);
    const body = parse(evidenceChallengeSchema, request.body);
    const attempt = assertAttemptOwnership(body.attemptId, user.candidateId!);
    const challenge = await issueChallenge(attempt);
    return noStore(reply).send({ challenge });
  });

  app.post('/evidence/upload-authorize', async (request, reply) => {
    const user = requireCandidate(request);
    const context = ctx(request);
    const body = parse(evidenceUploadSchema, request.body);
    const db = getDb();

    const attempt = assertAttemptOwnership(body.attemptId, user.candidateId!);
    const candidate = db.candidates.get(user.candidateId!);
    const exam = db.exams.get(attempt.examId);
    if (!candidate || !exam) throw Errors.notFound('Your examination record');

    if (!exam.securityPolicy.monitoring.cameraMonitoringEnabled) {
      throw Errors.conflict(
        'Camera monitoring is not enabled for this examination.',
        'No evidence is collected. Nothing further is required.',
      );
    }

    const outcome = await recordEvidence({
      attempt,
      candidate,
      exam,
      challengeId: body.challengeId,
      sequence: body.sequence,
      capturedAt: body.capturedAt,
      previousEvidenceHash: body.previousEvidenceHash,
      result: body.simulatedResult,
      imageBytes: body.imageBytes,
      deviceCode: body.deviceCode,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({
      acknowledged: true,
      evidenceId: outcome.evidence.id,
      evidenceHash: outcome.event.evidenceHash,
      uploadState: outcome.evidence.uploadState,
      retentionUntil: outcome.evidence.retentionUntil,
      result: outcome.event.result,
      severity: outcome.event.severity,
      consecutiveFailures: outcome.consecutiveFailures,
      response: outcome.response,
      restricted: outcome.restricted,
      message: outcome.message,
      invigilatorNotified: outcome.invigilatorNotified,
      answersSafe: true,
      attemptStatus: attempt.status,
      simulated: true,
      simulationNote:
        'POC simulation — the presence verdict is produced by a mock analyser on the workstation. A production system evaluates frames server-side with a validated vision service.',
    });
  });

  /** Privacy and evidence-management view. Authorised staff only. */
  app.get('/evidence/summary', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const db = getDb();
    const objects = [...db.evidenceObjects.values()];
    const soonest = objects
      .map((o) => o.retentionUntil)
      .sort()
      .at(0);

    return noStore(reply).send({
      purpose:
        'Confirming that the registered candidate is present, alone and at an approved workstation for the duration of the examination.',
      collected: [
        'Low-resolution still images captured at the configured interval',
        'Capture time, sequence number and server-issued challenge identifier',
        'Workstation identifier and attempt identifier',
        'The analyser verdict for each capture',
      ],
      notCollected: [
        'Audio',
        'Screen contents',
        'Keystrokes',
        'Any inference about race, emotion, age, gender or other sensitive attributes',
      ],
      objectCount: objects.length,
      totalBytes: objects.reduce((s, o) => s + o.sizeBytes, 0),
      nextScheduledDeletion: soonest ?? null,
      authorisedReviewerRoles: ['INVIGILATOR', 'SECURITY_ADMIN', 'SUPER_ADMIN'],
      accessHistory: objects
        .flatMap((o) => o.accessLog.map((a) => ({ ...a, objectKey: o.objectKey })))
        .slice(-50),
      appealProcess:
        'A candidate may request a review of any monitoring decision within 30 days. The review is carried out by the examination controller, who can see the same evidence and the full audit timeline.',
      modelTrainingUse: 'Evidence is never used to train or evaluate any model.',
      publicUrls: 'Evidence objects are not reachable through any public URL.',
    });
  });
}
