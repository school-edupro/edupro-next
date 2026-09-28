import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Server } from 'node:http';
import { MetricsService } from './common/metrics/metrics.service';
import { corsOrigins, type Env } from './config/env';

export const JSON_BODY_LIMIT = 1_048_576; // 1 MB for JSON (threat model T15)
export const RAW_BODY_LIMIT = 26_214_400; // 25 MB for file bytes on the local storage driver

/**
 * HTTP configuration shared by main.ts, the OpenAPI export and the e2e tests, so tests exercise the same
 * body parsers, headers and limits as production.
 */
export async function setupApp(app: NestFastifyApplication, env: Env): Promise<void> {
  app.setGlobalPrefix('api/v1');

  const fastify = app.getHttpAdapter().getInstance();
  // JSON stays small; any other content type arrives as a Buffer for the file endpoints.
  // Fastify's documented way to replace the default parsers is to remove them all and re-add. The JSON
  // parser goes through Nest's useBodyParser so that app.init() does not register a second copy.
  fastify.removeAllContentTypeParsers();
  const jsonParser = fastify.getDefaultJsonParser('ignore', 'ignore');
  app.useBodyParser<Server>(
    'application/json',
    { bodyLimit: JSON_BODY_LIMIT },
    (req, body, done) => {
      // Sprint 13: gateway webhooks (Razorpay) sign the raw body; keep it beside the parsed JSON.
      (req as unknown as { rawBody?: Buffer }).rawBody = body;
      jsonParser(req, body.toString('utf8'), done);
    },
  );
  fastify.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: RAW_BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false, // Swagger UI needs relaxed CSP locally
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    origin: corsOrigins(env),
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-School-Id',
      'X-Academic-Year-Id',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id'],
  });
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'test' ? 10_000 : env.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      req.headers.authorization ? `u:${req.headers.authorization.slice(-32)}` : `ip:${req.ip}`,
  });

  fastify.addHook('onSend', async (req, reply) => {
    void reply.header('X-Request-Id', req.id);
  });

  // Request metrics by route template (never by raw URL, which may carry ids) for Prometheus (S5-04).
  const metrics = app.get(MetricsService, { strict: false });
  fastify.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    metrics.httpRequests.inc({ method: req.method, route, status: String(reply.statusCode) });
    metrics.httpDuration.observe({ method: req.method, route }, reply.elapsedTime / 1000);
  });
}
