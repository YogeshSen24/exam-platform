import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { keyringFromPublicMaterial, openActivationKey, validateActivation } from '@sep/activation';
import { startApp, loginStaff, loginCandidate, authHeaders, setUpStation, currentStationCookie } from './helpers.js';
import { deploymentKeyring } from '../services/activationService.js';
import { getDb } from '../lib/store/db.js';

/**
 * Setting a machine up for an examination.
 *
 * A board runs several examinations at once, so the question a machine has to
 * answer first is "which one am I running?". The key answers it, and every
 * result that machine produces carries the answer with it.
 */

const SECURITY_ADMIN = 'security.admin@examboard.demo';

function publishedExam() {
  const db = getDb();
  return [...db.exams.values()].find(
    (e) => e.manifestId && db.manifests.get(e.manifestId)?.publicationStatus === 'PUBLISHED',
  )!;
}

async function issueKey(
  app: FastifyInstance,
  staff: Awaited<ReturnType<typeof loginStaff>>,
  overrides: Record<string, unknown> = {},
) {
  const exam = publishedExam();
  const centre = getDb().centres.get(exam.centreId)!;

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/activation/keys',
    headers: authHeaders(staff),
    payload: {
      examId: exam.id,
      centreId: centre.id,
      validForDays: 14,
      maxStations: 40,
      room: 'Room 4',
      session: 'Morning',
      tags: { shift: 'A' },
      note: 'Morning sitting.',
      ...overrides,
    },
  });
  return { response, exam, centre };
}

describe('issuing an examination key', () => {
  let app: FastifyInstance;
  let staff: Awaited<ReturnType<typeof loginStaff>>;

  beforeEach(async () => {
    app = await startApp();
    staff = await loginStaff(app, SECURITY_ADMIN);
  });

  it('produces a key that opens and names the examination it is for', async () => {
    const { response, exam, centre } = await issueKey(app, staff);
    expect(response.statusCode).toBe(201);

    const reader = keyringFromPublicMaterial(deploymentKeyring().publicMaterial);
    const opened = openActivationKey(response.json().key, reader);

    expect(opened.payload.exam.id).toBe(exam.id);
    expect(opened.payload.centre.id).toBe(centre.id);
    expect(validateActivation(opened.payload, { now: new Date(), deploymentId: deploymentKeyring().deploymentId })).toBeNull();
  });

  it('carries the whole rulebook, so a machine cannot loosen anything locally', async () => {
    const { response } = await issueKey(app, staff, {
      overrides: { fingerprint: 'REQUIRED', cameraMonitoring: true },
    });

    const reader = keyringFromPublicMaterial(deploymentKeyring().publicMaterial);
    const { payload } = openActivationKey(response.json().key, reader);

    expect(payload.rules.verification.fingerprint).toBe('REQUIRED');
    expect(payload.rules.monitoring.cameraMonitoring).toBe(true);
    expect(payload.rules.delivery.quotas.length).toBeGreaterThan(0);
    expect(payload.rules.delivery.totalDelivered).toBeGreaterThan(0);
  });

  it('carries the metadata that has to reach the results', async () => {
    const { response } = await issueKey(app, staff, { room: 'Hall B', session: 'Afternoon', tags: { invigilator: 'RK' } });

    const reader = keyringFromPublicMaterial(deploymentKeyring().publicMaterial);
    const { payload } = openActivationKey(response.json().key, reader);

    expect(payload.labels.room).toBe('Hall B');
    expect(payload.labels.session).toBe('Afternoon');
    expect(payload.labels.tags.invigilator).toBe('RK');
  });

  it('explains the key in plain language for the moderator who receives it', async () => {
    const body = (await issueKey(app, staff)).response.json();

    expect(body.summary).toMatch(/this machine will run/i);
    expect(body.rules.some((r: { label: string }) => r.label === 'Questions per candidate')).toBe(true);
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('never stores the key itself, only its fingerprint', async () => {
    const key = (await issueKey(app, staff)).response.json().key as string;

    const stored = [...getDb().activationKeys.values()];
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(stored.every((r) => /^[0-9a-f]{64}$/.test(r.fingerprint))).toBe(true);
  });

  it('refuses to issue a key for an examination with no published paper', async () => {
    const draft = [...getDb().exams.values()].find((e) => !e.manifestId)!;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/activation/keys',
      headers: authHeaders(staff),
      payload: { examId: draft.id, centreId: draft.centreId, validForDays: 7, maxStations: 10 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/no sealed paper/i);
  });

  it('is refused to staff without the provisioning permission', async () => {
    const author = await loginStaff(app, 'author@examboard.demo');
    expect((await issueKey(app, author)).response.statusCode).toBe(403);
  });
});

describe('setting a machine up', () => {
  let app: FastifyInstance;
  let staff: Awaited<ReturnType<typeof loginStaff>>;
  let key: string;

  beforeEach(async () => {
    app = await startApp();
    staff = await loginStaff(app, SECURITY_ADMIN);
    key = (await issueKey(app, staff)).response.json().key;
  });

  const redeem = (value = key, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/activation/station',
      headers: cookie ? { cookie } : {},
      payload: { key: value },
    });

  it('turns a pasted key into a station bound to one examination', async () => {
    const response = await redeem();
    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.exam.code).toBe(publishedExam().code);
    expect(body.station.room).toBe('Room 4');
    expect(response.headers['set-cookie']).toBeTruthy();
  });

  it('gives the machine a code an invigilator can read off the screen', async () => {
    expect((await redeem()).json().station.code).toMatch(/^[A-Z0-9-]+$/);
  });

  it('reports what this machine is set up for', async () => {
    const cookie = (await redeem()).headers['set-cookie'] as string;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/activation/station',
      headers: { cookie: cookie.split(';')[0]! },
    });

    expect(response.json().configured).toBe(true);
    expect(response.json().exam.code).toBe(publishedExam().code);
  });

  it('tells an unconfigured machine plainly that it is not set up', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/activation/station' });
    expect(response.json().configured).toBe(false);
  });

  it('refuses a key that was never issued by this board', async () => {
    const response = await redeem('SEPKEY1.deadbeef.AAAA.BBBB.CCCC.DDDD');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_ACTIVATION_KEY');
  });

  it('refuses a key whose contents have been altered', async () => {
    const segments = key.split('.');
    const ciphertext = Buffer.from(segments[3] as string, 'base64url');
    ciphertext[0] = (ciphertext[0] as number) ^ 0xff;
    segments[3] = ciphertext.toString('base64url');

    const response = await redeem(segments.join('.'));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/not genuine/i);
  });

  it('stops handing out stations once the key reaches its limit', async () => {
    const limited = (await issueKey(app, staff, { maxStations: 2 })).response.json().key;

    expect((await redeem(limited)).statusCode).toBe(201);
    expect((await redeem(limited)).statusCode).toBe(201);

    const third = await redeem(limited);
    expect(third.statusCode).toBe(403);
    expect(third.json().error.message).toMatch(/2 of a permitted 2 machines/i);
  });

  it('stops a revoked key from setting anything else up', async () => {
    const keyId = [...getDb().activationKeys.values()].at(-1)!.id;

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/v1/activation/keys/${keyId}/revoke`,
      headers: authHeaders(staff),
      payload: { reason: 'Key was emailed to the wrong centre.' },
    });
    expect(revoked.statusCode).toBe(200);

    const response = await redeem();
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/revoked/i);
  });

  it('sets the machine up for four hours, not indefinitely', async () => {
    const before = Date.now();
    const body = (await redeem()).json();

    const lifetime = new Date(body.station.expiresAt).getTime() - before;
    // Four hours, unless the examination window itself runs longer.
    expect(lifetime).toBeGreaterThan(3.5 * 3_600_000);
    expect(lifetime).toBeLessThan(30 * 3_600_000);
  });

  it('treats a lapsed setup as no setup at all', async () => {
    const cookie = ((await redeem()).headers['set-cookie'] as string).split(';')[0]!;

    // Wind the clock past the point where the machine should have lapsed.
    const station = [...getDb().stations.values()].at(-1)!;
    station.expiresAt = new Date(Date.now() - 1000).toISOString();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/activation/station',
      headers: { cookie },
    });

    expect(response.json().configured).toBe(false);
    expect(response.json().lapsed).toBe(true);
  });

  it('refuses to start an examination on a machine whose setup has lapsed', async () => {
    const cookie = ((await redeem()).headers['set-cookie'] as string).split(';')[0]!;
    const station = [...getDb().stations.values()].at(-1)!;
    station.expiresAt = new Date(Date.now() - 1000).toISOString();

    const candidate = await loginCandidate(app, 'NTAE26-000003');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/attempts/activate',
      headers: { cookie: `${candidate.cookie}; ${cookie}`, 'x-csrf-token': candidate.csrf },
      payload: {
        examId: candidate.examId,
        deviceCode: 'WS-CEC-001',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
        consent: { identityConfirmed: true, rulesUnderstood: true, monitoringAcknowledged: true, savingUnderstood: true },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/lapsed/i);
  });

  it('shows head office every machine that has been set up', async () => {
    await redeem();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/activation/stations',
      headers: authHeaders(staff),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().stations.length).toBeGreaterThan(0);
    expect(response.json().stations[0].room).toBeDefined();
  });
});

describe('the machine decides which examination is sat', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await startApp();
  });

  it('refuses to start an examination on a machine nobody has set up', async () => {
    const candidate = await loginCandidate(app, 'NTAE26-000001');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/attempts/activate',
      // Session cookie only: no station cookie, as on a fresh machine.
      headers: { cookie: candidate.cookie, 'x-csrf-token': candidate.csrf },
      payload: {
        examId: candidate.examId,
        deviceCode: 'WS-CEC-001',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
        consent: { identityConfirmed: true, rulesUnderstood: true, monitoringAcknowledged: true, savingUnderstood: true },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/not been set up/i);
  });

  it('refuses a candidate who is booked onto a different examination', async () => {
    const otherExam = [...getDb().exams.values()].find(
      (e) => e.id !== publishedExam().id && e.manifestId && getDb().manifests.get(e.manifestId)?.publicationStatus === 'PUBLISHED',
    );
    if (!otherExam) return; // only one published examination in this dataset

    const cookie = await setUpStation(app, { examId: otherExam.id });
    const candidate = await loginCandidate(app, 'NTAE26-000001');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/attempts/activate',
      headers: { cookie: `${candidate.cookie}; ${cookie}`, 'x-csrf-token': candidate.csrf },
      payload: {
        examId: candidate.examId,
        deviceCode: 'WS-CEC-001',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
        consent: { identityConfirmed: true, rulesUnderstood: true, monitoringAcknowledged: true, savingUnderstood: true },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/set up for a different examination/i);
  });

  it('stamps every attempt with the centre, room, sitting and machine', async () => {
    const candidate = await loginCandidate(app, 'NTAE26-000001');
    const activated = await app.inject({
      method: 'POST',
      url: '/api/v1/attempts/activate',
      headers: { cookie: `${candidate.cookie}; ${currentStationCookie()}`, 'x-csrf-token': candidate.csrf },
      payload: {
        examId: candidate.examId,
        deviceCode: 'WS-CEC-001',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
        consent: { identityConfirmed: true, rulesUnderstood: true, monitoringAcknowledged: true, savingUnderstood: true },
      },
    });
    expect(activated.statusCode).toBe(201);

    const attempt = getDb().attempts.get(activated.json().attempt.id)!;
    expect(attempt.provenance?.room).toBe('R1');
    expect(attempt.provenance?.session).toBe('Morning');
    expect(attempt.provenance?.tags.shift).toBe('A');
    expect(attempt.provenance?.stationCode).toBeTruthy();
    expect(attempt.provenance?.centreCode).toBeTruthy();
  });

  it('counts the attempts started at each machine', async () => {
    const candidate = await loginCandidate(app, 'NTAE26-000002');
    await app.inject({
      method: 'POST',
      url: '/api/v1/attempts/activate',
      headers: { cookie: `${candidate.cookie}; ${currentStationCookie()}`, 'x-csrf-token': candidate.csrf },
      payload: {
        examId: candidate.examId,
        deviceCode: 'WS-CEC-001',
        verification: { fingerprint: 'PASSED', face: 'PASSED' },
        consent: { identityConfirmed: true, rulesUnderstood: true, monitoringAcknowledged: true, savingUnderstood: true },
      },
    });

    expect([...getDb().stations.values()].some((s) => s.attemptCount > 0)).toBe(true);
  });
});
