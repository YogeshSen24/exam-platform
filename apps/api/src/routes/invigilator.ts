import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { invigilatorActionSchema, type ExamAttempt } from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, paginate, parse, readPageParams } from '../lib/http.js';
import { remainingSeconds } from '../services/attemptService.js';

/**
 * Live invigilation.
 *
 * Invigilators see session state, identity events and device health — never
 * question content. Every sensitive action requires a reason and writes an
 * audit event.
 */
export async function invigilatorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/invigilator/summary', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const db = getDb();
    const q = (request.query ?? {}) as { examId?: string };
    const examId = q.examId ?? [...db.exams.values()].find((e) => e.status === 'IN_PROGRESS')?.id;
    if (!examId) throw Errors.notFound('An examination in progress');

    const registrations = [...db.registrations.values()].filter((r) => r.examId === examId);
    const attempts = [...db.attempts.values()].filter((a) => a.examId === examId);
    const byStatus = (status: ExamAttempt['status']) => attempts.filter((a) => a.status === status).length;

    const exam = db.exams.get(examId);
    return noStore(reply).send({
      exam: exam
        ? {
            id: exam.id,
            name: exam.name,
            code: exam.code,
            startsAt: exam.startsAt,
            durationMinutes: exam.durationMinutes,
            centreName: db.centres.get(exam.centreId)?.name ?? 'Unknown',
            securityProfileId: exam.securityPolicy.profileId,
          }
        : null,
      totals: {
        candidates: registrations.length,
        notStarted: registrations.length - attempts.length,
        verifying: byStatus('VERIFYING'),
        active: byStatus('ACTIVE'),
        restricted: byStatus('RESTRICTED'),
        requiresReview: byStatus('AWAITING_REVERIFICATION'),
        disconnected: byStatus('DISCONNECTED'),
        submitted: byStatus('SUBMITTED'),
      },
      openIncidents: [...db.incidents.values()].filter((i) => i.status !== 'RESOLVED').length,
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/invigilator/sessions', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const db = getDb();
    const q = (request.query ?? {}) as Record<string, string>;
    const { page, pageSize } = readPageParams(q);
    const examId = q.examId ?? [...db.exams.values()].find((e) => e.status === 'IN_PROGRESS')?.id;

    let rows = [...db.attempts.values()]
      .filter((a) => !examId || a.examId === examId)
      .map((attempt) => {
        const candidate = db.candidates.get(attempt.candidateId);
        const device = db.devices.get(attempt.deviceId);
        return {
          attemptId: attempt.id,
          candidateName: candidate?.fullName ?? 'Unknown',
          candidateId: candidate?.candidateId ?? '—',
          applicationId: candidate?.applicationId ?? '—',
          photoSeed: candidate?.photoSeed ?? '',
          workstation: device?.deviceCode ?? 'unregistered',
          status: attempt.status,
          identityStatus: attempt.identityStatus,
          lastAnswerSavedAt: attempt.lastAnswerSavedAt,
          connectionStatus: attempt.connectionStatus,
          remainingSeconds: remainingSeconds(attempt),
          alertLevel: attempt.alertLevel,
          answeredCount: attempt.answeredCount,
          consecutiveMonitoringFailures: attempt.consecutiveMonitoringFailures,
          restrictionReason: attempt.restrictionReason ?? null,
        };
      });

    if (q.status) rows = rows.filter((r) => r.status === q.status);
    if (q.alertLevel) rows = rows.filter((r) => r.alertLevel === q.alertLevel);
    if (q.search) {
      const needle = q.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.candidateName.toLowerCase().includes(needle) ||
          r.applicationId.toLowerCase().includes(needle) ||
          r.workstation.toLowerCase().includes(needle),
      );
    }

    const severity = { CRITICAL: 0, WARNING: 1, INFO: 2, NONE: 3 } as const;
    rows.sort((a, b) => severity[a.alertLevel] - severity[b.alertLevel] || a.candidateName.localeCompare(b.candidateName));

    return noStore(reply).send(paginate(rows, page, pageSize));
  });

  app.get('/invigilator/sessions/:attemptId', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const db = getDb();
    const { attemptId } = request.params as { attemptId: string };
    const attempt = db.attempts.get(attemptId);
    if (!attempt) throw Errors.notFound('That candidate session');

    const candidate = db.candidates.get(attempt.candidateId);
    const device = db.devices.get(attempt.deviceId);
    const exam = db.exams.get(attempt.examId);
    const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;

    return noStore(reply).send({
      attempt: { ...attempt, remainingSeconds: remainingSeconds(attempt) },
      candidate: candidate
        ? {
            id: candidate.id,
            candidateId: candidate.candidateId,
            applicationId: candidate.applicationId,
            fullName: candidate.fullName,
            photoSeed: candidate.photoSeed,
            accommodations: candidate.accommodations,
            fingerprintEnrolled: candidate.fingerprintEnrolled,
            faceEnrolled: candidate.faceEnrolled,
            eligibility: candidate.eligibility,
            lastVerificationEvent: candidate.lastVerificationEvent ?? null,
          }
        : null,
      device: device
        ? {
            deviceCode: device.deviceCode,
            name: device.name,
            operatingSystem: device.operatingSystem,
            certificate: device.certificate,
            kioskPolicyVersion: device.kioskPolicyVersion,
            cameraStatus: device.cameraStatus,
            fingerprintScannerStatus: device.fingerprintScannerStatus,
            networkStatus: device.networkStatus,
            ipAddress: device.ipAddress,
          }
        : null,
      exam: exam ? { id: exam.id, name: exam.name, code: exam.code, navigationMode: exam.navigationMode } : null,
      // Progress only — question content is deliberately not returned.
      progress: {
        totalQuestions: assignment?.questions.length ?? 0,
        answered: attempt.answeredCount,
        flagged: attempt.flaggedCount,
        lastAnswerSavedAt: attempt.lastAnswerSavedAt,
      },
      cameraEvents: db.proctoringEvents
        .filter((e) => e.attemptId === attempt.id)
        .slice(-25)
        .reverse(),
      incidents: [...db.incidents.values()].filter((i) => i.attemptId === attempt.id),
      auditTimeline: db.auditEvents
        .filter((e) => e.targetId === attempt.id || e.actorId === attempt.candidateId)
        .slice(-40)
        .reverse(),
      questionContentVisible: false,
      note: 'Invigilators can see session state, identity events and device health. Question content is not available in this view.',
    });
  });

  app.get('/invigilator/alerts', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const db = getDb();
    const q = (request.query ?? {}) as Record<string, string>;

    let items = [...db.incidents.values()].map((incident) => ({
      ...incident,
      candidateName: incident.candidateId ? (db.candidates.get(incident.candidateId)?.fullName ?? null) : null,
      applicationId: incident.candidateId ? (db.candidates.get(incident.candidateId)?.applicationId ?? null) : null,
      centreName: incident.centreId ? (db.centres.get(incident.centreId)?.name ?? null) : null,
      deviceCode: incident.deviceId ? (db.devices.get(incident.deviceId)?.deviceCode ?? null) : null,
    }));

    if (q.severity) items = items.filter((i) => i.severity === q.severity);
    if (q.status) items = items.filter((i) => i.status === q.status);
    if (q.type) items = items.filter((i) => i.type === q.type);
    if (q.centreId) items = items.filter((i) => i.centreId === q.centreId);
    if (q.candidateId) items = items.filter((i) => i.candidateId === q.candidateId);

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const { page, pageSize } = readPageParams(q);
    return noStore(reply).send(paginate(items, page, pageSize));
  });

  app.get('/incidents/:incidentId', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const db = getDb();
    const { incidentId } = request.params as { incidentId: string };
    const incident = db.incidents.get(incidentId);
    if (!incident) throw Errors.notFound('That incident');
    return noStore(reply).send({
      incident,
      candidate: incident.candidateId ? (db.candidates.get(incident.candidateId) ?? null) : null,
      attempt: incident.attemptId ? (db.attempts.get(incident.attemptId) ?? null) : null,
      device: incident.deviceId ? (db.devices.get(incident.deviceId) ?? null) : null,
      relatedAudit: db.auditEvents.filter((e) => e.targetId === (incident.attemptId ?? incident.id)).slice(-20).reverse(),
    });
  });

  app.post('/invigilator/actions', async (request, reply) => {
    const user = requirePermission(request, 'invigilation.act');
    const context = ctx(request);
    const body = parse(invigilatorActionSchema, request.body);
    const db = getDb();

    const attempt = db.attempts.get(body.attemptId);
    if (!attempt) throw Errors.notFound('That candidate session');
    const candidate = db.candidates.get(attempt.candidateId);

    // Invigilators must never be able to publish an examination; the permission
    // model excludes it and this route only touches session state.
    let outcome = '';
    switch (body.action) {
      case 'REQUEST_REVERIFICATION':
        attempt.status = 'AWAITING_REVERIFICATION';
        attempt.reverificationRequestedAt = new Date().toISOString();
        attempt.alertLevel = 'WARNING';
        outcome = 'The candidate has been asked to reverify. Answers are unaffected.';
        break;
      case 'APPROVE_RECOVERY':
        attempt.status = 'ACTIVE';
        attempt.identityStatus = 'VERIFIED';
        attempt.alertLevel = 'NONE';
        attempt.restrictionReason = null;
        attempt.consecutiveMonitoringFailures = 0;
        attempt.connectionStatus = 'ONLINE';
        attempt.reverificationRequestedAt = null;
        outcome = 'Session released. The candidate resumed the same stored question sequence.';
        break;
      case 'EXTEND_TIME': {
        const minutes = body.extraMinutes ?? 5;
        attempt.additionalTimeMinutes += minutes;
        if (attempt.expiresAt) {
          attempt.expiresAt = new Date(new Date(attempt.expiresAt).getTime() + minutes * 60_000).toISOString();
        }
        outcome = `${minutes} minute(s) of additional time granted.`;
        break;
      }
      case 'RESTRICT_SESSION':
        attempt.status = 'RESTRICTED';
        attempt.alertLevel = 'CRITICAL';
        attempt.restrictionReason = body.reason;
        outcome = 'Navigation restricted. No answers were discarded.';
        break;
      case 'RELEASE_RESTRICTION':
        attempt.status = 'ACTIVE';
        attempt.restrictionReason = null;
        attempt.alertLevel = 'NONE';
        outcome = 'Restriction lifted. The examination resumed.';
        break;
      case 'ESCALATE': {
        const id = randomUUID();
        db.incidents.set(id, {
          id,
          type: 'REPEATED_FACE_ABSENCE',
          severity: 'CRITICAL',
          examId: attempt.examId,
          centreId: db.exams.get(attempt.examId)?.centreId ?? null,
          candidateId: attempt.candidateId,
          attemptId: attempt.id,
          deviceId: attempt.deviceId,
          title: 'Escalated to the examination controller',
          detail: body.reason,
          status: 'OPEN',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          assignedToUserId: null,
          notes: [],
        });
        outcome = 'Escalated to the examination controller.';
        break;
      }
      case 'ADD_NOTE': {
        const incident = [...db.incidents.values()].find((i) => i.attemptId === attempt.id);
        const note = {
          id: randomUUID(),
          authorUserId: user.id,
          authorName: user.fullName,
          body: body.note ?? body.reason,
          createdAt: new Date().toISOString(),
        };
        if (incident) {
          incident.notes.push(note);
          incident.updatedAt = note.createdAt;
        } else {
          const id = randomUUID();
          db.incidents.set(id, {
            id,
            type: 'REPEATED_FACE_ABSENCE',
            severity: 'INFO',
            examId: attempt.examId,
            centreId: db.exams.get(attempt.examId)?.centreId ?? null,
            candidateId: attempt.candidateId,
            attemptId: attempt.id,
            deviceId: attempt.deviceId,
            title: 'Invigilator note',
            detail: body.note ?? body.reason,
            status: 'ACKNOWLEDGED',
            createdAt: note.createdAt,
            updatedAt: note.createdAt,
            assignedToUserId: user.id,
            notes: [note],
          });
        }
        outcome = 'Note recorded against the session.';
        break;
      }
    }

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'INVIGILATOR',
      action: body.action === 'EXTEND_TIME' ? 'TIME_EXTENDED' : 'INVIGILATOR_ACTION',
      targetType: 'ExamAttempt',
      targetId: attempt.id,
      targetLabel: candidate ? `${candidate.fullName} (${candidate.applicationId})` : attempt.id,
      reason: `${body.action}: ${body.reason}`,
      deviceId: attempt.deviceId,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ attempt: { ...attempt, remainingSeconds: remainingSeconds(attempt) }, outcome });
  });
}
