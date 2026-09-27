import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AppModule } from './app.module';
import { RAW_BODY_LIMIT, setupApp } from './app.setup';
import { loadEnv } from './config/env';
import { loggerOptions } from './config/logging';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('bootstrap');

  const adapter = new FastifyAdapter({
    logger: loggerOptions(env.NODE_ENV),
    genReqId: (req: IncomingMessage) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    trustProxy: true,
    bodyLimit: RAW_BODY_LIMIT, // per content type limits are set in app.setup.ts
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  await setupApp(app, env);

  if (env.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('EduPro Next API')
        .setDescription(
          'Multi-school, multi-year School ERP. Tenant via X-School-Id, year via X-Academic-Year-Id.',
        )
        .setVersion('0.2.0')
        .addBearerAuth()
        .build(),
    );
    // nestjs-zod v5: post-process the document so zod DTOs render as proper schemas
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));
  }

  app.enableShutdownHooks();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.log(
    `API listening on :${env.API_PORT} (${env.NODE_ENV}), storage driver ${env.STORAGE_DRIVER}`,
  );
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
