import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import type { SignatureDto } from './report-cards.dto';

interface Row {
  id: string;
  role: string;
  label: string;
  person_name: string | null;
  file_id: string | null;
  class_ids: string[];
  sort_order: number;
  status: string;
}

/**
 * Signatures on the report cards (docs/design/65, part 4): a role (principal, vice principal,
 * headmistress, coordinator, class teacher, exam in-charge, or the school seal), the words under it, a
 * person's name and an image, for every class or some (a class's own one comes first). The image is a
 * file of the school; the card renderer embeds it.
 */
@Injectable()
export class ReportCardSignaturesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private shape(r: Row) {
    return {
      id: r.id,
      role: r.role,
      label: r.label,
      personName: r.person_name,
      fileId: r.file_id,
      hasImage: Boolean(r.file_id),
      classIds: r.class_ids,
      sortOrder: r.sort_order,
      status: r.status,
    };
  }

  private async rows(c: PoolClient) {
    return (
      await c.query<Row>(
        `SELECT id::text, role, label, person_name, file_id::text, class_ids::text[] AS class_ids, sort_order, status::text
           FROM report_card_signatures ORDER BY role, sort_order, id`,
      )
    ).rows.map((r) => this.shape(r));
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({ data: await this.rows(c) }));
  }

  private async image(c: PoolClient, schoolId: string, img: NonNullable<SignatureDto['image']>) {
    const bytes = Buffer.from(img.base64, 'base64');
    if (bytes.length > 300_000)
      throw new DomainError('validation-failed', 'The image is larger than 300 KB', {
        status: 400,
      });
    const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if ((img.contentType === 'image/png' && !png) || (img.contentType === 'image/jpeg' && !jpg))
      throw new DomainError('validation-failed', 'The image is not a PNG or JPEG', { status: 400 });
    const key = objectKeyFor(
      schoolId,
      png ? 'png' : 'jpg',
      `signature-${randomBytes(8).toString('hex')}`,
    );
    await this.storage.write(key, bytes, img.contentType);
    return (
      await c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                            classification, storage_driver, status, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, 'signature', 'report_card_signature', 'internal', $6, 'ready',
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          this.storage.bucket,
          key,
          img.contentType,
          bytes.length,
          createHash('sha256').update(bytes).digest('hex'),
          this.storage.name,
        ],
      )
    ).rows[0]!.id;
  }

  async create(ctx: RequestContext, dto: SignatureDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const fileId = dto.image ? await this.image(c, tenant.schoolId, dto.image) : null;
      const r = await c.query<{ id: string }>(
        `INSERT INTO report_card_signatures (school_id, role, label, person_name, file_id, class_ids, sort_order, status, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::bigint[], $6, $7::row_status, app.current_user_id()) RETURNING id::text`,
        [
          dto.role,
          dto.label,
          dto.personName?.trim() || null,
          fileId,
          dto.classIds,
          dto.sortOrder,
          dto.status,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.signature.create',
        entityType: 'report_card_signatures',
        entityId: r.rows[0]!.id,
        after: { role: dto.role, label: dto.label, image: Boolean(fileId) },
      });
      return { data: await this.rows(c) };
    });
  }

  async update(ctx: RequestContext, id: string, dto: SignatureDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const fileId = dto.image ? await this.image(c, tenant.schoolId, dto.image) : null;
      const r = await c.query(
        `UPDATE report_card_signatures SET role = $2, label = $3, person_name = $4, file_id = COALESCE($5, file_id),
                class_ids = $6::bigint[], sort_order = $7, status = $8::row_status, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          dto.role,
          dto.label,
          dto.personName?.trim() || null,
          fileId,
          dto.classIds,
          dto.sortOrder,
          dto.status,
        ],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Signature not found');
      await this.audit.stage(ctx, c, {
        action: 'exams.signature.update',
        entityType: 'report_card_signatures',
        entityId: id,
        after: { role: dto.role, label: dto.label, image: Boolean(fileId) },
      });
      return { data: await this.rows(c) };
    });
  }

  /** The image, for the setup page. */
  async imageOf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ object_key: string; content_type: string }>(
        `SELECT f.object_key, f.content_type FROM report_card_signatures x JOIN files f ON f.id = x.file_id AND f.deleted_at IS NULL
          WHERE x.id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'No image');
      const bytes = await this.storage.read(r.rows[0].object_key);
      return {
        filename: `signature-${id}.${r.rows[0].content_type === 'image/png' ? 'png' : 'jpg'}`,
        contentType: r.rows[0].content_type,
        base64: bytes.toString('base64'),
      };
    });
  }

  /** The card's signature images as data URIs (the preview; the worker does the same for the PDF). */
  async fill(
    signatures: Array<{
      objectKey: string | null;
      contentType: string | null;
      dataUri: string | null;
    }>,
  ) {
    for (const g of signatures) {
      if (!g.objectKey) continue;
      try {
        const bytes = await this.storage.read(g.objectKey);
        g.dataUri = `data:${g.contentType ?? 'image/png'};base64,${bytes.toString('base64')}`;
      } catch {
        g.dataUri = null;
      }
    }
  }
}
