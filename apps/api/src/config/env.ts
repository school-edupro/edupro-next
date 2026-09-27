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
  /** Requests per minute per bearer token (or IP when anonymous); tests use 10,000. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(600),
  /** Sprint 8: public admissions surface. */
  APPLICANT_JWT_SECRET: z.string().min(32).default('dev-applicant-jwt-secret-change-me-0123456789'),
  PUBLIC_POW_DIFFICULTY: z.coerce.number().int().min(1).max(8).default(4),
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(5).default(60),
  OTP_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  /** Sprint 9: payments v0 (PayU) and the public app origin for return URLs. */
  PAYU_KEY: z.string().min(1).default('dev-payu-key'),
  PAYU_SALT: z.string().min(8).default('dev-payu-salt-change-me'),
  PAYU_MODE: z.enum(['mock', 'test', 'live']).default('mock'),
  PAYU_BASE_URL: z.string().url().default('https://test.payu.in/_payment'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3003'),
  ADMIN_APP_URL: z.string().url().default('http://localhost:3000'),
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
  // Sprint 5: impersonation sessions, security alerts, metrics, tracing, Key Vault, schema check.
  IMPERSONATION_JWT_SECRET: z
    .string()
    .min(32)
    .default('dev-impersonation-secret-change-me-0123456789'),
  IMPERSONATION_MAX_MINUTES: z.coerce.number().int().min(5).max(240).default(60),
  SECURITY_ALERT_THRESHOLD: z.coerce.number().int().min(1).default(10),
  SECURITY_ALERT_WEBHOOK: z.string().url().optional(),
  METRICS_TOKEN: z.string().optional(),
  SCHEMA_CHECK: z.enum(['strict', 'warn', 'off']).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  KEY_VAULT_URL: z.string().url().optional(),
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
  if (
    env.NODE_ENV === 'production' &&
    (env.PAYU_MODE === 'mock' || env.PAYU_SALT.startsWith('dev-'))
  ) {
    throw new Error(
      'Refusing to start: PAYU_MODE must be test or live with real PAYU_KEY and PAYU_SALT in production',
    );
  }
  if (env.NODE_ENV === 'production' && env.APPLICANT_JWT_SECRET.startsWith('dev-')) {
    throw new Error('Refusing to start: APPLICANT_JWT_SECRET must be set in production');
  }
  if (env.NODE_ENV === 'production' && env.IMPERSONATION_JWT_SECRET.startsWith('dev-')) {
    throw new Error('Refusing to start: IMPERSONATION_JWT_SECRET must be set in production');
  }
  if (env.NODE_ENV === 'production' && !env.METRICS_TOKEN) {
    throw new Error(
      'Refusing to start: METRICS_TOKEN must be set in production (metrics endpoint)',
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
