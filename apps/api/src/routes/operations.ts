import { consumeExportGrant } from './exportVerification.js';
import type { FastifyInstance } from 'fastify';
import {
  acknowledgeFindingSchema,
  bulkAssignmentSchema,
  deviceEnrolSchema,
  deviceFingerprintSchema,
  exportRequestSchema,
  importCommitSchema,
  importValidateSchema,
  IMPORT_COLUMNS,
  MATCH_CONFIDENCE_EXPLANATION,
  releaseAssignmentSchema,
  TRACKING_CHECK_CATALOGUE,
  type ImportKind,
} from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, parse } from '../lib/http.js';
import {
  enrolDevice,
  fingerprintFromRequest,
  matchDevice,
  upsertAssignment,
} from '../services/deviceService.js';
import { acknowledgeFinding, sweepExam, trackingStatus } from '../services/trackingService.js';
import { commitImport, importTemplate, validateImport } from '../services/importService.js';
import { availableSections, buildExport } from '../services/exportService.js';

/**
 * Device identity, real-time tracking, bulk import and full export.
 */
export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------- device auto-detection --------------------- */

  /**
   * Identify the machine from what it reports about itself.
   *
   * Unauthenticated on purpose: the candidate application calls this *before*
   * sign-in so the workstation is already known when credentials are entered.
   * It reveals only which registered workstation this machine appears to be —
   * nothing about candidates, examinations or anyone else's device.
   */
  app.post('/devices/identify', async (request, reply) => {
    const context = ctx(request);
    const supplied = request.body && Object.keys(request.body).length > 0
      ? parse(deviceFingerprintSchema, request.body)
      : fingerprintFromRequest(request.headers as Record<string, string | undefined>);

    const db = getDb();
    const match = matchDevice(supplied);
    const device = match.deviceId ? db.devices.get(match.deviceId) : undefined;

    return noStore(reply).send({
      match: {
        ...match,
        confidenceExplanation: MATCH_CONFIDENCE_EXPLANATION[match.confidence],
      },
      device: device
        ? {
            deviceCode: device.deviceCode,
            name: device.name,
            status: device.status,
            centreName: db.centres.get(device.centreId)?.name ?? null,
            certificateStatus: device.certificate.status,
            kioskPolicyVersion: device.kioskPolicyVersion,
            cameraStatus: device.cameraStatus,
            fingerprintScannerStatus: device.fingerprintScannerStatus,
          }
        : null,
      client: supplied.client,
      observedAddress: context.ipAddress,
      /** Displays beyond the first are worth an invigilator's attention. */
      displayWarning:
        supplied.displayCount && supplied.displayCount > 1
          ? `${supplied.displayCount} displays are attached to this workstation. Examination policy normally allows one.`
          : null,
    });
  });

  app.post('/devices/enrol', async (request, reply) => {
    const user = requirePermission(request, 'devices.write');
    const context = ctx(request);
    const body = parse(deviceEnrolSchema, request.body);
    const db = getDb();

    const device = db.devices.get(body.deviceId);
    if (!device) throw Errors.notFound('That workstation');

    const enrolment = enrolDevice({
      deviceId: body.deviceId,
      fingerprint: body.fingerprint,
      userId: user.id,
      notes: body.notes,
    });

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'DEVICE_REGISTERED',
      targetType: 'DeviceEnrolment',
      targetId: enrolment.id,
      targetLabel: device.deviceCode,
      reason: `Hardware fingerprint recorded for auto-detection. ${body.reason}`,
      deviceId: device.id,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ enrolment });
  });

  app.get('/devices/:deviceId/enrolments', async (request, reply) => {
    requirePermission(request, 'devices.read');
    const { deviceId } = request.params as { deviceId: string };
    const db = getDb();
    const items = [...db.deviceEnrolments.values()]
      .filter((e) => e.deviceId === deviceId)
      .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
    return noStore(reply).send({ items });
  });

  /* -------------------- candidate ↔ device binding ------------------ */

  app.get('/exams/:examId/device-assignments', async (request, reply) => {
    requirePermission(request, 'devices.read');
    const { examId } = request.params as { examId: string };
    const db = getDb();

    const assignments = [...db.deviceAssignments.values()].filter((a) => a.examId === examId);
    const registrations = [...db.registrations.values()].filter((r) => r.examId === examId);
    const assignedIds = new Set(assignments.filter((a) => a.releasedAt === null).map((a) => a.candidateId));

    const unassigned = registrations
      .filter((r) => !assignedIds.has(r.candidateId))
      .map((r) => {
        const candidate = db.candidates.get(r.candidateId);
        return {
          candidateId: r.candidateId,
          applicationId: candidate?.applicationId ?? '',
          fullName: candidate?.fullName ?? '',
          seatNumber: r.seatNumber,
        };
      });

    return noStore(reply).send({
      items: assignments,
      total: assignments.length,
      unassigned,
      summary: {
        registered: registrations.length,
        assigned: assignedIds.size,
        unassigned: unassigned.length,
        released: assignments.filter((a) => a.releasedAt !== null).length,
      },
    });
  });

  app.post('/exams/:examId/device-assignments', async (request, reply) => {
    const user = requirePermission(request, 'devices.write');
    const context = ctx(request);
    const { examId } = request.params as { examId: string };
    const body = parse(bulkAssignmentSchema, { ...(request.body as object), examId });
    const db = getDb();

    if (!db.exams.get(examId)) throw Errors.notFound('That examination');

    let created = 0;
    const failures: string[] = [];

    for (const entry of body.assignments) {
      const candidate = db.candidates.get(entry.candidateId);
      if (!candidate) {
        failures.push(`Unknown candidate ${entry.candidateId}`);
        continue;
      }
      if (entry.deviceId) {
        const device = db.devices.get(entry.deviceId);
        if (!device) {
          failures.push(`Unknown workstation for ${candidate.applicationId}`);
          continue;
        }
        if (device.status !== 'APPROVED') {
          failures.push(`${device.deviceCode} is ${device.status.toLowerCase()} and cannot be assigned`);
          continue;
        }
      }
      upsertAssignment({
        examId,
        candidateId: candidate.id,
        candidateApplicationId: candidate.applicationId,
        candidateName: candidate.fullName,
        deviceId: entry.deviceId,
        seatNumber: entry.seatNumber,
        allowedCidrs: entry.allowedCidrs,
        allowAnyApprovedDevice: entry.allowAnyApprovedDevice,
      });
      created += 1;
    }

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'EXAM_UPDATED',
      targetType: 'CandidateDeviceAssignment',
      targetId: examId,
      targetLabel: `${created} seat assignment(s)`,
      result: failures.length > 0 ? 'FAILURE' : 'SUCCESS',
      reason: `${body.reason} — ${created} assigned${failures.length > 0 ? `, ${failures.length} rejected` : ''}.`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ assigned: created, failures });
  });

  app.post('/device-assignments/:assignmentId/release', async (request, reply) => {
    const user = requirePermission(request, 'invigilation.act');
    const context = ctx(request);
    const { assignmentId } = request.params as { assignmentId: string };
    const body = parse(releaseAssignmentSchema, request.body);
    const db = getDb();

    const assignment = db.deviceAssignments.get(assignmentId);
    if (!assignment) throw Errors.notFound('That seat assignment');

    assignment.releasedByUserId = user.id;
    assignment.releasedAt = new Date().toISOString();
    assignment.releaseReason = body.reason;
    assignment.updatedAt = assignment.releasedAt;

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'INVIGILATOR_ACTION',
      targetType: 'CandidateDeviceAssignment',
      targetId: assignment.id,
      targetLabel: `${assignment.candidateApplicationId} released from ${assignment.deviceCode ?? 'their seat'}`,
      reason: body.reason,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({
      assignment,
      message:
        'The candidate may now use any approved workstation at the centre. Their saved answers and question order are unchanged.',
    });
  });

  /* --------------------------- tracking ----------------------------- */

  app.get('/tracking/status', async (request, reply) => {
    requirePermission(request, 'system.health.read');
    const db = getDb();
    return noStore(reply).send({
      status: trackingStatus(),
      catalogue: TRACKING_CHECK_CATALOGUE,
      snapshots: [...db.trackingSnapshots.values()].map((s) => ({
        examId: s.examId,
        examCode: s.examCode,
        examName: s.examName,
        overall: s.overall,
        generatedAt: s.generatedAt,
        sequence: s.sequence,
        openFindings: s.openFindings.length,
      })),
    });
  });

  app.get('/tracking/exams/:examId', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const { examId } = request.params as { examId: string };
    const db = getDb();
    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');

    // Sweep on demand so the view is never stale when someone is looking at it.
    const snapshot = await sweepExam(exam);
    return noStore(reply).send({ snapshot, status: trackingStatus() });
  });

  app.get('/tracking/findings', async (request, reply) => {
    requirePermission(request, 'invigilation.read');
    const db = getDb();
    const q = (request.query ?? {}) as Record<string, string>;

    let items = [...db.trackingFindings.values()];
    if (q.examId) items = items.filter((f) => f.examId === q.examId);
    if (q.severity) items = items.filter((f) => f.severity === q.severity);
    if (q.open === 'true') items = items.filter((f) => f.resolvedAt === null);
    if (q.unacknowledged === 'true') items = items.filter((f) => f.acknowledgedAt === null);

    items.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return noStore(reply).send({ items, total: items.length });
  });

  app.post('/tracking/findings/:findingId/acknowledge', async (request, reply) => {
    const user = requirePermission(request, 'invigilation.act');
    const context = ctx(request);
    const { findingId } = request.params as { findingId: string };
    const body = parse(acknowledgeFindingSchema, request.body);

    const finding = acknowledgeFinding({
      findingId,
      userId: user.id,
      userName: user.fullName,
      role: user.roles[0] ?? 'SYSTEM',
      reason: body.reason,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });
    if (!finding) throw Errors.notFound('That tracking finding');

    return noStore(reply).send({ finding });
  });

  /* ---------------------------- import ------------------------------ */

  app.get('/import/columns', async (request, reply) => {
    requirePermission(request, 'candidates.read');
    return noStore(reply).send({ columns: IMPORT_COLUMNS });
  });

  app.get('/import/template/:kind', async (request, reply) => {
    requirePermission(request, 'candidates.read');
    const { kind } = request.params as { kind: ImportKind };
    if (!IMPORT_COLUMNS[kind]) throw Errors.notFound('That import type');
    consumeExportGrant(request, `template:${kind}`);
    return noStore(reply).send({ kind, ...importTemplate(kind), columns: IMPORT_COLUMNS[kind] });
  });

  app.post('/import/validate', async (request, reply) => {
    const user = requirePermission(request, 'candidates.write');
    const body = parse(importValidateSchema, request.body);

    // Device and network imports touch security configuration, so they need
    // the corresponding permission rather than candidate write access.
    if (body.kind === 'DEVICES' || body.kind === 'NETWORK_RANGES') {
      requirePermission(request, 'devices.write');
    }

    const validation = validateImport({
      kind: body.kind,
      fileName: body.fileName,
      rows: body.rows,
      examId: body.examId,
      userId: user.id,
    });

    return noStore(reply).send({
      validation,
      note: 'Nothing has been written. Review the report, then commit the import to apply it.',
    });
  });

  app.post('/import/commit', async (request, reply) => {
    const user = requirePermission(request, 'candidates.write');
    const context = ctx(request);
    const body = parse(importCommitSchema, request.body);

    const result = commitImport({
      token: body.token,
      reason: body.reason,
      userId: user.id,
      userName: user.fullName,
      role: user.roles[0] ?? 'SYSTEM',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ result });
  });

  /* ---------------------------- export ------------------------------ */

  app.get('/exams/:examId/export/sections', async (request, reply) => {
    const user = requirePermission(request, 'exams.read');
    return noStore(reply).send({
      sections: availableSections(user),
      formats: [
        { id: 'XLSX', label: 'Excel workbook', description: 'One sheet per section. Best for review and handover.' },
        { id: 'JSON', label: 'JSON', description: 'Machine-readable, preserves full structure.' },
        { id: 'CSV_BUNDLE', label: 'CSV files', description: 'One file per section, for import elsewhere.' },
      ],
    });
  });

  app.post('/exams/:examId/export', async (request, reply) => {
    const user = requirePermission(request, 'exams.read');
    const context = ctx(request);
    const { examId } = request.params as { examId: string };
    const body = parse(exportRequestSchema, request.body);

    consumeExportGrant(request, `exam:${examId}`);
    const payload = buildExport({
      examId,
      sections: body.sections,
      format: body.format,
      reason: body.reason,
      pseudonymise: body.pseudonymise,
      user,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send(payload);
  });

  app.get('/exams/:examId/export/history', async (request, reply) => {
    requirePermission(request, 'audit.read');
    const { examId } = request.params as { examId: string };
    const db = getDb();
    const items = [...db.exportManifests.values()]
      .filter((m) => m.examId === examId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return noStore(reply).send({ items, total: items.length });
  });
}
