import type {
  CandidateDeviceAssignment,
  DeviceEnrolment,
  ExportManifest,
  ImportValidation,
  QuestionCategory,
  TrackingFinding,
  TrackingSnapshot,
  Answer,
  AnswerEvent,
  AuditEvent,
  Candidate,
  CandidateAssignment,
  Exam,
  ExamAttempt,
  ExaminationCentre,
  ExaminationDevice,
  ExamManifest,
  ExamPublicationApproval,
  ExamRegistration,
  EvidenceObject,
  Incident,
  ProctoringEvent,
  Question,
  QuestionReview,
  QuestionVersion,
  SecuritySimulationResult,
  SubmissionReceipt,
  User,
  ActivationKeyRecord,
  StationRecord,
} from '@sep/shared';
import type { EncryptedEnvelope } from '../crypto/keyProvider.js';

export interface StaffCredential {
  userId: string;
  passwordHash: string;
  salt: string;
  /** Development-only plaintext shown on the demo credentials card. */
  demoPassword: string;
}

export interface CandidateCredential {
  candidateId: string;
  applicationId: string;
  passwordHash: string;
  salt: string;
  demoPassword: string;
}

export interface Session {
  exportChallenge?: { id: string; scope: string; expiresAt: number };
  exportGrant?: { token: string; scope: string; expiresAt: number };
  id: string;
  userId: string;
  kind: 'STAFF' | 'CANDIDATE';
  candidateId?: string;
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
  deviceCode?: string;
  ipAddress: string;
}

export interface SealedPackage {
  manifestId: string;
  envelope: EncryptedEnvelope;
}

/**
 * The demo database.
 *
 * Every collection maps 1:1 to a Prisma model in `prisma/schema.prisma`; the
 * in-memory driver exists so the POC runs with no infrastructure. Access always
 * goes through the repository functions in `repositories.ts`, never directly
 * from a route handler.
 */
export interface Database {
  users: Map<string, User>;
  staffCredentials: Map<string, StaffCredential>;
  candidateCredentials: Map<string, CandidateCredential>;
  sessions: Map<string, Session>;

  centres: Map<string, ExaminationCentre>;
  devices: Map<string, ExaminationDevice>;

  /** Categories carry the marks. Every question in a category is worth the same. */
  categories: Map<string, QuestionCategory>;
  examQuestions: Map<string, Set<string>>;
  questions: Map<string, Question>;
  questionVersions: Map<string, QuestionVersion>;
  questionReviews: Map<string, QuestionReview>;

  /** Hardware fingerprints recorded against registered workstations. */
  deviceEnrolments: Map<string, DeviceEnrolment>;
  /** Which candidate may sit at which workstation, on which network. */
  deviceAssignments: Map<string, CandidateDeviceAssignment>;

  exams: Map<string, Exam>;
  manifests: Map<string, ExamManifest>;
  sealedPackages: Map<string, SealedPackage>;
  publicationApprovals: Map<string, ExamPublicationApproval>;

  candidates: Map<string, Candidate>;
  registrations: Map<string, ExamRegistration>;

  attempts: Map<string, ExamAttempt>;
  assignments: Map<string, CandidateAssignment>;
  answers: Map<string, Answer>;
  answerEvents: AnswerEvent[];
  receipts: Map<string, SubmissionReceipt>;

  proctoringEvents: ProctoringEvent[];
  evidenceObjects: Map<string, EvidenceObject>;
  incidents: Map<string, Incident>;

  /** Append-only, hash-chained. There is no update or delete path. */
  auditEvents: AuditEvent[];
  simulations: SecuritySimulationResult[];

  /** Latest tracking sweep per examination, and everything it has raised. */
  trackingSnapshots: Map<string, TrackingSnapshot>;
  trackingFindings: Map<string, TrackingFinding>;

  /* --- Provisioning: the keys issued and the machines that redeemed them - */

  /** Every examination key ever issued. Holds fingerprints, never keys. */
  activationKeys: Map<string, ActivationKeyRecord>;
  /** Machines set up with a key, and what they are running. */
  stations: Map<string, StationRecord>;

  /** Two-phase import: a validation is held until it is committed or expires. */
  importValidations: Map<string, ImportValidation & { rows: Record<string, string>[]; userId: string; examId?: string }>;
  exportManifests: Map<string, ExportManifest>;

  /** Idempotency ledger: key -> stored response fingerprint. */
  idempotency: Map<string, { at: string; version: number; attemptId: string }>;

  counters: {
    auditSequence: number;
    requestsThisMinute: number;
    answerWritesThisMinute: number;
    wafBlocked: number;
    rateLimited: number;
    failedLogins: number;
  };

  metrics: {
    startedAt: number;
    responseTimes: number[];
    series: { at: string; requestsPerMinute: number; answerWrites: number; p95: number }[];
  };

  degradation: {
    degraded: boolean;
    reason: string | null;
  };
}

export function emptyDatabase(): Database {
  return {
    users: new Map(),
    staffCredentials: new Map(),
    candidateCredentials: new Map(),
    sessions: new Map(),
    centres: new Map(),
    devices: new Map(),
    categories: new Map(),
    examQuestions: new Map(),
    questions: new Map(),
    questionVersions: new Map(),
    questionReviews: new Map(),
    deviceEnrolments: new Map(),
    deviceAssignments: new Map(),
    exams: new Map(),
    manifests: new Map(),
    sealedPackages: new Map(),
    publicationApprovals: new Map(),
    candidates: new Map(),
    registrations: new Map(),
    attempts: new Map(),
    assignments: new Map(),
    answers: new Map(),
    answerEvents: [],
    receipts: new Map(),
    proctoringEvents: [],
    evidenceObjects: new Map(),
    incidents: new Map(),
    auditEvents: [],
    simulations: [],
    trackingSnapshots: new Map(),
    trackingFindings: new Map(),
    activationKeys: new Map(),
    stations: new Map(),
    importValidations: new Map(),
    exportManifests: new Map(),
    idempotency: new Map(),
    counters: {
      auditSequence: 0,
      requestsThisMinute: 0,
      answerWritesThisMinute: 0,
      wafBlocked: 0,
      rateLimited: 0,
      failedLogins: 0,
    },
    metrics: {
      startedAt: Date.now(),
      responseTimes: [],
      series: [],
    },
    degradation: { degraded: false, reason: null },
  };
}

let db: Database = emptyDatabase();

export function getDb(): Database {
  return db;
}

export function replaceDb(next: Database): void {
  db = next;
}
