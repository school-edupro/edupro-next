/**
 * Logger configuration implementing docs/standards/logging-and-pii.md.
 * Redaction is enforced here so no log line depends on developer discipline.
 */
import type { FastifyServerOptions } from 'fastify';

/** Header allow-list: everything else is dropped from request logs. */
const LOGGED_HEADERS = ['host', 'user-agent', 'content-type', 'content-length', 'x-request-id', 'x-school-id', 'x-academic-year-id'];

/** Keys, at any depth, whose values are personal or sensitive data and must never be logged. */
export const PII_KEYS = [
  'password',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'cookie',
  'email',
  'mobile',
  'phone',
  'aadhaar',
  'aadhaarNo',
  'pan',
  'panNo',
  'bankAccount',
  'accountNo',
  'ifsc',
  'dob',
  'dateOfBirth',
  'address',
  'salary',
  'healthNotes',
  'diagnosis',
];

/** pino redaction paths derived from PII_KEYS for the shapes pino-http and our own logs produce. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...PII_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `req.body.${k}`, `payload.${k}`, `data.${k}`]),
];

export function loggerOptions(nodeEnv: string): FastifyServerOptions['logger'] {
  return {
    level: nodeEnv === 'production' ? 'info' : 'debug',
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    serializers: {
      req(req: { method: string; url: string; headers: Record<string, unknown>; id?: unknown; ip?: string }) {
        const headers: Record<string, unknown> = {};
        for (const h of LOGGED_HEADERS) if (req.headers[h] !== undefined) headers[h] = req.headers[h];
        // Query strings may carry search terms; log the path only (standard section 2.1).
        const path = req.url.split('?')[0] ?? req.url;
        return { id: req.id, method: req.method, path, headers, ip: req.ip };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
    },
  };
}

/** Security event names logged at warn level (standard section 2.4). */
export const SECURITY_EVENTS = {
  authFailed: 'auth.failed',
  tenantForbidden: 'tenant.forbidden',
  permissionDenied: 'permission.denied',
  mfaRequired: 'mfa.required',
  sodConflict: 'sod.conflict',
  rateLimited: 'rate.limited',
  handlerMisconfigured: 'handler.misconfigured',
} as const;
