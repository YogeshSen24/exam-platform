import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createExamSchema,
  effectiveControls,
  quotaTotalDelivered,
  SECURITY_PROFILE_DEFINITIONS,
  updateSecurityPolicySchema,
  type Exam,
  type ExamManifest,
  type QuestionVersion,
} from '@sep/shared';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, parse } from '../lib/http.js';
import { keyProvider } from '../lib/crypto/keyProvider.js';
import { releaseWindowOpen, sealPaper, verifyPaperIntegrity } from '../lib/crypto/paper.js';
import { assemblePool, describeShortfall } from '../services/paperAssembly.js';

export async function examRoutes(app: FastifyInstance): Promise<void> {
  app.get('/exams', async (request, reply) => {
    requirePermission(request, 'exams.read');
    const db = getDb();
    const exams = [...db.exams.values()].map((exam) => summariseExam(exam));
    return noStore(reply).send({ items: exams, total: exams.length });
  });

  app.get('/exams/:examId', async (request, reply) => {
    requirePermission(request, 'exams.read');
    const db = getDb();
    const { examId } = request.params as { examId: string };
    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');

    const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
    const registrations = [...db.registrations.values()].filter((r) => r.examId === examId);
    const attempts = [...db.attempts.values()].filter((a) => a.examId === examId);

    return noStore(reply).send({
      exam,
      centre: db.centres.get(exam.centreId) ?? null,
      profile: SECURITY_PROFILE_DEFINITIONS[exam.securityPolicy.profileId],
      effectiveControls: effectiveControls(exam.securityPolicy.profileId),
      manifest: manifest ?? null,
      approvals: manifest
        ? [...db.publicationApprovals.values()].filter((a) => a.manifestId === manifest.id)
        : [],
      stats: {
        registered: registrations.length,
        started: attempts.length,
        submitted: attempts.filter((a) => a.status === 'SUBMITTED').length,
      },
    });
  });

  app.post('/exams', async (request, reply) => {
    const user = requirePermission(request, 'exams.write');
    const context = ctx(request);
    const body = parse(createExamSchema, request.body);
    const db = getDb();

    if ([...db.exams.values()].some((e) => e.code === body.basics.code)) {
      throw Errors.conflict(
        `Examination code ${body.basics.code} is already in use.`,
        'Choose a different code — codes appear on admit cards and must be unique.',
      );
    }

    if (!db.centres.has(body.basics.centreId)) throw Errors.validation({ centreId: 'Select an existing centre.' });
    if (body.candidateIds.some(id => !db.candidates.has(id))) throw Errors.validation({ candidateIds: 'A selected candidate no longer exists.' });
    if ([...db.attempts.values()].some(a => body.candidateIds.includes(a.candidateId) && !['SUBMITTED', 'TERMINATED'].includes(a.status))) throw Errors.conflict('Some selected candidates have an unfinished attempt.', 'Finish their current examination before assigning a new one.');
    const seenCategories = new Set<string>();
    for (const allocation of body.blueprint.categoryAllocations) {
      const category = db.categories.get(allocation.categoryId);
      if (!category || category.archived || seenCategories.has(category.id)) throw Errors.validation({ categoryAllocations: 'Use distinct active categories.' });
      seenCategories.add(category.id);
      if (allocation.marksPerQuestion !== category.marksPerQuestion || allocation.negativeMarksPerQuestion !== category.negativeMarksPerQuestion) throw Errors.validation({ categoryAllocations: 'Category marks changed. Reload the categories before creating the examination.' });
      allocation.categoryCode = category.code;
      allocation.categoryName = category.name;
      allocation.totalMarks = allocation.questionCount * category.marksPerQuestion;
    }
    const now = new Date().toISOString();
    const exam: Exam = {
      id: randomUUID(),
      ...body.basics,
      startsAt: new Date(body.basics.startsAt).toISOString(),
      status: 'DRAFT',
      blueprint: body.blueprint,
      securityPolicy: {
        profileId: body.securityProfileId,
        verification: body.verification,
        monitoring: body.monitoring,
        network: body.network,
        updatedAt: now,
        updatedByUserId: user.id,
      },
      createdByUserId: user.id,
      createdAt: now,
      updatedAt: now,
      candidateCount: body.candidateIds.length,
      manifestId: null,
    };
    db.exams.set(exam.id, exam);

    body.candidateIds.forEach((candidateId) => {
      const candidate = db.candidates.get(candidateId);
      if (!candidate) return;
      candidate.examId = exam.id;
      candidate.centreId = exam.centreId;
      const id = randomUUID();
      db.registrations.set(id, {
        id,
        examId: exam.id,
        candidateId,
        centreId: exam.centreId,
        seatNumber: `S-${String(db.registrations.size + 1).padStart(4, '0')}`,
        status: 'REGISTERED',
        createdAt: now,
      });
    });

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'EXAM_CREATED',
      targetType: 'Exam',
      targetId: exam.id,
      targetLabel: `${exam.name} (${exam.code})`,
      reason: `Created with the ${SECURITY_PROFILE_DEFINITIONS[exam.securityPolicy.profileId].name} security profile and ${body.candidateIds.length} candidate(s).`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ exam });
  });

  app.put('/exams/:examId/security-policy', async (request, reply) => {
    const user = requirePermission(request, 'exams.securityPolicy.write');
    const context = ctx(request);
    const { examId } = request.params as { examId: string };
    const body = parse(updateSecurityPolicySchema, request.body);
    const db = getDb();

    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');
    if (exam.status === 'IN_PROGRESS') {
      throw Errors.conflict(
        'The security policy cannot be changed while the examination is running.',
        'Wait until the examination has finished, or raise an incident with the examination controller.',
      );
    }

    exam.securityPolicy = {
      profileId: body.securityProfileId,
        verification: body.verification,
      monitoring: body.monitoring,
      network: body.network,
      updatedAt: new Date().toISOString(),
      updatedByUserId: user.id,
    };
    exam.updatedAt = exam.securityPolicy.updatedAt;

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'SECURITY_POLICY_MODIFIED',
      targetType: 'Exam',
      targetId: exam.id,
      targetLabel: `${exam.name} (${exam.code})`,
      reason: body.reason,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ exam });
  });

  /* ---------------- Paper assembly, publication, integrity ---------- */

  app.post('/exams/:examId/assemble-paper', async (request, reply) => {
    const user = requirePermission(request, 'exams.write');
    const context = ctx(request);
    const { examId } = request.params as { examId: string };
    const db = getDb();
    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');

    if (exam.status !== 'DRAFT' && exam.status !== 'PENDING_APPROVAL') throw Errors.conflict('This examination is already published or running.', 'Create a new examination to change its paper.');
    // Published versions remain approved, immutable content and can be drawn
    // into a later paper; drafts and questions under review cannot.
    const approved = [...db.questions.values()]
      .filter((q) => db.examQuestions.get(examId)?.has(q.id) && (q.status === 'APPROVED' || q.status === 'PUBLISHED'))
      .map((q) => db.questionVersions.get(q.currentVersionId))
      .filter((v): v is QuestionVersion => Boolean(v));

    if (approved.length < exam.blueprint.totalQuestions) {
      throw Errors.conflict(
        `Only ${approved.length} approved questions are available; the blueprint requires ${exam.blueprint.totalQuestions}.`,
        'Approve more questions in the question bank before assembling the paper.',
      );
    }

    // Seal the whole approved pool, not one candidate's paper. Every approved
    // question that fits a category's marking scheme goes into the package;
    // the quotas record how many of them each candidate actually receives.
    const { versions, quotas, shortfalls } = assemblePool(exam, approved);
    if (shortfalls.length > 0) {
      throw Errors.conflict(
        shortfalls.map(describeShortfall).join(' '),
        'Approve matching questions or revise the blueprint.',
      );
    }
    if (quotaTotalDelivered(quotas) !== exam.blueprint.totalQuestions) {
      throw Errors.conflict('The category allocations are incomplete.', 'Complete the blueprint before assembling the paper.');
    }

    const nextVersion = ([...db.manifests.values()].filter((m) => m.examId === examId).length || 0) + 1;
    const { manifest, envelope } = await sealPaper({
      exam,
      versions,
      quotas,
      createdByUserId: user.id,
      examVersion: nextVersion,
    });

    db.manifests.set(manifest.id, manifest);
    db.sealedPackages.set(manifest.id, { manifestId: manifest.id, envelope });
    exam.manifestId = manifest.id;
    exam.status = 'PENDING_APPROVAL';
    versions.forEach((v) => {
      v.immutable = true;
    });

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'PAPER_ASSEMBLED',
      targetType: 'ExamManifest',
      targetId: manifest.id,
      targetLabel: `${exam.code} manifest v${nextVersion}`,
      reason: `${versions.length} approved questions fingerprinted into a sealed pool, signed and encrypted. Each candidate draws ${manifest.deliveredQuestionCount} of them.`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ manifest });
  });

  app.post('/exams/:examId/request-publication', async (request, reply) => {
    const user = requirePermission(request, 'exams.publish.request');
    const context = ctx(request);
    const { examId } = request.params as { examId: string };
    const db = getDb();
    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');
    const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
    if (!manifest) throw Errors.conflict('No paper has been assembled yet.', 'Assemble the paper before requesting publication.');

    manifest.publicationStatus = 'AWAITING_APPROVAL';
    exam.status = 'PENDING_APPROVAL';

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'PUBLICATION_REQUESTED',
      targetType: 'ExamManifest',
      targetId: manifest.id,
      targetLabel: `${exam.code} manifest v${manifest.examVersion}`,
      reason: `Publication requested. Dual approval required: ${SECURITY_PROFILE_DEFINITIONS[exam.securityPolicy.profileId].name} profile.`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ manifest });
  });

  app.post('/exams/:examId/approve-publication', async (request, reply) => {
    const user = requirePermission(request, 'exams.publish.approve');
    const context = ctx(request);
    const { examId } = request.params as { examId: string };
    const body = parse(
      z.object({ decision: z.enum(['APPROVED', 'REJECTED']), comment: z.string().min(5).max(500) }),
      request.body,
    );
    const db = getDb();
    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');
    const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
    if (!manifest) throw Errors.notFound('A paper manifest for this examination');

    // Separation of duties: the person who requested publication cannot also
    // approve it unless the demo override is explicitly enabled.
    if (!env.ALLOW_SELF_APPROVAL && manifest.createdByUserId === user.id) {
      throw Errors.forbidden(
        'approving a paper you assembled — a different authorised approver is required (separation of duties)',
      );
    }

    const existing = [...db.publicationApprovals.values()].filter((a) => a.manifestId === manifest.id);
    if (existing.some((a) => a.approverUserId === user.id)) {
      throw Errors.conflict('You have already recorded a decision on this paper.', 'A second, different approver is required.');
    }

    const id = randomUUID();
    db.publicationApprovals.set(id, {
      id,
      manifestId: manifest.id,
      examId: exam.id,
      approverUserId: user.id,
      approverName: user.fullName,
      approverRole: user.roles[0] ?? 'SECURITY_ADMIN',
      decision: body.decision,
      comment: body.comment,
      createdAt: new Date().toISOString(),
    });

    const approvals = [...db.publicationApprovals.values()].filter(
      (a) => a.manifestId === manifest.id && a.decision === 'APPROVED',
    );
    const requiredApprovals = SECURITY_PROFILE_DEFINITIONS[exam.securityPolicy.profileId].flags
      .dualApprovalBeforePublication
      ? 2
      : 1;

    let published = false;
    if (body.decision === 'REJECTED') {
      manifest.publicationStatus = 'BLOCKED';
    } else if (approvals.length >= requiredApprovals) {
      // Verify integrity once more immediately before publishing.
      const report = await verifyPaperIntegrity(manifest, (vid) => db.questionVersions.get(vid));
      manifest.integrityStatus = report.ok ? 'VERIFIED' : 'FAILED';
      manifest.integrityCheckedAt = report.checkedAt;
      manifest.verifiedQuestionCount = report.verifiedQuestionCount;
      if (!report.ok) {
        manifest.publicationStatus = 'BLOCKED';
        recordAudit({
          actorId: 'system',
          actorName: 'Integrity service',
          actorRole: 'SYSTEM',
          action: 'INTEGRITY_CHECK',
          targetType: 'ExamManifest',
          targetId: manifest.id,
          targetLabel: `${exam.code} manifest v${manifest.examVersion}`,
          result: 'BLOCKED',
          reason: report.summary,
          ipAddress: context.ipAddress,
          traceId: context.traceId,
        });
        throw Errors.paperIntegrity(report.summary);
      }
      manifest.publicationStatus = 'PUBLISHED';
      exam.status = 'PUBLISHED';
      published = true;
      manifest.entries.forEach((entry) => {
        const version = db.questionVersions.get(entry.questionVersionId);
        if (version) version.status = 'PUBLISHED';
        const question = db.questions.get(entry.questionId);
        if (question) question.status = 'PUBLISHED';
      });
    }

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: published ? 'EXAM_PUBLISHED' : 'PUBLICATION_APPROVED',
      targetType: 'ExamManifest',
      targetId: manifest.id,
      targetLabel: `${exam.code} manifest v${manifest.examVersion}`,
      result: body.decision === 'REJECTED' ? 'BLOCKED' : 'SUCCESS',
      reason: `${body.decision === 'APPROVED' ? 'Approved' : 'Rejected'} (${approvals.length}/${requiredApprovals} approvals). ${body.comment}`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({
      manifest,
      approvals: [...db.publicationApprovals.values()].filter((a) => a.manifestId === manifest.id),
      requiredApprovals,
      published,
    });
  });

  /** Paper-integrity screen: verifies and explains the current state. */
  app.get('/exams/:examId/integrity', async (request, reply) => {
    requirePermission(request, 'exams.read');
    const { examId } = request.params as { examId: string };
    const db = getDb();
    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');
    const manifest = exam.manifestId ? db.manifests.get(exam.manifestId) : undefined;
    if (!manifest) return noStore(reply).send({ manifest: null, report: null });

    const report = await verifyPaperIntegrity(manifest, (id) => db.questionVersions.get(id));
    manifest.integrityStatus = report.ok ? 'VERIFIED' : 'FAILED';
    manifest.integrityCheckedAt = report.checkedAt;
    manifest.verifiedQuestionCount = report.verifiedQuestionCount;
    if (!report.ok && manifest.publicationStatus === 'PUBLISHED') {
      manifest.publicationStatus = 'BLOCKED';
    }

    return noStore(reply).send({
      manifest: redactManifest(manifest),
      report,
      approvals: [...db.publicationApprovals.values()].filter((a) => a.manifestId === manifest.id),
      keyProvider: keyProvider().describe(),
      releaseWindowOpen: releaseWindowOpen(manifest),
      requiredApprovals: SECURITY_PROFILE_DEFINITIONS[exam.securityPolicy.profileId].flags
        .dualApprovalBeforePublication
        ? 2
        : 1,
    });
  });

  app.get('/security-profiles', async (_request, reply) => {
    return noStore(reply).send({
      profiles: Object.values(SECURITY_PROFILE_DEFINITIONS).map((p) => ({
        ...p,
        effectiveControls: effectiveControls(p.id),
      })),
      recommended: 'MAXIMUM_ASSURANCE',
      recommendationReason:
        'The examination centre, network, workstations and operating-system configuration are controlled by the organisation, which is what the additional controls in this profile assume.',
    });
  });
}

/** Never expose key material or ciphertext through the API. */
function redactManifest(manifest: ExamManifest) {
  return {
    ...manifest,
    // Entry hashes are safe to show; they are fingerprints, not content.
    signature: `${manifest.signature.slice(0, 24)}…`,
    signatureFull: undefined,
  };
}

function summariseExam(exam: Exam) {
  const db = getDb();
  const attempts = [...db.attempts.values()].filter((a) => a.examId === exam.id);
  return {
    id: exam.id,
    name: exam.name,
    code: exam.code,
    subject: exam.subject,
    status: exam.status,
    startsAt: exam.startsAt,
    durationMinutes: exam.durationMinutes,
    centreId: exam.centreId,
    centreName: db.centres.get(exam.centreId)?.name ?? 'Unknown',
    securityProfileId: exam.securityPolicy.profileId,
    totalQuestions: exam.blueprint.totalQuestions,
    totalMarks: exam.blueprint.totalMarks,
    candidateCount: [...db.registrations.values()].filter((r) => r.examId === exam.id).length,
    activeAttempts: attempts.filter((a) => a.status === 'ACTIVE' || a.status === 'RESTRICTED').length,
    submitted: attempts.filter((a) => a.status === 'SUBMITTED').length,
    manifestId: exam.manifestId ?? null,
  };
}
