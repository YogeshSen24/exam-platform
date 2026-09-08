import type {
  QuestionType,
  AttemptStatus,
  AuditAction,
  Difficulty,
  ExamStatus,
  IncidentType,
  NavigationMode,
  ProctoringResult,
  QuestionStatus,
  ResultMode,
} from './types.js';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  DIFFICULT: 'Difficult',
};

export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
  RETIRED: 'Retired',
};

export const EXAM_STATUS_LABELS: Record<ExamStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Awaiting approval',
  PUBLISHED: 'Published',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  NOT_STARTED: 'Not started',
  VERIFYING: 'Verification in progress',
  ACTIVE: 'Active',
  RESTRICTED: 'Temporarily restricted',
  AWAITING_REVERIFICATION: 'Requires review',
  DISCONNECTED: 'Disconnected',
  SUBMITTED: 'Submitted',
  TERMINATED: 'Terminated',
};

export const NAVIGATION_MODE_LABELS: Record<NavigationMode, string> = {
  FREE: 'Free navigation',
  SEQUENTIAL: 'Sequential navigation',
  SECTION_BASED: 'Section-based navigation',
};

export const NAVIGATION_MODE_HELP: Record<NavigationMode, string> = {
  FREE: 'Candidates may move between any questions in any order at any time.',
  SEQUENTIAL: 'Candidates answer questions in order and cannot return to an earlier question.',
  SECTION_BASED: 'Candidates move freely inside a section but cannot return once a section is closed.',
};

export const RESULT_MODE_LABELS: Record<ResultMode, string> = {
  IMMEDIATE: 'Show result immediately',
  AFTER_REVIEW: 'Release after review',
  SCHEDULED: 'Release on a scheduled date',
};

export const PROCTORING_RESULT_LABELS: Record<ProctoringResult, string> = {
  FACE_VERIFIED: 'Face verified',
  NO_FACE_DETECTED: 'No face detected',
  MULTIPLE_FACES: 'More than one face detected',
  FACE_UNCLEAR: 'Face unclear',
  LOW_LIGHT: 'Low light',
  CAMERA_BLOCKED: 'Camera blocked',
  IDENTITY_MISMATCH: 'Identity did not match enrolment',
  PROCESSING_UNAVAILABLE: 'Check could not be processed',
};

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  REPEATED_FACE_ABSENCE: 'Repeated face absence',
  MULTIPLE_FACES: 'Multiple faces detected',
  CAMERA_BLOCKED: 'Camera blocked',
  FINGERPRINT_MISMATCH: 'Fingerprint mismatch',
  DEVICE_HEALTH_FAILURE: 'Device health failure',
  NETWORK_CHANGE: 'Network change',
  REPEATED_LOGIN_FAILURE: 'Repeated login failure',
  APPLICATION_RESTART: 'Application restart',
  EXCESSIVE_API_REQUESTS: 'Excessive API requests',
  ANSWER_VERSION_CONFLICT: 'Answer-version conflict',
  UNAPPROVED_WORKSTATION: 'Unapproved workstation attempt',
  PAPER_INTEGRITY_FAILURE: 'Paper-integrity verification failed',
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  USER_LOGIN: 'User signed in',
  USER_LOGIN_FAILED: 'Sign-in failed',
  USER_LOGOUT: 'User signed out',
  EXAM_CREATED: 'Examination created',
  EXAM_UPDATED: 'Examination updated',
  QUESTION_CREATED: 'Question created',
  QUESTION_MODIFIED: 'Question modified',
  QUESTION_SUBMITTED_FOR_REVIEW: 'Question submitted for review',
  QUESTION_APPROVED: 'Question approved',
  QUESTION_CHANGES_REQUESTED: 'Question changes requested',
  PAPER_ASSEMBLED: 'Paper assembled',
  PUBLICATION_REQUESTED: 'Publication requested',
  PUBLICATION_APPROVED: 'Publication approved',
  EXAM_PUBLISHED: 'Examination published',
  SECURITY_POLICY_MODIFIED: 'Security policy modified',
  CANDIDATE_VERIFICATION: 'Candidate verification',
  ATTEMPT_ACTIVATED: 'Attempt activated',
  QUESTION_ASSIGNED: 'Question sequence assigned',
  ANSWER_SAVED: 'Answer saved',
  ATTEMPT_SUBMITTED: 'Examination submitted',
  CAMERA_WARNING: 'Camera warning raised',
  INVIGILATOR_ACTION: 'Invigilator action',
  DEVICE_REGISTERED: 'Device registered',
  DEVICE_REVOKED: 'Device revoked',
  DEVICE_CERT_ROTATED: 'Device certificate rotated',
  TIME_EXTENDED: 'Time extended',
  ADMIN_OVERRIDE: 'Administrative override',
  INTEGRITY_CHECK: 'Integrity check',
  DEMO_SCENARIO: 'Demonstration scenario',
  SECURITY_SIMULATION: 'Security simulation',
  ACTIVATION_KEY_ISSUED: 'Examination key issued',
  ACTIVATION_KEY_USED: 'Examination key redeemed',
  ACTIVATION_KEY_REVOKED: 'Examination key revoked',
  STATION_REDEEMED: 'Machine set up for an examination',
  STATION_RETIRED: 'Machine withdrawn from an examination',
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'Single choice',
  MULTIPLE_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True / false',
  SHORT_TEXT: 'Short text',
  PARAGRAPH: 'Paragraph',
};

export const QUESTION_TYPE_HELP: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'One correct option. Marked automatically.',
  MULTIPLE_CHOICE: 'Two or more correct options. Marked automatically.',
  TRUE_FALSE: 'A single true-or-false statement. Marked automatically.',
  SHORT_TEXT: 'A short free-text answer. Marked by a human examiner.',
  PARAGRAPH: 'An extended written answer within a word limit. Marked by a human examiner against the marking guidance.',
};

export const SUBJECTS = [
  'Quantitative Aptitude',
  'Logical Reasoning',
  'Verbal Ability',
  'Data Interpretation',
  'General Awareness',
  'Computer Fundamentals',
] as const;

export const TOPICS: Record<string, string[]> = {
  'Quantitative Aptitude': ['Arithmetic', 'Algebra', 'Geometry', 'Number Systems', 'Probability'],
  'Logical Reasoning': ['Series', 'Syllogism', 'Puzzles', 'Coding-Decoding', 'Blood Relations'],
  'Verbal Ability': ['Reading Comprehension', 'Grammar', 'Vocabulary', 'Sentence Correction'],
  'Data Interpretation': ['Tables', 'Bar Charts', 'Pie Charts', 'Caselets'],
  'General Awareness': ['Polity', 'Economy', 'Science', 'Current Affairs'],
  'Computer Fundamentals': ['Networking', 'Operating Systems', 'Databases', 'Security Basics'],
};
