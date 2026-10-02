import { Module } from '@nestjs/common';
import { createStorageDriver } from '@edupro/storage';
import { ENV, type Env } from '../../config/env';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { NoopScanner, SCANNER, STORAGE_DRIVER } from './storage';

/** The workers build the same driver from the same variables (apps/workers/src/env.ts), so files written by a job are served by the API. */
export function storageConfigFrom(env: Env) {
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

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: STORAGE_DRIVER,
      inject: [ENV],
      useFactory: (env: Env) => createStorageDriver(storageConfigFrom(env)),
    },
    { provide: SCANNER, useClass: NoopScanner },
  ],
  exports: [FilesService, STORAGE_DRIVER],
})
export class FilesModule {}
