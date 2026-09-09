import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createExamSchema,
  effectiveControls,
  networkRangesUpdateSchema,
  quotaTotalDelivered,
  SECURITY_PROFILE_DEFINITIONS,
  updateSecurityPolicySchema,
  type Candidate,
  type ExaminationDevice,
  type Exam,
  type ExamManifest,
  type QuestionVersion,
  type Question,
  type QuestionCategory,
} from '@sep/shared';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { ctx, requirePermission } from '../lib/session.js';
import { noStore, parse } from '../lib/http.js';
import { keyProvider } from '../lib/crypto/keyProvider.js';
import { questionContentHash, releaseWindowOpen, sealPaper, verifyPaperIntegrity } from '../lib/crypto/paper.js';
import { assemblePool, describeShortfall } from '../services/paperAssembly.js';
import { hashPassword } from '../lib/password.js';
import { issueCertificate, upsertAssignment } from '../services/deviceService.js';
import { normaliseRangeBody } from '../lib/network.js';

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
    const demoData = createExamDemoData({
      exam,
      actorUserId: user.id,
      options: body.demoData,
    });

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'EXAM_CREATED',
      targetType: 'Exam',
      targetId: exam.id,
      targetLabel: `${exam.name} (${exam.code})`,
      reason: `Created with the ${SECURITY_PROFILE_DEFINITIONS[exam.securityPolicy.profileId].name} security profile and ${exam.candidateCount} candidate(s). Demo setup added ${demoData.questions} question(s), ${demoData.candidates} candidate(s) and ${demoData.devices} workstation(s).`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({ exam, demoData });
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

  /**
   * Approved network ranges of one examination.
   *
   * An examination copies its ranges from its centre when it is created, so a
   * published examination has its own. Candidates who were given the
   * examination ranges follow the change; a candidate deliberately given their
   * own ranges - one hall on a separate VLAN - keeps them.
   */
  app.post('/exams/:examId/networks', async (request, reply) => {
    const user = requirePermission(request, 'system.security.write');
    const context = ctx(request);
    const db = getDb();
    const { examId } = request.params as { examId: string };
    const exam = db.exams.get(examId);
    if (!exam) throw Errors.notFound('That examination');

    const body = parse(networkRangesUpdateSchema, normaliseRangeBody(request.body));
    const network = exam.securityPolicy.network;
    const inherited = [network.primaryCidr, network.backupCidr].filter((cidr): cidr is string => Boolean(cidr));
    const previous = [network.primaryCidr, network.backupCidr, network.ipv6Cidr].filter(Boolean).join(', ');

    network.primaryCidr = body.primaryCidr;
    network.backupCidr = body.backupCidr;
    network.ipv6Cidr = body.ipv6Cidr;
    exam.securityPolicy.updatedAt = new Date().toISOString();
    exam.securityPolicy.updatedByUserId = user.id;

    const replacement = [body.primaryCidr, body.backupCidr].filter((cidr): cidr is string => Boolean(cidr));
    let realigned = 0;
    for (const assignment of db.deviceAssignments.values()) {
      if (assignment.examId !== exam.id || assignment.releasedAt !== null) continue;
      const carried = assignment.allowedCidrs;
      const inheritedRanges =
        carried.length === inherited.length && carried.every((cidr, index) => cidr === inherited[index]);
      if (!inheritedRanges) continue;
      assignment.allowedCidrs = replacement;
      assignment.updatedAt = new Date().toISOString();
      realigned += 1;
    }

    const current = [network.primaryCidr, network.backupCidr, network.ipv6Cidr].filter(Boolean).join(', ');
    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'NETWORK_POLICY_UPDATED',
      targetType: 'Exam',
      targetId: exam.id,
      targetLabel: `${exam.code} ${exam.name}`,
      reason: `${body.reason} Ranges changed from ${previous || 'none'} to ${current}. ${realigned} candidate assignment(s) realigned.`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ exam: summariseExam(exam), network, realignedAssignments: realigned });
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

function createExamDemoData(input: {
  exam: Exam;
  actorUserId: string;
  options: {
    questions: boolean;
    candidates: boolean;
    devices: boolean;
    candidateCount: number;
    deviceCount: number;
  };
}): { questions: number; candidates: number; devices: number; assignments: number } {
  const { exam, actorUserId, options } = input;
  const db = getDb();
  const devices = options.devices ? createDemoDevices(exam, options.deviceCount) : [];
  const questions = options.questions ? createDemoQuestions(exam, actorUserId) : 0;
  const candidates = options.candidates ? createDemoCandidates(exam, options.candidateCount) : [];
  const usableDevices =
    devices.length > 0
      ? devices
      : [...db.devices.values()].filter((device) => device.centreId === exam.centreId && device.status === 'APPROVED');

  let assignments = 0;
  if (exam.securityPolicy.verification.requireAssignedDevice && candidates.length > 0 && usableDevices.length > 0) {
    candidates.forEach((candidate, index) => {
      const registration = [...db.registrations.values()].find(
        (entry) => entry.examId === exam.id && entry.candidateId === candidate.id,
      );
      const device = usableDevices[index % usableDevices.length]!;
      upsertAssignment({
        examId: exam.id,
        candidateId: candidate.id,
        candidateApplicationId: candidate.applicationId,
        candidateName: candidate.fullName,
        deviceId: device.id,
        seatNumber: registration?.seatNumber || `D-${String(index + 1).padStart(3, '0')}`,
        allowedCidrs: [exam.securityPolicy.network.primaryCidr, exam.securityPolicy.network.backupCidr].filter(
          (cidr): cidr is string => Boolean(cidr),
        ),
        allowAnyApprovedDevice: false,
      });
      assignments += 1;
    });
  }

  exam.candidateCount = [...db.registrations.values()].filter((registration) => registration.examId === exam.id).length;
  return { questions, candidates: candidates.length, devices: devices.length, assignments };
}

function createDemoQuestions(exam: Exam, actorUserId: string): number {
  const db = getDb();
  const bank = db.examQuestions.get(exam.id) ?? new Set<string>();
  let created = 0;

  for (const allocation of exam.blueprint.categoryAllocations) {
    const category = db.categories.get(allocation.categoryId);
    if (!category) continue;

    (['EASY', 'MEDIUM', 'DIFFICULT'] as const).forEach((difficulty) => {
      const count = allocation.difficultyMix[difficulty] ?? 0;
      for (let index = 1; index <= count; index += 1) {
        const questionId = randomUUID();
        const versionId = randomUUID();
        const sequence = db.questions.size + 1;
        const type = objectiveTypeFor(category);
        const options = demoOptionsFor(questionId, type);
        const subject = category.subject ?? exam.subject;
        const version: QuestionVersion = {
          id: versionId,
          questionId,
          version: 1,
          stem: demoStem(subject, category.name, difficulty, index),
          type,
          options,
          categoryId: category.id,
          categoryCode: category.code,
          marks: category.marksPerQuestion,
          negativeMarks: category.negativeMarksPerQuestion,
          paragraphWordLimit: category.paragraphWordLimit,
          markingGuidance:
            type === 'PARAGRAPH'
              ? 'Award marks for a clear structure, relevant points and accurate supporting examples.'
              : '',
          subject,
          topic: category.name,
          difficulty,
          explanation: `Synthetic ${difficulty.toLowerCase()} demo item generated for ${exam.code}.`,
          reviewerNotes: 'Generated as approved sample content during demo exam setup.',
          status: 'APPROVED',
          createdAt: new Date().toISOString(),
          createdByUserId: actorUserId,
          contentHash: '',
          immutable: true,
        };
        version.contentHash = questionContentHash(version);
        db.questionVersions.set(version.id, version);

        const question: Question = {
          id: questionId,
          code: `Q-${String(sequence).padStart(4, '0')}`,
          currentVersionId: version.id,
          status: 'APPROVED',
          authorUserId: actorUserId,
          categoryId: category.id,
          categoryCode: category.code,
          subject,
          topic: category.name,
          difficulty,
          marks: category.marksPerQuestion,
          type,
          createdAt: version.createdAt,
          updatedAt: version.createdAt,
        };
        db.questions.set(question.id, question);
        const reviewId = randomUUID();
        db.questionReviews.set(reviewId, {
          id: reviewId,
          questionId,
          questionVersionId: version.id,
          reviewerUserId: actorUserId,
          decision: 'APPROVED',
          comment: 'Approved automatically as synthetic demo content for client walkthroughs.',
          createdAt: version.createdAt,
        });
        bank.add(question.id);
        created += 1;
      }
    });
  }

  db.examQuestions.set(exam.id, bank);
  return created;
}

function objectiveTypeFor(category: QuestionCategory): Question['type'] {
  if (category.allowedTypes.includes('SINGLE_CHOICE')) return 'SINGLE_CHOICE';
  if (category.allowedTypes.includes('TRUE_FALSE')) return 'TRUE_FALSE';
  if (category.allowedTypes.includes('MULTIPLE_CHOICE')) return 'MULTIPLE_CHOICE';
  return category.allowedTypes[0] ?? 'SINGLE_CHOICE';
}

function demoOptionsFor(questionId: string, type: Question['type']): QuestionVersion['options'] {
  if (type === 'PARAGRAPH' || type === 'SHORT_TEXT') return [];
  if (type === 'TRUE_FALSE') {
    return [
      { id: `${questionId}-opt-1`, label: 'A', text: 'True', isCorrect: true },
      { id: `${questionId}-opt-2`, label: 'B', text: 'False', isCorrect: false },
    ];
  }
  return [
    { id: `${questionId}-opt-1`, label: 'A', text: 'Option A is the correct response.', isCorrect: true },
    { id: `${questionId}-opt-2`, label: 'B', text: 'Option B is a plausible distractor.', isCorrect: type === 'MULTIPLE_CHOICE' },
    { id: `${questionId}-opt-3`, label: 'C', text: 'Option C is not correct.', isCorrect: false },
    { id: `${questionId}-opt-4`, label: 'D', text: 'Option D is not correct.', isCorrect: false },
  ];
}

function demoStem(subject: string, category: string, difficulty: QuestionVersion['difficulty'], index: number): string {
  return `Synthetic ${difficulty.toLowerCase()} ${category} question ${index}: choose the best answer for a ${subject} client demonstration.`;
}

function createDemoCandidates(exam: Exam, count: number): Candidate[] {
  const db = getDb();
  const credential = hashPassword('Exam!2026');
  const names = ['Aarav Sharma', 'Meera Iyer', 'Kabir Khan', 'Nisha Rao', 'Ishaan Verma', 'Riya Sen'];
  const created: Candidate[] = [];

  for (let index = 1; index <= count; index += 1) {
    const applicationId = nextDemoApplicationId(exam, index);
    const fullName = `${names[(index - 1) % names.length]} ${Math.ceil(index / names.length)}`;
    const id = randomUUID();
    const candidate: Candidate = {
      id,
      candidateId: `CND-${String(db.candidates.size + 1).padStart(5, '0')}`,
      applicationId,
      fullName,
      photoSeed: `${fullName.replace(/\s+/g, '-').toLowerCase()}-${exam.code.toLowerCase()}`,
      email: `${applicationId.toLowerCase()}@candidates.demo`,
      eligibility: 'ELIGIBLE',
      examId: exam.id,
      centreId: exam.centreId,
      accommodations: { additionalTimeMinutes: index % 12 === 0 ? 15 : 0, requirements: [], notes: '' },
      fingerprintEnrolled: index % 4 !== 0,
      faceEnrolled: true,
      biometricReferenceId: `demo-bio-${applicationId.toLowerCase()}`,
      accountStatus: 'ACTIVE',
      lastVerificationEvent: null,
    };
    db.candidates.set(candidate.id, candidate);
    db.candidateCredentials.set(candidate.applicationId, {
      candidateId: candidate.id,
      applicationId: candidate.applicationId,
      passwordHash: credential.hash,
      salt: credential.salt,
      demoPassword: 'Exam!2026',
    });
    const registrationId = randomUUID();
    db.registrations.set(registrationId, {
      id: registrationId,
      examId: exam.id,
      candidateId: candidate.id,
      centreId: exam.centreId,
      seatNumber: `D-${String(index).padStart(3, '0')}`,
      status: 'REGISTERED',
      createdAt: new Date().toISOString(),
    });
    created.push(candidate);
  }
  return created;
}

function nextDemoApplicationId(exam: Exam, start: number): string {
  const db = getDb();
  const prefix = `${exam.code.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 10) || 'DEMO'}D`;
  let serial = start;
  while (true) {
    const applicationId = `${prefix}-${String(serial).padStart(6, '0')}`;
    if (!db.candidateCredentials.has(applicationId)) return applicationId;
    serial += 1;
  }
}

function createDemoDevices(exam: Exam, count: number): ExaminationDevice[] {
  const db = getDb();
  const centre = db.centres.get(exam.centreId);
  const codePrefix = `WS-${centre?.code ?? 'CENTRE'}`.replace(/\s+/g, '').toUpperCase();
  const networkParts = exam.securityPolicy.network.primaryCidr.split('/')[0]?.split('.') ?? [];
  const ipPrefix = networkParts.length >= 2 ? `${networkParts[0]}.${networkParts[1]}` : '10.99';
  const created: ExaminationDevice[] = [];

  for (let index = 1; index <= count; index += 1) {
    let serial = index;
    let deviceCode = `${codePrefix}-${String(serial).padStart(3, '0')}`;
    while ([...db.devices.values()].some((device) => device.deviceCode === deviceCode)) {
      serial += 1;
      deviceCode = `${codePrefix}-${String(serial).padStart(3, '0')}`;
    }
    const now = new Date().toISOString();
    const device: ExaminationDevice = {
      id: randomUUID(),
      deviceCode,
      name: `Demo workstation ${serial}`,
      centreId: exam.centreId,
      operatingSystem: 'Windows 11 Enterprise 23H2',
      kioskPolicyVersion: exam.securityPolicy.network.minimumDevicePolicyVersion,
      status: 'APPROVED',
      certificate: issueCertificate(deviceCode),
      lastHealthCheckAt: now,
      cameraStatus: 'OK',
      fingerprintScannerStatus: 'OK',
      networkStatus: 'OK',
      ipAddress: `${ipPrefix}.20.${10 + serial}`,
      notes: 'Created as an approved demo workstation during exam setup.',
    };
    db.devices.set(device.id, device);
    created.push(device);
  }

  return created;
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
