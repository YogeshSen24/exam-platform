import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ctx, requireUser } from '../lib/session.js';
import { Errors } from '../lib/errors.js';
import { parse, noStore } from '../lib/http.js';
import { recordAudit } from '../lib/audit.js';
import { isDemoEnabled } from '../config/env.js';

function audit(request: FastifyRequest, scope: string, success: boolean, reason: string) {
  const user = requireUser(request); const context = ctx(request);
  recordAudit({ actorId: user.id, actorName: user.fullName, actorRole: user.roles[0] ?? 'SYSTEM', action: 'EXAM_UPDATED', targetType: 'ExportVerification', targetId: user.id, targetLabel: scope, result: success ? 'SUCCESS' : 'BLOCKED', reason, ipAddress: context.ipAddress, traceId: context.traceId });
}
export function consumeExportGrant(request: FastifyRequest, scope: string) {
  requireUser(request); const session = ctx(request).session!; const grant = session.exportGrant;
  if (!grant || grant.scope !== scope || grant.expiresAt <= Date.now() || request.headers['x-export-verification'] !== grant.token) {
    audit(request, scope, false, 'Export refused: fresh facial verification is required.');
    throw Errors.forbidden('exporting without fresh facial verification');
  }
  delete session.exportGrant;
  audit(request, scope, true, 'One-time facial-verification grant consumed for export.');
}
export async function exportVerificationRoutes(app: FastifyInstance) {
  app.post('/export-verification/challenge', async (request, reply) => {
    requireUser(request); const session = ctx(request).session!;
    const { scope } = parse(z.object({ scope: z.string().min(1).max(200).regex(/^(exam|template|receipt|print):/) }), request.body);
    delete session.exportGrant;
    const provider = process.env.EXPORT_FACE_PROVIDER_URL;
    if (!provider && !isDemoEnabled) throw Errors.forbidden('exporting before a facial-verification provider is configured');
    const challenge = { id: randomUUID(), scope, expiresAt: Date.now() + 120000 };
    session.exportChallenge = challenge;
    return noStore(reply).send({ challengeId: challenge.id, expiresAt: challenge.expiresAt, simulated: !provider });
  });
  app.post('/export-verification/verify', async (request, reply) => {
    const user = requireUser(request); const session = ctx(request).session!;
    const body = parse(z.object({ challengeId: z.string().uuid(), image: z.string().min(100).max(800000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/), demoOutcome: z.enum(['MATCH', 'MISMATCH']).optional() }), request.body);
    const challenge = session.exportChallenge;
    if (!challenge || challenge.id !== body.challengeId || challenge.expiresAt <= Date.now()) throw Errors.forbidden('using an expired or invalid facial-verification challenge');
    delete session.exportChallenge;
    let verified = false; const provider = process.env.EXPORT_FACE_PROVIDER_URL;
    if (provider) {
      if (!provider.startsWith('https://') || !process.env.EXPORT_FACE_PROVIDER_TOKEN) throw Errors.forbidden('using an unconfigured facial-verification provider');
      try {
        const response = await fetch(provider, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.EXPORT_FACE_PROVIDER_TOKEN}` }, body: JSON.stringify({ userId: user.id, challengeId: challenge.id, image: body.image }), signal: AbortSignal.timeout(15000) });
        const result = await response.json() as { verified?: boolean; live?: boolean; referenceMatched?: boolean; userId?: string; challengeId?: string };
        verified = response.ok && result.verified === true && result.live === true && result.referenceMatched === true && result.userId === user.id && result.challengeId === challenge.id;
      } catch { verified = false; }
    } else verified = isDemoEnabled && body.demoOutcome === 'MATCH';
    audit(request, challenge.scope, verified, `${provider ? 'Provider' : 'Simulated'} facial verification ${verified ? 'passed' : 'failed'}. Image not retained by this application.`);
    if (!verified) throw Errors.forbidden('exporting after an unsuccessful facial verification');
    const grant = { token: randomBytes(32).toString('hex'), scope: challenge.scope, expiresAt: Date.now() + 60000 };
    session.exportGrant = grant;
    return noStore(reply).send({ token: grant.token, expiresAt: grant.expiresAt, simulated: !provider });
  });
  app.post('/export-verification/consume', async (request, reply) => {
    const { scope } = parse(z.object({ scope: z.string().regex(/^(template|receipt|print):/).max(200) }), request.body);
    consumeExportGrant(request, scope); return noStore(reply).send({ permitted: true });
  });
}
