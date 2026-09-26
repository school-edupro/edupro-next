import 'reflect-metadata';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AppModule } from './app.module';
import { corsOrigins, loadEnv } from './config/env';
import { loggerOptions } from './config/logging';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('bootstrap');

  const adapter = new FastifyAdapter({
    logger: loggerOptions(env.NODE_ENV),
    genReqId: (req: IncomingMessage) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB; files go to object storage through signed URLs
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false, // Swagger UI needs relaxed CSP locally
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    origin: corsOrigins(env),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-School-Id', 'X-Academic-Year-Id', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
  });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.headers.authorization ? `u:${req.headers.authorization.slice(-32)}` : `ip:${req.ip}`),
  });

  app.getHttpAdapter().getInstance().addHook('onSend', async (req, reply) => {
    void reply.header('X-Request-Id', req.id);
  });

  if (env.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('EduPro Next API')
        .setDescription('Multi-school, multi-year School ERP. Tenant via X-School-Id, year via X-Academic-Year-Id.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    // nestjs-zod v5: post-process the document so zod DTOs render as proper schemas
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));
  }

  app.enableShutdownHooks();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.log(`API listening on :${env.API_PORT} (${env.NODE_ENV})`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
