import { describe, expect, it } from 'vitest';
import {
  blueprintSchema,
  effectiveControls,
  monitoringPolicySchema,
  networkPolicySchema,
  profileFlags,
  SECURITY_PROFILE_DEFINITIONS,
} from '@sep/shared';

/**
 * Security-policy wizard rules.
 *
 * The wizard never asks an administrator to choose an algorithm; it asks for an
 * assurance level and derives the controls. These tests pin that behaviour and
 * the validation the wizard applies before it will let a step pass.
 */
describe('security policy wizard', () => {
  it('expands each profile into the controls of every level it inherits', () => {
    const standard = effectiveControls('STANDARD');
    const maximum = effectiveControls('MAXIMUM_ASSURANCE');

    expect(standard.length).toBeGreaterThan(0);
    // Maximum assurance inherits High → Enhanced → Standard.
    expect(maximum.length).toBeGreaterThan(standard.length);
    standard.forEach((control) => {
      expect(maximum.some((c) => c.key === control.key)).toBe(true);
    });
    expect(maximum.some((c) => c.key === 'ipAllowlist')).toBe(true);
    expect(maximum.some((c) => c.key === 'dualApproval')).toBe(true);
  });

  it('labels every control as implemented, partly implemented or simulated', () => {
    effectiveControls('MAXIMUM_ASSURANCE').forEach((control) => {
      expect(['implemented', 'partial', 'simulated']).toContain(control.simulation);
      expect(control.explanation.length).toBeGreaterThan(20);
      if (control.simulation !== 'implemented') {
        // Anything not fully implemented must carry an honest note.
        expect(control.simulationNote ?? '').not.toBe('');
      }
    });
  });

  it('escalates the enforcement flags as the assurance level rises', () => {
    expect(profileFlags('STANDARD').ipAllowlist).toBe(false);
    expect(profileFlags('STANDARD').dualApprovalBeforePublication).toBe(false);

    expect(profileFlags('ENHANCED').requireRegisteredDevice).toBe(true);
    expect(profileFlags('ENHANCED').requireFaceVerificationAtLogin).toBe(true);

    expect(profileFlags('HIGH_ASSURANCE').periodicFacePresence).toBe(true);
    expect(profileFlags('HIGH_ASSURANCE').invigilatorReviewWorkflow).toBe(true);

    const maximum = profileFlags('MAXIMUM_ASSURANCE');
    expect(maximum.ipAllowlist).toBe(true);
    expect(maximum.deviceCertificateRequired).toBe(true);
    expect(maximum.dualApprovalBeforePublication).toBe(true);
    expect(maximum.immutableAuditEvidence).toBe(true);
  });

  it('recommends maximum assurance for a controlled-premise centre', () => {
    expect(SECURITY_PROFILE_DEFINITIONS.MAXIMUM_ASSURANCE.recommendedFor).toMatch(
      /organisation-controlled examination centres/i,
    );
  });

  it('rejects a blueprint whose difficulty split does not add up', () => {
    const result = blueprintSchema.safeParse({
      categoryAllocations: [{ categoryId: 'category-qa', categoryCode: 'QA', categoryName: 'Quantitative Aptitude', questionCount: 50, marksPerQuestion: 2, negativeMarksPerQuestion: 0.5, totalMarks: 100, difficultyMix: { EASY: 20, MEDIUM: 20, DIFFICULT: 10 } }],
      totalQuestions: 50,
      totalMarks: 100,
      difficultyDistribution: { EASY: 20, MEDIUM: 20, DIFFICULT: 5 },
      subjectDistribution: [],
      mandatoryQuestionIds: [],
      randomPools: [],
      negativeMarking: true,
      negativeMarkValue: 0.5,
      randomizeQuestionOrder: true,
      randomizeOptionOrder: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toMatch(/add up to the total number of questions/i);
    }
  });

  it('accepts the demonstration blueprint', () => {
    const result = blueprintSchema.safeParse({
      categoryAllocations: [{ categoryId: 'category-qa', categoryCode: 'QA', categoryName: 'Quantitative Aptitude', questionCount: 50, marksPerQuestion: 2, negativeMarksPerQuestion: 0.5, totalMarks: 100, difficultyMix: { EASY: 20, MEDIUM: 20, DIFFICULT: 10 } }],
      totalQuestions: 50,
      totalMarks: 100,
      difficultyDistribution: { EASY: 20, MEDIUM: 20, DIFFICULT: 10 },
      subjectDistribution: [],
      mandatoryQuestionIds: [],
      randomPools: [],
      negativeMarking: true,
      negativeMarkValue: 0.5,
      randomizeQuestionOrder: true,
      randomizeOptionOrder: true,
    });
    expect(result.success).toBe(true);
  });

  it('requires a candidate notice long enough to be meaningful', () => {
    const base = {
      cameraMonitoringEnabled: true,
      loginSnapshotEnabled: true,
      snapshotIntervalSeconds: 30 as const,
      facePresenceDetection: true,
      identityComparison: true,
      multipleFaceDetection: true,
      consecutiveFailureThreshold: 3,
      reverificationMode: 'INVIGILATOR_APPROVED' as const,
      humanReviewRequired: true,
      evidenceRetentionDays: 90,
    };
    expect(monitoringPolicySchema.safeParse({ ...base, candidateNotice: 'Camera on.' }).success).toBe(false);
    expect(
      monitoringPolicySchema.safeParse({
        ...base,
        candidateNotice:
          'The workstation camera takes a low-resolution photograph every 30 seconds to confirm you are present and alone.',
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed network range with an instructive message', () => {
    const result = networkPolicySchema.safeParse({
      centreId: 'centre-central',
      primaryCidr: '10.42.0.0',
      backupCidr: null,
      ipv6Cidr: null,
      deviceCertificateRequired: true,
      minimumDevicePolicyVersion: '2026.01.0',
      blockGeneralInternet: true,
      blockWorkstationToWorkstation: true,
      usbPolicy: 'BLOCKED',
      bluetoothPolicy: 'BLOCKED',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toMatch(/CIDR form/i);
    }
  });

  it('only offers the four documented snapshot intervals', () => {
    [10, 15, 30, 60].forEach((seconds) => {
      const result = monitoringPolicySchema.safeParse({
        cameraMonitoringEnabled: true,
        loginSnapshotEnabled: true,
        snapshotIntervalSeconds: seconds,
        facePresenceDetection: true,
        identityComparison: true,
        multipleFaceDetection: true,
        consecutiveFailureThreshold: 3,
        reverificationMode: 'AUTOMATIC',
        humanReviewRequired: false,
        evidenceRetentionDays: 30,
        candidateNotice: 'The workstation camera confirms your presence during this assessment at regular intervals.',
      });
      expect(result.success).toBe(true);
    });
  });
});
