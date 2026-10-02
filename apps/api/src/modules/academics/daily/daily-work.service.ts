import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { PushService } from '../../comms/push.service';
import { FilesService } from '../../files/files.service';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type { CreateDailyWorkDto, ListDailyWorkQueryDto, UpdateDailyWorkDto } from './daily.dto';
import { DAILY } from './daily.permissions';
import { ViewerService } from './viewer.service';

export interface AttachedFile {
  id: string;
  name: string | null;
  contentType: string;
  sizeBytes: number;
}

export interface DailyWorkRow {
  id: string;
  kind: 'homework' | 'classwork' | 'assignment';
  classSectionId: string;
  section: string;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  title: string;
  body: string;
  assignedOn: string;
  dueOn: string | null;
  postedBy: string | null;
  files: AttachedFile[];
  createdAt: string;
}

interface Db {
  id: string;
  kind: DailyWorkRow['kind'];
  class_section_id: string;
  section: string;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  title: string;
  body: string;
  assigned_on: string;
  due_on: string | null;
  posted_by: string | null;
  files: AttachedFile[];
  created_at: Date;
}

const SELECT = `SELECT w.id::text, w.kind, w.class_section_id::text, c.code || '-' || cs.name AS section,
        w.subject_id::text, s.code AS subject_code, s.name AS subject_name, w.title, w.body,
        w.assigned_on::text, w.due_on::text, e.display_name AS posted_by, w.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id::text, 'name', f.original_name, 'contentType', f.content_type, 'sizeBytes', f.size_bytes) ORDER BY f.id)
                    FROM daily_work_files wf JOIN files f ON f.id = wf.file_id WHERE wf.daily_work_id = w.id), '[]'::jsonb) AS files
   FROM daily_work w
   JOIN class_sections cs ON cs.id = w.class_section_id
   JOIN classes c ON c.id = cs.class_id
   LEFT JOIN subjects s ON s.id = w.subject_id
   LEFT JOIN employees e ON e.id = w.posted_by_employee_id`;

const toRow = (r: Db): DailyWorkRow => ({
  id: r.id,
  kind: r.kind,
  classSectionId: r.class_section_id,
  section: r.section,
  subjectId: r.subject_id,
  subjectCode: r.subject_code,
  subjectName: r.subject_name,
  title: r.title,
  body: r.body,
  assignedOn: r.assigned_on,
  dueOn: r.due_on,
  postedBy: r.posted_by,
  files: r.files,
  createdAt: r.created_at.toISOString(),
});

/** Homework, classwork and assignments (S7-03): teachers post for their sections, families read their children's. */
@Injectable()
export class DailyWorkService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
    private readonly viewer: ViewerService,
    private readonly files: FilesService,
    private readonly push: PushService,
  ) {}

  /** A file attached to homework / classwork the viewer may see (families included), as a signed link. */
  async fileUrl(ctx: RequestContext, id: string, fileId: string) {
    const row = await this.get(ctx, id);
    if (!row.files.some((f) => f.id === fileId))
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }

  async list(
    ctx: RequestContext,
    q: ListDailyWorkQueryDto,
  ): Promise<{ rows: DailyWorkRow[]; total: number }> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.workView);
    if (q.classSectionId && v.sectionIds !== null && !v.sectionIds.includes(q.classSectionId))
      throw new DomainError('scope-denied', 'This section is outside your scope', { status: 403 });
    return this.db.tenant(tenant, async (c) => {
      const where: string[] = ['w.deleted_at IS NULL', 'w.academic_year_id = $1'];
      const params: unknown[] = [yearId];
      if (q.classSectionId) {
        params.push(q.classSectionId);
        where.push(`w.class_section_id = $${params.length}`);
      } else if (v.sectionIds !== null) {
        params.push(v.sectionIds);
        where.push(`w.class_section_id = ANY($${params.length}::bigint[])`);
      }
      if (q.kind) {
        params.push(q.kind);
        where.push(`w.kind = $${params.length}::daily_work_kind`);
      }
      if (q.from) {
        params.push(q.from);
        where.push(`w.assigned_on >= $${params.length}::date`);
      }
      if (q.to) {
        params.push(q.to);
        where.push(`w.assigned_on <= $${params.length}::date`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM daily_work w WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${SELECT} WHERE ${whereSql} ORDER BY w.assigned_on DESC, w.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  private async find(c: PoolClient, id: string): Promise<DailyWorkRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = await c.query<Db>(`${SELECT} WHERE w.id = $1 AND w.deleted_at IS NULL`, [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async get(ctx: RequestContext, id: string): Promise<DailyWorkRow> {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, DAILY.workView);
    const row = await this.db.tenant(tenant, (c) => this.find(c, id));
    if (!row || (v.sectionIds !== null && !v.sectionIds.includes(row.classSectionId)))
      throw new DomainError('not-found', 'Not found');
    return row;
  }

  async create(ctx: RequestContext, dto: CreateDailyWorkDto): Promise<DailyWorkRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    await this.scopes.assert(tenant, DAILY.workPost, 'class_section', dto.classSectionId);
    await this.viewer.assertFilesReady(ctx, dto.fileIds);
    const v = await this.viewer.resolve(ctx, DAILY.workPost);
    return this.db.tenant(tenant, async (c) => {
      const section = await c.query<{ academic_year_id: string }>(
        `SELECT academic_year_id::text FROM class_sections WHERE id = $1 AND deleted_at IS NULL`,
        [dto.classSectionId],
      );
      if (!section.rows[0]) throw new DomainError('not-found', 'Section not found');
      if (section.rows[0].academic_year_id !== yearId)
        throw new DomainError(
          'assignment.section_year_mismatch',
          'The section belongs to another academic year',
          {
            status: 409,
          },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO daily_work (school_id, academic_year_id, class_section_id, subject_id, kind, title, body, assigned_on, due_on, posted_by_employee_id, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::daily_work_kind, $5, $6, COALESCE($7::date, CURRENT_DATE), $8::date, $9, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          yearId,
          dto.classSectionId,
          dto.subjectId ?? null,
          dto.kind,
          dto.title,
          dto.body,
          dto.assignedOn ?? null,
          dto.dueOn ?? null,
          v.employeeId,
        ],
      );
      const id = r.rows[0]!.id;
      for (const fileId of new Set(dto.fileIds))
        await c.query(
          `INSERT INTO daily_work_files (daily_work_id, file_id, school_id) VALUES ($1, $2, app.current_school_id())`,
          [id, fileId],
        );
      const created = (await this.find(c, id))!;
      await this.push.send(c, ctx, {
        userIds: await this.push.familyUsersOfSections(c, [dto.classSectionId]),
        title: dto.kind === 'homework' ? 'New homework' : `New ${dto.kind}`,
        body: dto.title,
        link: '/homework',
        event: 'homework',
      });
      await this.audit.stage(ctx, c, {
        action: `academics.${dto.kind}.post`,
        entityType: 'daily_work',
        entityId: id,
        after: created,
      });
      return created;
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateDailyWorkDto): Promise<DailyWorkRow> {
    const tenant = requireTenant(ctx);
    if (dto.fileIds) await this.viewer.assertFilesReady(ctx, dto.fileIds);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Not found');
      await this.scopes.assert(tenant, DAILY.workPost, 'class_section', before.classSectionId);
      const sets: string[] = ['updated_at = now()', 'updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.subjectId !== undefined) set('subject_id', dto.subjectId);
      if (dto.title !== undefined) set('title', dto.title);
      if (dto.body !== undefined) set('body', dto.body);
      if (dto.assignedOn !== undefined) set('assigned_on', dto.assignedOn, '::date');
      if (dto.dueOn !== undefined) set('due_on', dto.dueOn, '::date');
      params.push(id);
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE daily_work SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      if (dto.fileIds) {
        await c.query(`DELETE FROM daily_work_files WHERE daily_work_id = $1`, [id]);
        for (const fileId of new Set(dto.fileIds))
          await c.query(
            `INSERT INTO daily_work_files (daily_work_id, file_id, school_id) VALUES ($1, $2, app.current_school_id())`,
            [id, fileId],
          );
      }
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: `academics.${before.kind}.edit`,
        entityType: 'daily_work',
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
      if (!before) throw new DomainError('not-found', 'Not found');
      await this.scopes.assert(tenant, DAILY.workPost, 'class_section', before.classSectionId);
      await c.query(
        `UPDATE daily_work SET deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: `academics.${before.kind}.delete`,
        entityType: 'daily_work',
        entityId: id,
        before,
      });
    });
  }
}
