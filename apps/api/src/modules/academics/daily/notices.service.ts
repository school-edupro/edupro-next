import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { sanitizeEmailHtml } from '../../comms/email-html';
import { PushService } from '../../comms/push.service';
import { FilesService } from '../../files/files.service';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type {
  CreateNoticeDto,
  ListNoticesQueryDto,
  NoticeReachDto,
  NoticeReportQueryDto,
  UpdateNoticeDto,
  NoticeAudienceFileDto,
} from './daily.dto';
import { schoolTime, type AttachedFile } from './daily-work.service';
import { generatedOn, registerFile, schoolHead } from '../../attendance/register-file';
import { DAILY } from './daily.permissions';
import { readSheet, templateSheet } from '../../../common/excel/sheet';
import { AcademicSettingsService } from './academic-settings.service';
import { ViewerService, type Viewer } from './viewer.service';

export interface NoticeTarget {
  type: 'class' | 'class_section' | 'student' | 'employee';
  id: string;
  label: string;
}

export interface NoticeRow {
  id: string;
  kind: 'notice' | 'circular' | 'office_order';
  title: string;
  body: string;
  /** `html`: the body is cleaned formatted text. */
  bodyFormat: 'text' | 'html';
  ackRequired: boolean;
  /** When the portal starts to show it. */
  publishAt: string | null;
  alsoEmail: boolean;
  emailedAt: string | null;
  emailedCount: number | null;
  ackCount: number;
  /** The children (of the family asking) it is acknowledged for. */
  ackedFor: string[];
  /** The member of staff asking has acknowledged it. */
  ackedByMe: boolean;
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
  body_format: 'text' | 'html';
  ack_required: boolean;
  publish_at: Date | null;
  also_email: boolean;
  emailed_at: Date | null;
  emailed_count: number | null;
  ack_count: number;
  acked_for: string[] | null;
  acked_by_me: boolean;
}

const SELECT = `SELECT n.id::text, n.kind, n.title, n.body, n.audience, n.publish_from::text, n.publish_until::text, n.is_pinned,
        n.published_at, u.display_name AS published_by, n.created_at, n.body_format, n.ack_required, n.publish_at, n.also_email, n.emailed_at, n.emailed_count,
        (SELECT count(*) FROM academic_acks k WHERE k.item_type = 'notice' AND k.item_id = n.id)::int AS ack_count,
        (SELECT array_agg(k.student_id::text) FROM academic_acks k WHERE k.item_type = 'notice' AND k.item_id = n.id AND k.student_id IN (
            SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE g.user_id = app.current_user_id()
            UNION SELECT st.id FROM students st WHERE st.user_id = app.current_user_id())) AS acked_for,
        EXISTS (SELECT 1 FROM academic_acks k WHERE k.item_type = 'notice' AND k.item_id = n.id AND k.staff_user_id = app.current_user_id()) AS acked_by_me,
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

/** A notice written in the editor (the same one as Communication → Compose): cleaned like an e-mail body. */
export const cleanNoticeHtml = (html: string): string => sanitizeEmailHtml(html).trim();

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
  bodyFormat: r.body_format,
  ackRequired: r.ack_required,
  publishAt: r.publish_at ? r.publish_at.toISOString() : null,
  alsoEmail: r.also_email,
  emailedAt: r.emailed_at ? r.emailed_at.toISOString() : null,
  emailedCount: r.emailed_count,
  ackCount: r.ack_count,
  ackedFor: r.acked_for ?? [],
  ackedByMe: r.acked_by_me,
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
    private readonly settings: AcademicSettingsService,
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
    const live = `n.published_at IS NOT NULL AND n.publish_from <= CURRENT_DATE AND (n.publish_until IS NULL OR n.publish_until >= CURRENT_DATE) AND (n.publish_at IS NULL OR n.publish_at <= now())`;
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

  /** No more files than the school allows on a notice. */
  private async assertFileCount(ctx: RequestContext, fileIds: string[]): Promise<void> {
    const max = (await this.settings.get(ctx)).maxNoticeFiles;
    if (new Set(fileIds).size > max)
      throw new DomainError(
        'validation-failed',
        `A notice may carry up to ${String(max)} attachment(s); the school sets this in Academics settings`,
        { status: 400 },
      );
  }

  /** The departments that have active employees, for the compose screen. */
  async departments(ctx: RequestContext): Promise<Array<{ name: string; employees: number }>> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ name: string; employees: number }>(
        `SELECT department AS name, count(*)::int AS employees FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(department, '') <> '' GROUP BY 1 ORDER BY 1`,
      );
      return r.rows;
    });
  }

  async audienceFormat(kind: 'student' | 'employee') {
    const header = kind === 'student' ? 'Admission no' : 'Employee code';
    return {
      filename: `notice-${kind}s-format.xlsx`,
      bytes: await templateSheet({
        sheet: kind === 'student' ? 'Students' : 'Employees',
        columns: [{ header, width: 20, required: true }],
        guide: [
          `Type one ${header.toLowerCase()} in each row, in the first column. Nothing else is needed.`,
          'Upload the file on the compose screen: the people it names are added to "Who is it for".',
        ],
      }),
    };
  }

  /** Reads an Excel list of admission numbers or employee codes: who was found, and what was not. */
  async audienceFile(ctx: RequestContext, dto: NoticeAudienceFileDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const header = dto.kind === 'student' ? 'Admission no' : 'Employee code';
    const rows = await readSheet(dto.fileBase64, [header]);
    const codes = [...new Set(rows.map((r) => r.cells[header]!.trim()).filter(Boolean))];
    return this.db.tenant(tenant, async (c) => {
      const r =
        dto.kind === 'student'
          ? await c.query<{ id: string; code: string; label: string }>(
              `SELECT s.id::text, s.admission_no AS code, s.display_name || ' · ' || k.code || '-' || cs.name || ' (' || s.admission_no || ')' AS label
                 FROM students s JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active'
                 JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE s.deleted_at IS NULL AND lower(s.admission_no) = ANY($1::text[])`,
              [codes.map((x) => x.toLowerCase()), yearId],
            )
          : await c.query<{ id: string; code: string; label: string }>(
              `SELECT e.id::text, e.employee_code AS code, e.display_name || ' (' || e.employee_code || ')' AS label
                 FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' AND lower(e.employee_code) = ANY($1::text[])`,
              [codes.map((x) => x.toLowerCase())],
            );
      const got = new Set(r.rows.map((x) => x.code.toLowerCase()));
      return {
        kind: dto.kind,
        found: r.rows.map((x) => ({ id: x.id, label: x.label })),
        missing: codes.filter((x) => !got.has(x.toLowerCase())),
      };
    });
  }

  async create(ctx: RequestContext, dto: CreateNoticeDto): Promise<NoticeRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    await this.assertFileCount(ctx, dto.fileIds);
    await this.viewer.assertFilesReady(ctx, dto.fileIds, 'notices');
    return this.db.tenant(tenant, async (c) => {
      // a department stands for its active employees
      if (dto.departments.length) {
        const staff = await c.query<{ id: string }>(
          `SELECT id::text FROM employees WHERE deleted_at IS NULL AND status = 'active' AND department = ANY($1::text[])`,
          [dto.departments],
        );
        const have = new Set(dto.targets.filter((t) => t.type === 'employee').map((t) => t.id));
        for (const e of staff.rows)
          if (!have.has(e.id)) dto.targets.push({ type: 'employee', id: e.id });
        if (!dto.targets.length)
          throw new DomainError('validation-failed', 'No active employee is in that department', {
            status: 400,
          });
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO notices (school_id, academic_year_id, kind, title, body, audience, publish_from, publish_until, is_pinned, published_at, published_by,
                              body_format, ack_required, publish_at, also_email, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::notice_kind, $3, $4, $5::audience_kind, COALESCE($6::date, CURRENT_DATE), $7::date, $8,
                 CASE WHEN $9 THEN now() END, CASE WHEN $9 THEN app.current_user_id() END, $10, $11, $12::timestamptz, $13,
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          yearId,
          dto.kind,
          dto.title,
          dto.bodyFormat === 'html' ? cleanNoticeHtml(dto.body) : dto.body,
          // an office order is for the employees
          dto.kind === 'office_order' ? 'employees' : dto.audience,
          dto.publishFrom ?? null,
          dto.publishUntil ?? null,
          dto.isPinned,
          dto.publish,
          dto.bodyFormat,
          dto.ackRequired,
          schoolTime(dto.publishAt),
          dto.alsoEmail,
        ],
      );
      const id = r.rows[0]!.id;
      await this.writeTargets(c, id, dto.targets);
      await this.writeFiles(c, id, dto.fileIds);
      if (dto.publish) await this.mail(c, id, yearId);
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
    if (dto.fileIds) {
      await this.assertFileCount(ctx, dto.fileIds);
      await this.viewer.assertFilesReady(ctx, dto.fileIds, 'notices');
    }
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
      if (dto.body !== undefined)
        set(
          'body',
          (dto.bodyFormat ?? before.bodyFormat) === 'html' ? cleanNoticeHtml(dto.body) : dto.body,
        );
      if (dto.audience !== undefined) set('audience', dto.audience, '::audience_kind');
      if (dto.publishFrom !== undefined) set('publish_from', dto.publishFrom, '::date');
      if (dto.publishUntil !== undefined) set('publish_until', dto.publishUntil, '::date');
      if (dto.isPinned !== undefined) set('is_pinned', dto.isPinned);
      if (dto.bodyFormat !== undefined) set('body_format', dto.bodyFormat);
      if (dto.ackRequired !== undefined) set('ack_required', dto.ackRequired);
      if (dto.publishAt !== undefined)
        set(
          'publish_at',
          dto.publishAt === null ? null : schoolTime(dto.publishAt),
          '::timestamptz',
        );
      if (dto.alsoEmail !== undefined) set('also_email', dto.alsoEmail);
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
      if (publish) await this.mail(c, id, this.viewer.requireYear(tenant));
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

  /** The people a notice is for: the pupils of its classes (their guardians' e-mail) and the employees. */
  private static readonly PUPILS = `FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
     WHERE en.academic_year_id = $2 AND en.status = 'active'
       AND EXISTS (SELECT 1 FROM notices n WHERE n.id = $1 AND n.audience IN ('everyone', 'students'))
       AND (NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = $1)
         OR EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = $1 AND ((t.target_type = 'class_section' AND t.target_id = en.class_section_id)
              OR (t.target_type = 'class' AND t.target_id = cs.class_id) OR (t.target_type = 'student' AND t.target_id = en.student_id))))`;
  private static readonly STAFF = `FROM employees e
     WHERE e.status = 'active' AND e.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM notices n WHERE n.id = $1 AND n.audience IN ('everyone', 'employees'))
       AND (NOT EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = $1)
         OR EXISTS (SELECT 1 FROM notice_targets t WHERE t.notice_id = $1 AND ((t.target_type = 'employee' AND t.target_id = e.id)
              OR (t.target_type = 'class_section' AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = e.id AND ta.class_section_id = t.target_id AND ta.valid_to IS NULL)))))`;

  /**
   * A published notice with "also by e-mail": one mail to each guardian and employee it is for, once.
   * The mail carries the school's name, the title and the text; attachments stay in the portal.
   */
  private async mail(c: PoolClient, id: string, yearId: string): Promise<void> {
    const n = await c.query<{
      title: string;
      body: string;
      body_format: string;
      kind: string;
      school: string;
      files: number;
    }>(
      `SELECT n.title, n.body, n.body_format, n.kind::text, (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
              (SELECT count(*) FROM notice_files f WHERE f.notice_id = n.id)::int AS files
         FROM notices n WHERE n.id = $1 AND n.also_email AND n.emailed_at IS NULL AND n.published_at IS NOT NULL
          AND (n.publish_at IS NULL OR n.publish_at <= now())`,
      [id],
    );
    const x = n.rows[0];
    if (!x) return;
    const to = await c.query<{ email: string; user_id: string | null }>(
      // eslint-disable-next-line no-restricted-syntax -- constant fragments; the notice and the year are bound
      `SELECT DISTINCT ON (email) email, user_id FROM (
         SELECT lower(g.email::text) AS email, g.user_id::text AS user_id
           FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL AND g.email IS NOT NULL
          WHERE sg.receives_notifications AND sg.student_id IN (SELECT en.student_id ${NoticesService.PUPILS})
         UNION ALL
         SELECT lower(e.email::text), e.user_id::text ${NoticesService.STAFF} AND e.email IS NOT NULL) r
        ORDER BY email LIMIT 5000`,
      [id, yearId],
    );
    const esc = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const label =
      x.kind === 'office_order' ? 'Office order' : x.kind === 'circular' ? 'Circular' : 'Notice';
    const body = x.body_format === 'html' ? x.body : esc(x.body).replace(/\n/g, '<br>');
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F3F5F9"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:24px 0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif"><tr><td style="background:#00265D;color:#FFFFFF;padding:16px 24px;font-size:16px;font-weight:600">${esc(x.school)}</td></tr><tr><td style="padding:22px 24px 6px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5B6676">${label}</div><div style="font-size:20px;font-weight:700;color:#00265D;margin-top:4px">${esc(x.title)}</div></td></tr><tr><td style="padding:8px 24px 18px;color:#2B3545;font-size:15px;line-height:1.55">${body}</td></tr>${x.files ? `<tr><td style="padding:0 24px 16px;color:#5B6676;font-size:13px">${String(x.files)} attachment(s): open the portal to see them.</td></tr>` : ''}<tr><td style="padding:14px 24px;background:#F7F9FC;color:#5B6676;font-size:12px">Sent from the school's EduPro portal. Please do not reply to this mail.</td></tr></table></td></tr></table></body></html>`;
    for (const r of to.rows)
      await c.query(
        `SELECT app.queue_mail($1, $2, $3, '[]'::jsonb, jsonb_build_object('notice', $4::text), $5::bigint)`,
        [r.email, `${label}: ${x.title}`, html, id, r.user_id],
      );
    await c.query(`UPDATE notices SET emailed_at = now(), emailed_count = $2 WHERE id = $1`, [
      id,
      to.rows.length,
    ]);
  }

  /** How many students and employees a notice would reach, before it is saved (the compose screen's count). */
  async reach(ctx: RequestContext, dto: NoticeReachDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const audience = dto.kind === 'office_order' ? 'employees' : dto.audience;
    const of = (type: string) => dto.targets.filter((t) => t.type === type).map((t) => t.id);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ pupils: number; staff: number }>(
        `SELECT (SELECT count(*) FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
                  WHERE en.academic_year_id = $1 AND en.status = 'active' AND $2 IN ('everyone', 'students')
                    AND (NOT $3 OR en.class_section_id = ANY($4::bigint[]) OR cs.class_id = ANY($5::bigint[]) OR en.student_id = ANY($6::bigint[])))::int AS pupils,
                (SELECT count(*) FROM employees e
                  WHERE e.status = 'active' AND e.deleted_at IS NULL AND $2 IN ('everyone', 'employees')
                    AND (NOT $3 OR e.id = ANY($7::bigint[]) OR e.department = ANY($8::text[])
                         OR EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = e.id AND ta.class_section_id = ANY($4::bigint[]) AND ta.valid_to IS NULL)))::int AS staff`,
        [
          yearId,
          audience,
          dto.targets.length > 0 || dto.departments.length > 0,
          of('class_section'),
          of('class'),
          of('student'),
          of('employee'),
          dto.departments,
        ],
      );
      return { students: r.rows[0]!.pupils, employees: r.rows[0]!.staff };
    });
  }

  /** Notices and office orders with how far each reached: whom it is for, acknowledged, e-mailed. */
  async report(ctx: RequestContext, q: NoticeReportQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [yearId];
      const w = ['n.deleted_at IS NULL', 'n.academic_year_id = $1', 'n.published_at IS NOT NULL'];
      if (q.kind) {
        params.push(q.kind);
        w.push(`n.kind = $${String(params.length)}::notice_kind`);
      }
      if (q.from) {
        params.push(q.from);
        w.push(`n.publish_from >= $${String(params.length)}::date`);
      }
      if (q.to) {
        params.push(q.to);
        w.push(`n.publish_from <= $${String(params.length)}::date`);
      }
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w holds fixed fragments; values are bound
        `${SELECT} WHERE ${w.join(' AND ')} ORDER BY n.publish_from DESC, n.id DESC LIMIT 1000`,
        params,
      );
      const rows = [];
      for (const n of r.rows.map(toRow)) {
        const reach = await c.query<{ pupils: number; staff: number }>(
          // eslint-disable-next-line no-restricted-syntax -- constant fragments; the notice and the year are bound
          `SELECT (SELECT count(*) ${NoticesService.PUPILS})::int AS pupils, (SELECT count(*) ${NoticesService.STAFF} AND $2::bigint IS NOT NULL)::int AS staff`,
          [n.id, yearId],
        );
        rows.push({
          id: n.id,
          kind: n.kind,
          title: n.title,
          audience: n.audience,
          targets: n.targets.map((t) => t.label).join(', ') || 'All',
          publishFrom: n.publishFrom,
          publishedBy: n.publishedBy,
          students: reach.rows[0]!.pupils,
          employees: reach.rows[0]!.staff,
          ackRequired: n.ackRequired,
          acknowledged: n.ackCount,
          emailed: n.emailedCount,
          attachments: n.files.length,
        });
      }
      return { data: rows };
    });
  }

  /** The report as a file, with the school's name and address on top. */
  async reportFile(
    ctx: RequestContext,
    q: NoticeReportQueryDto,
    rows: Awaited<ReturnType<NoticesService['report']>>['data'],
    format: 'xlsx' | 'pdf',
  ) {
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const KIND: Record<string, string> = {
      notice: 'Notice',
      circular: 'Circular',
      office_order: 'Office order',
    };
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Notices and office orders',
        details: [
          q.kind ? (KIND[q.kind] ?? q.kind) : 'All kinds',
          q.from || q.to ? `From ${q.from ?? '…'} to ${q.to ?? '…'}` : '',
          generatedOn(),
        ].filter(Boolean),
        legend: `${String(rows.length)} published`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Date', width: 7 },
          { label: 'Kind', width: 7 },
          { label: 'Title', width: 22 },
          { label: 'For', width: 14 },
          { label: 'Published by', width: 10 },
          { label: 'Students', width: 5, right: true },
          { label: 'Employees', width: 5, right: true },
          { label: 'Acknowledged', width: 6, right: true },
          { label: 'E-mailed', width: 5, right: true },
        ],
        rows: rows.map((n, i) => [
          i + 1,
          n.publishFrom,
          KIND[n.kind] ?? n.kind,
          n.title,
          n.targets,
          n.publishedBy ?? '',
          n.students,
          n.employees,
          n.ackRequired ? n.acknowledged : '-',
          n.emailed ?? '-',
        ]),
        filename: `notices-${new Date().toISOString().slice(0, 10)}`,
      },
      format,
    );
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
