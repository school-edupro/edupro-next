/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (SELECT lists, WHERE pieces with numbered placeholders); every value is bound */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { FilesService } from '../../files/files.service';
import { schoolTime } from './daily-work.service';
import type {
  AckDto,
  AckStatusQueryDto,
  CreateDocumentDto,
  ListDocumentsQueryDto,
} from './daily.dto';
import { DAILY } from './daily.permissions';
import { ViewerService } from './viewer.service';

type Row = Record<string, unknown>;
export const DOCUMENT_KIND: Record<string, string> = {
  session_plan: 'Session plan',
  curriculum: 'Curriculum / syllabus',
  date_sheet: 'Date sheet',
  magazine: 'School magazine',
  almanac: 'School almanac',
  other: 'Other',
};
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** The children of the family asking (a guardian's, or the student themself). */
const MY_KIDS = `(SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE g.user_id = app.current_user_id()
                  UNION SELECT st.id FROM students st WHERE st.user_id = app.current_user_id())`;

const DOC = `SELECT d.id::text, d.kind, d.title, d.remark, d.class_section_id::text, k.code || '-' || cs.name AS section,
       d.subject_id::text, s.name AS subject, d.file_ids, d.publish_at, d.ack_required, e.display_name AS posted_by, d.created_at,
       (SELECT count(*) FROM academic_acks a WHERE a.item_type = 'document' AND a.item_id = d.id)::int AS ack_count,
       (SELECT array_agg(a.student_id::text) FROM academic_acks a WHERE a.item_type = 'document' AND a.item_id = d.id AND a.student_id IN ${MY_KIDS}) AS acked_for
  FROM academic_documents d
  LEFT JOIN class_sections cs ON cs.id = d.class_section_id
  LEFT JOIN classes k ON k.id = cs.class_id
  LEFT JOIN subjects s ON s.id = d.subject_id
  LEFT JOIN employees e ON e.id = d.posted_by_employee_id`;

const toDoc = (x: Row) => ({
  id: String(x.id),
  kind: String(x.kind),
  kindLabel: DOCUMENT_KIND[String(x.kind)] ?? String(x.kind),
  title: String(x.title),
  remark: text(x.remark),
  classSectionId: text(x.class_section_id),
  /** Null: for the whole school. */
  section: text(x.section),
  subjectId: text(x.subject_id),
  subject: text(x.subject),
  fileIds: ((x.file_ids as unknown[]) ?? []).map(String),
  publishAt: (x.publish_at as Date).toISOString(),
  scheduled: (x.publish_at as Date).getTime() > Date.now(),
  ackRequired: Boolean(x.ack_required),
  ackCount: Number(x.ack_count ?? 0),
  ackedFor: ((x.acked_for as string[] | null) ?? []).map(String),
  postedBy: text(x.posted_by),
  createdAt: (x.created_at as Date).toISOString(),
});
export type AcademicDocument = ReturnType<typeof toDoc>;

/**
 * Class documents and acknowledgements (0091). A teacher uploads a session plan, the curriculum or a
 * date sheet for the classes and subjects they hold; the office uploads for any class and for the whole
 * school (the magazine, the almanac). Each carries the time it is published. A family acknowledges an
 * item for a child when it asks for that; the teacher sees who has and who has not. The school
 * directory is the office's own list.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
    private readonly viewer: ViewerService,
    private readonly files: FilesService,
  ) {}

  async list(ctx: RequestContext, q: ListDocumentsQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.workView);
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [yearId];
      const w = ['d.deleted_at IS NULL', 'd.academic_year_id = $1'];
      if (v.sectionIds !== null) {
        params.push(v.sectionIds);
        w.push(
          `(d.class_section_id IS NULL OR d.class_section_id = ANY($${String(params.length)}::bigint[]))`,
        );
      }
      if (v.kind === 'family') w.push('d.publish_at <= now()');
      if (q.kind) {
        params.push(q.kind);
        w.push(`d.kind = $${String(params.length)}`);
      }
      if (q.classSectionId) {
        params.push(q.classSectionId);
        w.push(`(d.class_section_id IS NULL OR d.class_section_id = $${String(params.length)})`);
      }
      const r = await c.query<Row>(
        `${DOC} WHERE ${w.join(' AND ')} ORDER BY d.publish_at DESC, d.id DESC LIMIT 500`,
        params,
      );
      return {
        data: r.rows.map(toDoc),
        kinds: Object.entries(DOCUMENT_KIND).map(([value, label]) => ({ value, label })),
      };
    });
  }

  private async find(c: PoolClient, id: string): Promise<AcademicDocument> {
    const r = await c.query<Row>(`${DOC} WHERE d.id = $1 AND d.deleted_at IS NULL`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Document not found', { status: 404 });
    return toDoc(r.rows[0]);
  }

  async fileUrl(ctx: RequestContext, id: string, fileId: string) {
    const v = await this.viewer.resolve(ctx, DAILY.workView);
    const d = await this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
    if (
      (d.classSectionId && v.sectionIds !== null && !v.sectionIds.includes(d.classSectionId)) ||
      (v.kind === 'family' && d.scheduled) ||
      !d.fileIds.includes(fileId)
    )
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }

  async create(ctx: RequestContext, dto: CreateDocumentDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const scoped = (await this.scopes.filter(tenant, DAILY.workPost, 'class_section')) !== null;
    if (!dto.classSectionIds.length && (scoped || !ctx.permissions?.has(DAILY.noticeManage)))
      throw new DomainError(
        'documents.choose_class',
        'Choose the class this is for; only the office uploads for the whole school',
        { status: 403 },
      );
    for (const sectionId of dto.classSectionIds)
      await this.scopes.assert(tenant, DAILY.workPost, 'class_section', sectionId);
    await this.viewer.assertFilesReady(ctx, dto.fileIds, 'documents');
    const v = await this.viewer.resolve(ctx, DAILY.workPost);
    return this.db.tenant(tenant, async (c) => {
      const sections = await c.query(
        `SELECT 1 FROM class_sections WHERE id = ANY($1::bigint[]) AND academic_year_id = $2 AND deleted_at IS NULL`,
        [dto.classSectionIds, yearId],
      );
      if (sections.rowCount !== new Set(dto.classSectionIds).size)
        throw new DomainError('not-found', 'A class is not of this academic year');
      if (scoped)
        // a subject teacher uploads for the subjects mapped to them in the class
        for (const sectionId of dto.classSectionIds) {
          const mine = await c.query<{ any: boolean; ids: string[] | null }>(
            `SELECT COALESCE(bool_or(ta.kind IN ('class_teacher', 'coordinator')), false) AS any,
                    array_agg(ta.subject_id::text) FILTER (WHERE ta.subject_id IS NOT NULL) AS ids
               FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
              WHERE e.user_id = app.current_user_id() AND ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL`,
            [sectionId, yearId],
          );
          const m = mine.rows[0];
          if (
            m &&
            !m.any &&
            (m.ids ?? []).length &&
            (!dto.subjectId || !(m.ids ?? []).includes(dto.subjectId))
          )
            throw new DomainError(
              'daily.subject_not_assigned',
              'Choose one of the subjects you teach in this class',
              { status: 403 },
            );
        }
      const ids: string[] = [];
      for (const sectionId of dto.classSectionIds.length ? dto.classSectionIds : [null]) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO academic_documents (school_id, academic_year_id, kind, title, remark, class_section_id, subject_id, file_ids, publish_at, ack_required,
                                           posted_by_employee_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, now()), $9, $10, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            yearId,
            dto.kind,
            dto.title,
            dto.remark ?? null,
            sectionId,
            dto.subjectId ?? null,
            JSON.stringify(dto.fileIds),
            schoolTime(dto.publishAt),
            dto.ackRequired,
            v.employeeId,
          ],
        );
        ids.push(r.rows[0]!.id);
      }
      await this.audit.stage(ctx, c, {
        action: 'academics.document.post',
        entityType: 'academic_documents',
        entityId: ids[0]!,
        after: { kind: dto.kind, title: dto.title, sections: dto.classSectionIds.length },
      });
      return { created: ids.length, data: await Promise.all(ids.map((id) => this.find(c, id))) };
    });
  }

  async remove(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const d = await this.db.tenant(tenant, (c) => this.find(c, id));
    if (d.classSectionId)
      await this.scopes.assert(tenant, DAILY.workPost, 'class_section', d.classSectionId);
    else if (!ctx.permissions?.has(DAILY.noticeManage))
      throw new DomainError('forbidden', 'Only the office removes a school-wide document', {
        status: 403,
      });
    await this.db.tenant(tenant, async (c) => {
      await c.query(
        `UPDATE academic_documents SET deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'academics.document.delete',
        entityType: 'academic_documents',
        entityId: id,
        before: d,
      });
    });
  }

  // ---- acknowledgements -----------------------------------------------------------------------------
  /** A family acknowledges an item for a child; an employee acknowledges an office order. */
  async ack(ctx: RequestContext, dto: AckDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(
      ctx,
      dto.type === 'notice' ? DAILY.noticeView : DAILY.workView,
    );
    const child = dto.studentId ? v.students.find((s) => s.id === dto.studentId) : undefined;
    if (v.kind === 'family' && !child)
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    if (v.kind !== 'family' && dto.type !== 'notice')
      throw new DomainError('forbidden', 'Only the family acknowledges this', { status: 403 });
    return this.db.tenant(tenant, async (c) => {
      const sectionId = child?.classSectionId ?? null;
      const ok =
        dto.type === 'daily_work'
          ? await c.query(
              `SELECT 1 FROM daily_work w WHERE w.id = $1 AND w.deleted_at IS NULL AND w.ack_required AND w.publish_at <= now() AND w.class_section_id = $2`,
              [dto.id, sectionId],
            )
          : dto.type === 'document'
            ? await c.query(
                `SELECT 1 FROM academic_documents d WHERE d.id = $1 AND d.deleted_at IS NULL AND d.ack_required AND d.publish_at <= now()
                    AND d.academic_year_id = $3 AND (d.class_section_id IS NULL OR d.class_section_id = $2)`,
                [dto.id, sectionId, yearId],
              )
            : await c.query(
                `SELECT 1 FROM notices n WHERE n.id = $1 AND n.deleted_at IS NULL AND n.ack_required AND n.published_at IS NOT NULL
                    AND COALESCE(n.publish_at, n.published_at) <= now()
                    AND (($2::bigint IS NOT NULL AND n.audience IN ('everyone', 'students')) OR ($2::bigint IS NULL AND n.audience IN ('everyone', 'employees')))`,
                [dto.id, child ? child.id : null],
              );
      if (!ok.rowCount)
        throw new DomainError('not-found', 'Nothing to acknowledge here', { status: 404 });
      await c.query(
        `INSERT INTO academic_acks (school_id, item_type, item_id, student_id, staff_user_id, acked_by)
         VALUES (app.current_school_id(), $1, $2, $3, CASE WHEN $3::bigint IS NULL THEN app.current_user_id() END, app.current_user_id())
         ON CONFLICT DO NOTHING`,
        [dto.type, dto.id, child ? child.id : null],
      );
      return { ok: true };
    });
  }

  /** Who has acknowledged and who has not: the pupils of the class, or those who answered a school-wide item. */
  async ackStatus(ctx: RequestContext, q: AckStatusQueryDto) {
    const tenant = requireTenant(ctx);
    if (!ctx.permissions?.has(DAILY.workPost) && !ctx.permissions?.has(DAILY.noticeManage))
      throw new DomainError('forbidden', 'Not part of your role', { status: 403 });
    const head = await this.db.tenant(tenant, async (c) => {
      const r =
        q.type === 'daily_work'
          ? await c.query<Row>(
              `SELECT w.title, w.class_section_id::text AS section_id, k.code || '-' || cs.name AS section, w.academic_year_id::text AS year_id, w.ack_required
                 FROM daily_work w JOIN class_sections cs ON cs.id = w.class_section_id JOIN classes k ON k.id = cs.class_id WHERE w.id = $1 AND w.deleted_at IS NULL`,
              [q.id],
            )
          : q.type === 'document'
            ? await c.query<Row>(
                `SELECT d.title, d.class_section_id::text AS section_id, k.code || '-' || cs.name AS section, d.academic_year_id::text AS year_id, d.ack_required
                   FROM academic_documents d LEFT JOIN class_sections cs ON cs.id = d.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
                  WHERE d.id = $1 AND d.deleted_at IS NULL`,
                [q.id],
              )
            : await c.query<Row>(
                `SELECT n.title, NULL::text AS section_id, NULL::text AS section, n.academic_year_id::text AS year_id, n.ack_required FROM notices n WHERE n.id = $1 AND n.deleted_at IS NULL`,
                [q.id],
              );
      if (!r.rows[0]) throw new DomainError('not-found', 'Not found', { status: 404 });
      return r.rows[0];
    });
    if (head.section_id)
      await this.scopes.assert(tenant, DAILY.workPost, 'class_section', String(head.section_id));
    else if (!ctx.permissions?.has(DAILY.noticeManage))
      throw new DomainError('forbidden', 'Only the office sees the answers to a school-wide item', {
        status: 403,
      });
    return this.db.tenant(tenant, async (c) => {
      const rows = head.section_id
        ? await c.query<Row>(
            `SELECT s.id::text, s.display_name AS name, s.admission_no, en.roll_no, a.acked_at,
                    COALESCE((SELECT g.display_name FROM guardians g WHERE g.user_id = a.acked_by LIMIT 1), u.display_name) AS by_name
               FROM enrolments en JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
               LEFT JOIN academic_acks a ON a.item_type = $1 AND a.item_id = $2 AND a.student_id = s.id
               LEFT JOIN users u ON u.id = a.acked_by
              WHERE en.class_section_id = $3 AND en.academic_year_id = $4 AND en.status = 'active'
              ORDER BY en.roll_no NULLS LAST, s.display_name`,
            [q.type, q.id, head.section_id, head.year_id],
          )
        : await c.query<Row>(
            `SELECT COALESCE(s.id, 0)::text AS id, COALESCE(s.display_name, (SELECT e.display_name FROM employees e WHERE e.user_id = a.staff_user_id LIMIT 1), u.display_name) AS name,
                    s.admission_no, NULL::int AS roll_no, a.acked_at,
                    COALESCE((SELECT g.display_name FROM guardians g WHERE g.user_id = a.acked_by LIMIT 1), u.display_name) AS by_name
               FROM academic_acks a LEFT JOIN students s ON s.id = a.student_id LEFT JOIN users u ON u.id = a.acked_by
              WHERE a.item_type = $1 AND a.item_id = $2 ORDER BY a.acked_at`,
            [q.type, q.id],
          );
      const data = rows.rows.map((x) => ({
        id: String(x.id),
        name: String(x.name ?? ''),
        admissionNo: text(x.admission_no),
        rollNo: x.roll_no === null ? null : Number(x.roll_no),
        ackedAt: x.acked_at instanceof Date ? x.acked_at.toISOString() : null,
        by: text(x.by_name),
      }));
      return {
        title: String(head.title),
        section: text(head.section),
        ackRequired: Boolean(head.ack_required),
        /** A class item lists every pupil; a school-wide one lists only those who answered. */
        roster: Boolean(head.section_id),
        acknowledged: data.filter((x) => x.ackedAt).length,
        total: data.length,
        data,
      };
    });
  }

  /**
   * The academics dashboard for the session: what is set up and what is missing, the posts of the last
   * 14 days, the acknowledgements asked and received, what is scheduled, and what is coming up.
   */
  async dashboard(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.workView);
    return this.db.tenant(tenant, async (c) => {
      const scope = v.sectionIds;
      const k = await c.query<Row>(
        `SELECT (SELECT count(*) FROM classes WHERE deleted_at IS NULL AND status = 'active')::int AS classes,
                (SELECT count(*) FROM class_sections cs WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($2::bigint[] IS NULL OR cs.id = ANY($2)))::int AS sections,
                (SELECT count(*) FROM subjects WHERE deleted_at IS NULL AND status = 'active')::int AS subjects,
                (SELECT count(*) FROM class_sections cs WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($2::bigint[] IS NULL OR cs.id = ANY($2))
                    AND NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_section_id = cs.id AND ta.kind = 'class_teacher' AND ta.is_actual AND ta.valid_to IS NULL))::int AS no_class_teacher,
                (SELECT count(*) FROM class_sections cs JOIN class_subjects x ON x.class_id = cs.class_id AND x.academic_year_id = cs.academic_year_id
                  WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($2::bigint[] IS NULL OR cs.id = ANY($2))
                    AND NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_section_id = cs.id AND ta.subject_id = x.subject_id AND ta.valid_to IS NULL))::int AS no_subject_teacher,
                (SELECT count(*) FROM daily_work w WHERE w.academic_year_id = $1 AND w.deleted_at IS NULL AND w.created_at >= now() - interval '7 days' AND ($2::bigint[] IS NULL OR w.class_section_id = ANY($2)))::int AS posts_week,
                (SELECT count(*) FROM daily_work w WHERE w.academic_year_id = $1 AND w.deleted_at IS NULL AND w.publish_at > now() AND ($2::bigint[] IS NULL OR w.class_section_id = ANY($2)))::int
                  + (SELECT count(*) FROM academic_documents d WHERE d.academic_year_id = $1 AND d.deleted_at IS NULL AND d.publish_at > now() AND ($2::bigint[] IS NULL OR d.class_section_id IS NULL OR d.class_section_id = ANY($2)))::int AS scheduled,
                (SELECT count(*) FROM academic_documents d WHERE d.academic_year_id = $1 AND d.deleted_at IS NULL AND ($2::bigint[] IS NULL OR d.class_section_id IS NULL OR d.class_section_id = ANY($2)))::int AS documents,
                (SELECT count(*) FROM notices n WHERE n.academic_year_id = $1 AND n.deleted_at IS NULL AND n.published_at >= date_trunc('month', now()))::int AS notices_month`,
        [yearId, scope],
      );
      const days = await c.query<Row>(
        `SELECT to_char(g, 'YYYY-MM-DD') AS d,
                (SELECT count(*) FROM daily_work w WHERE w.academic_year_id = $1 AND w.deleted_at IS NULL AND w.assigned_on = g::date AND w.kind = 'homework' AND ($2::bigint[] IS NULL OR w.class_section_id = ANY($2)))::int AS homework,
                (SELECT count(*) FROM daily_work w WHERE w.academic_year_id = $1 AND w.deleted_at IS NULL AND w.assigned_on = g::date AND w.kind = 'classwork' AND ($2::bigint[] IS NULL OR w.class_section_id = ANY($2)))::int AS classwork,
                (SELECT count(*) FROM daily_work w WHERE w.academic_year_id = $1 AND w.deleted_at IS NULL AND w.assigned_on = g::date AND w.kind = 'assignment' AND ($2::bigint[] IS NULL OR w.class_section_id = ANY($2)))::int AS assignment
           FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 13, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') g ORDER BY 1`,
        [yearId, scope],
      );
      const quiet = await c.query<Row>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS section,
                (SELECT max(w.assigned_on)::text FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL) AS last_on,
                (SELECT e.display_name FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
                  WHERE ta.class_section_id = cs.id AND ta.kind = 'class_teacher' AND ta.is_actual AND ta.valid_to IS NULL LIMIT 1) AS teacher
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($2::bigint[] IS NULL OR cs.id = ANY($2))
            AND NOT EXISTS (SELECT 1 FROM daily_work w WHERE w.class_section_id = cs.id AND w.deleted_at IS NULL AND w.assigned_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 6)
          ORDER BY k.display_order, cs.name LIMIT 60`,
        [yearId, scope],
      );
      const acks = await c.query<Row>(
        `SELECT * FROM (
           SELECT 'daily_work' AS type, w.id::text, w.title, k.code || '-' || cs.name AS section, w.publish_at,
                  (SELECT count(*) FROM enrolments en WHERE en.class_section_id = w.class_section_id AND en.academic_year_id = $1 AND en.status = 'active')::int AS asked,
                  (SELECT count(*) FROM academic_acks a WHERE a.item_type = 'daily_work' AND a.item_id = w.id)::int AS got
             FROM daily_work w JOIN class_sections cs ON cs.id = w.class_section_id JOIN classes k ON k.id = cs.class_id
            WHERE w.academic_year_id = $1 AND w.deleted_at IS NULL AND w.ack_required AND w.publish_at <= now() AND w.publish_at >= now() - interval '30 days'
              AND ($2::bigint[] IS NULL OR w.class_section_id = ANY($2))
           UNION ALL
           SELECT 'document', d.id::text, d.title, k.code || '-' || cs.name, d.publish_at,
                  (SELECT count(*) FROM enrolments en WHERE en.class_section_id = d.class_section_id AND en.academic_year_id = $1 AND en.status = 'active')::int,
                  (SELECT count(*) FROM academic_acks a WHERE a.item_type = 'document' AND a.item_id = d.id)::int
             FROM academic_documents d JOIN class_sections cs ON cs.id = d.class_section_id JOIN classes k ON k.id = cs.class_id
            WHERE d.academic_year_id = $1 AND d.deleted_at IS NULL AND d.ack_required AND d.publish_at <= now() AND d.publish_at >= now() - interval '30 days'
              AND ($2::bigint[] IS NULL OR d.class_section_id = ANY($2))) x
          ORDER BY publish_at DESC LIMIT 12`,
        [yearId, scope],
      );
      const coming = await c
        .query<Row>(
          `SELECT * FROM (
           SELECT 'Holiday' AS what, h.name AS title, h.starts_on::text AS on_date FROM holidays h WHERE h.academic_year_id = $1 AND h.ends_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date
           UNION ALL
           SELECT initcap(e.kind::text), e.title, e.starts_on::text FROM almanac_events e WHERE e.academic_year_id = $1 AND e.starts_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date AND e.deleted_at IS NULL) x
          ORDER BY on_date LIMIT 8`,
          [yearId],
        )
        .catch(() => ({ rows: [] as Row[] }));
      const x = k.rows[0]!;
      return {
        scoped: scope !== null,
        counts: {
          classes: Number(x.classes),
          sections: Number(x.sections),
          subjects: Number(x.subjects),
          noClassTeacher: Number(x.no_class_teacher),
          noSubjectTeacher: Number(x.no_subject_teacher),
          postsWeek: Number(x.posts_week),
          scheduled: Number(x.scheduled),
          documents: Number(x.documents),
          noticesMonth: Number(x.notices_month),
        },
        days: days.rows.map((d) => ({
          date: String(d.d),
          homework: Number(d.homework),
          classwork: Number(d.classwork),
          assignment: Number(d.assignment),
        })),
        quiet: quiet.rows.map((q) => ({
          id: String(q.id),
          section: String(q.section),
          lastOn: text(q.last_on),
          teacher: text(q.teacher),
        })),
        acks: acks.rows.map((a) => ({
          type: String(a.type),
          id: String(a.id),
          title: String(a.title),
          section: String(a.section),
          asked: Number(a.asked),
          got: Number(a.got),
        })),
        coming: coming.rows.map((e) => ({
          what: String(e.what),
          title: String(e.title),
          date: String(e.on_date),
        })),
      };
    });
  }

  /** The school directory as the families see it: the active entries under their headings. */
  async directory(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT heading, name, designation, phone, email, timings, note FROM school_directory WHERE status = 'active' ORDER BY sort_order, heading, name`,
      );
      return {
        data: r.rows.map((x) => ({
          heading: String(x.heading),
          name: String(x.name),
          designation: text(x.designation),
          phone: text(x.phone),
          email: text(x.email),
          timings: text(x.timings),
          note: text(x.note),
        })),
      };
    });
  }
}
