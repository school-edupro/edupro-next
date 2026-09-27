import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type { AddAlbumItemsDto, CreateAlbumDto } from './daily.dto';
import { DAILY } from './daily.permissions';
import { ViewerService } from './viewer.service';

export interface AlbumRow {
  id: string;
  title: string;
  description: string | null;
  eventOn: string | null;
  audience: 'everyone' | 'students' | 'employees';
  itemCount: number;
  coverFileId: string | null;
  createdAt: string;
  items?: Array<{
    id: string;
    fileId: string;
    name: string | null;
    contentType: string;
    caption: string | null;
  }>;
}

interface Db {
  id: string;
  title: string;
  description: string | null;
  event_on: string | null;
  audience: AlbumRow['audience'];
  item_count: number;
  cover_file_id: string | null;
  created_at: Date;
}

const SELECT = `SELECT a.id::text, a.title, a.description, a.event_on::text, a.audience, a.cover_file_id::text,
        (SELECT count(*)::int FROM gallery_items i WHERE i.album_id = a.id) AS item_count, a.created_at
   FROM gallery_albums a`;
const toRow = (r: Db): AlbumRow => ({
  id: r.id,
  title: r.title,
  description: r.description,
  eventOn: r.event_on,
  audience: r.audience,
  itemCount: r.item_count,
  coverFileId: r.cover_file_id,
  createdAt: r.created_at.toISOString(),
});

/** Gallery (S7-06): albums of uploaded images, audience-filtered like notices. */
@Injectable()
export class GalleryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
  ) {}

  private audiences(ctx: RequestContext, kind: 'staff' | 'family'): string[] {
    if (ctx.permissions?.has(DAILY.galleryManage)) return ['everyone', 'students', 'employees'];
    return kind === 'family' ? ['everyone', 'students'] : ['everyone', 'employees'];
  }

  async list(ctx: RequestContext): Promise<AlbumRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.galleryView);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
        `${SELECT} WHERE a.academic_year_id = $1 AND a.deleted_at IS NULL AND a.status = 'active' AND a.audience = ANY($2::audience_kind[])
          ORDER BY a.event_on DESC NULLS LAST, a.id DESC`,
        [yearId, this.audiences(ctx, v.kind)],
      );
      return r.rows.map(toRow);
    });
  }

  private async find(c: PoolClient, id: string): Promise<AlbumRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = await c.query<Db>(`${SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
    if (!r.rows[0]) return null;
    const album = toRow(r.rows[0]);
    const items = await c.query<{
      id: string;
      file_id: string;
      name: string | null;
      content_type: string;
      caption: string | null;
    }>(
      `SELECT i.id::text, i.file_id::text, f.original_name AS name, f.content_type, i.caption
         FROM gallery_items i JOIN files f ON f.id = i.file_id WHERE i.album_id = $1 ORDER BY i.sort_order, i.id`,
      [id],
    );
    album.items = items.rows.map((x) => ({
      id: x.id,
      fileId: x.file_id,
      name: x.name,
      contentType: x.content_type,
      caption: x.caption,
    }));
    return album;
  }

  async get(ctx: RequestContext, id: string): Promise<AlbumRow> {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, DAILY.galleryView);
    const row = await this.db.tenant(tenant, (c) => this.find(c, id));
    if (!row || !this.audiences(ctx, v.kind).includes(row.audience))
      throw new DomainError('not-found', 'Album not found');
    return row;
  }

  async create(ctx: RequestContext, dto: CreateAlbumDto): Promise<AlbumRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    await this.viewer.assertFilesReady(ctx, dto.fileIds);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO gallery_albums (school_id, academic_year_id, title, description, event_on, audience, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::audience_kind, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
        [yearId, dto.title, dto.description ?? null, dto.eventOn ?? null, dto.audience],
      );
      const id = r.rows[0]!.id;
      let order = 0;
      for (const fileId of new Set(dto.fileIds)) {
        await c.query(
          `INSERT INTO gallery_items (school_id, album_id, file_id, sort_order, created_by) VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())`,
          [id, fileId, order],
        );
        order += 1;
      }
      if (dto.fileIds[0])
        await c.query(`UPDATE gallery_albums SET cover_file_id = $2 WHERE id = $1`, [
          id,
          dto.fileIds[0],
        ]);
      const created = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.gallery.create',
        entityType: 'gallery_albums',
        entityId: id,
        after: created,
      });
      return created;
    });
  }

  async addItems(ctx: RequestContext, id: string, dto: AddAlbumItemsDto): Promise<AlbumRow> {
    const tenant = requireTenant(ctx);
    await this.viewer.assertFilesReady(
      ctx,
      dto.items.map((i) => i.fileId),
    );
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Album not found');
      for (const [i, item] of dto.items.entries())
        await c.query(
          `INSERT INTO gallery_items (school_id, album_id, file_id, caption, sort_order, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id()) ON CONFLICT (album_id, file_id) DO UPDATE SET caption = EXCLUDED.caption`,
          [id, item.fileId, item.caption ?? null, before.itemCount + i],
        );
      if (!before.coverFileId)
        await c.query(`UPDATE gallery_albums SET cover_file_id = $2 WHERE id = $1`, [
          id,
          dto.items[0]!.fileId,
        ]);
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.gallery.add_items',
        entityType: 'gallery_albums',
        entityId: id,
        before: { itemCount: before.itemCount },
        after: { itemCount: after.itemCount },
      });
      return after;
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Album not found');
      await c.query(
        `UPDATE gallery_albums SET deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'academics.gallery.delete',
        entityType: 'gallery_albums',
        entityId: id,
        before,
      });
    });
  }
}
