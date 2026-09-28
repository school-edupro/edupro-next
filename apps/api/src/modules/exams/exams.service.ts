import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  CreateExamDto,
  LockExamSubjectsDto,
  SetExamSubjectsDto,
  UpdateExamDto,
  UpdateExamTypeDto,
  UpsertExamTypeDto,
  UpsertGradeScaleDto,
} from './exams.dto';

export interface ExamTypeRow {
  id: string;
  code: string;
  name: string;
  weightage: string | null;
  sortOrder: number;
  status: 'active' | 'inactive';
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
  entryLocked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
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
  classes: ExamClassRow[];
  subjects?: ExamSubjectRow[];
}

const EXAM_SELECT = `SELECT e.id::text, e.code, e.name, e.exam_type_id::text AS "examTypeId", t.code AS "examTypeCode", t.name AS "examTypeName",
        e.starts_on::text AS "startsOn", e.ends_on::text AS "endsOn", e.show_on_portal AS "showOnPortal", e.marks_locked AS "marksLocked", e.status::text,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('classId', ec.class_id::text, 'classCode', k.code, 'gradeScaleId', ec.grade_scale_id::text, 'gradeScaleCode', gs.code,
                    'subjects', (SELECT count(*) FROM exam_subjects es WHERE es.exam_id = e.id AND es.class_id = ec.class_id),
                    'locked', (SELECT count(*) FROM exam_subjects es WHERE es.exam_id = e.id AND es.class_id = ec.class_id AND es.entry_locked)) ORDER BY k.display_order)
                  FROM exam_classes ec JOIN classes k ON k.id = ec.class_id LEFT JOIN grade_scales gs ON gs.id = ec.grade_scale_id WHERE ec.exam_id = e.id), '[]'::jsonb) AS classes
   FROM exams e JOIN exam_types t ON t.id = e.exam_type_id`;

const SUBJECT_SELECT = `SELECT es.id::text, es.class_id::text AS "classId", es.subject_id::text AS "subjectId", sub.code AS "subjectCode", sub.name AS "subjectName",
        es.max_marks::text AS "maxMarks", es.pass_marks::text AS "passMarks", es.weightage::text, es.is_elective AS "isElective", es.exam_on::text AS "examOn",
        es.entry_locked AS "entryLocked", u.display_name AS "lockedBy", es.locked_at::text AS "lockedAt"
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
        `SELECT t.id::text, t.code, t.name, t.weightage::text, t.sort_order AS "sortOrder", t.status::text,
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
          `INSERT INTO exam_types (school_id, code, name, weightage, sort_order, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [dto.code, dto.name, dto.weightage ?? null, dto.sortOrder],
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
                status = COALESCE($6::row_status, status), updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1 AND deleted_at IS NULL`,
        [
          id,
          dto.name ?? null,
          dto.weightage !== undefined,
          dto.weightage ?? null,
          dto.sortOrder ?? null,
          dto.status ?? null,
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
      return r.rows;
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
      `${SUBJECT_SELECT} WHERE es.exam_id = $1 ORDER BY es.class_id, sub.display_order, sub.code`,
      [id],
    );
    return { ...r.rows[0], subjects: subjects.rows };
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
      const t = await c.query(
        `SELECT 1 FROM exam_types WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.examTypeId],
      );
      if (!t.rowCount) throw new DomainError('not-found', 'Exam type not found', { status: 404 });
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name, starts_on, ends_on, show_on_portal, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6::date, $7, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            yearId,
            dto.examTypeId,
            dto.code,
            dto.name,
            dto.startsOn ?? null,
            dto.endsOn ?? null,
            dto.showOnPortal,
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
      await this.audit.stage(ctx, c, {
        action: 'exams.exam.create',
        entityType: 'exams',
        entityId: id,
        after: dto,
      });
      return this.findExam(c, id, yearId);
    });
  }

  async updateExam(ctx: RequestContext, id: string, dto: UpdateExamDto): Promise<ExamRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.findExam(c, id, yearId);
      await c.query(
        `UPDATE exams SET name = COALESCE($2, name), starts_on = CASE WHEN $3::boolean THEN $4::date ELSE starts_on END, ends_on = CASE WHEN $5::boolean THEN $6::date ELSE ends_on END,
                show_on_portal = COALESCE($7, show_on_portal), marks_locked = COALESCE($8, marks_locked), status = COALESCE($9::row_status, status), updated_at = now(), updated_by = app.current_user_id()
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
      for (const s of dto.subjects) {
        if (s.passMarks !== null && s.passMarks !== undefined && s.passMarks > s.maxMarks)
          throw new DomainError('exams.pass_above_max', 'Pass marks above max marks', {
            status: 400,
          });
        await c.query(
          `INSERT INTO exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks, weightage, is_elective, exam_on)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::date)
           ON CONFLICT (exam_id, class_id, subject_id) DO UPDATE SET max_marks = EXCLUDED.max_marks, pass_marks = EXCLUDED.pass_marks, weightage = EXCLUDED.weightage, is_elective = EXCLUDED.is_elective, exam_on = EXCLUDED.exam_on`,
          [
            examId,
            dto.classId,
            s.subjectId,
            s.maxMarks,
            s.passMarks ?? null,
            s.weightage ?? null,
            s.isElective,
            s.examOn ?? null,
          ],
        );
      }
      await c.query(
        `DELETE FROM exam_subjects WHERE exam_id = $1 AND class_id = $2 AND NOT entry_locked AND NOT (subject_id = ANY($3::bigint[]))`,
        [examId, dto.classId, dto.subjects.map((s) => s.subjectId)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.subjects.set',
        entityType: 'exams',
        entityId: examId,
        after: { classId: dto.classId, subjects: dto.subjects.length },
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
}
