import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  /** Optional; enables maintenance jobs that need ownership (audit partitions). */
  DATABASE_MIGRATOR_URL: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BATCH: z.coerce.number().int().min(1).max(1000).default(100),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  // Storage: identical to the API so files written here are served there.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.data/uploads'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  FILES_SIGNING_SECRET: z.string().min(16).default('dev-files-signing-secret-change-me'),
  FILES_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
  // Notification adapters. "console" logs ids only (development, tests); providers are configured per channel.
  NOTIFY_SMS_ADAPTER: z.enum(['console', 'http']).default('console'),
  NOTIFY_WHATSAPP_ADAPTER: z.enum(['console', 'http']).default('console'),
  NOTIFY_EMAIL_ADAPTER: z.enum(['console', 'smtp']).default('console'),
  NOTIFY_PUSH_ADAPTER: z.enum(['console', 'http']).default('console'),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('no-reply@edupro.local'),
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),
  WHATSAPP_HTTP_URL: z.string().url().optional(),
  WHATSAPP_HTTP_TOKEN: z.string().optional(),
  PUSH_HTTP_URL: z.string().url().optional(),
  PUSH_HTTP_TOKEN: z.string().optional(),
  // Exports
  EXPORT_PDF_ENGINE: z.enum(['playwright', 'none']).default('playwright'),
  EXPORTS_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`workers environment is invalid: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.NOTIFY_SMS_ADAPTER === 'console' || env.NOTIFY_EMAIL_ADAPTER === 'console') {
      throw new Error('console notification adapters are not allowed in production');
    }
    if (env.FILES_SIGNING_SECRET.startsWith('dev-'))
      throw new Error('FILES_SIGNING_SECRET must be set in production');
  }
  return env;
}

export function storageConfigFrom(env: WorkerEnv) {
  return {
    driver: env.STORAGE_DRIVER,
    urlTtlSeconds: env.FILES_URL_TTL_SECONDS,
    localDir: env.STORAGE_LOCAL_DIR,
    apiBaseUrl: env.API_BASE_URL,
    signingSecret: env.FILES_SIGNING_SECRET,
    s3Bucket: env.S3_BUCKET,
    s3Region: env.S3_REGION,
    s3Endpoint: env.S3_ENDPOINT,
    s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  };
}
