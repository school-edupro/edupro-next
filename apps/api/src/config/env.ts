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
  return env;
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
