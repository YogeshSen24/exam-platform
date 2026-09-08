import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { seedDatabase, DEMO_CANDIDATE_PASSWORD, DEMO_STAFF_PASSWORD } from '../data/seed.js';
import { primeMetricsSeries } from '../services/opsService.js';
import { getDb } from '../lib/store/db.js';

/**
 * The machine the tests sit at.
 *
 * A candidate cannot start an examination on a machine nobody has set up, so
 * every test run begins the way a real morning does: an administrator issues a
 * key and a moderator redeems it. The resulting cookie is carried by every
 * candidate request, exactly as a browser would carry it.
 */
let stationCookie = '';

export function currentStationCookie(): string {
  return stationCookie;
}

/** Combines the station cookie with a session cookie, as a browser would. */
function withStation(cookie: string): string {
  return [cookie, stationCookie].filter(Boolean).join('; ');
}

export interface TestClient {
  app: FastifyInstance;
  cookie: string;
  csrf: string;
}

export async function startApp(): Promise<FastifyInstance> {
  await seedDatabase();
  primeMetricsSeries();
  const app = await buildApp();
  await app.ready();
  stationCookie = await setUpStation(app);
  return app;
}

/**
 * Sets a machine up for the published examination, and returns its cookie.
 *
 * Issues a key as a security administrator and redeems it, which is the whole
 * provisioning path a centre goes through.
 */
export async function setUpStation(
  app: FastifyInstance,
  options: { examId?: string; centreId?: string; room?: string; maxStations?: number } = {},
): Promise<string> {
  const db = getDb();
  const exam =
    (options.examId ? db.exams.get(options.examId) : undefined) ??
    [...db.exams.values()].find((e) => e.manifestId && db.manifests.get(e.manifestId)?.publicationStatus === 'PUBLISHED');
  if (!exam) throw new Error('No published examination to set a machine up for.');

  const centreId = options.centreId ?? exam.centreId;
  const staff = await loginStaff(app, 'security.admin@examboard.demo');

  const issued = await app.inject({
    method: 'POST',
    url: '/api/v1/activation/keys',
    headers: authHeaders(staff),
    payload: {
      examId: exam.id,
      centreId,
      validForDays: 7,
      maxStations: options.maxStations ?? 50,
      room: options.room ?? 'R1',
      session: 'Morning',
      tags: { shift: 'A' },
      note: '',
    },
  });
  if (issued.statusCode !== 201) throw new Error(`Key issue failed: ${issued.body}`);

  const redeemed = await app.inject({
    method: 'POST',
    url: '/api/v1/activation/station',
    payload: { key: issued.json().key },
  });
  if (redeemed.statusCode !== 201) throw new Error(`Station setup failed: ${redeemed.body}`);

  const raw = redeemed.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw.find((c) => c.startsWith('sep_station=')) : raw;
  if (!value) throw new Error('The station cookie was not issued.');
  return value.split(';')[0]!;
}

function extractCookie(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value.split(';')[0]! : '';
}

export async function loginStaff(app: FastifyInstance, email: string): Promise<TestClient> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: DEMO_STAFF_PASSWORD },
  });
  if (response.statusCode !== 200) throw new Error(`Staff login failed: ${response.body}`);
  return {
    app,
    cookie: extractCookie(response.headers['set-cookie'] as string | string[]),
    csrf: response.json().csrfToken,
  };
}

export async function loginCandidate(
  app: FastifyInstance,
  applicationId: string,
  workstationCode = 'WS-CEC-001',
): Promise<TestClient & { examId: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/candidate-login',
    headers: { 'x-workstation-code': workstationCode, cookie: stationCookie },
    payload: { applicationId, password: DEMO_CANDIDATE_PASSWORD, workstationCode },
  });
  if (response.statusCode !== 200) throw new Error(`Candidate login failed: ${response.body}`);
  const body = response.json();
  return {
    app,
    cookie: extractCookie(response.headers['set-cookie'] as string | string[]),
    csrf: body.csrfToken,
    examId: body.exam.id,
  };
}

export function authHeaders(client: TestClient, extra: Record<string, string> = {}) {
  return { cookie: withStation(client.cookie), 'x-csrf-token': client.csrf, ...extra };
}

export async function activate(
  client: TestClient & { examId: string },
  workstationCode = 'WS-CEC-001',
  verification: { fingerprint?: string; face?: string } = {},
) {
  return client.app.inject({
    method: 'POST',
    url: '/api/v1/attempts/activate',
    headers: authHeaders(client, { 'x-workstation-code': workstationCode }),
    payload: {
      examId: client.examId,
      deviceCode: workstationCode,
      verification: { fingerprint: verification.fingerprint ?? 'PASSED', face: verification.face ?? 'PASSED' },
      consent: {
        identityConfirmed: true,
        rulesUnderstood: true,
        monitoringAcknowledged: true,
        savingUnderstood: true,
      },
    },
  });
}

export async function fetchQuestion(client: TestClient, attemptId: string, sequence: number) {
  return client.app.inject({
    method: 'GET',
    url: `/api/v1/attempts/${attemptId}/question/${sequence}`,
    headers: { cookie: withStation(client.cookie) },
  });
}

export async function saveAnswerRequest(
  client: TestClient,
  attemptId: string,
  assignmentQuestionId: string,
  payload: {
    selectedOptionIds: string[];
    expectedVersion: number;
    flagged?: boolean;
    idempotencyKey: string;
  },
) {
  return client.app.inject({
    method: 'PUT',
    url: `/api/v1/attempts/${attemptId}/answers/${assignmentQuestionId}`,
    headers: authHeaders(client, { 'idempotency-key': payload.idempotencyKey }),
    payload: {
      selectedOptionIds: payload.selectedOptionIds,
      textAnswer: null,
      flagged: payload.flagged ?? false,
      expectedVersion: payload.expectedVersion,
      clientCapturedAt: new Date().toISOString(),
    },
  });
}
