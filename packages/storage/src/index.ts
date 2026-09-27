import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import type { StorageConfig, StorageDriver } from './storage';

export * from './storage';
export { LocalStorage, type LocalToken } from './local.storage';
export { S3Storage } from './s3.storage';

/** Builds the driver from configuration; the API and the workers must be given the same values. */
export function createStorageDriver(config: StorageConfig, cwd = process.cwd()): StorageDriver {
  if (config.driver === 's3') {
    if (!config.s3Bucket || !config.s3Region)
      throw new Error('S3_BUCKET and S3_REGION are required for the s3 driver');
    return new S3Storage(
      config.s3Bucket,
      config.s3Region,
      config.urlTtlSeconds,
      config.s3Endpoint,
      config.s3ForcePathStyle,
    );
  }
  return new LocalStorage(
    LocalStorage.resolveDir(config.localDir ?? '.data/uploads', cwd),
    config.apiBaseUrl ?? 'http://localhost:4000',
    config.signingSecret ?? 'dev-files-signing-secret-change-me',
    config.urlTtlSeconds,
  );
}
