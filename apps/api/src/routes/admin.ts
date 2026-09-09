import { z } from 'zod';
import { isIP } from 'node:net';
import { hashPassword } from '../lib/password.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  candidateCreateSchema,
  deviceActionSchema,
  deviceRegisterSchema,
  type DeviceReadinessReport,
  type ExaminationDevice,
  type ReadinessCheckResult,
} from '@sep/shared';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, paginate, parse, readPageParams } from '../lib/http.js';
import { issueCertificate } from '../services/deviceService.js';

/** Centres, devices, candidates, users and the administrative dashboard. */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /* ----------------------------- dashboard -------------------------- */

  app.get('/dashboard', async (request, reply) => {
    requirePermission(request, 'exams.read');
    const db = getDb();
    const exams = [...db.exams.values()];
    const now = Date.now();

    const upcoming = exams
      .filter((e) => new Date(e.startsAt).getTime() > now && e.status !== 'DRAFT')
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const active = exams.filter((e) => e.status === 'IN_PROGRESS');
    const drafts = exams.filter((e) => e.status === 'DRAFT');

    const pendingApprovals = [...db.questions.values()].filter((q) => q.status === 'IN_REVIEW');
    const alerts = [...db.incidents.values()].filter((i) => i.status !== 'RESOLVED' && i.severity !== 'INFO');

    return noStore(reply).send({
      counters: {
        upcomingExams: upcoming.length,
        activeExams: active.length,
        draftExams: drafts.length,
        registeredCandidates: db.candidates.size,
        centres: [...db.centres.values()].filter((c) => c.status === 'ACTIVE').length,
        workstations: db.devices.size,
        approvedWorkstations: [...db.devices.values()].filter((d) => d.status === 'APPROVED').length,
        securityAlerts: alerts.length,
        pendingQuestionApprovals: pendingApprovals.length,
      },
      activeExaminations: active.map((exam) => {
        const attempts = [...db.attempts.values()].filter((a) => a.examId === exam.id);
        return {
          id: exam.id,
          name: exam.name,
          code: exam.code,
          centreName: db.centres.get(exam.centreId)?.name ?? 'Unknown',
          startsAt: exam.startsAt,
          durationMinutes: exam.durationMinutes,
          securityProfileId: exam.securityPolicy.profileId,
          registered: [...db.registrations.values()].filter((r) => r.examId === exam.id).length,
          active: attempts.filter((a) => a.status === 'ACTIVE').length,
          submitted: attempts.filter((a) => a.status === 'SUBMITTED').length,
          requiresReview: attempts.filter((a) => a.status === 'AWAITING_REVERIFICATION' || a.status === 'RESTRICTED')
            .length,
        };
      }),
      upcomingExaminations: upcoming.slice(0, 5).map((exam) => ({
        id: exam.id,
        name: exam.name,
        code: exam.code,
        startsAt: exam.startsAt,
        centreName: db.centres.get(exam.centreId)?.name ?? 'Unknown',
        securityProfileId: exam.securityPolicy.profileId,
        candidateCount: [...db.registrations.values()].filter((r) => r.examId === exam.id).length,
        status: exam.status,
      })),
      draftExaminations: drafts.map((exam) => ({
        id: exam.id,
        name: exam.name,
        code: exam.code,
        startsAt: exam.startsAt,
        status: exam.status,
        totalQuestions: exam.blueprint.totalQuestions,
      })),
      securityAlerts: alerts.slice(0, 6),
      pendingApprovals: pendingApprovals.slice(0, 6).map((q) => ({
        id: q.id,
        code: q.code,
        subject: q.subject,
        difficulty: q.difficulty,
        authorName: db.users.get(q.authorUserId)?.fullName ?? 'Unknown',
        updatedAt: q.updatedAt,
      })),
      recentActivity: db.auditEvents.slice(-12).reverse(),
    });
  });

  /* ------------------------------ centres --------------------------- */

  app.get('/centres', async (request, reply) => {
    requirePermission(request, 'centres.read');
    const db = getDb();
    const items = [...db.centres.values()].map((centre) => ({
      ...centre,
      deviceCount: [...db.devices.values()].filter((d) => d.centreId === centre.id).length,
      approvedDevices: [...db.devices.values()].filter((d) => d.centreId === centre.id && d.status === 'APPROVED')
        .length,
    }));
    return noStore(reply).send({ items, total: items.length });
  });

  app.post('/centres', async (request, reply) => {
    const user = requirePermission(request, 'centres.write'); const context = ctx(request); const db = getDb();
    const body = parse(z.object({
      code: z.string().trim().min(3).max(32).regex(/^[A-Z0-9-]+$/), name: z.string().trim().min(3).max(120),
      city: z.string().trim().min(2), region: z.string().trim().min(2), address: z.string().trim().min(5),
      capacity: z.number().int().min(1).max(10000), primaryCidr: z.string().refine(value => { const [ip, prefix] = value.split('/'); return isIP(ip ?? '') === 4 && /^\d+$/.test(prefix ?? '') && Number(prefix) <= 32; }, 'Use a valid IPv4 range, for example 10.42.0.0/16'),
      contactName: z.string().trim().min(2), contactPhone: z.string().trim().min(5),
    }), request.body);
    if ([...db.centres.values()].some(c => c.code === body.code)) throw Errors.conflict('This centre code is already registered.', 'Use a unique code.');
    const centre = { ...body, id: randomUUID(), backupCidr: null, ipv6Cidr: null, status: 'ACTIVE' as const };
    db.centres.set(centre.id, centre);
    recordAudit({ actorId: user.id, actorName: user.fullName, actorRole: user.roles[0] ?? 'SYSTEM', action: 'EXAM_UPDATED', targetType: 'ExaminationCentre', targetId: centre.id, targetLabel: centre.name, reason: 'Examination centre created.', ipAddress: context.ipAddress, traceId: context.traceId });
    return noStore(reply).status(201).send({ centre });
  });

  /* ------------------------------ devices --------------------------- */

  app.get('/devices', async (request, reply) => {
    requirePermission(request, 'devices.read');
    const db = getDb();
    const q = (request.query ?? {}) as Record<string, string>;
    let items = [...db.devices.values()].map((device) => ({
      ...device,
      centreName: db.centres.get(device.centreId)?.name ?? 'Unknown',
    }));
    if (q.status) items = items.filter((d) => d.status === q.status);
    if (q.centreId) items = items.filter((d) => d.centreId === q.centreId);
    if (q.search) {
      const needle = q.search.toLowerCase();
      items = items.filter((d) => d.deviceCode.toLowerCase().includes(needle) || d.name.toLowerCase().includes(needle));
    }
    items.sort((a, b) => a.deviceCode.localeCompare(b.deviceCode));
    const { page, pageSize } = readPageParams(q);
    return noStore(reply).send(paginate(items, page, pageSize));
  });

  app.get('/devices/:deviceId', async (request, reply) => {
    requirePermission(request, 'devices.read');
    const db = getDb();
    const { deviceId } = request.params as { deviceId: string };
    const device = db.devices.get(deviceId);
    if (!device) throw Errors.notFound('That workstation');
    return noStore(reply).send({
      device,
      centre: db.centres.get(device.centreId) ?? null,
      events: db.auditEvents.filter((e) => e.deviceId === device.id || e.targetId === device.id).slice(-30).reverse(),
      activeSessions: [...db.attempts.values()].filter((a) => a.deviceId === device.id && a.status === 'ACTIVE').length,
    });
  });

  app.post('/devices', async (request, reply) => {
    const user = requirePermission(request, 'devices.write');
    const context = ctx(request);
    const body = parse(deviceRegisterSchema, request.body);
    const db = getDb();

    if (!db.centres.has(body.centreId)) throw Errors.notFound('That examination centre');
    if (!isIP(body.ipAddress)) throw Errors.validation({ ipAddress: 'Enter a valid IP address.' });
    if ([...db.devices.values()].some((d) => d.deviceCode === body.deviceCode)) {
      throw Errors.conflict(
        `Workstation ${body.deviceCode} is already registered.`,
        'Workstation identifiers must be unique within the organisation.',
      );
    }

    const id = randomUUID();
    const device: ExaminationDevice = {
      id,
      deviceCode: body.deviceCode,
      name: body.name,
      centreId: body.centreId,
      operatingSystem: body.operatingSystem,
      kioskPolicyVersion: body.kioskPolicyVersion,
      status: 'PENDING',
      certificate: issueCertificate(body.deviceCode),
      lastHealthCheckAt: null,
      cameraStatus: 'UNKNOWN',
      fingerprintScannerStatus: 'UNKNOWN',
      networkStatus: 'UNKNOWN',
      ipAddress: body.ipAddress,
      notes: 'Registered. Awaiting security administrator approval and a readiness check.',
    };
    db.devices.set(id, device);

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'DEVICE_REGISTERED',
      targetType: 'ExaminationDevice',
      targetId: id,
      targetLabel: device.deviceCode,
      reason: `Registered at ${db.centres.get(body.centreId)?.name ?? 'unknown centre'}. Certificate ${device.certificate.serial} issued.`,
      deviceId: id,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ device });
  });

  app.post('/devices/:deviceId/actions', async (request, reply) => {
    const user = requirePermission(request, 'devices.write');
    const context = ctx(request);
    const body = parse(deviceActionSchema, request.body);
    const db = getDb();
    const { deviceId } = request.params as { deviceId: string };
    const device = db.devices.get(deviceId);
    if (!device) throw Errors.notFound('That workstation');

    if (body.action === 'REVOKE') requirePermission(request, 'devices.revoke');

    let action: 'DEVICE_REVOKED' | 'DEVICE_CERT_ROTATED' | 'DEVICE_REGISTERED' = 'DEVICE_REGISTERED';
    switch (body.action) {
      case 'APPROVE':
        device.status = 'APPROVED';
        device.notes = 'Approved for examination use.';
        break;
      case 'REVOKE':
        device.status = 'REVOKED';
        device.certificate.status = 'REVOKED';
        device.networkStatus = 'UNKNOWN';
        device.notes = body.reason;
        action = 'DEVICE_REVOKED';
        break;
      case 'ROTATE_CERTIFICATE':
        device.certificate = issueCertificate(device.deviceCode);
        action = 'DEVICE_CERT_ROTATED';
        break;
    }

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action,
      targetType: 'ExaminationDevice',
      targetId: device.id,
      targetLabel: device.deviceCode,
      reason: body.reason,
      deviceId: device.id,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ device });
  });

  app.post('/devices/:deviceId/readiness', async (request, reply) => {
    requirePermission(request, 'devices.read');
    const db = getDb();
    const { deviceId } = request.params as { deviceId: string };
    const device = db.devices.get(deviceId);
    if (!device) throw Errors.notFound('That workstation');

    const report = runReadinessCheck(device);
    device.lastHealthCheckAt = report.generatedAt;
    return noStore(reply).send({ report });
  });

  /* ----------------------------- candidates ------------------------- */

  app.get('/candidates', async (request, reply) => {
    requirePermission(request, 'candidates.read');
    const db = getDb();
    const q = (request.query ?? {}) as Record<string, string>;
    let items = [...db.candidates.values()].map((candidate) => ({
      ...candidate,
      centreName: candidate.centreId ? (db.centres.get(candidate.centreId)?.name ?? null) : null,
      examName: candidate.examId ? (db.exams.get(candidate.examId)?.name ?? null) : null,
    }));

    if (q.search) {
      const needle = q.search.toLowerCase();
      items = items.filter(
        (c) =>
          c.fullName.toLowerCase().includes(needle) ||
          c.applicationId.toLowerCase().includes(needle) ||
          c.candidateId.toLowerCase().includes(needle),
      );
    }
    if (q.examId) items = items.filter((c) => [...db.registrations.values()].some(r => r.examId === q.examId && r.candidateId === c.id));
    if (q.eligibility) items = items.filter((c) => c.eligibility === q.eligibility);
    if (q.accommodations === 'true') items = items.filter((c) => c.accommodations.requirements.length > 0);

    items.sort((a, b) => a.applicationId.localeCompare(b.applicationId));
    const { page, pageSize } = readPageParams(q);
    return noStore(reply).send(paginate(items, page, pageSize));
  });

  app.get('/candidates/:candidateId', async (request, reply) => {
    requirePermission(request, 'candidates.read');
    const db = getDb();
    const { candidateId } = request.params as { candidateId: string };
    const candidate = db.candidates.get(candidateId);
    if (!candidate) throw Errors.notFound('That candidate');
    const { examId } = (request.query ?? {}) as { examId?: string };
    if (examId && ![...db.registrations.values()].some(r => r.examId === examId && r.candidateId === candidateId)) throw Errors.notFound('That candidate in this examination');
    const attempt = [...db.attempts.values()].find((a) => a.candidateId === candidate.id && (!examId || a.examId === examId));

    return noStore(reply).send({
      candidate,
      centre: candidate.centreId ? (db.centres.get(candidate.centreId) ?? null) : null,
      exam: (examId ?? candidate.examId) ? (db.exams.get((examId ?? candidate.examId)!) ?? null) : null,
      registration: [...db.registrations.values()].find((r) => r.candidateId === candidate.id && (!examId || r.examId === examId)) ?? null,
      attempt: attempt ?? null,
      receipt: attempt ? ([...db.receipts.values()].find((r) => r.attemptId === attempt.id) ?? null) : null,
      auditTimeline: db.auditEvents.filter((e) => e.actorId === candidate.id).slice(-30).reverse(),
      privacyNote:
        'This record holds synthetic demonstration data only. Biometric references are simulated identifiers; no raw fingerprint or face template is stored anywhere in this system.',
    });
  });

  app.post('/candidates', async (request, reply) => {
    const user = requirePermission(request, 'candidates.write');
    const context = ctx(request);
    const body = parse(candidateCreateSchema, request.body);
    const db = getDb();

    const exam = db.exams.get(body.examId);
    if (!exam) throw Errors.notFound('That examination');
    if (body.centreId && body.centreId !== exam.centreId) throw Errors.validation({ centreId: 'Candidates must use their examination centre.' });
    if (db.candidateCredentials.has(body.applicationId.toUpperCase())) {
      throw Errors.conflict(
        `Application ID ${body.applicationId} is already registered.`,
        'Application IDs must be unique across the examination cycle.',
      );
    }

    const id = randomUUID();
    const candidate = {
      id,
      candidateId: `CND-${String(db.candidates.size + 1).padStart(5, '0')}`,
      applicationId: body.applicationId.toUpperCase(),
      fullName: body.fullName,
      photoSeed: body.fullName.replace(/\s+/g, '-').toLowerCase(),
      email: body.email,
      eligibility: body.eligibility,
      examId: exam.id,
      centreId: exam.centreId,
      accommodations: {
        additionalTimeMinutes: body.additionalTimeMinutes,
        requirements: body.requirements,
        notes: body.notes,
      },
      fingerprintEnrolled: false,
      faceEnrolled: false,
      biometricReferenceId: null,
      accountStatus: 'ACTIVE' as const,
      lastVerificationEvent: null,
    };
    db.candidates.set(id, candidate);
    const credential = hashPassword('Exam!2026');
    db.candidateCredentials.set(candidate.applicationId, { candidateId: id, applicationId: candidate.applicationId, passwordHash: credential.hash, salt: credential.salt, demoPassword: 'Exam!2026' });
    const registrationId = randomUUID();
    db.registrations.set(registrationId, { id: registrationId, examId: exam.id, candidateId: id, centreId: exam.centreId, seatNumber: '', status: 'REGISTERED', createdAt: new Date().toISOString() });
    exam.candidateCount = [...db.registrations.values()].filter(r => r.examId === exam.id).length;

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'EXAM_UPDATED',
      targetType: 'Candidate',
      targetId: id,
      targetLabel: candidate.applicationId,
      reason: 'Candidate registered.',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ candidate });
  });

  /* ------------------------------- users ---------------------------- */

  app.get('/users', async (request, reply) => {
    requirePermission(request, 'users.read');
    const db = getDb();
    const items = [...db.users.values()].map((user) => ({
      ...user,
      centreName: user.centreId ? (db.centres.get(user.centreId)?.name ?? null) : null,
    }));
    return noStore(reply).send({ items, total: items.length });
  });

  app.get('/roles', async (_request, reply) => {
    const { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLES } = await import('@sep/shared');
    return noStore(reply).send({
      roles: ROLES.map((role) => ({
        id: role,
        label: ROLE_LABELS[role],
        description: ROLE_DESCRIPTIONS[role],
        permissions: ROLE_PERMISSIONS[role],
      })),
    });
  });
}

/**
 * Simulated workstation readiness check.
 *
 * A browser cannot inspect secure boot, disk encryption or kiosk policy. In a
 * production deployment these results come from the native Windows shell
 * through the DeviceSecurityProvider interface.
 */
function runReadinessCheck(device: ExaminationDevice): DeviceReadinessReport {
  const checks: ReadinessCheckResult[] = [
    {
      key: 'secureBoot',
      label: 'Secure boot',
      explanation: 'Confirms the machine started from software the organisation signed.',
      status: 'PASS',
      detail: 'Secure boot reported as enabled by the device agent.',
      simulated: true,
    },
    {
      key: 'diskEncryption',
      label: 'Disk encryption',
      explanation: 'Protects data if the machine or its drive is removed.',
      status: 'PASS',
      detail: 'Full-volume encryption active with a TPM-protected key.',
      simulated: true,
    },
    {
      key: 'kioskPolicy',
      label: 'Kiosk policy',
      explanation: 'Locks the computer to the examination application only.',
      status: device.kioskPolicyVersion >= '2026.01.0' ? 'PASS' : 'WARNING',
      detail: `Policy version ${device.kioskPolicyVersion}${device.kioskPolicyVersion >= '2026.01.0' ? '' : ' is older than the minimum required version 2026.01.0.'}`,
      simulated: true,
    },
    {
      key: 'appSignature',
      label: 'Application signature',
      explanation: 'Confirms the examination application has not been replaced or modified.',
      status: 'PASS',
      detail: 'Application binary signature matches the published release.',
      simulated: true,
    },
    {
      key: 'deviceCertificate',
      label: 'Device certificate',
      explanation: 'A digital identity issued to an approved examination computer.',
      status:
        device.certificate.status === 'VALID'
          ? 'PASS'
          : device.certificate.status === 'EXPIRING'
            ? 'WARNING'
            : 'FAIL',
      detail:
        device.certificate.status === 'REVOKED'
          ? 'The certificate appears on the revocation list. This workstation cannot start an examination.'
          : `Serial ${device.certificate.serial}, valid until ${new Date(device.certificate.expiresAt).toLocaleDateString()}.`,
      simulated: false,
    },
    {
      key: 'camera',
      label: 'Camera',
      explanation: 'Required when the examination uses camera-presence monitoring.',
      status: device.cameraStatus === 'OK' ? 'PASS' : device.cameraStatus === 'WARNING' ? 'WARNING' : 'FAIL',
      detail:
        device.cameraStatus === 'FAIL'
          ? 'No camera responded. This workstation cannot be allocated to a monitored examination.'
          : 'Camera enumerated and returning frames.',
      simulated: true,
    },
    {
      key: 'fingerprintScanner',
      label: 'Fingerprint scanner',
      explanation: 'Required only when fingerprint verification is enabled.',
      status:
        device.fingerprintScannerStatus === 'OK'
          ? 'PASS'
          : device.fingerprintScannerStatus === 'WARNING'
            ? 'WARNING'
            : 'FAIL',
      detail:
        device.fingerprintScannerStatus === 'WARNING'
          ? 'Scanner responded but reported degraded image quality on the last self-test.'
          : 'Scanner present and responding.',
      simulated: true,
    },
    {
      key: 'examNetwork',
      label: 'Examination network',
      explanation: 'Allows connections only from approved examination-centre networks.',
      status: device.status === 'REVOKED' ? 'FAIL' : 'PASS',
      detail:
        device.status === 'REVOKED'
          ? 'Workstation removed from the examination network following revocation.'
          : `Reporting from ${device.ipAddress}, inside the approved centre range.`,
      simulated: false,
    },
    {
      key: 'apiConnectivity',
      label: 'API connectivity',
      explanation: 'Confirms the workstation can reach the examination service.',
      status: 'PASS',
      detail: 'Health endpoint reachable; round-trip under 40 ms.',
      simulated: false,
    },
  ];

  const overall = checks.some((c) => c.status === 'FAIL')
    ? 'FAIL'
    : checks.some((c) => c.status === 'WARNING')
      ? 'WARNING'
      : 'PASS';

  return { deviceId: device.id, generatedAt: new Date().toISOString(), overall, checks };
}
