/** Storage driver contract (S2-08). Drivers never see tenant data; they move bytes for an object key. */
export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface DownloadTarget {
  url: string;
  expiresAt: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  readonly bucket: string;
  createUploadUrl(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
    fileId: string,
    schoolId: string,
  ): Promise<UploadTarget>;
  createDownloadUrl(
    objectKey: string,
    fileName: string,
    contentType: string,
    fileId: string,
    schoolId: string,
  ): Promise<DownloadTarget>;
  head(objectKey: string): Promise<{ sizeBytes: number } | null>;
  remove(objectKey: string): Promise<void>;
}

/** Antivirus hook. The default marks files as not scanned; a ClamAV or cloud scanner replaces it later. */
export interface Scanner {
  scan(input: { objectKey: string; bytes?: Buffer }): Promise<'clean' | 'infected' | 'skipped'>;
}

export class NoopScanner implements Scanner {
  async scan(): Promise<'skipped'> {
    return 'skipped';
  }
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
export const SCANNER = Symbol('SCANNER');
