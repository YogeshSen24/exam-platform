import { randomUUID } from 'node:crypto';
import {
  EXPORT_SECTIONS,
  rolesHavePermission,
  type ExportFormat,
  type ExportManifest,
  type ExportSection,
  type Permission,
  type Role,
  type SessionUser,
} from '@sep/shared';
import { getDb } from '../lib/store/db.js';
import { recordAudit } from '../lib/audit.js';
import { sha256Canonical, sha256Hex } from '../lib/crypto/canonical.js';
import { Errors } from '../lib/errors.js';

/**
 * Full examination export.
 *
 * Everything about one examination, in the sections the requester is actually
 * permitted to see. Three rules shape this:
 *
 *   1. **Section-level permission.** The answer key needs review permission; the
 *      candidate register needs candidate permission. A requester gets what
 *      their role allows and is told plainly what was withheld.
 *   2. **A stated reason, always.** Exporting 500 candidates' data is a
 *      significant act. The reason goes into the audit trail with the export.
 *   3. **A content hash on every export.** The recipient can confirm the file
 *      they hold is the file that was produced.
 *
 * Pseudonymisation replaces names and identifiers with stable tokens, so an
 * analyst can study delivery patterns without handling personal data.
 */

export interface ExportPayload {
  manifest: ExportManifest;
  /** Section name -> rows. Rendered as sheets, files or JSON keys. */
  data: Record<string, Record<string, unknown>[]>;
  withheldSections: { section: ExportSection; reason: string }[];
}

function pseudonym(prefix: string, id: string): string {
  return `${prefix}-${sha256Hex(id).slice(0, 10).toUpperCase()}`;
}

export function buildExport(input: {
  examId: string;
  sections: ExportSection[];
  format: ExportFormat;
  reason: string;
  pseudonymise: boolean;
  user: SessionUser;
  ipAddress: string;
  traceId: string;
}): ExportPayload {
  const db = getDb();
  const exam = db.exams.get(input.examId);
  if (!exam) throw Errors.notFound('That examination');

  const withheld: { section: ExportSection; reason: string }[] = [];
  const granted: ExportSection[] = [];

  for (const section of input.sections) {
    const info = EXPORT_SECTIONS.find((s) => s.id === section);
    if (!info) continue;
    if (rolesHavePermission(input.user.roles as Role[], info.requiredPermission as Permission)) {
      granted.push(section);
    } else {
      withheld.push({
        section,
        reason: `Your role does not hold "${info.requiredPermission}", which this section requires.`,
      });
    }
  }

  if (granted.length === 0) {
    throw Errors.forbidden('exporting any of the sections requested');
  }

  const anon = input.pseudonymise;
  const data: Record<string, Record<string, unknown>[]> = {};

  const candidateName = (id: string, fallback: string) => (anon ? pseudonym('CAND', id) : fallback);
  const candidateRef = (id: string, fallback: string) => (anon ? pseudonym('APP', id) : fallback);

  for (const section of granted) {
    switch (section) {
      case 'EXAM_CONFIGURATION':
        data.ExamConfiguration = [
          {
            examId: exam.id,
            name: exam.name,
            code: exam.code,
            description: exam.description,
            subject: exam.subject,
            status: exam.status,
            startsAt: exam.startsAt,
            durationMinutes: exam.durationMinutes,
            reportingTime: exam.reportingTime,
            navigationMode: exam.navigationMode,
            resultMode: exam.resultMode,
            timeZone: exam.timeZone,
            centre: db.centres.get(exam.centreId)?.name ?? '',
            totalQuestions: exam.blueprint.totalQuestions,
            totalMarks: exam.blueprint.totalMarks,
            negativeMarking: exam.blueprint.negativeMarking,
            randomiseQuestionOrder: exam.blueprint.randomizeQuestionOrder,
            randomiseOptionOrder: exam.blueprint.randomizeOptionOrder,
            createdAt: exam.createdAt,
          },
        ];
        break;

      case 'SECURITY_POLICY': {
        const v = exam.securityPolicy.verification;
        data.SecurityPolicy = [
          {
            profile: exam.securityPolicy.profileId,
            fingerprintEnabled: v.fingerprint.enabled,
            fingerprintRequirement: v.fingerprint.requirement,
            faceEnabled: v.face.enabled,
            faceRequirement: v.face.requirement,
            requireAssignedDevice: v.requireAssignedDevice,
            requireAssignedNetwork: v.requireAssignedNetwork,
            autoDetectDevice: v.autoDetectDevice,
            requireNativeClient: v.requireNativeClient,
            cameraMonitoring: exam.securityPolicy.monitoring.cameraMonitoringEnabled,
            snapshotIntervalSeconds: exam.securityPolicy.monitoring.snapshotIntervalSeconds,
            consecutiveFailureThreshold: exam.securityPolicy.monitoring.consecutiveFailureThreshold,
            evidenceRetentionDays: exam.securityPolicy.monitoring.evidenceRetentionDays,
            primaryCidr: exam.securityPolicy.network.primaryCidr,
            backupCidr: exam.securityPolicy.network.backupCidr ?? '',
            deviceCertificateRequired: exam.securityPolicy.network.deviceCertificateRequired,
            usbPolicy: exam.securityPolicy.network.usbPolicy,
            bluetoothPolicy: exam.securityPolicy.network.bluetoothPolicy,
            policyUpdatedAt: exam.securityPolicy.updatedAt,
          },
        ];
        break;
      }

      case 'CATEGORIES':
        data.Categories = exam.blueprint.categoryAllocations.map((a) => ({
          code: a.categoryCode,
          name: a.categoryName,
          questions: a.questionCount,
          marksPerQuestion: a.marksPerQuestion,
          negativeMarksPerQuestion: a.negativeMarksPerQuestion,
          totalMarks: a.totalMarks,
          easy: a.difficultyMix.EASY,
          medium: a.difficultyMix.MEDIUM,
          difficult: a.difficultyMix.DIFFICULT,
        }));
        break;

      case 'QUESTION_PAPER': {
        const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
        data.QuestionPaper = (manifest?.entries ?? []).map((entry) => {
          const version = db.questionVersions.get(entry.questionVersionId);
          return {
            sequence: entry.sequence,
            questionId: entry.questionId,
            version: entry.version,
            category: version?.categoryCode ?? '',
            type: version?.type ?? '',
            subject: entry.subject,
            topic: version?.topic ?? '',
            difficulty: entry.difficulty,
            marks: entry.marks,
            stem: version?.stem ?? '',
            options: (version?.options ?? []).map((o) => `${o.label}. ${o.text}`).join(' | '),
            contentFingerprint: entry.contentHash,
          };
        });
        break;
      }

      case 'ANSWER_KEY': {
        const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
        data.AnswerKey = (manifest?.entries ?? []).map((entry) => {
          const version = db.questionVersions.get(entry.questionVersionId);
          return {
            sequence: entry.sequence,
            questionId: entry.questionId,
            category: version?.categoryCode ?? '',
            type: version?.type ?? '',
            marks: entry.marks,
            negativeMarks: version?.negativeMarks ?? 0,
            correctOptions: (version?.options ?? []).filter((o) => o.isCorrect).map((o) => o.label).join(', '),
            markingGuidance: version?.markingGuidance ?? '',
            explanation: version?.explanation ?? '',
          };
        });
        break;
      }

      case 'CANDIDATES':
        data.Candidates = [...db.registrations.values()]
          .filter((r) => r.examId === exam.id)
          .map((registration) => {
            const candidate = db.candidates.get(registration.candidateId);
            if (!candidate) return {};
            return {
              applicationId: candidateRef(candidate.id, candidate.applicationId),
              candidateId: candidateRef(candidate.id, candidate.candidateId),
              fullName: candidateName(candidate.id, candidate.fullName),
              email: anon ? '' : candidate.email,
              eligibility: candidate.eligibility,
              centre: candidate.centreId ? (db.centres.get(candidate.centreId)?.name ?? '') : '',
              seatNumber: registration.seatNumber,
              additionalTimeMinutes: candidate.accommodations.additionalTimeMinutes,
              accessibilityRequirements: candidate.accommodations.requirements.join('; '),
              fingerprintEnrolled: candidate.fingerprintEnrolled,
              faceEnrolled: candidate.faceEnrolled,
              accountStatus: candidate.accountStatus,
            };
          });
        break;

      case 'DEVICE_ASSIGNMENTS':
        data.DeviceAssignments = [...db.deviceAssignments.values()]
          .filter((a) => a.examId === exam.id)
          .map((a) => ({
            applicationId: candidateRef(a.candidateId, a.candidateApplicationId),
            candidateName: candidateName(a.candidateId, a.candidateName),
            workstation: a.deviceCode ?? '(any approved)',
            seatNumber: a.seatNumber,
            allowedNetworks: a.allowedCidrs.join('; ') || '(examination default)',
            allowAnyApprovedDevice: a.allowAnyApprovedDevice,
            released: a.releasedAt !== null,
            releaseReason: a.releaseReason ?? '',
            createdAt: a.createdAt,
          }));
        break;

      case 'ATTEMPTS':
        data.Attempts = [...db.attempts.values()]
          .filter((a) => a.examId === exam.id)
          .map((attempt) => {
            const candidate = db.candidates.get(attempt.candidateId);
            return {
              attemptId: anon ? pseudonym('ATT', attempt.id) : attempt.id,
              applicationId: candidate ? candidateRef(candidate.id, candidate.applicationId) : '',
              candidateName: candidate ? candidateName(candidate.id, candidate.fullName) : '',
              workstation: db.devices.get(attempt.deviceId)?.deviceCode ?? '',
              status: attempt.status,
              identityStatus: attempt.identityStatus,
              connectionStatus: attempt.connectionStatus,
              startedAt: attempt.startedAt ?? '',
              expiresAt: attempt.expiresAt ?? '',
              submittedAt: attempt.submittedAt ?? '',
              answered: attempt.answeredCount,
              flagged: attempt.flaggedCount,
              additionalTimeMinutes: attempt.additionalTimeMinutes,
              monitoringFailures: attempt.consecutiveMonitoringFailures,
              alertLevel: attempt.alertLevel,
            };
          });
        break;

      case 'ANSWERS': {
        const rows: Record<string, unknown>[] = [];
        [...db.attempts.values()]
          .filter((a) => a.examId === exam.id)
          .forEach((attempt) => {
            const assignment = attempt.assignmentId ? db.assignments.get(attempt.assignmentId) : undefined;
            const candidate = db.candidates.get(attempt.candidateId);
            assignment?.questions.forEach((question) => {
              const answer = db.answers.get(`${attempt.id}:${question.id}`);
              const version = db.questionVersions.get(question.questionVersionId);
              rows.push({
                applicationId: candidate ? candidateRef(candidate.id, candidate.applicationId) : '',
                sequence: question.sequence,
                questionId: question.questionId,
                category: version?.categoryCode ?? '',
                type: question.type,
                marks: question.marks,
                selectedOptions: (answer?.selectedOptionIds ?? [])
                  .map((id) => version?.options.find((o) => o.id === id)?.label ?? id)
                  .join(', '),
                textAnswer: answer?.textAnswer ?? '',
                answerVersion: answer?.version ?? 0,
                flagged: answer?.flagged ?? false,
                updatedAt: answer?.updatedAt ?? '',
              });
            });
          });
        data.Answers = rows;
        break;
      }

      case 'RECEIPTS':
        data.Receipts = [...db.receipts.values()]
          .filter((r) => r.examId === exam.id)
          .map((receipt) => ({
            receiptId: receipt.receiptId,
            applicationId: anon ? pseudonym('APP', receipt.attemptId) : receipt.applicationId,
            candidateName: anon ? pseudonym('CAND', receipt.attemptId) : receipt.candidateName,
            workstation: receipt.deviceCode,
            submittedAt: receipt.submittedAt,
            answered: receipt.answeredCount,
            unanswered: receipt.unansweredCount,
            total: receipt.totalQuestions,
            answerSetFingerprint: receipt.answerSetHash,
            paperFingerprint: receipt.manifestHash,
            auditAnchor: receipt.auditAnchorHash,
          }));
        break;

      case 'PROCTORING_EVENTS':
        data.MonitoringEvents = db.proctoringEvents
          .filter((e) => e.examId === exam.id)
          .map((event) => {
            const candidate = db.candidates.get(event.candidateId);
            return {
              applicationId: candidate ? candidateRef(candidate.id, candidate.applicationId) : '',
              sequence: event.sequence,
              result: event.result,
              severity: event.severity,
              confidence: event.confidence.toFixed(2),
              capturedAt: event.capturedAt,
              receivedAt: event.receivedAt,
              evidenceChainHash: event.evidenceHash,
              simulated: event.simulated,
            };
          });
        break;

      case 'INCIDENTS':
        data.Incidents = [...db.incidents.values()]
          .filter((i) => i.examId === exam.id)
          .map((incident) => ({
            type: incident.type,
            severity: incident.severity,
            status: incident.status,
            title: incident.title,
            detail: incident.detail,
            candidate: incident.candidateId
              ? candidateRef(incident.candidateId, db.candidates.get(incident.candidateId)?.applicationId ?? '')
              : '',
            workstation: incident.deviceId ? (db.devices.get(incident.deviceId)?.deviceCode ?? '') : '',
            notes: incident.notes.map((n) => `${n.authorName}: ${n.body}`).join(' | '),
            createdAt: incident.createdAt,
            updatedAt: incident.updatedAt,
          }));
        break;

      case 'AUDIT_TRAIL': {
        const attemptIds = new Set(
          [...db.attempts.values()].filter((a) => a.examId === exam.id).map((a) => a.id),
        );
        data.AuditTrail = db.auditEvents
          .filter((e) => e.targetId === exam.id || attemptIds.has(e.targetId) || e.targetLabel.includes(exam.code))
          .map((event) => ({
            sequence: event.sequence,
            timestamp: event.timestamp,
            actor: anon ? pseudonym('ACTOR', event.actorId) : event.actorName,
            role: event.actorRole,
            action: event.action,
            target: event.targetLabel,
            result: event.result,
            reason: event.reason,
            ipAddress: anon ? '' : event.ipAddress,
            traceId: event.traceId,
            previousHash: event.previousHash,
            hash: event.hash,
          }));
        break;
      }

      case 'TRACKING_FINDINGS':
        data.TrackingFindings = [...db.trackingFindings.values()]
          .filter((f) => f.examId === exam.id)
          .map((finding) => ({
            check: finding.checkId,
            severity: finding.severity,
            title: finding.title,
            detail: finding.detail,
            action: finding.action,
            occurrences: finding.occurrences,
            firstSeenAt: finding.firstSeenAt,
            lastSeenAt: finding.lastSeenAt,
            acknowledged: finding.acknowledgedAt !== null,
            acknowledgementReason: finding.acknowledgementReason ?? '',
            resolved: finding.resolvedAt !== null,
            subjects: finding.subjects.map((s) => `${s.label}: ${s.detail}`).join(' | '),
          }));
        break;
    }
  }

  const rowCounts: Record<string, number> = {};
  Object.entries(data).forEach(([key, rows]) => {
    rowCounts[key] = rows.length;
  });

  const contentHash = sha256Canonical(data);
  const sensitive = granted.some((s) => EXPORT_SECTIONS.find((info) => info.id === s)?.sensitive);
  const extension = input.format === 'XLSX' ? 'xlsx' : input.format === 'JSON' ? 'json' : 'zip';
  const fileName = `${exam.code}-export-${new Date().toISOString().slice(0, 10)}.${extension}`;

  const audit = recordAudit({
    actorId: input.user.id,
    actorName: input.user.fullName,
    actorRole: (input.user.roles[0] ?? 'SYSTEM') as never,
    action: 'ADMIN_OVERRIDE',
    targetType: 'ExamExport',
    targetId: exam.id,
    targetLabel: `${exam.code} export (${granted.join(', ')})`,
    reason: `${input.reason} — ${granted.length} section(s)${anon ? ', pseudonymised' : ''}. Content fingerprint ${contentHash.slice(0, 16)}.`,
    ipAddress: input.ipAddress,
    traceId: input.traceId,
  });

  const manifest: ExportManifest = {
    id: randomUUID(),
    examId: exam.id,
    examCode: exam.code,
    format: input.format,
    sections: granted,
    rowCounts,
    generatedAt: new Date().toISOString(),
    generatedByUserId: input.user.id,
    generatedByName: input.user.fullName,
    reason: input.reason,
    pseudonymised: anon,
    contentHash,
    sizeBytes: Buffer.byteLength(JSON.stringify(data), 'utf8'),
    fileName,
    auditEventId: audit.id,
    handlingNotice:
      sensitive && !anon
        ? 'This export contains personal data and/or the answer key. Store it on approved storage only, share it with named recipients only, and delete it when the stated purpose is complete.'
        : null,
  };

  db.exportManifests.set(manifest.id, manifest);

  return { manifest, data, withheldSections: withheld };
}

/** Sections the given user may include, for the export interface. */
export function availableSections(user: SessionUser) {
  return EXPORT_SECTIONS.map((section) => ({
    ...section,
    permitted: rolesHavePermission(user.roles as Role[], section.requiredPermission as Permission),
  }));
}
