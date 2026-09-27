/** Nest injection tokens for the storage driver and scanner; the drivers live in @edupro/storage. */
export type { DownloadTarget, Scanner, StorageDriver, UploadTarget } from '@edupro/storage';
export { NoopScanner } from '@edupro/storage';

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
export const SCANNER = Symbol('SCANNER');
