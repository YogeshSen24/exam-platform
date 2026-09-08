import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, rolesHavePermission, type Permission, type Role } from '@sep/shared';

/**
 * Role-based navigation.
 *
 * The sidebar hides what a role cannot use. This is a usability measure only —
 * the API enforces the same rules on every request — but it must still be
 * correct, or staff are shown links that will refuse them.
 */

/** Mirrors the permission each navigation entry in AppShell requires. */
const NAV_ITEMS: { label: string; permission: Permission }[] = [
  { label: 'Dashboard', permission: 'exams.read' },
  { label: 'Examinations', permission: 'exams.read' },
  { label: 'Question bank', permission: 'questions.read' },
  { label: 'Question review', permission: 'questions.review' },
  { label: 'Paper builder', permission: 'exams.read' },
  { label: 'Candidates', permission: 'candidates.read' },
  { label: 'Centres', permission: 'centres.read' },
  { label: 'Workstations', permission: 'devices.read' },
  { label: 'Users and roles', permission: 'users.read' },
  { label: 'Live examination', permission: 'invigilation.read' },
  { label: 'Alert queue', permission: 'invigilation.read' },
  { label: 'Security profiles', permission: 'exams.read' },
  { label: 'Privacy and evidence', permission: 'invigilation.read' },
  { label: 'Audit log', permission: 'audit.read' },
  { label: 'System health', permission: 'system.health.read' },
];

function visibleFor(role: Role): string[] {
  return NAV_ITEMS.filter((item) => rolesHavePermission([role], item.permission)).map((item) => item.label);
}

describe('role-based navigation', () => {
  it('shows an invigilator live operations but never the question bank', () => {
    const visible = visibleFor('INVIGILATOR');
    expect(visible).toContain('Live examination');
    expect(visible).toContain('Alert queue');
    expect(visible).not.toContain('Question bank');
    expect(visible).not.toContain('Question review');
    expect(visible).not.toContain('Audit log');
  });

  it('shows a question author the question bank but not the review queue', () => {
    const visible = visibleFor('QUESTION_AUTHOR');
    expect(visible).toContain('Question bank');
    expect(visible).not.toContain('Question review');
    expect(visible).not.toContain('Candidates');
    expect(visible).not.toContain('Users and roles');
  });

  it('shows a reviewer the review queue but no authoring or candidate management', () => {
    const visible = visibleFor('QUESTION_REVIEWER');
    expect(visible).toContain('Question review');
    expect(visible).toContain('Question bank');
    expect(visible).not.toContain('Candidates');
    expect(visible).not.toContain('Workstations');
  });

  it('shows a security administrator devices, health and audit but not candidate management', () => {
    const visible = visibleFor('SECURITY_ADMIN');
    expect(visible).toContain('Workstations');
    expect(visible).toContain('System health');
    expect(visible).toContain('Audit log');
    expect(visible).not.toContain('Candidates');
  });

  it('shows an examination administrator the full examination lifecycle', () => {
    const visible = visibleFor('EXAM_ADMIN');
    expect(visible).toEqual(
      expect.arrayContaining(['Dashboard', 'Examinations', 'Candidates', 'Question bank', 'Audit log']),
    );
    // An administrator does not review questions.
    expect(visible).not.toContain('Question review');
  });

  it('gives a candidate no administrative navigation at all', () => {
    expect(visibleFor('CANDIDATE')).toEqual([]);
    expect(ROLE_PERMISSIONS.CANDIDATE).toEqual(['attempt.self']);
  });

  it('never grants publication approval to an invigilator or an author', () => {
    expect(rolesHavePermission(['INVIGILATOR'], 'exams.publish.approve')).toBe(false);
    expect(rolesHavePermission(['QUESTION_AUTHOR'], 'exams.publish.approve')).toBe(false);
    expect(rolesHavePermission(['QUESTION_REVIEWER'], 'exams.publish.approve')).toBe(true);
    expect(rolesHavePermission(['SECURITY_ADMIN'], 'exams.publish.approve')).toBe(true);
  });

  it('never grants question writing to a reviewer', () => {
    expect(rolesHavePermission(['QUESTION_REVIEWER'], 'questions.write')).toBe(false);
  });
});
