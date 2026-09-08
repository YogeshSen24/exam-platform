/**
 * Roles and permissions shared by the API (authoritative enforcement) and the
 * web client (navigation shaping only).
 *
 * IMPORTANT: the client copy exists purely to hide controls the user cannot
 * use. Every permission is re-checked server-side on each request.
 */

export const ROLES = [
  'SUPER_ADMIN',
  'EXAM_ADMIN',
  'QUESTION_AUTHOR',
  'QUESTION_REVIEWER',
  'SECURITY_ADMIN',
  'INVIGILATOR',
  'CANDIDATE',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super administrator',
  EXAM_ADMIN: 'Examination administrator',
  QUESTION_AUTHOR: 'Question author',
  QUESTION_REVIEWER: 'Question reviewer',
  SECURITY_ADMIN: 'Security administrator',
  INVIGILATOR: 'Invigilator',
  CANDIDATE: 'Candidate',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN:
    'Manages users, centres, devices and system-wide security profiles. Cannot silently alter a published question paper.',
  EXAM_ADMIN:
    'Creates examinations, registers candidates and requests publication. Cannot approve their own question paper unless demo settings allow it.',
  QUESTION_AUTHOR:
    'Writes and edits draft questions and submits them for review. Cannot publish or modify approved questions.',
  QUESTION_REVIEWER:
    'Approves or rejects submitted questions and records review comments. Cannot edit an author’s question directly.',
  SECURITY_ADMIN:
    'Manages approved networks, registered devices, certificates and question-release policy approvals.',
  INVIGILATOR:
    'Monitors live candidate sessions, handles warnings and reverification. Cannot view the question bank.',
  CANDIDATE:
    'Signs in at an approved workstation, completes verification, answers the assigned paper and submits it.',
};

export const PERMISSIONS = [
  // Users, roles, system
  'users.read',
  'users.write',
  'system.health.read',
  'system.security.write',
  'audit.read',

  // Centres and devices
  'centres.read',
  'centres.write',
  'devices.read',
  'devices.write',
  'devices.revoke',

  // Exams
  'exams.read',
  'exams.write',
  'exams.publish.request',
  'exams.publish.approve',
  'exams.securityPolicy.write',

  // Questions
  'questions.read',
  'questions.write',
  'questions.review',
  'questions.publish',

  // Candidates
  'candidates.read',
  'candidates.write',

  // Invigilation
  'invigilation.read',
  'invigilation.act',

  // Candidate self-service
  'attempt.self',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [
    'users.read',
    'users.write',
    'system.health.read',
    'system.security.write',
    'audit.read',
    'centres.read',
    'centres.write',
    'devices.read',
    'devices.write',
    'devices.revoke',
    'exams.read',
    'exams.write',
    'exams.publish.request',
    'exams.securityPolicy.write',
    'candidates.write',
    'questions.write',
    'questions.read',
    'candidates.read',
    'invigilation.read',
  ],
  EXAM_ADMIN: [
    'centres.write',
    'devices.write',
    'questions.write',
    'exams.read',
    'exams.write',
    'exams.publish.request',
    'exams.securityPolicy.write',
    'candidates.read',
    'candidates.write',
    'centres.read',
    'devices.read',
    'questions.read',
    'audit.read',
    'invigilation.read',
    'system.health.read',
  ],
  QUESTION_AUTHOR: ['questions.read', 'questions.write', 'exams.read'],
  QUESTION_REVIEWER: ['questions.read', 'questions.review', 'exams.read', 'exams.publish.approve'],
  SECURITY_ADMIN: [
    'centres.read',
    'centres.write',
    'devices.read',
    'devices.write',
    'devices.revoke',
    'system.health.read',
    'system.security.write',
    'audit.read',
    'exams.read',
    'exams.publish.approve',
  ],
  INVIGILATOR: ['invigilation.read', 'invigilation.act', 'candidates.read', 'exams.read'],
  CANDIDATE: ['attempt.self'],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function rolesHavePermission(roles: Role[], permission: Permission): boolean {
  return roles.some((r) => roleHasPermission(r, permission));
}
