/** Storage driver contract (S2-08). Drivers never see tenant data; they move bytes for an object key. */
export interface UploadTarget {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export interface DownloadTarget {
  /** Opens in the browser for PDFs and images (inline); other types download. */
  url: string;
  /** Always downloads a copy (attachment), for the Download links. */
  saveUrl: string;
  expiresAt: string;
}

/** Types a browser shows by itself: these open in the tab, anything else downloads. */
export const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

/** Content-Disposition for a stored file: inline when it can be viewed and no copy was asked for. */
export function disposition(contentType: string, fileName: string, save: boolean): string {
  const safe = fileName.replace(/[^\w.-]+/g, '_');
  return `${!save && VIEWABLE.test(contentType) ? 'inline' : 'attachment'}; filename="${safe}"`;
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
  /** Server-side write, used by workers that generate files (exports, ID cards). */
  write(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  read(objectKey: string): Promise<Buffer>;
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

export interface StorageConfig {
  driver: 'local' | 's3';
  urlTtlSeconds: number;
  /** local driver */
  localDir?: string;
  apiBaseUrl?: string;
  signingSecret?: string;
  /** s3 driver */
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3ForcePathStyle?: boolean;
}

/** Object keys group by school and month so lifecycle rules and per-school exports stay simple. */
export function objectKeyFor(schoolId: string, extension: string, id: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `school-${schoolId}/${yyyy}/${mm}/${id}.${extension.replace(/^\./, '')}`;
}
