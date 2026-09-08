import type { FastifyInstance } from 'fastify';
import { candidateLoginSchema, staffLoginSchema } from '@sep/shared';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { cache } from '../lib/store/adapters.js';
import { createSession, ctx, destroySession, requireUser } from '../lib/session.js';
import { noStore, parse } from '../lib/http.js';
import { DEMO_ACCOUNTS, DEMO_CANDIDATE_APPLICATION_ID, DEMO_CANDIDATE_PASSWORD } from '../data/seed.js';
import { fingerprintFromRequest, matchDevice } from '../services/deviceService.js';

/**
 * Authentication.
 *
 * Sessions live in an HTTP-only, signed cookie. The client never holds a token
 * it can read, and every mutation additionally requires the CSRF token issued
 * with the session.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Temporary lockout after repeated failures, tracked per identifier. */
  async function registerFailure(identifier: string): Promise<number> {
    const key = `login-failures:${identifier}`;
    try {
      return await cache.incr(key, env.LOGIN_LOCKOUT_MINUTES * 60);
    } catch {
      return 0;
    }
  }

  async function assertNotLocked(identifier: string): Promise<void> {
    try {
      const failures = (await cache.get<number>(`login-failures:${identifier}`)) ?? 0;
      if (failures >= env.LOGIN_LOCKOUT_THRESHOLD) {
        throw Errors.accountLocked(env.LOGIN_LOCKOUT_MINUTES);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      if ((error as { code?: string })?.code === 'ACCOUNT_LOCKED') throw error;
    }
  }

  app.post('/auth/login', async (request, reply) => {
    const body = parse(staffLoginSchema, request.body);
    const db = getDb();
    const context = ctx(request);

    await assertNotLocked(body.email.toLowerCase());

    const user = [...db.users.values()].find((u) => u.email.toLowerCase() === body.email.toLowerCase());
    const credential = user ? db.staffCredentials.get(user.id) : undefined;
    const valid =
      user && credential && user.status === 'ACTIVE'
        ? verifyPassword(body.password, credential.passwordHash, credential.salt)
        : false;

    if (!valid) {
      db.counters.failedLogins += 1;
      const failures = await registerFailure(body.email.toLowerCase());
      recordAudit({
        actorId: user?.id ?? 'unknown',
        actorName: body.email,
        actorRole: user?.roles[0] ?? 'SYSTEM',
        action: 'USER_LOGIN_FAILED',
        targetType: 'User',
        targetId: user?.id ?? body.email,
        targetLabel: body.email,
        result: 'FAILURE',
        reason: `Sign-in failed (consecutive failures: ${failures}).`,
        ipAddress: context.ipAddress,
        traceId: context.traceId,
      });
      throw Errors.badCredentials();
    }
    if (!user || !credential) throw Errors.badCredentials();

    await cache.del(`login-failures:${body.email.toLowerCase()}`).catch(() => undefined);
    const session = createSession(reply, { userId: user.id, kind: 'STAFF', ipAddress: context.ipAddress });
    user.lastLoginAt = new Date().toISOString();

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'USER_LOGIN',
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
      reason: 'Successful staff sign-in.',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        roles: user.roles,
        kind: 'STAFF',
        centreId: user.centreId ?? null,
      },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  app.post('/auth/candidate-login', async (request, reply) => {
    const body = parse(candidateLoginSchema, request.body);
    const db = getDb();
    const context = ctx(request);

    await assertNotLocked(body.applicationId.toUpperCase());

    const credential = db.candidateCredentials.get(body.applicationId.toUpperCase());
    const candidate = credential ? db.candidates.get(credential.candidateId) : undefined;
    const valid =
      credential && candidate && candidate.accountStatus === 'ACTIVE'
        ? verifyPassword(body.password, credential.passwordHash, credential.salt)
        : false;

    if (!valid) {
      db.counters.failedLogins += 1;
      const failures = await registerFailure(body.applicationId.toUpperCase());
      recordAudit({
        actorId: candidate?.id ?? 'unknown',
        actorName: body.applicationId,
        actorRole: 'CANDIDATE',
        action: 'USER_LOGIN_FAILED',
        targetType: 'Candidate',
        targetId: candidate?.id ?? body.applicationId,
        targetLabel: body.applicationId,
        result: 'FAILURE',
        reason: `Candidate sign-in failed at workstation ${body.workstationCode ?? 'unidentified'} (consecutive failures: ${failures}).`,
        ipAddress: context.ipAddress,
        traceId: context.traceId,
      });
      throw Errors.badCredentials();
    }
    if (!candidate) throw Errors.badCredentials();

    await cache.del(`login-failures:${body.applicationId.toUpperCase()}`).catch(() => undefined);

    // Identify the workstation from what the machine reports about itself.
    // The supplied code is only a fallback for a client that cannot self-identify.
    const fingerprint =
      body.fingerprint ?? fingerprintFromRequest(request.headers as Record<string, string | undefined>);
    const match = matchDevice(fingerprint);
    const detectedDevice = match.deviceId ? db.devices.get(match.deviceId) : undefined;
    const resolvedCode = detectedDevice?.deviceCode ?? body.workstationCode;

    const session = createSession(reply, {
      userId: candidate.id,
      kind: 'CANDIDATE',
      candidateId: candidate.id,
      ipAddress: context.ipAddress,
      deviceCode: resolvedCode,
    });

    recordAudit({
      actorId: candidate.id,
      actorName: candidate.fullName,
      actorRole: 'CANDIDATE',
      action: 'USER_LOGIN',
      targetType: 'Candidate',
      targetId: candidate.id,
      targetLabel: candidate.applicationId,
      reason: detectedDevice
        ? `Candidate signed in at workstation ${detectedDevice.deviceCode}, identified automatically (${match.confidence.toLowerCase()} confidence: ${match.matchedOn.join(', ') || 'no signals'}).`
        : `Candidate signed in at workstation ${body.workstationCode ?? 'unidentified'} (auto-detection did not match a registered machine).`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    const exam = candidate.examId ? db.exams.get(candidate.examId) : undefined;

    return noStore(reply).send({
      user: {
        id: candidate.id,
        fullName: candidate.fullName,
        email: candidate.email,
        roles: ['CANDIDATE'],
        kind: 'CANDIDATE',
        candidateId: candidate.id,
        centreId: candidate.centreId,
      },
      candidate: {
        applicationId: candidate.applicationId,
        candidateId: candidate.candidateId,
        fullName: candidate.fullName,
        photoSeed: candidate.photoSeed,
        fingerprintEnrolled: candidate.fingerprintEnrolled,
        faceEnrolled: candidate.faceEnrolled,
        accommodations: candidate.accommodations,
      },
      exam: exam
        ? {
            id: exam.id,
            name: exam.name,
            code: exam.code,
            durationMinutes: exam.durationMinutes,
            navigationMode: exam.navigationMode,
            startsAt: exam.startsAt,
            securityProfileId: exam.securityPolicy.profileId,
            monitoring: exam.securityPolicy.monitoring,
          }
        : null,
      workstation: detectedDevice
        ? {
            deviceCode: detectedDevice.deviceCode,
            name: detectedDevice.name,
            status: detectedDevice.status,
            autoDetected: true,
            confidence: match.confidence,
            matchedOn: match.matchedOn,
          }
        : {
            deviceCode: body.workstationCode ?? null,
            autoDetected: false,
            confidence: match.confidence,
            reason: match.reason,
          },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const context = ctx(request);
    if (context.user) {
      recordAudit({
        actorId: context.user.id,
        actorName: context.user.fullName,
        actorRole: context.user.roles[0] ?? 'SYSTEM',
        action: 'USER_LOGOUT',
        targetType: context.user.kind === 'CANDIDATE' ? 'Candidate' : 'User',
        targetId: context.user.id,
        targetLabel: context.user.email,
        reason: 'Signed out.',
        ipAddress: context.ipAddress,
        traceId: context.traceId,
      });
    }
    destroySession(request, reply);
    return noStore(reply).send({ ok: true });
  });

  app.get('/auth/session', async (request, reply) => {
    const user = requireUser(request);
    const context = ctx(request);
    return noStore(reply).send({
      user,
      csrfToken: context.session?.csrfToken,
      expiresAt: context.session?.expiresAt,
      ipAddress: context.ipAddress,
    });
  });

  /** Demonstration credentials. Development builds only. */
  app.get('/auth/demo-accounts', async (_request, reply) => {
    if (!env.ENABLE_DEMO_MODE) throw Errors.demoDisabled();
    return noStore(reply).send({
      warning: 'Development-only demonstration credentials. These accounts must not exist in a production deployment.',
      staff: DEMO_ACCOUNTS,
      candidate: {
        applicationId: DEMO_CANDIDATE_APPLICATION_ID,
        password: DEMO_CANDIDATE_PASSWORD,
        note: 'Any seeded application ID from NTAE26-000001 to NTAE26-000500 works with the same demonstration password.',
      },
    });
  });
}
