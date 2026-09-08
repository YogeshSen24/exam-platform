import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activationWarnings, describeKey, releaseWindowOpen, summariseKey, toDisplayForm } from '@sep/activation';
import { recordAudit } from '../lib/audit.js';
import { getDb } from '../lib/store/db.js';
import { clearStationCookie, ctx, requirePermission, setStationCookie } from '../lib/session.js';
import { noStore, parse } from '../lib/http.js';
import {
  deploymentKeyring,
  issuableExams,
  issueActivationKey,
  listActivationKeys,
  redeemActivationKey,
  requireActiveStation,
  revokeActivationKey,
} from '../services/activationService.js';

/**
 * Examination keys.
 *
 *   /activation/keys      staff at head office, authenticated by session
 *   /activation/station   the machine in the room, authenticated by the key
 *                         itself and then by a long-lived station cookie
 *
 * The station endpoints are deliberately open: a machine being set up has no
 * account and nobody to sign in as. What protects them is that a key cannot be
 * forged, cannot be reused beyond its limit, and can be revoked.
 */

const tagSchema = z.record(z.string().max(60), z.string().max(200));

const issueKeySchema = z.object({
  examId: z.string().min(1),
  centreId: z.string().min(1),
  validForDays: z.coerce.number().int().min(1).max(180).default(30),
  maxStations: z.coerce.number().int().min(1).max(2000).default(50),
  room: z.string().max(60).default(''),
  session: z.string().max(60).default(''),
  tags: tagSchema.default({}),
  note: z.string().max(500).default(''),
  overrides: z
    .object({
      fingerprint: z.enum(['OFF', 'OPTIONAL', 'REQUIRED']).optional(),
      faceAtLogin: z.boolean().optional(),
      cameraMonitoring: z.boolean().optional(),
    })
    .default({}),
});

const revokeSchema = z.object({ reason: z.string().min(4).max(500) });
const redeemSchema = z.object({ key: z.string().min(20).max(20_000) });

export async function activationRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------------ */
  /* Head office: issuing and tracking keys                              */
  /* ------------------------------------------------------------------ */

  /** Everything the key-issuing screen needs to offer valid choices. */
  app.get('/activation/context', async (request, reply) => {
    requirePermission(request, 'centres.provision');
    const keyring = deploymentKeyring();

    return noStore(reply).send({
      deployment: { id: keyring.deploymentId, keyId: keyring.keyId },
      exams: issuableExams().map(({ exam, manifest, issuable, blockedReason }) => ({
        id: exam.id,
        code: exam.code,
        name: exam.name,
        startsAt: exam.startsAt,
        durationMinutes: exam.durationMinutes,
        securityProfileId: exam.securityPolicy.profileId,
        issuable,
        blockedReason,
        paper: manifest
          ? {
              manifestId: manifest.id,
              poolSize: manifest.entries.length,
              deliveredQuestionCount: manifest.deliveredQuestionCount,
              deliveredTotalMarks: manifest.deliveredTotalMarks,
              quotas: manifest.quotas,
            }
          : null,
      })),
      centres: [...getDb().centres.values()].map((centre) => ({
        id: centre.id,
        code: centre.code,
        name: centre.name,
        city: centre.city,
        capacity: centre.capacity,
      })),
    });
  });

  /**
   * Issues a key.
   *
   * The key is returned exactly once, in this response. It is never stored, so
   * it cannot be retrieved later and cannot leak from the database.
   */
  app.post('/activation/keys', async (request, reply) => {
    const user = requirePermission(request, 'centres.provision');
    const context = ctx(request);
    const body = parse(issueKeySchema, request.body);

    const issued = issueActivationKey({ ...body, issuedByUserId: user.id, issuedByName: user.fullName });

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'ACTIVATION_KEY_ISSUED',
      targetType: 'ActivationKey',
      targetId: issued.record.id,
      targetLabel: `${issued.record.examCode} / ${issued.record.centreCode}`,
      reason: `Key issued for ${issued.record.examName} at ${issued.record.centreName}${
        body.room ? `, ${body.room}` : ''
      }, valid until ${issued.record.expiresAt} for up to ${body.maxStations} machines.`,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).status(201).send({
      // Shown once and copied by the administrator. Not retrievable afterwards.
      key: issued.key,
      displayForm: toDisplayForm(issued.key),
      record: issued.record,
      summary: summariseKey(issued.payload),
      rules: describeKey(issued.payload),
      warnings: activationWarnings(issued.payload),
    });
  });

  app.get('/activation/keys', async (request, reply) => {
    requirePermission(request, 'centres.provision.read');
    const query = request.query as { examId?: string; centreId?: string };
    return noStore(reply).send({ keys: listActivationKeys(query) });
  });

  app.post('/activation/keys/:keyId/revoke', async (request, reply) => {
    const user = requirePermission(request, 'centres.provision');
    const context = ctx(request);
    const { keyId } = request.params as { keyId: string };
    const { reason } = parse(revokeSchema, request.body);

    const record = revokeActivationKey(keyId, user.id, reason);

    recordAudit({
      actorId: user.id,
      actorName: user.fullName,
      actorRole: user.roles[0] ?? 'SYSTEM',
      action: 'ACTIVATION_KEY_REVOKED',
      targetType: 'ActivationKey',
      targetId: record.id,
      targetLabel: `${record.examCode} / ${record.centreCode}`,
      reason,
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ record });
  });

  /** The machines currently set up, as head office sees them. */
  app.get('/activation/stations', async (request, reply) => {
    requirePermission(request, 'centres.provision.read');
    const db = getDb();

    return noStore(reply).send({
      stations: [...db.stations.values()]
        .map((station) => ({
          ...station,
          examCode: db.exams.get(station.examId)?.code ?? station.examId,
        }))
        .sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt)),
    });
  });

  /* ------------------------------------------------------------------ */
  /* The machine in the room                                             */
  /* ------------------------------------------------------------------ */

  /**
   * What this machine is set up to run, if anything.
   *
   * The examination screen asks this first. An unconfigured machine is told so
   * plainly rather than being shown a sign-in box that could not work.
   */
  app.get('/activation/station', async (request, reply) => {
    const context = ctx(request);
    const db = getDb();
    const station = context.stationId ? db.stations.get(context.stationId) : undefined;

    if (!station || station.status !== 'ACTIVE') {
      return noStore(reply).send({ configured: false });
    }
    // A setup that has run out is reported as no setup at all, so the machine
    // asks to be keyed again instead of quietly carrying on.
    if (new Date(station.expiresAt).getTime() <= Date.now()) {
      station.status = 'RETIRED';
      return noStore(reply).send({ configured: false, lapsed: true });
    }

    const exam = db.exams.get(station.examId);
    const record = db.activationKeys.get(station.activationKeyId);

    return noStore(reply).send({
      configured: true,
      station: {
        id: station.id,
        code: station.code,
        room: station.room,
        session: station.session,
        centreCode: station.centreCode,
        attemptCount: station.attemptCount,
        expiresAt: station.expiresAt,
      },
      exam: exam
        ? {
            id: exam.id,
            code: exam.code,
            name: exam.name,
            startsAt: exam.startsAt,
            durationMinutes: exam.durationMinutes,
          }
        : null,
      // Whether a candidate may start right now, which is not the same as
      // whether the machine is configured.
      windowOpen: record
        ? releaseWindowOpen({
            window: {
              opensAt: exam?.startsAt ?? record.issuedAt,
              closesAt: record.expiresAt,
              durationMinutes: exam?.durationMinutes ?? 0,
            },
          } as never)
        : false,
    });
  });

  /**
   * Sets this machine up from a pasted key.
   *
   * Open by design: a machine being configured has no account to sign in with.
   * The key is the credential, and it is checked entirely on the server.
   */
  app.post('/activation/station', async (request, reply) => {
    const context = ctx(request);
    const { key } = parse(redeemSchema, request.body);

    const { station, payload, keyFingerprint } = redeemActivationKey(key, {
      ipAddress: context.ipAddress,
      userAgent: (request.headers['user-agent'] as string) ?? '',
      traceId: context.traceId,
    });

    setStationCookie(reply, station.id, station.expiresAt);

    return noStore(reply).status(201).send({
      station: {
        id: station.id,
        code: station.code,
        room: station.room,
        session: station.session,
        // The machine shows a countdown, so an invigilator knows when it will
        // need keying again rather than discovering it mid-sitting.
        expiresAt: station.expiresAt,
      },
      exam: payload.exam,
      centre: payload.centre,
      window: payload.window,
      keyFingerprint,
      summary: summariseKey(payload),
      rules: describeKey(payload),
      note: payload.note,
    });
  });

  /** Releases the machine, so it can be set up for a different examination. */
  app.delete('/activation/station', async (request, reply) => {
    const context = ctx(request);
    const station = requireActiveStation(context.stationId ?? undefined);

    station.status = 'RETIRED';
    clearStationCookie(reply);

    recordAudit({
      actorId: station.id,
      actorName: station.code,
      actorRole: 'SYSTEM',
      action: 'STATION_RETIRED',
      targetType: 'Station',
      targetId: station.id,
      targetLabel: station.code,
      reason: 'Machine released by an invigilator so it can be set up for another examination.',
      ipAddress: context.ipAddress,
      traceId: context.traceId,
    });

    return noStore(reply).send({ released: true });
  });
}
