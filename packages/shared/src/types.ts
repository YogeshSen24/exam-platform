import type { Role } from './roles.js';
import type { SecurityProfileId } from './securityProfiles.js';
import type { CategoryQuota, ExamCategoryAllocation } from './categories.js';
import type { AttemptProvenance } from './provisioning.js';

export type ISODateString = string;

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  email: string;
  fullName: string;
  roles: Role[];
  centreId?: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  lastLoginAt?: ISODateString | null;
  createdAt: ISODateString;
  isDemoAccount: boolean;
}

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  roles: Role[];
  kind: 'STAFF' | 'CANDIDATE';
  candidateId?: string;
  centreId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Centres and devices                                                 */
/* ------------------------------------------------------------------ */

export interface ExaminationCentre {
  id: string;
  code: string;
  name: string;
  city: string;
  region: string;
  capacity: number;
  primaryCidr: string;
  backupCidr?: string | null;
  ipv6Cidr?: string | null;
  contactName: string;
  contactPhone: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export type DeviceStatus = 'PENDING' | 'APPROVED' | 'REVOKED';
export type ComponentStatus = 'OK' | 'WARNING' | 'FAIL' | 'UNKNOWN';

export interface ExaminationDevice {
  id: string;
  deviceCode: string;
  name: string;
  centreId: string;
  operatingSystem: string;
  kioskPolicyVersion: string;
  status: DeviceStatus;
  certificate: DeviceCertificate;
  lastHealthCheckAt: ISODateString | null;
  cameraStatus: ComponentStatus;
  fingerprintScannerStatus: ComponentStatus;
  networkStatus: ComponentStatus;
  ipAddress: string;
  notes?: string | null;
}

export interface DeviceCertificate {
  serial: string;
  subject: string;
  issuer: string;
  issuedAt: ISODateString;
  expiresAt: ISODateString;
  status: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'REVOKED';
  thumbprint: string;
}

export interface ReadinessCheckResult {
  key: string;
  label: string;
  explanation: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  detail: string;
  simulated: boolean;
}

export interface DeviceReadinessReport {
  deviceId: string;
  generatedAt: ISODateString;
  overall: 'PASS' | 'WARNING' | 'FAIL';
  checks: ReadinessCheckResult[];
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_TEXT' | 'PARAGRAPH';

/** Question types the candidate application can deliver and mark automatically. */
export const OBJECTIVE_TYPES: QuestionType[] = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE'];
/** Question types that require a human examiner. */
export const DESCRIPTIVE_TYPES: QuestionType[] = ['SHORT_TEXT', 'PARAGRAPH'];

export function isDescriptive(type: QuestionType): boolean {
  return DESCRIPTIVE_TYPES.includes(type);
}
export type Difficulty = 'EASY' | 'MEDIUM' | 'DIFFICULT';
export type QuestionStatus = 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'PUBLISHED' | 'RETIRED';

export interface QuestionOption {
  id: string;
  label: string;
  text: string;
  isCorrect: boolean;
}

export interface QuestionVersion {
  id: string;
  questionId: string;
  version: number;
  stem: string;
  type: QuestionType;
  options: QuestionOption[];
  /** The category this question belongs to. Marks are derived from it. */
  categoryId: string;
  categoryCode: string;
  /** Resolved from the category at save time; never edited directly. */
  marks: number;
  negativeMarks: number;
  /** Word limit for paragraph answers, resolved from the category. */
  paragraphWordLimit: number | null;
  /** Guidance for the human examiner marking a paragraph answer. */
  markingGuidance: string;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  explanation: string;
  reviewerNotes: string;
  status: QuestionStatus;
  createdAt: ISODateString;
  createdByUserId: string;
  contentHash: string;
  immutable: boolean;
}

export interface Question {
  id: string;
  code: string;
  currentVersionId: string;
  status: QuestionStatus;
  authorUserId: string;
  categoryId: string;
  categoryCode: string;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  /** Derived from the category. Every question in a category is worth the same. */
  marks: number;
  type: QuestionType;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface QuestionReview {
  id: string;
  questionId: string;
  questionVersionId: string;
  reviewerUserId: string;
  decision: 'APPROVED' | 'CHANGES_REQUESTED';
  comment: string;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Exams                                                               */
/* ------------------------------------------------------------------ */

export type NavigationMode = 'FREE' | 'SEQUENTIAL' | 'SECTION_BASED';
export type ResultMode = 'IMMEDIATE' | 'AFTER_REVIEW' | 'SCHEDULED';
export type ExamStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED';

export interface ExamBlueprint {
  totalQuestions: number;
  /** Derived from the category allocations; never entered by hand. */
  totalMarks: number;
  /** Per-category question counts and the marks each category carries. */
  categoryAllocations: ExamCategoryAllocation[];
  difficultyDistribution: Record<Difficulty, number>;
  subjectDistribution: { subject: string; count: number }[];
  mandatoryQuestionIds: string[];
  randomPools: { name: string; subject: string; drawCount: number; poolSize: number }[];
  negativeMarking: boolean;
  negativeMarkValue: number;
  randomizeQuestionOrder: boolean;
  randomizeOptionOrder: boolean;
}

export interface MonitoringPolicy {
  cameraMonitoringEnabled: boolean;
  loginSnapshotEnabled: boolean;
  snapshotIntervalSeconds: 10 | 15 | 30 | 60;
  facePresenceDetection: boolean;
  identityComparison: boolean;
  multipleFaceDetection: boolean;
  consecutiveFailureThreshold: number;
  reverificationMode: 'AUTOMATIC' | 'INVIGILATOR_APPROVED';
  humanReviewRequired: boolean;
  evidenceRetentionDays: number;
  candidateNotice: string;
}

export interface NetworkPolicy {
  centreId: string;
  primaryCidr: string;
  backupCidr?: string | null;
  ipv6Cidr?: string | null;
  deviceCertificateRequired: boolean;
  minimumDevicePolicyVersion: string;
  blockGeneralInternet: boolean;
  blockWorkstationToWorkstation: boolean;
  usbPolicy: 'BLOCKED' | 'READ_ONLY' | 'ALLOWED';
  bluetoothPolicy: 'BLOCKED' | 'ALLOWED';
}

/**
 * Per-examination verification settings.
 *
 * The security profile supplies sensible defaults, but every identity check is
 * independently switchable here. An examination board may run Maximum Assurance
 * on the network and device controls while leaving biometrics off entirely —
 * for accessibility, for legal reasons, or simply because the centre has no
 * scanners. The profile suggests; this policy decides.
 */
export interface VerificationPolicy {
  /** Always on: application ID and password. Present for completeness. */
  passwordRequired: true;

  fingerprint: {
    enabled: boolean;
    /** `REQUIRED` blocks entry on failure; `OPTIONAL` warns and continues. */
    requirement: 'REQUIRED' | 'OPTIONAL';
    /** Allow an invigilator to authorise entry after a failed scan. */
    allowInvigilatorOverride: boolean;
    /** Candidates with no enrolment skip the check instead of being blocked. */
    skipIfNotEnrolled: boolean;
  };

  face: {
    enabled: boolean;
    requirement: 'REQUIRED' | 'OPTIONAL';
    allowInvigilatorOverride: boolean;
    skipIfNotEnrolled: boolean;
    /** Compare against the enrolment photograph, or only check a face is present. */
    compareToEnrolment: boolean;
  };

  /** Reject activation when the workstation is not the one assigned to this candidate. */
  requireAssignedDevice: boolean;
  /** Reject activation from outside the ranges assigned to this candidate. */
  requireAssignedNetwork: boolean;
  /** Detect the workstation from its hardware identity rather than asking. */
  autoDetectDevice: boolean;
  /** Refuse to start unless the client is the managed Windows application. */
  requireNativeClient: boolean;
}

export interface ExamSecurityPolicy {
  profileId: SecurityProfileId;
  verification: VerificationPolicy;
  monitoring: MonitoringPolicy;
  network: NetworkPolicy;
  updatedAt: ISODateString;
  updatedByUserId: string;
}

export interface Exam {
  id: string;
  name: string;
  code: string;
  description: string;
  subject: string;
  startsAt: ISODateString;
  durationMinutes: number;
  reportingTime: string;
  navigationMode: NavigationMode;
  resultMode: ResultMode;
  centreId: string;
  timeZone: string;
  status: ExamStatus;
  blueprint: ExamBlueprint;
  securityPolicy: ExamSecurityPolicy;
  createdByUserId: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  candidateCount: number;
  manifestId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Manifest and publication                                            */
/* ------------------------------------------------------------------ */

export interface ManifestEntry {
  sequence: number;
  questionId: string;
  questionVersionId: string;
  version: number;
  contentHash: string;
  marks: number;
  negativeMarks: number;
  subject: string;
  difficulty: Difficulty;
  /**
   * The category this question was sealed under.
   *
   * Recorded in the manifest so a centre hub can draw a candidate's paper
   * category by category with no access to the question bank, which is what
   * makes an offline draw possible at all.
   */
  categoryId: string;
  categoryCode: string;
}

export interface ExamManifest {
  id: string;
  examId: string;
  examVersion: number;
  /**
   * The whole sealed pool, which is larger than any one candidate's paper.
   * Candidates draw from it; nobody sits all of it.
   */
  entries: ManifestEntry[];
  /** How many questions each candidate draws from each category. */
  quotas: CategoryQuota[];
  /** Questions delivered to one candidate. Always <= entries.length. */
  deliveredQuestionCount: number;
  deliveredTotalMarks: number;
  manifestHash: string;
  signature: string;
  signatureAlgorithm: string;
  signingKeyReference: string;
  encryptionProfile: string;
  encryptionKeyReference: string;
  nonce: string;
  ciphertextLength: number;
  createdAt: ISODateString;
  createdByUserId: string;
  releaseWindowStart: ISODateString;
  releaseWindowEnd: ISODateString;
  integrityStatus: 'VERIFIED' | 'FAILED' | 'PENDING';
  integrityCheckedAt: ISODateString;
  verifiedQuestionCount: number;
  publicationStatus: 'DRAFT' | 'AWAITING_APPROVAL' | 'PUBLISHED' | 'BLOCKED';
  tamperSimulated: boolean;
}

export interface ExamPublicationApproval {
  id: string;
  manifestId: string;
  examId: string;
  approverUserId: string;
  approverName: string;
  approverRole: Role;
  decision: 'APPROVED' | 'REJECTED';
  comment: string;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Candidates and attempts                                             */
/* ------------------------------------------------------------------ */

export interface Candidate {
  id: string;
  candidateId: string;
  applicationId: string;
  fullName: string;
  photoSeed: string;
  email: string;
  eligibility: 'ELIGIBLE' | 'PROVISIONAL' | 'INELIGIBLE';
  examId: string | null;
  centreId: string | null;
  accommodations: Accommodation;
  fingerprintEnrolled: boolean;
  faceEnrolled: boolean;
  biometricReferenceId: string | null;
  accountStatus: 'ACTIVE' | 'LOCKED' | 'SUSPENDED';
  lastVerificationEvent?: {
    type: string;
    result: string;
    at: ISODateString;
  } | null;
}

export interface Accommodation {
  additionalTimeMinutes: number;
  requirements: string[];
  notes: string;
}

export interface ExamRegistration {
  id: string;
  examId: string;
  candidateId: string;
  centreId: string;
  seatNumber: string;
  status: 'REGISTERED' | 'CANCELLED';
  createdAt: ISODateString;
}

export type AttemptStatus =
  | 'NOT_STARTED'
  | 'VERIFYING'
  | 'ACTIVE'
  | 'RESTRICTED'
  | 'AWAITING_REVERIFICATION'
  | 'DISCONNECTED'
  | 'SUBMITTED'
  | 'TERMINATED';

export interface AssignedQuestion {
  id: string;
  sequence: number;
  questionId: string;
  questionVersionId: string;
  optionOrder: string[];
  /** Fixed when the paper was sealed, from the category's value at that time. */
  marks: number;
  negativeMarks: number;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  type: QuestionType;
  categoryId: string;
  categoryCode: string;
  paragraphWordLimit: number | null;
}

export interface CandidateAssignment {
  id: string;
  attemptId: string;
  examId: string;
  candidateId: string;
  manifestId: string;
  seed: string;
  questions: AssignedQuestion[];
  createdAt: ISODateString;
  immutable: true;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  candidateId: string;
  deviceId: string;
  status: AttemptStatus;
  startedAt: ISODateString | null;
  expiresAt: ISODateString | null;
  submittedAt: ISODateString | null;
  assignmentId: string | null;
  identityStatus: 'PENDING' | 'VERIFIED' | 'WARNING' | 'FAILED';
  connectionStatus: 'ONLINE' | 'RECONNECTING' | 'OFFLINE';
  consecutiveMonitoringFailures: number;
  restrictionReason?: string | null;
  alertLevel: 'NONE' | 'INFO' | 'WARNING' | 'CRITICAL';
  lastAnswerSavedAt: ISODateString | null;
  additionalTimeMinutes: number;
  answeredCount: number;
  flaggedCount: number;
  reverificationRequestedAt?: ISODateString | null;
  /**
   * Where this attempt happened: centre, room, sitting and machine.
   *
   * Stamped once at activation from the key the station was set up with, so a
   * result can be traced back to a room and a sitting long afterwards, and so
   * one room can be invalidated without touching another.
   */
  provenance?: AttemptProvenance | null;
}

/** Question payload delivered to the candidate. Never contains correct answers. */
export interface DeliveredQuestion {
  assignmentQuestionId: string;
  sequence: number;
  totalQuestions: number;
  stem: string;
  type: QuestionType;
  options: { id: string; label: string; text: string }[];
  marks: number;
  negativeMarks: number;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  categoryCode: string;
  /** Word limit for a paragraph answer, shown while the candidate writes. */
  paragraphWordLimit: number | null;
  savedAnswer: string[] | null;
  savedText: string | null;
  answerVersion: number;
  flagged: boolean;
  visited: boolean;
}

export interface Answer {
  id: string;
  attemptId: string;
  assignmentQuestionId: string;
  selectedOptionIds: string[];
  textAnswer: string | null;
  version: number;
  flagged: boolean;
  visited: boolean;
  updatedAt: ISODateString;
  lastIdempotencyKey: string | null;
}

export interface AnswerEvent {
  id: string;
  attemptId: string;
  assignmentQuestionId: string;
  version: number;
  selectedOptionIds: string[];
  idempotencyKey: string;
  receivedAt: ISODateString;
  committedAt: ISODateString;
  outcome: 'COMMITTED' | 'DUPLICATE_IGNORED' | 'CONFLICT';
}

export interface SubmissionReceipt {
  id: string;
  receiptId: string;
  attemptId: string;
  examId: string;
  examName: string;
  candidateId: string;
  candidateName: string;
  applicationId: string;
  centreName: string;
  deviceCode: string;
  /**
   * Where this examination was actually sat.
   *
   * Signed along with the rest of the receipt, so a result cannot later be
   * moved to a different room or sitting without the signature failing.
   */
  provenance: AttemptProvenance | null;
  submittedAt: ISODateString;
  serverTime: ISODateString;
  answeredCount: number;
  unansweredCount: number;
  totalQuestions: number;
  answerSetHash: string;
  manifestHash: string;
  assignmentSeedHash: string;
  signature: string;
  signingKeyReference: string;
  auditAnchorHash: string;
}

/* ------------------------------------------------------------------ */
/* Monitoring and incidents                                            */
/* ------------------------------------------------------------------ */

export type ProctoringResult =
  | 'FACE_VERIFIED'
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES'
  | 'FACE_UNCLEAR'
  | 'LOW_LIGHT'
  | 'CAMERA_BLOCKED'
  | 'IDENTITY_MISMATCH'
  | 'PROCESSING_UNAVAILABLE';

export interface ProctoringEvent {
  id: string;
  attemptId: string;
  candidateId: string;
  examId: string;
  sequence: number;
  challengeId: string;
  result: ProctoringResult;
  confidence: number;
  capturedAt: ISODateString;
  receivedAt: ISODateString;
  evidenceObjectId: string | null;
  previousEvidenceHash: string | null;
  evidenceHash: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  reviewedByUserId: string | null;
  simulated: true;
}

export interface EvidenceObject {
  id: string;
  attemptId: string;
  bucket: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: ISODateString;
  retentionUntil: ISODateString;
  accessLog: { userId: string; userName: string; at: ISODateString; reason: string }[];
  uploadState: 'QUEUED' | 'UPLOADING' | 'STORED' | 'DELAYED';
}

export type IncidentType =
  | 'REPEATED_FACE_ABSENCE'
  | 'MULTIPLE_FACES'
  | 'CAMERA_BLOCKED'
  | 'FINGERPRINT_MISMATCH'
  | 'DEVICE_HEALTH_FAILURE'
  | 'NETWORK_CHANGE'
  | 'REPEATED_LOGIN_FAILURE'
  | 'APPLICATION_RESTART'
  | 'EXCESSIVE_API_REQUESTS'
  | 'ANSWER_VERSION_CONFLICT'
  | 'UNAPPROVED_WORKSTATION'
  | 'PAPER_INTEGRITY_FAILURE';

export interface Incident {
  id: string;
  type: IncidentType;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  examId: string | null;
  centreId: string | null;
  candidateId: string | null;
  attemptId: string | null;
  deviceId: string | null;
  title: string;
  detail: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt: ISODateString;
  updatedAt: ISODateString;
  assignedToUserId: string | null;
  notes: IncidentNote[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface IncidentNote {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | 'USER_LOGIN'
  | 'USER_LOGIN_FAILED'
  | 'USER_LOGOUT'
  | 'EXAM_CREATED'
  | 'EXAM_UPDATED'
  | 'QUESTION_CREATED'
  | 'QUESTION_MODIFIED'
  | 'QUESTION_SUBMITTED_FOR_REVIEW'
  | 'QUESTION_APPROVED'
  | 'QUESTION_CHANGES_REQUESTED'
  | 'PAPER_ASSEMBLED'
  | 'PUBLICATION_REQUESTED'
  | 'PUBLICATION_APPROVED'
  | 'EXAM_PUBLISHED'
  | 'SECURITY_POLICY_MODIFIED'
  | 'CANDIDATE_VERIFICATION'
  | 'ATTEMPT_ACTIVATED'
  | 'QUESTION_ASSIGNED'
  | 'ANSWER_SAVED'
  | 'ATTEMPT_SUBMITTED'
  | 'CAMERA_WARNING'
  | 'INVIGILATOR_ACTION'
  | 'DEVICE_REGISTERED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_CERT_ROTATED'
  | 'TIME_EXTENDED'
  | 'ADMIN_OVERRIDE'
  | 'INTEGRITY_CHECK'
  | 'DEMO_SCENARIO'
  | 'SECURITY_SIMULATION'
  | 'ACTIVATION_KEY_ISSUED'
  | 'ACTIVATION_KEY_USED'
  | 'ACTIVATION_KEY_REVOKED'
  | 'STATION_REDEEMED'
  | 'STATION_RETIRED';

export interface AuditEvent {
  id: string;
  sequence: number;
  timestamp: ISODateString;
  actorId: string;
  actorName: string;
  actorRole: Role | 'SYSTEM';
  action: AuditAction;
  targetType: string;
  targetId: string;
  targetLabel: string;
  result: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  reason: string;
  deviceId: string | null;
  ipAddress: string;
  traceId: string;
  previousHash: string;
  hash: string;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export interface SystemHealth {
  generatedAt: ISODateString;
  api: { status: ComponentStatus; uptimeSeconds: number; version: string };
  database: { status: ComponentStatus; label: string; latencyMs: number };
  redis: { status: ComponentStatus; label: string; latencyMs: number };
  evidenceStorage: { status: ComponentStatus; label: string; queuedObjects: number };
  keyService: { status: ComponentStatus; label: string; simulated: true };
  activeSessions: number;
  requestsPerMinute: number;
  answerWritesPerMinute: number;
  p95ResponseTimeMs: number;
  wafBlockedRequests: number;
  rateLimitedRequests: number;
  failedLogins: number;
  revokedDevices: number;
  unusualCryptoOperations: number;
  series: { at: ISODateString; requestsPerMinute: number; answerWrites: number; p95: number }[];
  degraded: boolean;
  degradedReason?: string | null;
}

export interface SecuritySimulationResult {
  id: string;
  scenario: string;
  title: string;
  startedAt: ISODateString;
  detection: string;
  controlActivated: string;
  userImpact: string;
  recoveryStatus: string;
  auditEventId: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  simulated: true;
}

/* ------------------------------------------------------------------ */
/* API envelope                                                        */
/* ------------------------------------------------------------------ */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** What the user should do about it, in plain language. */
    guidance?: string;
    /** Whether saved answers are unaffected — surfaced in candidate UI. */
    answersSafe?: boolean;
    details?: unknown;
    traceId: string;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
