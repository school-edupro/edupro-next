import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  ClassLocksDto,
  CopyExamDto,
  CreateExamDto,
  LockExamSubjectsDto,
  UpsertMarkCodeDto,
  SetExamSubjectsDto,
  UpdateExamDto,
  UpdateExamTypeDto,
  UpsertExamTypeDto,
  UpsertGradeScaleDto,
  SetPartsDto,
} from './exams.dto';
import { examProgress, type ExamProgress } from './exam-progress';
import { fillExamFromSubjectMarks, followSubjectMarks } from './subject-marks-follow';

export interface ExamTypeRow {
  id: string;
  code: string;
  name: string;
  weightage: string | null;
  sortOrder: number;
  status: 'active' | 'inactive';
  /** the areas its exams take (docs/design/66) */
  areas: string[];
  exams: number;
}
export interface GradeBand {
  id: string;
  minPct: string;
  maxPct: string;
  grade: string;
  points: string | null;
  remark: string | null;
}
export interface GradeScaleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive';
  bands: GradeBand[];
}
export interface ExamClassRow {
  classId: string;
  classCode: string;
  gradeScaleId: string | null;
  gradeScaleCode: string | null;
  subjects: number;
  locked: number;
  /** locks per entry type (docs/design/65); marks lock per subject */
  locks: { indicators: boolean; remarks: boolean; attendance: boolean; health: boolean };
  /** the class's indicator / HPC set in the exam (docs/design/65 part 5) */
  indicatorSetId: string | null;
}
export interface ExamSubjectRow {
  id: string;
  classId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  maxMarks: string;
  passMarks: string | null;
  weightage: string | null;
  isElective: boolean;
  examOn: string | null;
  /** the paper's time on the date sheet, HH:MM (docs/design/66) */
  startsAt: string | null;
  endsAt: string | null;
  entryLocked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  /** the subject's own grade scale; a grade-only subject (max 0) is graded on it (docs/design/65) */
  gradeScaleId: string | null;
  /** The parts the subject is entered in (empty = one figure for the subject). */
  parts?: ExamPartRow[];
  /** Teaching subjects under this subject (Physics, Chemistry, Biology under Science): ready-made parts. */
  children?: Array<{ id: string; code: string; name: string }>;
  /** marks entered (as a whole or in a part): the paper no longer follows the master */
  marked?: boolean;
  /** the subject marks master's line for it (docs/design/70); null: not in the class's list */
  master?: SubjectMarksLine | null;
  /** differs from the master (marked before the master changed, or not in the class's list) */
  differs?: boolean;
}
export interface ExamPartRow {
  id: string;
  name: string;
  subjectId: string | null;
  subjectCode: string | null;
  maxMarks: string;
  entered: number;
}
/** a line of the subject marks master (docs/design/70) */
export interface SubjectMarksLine {
  subjectId: string;
  code: string;
  name: string;
  maxMarks: number;
  passMarks: number | null;
  gradeScaleId: string | null;
  optional: boolean;
}

export interface ExamRow {
  id: string;
  code: string;
  name: string;
  examTypeId: string;
  examTypeCode: string;
  examTypeName: string;
  startsOn: string | null;
  endsOn: string | null;
  showOnPortal: boolean;
  marksLocked: boolean;
  status: 'active' | 'inactive';
  /** printed under the date sheet (docs/design/66) */
  dateSheetNote: string | null;
  /** what the exam takes: marks, indicators, remarks, attendance, health (docs/design/66) */
  areas: string[];
  classes: ExamClassRow[];
  subjects?: ExamSubjectRow[];
  /** the list's: how far the exam has got (docs/design/66) */
  progress?: ExamProgress;
  /** the subject marks master of the exam's type for each class that has one (docs/design/70) */
  subjectMarks?: Array<{ classId: string; rows: SubjectMarksLine[] }>;
}

const EXAM_SELECT = `SELECT e.id::text, e.code, e.name, e.exam_type_id::text AS "examTypeId", t.code AS "examTypeCode", t.name AS "examTypeName",
        e.starts_on::text AS "startsOn", e.ends_on::text AS "endsOn", e.show_on_portal AS "showOnPortal", e.marks_locked AS "marksLocked", e.status::text,
        e.date_sheet_note AS "dateSheetNote", e.areas,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('classId', ec.class_id::text, 'classCode', k.code, 'gradeScaleId', ec.grade_scale_id::text, 'gradeScaleCode', gs.code,
                    'subjects', (SELECT count(*) FROM exam_subjects es WHERE es.exam_id = e.id AND es.class_id = ec.class_id),
                    'locked', (SELECT count(*) FROM exam_subjects es WHERE es.exam_id = e.id AND es.class_id = ec.class_id AND es.entry_locked),
                    'locks', jsonb_build_object('indicators', ec.indicators_locked, 'remarks', ec.remarks_locked, 'attendance', ec.attendance_locked, 'health', ec.health_locked),
                    'indicatorSetId', (SELECT x.set_id::text FROM exam_indicator_sets x WHERE x.exam_id = e.id AND x.class_id = ec.class_id)) ORDER BY k.display_order)
                  FROM exam_classes ec JOIN classes k ON k.id = ec.class_id LEFT JOIN grade_scales gs ON gs.id = ec.grade_scale_id WHERE ec.exam_id = e.id), '[]'::jsonb) AS classes
   FROM exams e JOIN exam_types t ON t.id = e.exam_type_id`;

const SUBJECT_SELECT = `SELECT es.id::text, es.class_id::text AS "classId", es.subject_id::text AS "subjectId", sub.code AS "subjectCode", sub.name AS "subjectName",
        es.max_marks::text AS "maxMarks", es.pass_marks::text AS "passMarks", es.weightage::text, es.is_elective AS "isElective", es.exam_on::text AS "examOn",
        to_char(es.starts_at, 'HH24:MI') AS "startsAt", to_char(es.ends_at, 'HH24:MI') AS "endsAt",
        es.entry_locked AS "entryLocked", u.display_name AS "lockedBy", es.locked_at::text AS "lockedAt", es.grade_scale_id::text AS "gradeScaleId"
   FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id LEFT JOIN users u ON u.id = es.locked_by`;

/**
 * Sprint 14 (exams start): exam types, exams per year with the classes that sit them, subjects with max
 * marks and entry locks, grade scales with bands (legacy exam_type, exam_master, exam_subject_master,
 * exam_grade_master). Marks entry and results arrive in Sprints 15 to 18.
 */
@Injectable()
export class ExamsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  // ---- exam types --------------------------------------------------------------------------------
  async types(ctx: RequestContext): Promise<ExamTypeRow[]> {
    return this.db.tenant(requireTenant(ctx), (c) => this.typesWith(c));
  }

  private async typesWith(c: PoolClient): Promise<ExamTypeRow[]> {
    {
      const r = await c.query<ExamTypeRow>(
        `SELECT t.id::text, t.code, t.name, t.weightage::text, t.sort_order AS "sortOrder", t.status::text, t.areas,
                (SELECT count(*)::int FROM exams e WHERE e.exam_type_id = t.id AND e.deleted_at IS NULL) AS exams
           FROM exam_types t WHERE t.deleted_at IS NULL ORDER BY t.sort_order, t.code`,
      );
      return r.rows;
    }
  }

  async createType(ctx: RequestContext, dto: UpsertExamTypeDto): Promise<ExamTypeRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO exam_types (school_id, code, name, weightage, sort_order, areas, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, COALESCE($5::text[], '{marks,indicators,remarks,attendance,health}'), app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [dto.code, dto.name, dto.weightage ?? null, dto.sortOrder, dto.areas ?? null],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Exam type "${dto.code}" already exists`, {
            status: 409,
          });
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.type.create',
        entityType: 'exam_types',
        entityId: id,
        after: dto,
      });
      return (await this.typesWith(c)).find((t) => t.id === id)!;
    });
  }

  async updateType(ctx: RequestContext, id: string, dto: UpdateExamTypeDto): Promise<ExamTypeRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE exam_types SET name = COALESCE($2, name), weightage = CASE WHEN $3::boolean THEN $4 ELSE weightage END, sort_order = COALESCE($5, sort_order),
                status = COALESCE($6::row_status, status), areas = COALESCE($7::text[], areas), updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1 AND deleted_at IS NULL`,
        [
          id,
          dto.name ?? null,
          dto.weightage !== undefined,
          dto.weightage ?? null,
          dto.sortOrder ?? null,
          dto.status ?? null,
          dto.areas ?? null,
        ],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Exam type not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'exams.type.update',
        entityType: 'exam_types',
        entityId: id,
        after: dto,
      });
      return (await this.typesWith(c)).find((t) => t.id === id)!;
    });
  }

  // ---- grade scales ------------------------------------------------------------------------------
  async scales(ctx: RequestContext): Promise<GradeScaleRow[]> {
    return this.db.tenant(requireTenant(ctx), (c) => this.scalesWith(c));
  }

  private async scalesWith(c: PoolClient): Promise<GradeScaleRow[]> {
    const r = await c.query<GradeScaleRow>(
      `SELECT g.id::text, g.code, g.name, g.description, g.status::text,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id::text, 'minPct', b.min_pct::text, 'maxPct', b.max_pct::text, 'grade', b.grade, 'points', b.points::text, 'remark', b.remark) ORDER BY b.sort_order, b.min_pct DESC)
                          FROM grade_bands b WHERE b.scale_id = g.id), '[]'::jsonb) AS bands
         FROM grade_scales g WHERE g.deleted_at IS NULL ORDER BY g.code`,
    );
    return r.rows;
  }

  /** Creates or replaces a scale and its bands; bands must not overlap and should cover 0 to 100. */
  async upsertScale(ctx: RequestContext, dto: UpsertGradeScaleDto): Promise<GradeScaleRow> {
    const bands = [...dto.bands].sort((a, b) => b.minPct - a.minPct);
    for (let i = 0; i < bands.length; i += 1) {
      const b = bands[i]!;
      if (b.maxPct < b.minPct)
        throw new DomainError('exams.band_invalid', `Band ${b.grade}: max below min`, {
          status: 400,
        });
      const next = bands[i + 1];
      if (next && next.maxPct >= b.minPct)
        throw new DomainError('exams.bands_overlap', `Bands ${next.grade} and ${b.grade} overlap`, {
          status: 400,
        });
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO grade_scales (school_id, code, name, description, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now(), updated_by = app.current_user_id()
         RETURNING id::text`,
        [dto.code, dto.name, dto.description ?? null],
      );
      const id = r.rows[0]!.id;
      await c.query(`DELETE FROM grade_bands WHERE scale_id = $1`, [id]);
      for (const [i, b] of bands.entries())
        await c.query(
          `INSERT INTO grade_bands (school_id, scale_id, min_pct, max_pct, grade, points, remark, sort_order) VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)`,
          [id, b.minPct, b.maxPct, b.grade, b.points ?? null, b.remark ?? null, i],
        );
      await this.audit.stage(ctx, c, {
        action: 'exams.scale.upsert',
        entityType: 'grade_scales',
        entityId: id,
        after: dto,
      });
      return (await this.scalesWith(c)).find((s) => s.id === id)!;
    });
  }

  /** The grade for a percentage on a scale (used by results in Sprint 17; exposed for the assistant and tests). */
  gradeFor(scale: GradeScaleRow, pct: number): GradeBand | null {
    return scale.bands.find((b) => pct >= Number(b.minPct) && pct <= Number(b.maxPct)) ?? null;
  }

  // ---- exams -------------------------------------------------------------------------------------
  async exams(ctx: RequestContext): Promise<ExamRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<ExamRow>(
        // eslint-disable-next-line no-restricted-syntax -- EXAM_SELECT is a constant; the year is a bound parameter
        `${EXAM_SELECT} WHERE e.academic_year_id = $1 AND e.deleted_at IS NULL ORDER BY e.starts_on NULLS LAST, t.sort_order, e.code`,
        [yearId],
      );
      const progress = await examProgress(
        c,
        r.rows.map((e) => e.id),
      );
      return r.rows.map((e) => ({ ...e, progress: progress.get(e.id) }));
    });
  }

  /** How far one exam has got, class by class (docs/design/66). */
  async progress(ctx: RequestContext, id: string): Promise<ExamProgress> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.findExam(c, id, yearId);
      return (await examProgress(c, [id])).get(id)!;
    });
  }

  /**
   * A new exam made from an earlier one of the year (docs/design/66): its classes with their grade
   * scales, subjects (marks, pass marks, electives, scales; not dates or times), parts and indicator
   * sets. Entry, locks and the date sheet start afresh.
   */
  async copyExam(ctx: RequestContext, fromId: string, dto: CopyExamDto): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'exams')`, [yearId]);
      const from = await this.findExam(c, fromId, yearId);
      const typeId = dto.examTypeId ?? from.examTypeId;
      const t = await c.query(
        `SELECT 1 FROM exam_types WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [typeId],
      );
      if (!t.rowCount) throw new DomainError('not-found', 'Exam type not found', { status: 404 });
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name, starts_on, ends_on, show_on_portal, date_sheet_note, areas, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            yearId,
            typeId,
            dto.code,
            dto.name,
            dto.startsOn ?? null,
            dto.endsOn ?? null,
            dto.showOnPortal,
            from.dateSheetNote,
            dto.areas ?? from.areas,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Exam "${dto.code}" already exists in this year`, {
            status: 409,
          });
        throw error;
      }
      await c.query(
        `INSERT INTO exam_classes (school_id, exam_id, class_id, grade_scale_id)
         SELECT school_id, $2, class_id, grade_scale_id FROM exam_classes WHERE exam_id = $1`,
        [fromId, id],
      );
      await c.query(
        `INSERT INTO exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks, weightage, is_elective, grade_scale_id)
         SELECT school_id, $2, class_id, subject_id, max_marks, pass_marks, weightage, is_elective, grade_scale_id
           FROM exam_subjects WHERE exam_id = $1`,
        [fromId, id],
      );
      await c.query(
        `INSERT INTO exam_subject_parts (school_id, exam_subject_id, name, subject_id, max_marks, sort_order)
         SELECT p.school_id, n.id, p.name, p.subject_id, p.max_marks, p.sort_order
           FROM exam_subject_parts p JOIN exam_subjects o ON o.id = p.exam_subject_id AND o.exam_id = $1
           JOIN exam_subjects n ON n.exam_id = $2 AND n.class_id = o.class_id AND n.subject_id = o.subject_id`,
        [fromId, id],
      );
      await c.query(
        `INSERT INTO exam_indicator_sets (school_id, exam_id, class_id, set_id)
         SELECT school_id, $2, class_id, set_id FROM exam_indicator_sets WHERE exam_id = $1`,
        [fromId, id],
      );
      await this.fillSets(c, id);
      // the copy's papers follow the master of its type (docs/design/70)
      await followSubjectMarks(c, { yearId, examId: id });
      await this.audit.stage(ctx, c, {
        action: 'exams.exam.copy',
        entityType: 'exams',
        entityId: id,
        after: { from: fromId, ...dto },
      });
      return this.findExam(c, id, yearId);
    });
  }

  private async findExam(c: PoolClient, id: string, yearId: string): Promise<ExamRow> {
    const r = await c.query<ExamRow>(
      // eslint-disable-next-line no-restricted-syntax -- EXAM_SELECT is a constant; values are bound parameters
      `${EXAM_SELECT} WHERE e.id = $1 AND e.academic_year_id = $2 AND e.deleted_at IS NULL`,
      [id, yearId],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Exam not found in the working year', { status: 404 });
    const subjects = await c.query<ExamSubjectRow>(
      // eslint-disable-next-line no-restricted-syntax -- SUBJECT_SELECT is a constant; the id is a bound parameter
      `${SUBJECT_SELECT} WHERE es.exam_id = $1 ORDER BY es.class_id, app.subject_seq(es.class_id, (SELECT academic_year_id FROM exams WHERE id = es.exam_id), es.subject_id), sub.code`,
      [id],
    );
    const parts = await c.query<ExamPartRow & { examSubjectId: string }>(
      `SELECT p.id::text, p.exam_subject_id::text AS "examSubjectId", p.name, p.subject_id::text AS "subjectId", sub.code AS "subjectCode", p.max_marks::text AS "maxMarks",
              (SELECT count(*)::int FROM mark_part_entries m WHERE m.part_id = p.id) AS entered
         FROM exam_subject_parts p JOIN exam_subjects es ON es.id = p.exam_subject_id LEFT JOIN subjects sub ON sub.id = p.subject_id
        WHERE es.exam_id = $1 ORDER BY p.sort_order, p.id`,
      [id],
    );
    const children = await c.query<{ parent: string; id: string; code: string; name: string }>(
      `SELECT k.parent_id::text AS parent, k.id::text, k.code, k.name FROM subjects k
        WHERE k.deleted_at IS NULL AND k.status = 'active' AND k.parent_id IN (SELECT subject_id FROM exam_subjects WHERE exam_id = $1)
        ORDER BY k.display_order, k.code`,
      [id],
    );
    // the subject marks master of the exam's type (docs/design/70), and the papers with marks
    const master = await c.query<{
      class_id: string;
      subject_id: string;
      code: string;
      name: string;
      max: string;
      pass: string | null;
      scale: string | null;
      optional: boolean;
    }>(
      `SELECT m.class_id::text, m.subject_id::text, s.code, s.name, m.max_marks::text AS max, m.pass_marks::text AS pass,
              m.grade_scale_id::text AS scale, m.is_optional AS optional
         FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id
         JOIN exam_type_subjects m ON m.academic_year_id = e.academic_year_id AND m.exam_type_id = e.exam_type_id AND m.class_id = ec.class_id
         JOIN subjects s ON s.id = m.subject_id
        WHERE e.id = $1
        ORDER BY m.class_id, app.subject_seq(m.class_id, e.academic_year_id, m.subject_id), s.code`,
      [id],
    );
    const marked = new Set(
      (
        await c.query<{ id: string }>(
          `SELECT es.id::text FROM exam_subjects es WHERE es.exam_id = $1
              AND (EXISTS (SELECT 1 FROM mark_entries me WHERE me.exam_subject_id = es.id)
                OR EXISTS (SELECT 1 FROM mark_part_entries mp JOIN exam_subject_parts p ON p.id = mp.part_id
                            WHERE p.exam_subject_id = es.id))`,
          [id],
        )
      ).rows.map((x) => x.id),
    );
    const line = (x: (typeof master.rows)[number]): SubjectMarksLine => ({
      subjectId: x.subject_id,
      code: x.code,
      name: x.name,
      maxMarks: Number(x.max),
      passMarks: x.pass === null ? null : Number(x.pass),
      gradeScaleId: x.scale,
      optional: x.optional,
    });
    const classesWithMaster = new Set(master.rows.map((x) => x.class_id));
    return {
      ...r.rows[0],
      subjectMarks: [...classesWithMaster].map((classId) => ({
        classId,
        rows: master.rows.filter((x) => x.class_id === classId).map(line),
      })),
      subjects: subjects.rows.map((x) => {
        const m = master.rows.find((y) => y.class_id === x.classId && y.subject_id === x.subjectId);
        const own = m ? line(m) : null;
        return {
          ...x,
          marked: marked.has(x.id),
          master: own,
          differs: classesWithMaster.has(x.classId)
            ? !own ||
              own.maxMarks !== Number(x.maxMarks) ||
              own.passMarks !== (x.passMarks === null ? null : Number(x.passMarks)) ||
              own.gradeScaleId !== x.gradeScaleId ||
              own.optional !== x.isElective
            : false,
          parts: parts.rows
            .filter((p) => p.examSubjectId === x.id)
            .map(({ examSubjectId: _es, ...p }) => p),
          children: children.rows
            .filter((k) => k.parent === x.subjectId)
            .map((k) => ({ id: k.id, code: k.code, name: k.name })),
        };
      }),
    };
  }

  async exam(ctx: RequestContext, id: string): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, (c) => this.findExam(c, id, this.year(tenant)));
  }

  async createExam(ctx: RequestContext, dto: CreateExamDto): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'exams')`, [yearId]);
      const t = await c.query<{ areas: string[] }>(
        `SELECT areas FROM exam_types WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.examTypeId],
      );
      if (!t.rowCount) throw new DomainError('not-found', 'Exam type not found', { status: 404 });
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name, starts_on, ends_on, show_on_portal, areas, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6::date, $7, $8, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            yearId,
            dto.examTypeId,
            dto.code,
            dto.name,
            dto.startsOn ?? null,
            dto.endsOn ?? null,
            dto.showOnPortal,
            dto.areas ?? t.rows[0]!.areas,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Exam "${dto.code}" already exists in this year`, {
            status: 409,
          });
        throw error;
      }
      for (const k of dto.classes)
        await c.query(
          `INSERT INTO exam_classes (school_id, exam_id, class_id, grade_scale_id) VALUES (app.current_school_id(), $1, $2, $3) ON CONFLICT (exam_id, class_id) DO UPDATE SET grade_scale_id = EXCLUDED.grade_scale_id`,
          [id, k.classId, k.gradeScaleId ?? null],
        );
      await this.fillSets(c, id);
      // each class's papers from the master of the exam's type (docs/design/70)
      await fillExamFromSubjectMarks(c, id);
      await this.audit.stage(ctx, c, {
        action: 'exams.exam.create',
        entityType: 'exams',
        entityId: id,
        after: dto,
      });
      return this.findExam(c, id, yearId);
    });
  }

  /**
   * The classes of an exam that takes indicators get their mapped set (docs/design/66) where the exam
   * has none for them yet; a set chosen on the exam's set-up stays.
   */
  private async fillSets(c: PoolClient, examId: string): Promise<void> {
    await c.query(
      `INSERT INTO exam_indicator_sets (school_id, exam_id, class_id, set_id)
       SELECT ec.school_id, ec.exam_id, ec.class_id, m.set_id
         FROM exam_classes ec JOIN exams e ON e.id = ec.exam_id AND 'indicators' = ANY(e.areas)
         JOIN indicator_set_classes m ON m.class_id = ec.class_id
         JOIN indicator_sets s ON s.id = m.set_id AND s.deleted_at IS NULL AND s.status = 'active'
        WHERE ec.exam_id = $1
       ON CONFLICT (exam_id, class_id) DO NOTHING`,
      [examId],
    );
  }

  async updateExam(ctx: RequestContext, id: string, dto: UpdateExamDto): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.findExam(c, id, yearId);
      if (dto.classes) {
        // a class whose marks are entered stays (taking it out would delete them)
        const kept = dto.classes.map((k) => k.classId);
        const marked = await c.query<{ code: string; n: number }>(
          `SELECT k.code, count(*)::int AS n FROM mark_entries m JOIN exam_subjects es ON es.id = m.exam_subject_id
             JOIN classes k ON k.id = es.class_id
            WHERE es.exam_id = $1 AND NOT (es.class_id = ANY($2::bigint[])) GROUP BY k.code, k.display_order ORDER BY k.display_order LIMIT 1`,
          [id, kept],
        );
        const m = marked.rows[0];
        if (m)
          throw new DomainError(
            'exams.class_has_marks',
            `Class ${m.code} has ${m.n} marks entered in this exam: it can't be taken out`,
            { status: 409, extra: { classCode: m.code, entries: m.n } },
          );
      }
      await c.query(
        `UPDATE exams SET name = COALESCE($2, name), starts_on = CASE WHEN $3::boolean THEN $4::date ELSE starts_on END, ends_on = CASE WHEN $5::boolean THEN $6::date ELSE ends_on END,
                show_on_portal = COALESCE($7, show_on_portal), marks_locked = COALESCE($8, marks_locked), status = COALESCE($9::row_status, status),
                date_sheet_note = CASE WHEN $10::boolean THEN $11 ELSE date_sheet_note END, areas = COALESCE($12::text[], areas),
                updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          dto.name ?? null,
          dto.startsOn !== undefined,
          dto.startsOn ?? null,
          dto.endsOn !== undefined,
          dto.endsOn ?? null,
          dto.showOnPortal ?? null,
          dto.marksLocked ?? null,
          dto.status ?? null,
          dto.dateSheetNote !== undefined,
          dto.dateSheetNote || null,
          dto.areas ?? null,
        ],
      );
      if (dto.classes) {
        for (const k of dto.classes)
          await c.query(
            `INSERT INTO exam_classes (school_id, exam_id, class_id, grade_scale_id) VALUES (app.current_school_id(), $1, $2, $3) ON CONFLICT (exam_id, class_id) DO UPDATE SET grade_scale_id = EXCLUDED.grade_scale_id`,
            [id, k.classId, k.gradeScaleId ?? null],
          );
        await c.query(
          `DELETE FROM exam_classes WHERE exam_id = $1 AND NOT (class_id = ANY($2::bigint[]))`,
          [id, dto.classes.map((k) => k.classId)],
        );
        await c.query(
          `DELETE FROM exam_subjects WHERE exam_id = $1 AND NOT (class_id = ANY($2::bigint[]))`,
          [id, dto.classes.map((k) => k.classId)],
        );
      }
      if (dto.marksLocked !== undefined)
        await c.query(
          `UPDATE exam_subjects SET entry_locked = $2, locked_by = CASE WHEN $2 THEN app.current_user_id() END, locked_at = CASE WHEN $2 THEN now() END WHERE exam_id = $1`,
          [id, dto.marksLocked],
        );
      // a class added (or indicators taken now) gets its mapped set
      if (dto.classes || dto.areas) await this.fillSets(c, id);
      // a class added takes its papers from the master (docs/design/70)
      if (dto.classes) await fillExamFromSubjectMarks(c, id);
      const after = await this.findExam(c, id, yearId);
      await this.audit.stage(ctx, c, {
        action: 'exams.exam.update',
        entityType: 'exams',
        entityId: id,
        before: { name: before.name, status: before.status, marksLocked: before.marksLocked },
        after: dto,
      });
      return after;
    });
  }

  /** Replaces the subject list of one class in the exam; locked rows keep their lock. */
  async setSubjects(
    ctx: RequestContext,
    examId: string,
    dto: SetExamSubjectsDto,
  ): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.findExam(c, examId, yearId);
      if (!exam.classes.some((k) => k.classId === dto.classId))
        throw new DomainError('exams.class_not_in_exam', 'Add the class to the exam first', {
          status: 409,
        });
      if (exam.marksLocked)
        throw new DomainError('exams.locked', 'The exam is locked; unlock it to change subjects', {
          status: 409,
        });
      const classScale = exam.classes.find((k) => k.classId === dto.classId)?.gradeScaleId ?? null;
      // the subject marks master of the exam's type (docs/design/70): with a list for the class, a
      // paper's marks come from it (a paper already marked keeps its own); a subject not in it is
      // refused unless the exam holds it already. Without a list the marks given are kept (as before).
      const master = new Map(
        (
          await c.query<{
            subject_id: string;
            max: string;
            pass: string | null;
            scale: string | null;
            optional: boolean;
          }>(
            `SELECT subject_id::text, max_marks::text AS max, pass_marks::text AS pass, grade_scale_id::text AS scale, is_optional AS optional
               FROM exam_type_subjects WHERE academic_year_id = $1 AND exam_type_id = $2 AND class_id = $3`,
            [yearId, exam.examTypeId, dto.classId],
          )
        ).rows.map((x) => [x.subject_id, x]),
      );
      const held = new Map(
        (exam.subjects ?? []).filter((x) => x.classId === dto.classId).map((x) => [x.subjectId, x]),
      );
      const subjects = dto.subjects.map((s) => {
        if (!master.size) return s;
        const cur = held.get(s.subjectId);
        if (cur?.marked)
          return {
            ...s,
            maxMarks: Number(cur.maxMarks),
            passMarks: cur.passMarks === null ? null : Number(cur.passMarks),
            isElective: cur.isElective,
            gradeScaleId: cur.gradeScaleId,
          };
        const m = master.get(s.subjectId);
        if (m)
          return {
            ...s,
            maxMarks: Number(m.max),
            passMarks: m.pass === null ? null : Number(m.pass),
            isElective: m.optional,
            gradeScaleId: m.scale,
          };
        if (cur)
          return {
            ...s,
            maxMarks: Number(cur.maxMarks),
            passMarks: cur.passMarks === null ? null : Number(cur.passMarks),
            isElective: cur.isElective,
            gradeScaleId: cur.gradeScaleId,
          };
        throw new DomainError(
          'exams.not_in_master',
          `A subject is not in the subject marks of ${exam.examTypeCode} for this class: add it there first`,
          { status: 409, extra: { subjectId: s.subjectId } },
        );
      });
      // a subject whose marks are entered stays (taking it out would delete them)
      const marked = await c.query<{ code: string; n: number }>(
        `SELECT sub.code, count(*)::int AS n FROM mark_entries m JOIN exam_subjects es ON es.id = m.exam_subject_id
           JOIN subjects sub ON sub.id = es.subject_id
          WHERE es.exam_id = $1 AND es.class_id = $2 AND NOT es.entry_locked AND NOT (es.subject_id = ANY($3::bigint[]))
          GROUP BY sub.code ORDER BY sub.code LIMIT 1`,
        [examId, dto.classId, subjects.map((s) => s.subjectId)],
      );
      const m = marked.rows[0];
      if (m)
        throw new DomainError(
          'exams.subject_has_marks',
          `${m.code} has ${m.n} marks entered: it can't be taken out of the exam`,
          { status: 409, extra: { subjectCode: m.code, entries: m.n } },
        );
      // a subject entered in parts has their sum as its maximum: once marked, its parts change instead
      const parted = await c.query<{ subjectId: string; code: string; max: string }>(
        `SELECT es.subject_id::text AS "subjectId", sub.code, es.max_marks::text AS max
           FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
          WHERE es.exam_id = $1 AND es.class_id = $2
            AND EXISTS (SELECT 1 FROM exam_subject_parts p WHERE p.exam_subject_id = es.id)
            AND (EXISTS (SELECT 1 FROM mark_entries me WHERE me.exam_subject_id = es.id)
              OR EXISTS (SELECT 1 FROM mark_part_entries mp JOIN exam_subject_parts p ON p.id = mp.part_id
                          WHERE p.exam_subject_id = es.id))`,
        [examId, dto.classId],
      );
      const refit = parted.rows.find((x) => {
        const s = subjects.find((y) => y.subjectId === x.subjectId);
        return s !== undefined && s.maxMarks !== Number(x.max);
      });
      if (refit)
        throw new DomainError(
          'exams.parts_marked',
          `${refit.code} is entered in parts and has marks: change the maximum of its parts instead`,
          { status: 409, extra: { subjectCode: refit.code } },
        );
      for (const s of subjects) {
        if (s.startsAt && s.endsAt && s.endsAt <= s.startsAt)
          throw new DomainError('exams.paper_time', 'A paper ends after it starts', {
            status: 400,
          });
        if (s.passMarks !== null && s.passMarks !== undefined && s.passMarks > s.maxMarks)
          throw new DomainError('exams.pass_above_max', 'Pass marks above max marks', {
            status: 400,
          });
        // a grade-only subject (docs/design/65): graded on its scale, or the class's
        if (s.maxMarks === 0 && !s.gradeScaleId && !classScale)
          throw new DomainError(
            'exams.grade_scale_needed',
            'A grade-only subject (maximum 0) needs a grade scale: choose one for it or for the class',
            { status: 400 },
          );
        await c.query(
          `INSERT INTO exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks, weightage, is_elective, exam_on, grade_scale_id, starts_at, ends_at)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10::time, $11::time)
           ON CONFLICT (exam_id, class_id, subject_id) DO UPDATE SET max_marks = EXCLUDED.max_marks, pass_marks = EXCLUDED.pass_marks, weightage = EXCLUDED.weightage,
             is_elective = EXCLUDED.is_elective, exam_on = EXCLUDED.exam_on, grade_scale_id = EXCLUDED.grade_scale_id,
             starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at`,
          [
            examId,
            dto.classId,
            s.subjectId,
            s.maxMarks,
            s.maxMarks === 0 ? null : (s.passMarks ?? null),
            s.weightage ?? null,
            s.isElective,
            s.examOn ?? null,
            s.gradeScaleId ?? null,
            s.startsAt ?? null,
            s.endsAt ?? null,
          ],
        );
      }
      await c.query(
        `DELETE FROM exam_subjects WHERE exam_id = $1 AND class_id = $2 AND NOT entry_locked AND NOT (subject_id = ANY($3::bigint[]))`,
        [examId, dto.classId, subjects.map((s) => s.subjectId)],
      );
      // parts follow a new maximum while unmarked (0295); a subject the class enters in parts (Class
      // set-up, docs/design/67) gets them, while it has none
      await c.query(
        `SELECT app.fit_parts_to_max(id), app.apply_class_parts(id) FROM exam_subjects WHERE exam_id = $1 AND class_id = $2`,
        [examId, dto.classId],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subjects.set',
        entityType: 'exams',
        entityId: examId,
        after: { classId: dto.classId, subjects: subjects.length },
      });
      return this.findExam(c, examId, yearId);
    });
  }

  /**
   * A paper whose marks are entered moved to the subject marks master's values (docs/design/70): its
   * maximum, pass marks, grade scale and Optional, with a reason. Refused when an entered mark is above
   * the new maximum (the students are named) or the paper is entered in parts (change its parts).
   */
  async applyMaster(
    ctx: RequestContext,
    examId: string,
    examSubjectId: string,
    reason: string,
  ): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.findExam(c, examId, yearId);
      if (exam.marksLocked)
        throw new DomainError('exams.locked', 'The exam is locked; unlock it to change subjects', {
          status: 409,
        });
      const es = exam.subjects?.find((x) => x.id === examSubjectId);
      if (!es) throw new DomainError('not-found', 'Subject not found in the exam', { status: 404 });
      if (!es.master)
        throw new DomainError(
          'exams.not_in_master',
          `${es.subjectCode} is not in the subject marks of ${exam.examTypeCode} for this class`,
          { status: 409 },
        );
      const m = es.master;
      const partsMarked = await c.query(
        `SELECT 1 FROM mark_part_entries mp JOIN exam_subject_parts p ON p.id = mp.part_id WHERE p.exam_subject_id = $1 LIMIT 1`,
        [examSubjectId],
      );
      if (partsMarked.rowCount)
        throw new DomainError(
          'exams.parts_marked',
          `${es.subjectCode} is entered in parts and has marks: change the maximum of its parts instead`,
          { status: 409 },
        );
      const over = await c.query<{ adm: string; name: string; marks: string }>(
        `SELECT s.admission_no AS adm, s.display_name AS name, me.marks::text
           FROM mark_entries me JOIN students s ON s.id = me.student_id
          WHERE me.exam_subject_id = $1 AND me.marks IS NOT NULL AND me.marks > $2
          ORDER BY me.marks DESC LIMIT 10`,
        [examSubjectId, m.maxMarks],
      );
      if (over.rows.length)
        throw new DomainError(
          'exams.marks_above_max',
          `Marks above the master's maximum of ${String(m.maxMarks)}: ${over.rows
            .map((x) => `${x.adm} ${x.name} (${String(Number(x.marks))})`)
            .join(', ')}`,
          { status: 409, extra: { students: over.rows } },
        );
      if (m.maxMarks === 0) {
        const numbers = await c.query(
          `SELECT 1 FROM mark_entries WHERE exam_subject_id = $1 AND marks IS NOT NULL LIMIT 1`,
          [examSubjectId],
        );
        if (numbers.rowCount)
          throw new DomainError(
            'exams.marks_above_max',
            `${es.subjectCode} is graded only in the master, but marks are entered`,
            { status: 409 },
          );
      }
      await c.query(
        `UPDATE exam_subjects SET max_marks = $2, pass_marks = $3, grade_scale_id = $4, is_elective = $5 WHERE id = $1`,
        [examSubjectId, m.maxMarks, m.passMarks, m.gradeScaleId, m.optional],
      );
      await c.query(`SELECT app.fit_parts_to_max($1)`, [examSubjectId]);
      await this.audit.stage(ctx, c, {
        action: 'exams.subjects.apply_master',
        entityType: 'exam_subjects',
        entityId: examSubjectId,
        before: {
          maxMarks: es.maxMarks,
          passMarks: es.passMarks,
          gradeScaleId: es.gradeScaleId,
          isElective: es.isElective,
        },
        after: { ...m, reason },
      });
      return this.findExam(c, examId, yearId);
    });
  }

  /**
   * The parts an exam subject is entered in: Theory and Practical, or one per teaching subject under it.
   * The subject's maximum becomes the sum of its parts. A part that has marks cannot be removed, and a
   * subject already marked as a whole cannot be split until those marks are cleared.
   */
  async setParts(
    ctx: RequestContext,
    examId: string,
    examSubjectId: string,
    dto: SetPartsDto,
  ): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.findExam(c, examId, yearId);
      const es = (exam.subjects ?? []).find((x) => x.id === examSubjectId);
      if (!es)
        throw new DomainError('not-found', 'The subject is not part of this exam', { status: 404 });
      if (exam.marksLocked || es.entryLocked)
        throw new DomainError(
          'exams.locked',
          'Marks entry is locked; unlock it to change the parts',
          {
            status: 409,
          },
        );
      const names = dto.parts.map((p) => p.name.toLowerCase());
      if (new Set(names).size !== names.length)
        throw new DomainError('validation-failed', 'Two parts have the same name', { status: 400 });
      const had = es.parts ?? [];
      if (!had.length && dto.parts.length) {
        const whole = await c.query(
          `SELECT 1 FROM mark_entries WHERE exam_subject_id = $1 LIMIT 1`,
          [es.id],
        );
        if (whole.rowCount)
          throw new DomainError(
            'exams.already_marked',
            'Marks are already entered for this subject as one figure; clear them before splitting it into parts',
            { status: 409 },
          );
      }
      for (const p of dto.parts)
        if (
          p.subjectId &&
          p.subjectId !== es.subjectId &&
          !(es.children ?? []).some((k) => k.id === p.subjectId)
        )
          throw new DomainError(
            'validation-failed',
            `The teaching subject of "${p.name}" must be ${es.subjectName} or a subject under it`,
            { status: 400 },
          );
      const keep = new Set(dto.parts.map((p) => p.id).filter(Boolean));
      for (const old of had)
        if (!keep.has(old.id)) {
          if (old.entered)
            throw new DomainError(
              'exams.part_has_marks',
              `"${old.name}" has marks entered; clear them before removing the part`,
              { status: 409 },
            );
          await c.query(`DELETE FROM exam_subject_parts WHERE id = $1`, [old.id]);
        }
      for (const [i, p] of dto.parts.entries()) {
        if (p.id) {
          if (!had.some((x) => x.id === p.id))
            throw new DomainError('not-found', 'A part does not belong to this subject', {
              status: 404,
            });
          const over = await c.query(
            `SELECT 1 FROM mark_part_entries WHERE part_id = $1 AND marks > $2 LIMIT 1`,
            [p.id, p.maxMarks],
          );
          if (over.rowCount)
            throw new DomainError(
              'exams.marks_out_of_range',
              `"${p.name}" has marks above ${String(p.maxMarks)}; the maximum cannot go below them`,
              { status: 409 },
            );
          await c.query(
            `UPDATE exam_subject_parts SET name = $2, subject_id = $3, max_marks = $4, sort_order = $5 WHERE id = $1`,
            [p.id, p.name, p.subjectId ?? null, p.maxMarks, i],
          );
        } else
          await c.query(
            `INSERT INTO exam_subject_parts (school_id, exam_subject_id, name, subject_id, max_marks, sort_order, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())`,
            [es.id, p.name, p.subjectId ?? null, p.maxMarks, i],
          );
      }
      if (dto.parts.length) {
        const total = dto.parts.reduce((n, p) => n + p.maxMarks, 0);
        await c.query(
          `UPDATE exam_subjects SET max_marks = $2, pass_marks = CASE WHEN pass_marks > $2 THEN NULL ELSE pass_marks END WHERE id = $1`,
          [es.id, total],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.subject.parts',
        entityType: 'exam_subjects',
        entityId: es.id,
        after: { parts: dto.parts.map((p) => `${p.name}:${String(p.maxMarks)}`) },
      });
      return this.findExam(c, examId, yearId);
    });
  }

  async lockSubjects(
    ctx: RequestContext,
    examId: string,
    dto: LockExamSubjectsDto,
  ): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    if (!dto.locked && !ctx.permissions?.has('exams.marks.unlock'))
      throw new DomainError(
        'permission-denied',
        'Reopening a locked subject needs exams.marks.unlock',
        {
          status: 403,
        },
      );
    return this.db.tenant(tenant, async (c) => {
      await this.findExam(c, examId, yearId);
      await c.query(
        `UPDATE exam_subjects SET entry_locked = $3, locked_by = CASE WHEN $3 THEN app.current_user_id() END, locked_at = CASE WHEN $3 THEN now() END
          WHERE exam_id = $1 AND class_id = $2 AND ($4::bigint[] IS NULL OR subject_id = ANY($4::bigint[]))`,
        [examId, dto.classId, dto.locked, dto.subjectIds ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: dto.locked ? 'exams.subjects.lock' : 'exams.subjects.unlock',
        entityType: 'exams',
        entityId: examId,
        after: dto,
      });
      return this.findExam(c, examId, yearId);
    });
  }

  /**
   * Locks of one class of an exam per entry type (docs/design/65): marks (every subject of the class),
   * indicators, remarks, attendance, health. Opening any of them again needs exams.marks.unlock.
   */
  async classLocks(ctx: RequestContext, examId: string, dto: ClassLocksDto): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.findExam(c, examId, yearId);
      const klass = exam.classes.find((k) => k.classId === dto.classId);
      if (!klass)
        throw new DomainError('exams.class_not_in_exam', 'The class is not in this exam', {
          status: 404,
        });
      // opening is what is locked now and asked open (a box left as it was opens nothing)
      const marksLocked = (exam.subjects ?? []).some(
        (s) => s.classId === dto.classId && s.entryLocked,
      );
      const opening =
        (dto.marks === false && marksLocked) ||
        (['indicators', 'remarks', 'attendance', 'health'] as const).some(
          (k) => dto[k] === false && klass.locks[k],
        );
      if (opening && !ctx.permissions?.has('exams.marks.unlock'))
        throw new DomainError('permission-denied', 'Opening entry again needs exams.marks.unlock', {
          status: 403,
        });
      if (dto.marks !== undefined)
        await c.query(
          `UPDATE exam_subjects SET entry_locked = $3, locked_by = CASE WHEN $3 THEN app.current_user_id() END, locked_at = CASE WHEN $3 THEN now() END
            WHERE exam_id = $1 AND class_id = $2 AND entry_locked <> $3`,
          [examId, dto.classId, dto.marks],
        );
      await c.query(
        `UPDATE exam_classes SET indicators_locked = COALESCE($3, indicators_locked), remarks_locked = COALESCE($4, remarks_locked),
                attendance_locked = COALESCE($5, attendance_locked), health_locked = COALESCE($6, health_locked)
          WHERE exam_id = $1 AND class_id = $2`,
        [
          examId,
          dto.classId,
          dto.indicators ?? null,
          dto.remarks ?? null,
          dto.attendance ?? null,
          dto.health ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: opening ? 'exams.class.unlock' : 'exams.class.lock',
        entityType: 'exams',
        entityId: examId,
        after: dto,
      });
      return this.findExam(c, examId, yearId);
    });
  }

  // ---- marks codes (docs/design/65) ---------------------------------------------------------------
  private async codesWith(c: PoolClient) {
    await c.query(`SELECT app.mark_codes_seed(app.current_school_id())`);
    return (
      await c.query<{
        id: string;
        code: string;
        name: string;
        treatment: string;
        value: string | null;
        blocksResult: boolean;
        sortOrder: number;
        status: string;
      }>(
        `SELECT id::text, code, name, treatment, value::text, blocks_result AS "blocksResult", sort_order AS "sortOrder", status::text
           FROM mark_codes ORDER BY sort_order, code`,
      )
    ).rows;
  }

  async codes(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => this.codesWith(c));
  }

  async upsertCode(ctx: RequestContext, dto: UpsertMarkCodeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.mark_codes_seed(app.current_school_id())`);
      const r = await c.query<{ id: string }>(
        `INSERT INTO mark_codes (school_id, code, name, treatment, value, blocks_result, sort_order, status)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::row_status)
         ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, treatment = EXCLUDED.treatment, value = EXCLUDED.value,
           blocks_result = EXCLUDED.blocks_result, sort_order = EXCLUDED.sort_order, status = EXCLUDED.status, updated_at = now()
         RETURNING id::text`,
        [
          dto.code,
          dto.name,
          dto.treatment,
          dto.value ?? null,
          dto.blocksResult,
          dto.sortOrder,
          dto.status,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.mark_code.upsert',
        entityType: 'mark_codes',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return this.codesWith(c);
    });
  }

  /**
   * Ready-made grade scales (docs/design/65): CBSE 8-point (VI-XII), the primary A*-D (I-V) and the
   * 3-point co-scholastic A-C; a scale the school already has under the same code is left alone.
   */
  async installScalePresets(ctx: RequestContext): Promise<GradeScaleRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const p of SCALE_PRESETS) {
        const have = await c.query(
          `SELECT 1 FROM grade_scales WHERE code = $1 AND deleted_at IS NULL`,
          [p.code],
        );
        if (have.rowCount) continue;
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO grade_scales (school_id, code, name, description, created_by, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
            [p.code, p.name, p.description],
          )
        ).rows[0]!.id;
        for (const [i, b] of p.bands.entries())
          await c.query(
            `INSERT INTO grade_bands (school_id, scale_id, min_pct, max_pct, grade, points, remark, sort_order)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)`,
            [id, b[0], b[1], b[2], b[3], b[4], i],
          );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.scale.presets',
        entityType: 'grade_scales',
        entityId: 'presets',
        after: { codes: SCALE_PRESETS.map((p) => p.code) },
      });
      return this.scalesWith(c);
    });
  }
}

/** [min %, max %, grade, points, remark], highest first */
type Band = [number, number, string, number | null, string];
const SCALE_PRESETS: Array<{ code: string; name: string; description: string; bands: Band[] }> = [
  {
    code: 'CBSE_8POINT',
    name: 'CBSE 8-point (VI-XII)',
    description: 'A1 91-100 down to E below 33, with grade points',
    bands: [
      [91, 100, 'A1', 10, 'Outstanding'],
      [81, 90.99, 'A2', 9, 'Excellent'],
      [71, 80.99, 'B1', 8, 'Very good'],
      [61, 70.99, 'B2', 7, 'Good'],
      [51, 60.99, 'C1', 6, 'Above average'],
      [41, 50.99, 'C2', 5, 'Average'],
      [33, 40.99, 'D', 4, 'Fair'],
      [0, 32.99, 'E', null, 'Needs improvement'],
    ],
  },
  {
    code: 'PRIMARY_6POINT',
    name: 'Primary A* to D (I-V)',
    description: 'A* 91-100 down to D 50 and below',
    bands: [
      [91, 100, 'A*', null, 'Outstanding'],
      [81, 90.99, 'A', null, 'Excellent'],
      [71, 80.99, 'B*', null, 'Very good'],
      [61, 70.99, 'B', null, 'Good'],
      [51, 60.99, 'C', null, 'Fair'],
      [0, 50.99, 'D', null, 'Needs improvement'],
    ],
  },
  {
    code: 'CO_SCHOLASTIC_3',
    name: 'Co-scholastic 3-point (A-C)',
    description: 'For grade-only subjects and co-scholastic areas',
    bands: [
      [67, 100, 'A', null, 'Outstanding'],
      [34, 66.99, 'B', null, 'Very good'],
      [0, 33.99, 'C', null, 'Fair'],
    ],
  },
];
