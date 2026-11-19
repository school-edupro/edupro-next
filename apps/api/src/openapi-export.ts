/**
 * Writes apps/api/openapi.json for packages/api-client without starting the HTTP listener.
 * Usage: pnpm --filter @edupro/api openapi:export (needs DATABASE_URL for module initialisation), or after a
 * build the faster `pnpm --filter @edupro/api openapi:export:dist` (the mobile app's client is generated from it).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { loadEnv } from './config/env';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await setupApp(app, loadEnv());
  const document = cleanupOpenApiDoc(
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('EduPro Next API').setVersion('0.1.0').addBearerAuth().build(),
    ),
  );
  const target = join(__dirname, '..', 'openapi.json');
  await writeFile(target, JSON.stringify(document, null, 2));
  await app.close();
  process.stdout.write(`wrote ${target}\n`);
}

// queues and pools keep the process alive after close: the file is written, so end here
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
