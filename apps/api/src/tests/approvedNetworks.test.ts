import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../lib/store/db.js';
import { ipInCidr, toCidr } from '../lib/network.js';
import { upsertAssignment } from '../services/deviceService.js';
import { authHeaders, loginCandidate, loginStaff, startApp } from './helpers.js';

/**
 * Approved networks are the one control a hosted demonstration trips over: the
 * seeded ranges are centre LANs, and anything reaching the service over the
 * public internet is outside them. These tests cover editing those ranges and
 * the effect on a candidate standing at the machine.
 */
describe('approved network ranges', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('range matching', () => {
    it('matches an IPv4 address inside a range and rejects one outside it', () => {
      expect(ipInCidr('10.42.10.17', '10.42.0.0/16')).toBe(true);
      expect(ipInCidr('223.181.81.177', '10.42.0.0/16')).toBe(false);
    });

    it('treats a single address as a one-host range', () => {
      expect(toCidr('223.181.81.177')).toBe('223.181.81.177/32');
      expect(toCidr('2001:db8::5')).toBe('2001:db8::5/128');
      expect(toCidr('10.42.0.0/16')).toBe('10.42.0.0/16');
      expect(toCidr('  ')).toBeNull();
      expect(ipInCidr('223.181.81.177', '223.181.81.177/32')).toBe(true);
      expect(ipInCidr('223.181.81.178', '223.181.81.177/32')).toBe(false);
    });

    it('matches IPv6 ranges, including compressed and IPv4-mapped forms', () => {
      expect(ipInCidr('2001:db8:0:1::5', '2001:db8::/32')).toBe(true);
      expect(ipInCidr('2001:db9::5', '2001:db8::/32')).toBe(false);
      expect(ipInCidr('2001:db8::1:2:3:4', '2001:db8:0:0:1::/80')).toBe(true);
      expect(ipInCidr('::ffff:10.42.10.17', '::ffff:10.42.0.0/112')).toBe(true);
      expect(ipInCidr('2001:db8::5', '2001:db8::5/128')).toBe(true);
    });

    it('never matches an address against a range of the other family', () => {
      expect(ipInCidr('10.42.10.17', '2001:db8::/32')).toBe(false);
      expect(ipInCidr('2001:db8::5', '10.42.0.0/16')).toBe(false);
      expect(ipInCidr('10.42.10.17', 'not-a-range')).toBe(false);
    });
  });

  describe('editing a centre', () => {
    it('accepts a bare address, records the reason, and refuses nonsense', async () => {
      const staff = await loginStaff(app, 'security.admin@examboard.demo');
      const centreId = 'centre-central';

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/centres/${centreId}/networks`,
        headers: authHeaders(staff),
        payload: {
          primaryCidr: '223.181.81.177',
          backupCidr: '10.43.0.0/16',
          ipv6Cidr: '',
          reason: 'Client demonstration runs over the public internet.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().centre.primaryCidr).toBe('223.181.81.177/32');
      expect(response.json().centre.ipv6Cidr).toBeNull();

      const audit = getDb().auditEvents.at(-1);
      expect(audit?.action).toBe('NETWORK_POLICY_UPDATED');
      expect(audit?.reason).toContain('Client demonstration');
      expect(audit?.reason).toContain('223.181.81.177/32');

      const rejected = await app.inject({
        method: 'POST',
        url: `/api/v1/centres/${centreId}/networks`,
        headers: authHeaders(staff),
        payload: { primaryCidr: 'the office wifi', reason: 'Trying it on.' },
      });
      expect(rejected.statusCode).toBe(400);
    });

    it('is refused to an invigilator', async () => {
      const staff = await loginStaff(app, 'invigilator@examboard.demo');
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/centres/centre-central/networks',
        headers: authHeaders(staff),
        payload: { primaryCidr: '10.42.0.0/16', reason: 'Not my job.' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('editing an examination', () => {
    it('lets a candidate at the newly approved address pass the network check', async () => {
      const db = getDb();
      const exam = [...db.exams.values()].find(
        (entry) => entry.manifestId && db.manifests.get(entry.manifestId)?.publicationStatus === 'PUBLISHED',
      );
      if (!exam) throw new Error('No published examination was seeded.');

      const staff = await loginStaff(app, 'security.admin@examboard.demo');
      const updated = await app.inject({
        method: 'POST',
        url: `/api/v1/exams/${exam.id}/networks`,
        headers: authHeaders(staff),
        payload: {
          primaryCidr: '203.0.113.55',
          backupCidr: '10.43.0.0/16',
          ipv6Cidr: '2001:db8::/32',
          reason: 'Sitting delivered from the hosted demonstration network.',
        },
      });

      expect(updated.statusCode).toBe(200);
      expect(updated.json().network.primaryCidr).toBe('203.0.113.55/32');
      expect(exam.securityPolicy.network.ipv6Cidr).toBe('2001:db8::/32');

      const client = await loginCandidate(app, 'NTAE26-000022', 'WS-CEC-006');
      const preflight = await app.inject({
        method: 'POST',
        url: '/api/v1/attempts/preflight',
        headers: authHeaders(client, {
          'x-workstation-code': 'WS-CEC-006',
          'x-demo-client-ip': '203.0.113.55',
        }),
        payload: { deviceCode: 'WS-CEC-006', verification: { fingerprint: 'PASSED', face: 'PASSED' } },
      });

      const network = preflight
        .json()
        .checks.find((check: { key: string }) => check.key === 'network') as { status: string; detail: string };
      expect(network.status).toBe('PASSED');
      expect(network.detail).toContain('203.0.113.55/32');
    });

    it('realigns candidates who inherited the ranges and leaves deliberate ones alone', async () => {
      const db = getDb();
      const exam = [...db.exams.values()].find(
        (entry) => entry.manifestId && db.manifests.get(entry.manifestId)?.publicationStatus === 'PUBLISHED',
      );
      if (!exam) throw new Error('No published examination was seeded.');

      const network = exam.securityPolicy.network;
      const inherited = [network.primaryCidr, network.backupCidr].filter((cidr): cidr is string => Boolean(cidr));
      const candidates = [...db.candidates.values()].filter((candidate) => candidate.examId === exam.id).slice(0, 2);
      expect(candidates.length).toBe(2);

      const followed = upsertAssignment({
        examId: exam.id,
        candidateId: candidates[0]!.id,
        candidateApplicationId: candidates[0]!.applicationId,
        candidateName: candidates[0]!.fullName,
        deviceId: null,
        seatNumber: 'D-001',
        allowedCidrs: inherited,
        allowAnyApprovedDevice: false,
      });
      const ownRanges = upsertAssignment({
        examId: exam.id,
        candidateId: candidates[1]!.id,
        candidateApplicationId: candidates[1]!.applicationId,
        candidateName: candidates[1]!.fullName,
        deviceId: null,
        seatNumber: 'D-002',
        // One hall on its own VLAN: a deliberate override, not an inherited copy.
        allowedCidrs: ['10.99.0.0/16'],
        allowAnyApprovedDevice: false,
      });

      const staff = await loginStaff(app, 'security.admin@examboard.demo');
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/exams/${exam.id}/networks`,
        headers: authHeaders(staff),
        payload: {
          primaryCidr: '198.51.100.0/24',
          reason: 'Second renumbering of the demonstration network.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().realignedAssignments).toBe(1);
      expect(followed.allowedCidrs).toEqual(['198.51.100.0/24']);
      expect(ownRanges.allowedCidrs).toEqual(['10.99.0.0/16']);
    });

    it('is refused to an examination administrator', async () => {
      const db = getDb();
      const exam = [...db.exams.values()][0]!;
      const staff = await loginStaff(app, 'exam.admin@examboard.demo');
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/exams/${exam.id}/networks`,
        headers: authHeaders(staff),
        payload: { primaryCidr: '10.42.0.0/16', reason: 'Loosening the network myself.' },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
