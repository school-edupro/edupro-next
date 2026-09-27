import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ONEAUTH_ISSUER: z.string().url(),
  ONEAUTH_AUDIENCE: z.string().min(1),
  ONEAUTH_JWKS_URL: z.string().url(),
  /** Development only. Accepts "Bearer dev:<oneauth_sub>". Refused in production. */
  AUTH_DEV_BYPASS: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Minutes within which an MFA authentication counts for step-up. */
  MFA_FRESHNESS_MINUTES: z.coerce.number().int().positive().default(15),
  /** Public base URL of this API, used to build local-driver file URLs. */
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  /** File storage (S2-08): local disk for development, S3-compatible object storage otherwise. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.data/uploads'),
  FILES_SIGNING_SECRET: z.string().min(16).default('dev-files-signing-secret-change-me'),
  FILES_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
  // Compatibility API for the current mobile apps (S4-05): legacy handshake signature and our session JWT.
  COMPAT_HANDSHAKE_SECRET: z.string().min(16).default('dev-compat-handshake-secret'),
  COMPAT_JWT_SECRET: z.string().min(32).default('dev-compat-jwt-secret-change-me-0123456789'),
  COMPAT_TOKEN_HOURS: z.coerce.number().int().min(1).max(168).default(12),
});

export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.AUTH_DEV_BYPASS) {
    throw new Error('Refusing to start: AUTH_DEV_BYPASS must not be set in production');
  }
  if (env.NODE_ENV === 'production' && env.FILES_SIGNING_SECRET.startsWith('dev-')) {
    throw new Error('Refusing to start: FILES_SIGNING_SECRET must be set in production');
  }
  if (
    env.NODE_ENV === 'production' &&
    (env.COMPAT_JWT_SECRET.startsWith('dev-') || env.COMPAT_HANDSHAKE_SECRET.startsWith('dev-'))
  ) {
    throw new Error(
      'Refusing to start: COMPAT_JWT_SECRET and COMPAT_HANDSHAKE_SECRET must be set in production',
    );
  }
  if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
    throw new Error('S3_BUCKET and S3_REGION are required when STORAGE_DRIVER=s3');
  }
  return env;
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
