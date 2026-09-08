import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission, Role, SessionUser } from '@sep/shared';
import { rolesHavePermission } from '@sep/shared';
import { env } from '../config/env.js';
import { Errors } from './errors.js';
import { getDb, type Session } from './store/db.js';
import { normaliseClientIp } from './network.js';

export const SESSION_COOKIE = 'sep_session';
export const CSRF_HEADER = 'x-csrf-token';

/** Demo-only headers that let a presenter simulate a workstation/network. */
export const DEMO_IP_HEADER = 'x-demo-client-ip';
export const DEMO_DEVICE_HEADER = 'x-workstation-code';

export interface RequestContext {
  session: Session | null;
  user: SessionUser | null;
  ipAddress: string;
  deviceCode: string | null;
  traceId: string;
}

const contexts = new WeakMap<FastifyRequest, RequestContext>();

export function buildContext(request: FastifyRequest): RequestContext {
  const db = getDb();
  const traceId = (request.headers['x-trace-id'] as string) || randomUUID();
  const demoIp = env.ENABLE_DEMO_MODE ? (request.headers[DEMO_IP_HEADER] as string | undefined) : undefined;
  const ipAddress = normaliseClientIp(request.ip, demoIp);
  const deviceCode = (request.headers[DEMO_DEVICE_HEADER] as string | undefined) ?? null;

  const cookieValue = request.cookies?.[SESSION_COOKIE];
  let session: Session | null = null;
  if (cookieValue) {
    const unsigned = request.unsignCookie(cookieValue);
    if (unsigned.valid && unsigned.value) {
      const found = db.sessions.get(unsigned.value);
      if (found && new Date(found.expiresAt) > new Date()) {
        session = found;
      } else if (found) {
        db.sessions.delete(found.id);
      }
    }
  }

  let user: SessionUser | null = null;
  if (session) {
    if (session.kind === 'STAFF') {
      const record = db.users.get(session.userId);
      if (record && record.status === 'ACTIVE') {
        user = {
          id: record.id,
          fullName: record.fullName,
          email: record.email,
          roles: record.roles,
          kind: 'STAFF',
          centreId: record.centreId ?? null,
        };
      }
    } else {
      const candidate = db.candidates.get(session.candidateId ?? '');
      if (candidate && candidate.accountStatus === 'ACTIVE') {
        user = {
          id: candidate.id,
          fullName: candidate.fullName,
          email: candidate.email,
          roles: ['CANDIDATE'],
          kind: 'CANDIDATE',
          candidateId: candidate.id,
          centreId: candidate.centreId,
        };
      }
    }
  }

  const context: RequestContext = { session, user, ipAddress, deviceCode, traceId };
  contexts.set(request, context);
  return context;
}

export function ctx(request: FastifyRequest): RequestContext {
  return contexts.get(request) ?? buildContext(request);
}

export function requireUser(request: FastifyRequest): SessionUser {
  const context = ctx(request);
  if (!context.user) throw Errors.unauthenticated();
  return context.user;
}

export function requirePermission(request: FastifyRequest, permission: Permission): SessionUser {
  const user = requireUser(request);
  if (!rolesHavePermission(user.roles, permission)) {
    throw Errors.forbidden(permission);
  }
  return user;
}

export function requireRole(request: FastifyRequest, ...roles: Role[]): SessionUser {
  const user = requireUser(request);
  if (!user.roles.some((r) => roles.includes(r))) {
    throw Errors.forbidden(roles.join(' or '));
  }
  return user;
}

export function requireCandidate(request: FastifyRequest): SessionUser {
  const user = requireUser(request);
  if (user.kind !== 'CANDIDATE') throw Errors.forbidden('candidate examination access');
  return user;
}

export function createSession(
  reply: FastifyReply,
  input: { userId: string; kind: 'STAFF' | 'CANDIDATE'; candidateId?: string; ipAddress: string; deviceCode?: string },
): Session {
  const db = getDb();
  const now = Date.now();
  const session: Session = {
    id: randomUUID(),
    userId: input.userId,
    kind: input.kind,
    candidateId: input.candidateId,
    csrfToken: randomBytes(24).toString('hex'),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + env.SESSION_TTL_MINUTES * 60_000).toISOString(),
    ipAddress: input.ipAddress,
    deviceCode: input.deviceCode,
  };
  db.sessions.set(session.id, session);

  reply.setCookie(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    signed: true,
    path: '/',
    maxAge: env.SESSION_TTL_MINUTES * 60,
  });

  return session;
}

export function destroySession(request: FastifyRequest, reply: FastifyReply): void {
  const context = ctx(request);
  if (context.session) getDb().sessions.delete(context.session.id);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Double-submit CSRF protection for cookie-authenticated mutations.
 * The token is issued with the session and echoed in a header the browser
 * cannot set cross-origin without an explicit CORS grant.
 */
export function assertCsrf(request: FastifyRequest): void {
  const context = ctx(request);
  if (!context.session) return; // unauthenticated mutations are handled elsewhere
  const supplied = request.headers[CSRF_HEADER];
  if (typeof supplied !== 'string' || supplied !== context.session.csrfToken) {
    throw Errors.forbidden('cross-site request protection (missing or invalid CSRF token)');
  }
}
