import { z } from 'zod';

/**
 * Environment-variable validation. The process refuses to start with an
 * invalid configuration rather than failing later in an unclear way.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),

  /** Exact origin allowed by CORS. No wildcards. */
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  /** Signing secret for session cookies. Development default is clearly marked. */
  SESSION_SECRET: z
    .string()
    .min(32)
    .default('development-only-session-secret-change-me-01'),

  SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(720).default(60),

  /**
   * Persistence driver.
   *  - `memory`  : in-process demo store, no infrastructure required
   *  - `postgres`: Prisma/PostgreSQL (schema supplied, adapter stubbed for the POC)
   */
  PERSISTENCE_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().optional(),

  CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().optional(),

  OBJECT_STORE_DRIVER: z.enum(['memory', 's3']).default('memory'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().default('exam-evidence'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  /** `local` uses development keys. `kms` is a placeholder for a real KMS/HSM. */
  KEY_PROVIDER: z.enum(['local', 'kms']).default('local'),
  KMS_KEY_ID: z.string().optional(),

  /** Enables the presenter Demo Mode drawer and /demo-scenarios routes. */
  ENABLE_DEMO_MODE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Demo escape hatch: allows an exam administrator to approve a paper they
   * requested. Off by default because separation of duties is the point.
   */
  ALLOW_SELF_APPROVAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Requests per minute per IP for general routes. */
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(600),
  /** Failed sign-ins before a temporary account lockout. */
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(10),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    if (env.SESSION_SECRET.startsWith('development-only')) {
      // eslint-disable-next-line no-console
      console.error('Refusing to start in production with the development session secret.');
      process.exit(1);
    }
    if (env.KEY_PROVIDER === 'local') {
      // eslint-disable-next-line no-console
      console.error(
        'Refusing to start in production with KEY_PROVIDER=local. Local development keys are not suitable for production.',
      );
      process.exit(1);
    }
  }
  return env;
}

export const env = loadEnv();

export const isDemoEnabled = env.ENABLE_DEMO_MODE && env.NODE_ENV !== 'production';
