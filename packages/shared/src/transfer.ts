import type { ISODateString } from './types.js';

/**
 * Bulk import and export.
 *
 * Import is deliberately two-phase: **validate**, then **commit**. An
 * administrator preparing a 500-candidate examination needs to see every problem
 * in the file before anything is written, not discover row 340 was malformed
 * after 339 rows already landed.
 */

export type ImportKind =
  | 'CANDIDATES'
  | 'DEVICES'
  | 'CANDIDATE_DEVICE_ASSIGNMENTS'
  | 'NETWORK_RANGES'
  | 'QUESTIONS';

export interface ImportColumn {
  key: string;
  header: string;
  required: boolean;
  /** What a valid value looks like, shown in the interface and the template. */
  example: string;
  description: string;
}

export interface ImportIssue {
  /** 1-based row number as it appears in the spreadsheet, including the header. */
  row: number;
  column: string | null;
  severity: 'ERROR' | 'WARNING';
  message: string;
  /** The value that caused the problem, so the administrator can find it. */
  value: string | null;
}

export interface ImportPreviewRow {
  row: number;
  data: Record<string, string>;
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'REJECT';
  /** Why this row will be skipped or rejected. */
  note: string | null;
}

export interface ImportValidation {
  kind: ImportKind;
  fileName: string;
  totalRows: number;
  /** Rows that would be written if committed. */
  validRows: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  rejectCount: number;
  issues: ImportIssue[];
  /** First 50 rows, so the administrator can eyeball the parse before committing. */
  preview: ImportPreviewRow[];
  /** A validation token the commit call must present, so the two phases match. */
  token: string;
  expiresAt: ISODateString;
  canCommit: boolean;
  summary: string;
}

export interface ImportResult {
  kind: ImportKind;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Anything that failed at commit time despite validating. */
  issues: ImportIssue[];
  auditEventId: string;
  committedAt: ISODateString;
  summary: string;
}

/** Column definitions, used for validation, the interface and template downloads. */
export const IMPORT_COLUMNS: Record<ImportKind, ImportColumn[]> = {
  CANDIDATES: [
    { key: 'applicationId', header: 'Application ID', required: true, example: 'NTAE26-000501', description: 'Unique across the examination cycle. Letters, numbers and hyphens.' },
    { key: 'fullName', header: 'Full name', required: true, example: 'Aarav Sharma', description: 'As it should appear on the admit card and the receipt.' },
    { key: 'email', header: 'Email', required: true, example: 'a.sharma@candidates.demo', description: 'Used for correspondence only.' },
    { key: 'eligibility', header: 'Eligibility', required: false, example: 'ELIGIBLE', description: 'ELIGIBLE, PROVISIONAL or INELIGIBLE. Defaults to ELIGIBLE.' },
    { key: 'centreCode', header: 'Centre code', required: false, example: 'CEC-01', description: 'The examination centre this candidate reports to.' },
    { key: 'additionalTimeMinutes', header: 'Additional time (minutes)', required: false, example: '20', description: 'Approved accommodation. Whole minutes, 0–120.' },
    { key: 'requirements', header: 'Accessibility requirements', required: false, example: 'Screen magnification; Additional time', description: 'Separate multiple entries with a semicolon.' },
    { key: 'notes', header: 'Notes', required: false, example: 'Accommodation approved 12 Aug', description: 'Free text for the examination controller.' },
  ],
  DEVICES: [
    { key: 'deviceCode', header: 'Workstation ID', required: true, example: 'WS-CEC-026', description: 'Printed on the machine. Unique across the organisation.' },
    { key: 'name', header: 'Display name', required: true, example: 'Examination workstation 26', description: 'Shown to operators and invigilators.' },
    { key: 'centreCode', header: 'Centre code', required: true, example: 'CEC-01', description: 'The centre this workstation belongs to.' },
    { key: 'operatingSystem', header: 'Operating system', required: false, example: 'Windows 11 Enterprise 23H2', description: 'As reported by the managed build.' },
    { key: 'ipAddress', header: 'IP address', required: true, example: '10.42.10.36', description: 'Must fall inside the centre’s approved range.' },
    { key: 'kioskPolicyVersion', header: 'Kiosk policy version', required: false, example: '2026.01.3', description: 'Defaults to the current policy version.' },
    { key: 'machineGuid', header: 'Machine GUID', required: false, example: '8f14e45f-ceea-467a-9ae4-1ba1b0f0a2c1', description: 'Windows MachineGuid. Supplying it enables auto-detection immediately.' },
    { key: 'macAddresses', header: 'MAC addresses', required: false, example: '00:1a:2b:3c:4d:5e; 00:1a:2b:3c:4d:5f', description: 'Separate multiple adapters with a semicolon.' },
  ],
  CANDIDATE_DEVICE_ASSIGNMENTS: [
    { key: 'applicationId', header: 'Application ID', required: true, example: 'NTAE26-000001', description: 'The candidate being assigned.' },
    { key: 'deviceCode', header: 'Workstation ID', required: false, example: 'WS-CEC-001', description: 'Leave blank to allow any approved workstation at the centre.' },
    { key: 'seatNumber', header: 'Seat number', required: false, example: 'S-01-01', description: 'Printed on the seating plan.' },
    { key: 'allowedCidrs', header: 'Allowed networks', required: false, example: '10.42.0.0/16; 10.43.0.0/16', description: 'Overrides the examination ranges for this candidate. Semicolon separated.' },
    { key: 'allowAnyApprovedDevice', header: 'Allow any approved workstation', required: false, example: 'no', description: 'yes or no. Defaults to no when a workstation is named.' },
  ],
  NETWORK_RANGES: [
    { key: 'centreCode', header: 'Centre code', required: true, example: 'CEC-01', description: 'The centre this range belongs to.' },
    { key: 'cidr', header: 'Network range (CIDR)', required: true, example: '10.42.0.0/16', description: 'IPv4 range in CIDR form.' },
    { key: 'kind', header: 'Kind', required: true, example: 'PRIMARY', description: 'PRIMARY, BACKUP or IPV6.' },
    { key: 'description', header: 'Description', required: false, example: 'Hall A examination VLAN', description: 'What this range covers.' },
  ],
  QUESTIONS: [
    { key: 'categoryCode', header: 'Category code', required: true, example: 'QA', description: 'Determines the marks. Every question in a category is worth the same.' },
    { key: 'type', header: 'Type', required: true, example: 'SINGLE_CHOICE', description: 'SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE or PARAGRAPH.' },
    { key: 'stem', header: 'Question text', required: true, example: 'What is 12 × 12?', description: 'Exactly as the candidate should read it.' },
    { key: 'difficulty', header: 'Difficulty', required: true, example: 'MEDIUM', description: 'EASY, MEDIUM or DIFFICULT.' },
    { key: 'topic', header: 'Topic', required: true, example: 'Arithmetic', description: 'Topic within the category’s subject.' },
    { key: 'optionA', header: 'Option A', required: false, example: '144', description: 'Leave option columns blank for paragraph questions.' },
    { key: 'optionB', header: 'Option B', required: false, example: '124', description: '' },
    { key: 'optionC', header: 'Option C', required: false, example: '134', description: '' },
    { key: 'optionD', header: 'Option D', required: false, example: '154', description: '' },
    { key: 'correctOptions', header: 'Correct option(s)', required: false, example: 'A', description: 'Letters, comma separated for multiple choice. Blank for paragraph.' },
    { key: 'explanation', header: 'Explanation', required: false, example: '12 × 12 = 144.', description: 'Never shown to a candidate during the examination.' },
    { key: 'markingGuidance', header: 'Marking guidance', required: false, example: 'Award 4 marks for structure, 6 for content.', description: 'For paragraph questions, guidance for the human examiner.' },
  ],
};

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export type ExportSection =
  | 'EXAM_CONFIGURATION'
  | 'SECURITY_POLICY'
  | 'CATEGORIES'
  | 'QUESTION_PAPER'
  | 'ANSWER_KEY'
  | 'CANDIDATES'
  | 'DEVICE_ASSIGNMENTS'
  | 'ATTEMPTS'
  | 'ANSWERS'
  | 'RECEIPTS'
  | 'PROCTORING_EVENTS'
  | 'INCIDENTS'
  | 'AUDIT_TRAIL'
  | 'TRACKING_FINDINGS';

export interface ExportSectionInfo {
  id: ExportSection;
  label: string;
  description: string;
  /** Sections carrying personal data or the answer key need a stated reason. */
  sensitive: boolean;
  /** Roles permitted to include this section. */
  requiredPermission: string;
}

export const EXPORT_SECTIONS: ExportSectionInfo[] = [
  { id: 'EXAM_CONFIGURATION', label: 'Examination configuration', description: 'Schedule, navigation, blueprint and category allocations.', sensitive: false, requiredPermission: 'exams.read' },
  { id: 'SECURITY_POLICY', label: 'Security policy', description: 'Profile, verification, monitoring, network and device policy.', sensitive: false, requiredPermission: 'exams.read' },
  { id: 'CATEGORIES', label: 'Question categories', description: 'Category definitions and the marks each carries.', sensitive: false, requiredPermission: 'exams.read' },
  { id: 'QUESTION_PAPER', label: 'Question paper', description: 'Every question as delivered, with its fingerprint. Excludes the answer key.', sensitive: true, requiredPermission: 'questions.read' },
  { id: 'ANSWER_KEY', label: 'Answer key', description: 'Correct answers and marking guidance. Highly sensitive.', sensitive: true, requiredPermission: 'questions.review' },
  { id: 'CANDIDATES', label: 'Candidate register', description: 'Registered candidates, accommodations and enrolment status.', sensitive: true, requiredPermission: 'candidates.read' },
  { id: 'DEVICE_ASSIGNMENTS', label: 'Seat and device assignments', description: 'Which candidate was assigned which workstation and network.', sensitive: false, requiredPermission: 'devices.read' },
  { id: 'ATTEMPTS', label: 'Attempts', description: 'Attempt state, timing, identity status and progress.', sensitive: true, requiredPermission: 'invigilation.read' },
  { id: 'ANSWERS', label: 'Answers', description: 'Every submitted answer, per candidate and question.', sensitive: true, requiredPermission: 'exams.read' },
  { id: 'RECEIPTS', label: 'Submission receipts', description: 'Receipt identifiers and integrity values.', sensitive: false, requiredPermission: 'exams.read' },
  { id: 'PROCTORING_EVENTS', label: 'Monitoring events', description: 'Presence-check results and evidence references. No images.', sensitive: true, requiredPermission: 'invigilation.read' },
  { id: 'INCIDENTS', label: 'Incidents', description: 'Raised incidents, notes and outcomes.', sensitive: false, requiredPermission: 'invigilation.read' },
  { id: 'AUDIT_TRAIL', label: 'Audit trail', description: 'The complete hash-chained audit record for this examination.', sensitive: false, requiredPermission: 'audit.read' },
  { id: 'TRACKING_FINDINGS', label: 'Tracking findings', description: 'What the real-time tracking service raised during delivery.', sensitive: false, requiredPermission: 'system.health.read' },
];

export type ExportFormat = 'XLSX' | 'JSON' | 'CSV_BUNDLE';

export interface ExportRequest {
  examId: string;
  sections: ExportSection[];
  format: ExportFormat;
  /** Mandatory. Written to the audit trail with the export. */
  reason: string;
  /** Replace candidate names and identifiers with stable pseudonyms. */
  pseudonymise: boolean;
}

export interface ExportManifest {
  id: string;
  examId: string;
  examCode: string;
  format: ExportFormat;
  sections: ExportSection[];
  rowCounts: Record<string, number>;
  generatedAt: ISODateString;
  generatedByUserId: string;
  generatedByName: string;
  reason: string;
  pseudonymised: boolean;
  /** SHA-256 of the exported payload, so the file can be checked on receipt. */
  contentHash: string;
  sizeBytes: number;
  fileName: string;
  auditEventId: string;
  /** Present when the export contains personal data or the answer key. */
  handlingNotice: string | null;
}
