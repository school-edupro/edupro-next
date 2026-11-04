import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, Sheet } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { registerPdf, registerXlsx } from './mark-register-file';
import { registerGeneratedOn, registerLetterhead, registerLogo } from './register-head';
import { followSubjectMarks } from './subject-marks-follow';
import type {
  CopySubjectMarksDto,
  SaveSubjectMarksDto,
  SubjectMarksFileDto,
} from './subject-marks.dto';

export interface SubjectMarksRow {
  subjectId: string;
  code: string;
  name: string;
  max: number;
  pass: number | null;
  scaleId: string | null;
  scaleCode: string | null;
  optional: boolean;
  /** the subject above it in the subject master (Social Science over Geography) */
  parentId: string | null;
  /** a part of that subject (0303): entered as its part, not a paper of its own */
  isPart: boolean;
}
type Line = SaveSubjectMarksDto['rows'][number];
const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * The subject marks master (docs/design/70, part 1), as the legacy's Subject Master: for each exam type
 * and class of the year, the subjects its exams hold with the maximum and pass marks, a grade-only
 * subject's scale and Optional. Kept per year; copied to other classes (the subjects each studies) or
 * exam types, filled from an exam already set up, or from last year. Exams read it (part 2).
 */
@Injectable()
export class SubjectMarksService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private year(ctx: RequestContext): string {
    const id = requireTenant(ctx).academicYearId;
    if (!id)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return id;
  }

  /** Every exam type × class of the year: how many subjects are set. */
  async overview(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const types = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM exam_types WHERE deleted_at IS NULL AND status = 'active' ORDER BY sort_order, code`,
      );
      const classes = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM classes WHERE deleted_at IS NULL ORDER BY display_order, code`,
      );
      const cells = await c.query<{ type_id: string; class_id: string; n: number }>(
        `SELECT exam_type_id::text AS type_id, class_id::text, count(*)::int AS n
           FROM exam_type_subjects WHERE academic_year_id = $1 GROUP BY 1, 2`,
        [yearId],
      );
      return {
        types: types.rows,
        classes: classes.rows,
        cells: cells.rows.map((x) => ({ typeId: x.type_id, classId: x.class_id, subjects: x.n })),
      };
    });
  }

  private async rows(c: PoolClient, yearId: string, typeId: string, classId: string) {
    const r = await c.query<{
      subject_id: string;
      code: string;
      name: string;
      max: string;
      pass: string | null;
      scale_id: string | null;
      scale_code: string | null;
      optional: boolean;
      parent_id: string | null;
      is_part: boolean;
    }>(
      `SELECT m.subject_id::text, s.code, s.name, m.max_marks::text AS max, m.pass_marks::text AS pass,
              m.grade_scale_id::text AS scale_id, g.code AS scale_code, m.is_optional AS optional,
              s.parent_id::text, m.is_part
         FROM exam_type_subjects m JOIN subjects s ON s.id = m.subject_id
         LEFT JOIN grade_scales g ON g.id = m.grade_scale_id
        WHERE m.academic_year_id = $1 AND m.exam_type_id = $2 AND m.class_id = $3
        ORDER BY app.subject_seq($3, $1, m.subject_id), s.code`,
      [yearId, typeId, classId],
    );
    return r.rows.map((x): SubjectMarksRow => ({
      subjectId: x.subject_id,
      code: x.code,
      name: x.name,
      max: Number(x.max),
      pass: num(x.pass),
      scaleId: x.scale_id,
      scaleCode: x.scale_code,
      optional: x.optional,
      parentId: x.parent_id,
      isPart: x.is_part,
    }));
  }

  /** The class's subjects the type holds; the subjects the class studies that could be added. */
  async get(ctx: RequestContext, typeId: string, classId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const type = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM exam_types WHERE id = $1 AND deleted_at IS NULL`,
        [typeId],
      );
      const klass = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM classes WHERE id = $1 AND deleted_at IS NULL`,
        [classId],
      );
      if (!type.rows[0] || !klass.rows[0])
        throw new DomainError('not-found', 'Exam type or class not found', { status: 404 });
      const rows = await this.rows(c, yearId, typeId, classId);
      const studied = await c.query<{
        id: string;
        code: string;
        name: string;
        elective: boolean;
        parentId: string | null;
      }>(
        `SELECT s.id::text, s.code, s.name, cs.is_elective AS elective, s.parent_id::text AS "parentId"
           FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
          WHERE cs.class_id = $1 AND cs.academic_year_id = $2 AND cs.status = 'active'
          ORDER BY app.subject_seq($1, $2, s.id), s.code`,
        [classId, yearId],
      );
      const last = await c.query<{ at: Date; by: string | null }>(
        `SELECT m.updated_at AS at, u.display_name AS by FROM exam_type_subjects m LEFT JOIN users u ON u.id = m.updated_by
          WHERE m.academic_year_id = $1 AND m.exam_type_id = $2 AND m.class_id = $3 ORDER BY m.updated_at DESC LIMIT 1`,
        [yearId, typeId, classId],
      );
      return {
        type: type.rows[0],
        class: klass.rows[0],
        rows,
        /** the subjects the class studies this year (Class and subject mapping), in the class order */
        studied: studied.rows,
        updatedAt: last.rows[0]?.at.toISOString() ?? null,
        updatedBy: last.rows[0]?.by ?? null,
      };
    });
  }

  /** what a row may be: marks with an optional pass mark, or grade-only (maximum 0) with a scale */
  private check(rows: SaveSubjectMarksDto['rows']) {
    for (const r of rows) {
      if (r.max === 0 && !r.scaleId)
        throw new DomainError(
          'validation-failed',
          'A subject with no marks (maximum 0) is graded: choose its grade scale',
          { status: 400 },
        );
      if (r.max === 0 && r.pass !== null)
        throw new DomainError('validation-failed', 'A grade-only subject has no pass marks', {
          status: 400,
        });
      if (r.pass !== null && r.pass > r.max)
        throw new DomainError('validation-failed', 'A pass mark is above its maximum', {
          status: 400,
        });
    }
    if (new Set(rows.map((r) => r.subjectId)).size !== rows.length)
      throw new DomainError('validation-failed', 'A subject is there twice', { status: 400 });
  }

  /**
   * The part lines of a list (0303): each under a subject of the list (its parent in the subject master)
   * that is a paper with marks, with a maximum and nothing else of its own; a subject's parts add up to
   * its maximum. Null when the list is right, else what is wrong.
   */
  private partsProblem(
    rows: Array<Line & { code: string; parentId: string | null }>,
  ): string | null {
    const by = new Map(rows.map((r) => [r.subjectId, r]));
    for (const r of rows.filter((x) => x.isPart)) {
      const p = r.parentId ? by.get(r.parentId) : undefined;
      if (!r.parentId)
        return `${r.code} has no subject above it in the subject master: it can't be a part`;
      if (!p || p.isPart) return `${r.code} is a part: its subject must be in the list as a paper`;
      if (r.max <= 0) return `${r.code} is a part: give it a maximum`;
      if (r.pass !== null || r.scaleId || r.optional)
        return `${r.code} is a part: its subject's pass marks, scale and Optional are for the total`;
    }
    for (const p of rows) {
      const parts = rows.filter((x) => x.isPart && x.parentId === p.subjectId);
      if (!parts.length) continue;
      const sum = parts.reduce((a, x) => a + Math.round(x.max * 100), 0) / 100;
      if (sum !== p.max)
        return `The parts of ${p.code} (${parts.map((x) => `${x.code} ${String(x.max)}`).join(' + ')}) add up to ${String(sum)}, not its maximum of ${String(p.max)}`;
    }
    return null;
  }

  /** a list as saved: its part lines must still be right (after a copy into it) */
  private async assertParts(
    c: PoolClient,
    yearId: string,
    typeId: string,
    classId: string,
    to: string,
  ) {
    const bad = this.partsProblem(await this.rows(c, yearId, typeId, classId));
    if (bad) throw new DomainError('exams.subject_marks_parts', `${to}: ${bad}`, { status: 409 });
  }

  /** a subject's parts are the ones copied or filled: the list's other parts of it go */
  private async keepOnlyParts(
    c: PoolClient,
    yearId: string,
    typeId: string,
    classId: string,
    parentIds: string[],
    keep: string[],
  ) {
    if (!parentIds.length) return;
    await c.query(
      `DELETE FROM exam_type_subjects m USING subjects s
        WHERE s.id = m.subject_id AND m.academic_year_id = $1 AND m.exam_type_id = $2 AND m.class_id = $3
          AND m.is_part AND s.parent_id = ANY($4::bigint[]) AND NOT (m.subject_id = ANY($5::bigint[]))`,
      [yearId, typeId, classId, parentIds, keep],
    );
  }

  private async upsert(c: PoolClient, yearId: string, typeId: string, classId: string, r: Line) {
    await c.query(
      `INSERT INTO exam_type_subjects (school_id, academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, is_part, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, app.current_user_id())
       ON CONFLICT (academic_year_id, exam_type_id, class_id, subject_id) DO UPDATE
          SET max_marks = EXCLUDED.max_marks, pass_marks = EXCLUDED.pass_marks, grade_scale_id = EXCLUDED.grade_scale_id,
              is_optional = EXCLUDED.is_optional, is_part = EXCLUDED.is_part, updated_by = EXCLUDED.updated_by, updated_at = now()
        WHERE (exam_type_subjects.max_marks, exam_type_subjects.pass_marks, exam_type_subjects.grade_scale_id, exam_type_subjects.is_optional, exam_type_subjects.is_part)
              IS DISTINCT FROM (EXCLUDED.max_marks, EXCLUDED.pass_marks, EXCLUDED.grade_scale_id, EXCLUDED.is_optional, EXCLUDED.is_part)`,
      [yearId, typeId, classId, r.subjectId, r.max, r.pass, r.scaleId, r.optional, r.isPart],
    );
  }

  /** Saves a type × class list as a whole: the rows given, and no others. */
  async save(ctx: RequestContext, dto: SaveSubjectMarksDto) {
    const yearId = this.year(ctx);
    this.check(dto.rows);
    const followed = await this.db.tenant(requireTenant(ctx), async (c) => {
      const ok = await c.query(
        `SELECT 1 FROM exam_types WHERE id = $1 AND deleted_at IS NULL
          UNION ALL SELECT 1 FROM classes WHERE id = $2 AND deleted_at IS NULL`,
        [dto.typeId, dto.classId],
      );
      if (ok.rows.length !== 2)
        throw new DomainError('not-found', 'Exam type or class not found', { status: 404 });
      const subj = await c.query<{ id: string; code: string; parent_id: string | null }>(
        `SELECT id::text, code, parent_id::text FROM subjects WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [dto.rows.map((r) => r.subjectId)],
      );
      if (subj.rows.length !== dto.rows.length)
        throw new DomainError('validation-failed', 'A subject is not of this school', {
          status: 400,
        });
      const of = new Map(subj.rows.map((x) => [x.id, x]));
      const bad = this.partsProblem(
        dto.rows.map((r) => ({
          ...r,
          code: of.get(r.subjectId)!.code,
          parentId: of.get(r.subjectId)!.parent_id,
        })),
      );
      if (bad) throw new DomainError('exams.subject_marks_parts', bad, { status: 400 });
      const scales = [...new Set(dto.rows.map((r) => r.scaleId).filter((x): x is string => !!x))];
      const sc = await c.query(`SELECT 1 FROM grade_scales WHERE id = ANY($1::bigint[])`, [scales]);
      if (sc.rows.length !== scales.length)
        throw new DomainError('validation-failed', 'A grade scale is not of this school', {
          status: 400,
        });
      const before = await this.rows(c, yearId, dto.typeId, dto.classId);
      await c.query(
        `DELETE FROM exam_type_subjects WHERE academic_year_id = $1 AND exam_type_id = $2 AND class_id = $3
            AND NOT (subject_id = ANY($4::bigint[]))`,
        [yearId, dto.typeId, dto.classId, dto.rows.map((r) => r.subjectId)],
      );
      for (const r of dto.rows) await this.upsert(c, yearId, dto.typeId, dto.classId, r);
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_marks.save',
        entityType: 'exam_type_subjects',
        entityId: `${dto.typeId}:${dto.classId}`,
        before: { rows: before.map((x) => [x.code, x.max, x.pass, ...(x.isPart ? ['part'] : [])]) },
        after: { rows: dto.rows.length },
      });
      // the exams of the type follow where no mark is entered yet (docs/design/70, part 2)
      return followSubjectMarks(c, { yearId, typeId: dto.typeId, classIds: [dto.classId] });
    });
    return { ...(await this.get(ctx, dto.typeId, dto.classId)), followed };
  }

  /**
   * Copies a type × class list: to other classes of the same type (only the subjects each class studies;
   * the rest are listed as left out) and to other exam types of the same class. A subject already in
   * the target takes the copied marks; the target's other subjects stay.
   */
  async copy(ctx: RequestContext, dto: CopySubjectMarksDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const src = await this.rows(c, yearId, dto.typeId, dto.classId);
      if (!src.length)
        throw new DomainError('exams.subject_marks_empty', 'This list has no subjects to copy', {
          status: 409,
        });
      const asRow = (x: SubjectMarksRow): Line => ({
        subjectId: x.subjectId,
        max: x.max,
        pass: x.pass,
        scaleId: x.scaleId,
        optional: x.optional,
        isPart: x.isPart,
      });
      // a subject copied takes its parts with it: the target's other parts of it go
      const parents = src.filter((x) => !x.isPart).map((x) => x.subjectId);
      const into = async (typeId: string, classId: string, rows: SubjectMarksRow[], to: string) => {
        for (const x of rows) await this.upsert(c, yearId, typeId, classId, asRow(x));
        await this.keepOnlyParts(
          c,
          yearId,
          typeId,
          classId,
          parents.filter((p) => rows.some((x) => x.subjectId === p)),
          rows.filter((x) => x.isPart).map((x) => x.subjectId),
        );
        await this.assertParts(c, yearId, typeId, classId, to);
      };
      const out: Array<{ to: string; copied: number; left: string[] }> = [];
      const classes = await c.query<{ id: string; code: string; studied: string[] }>(
        `SELECT k.id::text, k.code,
                ARRAY(SELECT cs.subject_id::text FROM class_subjects cs
                       WHERE cs.class_id = k.id AND cs.academic_year_id = $2 AND cs.status = 'active') AS studied
           FROM classes k WHERE k.id = ANY($1::bigint[]) AND k.deleted_at IS NULL`,
        [dto.toClassIds.filter((x) => x !== dto.classId), yearId],
      );
      for (const k of classes.rows) {
        // what the class studies; a part only with its subject
        const studies = (x: SubjectMarksRow) =>
          k.studied.includes(x.subjectId) &&
          (!x.isPart || (!!x.parentId && k.studied.includes(x.parentId)));
        const take = src.filter(studies);
        await into(dto.typeId, k.id, take, k.code);
        out.push({
          to: k.code,
          copied: take.length,
          left: src.filter((x) => !studies(x)).map((x) => x.code),
        });
      }
      const types = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM exam_types WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [dto.toTypeIds.filter((x) => x !== dto.typeId)],
      );
      for (const t of types.rows) {
        await into(t.id, dto.classId, src, t.code);
        out.push({ to: t.code, copied: src.length, left: [] });
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_marks.copy',
        entityType: 'exam_type_subjects',
        entityId: `${dto.typeId}:${dto.classId}`,
        after: { to: out },
      });
      let followed = 0;
      if (classes.rows.length)
        followed += await followSubjectMarks(c, {
          yearId,
          typeId: dto.typeId,
          classIds: classes.rows.map((k) => k.id),
        });
      for (const t of types.rows)
        followed += await followSubjectMarks(c, { yearId, typeId: t.id, classIds: [dto.classId] });
      return { data: out, followed };
    });
  }

  /**
   * Fills the master of an exam's type from the exam's own subjects, class by class. A paper entered in
   * parts by its sub-subjects (one part each, adding up to it) gives those as part lines; the master's
   * other parts of a paper the exam holds go.
   */
  async fillFromExam(ctx: RequestContext, examId: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ex = await c.query<{ type_id: string; code: string }>(
        `SELECT exam_type_id::text AS type_id, code FROM exams WHERE id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
        [examId, yearId],
      );
      if (!ex.rows[0])
        throw new DomainError('not-found', 'Exam not found in the working year', { status: 404 });
      const r = await c.query<{ class_id: string; code: string; n: number }>(
        `WITH up AS (
           INSERT INTO exam_type_subjects (school_id, academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, updated_by)
           SELECT app.current_school_id(), $2, $3, es.class_id, es.subject_id, es.max_marks,
                  CASE WHEN es.max_marks > 0 THEN es.pass_marks END,
                  CASE WHEN es.max_marks > 0 THEN es.grade_scale_id ELSE COALESCE(es.grade_scale_id, ec.grade_scale_id) END,
                  es.is_elective, app.current_user_id()
             FROM exam_subjects es JOIN exam_classes ec ON ec.exam_id = es.exam_id AND ec.class_id = es.class_id
            WHERE es.exam_id = $1 AND (es.max_marks > 0 OR COALESCE(es.grade_scale_id, ec.grade_scale_id) IS NOT NULL)
           ON CONFLICT (academic_year_id, exam_type_id, class_id, subject_id) DO UPDATE
              SET max_marks = EXCLUDED.max_marks, pass_marks = EXCLUDED.pass_marks, grade_scale_id = EXCLUDED.grade_scale_id,
                  is_optional = EXCLUDED.is_optional, is_part = false, updated_by = EXCLUDED.updated_by, updated_at = now()
           RETURNING class_id)
         SELECT up.class_id::text, k.code, count(*)::int AS n FROM up JOIN classes k ON k.id = up.class_id
          GROUP BY 1, 2, k.display_order ORDER BY k.display_order`,
        [examId, yearId, ex.rows[0].type_id],
      );
      const parts = await c.query<{ key: string }>(
        `INSERT INTO exam_type_subjects (school_id, academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, is_part, updated_by)
         SELECT app.current_school_id(), $2, $3, es.class_id, p.subject_id, p.max_marks, NULL, NULL, false, true, app.current_user_id()
           FROM exam_subject_parts p JOIN exam_subjects es ON es.id = p.exam_subject_id
          WHERE es.exam_id = $1 AND es.max_marks > 0
            AND NOT EXISTS (SELECT 1 FROM exam_subject_parts q LEFT JOIN subjects qs ON qs.id = q.subject_id
                             WHERE q.exam_subject_id = es.id AND qs.parent_id IS DISTINCT FROM es.subject_id)
            AND (SELECT count(DISTINCT q.subject_id) = count(*) AND sum(q.max_marks) = es.max_marks
                   FROM exam_subject_parts q WHERE q.exam_subject_id = es.id)
            AND NOT EXISTS (SELECT 1 FROM exam_subjects x WHERE x.exam_id = es.exam_id AND x.class_id = es.class_id
                             AND x.subject_id = p.subject_id)
         ON CONFLICT (academic_year_id, exam_type_id, class_id, subject_id) DO UPDATE
            SET max_marks = EXCLUDED.max_marks, pass_marks = NULL, grade_scale_id = NULL, is_optional = false, is_part = true,
                updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING class_id::text || ':' || subject_id::text AS key`,
        [examId, yearId, ex.rows[0].type_id],
      );
      await c.query(
        `DELETE FROM exam_type_subjects m USING subjects s, exam_subjects es
          WHERE s.id = m.subject_id AND es.exam_id = $1 AND es.class_id = m.class_id AND s.parent_id = es.subject_id
            AND m.academic_year_id = $2 AND m.exam_type_id = $3 AND m.is_part
            AND NOT (m.class_id::text || ':' || m.subject_id::text = ANY($4::text[]))`,
        [examId, yearId, ex.rows[0].type_id, parts.rows.map((x) => x.key)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_marks.fill',
        entityType: 'exam_type_subjects',
        entityId: ex.rows[0].type_id,
        after: { from: ex.rows[0].code, classes: r.rows.length, parts: parts.rows.length },
      });
      return {
        typeId: ex.rows[0].type_id,
        data: r.rows.map((x) => ({ classId: x.class_id, code: x.code, subjects: x.n })),
        followed: await followSubjectMarks(c, { yearId, typeId: ex.rows[0].type_id }),
      };
    });
  }

  /** Starts the year from last year's lists (every exam type, or one), keeping what is set already. */
  async fromLastYear(ctx: RequestContext, typeId?: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const prev = await c.query<{ id: string; code: string }>(
        `SELECT p.id::text, p.code FROM academic_years p JOIN academic_years y ON y.id = $1
          WHERE p.start_date < y.start_date ORDER BY p.start_date DESC LIMIT 1`,
        [yearId],
      );
      if (!prev.rows[0])
        throw new DomainError('exams.subject_marks_no_year', 'There is no earlier year', {
          status: 409,
        });
      const r = await c.query(
        `INSERT INTO exam_type_subjects (school_id, academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, is_part, updated_by)
         SELECT school_id, $1, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, is_part, app.current_user_id()
           FROM exam_type_subjects WHERE academic_year_id = $2 AND ($3::bigint IS NULL OR exam_type_id = $3::bigint)
         ON CONFLICT (academic_year_id, exam_type_id, class_id, subject_id) DO NOTHING`,
        [yearId, prev.rows[0].id, typeId ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_marks.last_year',
        entityType: 'exam_type_subjects',
        entityId: typeId ?? 'all',
        after: { from: prev.rows[0].code, added: r.rowCount ?? 0 },
      });
      return {
        from: prev.rows[0].code,
        added: r.rowCount ?? 0,
        followed: r.rowCount ? await followSubjectMarks(c, { yearId, typeId: typeId ?? null }) : 0,
      };
    });
  }

  /** An exam type's lists as one table (class, subject, maximum, pass, scale, optional, part of): Excel or PDF. */
  async file(ctx: RequestContext, q: SubjectMarksFileDto) {
    const yearId = this.year(ctx);
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      const type = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM exam_types WHERE id = $1 AND deleted_at IS NULL`,
        [q.typeId],
      );
      if (!type.rows[0]) throw new DomainError('not-found', 'Exam type not found', { status: 404 });
      const r = await c.query<{
        class: string;
        code: string;
        name: string;
        max: string;
        pass: string | null;
        scale: string | null;
        optional: boolean;
        part_of: string | null;
      }>(
        `SELECT k.name AS class, s.code, s.name, m.max_marks::text AS max, m.pass_marks::text AS pass, g.code AS scale, m.is_optional AS optional,
                CASE WHEN m.is_part THEN ps.code END AS part_of
           FROM exam_type_subjects m JOIN classes k ON k.id = m.class_id JOIN subjects s ON s.id = m.subject_id
           LEFT JOIN subjects ps ON ps.id = s.parent_id
           LEFT JOIN grade_scales g ON g.id = m.grade_scale_id
          WHERE m.academic_year_id = $1 AND m.exam_type_id = $2
          ORDER BY k.display_order, app.subject_seq(m.class_id, $1, m.subject_id), s.code`,
        [yearId, q.typeId],
      );
      return { type: type.rows[0], rows: r.rows, head: await registerLetterhead(c) };
    });
    if (!out.rows.length)
      throw new DomainError('exams.subject_marks_empty', 'No subjects are set for this exam type', {
        status: 409,
      });
    const trim = (v: string | null) => (v === null ? '' : String(Number(v)));
    const sheet: Sheet = {
      place: `${out.type.code} · ${out.type.name}`,
      head: [
        [
          { t: 'Class' },
          { t: 'Subject' },
          { t: 'Max marks', center: true },
          { t: 'Pass marks', center: true },
          { t: 'Grade scale', center: true },
          { t: 'Optional', center: true },
          { t: 'Part of', center: true },
        ],
      ],
      body: out.rows.map((x, i) => ({
        studentId: `r${String(i)}`,
        cells: [
          { t: x.class, text: true },
          { t: `${x.name} (${x.code})`, text: true },
          { t: Number(x.max) === 0 ? 'Grade only' : trim(x.max), center: true },
          { t: trim(x.pass), center: true },
          { t: x.scale ?? '', center: true },
          { t: x.optional ? 'Yes' : '', center: true },
          { t: x.part_of ?? '', center: true },
        ],
      })),
      foot: null,
      frozen: 0,
      widths: [10, 20, 6, 6, 8, 6, 6],
    };
    const meta = {
      school: out.head.school,
      address: out.head.address,
      logo: await registerLogo(this.storage, out.head.file),
      label: `Subject marks · ${out.type.code} · ${out.type.name}`,
      generatedOn: registerGeneratedOn(),
    };
    const stamp = `subject-marks-${out.type.code}`.toLowerCase().replace(/[^\w.-]+/g, '-');
    if (q.format === 'xlsx')
      return {
        filename: `${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: (await registerXlsx([sheet], meta)).toString('base64'),
      };
    return {
      filename: `${stamp}.pdf`,
      contentType: 'application/pdf',
      base64: (
        await registerPdf([sheet], meta, { paper: 'A4', orientation: 'portrait', fit: true })
      ).toString('base64'),
    };
  }
}
