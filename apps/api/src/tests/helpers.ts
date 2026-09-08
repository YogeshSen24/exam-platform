import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { seedDatabase, DEMO_CANDIDATE_PASSWORD, DEMO_STAFF_PASSWORD } from '../data/seed.js';
import { primeMetricsSeries } from '../services/opsService.js';

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
  return app;
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
    headers: { 'x-workstation-code': workstationCode },
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
  return { cookie: client.cookie, 'x-csrf-token': client.csrf, ...extra };
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
    headers: { cookie: client.cookie },
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
