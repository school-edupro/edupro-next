import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ALLOWED_CONTENT_TYPES, MAX_BYTES_BY_CLASS, type CreateUploadDto } from './files.dto';
import { LocalStorage } from './local.storage';
import { SCANNER, STORAGE_DRIVER, type Scanner, type StorageDriver } from './storage';

export interface FileRow {
  id: string;
  fileName: string | null;
  contentType: string;
  sizeBytes: number;
  sha256: string | null;
  classification: 'public' | 'internal' | 'personal' | 'sensitive';
  status: 'pending' | 'ready' | 'rejected';
  ownerEntityType: string | null;
  ownerEntityId: string | null;
  scanResult: string | null;
  createdAt: string;
}

interface FileDbRow {
  id: string;
  original_name: string | null;
  content_type: string;
  size_bytes: string;
  sha256: string | null;
  classification: FileRow['classification'];
  status: FileRow['status'];
  owner_entity_type: string | null;
  owner_entity_id: string | null;
  scan_result: string | null;
  created_at: Date;
  object_key: string;
  bucket: string;
}

const COLS = `id::text, original_name, content_type, size_bytes::text, sha256, classification, status, owner_entity_type, owner_entity_id, scan_result, created_at, object_key, bucket`;

const toRow = (x: FileDbRow): FileRow => ({
  id: x.id,
  fileName: x.original_name,
  contentType: x.content_type,
  sizeBytes: Number(x.size_bytes),
  sha256: x.sha256,
  classification: x.classification,
  status: x.status,
  ownerEntityType: x.owner_entity_type,
  ownerEntityId: x.owner_entity_id,
  scanResult: x.scan_result,
  createdAt: x.created_at.toISOString(),
});

@Injectable()
export class FilesService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @Inject(SCANNER) private readonly scanner: Scanner,
  ) {}

  async createUpload(ctx: RequestContext, dto: CreateUploadDto) {
    const tenant = requireTenant(ctx);
    const max = MAX_BYTES_BY_CLASS[dto.classification];
    if (dto.sizeBytes > max) {
      throw new DomainError(
        'file.too_large',
        `Files classified ${dto.classification} may be at most ${Math.round(max / 1024 / 1024)} MB`,
        { status: 413 },
      );
    }
    const ext = ALLOWED_CONTENT_TYPES[dto.contentType]!;
    const now = new Date();
    const objectKey = LocalStorage.joinKey(
      `school-${tenant.schoolId}`,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${ext}`,
    );

    const created = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<FileDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, owner_entity_type, owner_entity_id,
                            classification, storage_driver, status, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::file_class, $9, 'pending', app.current_user_id(), app.current_user_id())
         RETURNING ${COLS}`,
        [
          this.storage.bucket,
          objectKey,
          dto.contentType,
          dto.sizeBytes,
          dto.fileName,
          dto.ownerEntityType ?? null,
          dto.ownerEntityId ?? null,
          dto.classification,
          this.storage.name,
        ],
      );
      return r.rows[0]!;
    });

    const upload = await this.storage.createUploadUrl(
      objectKey,
      dto.contentType,
      dto.sizeBytes,
      created.id,
      tenant.schoolId,
    );
    ctx.audit = {
      action: 'platform.files.create',
      entityType: 'files',
      entityId: created.id,
      after: toRow(created),
    };
    return { file: toRow(created), upload };
  }

  async get(ctx: RequestContext, id: string): Promise<FileRow> {
    const row = await this.find(requireTenant(ctx), id);
    return toRow(row);
  }

  /** For S3: verifies the object exists and marks the row ready. For local: a no-op once the PUT succeeded. */
  async complete(ctx: RequestContext, id: string): Promise<FileRow> {
    const tenant = requireTenant(ctx);
    const row = await this.find(tenant, id);
    if (row.status === 'ready') return toRow(row);
    const head = await this.storage.head(row.object_key);
    if (!head)
      throw new DomainError('file.not_uploaded', 'The object has not been uploaded yet', {
        status: 409,
      });
    if (head.sizeBytes > Number(row.size_bytes))
      throw new DomainError('file.size_mismatch', 'Uploaded object is larger than declared', {
        status: 409,
      });
    const scan = await this.scanner.scan({ objectKey: row.object_key });
    const updated = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<FileDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `UPDATE files SET status = $2::file_status, size_bytes = $3, scanned_at = now(), scan_result = $4, updated_by = app.current_user_id()
          WHERE id = $1 RETURNING ${COLS}`,
        [id, scan === 'infected' ? 'rejected' : 'ready', head.sizeBytes, scan],
      );
      return r.rows[0]!;
    });
    ctx.audit = {
      action: 'platform.files.complete',
      entityType: 'files',
      entityId: id,
      after: toRow(updated),
    };
    if (scan === 'infected')
      throw new DomainError('file.rejected', 'The file failed the malware scan', { status: 422 });
    return toRow(updated);
  }

  async downloadUrl(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const row = await this.find(tenant, id);
    if (row.status !== 'ready')
      throw new DomainError('file.not_ready', 'The file is not available', { status: 409 });
    const target = await this.storage.createDownloadUrl(
      row.object_key,
      row.original_name ?? `file.${id}`,
      row.content_type,
      id,
      tenant.schoolId,
    );
    if (row.classification === 'sensitive') {
      ctx.audit = {
        action: 'platform.files.download_sensitive',
        entityType: 'files',
        entityId: id,
      };
    }
    return { file: toRow(row), download: target };
  }

  // ---- local driver endpoints (public, token-authenticated) --------------------------------------

  async localPut(token: string, bytes: Buffer): Promise<FileRow> {
    const local = this.requireLocal();
    const payload = local.verify(token, 'put');
    if (!payload)
      throw new DomainError('file.bad_token', 'Invalid or expired upload token', { status: 403 });
    if (payload.size !== undefined && bytes.length > payload.size) {
      throw new DomainError('file.size_mismatch', 'Uploaded bytes exceed the declared size', {
        status: 413,
      });
    }
    const tenant: TenantContext = {
      schoolId: payload.schoolId,
      userId: null,
      allowedSchoolIds: [payload.schoolId],
    };
    const row = await this.find(tenant, payload.fileId);
    if (row.status !== 'pending' || row.object_key !== payload.key)
      throw new DomainError('file.bad_token', 'Token does not match a pending file', {
        status: 403,
      });

    await local.write(payload.key, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const scan = await this.scanner.scan({ objectKey: payload.key, bytes });
    const updated = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<FileDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `UPDATE files SET status = $2::file_status, size_bytes = $3, sha256 = $4, scanned_at = now(), scan_result = $5 WHERE id = $1 RETURNING ${COLS}`,
        [payload.fileId, scan === 'infected' ? 'rejected' : 'ready', bytes.length, sha256, scan],
      );
      return r.rows[0]!;
    });
    if (scan === 'infected') {
      await local.remove(payload.key);
      throw new DomainError('file.rejected', 'The file failed the malware scan', { status: 422 });
    }
    return toRow(updated);
  }

  async localGet(token: string): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
    const local = this.requireLocal();
    const payload = local.verify(token, 'get');
    if (!payload)
      throw new DomainError('file.bad_token', 'Invalid or expired download token', { status: 403 });
    const bytes = await local.read(payload.key).catch(() => null);
    if (!bytes) throw new DomainError('not-found', 'File not found');
    return {
      bytes,
      contentType: payload.contentType ?? 'application/octet-stream',
      fileName: payload.name ?? 'file',
    };
  }

  private requireLocal(): LocalStorage {
    if (!(this.storage instanceof LocalStorage))
      throw new DomainError('not-found', 'Local file endpoints are disabled');
    return this.storage;
  }

  private async find(tenant: TenantContext, id: string): Promise<FileDbRow> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<FileDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `SELECT ${COLS} FROM files WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'File not found');
      return r.rows[0];
    });
  }
}
