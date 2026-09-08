import { randomBytes, randomUUID } from 'node:crypto';
import {
  IMPORT_COLUMNS,
  type Candidate,
  type ImportIssue,
  type ImportKind,
  type ImportPreviewRow,
  type ImportResult,
  type ImportValidation,
} from '@sep/shared';
import { getDb } from '../lib/store/db.js';
import { recordAudit } from '../lib/audit.js';
import { ipInCidr } from '../lib/network.js';
import { hashPassword } from '../lib/password.js';
import { upsertAssignment } from './deviceService.js';
import { Errors } from '../lib/errors.js';

/**
 * Bulk import.
 *
 * Two phases, deliberately. An administrator preparing a 500-candidate
 * examination needs every problem in the file listed *before* anything is
 * written — not to discover row 340 was malformed after 339 rows already
 * landed. Validation returns a token; commit presents it. Nothing is written in
 * between.
 *
 * The workbook itself is parsed on the client so the server never accepts a
 * binary file it must trust; it receives plain rows and validates every one.
 */

const TOKEN_TTL_MINUTES = 30;
const DEMO_CANDIDATE_PASSWORD = 'Exam!2026';

function trimmed(row: Record<string, string>, key: string): string {
  return (row[key] ?? '').trim();
}

function splitList(value: string): string[] {
  return value
    .split(/[;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBoolean(value: string): boolean {
  return ['yes', 'y', 'true', '1'].includes(value.trim().toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateImport(input: {
  kind: ImportKind;
  fileName: string;
  rows: Record<string, string>[];
  examId?: string;
  userId: string;
}): ImportValidation {
  const db = getDb();
  if (input.examId && !db.exams.has(input.examId)) throw Errors.notFound('That examination');
  if (input.kind === 'QUESTIONS') throw Errors.validation({ kind: 'Use question authoring to create and submit questions for review.' });
  const issues: ImportIssue[] = [];
  const preview: ImportPreviewRow[] = [];
  const columns = IMPORT_COLUMNS[input.kind];

  let createCount = 0;
  let updateCount = 0;
  let skipCount = 0;
  let rejectCount = 0;

  // Missing required columns are a whole-file problem; report once, not per row.
  const headers = new Set(Object.keys(input.rows[0] ?? {}));
  columns
    .filter((c) => c.required && !headers.has(c.key))
    .forEach((c) =>
      issues.push({
        row: 1,
        column: c.key,
        severity: 'ERROR',
        message: `The required column "${c.header}" is missing from the file.`,
        value: null,
      }),
    );

  const seenKeys = new Set<string>();

  input.rows.forEach((row, index) => {
    // +2: spreadsheets are 1-based and row 1 is the header.
    const rowNumber = index + 2;
    const rowIssues: ImportIssue[] = [];
    let action: ImportPreviewRow['action'] = 'CREATE';
    let note: string | null = null;

    const error = (column: string | null, message: string, value: string | null = null) =>
      rowIssues.push({ row: rowNumber, column, severity: 'ERROR', message, value });
    const warn = (column: string | null, message: string, value: string | null = null) =>
      rowIssues.push({ row: rowNumber, column, severity: 'WARNING', message, value });

    columns
      .filter((c) => c.required)
      .forEach((c) => {
        if (!trimmed(row, c.key)) error(c.key, `${c.header} is required.`);
      });

    switch (input.kind) {
      case 'CANDIDATES': {
        const applicationId = trimmed(row, 'applicationId').toUpperCase();
        if (applicationId) {
          if (!/^[A-Z0-9-]{4,32}$/.test(applicationId)) {
            error('applicationId', 'Use 4–32 letters, numbers or hyphens.', applicationId);
          }
          if (seenKeys.has(applicationId)) {
            error('applicationId', 'This application ID appears more than once in the file.', applicationId);
          }
          seenKeys.add(applicationId);
          if (db.candidateCredentials.has(applicationId)) {
            action = 'UPDATE';
            note = 'An existing candidate with this application ID will be updated.';
          }
        }
        const email = trimmed(row, 'email');
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error('email', 'Enter a valid email address.', email);

        const eligibility = trimmed(row, 'eligibility').toUpperCase();
        if (eligibility && !['ELIGIBLE', 'PROVISIONAL', 'INELIGIBLE'].includes(eligibility)) {
          error('eligibility', 'Use ELIGIBLE, PROVISIONAL or INELIGIBLE.', eligibility);
        }

        const centreCode = trimmed(row, 'centreCode');
        if (centreCode && ![...db.centres.values()].some((c) => c.code === centreCode)) {
          error('centreCode', 'No examination centre has this code.', centreCode);
        }

        const extra = trimmed(row, 'additionalTimeMinutes');
        if (extra) {
          const minutes = Number(extra);
          if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120) {
            error('additionalTimeMinutes', 'Enter a whole number of minutes between 0 and 120.', extra);
          }
        }
        break;
      }

      case 'DEVICES': {
        const deviceCode = trimmed(row, 'deviceCode').toUpperCase();
        if (deviceCode) {
          if (seenKeys.has(deviceCode)) {
            error('deviceCode', 'This workstation ID appears more than once in the file.', deviceCode);
          }
          seenKeys.add(deviceCode);
          if ([...db.devices.values()].some((d) => d.deviceCode === deviceCode)) {
            action = 'UPDATE';
            note = 'An existing workstation with this ID will be updated.';
          }
        }

        const centreCode = trimmed(row, 'centreCode');
        const centre = [...db.centres.values()].find((c) => c.code === centreCode);
        if (centreCode && !centre) error('centreCode', 'No examination centre has this code.', centreCode);

        const ip = trimmed(row, 'ipAddress');
        if (ip && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
          error('ipAddress', 'Enter a valid IPv4 address.', ip);
        } else if (ip && centre && !ipInCidr(ip, centre.primaryCidr) && (!centre.backupCidr || !ipInCidr(ip, centre.backupCidr))) {
          // Not fatal — a centre may be adding a range — but worth flagging.
          warn('ipAddress', `This address is outside ${centre.name}'s approved ranges.`, ip);
        }

        const guid = trimmed(row, 'machineGuid');
        if (guid && guid.length < 8) warn('machineGuid', 'This does not look like a Windows MachineGuid.', guid);
        break;
      }

      case 'CANDIDATE_DEVICE_ASSIGNMENTS': {
        const applicationId = trimmed(row, 'applicationId').toUpperCase();
        const credential = db.candidateCredentials.get(applicationId);
        if (applicationId && !credential) {
          error('applicationId', 'No candidate is registered with this application ID.', applicationId);
        }
        if (seenKeys.has(applicationId)) {
          error('applicationId', 'This candidate appears more than once in the file.', applicationId);
        }
        seenKeys.add(applicationId);

        const deviceCode = trimmed(row, 'deviceCode').toUpperCase();
        const device = deviceCode ? [...db.devices.values()].find((d) => d.deviceCode === deviceCode) : undefined;
        if (deviceCode && !device) {
          error('deviceCode', 'No workstation is registered with this ID.', deviceCode);
        } else if (device && device.status !== 'APPROVED') {
          error('deviceCode', `Workstation ${deviceCode} is ${device.status.toLowerCase()} and cannot be assigned.`, deviceCode);
        }

        const allowAny = parseBoolean(trimmed(row, 'allowAnyApprovedDevice'));
        if (!deviceCode && !allowAny) {
          warn(
            'deviceCode',
            'No workstation named and "allow any approved workstation" is not set. The candidate will be able to use any approved machine.',
          );
        }

        splitList(trimmed(row, 'allowedCidrs')).forEach((cidr) => {
          if (!/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(cidr)) {
            error('allowedCidrs', `"${cidr}" is not a valid IPv4 range in CIDR form.`, cidr);
          }
        });

        if (credential && input.examId) {
          const existing = [...db.deviceAssignments.values()].find(
            (a) => a.examId === input.examId && a.candidateId === credential.candidateId && a.releasedAt === null,
          );
          if (existing) {
            action = 'UPDATE';
            note = `Replaces the current assignment to ${existing.deviceCode ?? 'any approved workstation'}.`;
          }
        }
        break;
      }

      case 'NETWORK_RANGES': {
        const centreCode = trimmed(row, 'centreCode');
        if (centreCode && ![...db.centres.values()].some((c) => c.code === centreCode)) {
          error('centreCode', 'No examination centre has this code.', centreCode);
        }
        const cidr = trimmed(row, 'cidr');
        const kind = trimmed(row, 'kind').toUpperCase();
        if (kind === 'IPV6') {
          if (cidr && !/^[0-9a-fA-F:]+\/\d{1,3}$/.test(cidr)) error('cidr', 'Enter a valid IPv6 range.', cidr);
        } else if (cidr && !/^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(cidr)) {
          error('cidr', 'Enter a valid IPv4 range in CIDR form.', cidr);
        }
        if (kind && !['PRIMARY', 'BACKUP', 'IPV6'].includes(kind)) {
          error('kind', 'Use PRIMARY, BACKUP or IPV6.', kind);
        }
        action = 'UPDATE';
        note = 'Updates the centre’s network configuration.';
        break;
      }

      case 'QUESTIONS': {
        const categoryCode = trimmed(row, 'categoryCode').toUpperCase();
        const category = [...db.categories.values()].find((c) => c.code === categoryCode);
        if (categoryCode && !category) error('categoryCode', 'No category has this code.', categoryCode);

        const type = trimmed(row, 'type').toUpperCase();
        const validTypes = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'PARAGRAPH', 'SHORT_TEXT'];
        if (type && !validTypes.includes(type)) error('type', `Use one of ${validTypes.join(', ')}.`, type);
        if (category && type && !category.allowedTypes.includes(type as never)) {
          error('type', `Category ${category.code} does not accept ${type} questions.`, type);
        }

        const difficulty = trimmed(row, 'difficulty').toUpperCase();
        if (difficulty && !['EASY', 'MEDIUM', 'DIFFICULT'].includes(difficulty)) {
          error('difficulty', 'Use EASY, MEDIUM or DIFFICULT.', difficulty);
        }

        if (type === 'PARAGRAPH' || type === 'SHORT_TEXT') {
          if (trimmed(row, 'markingGuidance').length < 10) {
            error('markingGuidance', 'Descriptive questions need marking guidance for the human examiner.');
          }
        } else if (type) {
          const options = ['optionA', 'optionB', 'optionC', 'optionD'].map((k) => trimmed(row, k)).filter(Boolean);
          if (options.length < 2) error('optionA', 'Provide at least two options.');
          const correct = splitList(trimmed(row, 'correctOptions').replace(/,/g, ';')).map((c) => c.toUpperCase());
          if (correct.length === 0) error('correctOptions', 'Name the correct option.');
          correct.forEach((letter) => {
            if (!['A', 'B', 'C', 'D'].includes(letter)) {
              error('correctOptions', `"${letter}" is not one of the option letters A–D.`, letter);
            }
          });
          if ((type === 'SINGLE_CHOICE' || type === 'TRUE_FALSE') && correct.length !== 1) {
            error('correctOptions', 'Name exactly one correct option for this question type.');
          }
          if (type === 'MULTIPLE_CHOICE' && correct.length < 2) {
            error('correctOptions', 'Multiple-choice questions need at least two correct options.');
          }
        }
        break;
      }
    }

    if (rowIssues.some((i) => i.severity === 'ERROR')) {
      action = 'REJECT';
      note = 'This row has errors and will not be imported.';
      rejectCount += 1;
    } else if (action === 'UPDATE') {
      updateCount += 1;

    } else {
      createCount += 1;
    }

    issues.push(...rowIssues);
    if (preview.length < 50) preview.push({ row: rowNumber, data: row, action, note });
  });

  const errorCount = issues.filter((i) => i.severity === 'ERROR').length;
  const token = randomBytes(16).toString('hex');
  const validRows = createCount + updateCount;

  const validation: ImportValidation = {
    kind: input.kind,
    fileName: input.fileName,
    totalRows: input.rows.length,
    validRows,
    createCount,
    updateCount,
    skipCount,
    rejectCount,
    issues: issues.slice(0, 500),
    preview,
    token,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString(),
    canCommit: validRows > 0 && errorCount === 0,
    summary:
      errorCount === 0
        ? `${input.rows.length} rows read. ${createCount} to create, ${updateCount} to update. Nothing has been written yet.`
        : `${errorCount} error(s) across ${rejectCount} row(s). Fix the file and upload it again — nothing has been written.`,
  };

  getDb().importValidations.set(token, {
    ...validation,
    rows: input.rows,
    userId: input.userId,
    examId: input.examId,
  });

  return validation;
}

/* ------------------------------------------------------------------ */
/* Commit                                                              */
/* ------------------------------------------------------------------ */

export function commitImport(input: {
  token: string;
  reason: string;
  userId: string;
  userName: string;
  role: string;
  ipAddress: string;
  traceId: string;
}): ImportResult {
  const db = getDb();
  const held = db.importValidations.get(input.token);

  if (!held) {
    throw Errors.conflict(
      'This import is no longer available to commit.',
      'Validations expire after 30 minutes. Upload the file again to revalidate it.',
    );
  }
  if (new Date(held.expiresAt) < new Date()) {
    db.importValidations.delete(input.token);
    throw Errors.conflict('This import validation has expired.', 'Upload the file again to revalidate it.');
  }
  if (held.userId !== input.userId) {
    throw Errors.forbidden('committing an import validated by another user');
  }
  if (!held.canCommit) {
    throw Errors.conflict(
      'This import cannot be committed because it still contains errors.',
      'Correct the rows listed in the validation report and upload the file again.',
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const issues: ImportIssue[] = [];

  const rejected = new Set(held.preview.filter((p) => p.action === 'REJECT').map((p) => p.row));

  held.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (rejected.has(rowNumber)) {
      skipped += 1;
      return;
    }
    try {
      const outcome = applyRow(held.kind, row, held.examId);
      if (outcome === 'CREATED') created += 1;
      else if (outcome === 'UPDATED') updated += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      issues.push({
        row: rowNumber,
        column: null,
        severity: 'ERROR',
        message: error instanceof Error ? error.message : 'This row could not be written.',
        value: null,
      });
    }
  });

  db.importValidations.delete(input.token);

  const audit = recordAudit({
    actorId: input.userId,
    actorName: input.userName,
    actorRole: input.role as never,
    action: 'EXAM_UPDATED',
    targetType: 'Import',
    targetId: held.kind,
    targetLabel: `${held.kind} import from ${held.fileName}`,
    result: failed > 0 ? 'FAILURE' : 'SUCCESS',
    reason: `${input.reason} — ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed.`,
    ipAddress: input.ipAddress,
    traceId: input.traceId,
  });

  return {
    kind: held.kind,
    created,
    updated,
    skipped,
    failed,
    issues,
    auditEventId: audit.id,
    committedAt: new Date().toISOString(),
    summary: `${created} created, ${updated} updated, ${skipped} skipped${failed > 0 ? `, ${failed} failed` : ''}.`,
  };
}

type RowOutcome = 'CREATED' | 'UPDATED' | 'SKIPPED';

function applyRow(kind: ImportKind, row: Record<string, string>, examId?: string): RowOutcome {
  const db = getDb();

  switch (kind) {
    case 'CANDIDATES': {
      const applicationId = trimmed(row, 'applicationId').toUpperCase();
      const centre = [...db.centres.values()].find((c) => c.code === trimmed(row, 'centreCode'));
      const existingCredential = db.candidateCredentials.get(applicationId);

      const accommodations = {
        additionalTimeMinutes: Number(trimmed(row, 'additionalTimeMinutes') || 0),
        requirements: splitList(trimmed(row, 'requirements')),
        notes: trimmed(row, 'notes'),
      };

      if (existingCredential) {
        const candidate = db.candidates.get(existingCredential.candidateId);
        if (!candidate) return 'SKIPPED';
        candidate.fullName = trimmed(row, 'fullName') || candidate.fullName;
        candidate.email = trimmed(row, 'email') || candidate.email;
        candidate.eligibility = (trimmed(row, 'eligibility').toUpperCase() || candidate.eligibility) as never;
        candidate.centreId = centre?.id ?? candidate.centreId;
        candidate.accommodations = accommodations;
        return 'UPDATED';
      }

      const id = randomUUID();
      const fullName = trimmed(row, 'fullName');
      const candidate: Candidate = {
        id,
        candidateId: `CND-${String(db.candidates.size + 1).padStart(5, '0')}`,
        applicationId,
        fullName,
        photoSeed: fullName.replace(/\s+/g, '-').toLowerCase(),
        email: trimmed(row, 'email'),
        eligibility: (trimmed(row, 'eligibility').toUpperCase() || 'ELIGIBLE') as never,
        examId: examId ?? null,
        centreId: centre?.id ?? (examId ? db.exams.get(examId)?.centreId ?? null : null),
        accommodations,
        fingerprintEnrolled: false,
        faceEnrolled: false,
        biometricReferenceId: null,
        accountStatus: 'ACTIVE',
        lastVerificationEvent: null,
      };
      db.candidates.set(id, candidate);

      // Imported candidates get the demonstration password. A production import
      // would issue a one-time credential and require a reset at first sign-in.
      const credential = hashPassword(DEMO_CANDIDATE_PASSWORD);
      db.candidateCredentials.set(applicationId, {
        candidateId: id,
        applicationId,
        passwordHash: credential.hash,
        salt: credential.salt,
        demoPassword: DEMO_CANDIDATE_PASSWORD,
      });

      if (examId) {
        const regId = randomUUID();
        db.registrations.set(regId, {
          id: regId,
          examId,
          candidateId: id,
          centreId: centre?.id ?? (examId ? db.exams.get(examId)?.centreId ?? '' : ''),
          seatNumber: `S-${String(db.registrations.size + 1).padStart(4, '0')}`,
          status: 'REGISTERED',
          createdAt: new Date().toISOString(),
        });
      }
      return 'CREATED';
    }

    case 'DEVICES': {
      const deviceCode = trimmed(row, 'deviceCode').toUpperCase();
      const centre = [...db.centres.values()].find((c) => c.code === trimmed(row, 'centreCode'));
      if (!centre) return 'SKIPPED';

      const existing = [...db.devices.values()].find((d) => d.deviceCode === deviceCode);
      const machineGuid = trimmed(row, 'machineGuid') || null;
      const macs = splitList(trimmed(row, 'macAddresses'));

      if (existing) {
        existing.name = trimmed(row, 'name') || existing.name;
        existing.operatingSystem = trimmed(row, 'operatingSystem') || existing.operatingSystem;
        existing.ipAddress = trimmed(row, 'ipAddress') || existing.ipAddress;
        existing.kioskPolicyVersion = trimmed(row, 'kioskPolicyVersion') || existing.kioskPolicyVersion;
        if (machineGuid || macs.length > 0) enrolFromImport(existing.id, machineGuid, macs, trimmed(row, 'operatingSystem'));
        return 'UPDATED';
      }

      const id = randomUUID();
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 365 * 86_400_000);
      db.devices.set(id, {
        id,
        deviceCode,
        name: trimmed(row, 'name'),
        centreId: centre.id,
        operatingSystem: trimmed(row, 'operatingSystem') || 'Windows 11 Enterprise 23H2',
        kioskPolicyVersion: trimmed(row, 'kioskPolicyVersion') || '2026.01.3',
        status: 'PENDING',
        certificate: {
          serial: randomUUID().slice(0, 17).toUpperCase().replace(/-/g, ':'),
          subject: `CN=${deviceCode}, OU=Examination Workstations, O=Examination Board`,
          issuer: 'CN=Examination Board Device CA, O=Examination Board',
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          status: 'VALID',
          thumbprint: randomUUID().replace(/-/g, '').slice(0, 24),
        },
        lastHealthCheckAt: null,
        cameraStatus: 'UNKNOWN',
        fingerprintScannerStatus: 'UNKNOWN',
        networkStatus: 'UNKNOWN',
        ipAddress: trimmed(row, 'ipAddress'),
        notes: 'Imported. Awaiting security administrator approval.',
      });
      if (machineGuid || macs.length > 0) enrolFromImport(id, machineGuid, macs, trimmed(row, 'operatingSystem'));
      return 'CREATED';
    }

    case 'CANDIDATE_DEVICE_ASSIGNMENTS': {
      if (!examId) return 'SKIPPED';
      const applicationId = trimmed(row, 'applicationId').toUpperCase();
      const credential = db.candidateCredentials.get(applicationId);
      if (!credential) return 'SKIPPED';
      const candidate = db.candidates.get(credential.candidateId);
      if (!candidate) return 'SKIPPED';

      const deviceCode = trimmed(row, 'deviceCode').toUpperCase();
      const device = deviceCode ? [...db.devices.values()].find((d) => d.deviceCode === deviceCode) : undefined;

      const existed = [...db.deviceAssignments.values()].some(
        (a) => a.examId === examId && a.candidateId === candidate.id && a.releasedAt === null,
      );

      upsertAssignment({
        examId,
        candidateId: candidate.id,
        candidateApplicationId: candidate.applicationId,
        candidateName: candidate.fullName,
        deviceId: device?.id ?? null,
        seatNumber: trimmed(row, 'seatNumber'),
        allowedCidrs: splitList(trimmed(row, 'allowedCidrs')),
        allowAnyApprovedDevice: parseBoolean(trimmed(row, 'allowAnyApprovedDevice')) || !device,
      });
      return existed ? 'UPDATED' : 'CREATED';
    }

    case 'NETWORK_RANGES': {
      const centre = [...db.centres.values()].find((c) => c.code === trimmed(row, 'centreCode'));
      if (!centre) return 'SKIPPED';
      const cidr = trimmed(row, 'cidr');
      switch (trimmed(row, 'kind').toUpperCase()) {
        case 'PRIMARY':
          centre.primaryCidr = cidr;
          break;
        case 'BACKUP':
          centre.backupCidr = cidr;
          break;
        case 'IPV6':
          centre.ipv6Cidr = cidr;
          break;
        default:
          return 'SKIPPED';
      }
      return 'UPDATED';
    }

    case 'QUESTIONS': {
      // Question import is validated fully but writing is intentionally out of
      // scope for this proof of concept: authored questions must go through the
      // review workflow, and a bulk path around that would undermine it.
      return 'SKIPPED';
    }
  }
}

function enrolFromImport(deviceId: string, machineGuid: string | null, macs: string[], os: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  [...db.deviceEnrolments.values()]
    .filter((e) => e.deviceId === deviceId && e.supersededAt === null)
    .forEach((e) => {
      e.supersededAt = now;
    });

  const id = randomUUID();
  db.deviceEnrolments.set(id, {
    id,
    deviceId,
    fingerprint: {
      machineGuid,
      hostname: null,
      macAddresses: macs,
      serialNumber: null,
      operatingSystem: os || null,
      cpuSignature: null,
      totalMemoryMb: null,
      displayCount: null,
      primaryResolution: null,
      localIpAddress: null,
      client: 'WINDOWS_NATIVE',
      clientVersion: null,
      userAgent: null,
      timeZone: null,
      applicationSignatureValid: null,
      capturedAt: now,
    },
    enrolledByUserId: 'import',
    enrolledAt: now,
    supersededAt: null,
    notes: 'Enrolled from a bulk device import.',
  });
}

/** A blank template with headers and one example row, for download. */
export function importTemplate(kind: ImportKind): { headers: string[]; example: Record<string, string> } {
  const columns = IMPORT_COLUMNS[kind];
  const example: Record<string, string> = {};
  columns.forEach((c) => {
    example[c.header] = c.example;
  });
  return { headers: columns.map((c) => c.header), example };
}
