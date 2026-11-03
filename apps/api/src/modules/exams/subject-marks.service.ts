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
}
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
    }>(
      `SELECT m.subject_id::text, s.code, s.name, m.max_marks::text AS max, m.pass_marks::text AS pass,
              m.grade_scale_id::text AS scale_id, g.code AS scale_code, m.is_optional AS optional
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
      const studied = await c.query<{ id: string; code: string; name: string; elective: boolean }>(
        `SELECT s.id::text, s.code, s.name, cs.is_elective AS elective
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

  private async upsert(
    c: PoolClient,
    yearId: string,
    typeId: string,
    classId: string,
    r: SaveSubjectMarksDto['rows'][number],
  ) {
    await c.query(
      `INSERT INTO exam_type_subjects (school_id, academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, app.current_user_id())
       ON CONFLICT (academic_year_id, exam_type_id, class_id, subject_id) DO UPDATE
          SET max_marks = EXCLUDED.max_marks, pass_marks = EXCLUDED.pass_marks, grade_scale_id = EXCLUDED.grade_scale_id,
              is_optional = EXCLUDED.is_optional, updated_by = EXCLUDED.updated_by, updated_at = now()
        WHERE (exam_type_subjects.max_marks, exam_type_subjects.pass_marks, exam_type_subjects.grade_scale_id, exam_type_subjects.is_optional)
              IS DISTINCT FROM (EXCLUDED.max_marks, EXCLUDED.pass_marks, EXCLUDED.grade_scale_id, EXCLUDED.is_optional)`,
      [yearId, typeId, classId, r.subjectId, r.max, r.pass, r.scaleId, r.optional],
    );
  }

  /** Saves a type × class list as a whole: the rows given, and no others. */
  async save(ctx: RequestContext, dto: SaveSubjectMarksDto) {
    const yearId = this.year(ctx);
    this.check(dto.rows);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const ok = await c.query(
        `SELECT 1 FROM exam_types WHERE id = $1 AND deleted_at IS NULL
          UNION ALL SELECT 1 FROM classes WHERE id = $2 AND deleted_at IS NULL`,
        [dto.typeId, dto.classId],
      );
      if (ok.rows.length !== 2)
        throw new DomainError('not-found', 'Exam type or class not found', { status: 404 });
      const subj = await c.query<{ id: string }>(
        `SELECT id::text FROM subjects WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [dto.rows.map((r) => r.subjectId)],
      );
      if (subj.rows.length !== dto.rows.length)
        throw new DomainError('validation-failed', 'A subject is not of this school', {
          status: 400,
        });
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
        before: { rows: before.map((x) => [x.code, x.max, x.pass]) },
        after: { rows: dto.rows.length },
      });
    });
    return this.get(ctx, dto.typeId, dto.classId);
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
      const asRow = (x: SubjectMarksRow) => ({
        subjectId: x.subjectId,
        max: x.max,
        pass: x.pass,
        scaleId: x.scaleId,
        optional: x.optional,
      });
      const out: Array<{ to: string; copied: number; left: string[] }> = [];
      const classes = await c.query<{ id: string; code: string; studied: string[] }>(
        `SELECT k.id::text, k.code,
                ARRAY(SELECT cs.subject_id::text FROM class_subjects cs
                       WHERE cs.class_id = k.id AND cs.academic_year_id = $2 AND cs.status = 'active') AS studied
           FROM classes k WHERE k.id = ANY($1::bigint[]) AND k.deleted_at IS NULL`,
        [dto.toClassIds.filter((x) => x !== dto.classId), yearId],
      );
      for (const k of classes.rows) {
        const take = src.filter((x) => k.studied.includes(x.subjectId));
        for (const x of take) await this.upsert(c, yearId, dto.typeId, k.id, asRow(x));
        out.push({
          to: k.code,
          copied: take.length,
          left: src.filter((x) => !k.studied.includes(x.subjectId)).map((x) => x.code),
        });
      }
      const types = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM exam_types WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [dto.toTypeIds.filter((x) => x !== dto.typeId)],
      );
      for (const t of types.rows) {
        for (const x of src) await this.upsert(c, yearId, t.id, dto.classId, asRow(x));
        out.push({ to: t.code, copied: src.length, left: [] });
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_marks.copy',
        entityType: 'exam_type_subjects',
        entityId: `${dto.typeId}:${dto.classId}`,
        after: { to: out },
      });
      return { data: out };
    });
  }

  /** Fills the master of an exam's type from the exam's own subjects, class by class. */
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
                  is_optional = EXCLUDED.is_optional, updated_by = EXCLUDED.updated_by, updated_at = now()
           RETURNING class_id)
         SELECT up.class_id::text, k.code, count(*)::int AS n FROM up JOIN classes k ON k.id = up.class_id
          GROUP BY 1, 2, k.display_order ORDER BY k.display_order`,
        [examId, yearId, ex.rows[0].type_id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subject_marks.fill',
        entityType: 'exam_type_subjects',
        entityId: ex.rows[0].type_id,
        after: { from: ex.rows[0].code, classes: r.rows.length },
      });
      return {
        typeId: ex.rows[0].type_id,
        data: r.rows.map((x) => ({ classId: x.class_id, code: x.code, subjects: x.n })),
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
        `INSERT INTO exam_type_subjects (school_id, academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, updated_by)
         SELECT school_id, $1, exam_type_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id, is_optional, app.current_user_id()
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
      return { from: prev.rows[0].code, added: r.rowCount ?? 0 };
    });
  }

  /** An exam type's lists as one table (class, subject, maximum, pass, scale, optional): Excel or PDF. */
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
      }>(
        `SELECT k.name AS class, s.code, s.name, m.max_marks::text AS max, m.pass_marks::text AS pass, g.code AS scale, m.is_optional AS optional
           FROM exam_type_subjects m JOIN classes k ON k.id = m.class_id JOIN subjects s ON s.id = m.subject_id
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
        ],
      })),
      foot: null,
      frozen: 0,
      widths: [10, 20, 6, 6, 8, 6],
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
