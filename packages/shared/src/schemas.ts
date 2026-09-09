import { z } from 'zod';
import { ROLES } from './roles.js';
import { SECURITY_PROFILES } from './securityProfiles.js';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const cidrSchema = z
  .string()
  .regex(
    /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/,
    'Enter an IPv4 range in CIDR form, for example 10.42.0.0/16',
  );

export const cidr6Schema = z
  .string()
  .regex(/^[0-9a-fA-F:]+\/\d{1,3}$/, 'Enter an IPv6 range in CIDR form, for example 2001:db8::/48');

export const difficultySchema = z.enum(['EASY', 'MEDIUM', 'DIFFICULT']);
export const questionTypeSchema = z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_TEXT', 'PARAGRAPH']);
export const navigationModeSchema = z.enum(['FREE', 'SEQUENTIAL', 'SECTION_BASED']);
export const resultModeSchema = z.enum(['IMMEDIATE', 'AFTER_REVIEW', 'SCHEDULED']);
export const roleSchema = z.enum(ROLES);
export const securityProfileSchema = z.enum(SECURITY_PROFILES);

/* ------------------------------------------------------------------ */
/* Device identity                                                     */
/* ------------------------------------------------------------------ */
/**
 * What a client reports about the machine it runs on. Defined before the
 * auth schemas because sign-in carries a fingerprint for auto-detection.
 */
export const deviceFingerprintSchema = z.object({
  machineGuid: z.string().max(128).nullable().default(null),
  hostname: z.string().max(128).nullable().default(null),
  macAddresses: z.array(z.string().max(32)).max(16).default([]),
  serialNumber: z.string().max(128).nullable().default(null),
  operatingSystem: z.string().max(160).nullable().default(null),
  cpuSignature: z.string().max(160).nullable().default(null),
  totalMemoryMb: z.number().int().min(0).max(4194304).nullable().default(null),
  displayCount: z.number().int().min(0).max(16).nullable().default(null),
  primaryResolution: z.string().max(32).nullable().default(null),
  localIpAddress: z.string().max(64).nullable().default(null),
  client: z.enum(['WINDOWS_NATIVE', 'BROWSER', 'UNKNOWN']).default('UNKNOWN'),
  clientVersion: z.string().max(32).nullable().default(null),
  userAgent: z.string().max(512).nullable().default(null),
  timeZone: z.string().max(64).nullable().default(null),
  applicationSignatureValid: z.boolean().nullable().default(null),
  capturedAt: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const staffLoginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const candidateLoginSchema = z.object({
  applicationId: z
    .string()
    .min(4, 'Application ID is required')
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Application IDs contain letters, numbers and hyphens only'),
  password: z.string().min(1, 'Enter your examination password'),
  /**
   * Fallback only, used when auto-detection cannot identify the machine. The
   * managed Windows application identifies itself by hardware fingerprint and
   * does not send this at all.
   */
  workstationCode: z.string().max(32).optional(),
  fingerprint: deviceFingerprintSchema.optional(),
});

/* ------------------------------------------------------------------ */
/* Exam wizard                                                         */
/* ------------------------------------------------------------------ */

export const examBasicsSchema = z.object({
  name: z.string().min(4, 'Examination name must be at least 4 characters').max(120),
  code: z
    .string()
    .min(4, 'Examination code is required')
    .max(32)
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, numbers and hyphens, for example NTAE-2026-01'),
  description: z.string().max(600).default(''),
  subject: z.string().min(2, 'Subject is required'),
  startsAt: z.string().min(1, 'Select a start date and time'),
  durationMinutes: z
    .number({ invalid_type_error: 'Enter the duration in minutes' })
    .int()
    .min(10, 'Duration must be at least 10 minutes')
    .max(480, 'Duration cannot exceed 8 hours'),
  reportingTime: z.string().min(1, 'Enter the candidate reporting time'),
  navigationMode: navigationModeSchema,
  resultMode: resultModeSchema,
  centreId: z.string().min(1, 'Select an examination centre'),
  timeZone: z.string().min(1, 'Select a time zone'),
});

export const categoryAllocationSchema = z.object({
  categoryId: z.string().min(1),
  categoryCode: z.string().min(1),
  categoryName: z.string().min(1),
  questionCount: z.number().int().min(0).max(300),
  marksPerQuestion: z.number().min(0.5).max(100),
  negativeMarksPerQuestion: z.number().min(0).max(50),
  difficultyMix: z.object({
    EASY: z.number().int().min(0),
    MEDIUM: z.number().int().min(0),
    DIFFICULT: z.number().int().min(0),
  }),
  totalMarks: z.number().min(0),
});

export const blueprintSchema = z
  .object({
    totalQuestions: z.number().int().min(1).max(300),
    totalMarks: z.number().min(1).max(5000),
    categoryAllocations: z.array(categoryAllocationSchema).min(1, 'Allocate at least one category'),
    difficultyDistribution: z.object({
      EASY: z.number().int().min(0),
      MEDIUM: z.number().int().min(0),
      DIFFICULT: z.number().int().min(0),
    }),
    subjectDistribution: z
      .array(z.object({ subject: z.string().min(1), count: z.number().int().min(0) }))
      .default([]),
    mandatoryQuestionIds: z.array(z.string()).default([]),
    randomPools: z
      .array(
        z.object({
          name: z.string().min(1),
          subject: z.string().min(1),
          drawCount: z.number().int().min(1),
          poolSize: z.number().int().min(1),
        }),
      )
      .default([]),
    negativeMarking: z.boolean(),
    negativeMarkValue: z.number().min(0).max(5),
    randomizeQuestionOrder: z.boolean(),
    randomizeOptionOrder: z.boolean(),
  })
  .superRefine((b, ctx) => {
    const allocated = b.categoryAllocations.reduce((sum, a) => sum + a.questionCount, 0);
    if (allocated !== b.totalQuestions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The category allocations add up to ${allocated} questions but the blueprint total is ${b.totalQuestions}.`,
        path: ['categoryAllocations'],
      });
    }
    const marks = b.categoryAllocations.reduce((sum, a) => sum + a.questionCount * a.marksPerQuestion, 0);
    if (Math.abs(marks - b.totalMarks) > 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The category allocations are worth ${marks} marks but the blueprint total is ${b.totalMarks}.`,
        path: ['totalMarks'],
      });
    }
    const byDifficulty =
      b.difficultyDistribution.EASY + b.difficultyDistribution.MEDIUM + b.difficultyDistribution.DIFFICULT;
    if (byDifficulty !== b.totalQuestions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The difficulty distribution must add up to the total number of questions',
        path: ['difficultyDistribution'],
      });
    }
    b.categoryAllocations.forEach((allocation, index) => {
      const mix =
        allocation.difficultyMix.EASY + allocation.difficultyMix.MEDIUM + allocation.difficultyMix.DIFFICULT;
      if (mix !== allocation.questionCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${allocation.categoryName}: the difficulty mix adds up to ${mix} but ${allocation.questionCount} questions are allocated.`,
          path: ['categoryAllocations', index, 'difficultyMix'],
        });
      }
    });
  });

export const monitoringPolicySchema = z.object({
  cameraMonitoringEnabled: z.boolean(),
  loginSnapshotEnabled: z.boolean(),
  snapshotIntervalSeconds: z.union([z.literal(10), z.literal(15), z.literal(30), z.literal(60)]),
  facePresenceDetection: z.boolean(),
  identityComparison: z.boolean(),
  multipleFaceDetection: z.boolean(),
  consecutiveFailureThreshold: z.number().int().min(1).max(10),
  reverificationMode: z.enum(['AUTOMATIC', 'INVIGILATOR_APPROVED']),
  humanReviewRequired: z.boolean(),
  evidenceRetentionDays: z.number().int().min(1).max(3650),
  candidateNotice: z.string().min(20, 'Provide a clear notice for candidates').max(1000),
});

export const networkPolicySchema = z.object({
  centreId: z.string().min(1, 'Select the approved examination centre'),
  primaryCidr: cidrSchema,
  backupCidr: cidrSchema.optional().nullable(),
  ipv6Cidr: cidr6Schema.optional().nullable(),
  deviceCertificateRequired: z.boolean(),
  minimumDevicePolicyVersion: z.string().min(1),
  blockGeneralInternet: z.boolean(),
  blockWorkstationToWorkstation: z.boolean(),
  usbPolicy: z.enum(['BLOCKED', 'READ_ONLY', 'ALLOWED']),
  bluetoothPolicy: z.enum(['BLOCKED', 'ALLOWED']),
});


export const verificationPolicySchema = z.object({
  passwordRequired: z.literal(true),
  fingerprint: z.object({
    enabled: z.boolean(),
    requirement: z.enum(['REQUIRED', 'OPTIONAL']),
    allowInvigilatorOverride: z.boolean(),
    skipIfNotEnrolled: z.boolean(),
  }),
  face: z.object({
    enabled: z.boolean(),
    requirement: z.enum(['REQUIRED', 'OPTIONAL']),
    allowInvigilatorOverride: z.boolean(),
    skipIfNotEnrolled: z.boolean(),
    compareToEnrolment: z.boolean(),
  }),
  requireAssignedDevice: z.boolean(),
  requireAssignedNetwork: z.boolean(),
  autoDetectDevice: z.boolean(),
  requireNativeClient: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* Question categories                                                 */
/* ------------------------------------------------------------------ */

export const questionCategorySchema = z.object({
  code: z
    .string()
    .min(1, 'A short code is required')
    .max(8, 'Keep the code to 8 characters or fewer')
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, numbers and hyphens'),
  name: z.string().min(3, 'Give the category a name').max(60),
  description: z.string().max(400).default(''),
  marksPerQuestion: z
    .number({ invalid_type_error: 'Enter the marks each question in this category is worth' })
    .min(0.5, 'Marks must be at least 0.5')
    .max(100),
  negativeMarksPerQuestion: z.number().min(0).max(50).default(0),
  allowedTypes: z.array(questionTypeSchema).min(1, 'Allow at least one question type'),
  subject: z.string().nullable().default(null),
  ordinal: z.number().int().min(1).max(99).default(1),
  paragraphWordLimit: z.number().int().min(20).max(5000).nullable().default(null),
});

/* ------------------------------------------------------------------ */
/* Device identity and candidate association                           */
/* ------------------------------------------------------------------ */

export const deviceEnrolSchema = z.object({
  deviceId: z.string().min(1),
  fingerprint: deviceFingerprintSchema,
  notes: z.string().max(400).default(''),
  reason: z.string().min(5, 'A reason is required and is written to the audit trail'),
});

export const candidateDeviceAssignmentSchema = z.object({
  candidateId: z.string().min(1),
  deviceId: z.string().nullable().default(null),
  seatNumber: z.string().max(24).default(''),
  allowedCidrs: z.array(cidrSchema).max(8).default([]),
  allowAnyApprovedDevice: z.boolean().default(false),
});

export const bulkAssignmentSchema = z.object({
  examId: z.string().min(1),
  assignments: z.array(candidateDeviceAssignmentSchema).min(1).max(2000),
  reason: z.string().min(5, 'A reason is required and is written to the audit trail'),
});

export const releaseAssignmentSchema = z.object({
  reason: z.string().min(5, 'A reason is required and is written to the audit trail'),
});

/* ------------------------------------------------------------------ */
/* Import and export                                                   */
/* ------------------------------------------------------------------ */

export const importKindSchema = z.enum([
  'CANDIDATES',
  'DEVICES',
  'CANDIDATE_DEVICE_ASSIGNMENTS',
  'NETWORK_RANGES',
  'QUESTIONS',
]);

export const importValidateSchema = z.object({
  kind: importKindSchema,
  fileName: z.string().min(1).max(255),
  /** Parsed rows. The client parses the workbook; the server validates every row. */
  rows: z.array(z.record(z.string(), z.string())).max(5000, 'Import at most 5,000 rows at a time'),
  examId: z.string().optional(),
});

export const importCommitSchema = z.object({
  token: z.string().min(8),
  reason: z.string().min(5, 'A reason is required and is written to the audit trail'),
});

export const exportRequestSchema = z.object({
  sections: z
    .array(
      z.enum([
        'EXAM_CONFIGURATION',
        'SECURITY_POLICY',
        'CATEGORIES',
        'QUESTION_PAPER',
        'ANSWER_KEY',
        'CANDIDATES',
        'DEVICE_ASSIGNMENTS',
        'ATTEMPTS',
        'ANSWERS',
        'RECEIPTS',
        'PROCTORING_EVENTS',
        'INCIDENTS',
        'AUDIT_TRAIL',
        'TRACKING_FINDINGS',
      ]),
    )
    .min(1, 'Choose at least one section to export'),
  format: z.enum(['XLSX', 'JSON', 'CSV_BUNDLE']),
  reason: z.string().min(10, 'Explain why this export is needed. It is written to the audit trail.'),
  pseudonymise: z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/* Tracking                                                            */
/* ------------------------------------------------------------------ */

export const acknowledgeFindingSchema = z.object({
  reason: z.string().min(5, 'A reason is required and is written to the audit trail'),
});

export const createExamSchema = z.object({
  basics: examBasicsSchema,
  blueprint: blueprintSchema,
  candidateIds: z.array(z.string()).default([]),
  securityProfileId: securityProfileSchema,
  verification: verificationPolicySchema,
  monitoring: monitoringPolicySchema,
  network: networkPolicySchema,
  deviceAssignments: z.array(candidateDeviceAssignmentSchema).max(2000).default([]),
  demoData: z
    .object({
      questions: z.boolean().default(false),
      candidates: z.boolean().default(false),
      devices: z.boolean().default(false),
      candidateCount: z.number().int().min(1).max(200).default(24),
      deviceCount: z.number().int().min(1).max(200).default(12),
    })
    .default({ questions: false, candidates: false, devices: false, candidateCount: 24, deviceCount: 12 }),
});

export const updateSecurityPolicySchema = z.object({
  securityProfileId: securityProfileSchema,
  verification: verificationPolicySchema,
  monitoring: monitoringPolicySchema,
  network: networkPolicySchema,
  reason: z.string().min(5, 'A reason is required for security-policy changes'),
});

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

export const questionOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(4),
  text: z.string().min(1, 'Option text is required').max(500),
  isCorrect: z.boolean(),
});

export const questionDraftSchema = z
  .object({
    examId: z.string().min(1).optional(),
    stem: z.string().min(10, 'The question text must be at least 10 characters').max(4000),
    type: questionTypeSchema,
    options: z.array(questionOptionSchema).default([]),
    /** Marks come from the category, so they are never entered per question. */
    categoryId: z.string().min(1, 'Select a category - it determines the marks'),
    subject: z.string().min(1, 'Select a subject'),
    topic: z.string().min(1, 'Select a topic'),
    difficulty: difficultySchema,
    explanation: z.string().max(2000).default(''),
    reviewerNotes: z.string().max(2000).default(''),
    markingGuidance: z.string().max(2000).default(''),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'PARAGRAPH' || q.type === 'SHORT_TEXT') {
      if (q.options.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Descriptive questions do not have options',
          path: ['options'],
        });
      }
      if (q.type === 'PARAGRAPH' && q.markingGuidance.trim().length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Paragraph questions need marking guidance so a human examiner can mark them consistently',
          path: ['markingGuidance'],
        });
      }
      return;
    }
    if (q.options.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide at least two options', path: ['options'] });
      return;
    }
    const correct = q.options.filter((o) => o.isCorrect).length;
    if (q.type === 'SINGLE_CHOICE' || q.type === 'TRUE_FALSE') {
      if (correct !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Mark exactly one option as correct',
          path: ['options'],
        });
      }
    } else if (correct < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Multiple-choice questions need at least two correct options',
        path: ['options'],
      });
    }
  });

export const reviewDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
  comment: z.string().min(5, 'Add a review comment so the author knows what to change').max(1000),
});

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */

export const candidateCreateSchema = z.object({
  examId: z.string().min(1),
  fullName: z.string().min(3, 'Full name is required').max(120),
  applicationId: z.string().min(4).max(32),
  email: z.string().email(),
  eligibility: z.enum(['ELIGIBLE', 'PROVISIONAL', 'INELIGIBLE']).default('ELIGIBLE'),
  centreId: z.string().nullable().optional(),
  additionalTimeMinutes: z.number().int().min(0).max(120).default(0),
  requirements: z.array(z.string()).default([]),
  notes: z.string().max(500).default(''),
});

/* ------------------------------------------------------------------ */
/* Attempts and answers                                                */
/* ------------------------------------------------------------------ */

export const activateAttemptSchema = z.object({
  examId: z.string().min(1),
  deviceCode: z.string().max(32).optional(),
  fingerprint: deviceFingerprintSchema.optional(),
  verification: z.object({
    fingerprint: z.enum(['PASSED', 'SKIPPED', 'OVERRIDDEN', 'FAILED']).default('SKIPPED'),
    face: z.enum(['PASSED', 'SKIPPED', 'OVERRIDDEN', 'FAILED']).default('SKIPPED'),
  }),
  consent: z.object({
    identityConfirmed: z.literal(true),
    rulesUnderstood: z.literal(true),
    monitoringAcknowledged: z.literal(true),
    savingUnderstood: z.literal(true),
  }),
});

export const saveAnswerSchema = z.object({
  selectedOptionIds: z.array(z.string()).max(10).default([]),
  /** Paragraph and short-text answers. Word count is checked against the category limit. */
  textAnswer: z.string().max(40000).nullable().default(null),
  flagged: z.boolean().default(false),
  expectedVersion: z.number().int().min(0),
  clientCapturedAt: z.string().min(1),
});

export const submitAttemptSchema = z.object({
  confirmed: z.literal(true),
  clientSummary: z
    .object({
      answered: z.number().int().min(0),
      flagged: z.number().int().min(0),
    })
    .optional(),
});

export const evidenceChallengeSchema = z.object({
  attemptId: z.string().min(1),
});

export const evidenceUploadSchema = z.object({
  attemptId: z.string().min(1),
  challengeId: z.string().min(1),
  sequence: z.number().int().min(1),
  capturedAt: z.string().min(1),
  deviceCode: z.string().min(1),
  previousEvidenceHash: z.string().nullable(),
  /** Simulated analyser outcome. A production system computes this server-side. */
  simulatedResult: z.enum([
    'FACE_VERIFIED',
    'NO_FACE_DETECTED',
    'MULTIPLE_FACES',
    'FACE_UNCLEAR',
    'LOW_LIGHT',
    'CAMERA_BLOCKED',
    'IDENTITY_MISMATCH',
    'PROCESSING_UNAVAILABLE',
  ]),
  imageBytes: z.number().int().min(0).max(2_000_000),
});

/* ------------------------------------------------------------------ */
/* Invigilator                                                         */
/* ------------------------------------------------------------------ */

export const invigilatorActionSchema = z.object({
  attemptId: z.string().min(1),
  action: z.enum([
    'REQUEST_REVERIFICATION',
    'APPROVE_RECOVERY',
    'EXTEND_TIME',
    'RESTRICT_SESSION',
    'RELEASE_RESTRICTION',
    'ESCALATE',
    'ADD_NOTE',
  ]),
  reason: z.string().min(5, 'A reason is required and is written to the audit trail').max(500),
  extraMinutes: z.number().int().min(1).max(120).optional(),
  note: z.string().max(1000).optional(),
});

/* ------------------------------------------------------------------ */
/* Devices                                                             */
/* ------------------------------------------------------------------ */

export const deviceRegisterSchema = z.object({
  deviceCode: z.string().min(3).max(32),
  name: z.string().min(3).max(80),
  centreId: z.string().min(1),
  operatingSystem: z.string().min(3),
  ipAddress: z.string().min(7),
  kioskPolicyVersion: z.string().min(1),
});

export const deviceActionSchema = z.object({
  action: z.enum(['APPROVE', 'REVOKE', 'ROTATE_CERTIFICATE']),
  reason: z.string().min(5, 'A reason is required and is written to the audit trail'),
});

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

export const demoScenarioSchema = z.object({
  scenario: z.enum([
    'LOGIN_BURST',
    'DDOS_TRAFFIC',
    'SQL_INJECTION_ATTEMPT',
    'INVALID_EXAM_TOKEN',
    'MODIFIED_QUESTION_ENVELOPE',
    'REPLAYED_ANSWER_REQUEST',
    'REVOKED_DEVICE',
    'DATABASE_SLOWDOWN',
    'REDIS_UNAVAILABLE',
    'INSTANCE_FAILURE',
  ]),
  examId: z.string().optional(),
});

export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
export type CandidateLoginInput = z.infer<typeof candidateLoginSchema>;
export type CreateExamInput = z.infer<typeof createExamSchema>;
export type QuestionDraftInput = z.infer<typeof questionDraftSchema>;
export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;
export type InvigilatorActionInput = z.infer<typeof invigilatorActionSchema>;
export type ExamBasicsInput = z.infer<typeof examBasicsSchema>;
export type BlueprintInput = z.infer<typeof blueprintSchema>;
export type MonitoringPolicyInput = z.infer<typeof monitoringPolicySchema>;
export type NetworkPolicyInput = z.infer<typeof networkPolicySchema>;
