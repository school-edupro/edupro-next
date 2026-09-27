import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { NoopScanner, SCANNER, STORAGE_DRIVER } from './storage';

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: STORAGE_DRIVER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.STORAGE_DRIVER === 's3'
          ? new S3Storage(
              env.S3_BUCKET!,
              env.S3_REGION!,
              env.FILES_URL_TTL_SECONDS,
              env.S3_ENDPOINT,
              env.S3_FORCE_PATH_STYLE === 'true',
            )
          : new LocalStorage(
              LocalStorage.resolveDir(env.STORAGE_LOCAL_DIR),
              env.API_BASE_URL,
              env.FILES_SIGNING_SECRET,
              env.FILES_URL_TTL_SECONDS,
            ),
    },
    { provide: SCANNER, useClass: NoopScanner },
  ],
  exports: [FilesService],
})
export class FilesModule {}
