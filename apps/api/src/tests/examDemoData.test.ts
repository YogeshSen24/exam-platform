import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { defaultVerificationPolicy, type ExamBlueprint } from '@sep/shared';
import { authHeaders, loginStaff, startApp } from './helpers.js';
import { getDb } from '../lib/store/db.js';

describe('exam creation demo data', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('can create sample questions, candidates, workstations and device assignments', async () => {
    const db = getDb();
    const staff = await loginStaff(app, 'exam.admin@examboard.demo');
    const centre = db.centres.get('centre-central')!;
    const categories = [...db.categories.values()]
      .filter((category) => !category.archived && category.subject)
      .slice(0, 2);
    const totalQuestions = categories.length * 3;
    const totalMarks = categories.reduce((sum, category) => sum + category.marksPerQuestion * 3, 0);
    const blueprint: ExamBlueprint = {
      totalQuestions,
      totalMarks,
      difficultyDistribution: { EASY: categories.length, MEDIUM: categories.length, DIFFICULT: categories.length },
      subjectDistribution: categories.map((category) => ({ subject: category.subject ?? 'General Aptitude', count: 3 })),
      categoryAllocations: categories.map((category) => ({
        categoryId: category.id,
        categoryCode: category.code,
        categoryName: category.name,
        questionCount: 3,
        marksPerQuestion: category.marksPerQuestion,
        negativeMarksPerQuestion: category.negativeMarksPerQuestion,
        totalMarks: category.marksPerQuestion * 3,
        difficultyMix: { EASY: 1, MEDIUM: 1, DIFFICULT: 1 },
      })),
      mandatoryQuestionIds: [],
      randomPools: [],
      negativeMarking: true,
      negativeMarkValue: 0.5,
      randomizeQuestionOrder: true,
      randomizeOptionOrder: true,
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/exams',
      headers: authHeaders(staff),
      payload: {
        basics: {
          name: 'Client Demonstration Assessment',
          code: 'CLIENT-DEMO-01',
          description: 'Synthetic examination used for client walkthrough data.',
          subject: 'General Aptitude',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          durationMinutes: 60,
          reportingTime: '08:30',
          navigationMode: 'FREE',
          resultMode: 'AFTER_REVIEW',
          centreId: centre.id,
          timeZone: 'Asia/Kolkata',
        },
        blueprint,
        candidateIds: [],
        securityProfileId: 'MAXIMUM_ASSURANCE',
        verification: {
          ...defaultVerificationPolicy('MAXIMUM_ASSURANCE'),
          requireAssignedDevice: true,
        },
        monitoring: {
          cameraMonitoringEnabled: false,
          loginSnapshotEnabled: false,
          snapshotIntervalSeconds: 30,
          facePresenceDetection: false,
          identityComparison: false,
          multipleFaceDetection: false,
          consecutiveFailureThreshold: 3,
          reverificationMode: 'AUTOMATIC',
          humanReviewRequired: false,
          evidenceRetentionDays: 30,
          candidateNotice: 'Synthetic demo examination; no camera monitoring is enabled.',
        },
        network: {
          centreId: centre.id,
          primaryCidr: centre.primaryCidr,
          backupCidr: centre.backupCidr,
          ipv6Cidr: centre.ipv6Cidr,
          deviceCertificateRequired: false,
          minimumDevicePolicyVersion: '2026.01.0',
          blockGeneralInternet: false,
          blockWorkstationToWorkstation: false,
          usbPolicy: 'READ_ONLY',
          bluetoothPolicy: 'BLOCKED',
        },
        demoData: {
          questions: true,
          candidates: true,
          devices: true,
          candidateCount: 3,
          deviceCount: 2,
        },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.demoData).toMatchObject({ questions: totalQuestions, candidates: 3, devices: 2, assignments: 3 });

    const examId = body.exam.id as string;
    const scopedQuestions = db.examQuestions.get(examId) ?? new Set<string>();
    const registrations = [...db.registrations.values()].filter((registration) => registration.examId === examId);
    const assignments = [...db.deviceAssignments.values()].filter((assignment) => assignment.examId === examId);
    const demoDevices = [...db.devices.values()].filter(
      (device) => device.centreId === centre.id && device.notes?.includes('approved demo workstation'),
    );

    expect(scopedQuestions.size).toBe(totalQuestions);
    expect([...scopedQuestions].every((questionId) => db.questions.get(questionId)?.status === 'APPROVED')).toBe(true);
    expect(registrations).toHaveLength(3);
    expect(demoDevices).toHaveLength(2);
    expect(assignments).toHaveLength(3);
  });
});
