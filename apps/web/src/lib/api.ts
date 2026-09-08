/**
 * API client.
 *
 * The session lives in an HTTP-only cookie the script cannot read. Every
 * mutation carries the CSRF token issued at sign-in, plus the workstation
 * identifier and — in demo mode only — a simulated client address.
 */

export interface ApiErrorShape {
  code: string;
  message: string;
  guidance?: string;
  answersSafe?: boolean;
  details?: unknown;
  traceId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly guidance: string;
  readonly answersSafe: boolean;
  readonly details: unknown;
  readonly traceId: string;

  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.guidance = body.guidance ?? '';
    this.answersSafe = body.answersSafe ?? true;
    this.details = body.details;
    this.traceId = body.traceId;
  }

  get isOffline() {
    return this.code === 'NETWORK_UNAVAILABLE';
  }
  get isUnauthenticated() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isConflict() {
    return this.status === 409;
  }
}

const BASE = '/api/v1';

/** Runtime state the client attaches to every request. */
const requestState = {
  csrfToken: '' as string,
  workstationCode: '' as string,
  simulatedClientIp: '' as string,
};

export function setCsrfToken(token: string) {
  requestState.csrfToken = token;
}
export function setWorkstationCode(code: string) {
  requestState.workstationCode = code;
}
export function setSimulatedClientIp(ip: string) {
  requestState.simulatedClientIp = ip;
}
export function getWorkstationCode() {
  return requestState.workstationCode;
}

export interface RequestOptions {
  exportVerification?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, signal, query } = options;

  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && requestState.csrfToken) headers['X-CSRF-Token'] = requestState.csrfToken;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (options.exportVerification) headers['X-Export-Verification'] = options.exportVerification;
  if (requestState.workstationCode) headers['X-Workstation-Code'] = requestState.workstationCode;
  if (requestState.simulatedClientIp) headers['X-Demo-Client-Ip'] = requestState.simulatedClientIp;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause;
    throw new ApiError(0, {
      code: 'NETWORK_UNAVAILABLE',
      message: 'The examination service could not be reached.',
      guidance:
        'The workstation has lost its connection. Answers already acknowledged by the server are safe, and anything queued here will be sent as soon as the connection returns.',
      answersSafe: true,
      traceId: 'client-offline',
    });
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;

  if (!response.ok) {
    const shape = (parsed as { error?: ApiErrorShape } | null)?.error;
    throw new ApiError(
      response.status,
      shape ?? {
        code: 'UNEXPECTED_ERROR',
        message: `The service returned an unexpected response (${response.status}).`,
        guidance: 'Try again shortly. If the problem continues, notify technical support.',
        answersSafe: true,
        traceId: response.headers.get('X-Trace-Id') ?? 'unknown',
      },
    );
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: <T,>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    apiRequest<T>(path, { method: 'GET', query, signal }),
  post: <T,>(path: string, body?: unknown, extra?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { method: 'POST', body, ...extra }),
  put: <T,>(path: string, body?: unknown, extra?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { method: 'PUT', body, ...extra }),
  del: <T,>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** RFC-4122-ish key generator used for idempotent answer writes. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
