import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { PushService } from '../../comms/push.service';
import { FilesService } from '../../files/files.service';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type { CreateNoticeDto, ListNoticesQueryDto, UpdateNoticeDto } from './daily.dto';
import type { AttachedFile } from './daily-work.service';
import { DAILY } from './daily.permissions';
import { ViewerService, type Viewer } from './viewer.service';

export interface NoticeTarget {
  type: 'class' | 'class_section' | 'student' | 'employee';
  id: string;
  label: string;
}

export interface NoticeRow {
  id: string;
  kind: 'notice' | 'circular';
  title: string;
  body: string;
  audience: 'everyone' | 'students' | 'employees';
  publishFrom: string;
  publishUntil: string | null;
  isPinned: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  targets: NoticeTarget[];
  files: AttachedFile[];
  createdAt: string;
}

interface Db {
  id: string;
  kind: NoticeRow['kind'];
  title: string;
  body: string;
  audience: NoticeRow['audience'];
  publish_from: string;
  publish_until: string | null;
  is_pinned: boolean;
  published_at: Date | null;
  published_by: string | null;
  targets: NoticeTarget[];
  files: AttachedFile[];
  created_at: Date;
}

const SELECT = `SELECT n.id::text, n.kind, n.title, n.body, n.audience, n.publish_from::text, n.publish_until::text, n.is_pinned,
        n.published_at, u.display_name AS published_by, n.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('type', t.target_type, 'id', t.target_id::text, 'label',
                   CASE t.target_type
                     WHEN 'class' THEN (SELECT c.code FROM classes c WHERE c.id = t.target_id)
                     WHEN 'class_section' THEN (SELECT c.code || '-' || cs.name FROM class_sections cs JOIN classes c ON c.id = cs.class_id WHERE cs.id = t.target_id)
                     WHEN 'student' THEN (SELECT s.display_name FROM students s WHERE s.id = t.target_id)
                     WHEN 'employee' THEN (SELECT e.display_name FROM employees e WHERE e.id = t.target_id)
                   END) ORDER BY t.target_type, t.target_id) FROM notice_targets t WHERE t.notice_id = n.id), '[]'::jsonb) AS targets,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id::text, 'name', f.original_name, 'contentType', f.content_type, 'sizeBytes', f.size_bytes) ORDER BY f.id)
                    FROM notice_files nf JOIN files f ON f.id = nf.file_id WHERE nf.notice_id = n.id), '[]'::jsonb) AS files
   FROM notices n LEFT JOIN users u ON u.id = n.published_by`;

const toRow = (r: Db): NoticeRow => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  audience: r.audience,
  publishFrom: r.publish_from,
  publishUntil: r.publish_until,
  isPinned: r.is_pinned,
  publishedAt: r.published_at ? r.published_at.toISOString() : null,
  publishedBy: r.published_by,
  targets: r.targets,
  files: r.files,
  createdAt: r.created_at.toISOString(),
});

/**
 * Notices and circulars (S7-04). Managers see everything; everyone else sees published notices whose
 * audience and targets include them: families through their children's sections, staff through their
 * employee record and the sections they teach.
 */
@Injectable()
export class NoticesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly files: FilesService,
    private readonly push: PushService,
  ) {}

  /** A file attached to a notice the viewer may read (families included), as a signed link. */
  async fileUrl(ctx: RequestContext, id: string, fileId: string) {
    const row = await this.get(ctx, id);
    if (!row.files.some((f) => f.id === fileId))
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }

  /** SQL fragment restricting rows to what the viewer may read; params are appended. */
  private visibility(ctx: RequestContext, v: Viewer, params: unknown[]): string {
    if (ctx.permissions?.has(DAILY.noticeManage)) return 'TRUE';
    const live = `n.published_at IS NOT NULL AND n.publish_from <= CURRENT_DATE AND (n.publish_until IS NULL OR n.publish_until >= CURRENT_DATE)`;
    if (v.kind === 'family') {
      params.push(
        v.sectionIds ?? [],
        v.students.map((s) => s.id),
      );
      const sec = params.length - 1;
      const stu = params.length;
      // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
      return `${live} AND n.audience IN ('everyone', 'students') AND (
        NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id)
        OR EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id AND (
             (t.target_type = 'class_section' AND t.target_id = ANY($${sec}::bigint[]))
          OR (t.target_type = 'class' AND t.target_id IN (SELECT cs.class_id FROM class_sections cs WHERE cs.id = ANY($${sec}::bigint[])))
          OR (t.target_type = 'student' AND t.target_id = ANY($${stu}::bigint[])))))`;
    }
    params.push(v.employeeId);
    const emp = params.length;
    const sections =
      v.sectionIds === null
        ? 'TRUE'
        : (() => {
            params.push(v.sectionIds);
            return `(t.target_type = 'class_section' AND t.target_id = ANY($${params.length}::bigint[]))`;
          })();
    // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
    return `${live} AND n.audience IN ('everyone', 'employees') AND (
      NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id)
      OR EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = n.id AND (
           (t.target_type = 'employee' AND t.target_id = $${emp}::bigint) OR ${sections})))`;
  }

  async list(
    ctx: RequestContext,
    q: ListNoticesQueryDto,
  ): Promise<{ rows: NoticeRow[]; total: number }> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.noticeView);
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [yearId];
      const where: string[] = ['n.deleted_at IS NULL', 'n.academic_year_id = $1'];
      where.push(this.visibility(ctx, v, params));
      if (q.kind) {
        params.push(q.kind);
        where.push(`n.kind = $${params.length}::notice_kind`);
      }
      if (q.status === 'draft') where.push('n.published_at IS NULL');
      if (q.status === 'published') where.push('n.published_at IS NOT NULL');
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(`(n.title ILIKE $${params.length} OR n.body ILIKE $${params.length})`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM notices n WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${SELECT} WHERE ${whereSql} ORDER BY n.is_pinned DESC, n.publish_from DESC, n.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  private async find(c: PoolClient, id: string): Promise<NoticeRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = await c.query<Db>(`${SELECT} WHERE n.id = $1 AND n.deleted_at IS NULL`, [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async get(ctx: RequestContext, id: string): Promise<NoticeRow> {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, DAILY.noticeView);
    const row = await this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [id];
      const visible = this.visibility(ctx, v, params);
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; visible is built from fixed fragments; values are bound parameters
        `${SELECT} WHERE n.id = $1 AND n.deleted_at IS NULL AND ${visible}`,
        params,
      );
      return r.rows[0] ? toRow(r.rows[0]) : null;
    });
    if (!row) throw new DomainError('not-found', 'Notice not found');
    return row;
  }

  private async writeTargets(
    c: PoolClient,
    id: string,
    targets: Array<{ type: string; id: string }>,
  ): Promise<void> {
    await c.query(`DELETE FROM notice_targets WHERE notice_id = $1`, [id]);
    for (const t of targets)
      await c.query(
        `INSERT INTO notice_targets (notice_id, school_id, target_type, target_id) VALUES ($1, app.current_school_id(), $2::notice_target_type, $3) ON CONFLICT DO NOTHING`,
        [id, t.type, t.id],
      );
  }

  private async writeFiles(c: PoolClient, id: string, fileIds: string[]): Promise<void> {
    await c.query(`DELETE FROM notice_files WHERE notice_id = $1`, [id]);
    for (const fileId of new Set(fileIds))
      await c.query(
        `INSERT INTO notice_files (notice_id, file_id, school_id) VALUES ($1, $2, app.current_school_id())`,
        [id, fileId],
      );
  }

  async create(ctx: RequestContext, dto: CreateNoticeDto): Promise<NoticeRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    await this.viewer.assertFilesReady(ctx, dto.fileIds);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO notices (school_id, academic_year_id, kind, title, body, audience, publish_from, publish_until, is_pinned, published_at, published_by, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::notice_kind, $3, $4, $5::audience_kind, COALESCE($6::date, CURRENT_DATE), $7::date, $8,
                 CASE WHEN $9 THEN now() END, CASE WHEN $9 THEN app.current_user_id() END, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          yearId,
          dto.kind,
          dto.title,
          dto.body,
          dto.audience,
          dto.publishFrom ?? null,
          dto.publishUntil ?? null,
          dto.isPinned,
          dto.publish,
        ],
      );
      const id = r.rows[0]!.id;
      await this.writeTargets(c, id, dto.targets);
      await this.writeFiles(c, id, dto.fileIds);
      const created = (await this.find(c, id))!;
      // published today: a push to the families and staff it reaches (when the admin switched it on)
      if (
        dto.publish &&
        (!dto.publishFrom || dto.publishFrom <= new Date().toISOString().slice(0, 10))
      )
        await this.push.send(c, ctx, {
          userIds: await this.push.usersOfNotice(c, id),
          title: dto.kind === 'circular' ? 'New circular' : 'New notice',
          body: dto.title,
          link: '/notices',
          event: 'notices',
        });
      await this.audit.stage(ctx, c, {
        action: dto.publish ? 'academics.notice.publish' : 'academics.notice.create',
        entityType: 'notices',
        entityId: id,
        after: created,
      });
      return created;
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateNoticeDto): Promise<NoticeRow> {
    const tenant = requireTenant(ctx);
    if (dto.fileIds) await this.viewer.assertFilesReady(ctx, dto.fileIds);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Notice not found');
      const sets: string[] = ['updated_at = now()', 'updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.kind !== undefined) set('kind', dto.kind, '::notice_kind');
      if (dto.title !== undefined) set('title', dto.title);
      if (dto.body !== undefined) set('body', dto.body);
      if (dto.audience !== undefined) set('audience', dto.audience, '::audience_kind');
      if (dto.publishFrom !== undefined) set('publish_from', dto.publishFrom, '::date');
      if (dto.publishUntil !== undefined) set('publish_until', dto.publishUntil, '::date');
      if (dto.isPinned !== undefined) set('is_pinned', dto.isPinned);
      params.push(id);
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE notices SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      if (dto.targets) await this.writeTargets(c, id, dto.targets);
      if (dto.fileIds) await this.writeFiles(c, id, dto.fileIds);
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.notice.edit',
        entityType: 'notices',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  async publish(ctx: RequestContext, id: string, publish: boolean): Promise<NoticeRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Notice not found');
      await c.query(
        `UPDATE notices SET published_at = CASE WHEN $2 THEN now() END, published_by = CASE WHEN $2 THEN app.current_user_id() END,
                updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, publish],
      );
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: publish ? 'academics.notice.publish' : 'academics.notice.unpublish',
        entityType: 'notices',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const tenant = requireTenant(ctx);
    await this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Notice not found');
      await c.query(
        `UPDATE notices SET deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'academics.notice.delete',
        entityType: 'notices',
        entityId: id,
        before,
      });
    });
  }
}
