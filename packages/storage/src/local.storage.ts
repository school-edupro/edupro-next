import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { DownloadTarget, StorageDriver, UploadTarget } from './storage';

export interface LocalToken {
  op: 'put' | 'get';
  fileId: string;
  schoolId: string;
  key: string;
  exp: number; // unix seconds
  contentType?: string;
  size?: number;
  name?: string;
}

/**
 * Development driver: bytes live under a directory and the API itself serves signed upload and download
 * URLs. The token is an HMAC-signed JSON payload; nothing about it is guessable. Fastify caps path
 * parameters at 100 characters, so the token travels in the query string.
 */
export class LocalStorage implements StorageDriver {
  readonly name = 'local' as const;
  readonly bucket = 'local';

  constructor(
    private readonly baseDir: string,
    private readonly apiBaseUrl: string,
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  private pathFor(objectKey: string): string {
    const full = resolve(this.baseDir, objectKey);
    const root = resolve(this.baseDir) + sep;
    if (!full.startsWith(root)) throw new Error('object key escapes the storage directory');
    return full;
  }

  sign(payload: LocalToken): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  verify(token: string, op: 'put' | 'get'): LocalToken | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LocalToken;
      if (payload.op !== op) return null;
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async createUploadUrl(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
    fileId: string,
    schoolId: string,
  ): Promise<UploadTarget> {
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const token = this.sign({
      op: 'put',
      fileId,
      schoolId,
      key: objectKey,
      exp,
      contentType,
      size: sizeBytes,
    });
    return {
      url: `${this.apiBaseUrl}/api/v1/platform/files/local?token=${token}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async createDownloadUrl(
    objectKey: string,
    fileName: string,
    contentType: string,
    fileId: string,
    schoolId: string,
  ): Promise<DownloadTarget> {
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const token = this.sign({
      op: 'get',
      fileId,
      schoolId,
      key: objectKey,
      exp,
      contentType,
      name: fileName,
    });
    return {
      url: `${this.apiBaseUrl}/api/v1/platform/files/local?token=${token}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async write(objectKey: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async read(objectKey: string): Promise<Buffer> {
    return readFile(this.pathFor(objectKey));
  }

  async head(objectKey: string): Promise<{ sizeBytes: number } | null> {
    try {
      const s = await stat(this.pathFor(objectKey));
      return { sizeBytes: s.size };
    } catch {
      return null;
    }
  }

  async remove(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }

  /**
   * A relative STORAGE_LOCAL_DIR resolves against the repository root (the folder holding
   * pnpm-workspace.yaml) rather than the process directory, so the API and the workers, which start in
   * different package folders, read and write the same files.
   */
  static resolveDir(configured: string, cwd = process.cwd()): string {
    if (isAbsolute(configured)) return configured;
    let dir = cwd;
    for (let i = 0; i < 6; i += 1) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return resolve(dir, configured);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return resolve(cwd, configured);
  }

  static joinKey(...parts: string[]): string {
    return join(...parts)
      .split(sep)
      .join('/');
  }
}
