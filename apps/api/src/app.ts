import { exportVerificationRoutes } from './routes/exportVerification.js';
import { categoryRoutes } from './routes/categories.js';
import { operationsRoutes } from './routes/operations.js';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { AppError, Errors } from './lib/errors.js';
import { buildContext, assertCsrf } from './lib/session.js';
import { getDb } from './lib/store/db.js';
import { countRequest } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { examRoutes } from './routes/exams.js';
import { questionRoutes } from './routes/questions.js';
import { attemptRoutes } from './routes/attempts.js';
import { evidenceRoutes } from './routes/evidence.js';
import { invigilatorRoutes } from './routes/invigilator.js';
import { adminRoutes } from './routes/admin.js';
import { opsRoutes } from './routes/ops.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials, cookies or session identifiers.
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'req.body.password',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB request-size limit
    disableRequestLogging: env.NODE_ENV === 'test',
    genReqId: () => crypto.randomUUID(),
  });

  /* ---------------------------- security ---------------------------- */

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", env.WEB_ORIGIN],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // HSTS is only meaningful behind TLS; enabled for production deployments.
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // Exact-origin CORS. No wildcard, credentials enabled for the session cookie.
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === env.WEB_ORIGIN) return callback(null, true);
      callback(new Error('Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'x-workstation-code', 'x-demo-client-ip', 'x-trace-id', 'x-export-verification'],
    maxAge: 600,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET, hook: 'onRequest' });

  /**
   * Several endpoints are commands that take no payload (logout, publication
   * request, demo reset). A caller that sends `Content-Type: application/json`
   * with an empty body is doing something reasonable, so treat it as `{}`
   * rather than failing. Malformed JSON is still a 400.
   */
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (raw.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(Errors.validation({ body: 'The request body is not valid JSON.' }), undefined);
    }
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    onExceeding: () => {
      getDb().counters.rateLimited += 1;
    },
    errorResponseBuilder: () => {
      const error = Errors.rateLimited();
      return {
        statusCode: error.statusCode,
        error: {
          code: error.code,
          message: error.message,
          guidance: error.guidance,
          answersSafe: true,
          traceId: 'rate-limit',
        },
      };
    },
  });

  /* ------------------------- OpenAPI documents ---------------------- */

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Secure Examination Management and Delivery Platform API',
        version: '0.1.0-poc',
        description:
          'Proof-of-concept API. Controls documented as simulated (biometrics, KMS/HSM, mTLS, kiosk enforcement, DDoS protection, WORM audit storage) are demonstrations and are not production-certified.',
      },
      servers: [{ url: '/api/v1' }],
      tags: [
        { name: 'auth', description: 'Sign-in and session' },
        { name: 'exams', description: 'Examinations, security policy and publication' },
        { name: 'questions', description: 'Question bank, review and versions' },
        { name: 'attempts', description: 'Candidate examination delivery' },
        { name: 'evidence', description: 'Camera-presence evidence' },
        { name: 'invigilator', description: 'Live invigilation' },
        { name: 'admin', description: 'Centres, devices, candidates and users' },
        { name: 'ops', description: 'Audit trail, health and demonstration controls' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

  /* ---------------------------- lifecycle --------------------------- */

  app.addHook('onRequest', async (request, reply) => {
    const context = buildContext(request);
    reply.header('X-Trace-Id', context.traceId);
    reply.header('X-Content-Type-Options', 'nosniff');
    countRequest();
  });

  // CSRF protection for cookie-authenticated mutations.
  app.addHook('preHandler', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (request.url.startsWith('/api/v1/auth/login')) return;
    if (request.url.startsWith('/api/v1/auth/candidate-login')) return;
    if (request.url.startsWith('/api/v1/auth/logout')) return;
    assertCsrf(request);
  });

  app.addHook('onResponse', async (_request, reply) => {
    const elapsed = reply.elapsedTime;
    if (Number.isFinite(elapsed)) getDb().metrics.responseTimes.push(elapsed);
  });

  /* -------------------------- error handling ------------------------ */

  app.setErrorHandler((error, request, reply) => {
    const traceId = (reply.getHeader('X-Trace-Id') as string) ?? request.id;

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          guidance: error.guidance,
          answersSafe: error.answersSafe,
          details: error.details,
          traceId,
        },
      });
    }

    if (error instanceof ZodError) {
      const validation = Errors.validation(error.flatten());
      return reply.status(400).send({
        error: {
          code: validation.code,
          message: validation.message,
          guidance: validation.guidance,
          answersSafe: true,
          details: validation.details,
          traceId,
        },
      });
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      const limited = Errors.rateLimited();
      return reply.status(429).send({
        error: { code: limited.code, message: limited.message, guidance: limited.guidance, answersSafe: true, traceId },
      });
    }

    // A malformed request is the caller's problem, not a server fault. Fastify
    // raises these (bad JSON, oversized body, unsupported media type) before a
    // handler runs, so map them to an honest 4xx instead of a generic 500.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: {
          code: (error as { code?: string }).code ?? 'BAD_REQUEST',
          message: error.message,
          guidance:
            status === 413
              ? 'The request was larger than the service accepts. Reduce the payload and try again.'
              : 'Check the request format against the API documentation at /docs, then try again.',
          answersSafe: true,
          traceId,
        },
      });
    }

    // Unexpected failures are logged in full but never echoed to the client.
    request.log.error({ err: error, traceId }, 'Unhandled error');
    const internal = Errors.internal(traceId);
    return reply.status(500).send({
      error: {
        code: internal.code,
        message: internal.message,
        guidance: internal.guidance,
        answersSafe: true,
        traceId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const traceId = (reply.getHeader('X-Trace-Id') as string) ?? request.id;
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `No route matches ${request.method} ${request.url}.`,
        guidance: 'Check the API documentation at /docs.',
        answersSafe: true,
        traceId,
      },
    });
  });

  /* ------------------------------ routes ---------------------------- */

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(exportVerificationRoutes);
      await api.register(examRoutes);
      await api.register(questionRoutes);
      await api.register(categoryRoutes);
      await api.register(operationsRoutes);
      await api.register(attemptRoutes);
      await api.register(evidenceRoutes);
      await api.register(invigilatorRoutes);
      await api.register(adminRoutes);
      await api.register(opsRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
