import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  EXAMS,
  type EntryQueryDto,
  type PutExamAttendanceDto,
  type PutHealthDto,
  type PutIndicatorsDto,
  type PutMarksDto,
  type PutRemarksDto,
  type SetExamIndicatorSetDto,
  type UpsertIndicatorSetDto,
  type UpsertRemarkBankDto,
} from './exams.dto';

export interface EntrySection {
  classSectionId: string;
  classId: string;
  code: string;
  /** The caller may enter the class register (remarks, attendance, health): class teacher or unscoped. */
  register: boolean;
  subjects: Array<{
    examSubjectId: string;
    subjectId: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    entryLocked: boolean;
    entered: number;
  }>;
}

export interface RosterStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
}

export interface MarkRow extends RosterStudent {
  marks: string | null;
  absent: boolean;
  exempt: boolean;
  updatedAt: string | null;
}

export interface MarksSheet {
  exam: { id: string; code: string; name: string; marksLocked: boolean };
  examSubject: {
    id: string;
    subjectId: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    entryLocked: boolean;
  };
  section: { id: string; code: string };
  rows: MarkRow[];
}

interface Kind {
  permission: string;
  /** Subject teachers qualify only with a matching subject; the register kinds need the class teacher. */
  subjectAware: boolean;
}

const MARKS: Kind = { permission: EXAMS.marksEnter, subjectAware: true };
const INDICATORS: Kind = { permission: EXAMS.indicatorEnter, subjectAware: false };
const REMARKS: Kind = { permission: EXAMS.remarkEnter, subjectAware: false };
const ATTENDANCE: Kind = { permission: EXAMS.attendanceEnter, subjectAware: false };
const HEALTH: Kind = { permission: EXAMS.healthEnter, subjectAware: false };

/**
 * Sprint 15: exam entry. Marks go through app.enter_marks (locks, range, enrolment); indicators, remarks,
 * exam attendance and health records are upserts under the same exam lock. A teacher writes only for the
 * sections held in teacher_assignments this year (class teacher or coordinator for anything, subject
 * teacher for the assigned subject), the same rule as attendance marking.
 */
@Injectable()
export class ExamEntryService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
  ) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  private async exam(c: PoolClient, id: string, yearId: string) {
    const r = await c.query<{ id: string; code: string; name: string; marks_locked: boolean }>(
      `SELECT id::text, code, name, marks_locked FROM exams WHERE id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
      [id, yearId],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Exam not found in the working year', { status: 404 });
    return r.rows[0];
  }

  private async section(c: PoolClient, sectionId: string, yearId: string, examId: string) {
    const r = await c.query<{ id: string; class_id: string; code: string }>(
      `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code
         FROM class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.id = $1 AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM exam_classes ec WHERE ec.exam_id = $3 AND ec.class_id = cs.class_id)`,
      [sectionId, yearId, examId],
    );
    if (!r.rows[0])
      throw new DomainError('exams.section_not_in_exam', 'This section is not part of the exam', {
        status: 404,
      });
    return r.rows[0];
  }

  /** Mirrors AttendanceService.assertMayMark: scope first, then the live assignment for scoped teachers. */
  private async assertMayEnter(
    c: PoolClient,
    tenant: TenantContext,
    yearId: string,
    sectionId: string,
    kind: Kind,
    subjectId?: string,
  ): Promise<void> {
    await this.scopes.assert(tenant, kind.permission, 'class_section', sectionId);
    const allowed = await this.scopes.filter(tenant, kind.permission, 'class_section');
    if (allowed === null) return;
    const r = await c.query(
      `SELECT 1 FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE e.user_id = app.current_user_id() AND ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL
          AND (ta.kind IN ('class_teacher', 'coordinator')
               OR ($3::boolean AND ta.kind = 'subject_teacher' AND ta.subject_id = $4::bigint))
        LIMIT 1`,
      [sectionId, yearId, kind.subjectAware, subjectId ?? null],
    );
    if (r.rowCount === 0)
      throw new DomainError(
        'exams.not_assigned',
        'You are not assigned to this section (or subject) this year',
        { status: 403 },
      );
  }

  private async roster(c: PoolClient, yearId: string, sectionId: string): Promise<RosterStudent[]> {
    const r = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      roll_no: number | null;
    }>(
      `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no
         FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
        WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
        ORDER BY e.roll_no NULLS LAST, s.display_name`,
      [sectionId, yearId],
    );
    return r.rows.map((x) => ({
      studentId: x.student_id,
      name: x.name,
      admissionNo: x.admission_no,
      rollNo: x.roll_no,
    }));
  }

  private assertRoster(rows: Array<{ studentId: string }>, roster: RosterStudent[]) {
    const ids = new Set(roster.map((r) => r.studentId));
    const stranger = rows.find((r) => !ids.has(r.studentId));
    if (stranger)
      throw new DomainError('exams.student_not_in_section', 'A student is not in this section', {
        status: 409,
        extra: { studentId: stranger.studentId },
      });
  }

  // ---- what the caller may enter -----------------------------------------------------------------
  async sections(ctx: RequestContext, examId: string): Promise<EntrySection[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.exam(c, examId, yearId);
      const allowed = await this.scopes.filter(tenant, EXAMS.marksEnter, 'class_section');
      const viewOnly =
        allowed !== null && allowed.length === 0
          ? await this.scopes.filter(tenant, EXAMS.marksView, 'class_section')
          : allowed;
      const secs = await c.query<{
        id: string;
        class_id: string;
        code: string;
        register: boolean;
        subject_ids: string[] | null;
        unscoped: boolean;
      }>(
        `WITH me AS (
           SELECT ta.class_section_id, ta.kind, ta.subject_id FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
            WHERE e.user_id = app.current_user_id() AND ta.academic_year_id = $2 AND ta.valid_to IS NULL
         )
         SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code,
                ($3::bigint[] IS NULL OR EXISTS (SELECT 1 FROM me WHERE me.class_section_id = cs.id AND me.kind IN ('class_teacher', 'coordinator'))) AS register,
                CASE WHEN $3::bigint[] IS NULL OR EXISTS (SELECT 1 FROM me WHERE me.class_section_id = cs.id AND me.kind IN ('class_teacher', 'coordinator')) THEN NULL
                     ELSE array_agg(DISTINCT me.subject_id::text) FILTER (WHERE me.subject_id IS NOT NULL) END AS subject_ids,
                ($3::bigint[] IS NULL) AS unscoped
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
           JOIN exam_classes ec ON ec.exam_id = $1 AND ec.class_id = cs.class_id
           LEFT JOIN me ON me.class_section_id = cs.id
          WHERE cs.academic_year_id = $2 AND cs.deleted_at IS NULL AND cs.status = 'active'
            AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))
          GROUP BY cs.id, cs.class_id, k.code, cs.name, k.display_order
          ORDER BY k.display_order, k.code, cs.name`,
        [examId, yearId, viewOnly],
      );
      const out: EntrySection[] = [];
      for (const s of secs.rows) {
        const subs = await c.query<{
          id: string;
          subject_id: string;
          code: string;
          name: string;
          max_marks: string;
          pass_marks: string | null;
          entry_locked: boolean;
          entered: number;
        }>(
          `SELECT es.id::text, es.subject_id::text, sub.code, sub.name, es.max_marks::text, es.pass_marks::text, es.entry_locked,
                  (SELECT count(*)::int FROM mark_entries m JOIN enrolments e ON e.student_id = m.student_id AND e.class_section_id = $3 AND e.academic_year_id = $4 AND e.status = 'active'
                    WHERE m.exam_subject_id = es.id) AS entered
             FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
            WHERE es.exam_id = $1 AND es.class_id = $2 AND ($5::bigint[] IS NULL OR es.subject_id = ANY($5::bigint[]))
            ORDER BY sub.display_order, sub.code`,
          [examId, s.class_id, s.id, yearId, s.subject_ids],
        );
        if (!s.register && subs.rowCount === 0) continue;
        out.push({
          classSectionId: s.id,
          classId: s.class_id,
          code: s.code,
          register: s.register,
          subjects: subs.rows.map((x) => ({
            examSubjectId: x.id,
            subjectId: x.subject_id,
            code: x.code,
            name: x.name,
            maxMarks: x.max_marks,
            passMarks: x.pass_marks,
            entryLocked: x.entry_locked,
            entered: x.entered,
          })),
        });
      }
      return out;
    });
  }

  // ---- marks -------------------------------------------------------------------------------------
  private async examSubject(c: PoolClient, examId: string, classId: string, subjectId: string) {
    const r = await c.query<{
      id: string;
      subject_id: string;
      code: string;
      name: string;
      max_marks: string;
      pass_marks: string | null;
      entry_locked: boolean;
    }>(
      `SELECT es.id::text, es.subject_id::text, sub.code, sub.name, es.max_marks::text, es.pass_marks::text, es.entry_locked
         FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
        WHERE es.exam_id = $1 AND es.class_id = $2 AND es.subject_id = $3`,
      [examId, classId, subjectId],
    );
    if (!r.rows[0])
      throw new DomainError('exams.subject_not_in_exam', 'The subject is not part of this exam', {
        status: 404,
      });
    return r.rows[0];
  }

  async marks(ctx: RequestContext, examId: string, q: EntryQueryDto): Promise<MarksSheet> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    if (!q.subjectId)
      throw new DomainError('validation-failed', 'subjectId is required', { status: 400 });
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const section = await this.section(c, q.classSectionId, yearId, examId);
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', section.id);
      const es = await this.examSubject(c, examId, section.class_id, q.subjectId!);
      const r = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        roll_no: number | null;
        marks: string | null;
        absent: boolean | null;
        exempt: boolean | null;
        updated_at: Date | null;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no, m.marks::text, m.absent, m.exempt, m.updated_at
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           LEFT JOIN mark_entries m ON m.student_id = s.id AND m.exam_subject_id = $3
          WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
          ORDER BY e.roll_no NULLS LAST, s.display_name`,
        [section.id, yearId, es.id],
      );
      return {
        exam: { id: exam.id, code: exam.code, name: exam.name, marksLocked: exam.marks_locked },
        examSubject: {
          id: es.id,
          subjectId: es.subject_id,
          code: es.code,
          name: es.name,
          maxMarks: es.max_marks,
          passMarks: es.pass_marks,
          entryLocked: es.entry_locked,
        },
        section: { id: section.id, code: section.code },
        rows: r.rows.map((x) => ({
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          rollNo: x.roll_no,
          marks: x.marks,
          absent: x.absent ?? false,
          exempt: x.exempt ?? false,
          updatedAt: x.updated_at ? x.updated_at.toISOString() : null,
        })),
      };
    });
  }

  async putMarks(ctx: RequestContext, examId: string, dto: PutMarksDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.exam(c, examId, yearId);
      const section = await this.section(c, dto.classSectionId, yearId, examId);
      await this.assertMayEnter(c, tenant, yearId, section.id, MARKS, dto.subjectId);
      const es = await this.examSubject(c, examId, section.class_id, dto.subjectId);
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      const r = await c.query<{ o_inserted: number; o_updated: number }>(
        `SELECT o_inserted, o_updated FROM app.enter_marks($1, $2::jsonb)`,
        [es.id, JSON.stringify(dto.rows)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.marks.enter',
        entityType: 'exam_subjects',
        entityId: es.id,
        after: {
          examId,
          classSectionId: section.id,
          subjectId: dto.subjectId,
          rows: dto.rows.length,
          inserted: r.rows[0]!.o_inserted,
          updated: r.rows[0]!.o_updated,
        },
      });
      return { inserted: r.rows[0]!.o_inserted, updated: r.rows[0]!.o_updated };
    });
  }

  // ---- indicators --------------------------------------------------------------------------------
  async indicators(ctx: RequestContext, examId: string, q: EntryQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const section = await this.section(c, q.classSectionId, yearId, examId);
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', section.id);
      const set = await c.query<{
        id: string;
        code: string;
        name: string;
        grades: string[];
      }>(
        `SELECT s.id::text, s.code, s.name, s.grades FROM exam_indicator_sets x JOIN indicator_sets s ON s.id = x.set_id
          WHERE x.exam_id = $1 AND x.class_id = $2 AND s.deleted_at IS NULL`,
        [examId, section.class_id],
      );
      const ind = set.rows[0]
        ? await c.query<{ id: string; code: string; name: string; area: string | null }>(
            `SELECT id::text, code, name, area FROM indicators WHERE set_id = $1 ORDER BY sort_order, code`,
            [set.rows[0].id],
          )
        : { rows: [] };
      const roster = await this.roster(c, yearId, section.id);
      const entries = await c.query<{
        student_id: string;
        indicator_id: string;
        grade: string;
        note: string | null;
      }>(
        `SELECT ie.student_id::text, ie.indicator_id::text, ie.grade, ie.note FROM indicator_entries ie
           JOIN enrolments e ON e.student_id = ie.student_id AND e.class_section_id = $2 AND e.academic_year_id = $3 AND e.status = 'active'
          WHERE ie.exam_id = $1`,
        [examId, section.id, yearId],
      );
      const byStudent = new Map<string, Record<string, { grade: string; note: string | null }>>();
      for (const e of entries.rows) {
        const m = byStudent.get(e.student_id) ?? {};
        m[e.indicator_id] = { grade: e.grade, note: e.note };
        byStudent.set(e.student_id, m);
      }
      return {
        exam: { id: exam.id, code: exam.code, name: exam.name, marksLocked: exam.marks_locked },
        section: { id: section.id, code: section.code },
        set: set.rows[0]
          ? {
              id: set.rows[0].id,
              code: set.rows[0].code,
              name: set.rows[0].name,
              grades: set.rows[0].grades,
            }
          : null,
        indicators: ind.rows,
        rows: roster.map((s) => ({ ...s, grades: byStudent.get(s.studentId) ?? {} })),
      };
    });
  }

  async putIndicators(ctx: RequestContext, examId: string, dto: PutIndicatorsDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const section = await this.section(c, dto.classSectionId, yearId, examId);
      await this.assertMayEnter(c, tenant, yearId, section.id, INDICATORS);
      if (exam.marks_locked)
        throw new DomainError('exams.entry_locked', 'The exam is locked', { status: 409 });
      await c.query(`SELECT app.assert_year_open($1, 'exams')`, [yearId]);
      const set = await c.query<{ id: string; grades: string[] }>(
        `SELECT s.id::text, s.grades FROM exam_indicator_sets x JOIN indicator_sets s ON s.id = x.set_id WHERE x.exam_id = $1 AND x.class_id = $2`,
        [examId, section.class_id],
      );
      if (!set.rows[0])
        throw new DomainError(
          'exams.no_indicator_set',
          'No indicator set is assigned to this class',
          {
            status: 409,
          },
        );
      const valid = await c.query<{ id: string }>(
        `SELECT id::text FROM indicators WHERE set_id = $1`,
        [set.rows[0].id],
      );
      const validIds = new Set(valid.rows.map((v) => v.id));
      const grades = new Set(set.rows[0].grades);
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      for (const r of dto.rows) {
        if (!validIds.has(r.indicatorId))
          throw new DomainError('exams.indicator_not_in_set', 'Indicator is not in the class set', {
            status: 409,
            extra: { indicatorId: r.indicatorId },
          });
        if (!grades.has(r.grade))
          throw new DomainError('exams.grade_not_allowed', `Grade ${r.grade} is not in the set`, {
            status: 409,
            extra: { grade: r.grade, allowed: [...grades] },
          });
      }
      let n = 0;
      for (const r of dto.rows) {
        const u = await c.query(
          `INSERT INTO indicator_entries (school_id, exam_id, indicator_id, student_id, grade, note, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
           ON CONFLICT (exam_id, indicator_id, student_id) DO UPDATE SET grade = EXCLUDED.grade, note = EXCLUDED.note, entered_by = app.current_user_id()
           WHERE indicator_entries.grade <> EXCLUDED.grade OR indicator_entries.note IS DISTINCT FROM EXCLUDED.note`,
          [examId, r.indicatorId, r.studentId, r.grade, r.note ?? null],
        );
        n += u.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.indicators.enter',
        entityType: 'exams',
        entityId: examId,
        after: { classSectionId: section.id, rows: dto.rows.length, changed: n },
      });
      return { changed: n };
    });
  }

  // ---- register: remarks, exam attendance, health ------------------------------------------------
  async register(ctx: RequestContext, examId: string, q: EntryQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const section = await this.section(c, q.classSectionId, yearId, examId);
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', section.id);
      const health = ctx.permissions?.has(EXAMS.healthView) ?? false;
      const r = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        roll_no: number | null;
        remark: string | null;
        bank_code: string | null;
        days_present: number | null;
        days_total: number | null;
        height_cm: string | null;
        weight_kg: string | null;
        bmi: string | null;
        blood_group: string | null;
        recorded_on: string | null;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
                rm.remark, rm.bank_code, ea.days_present, ea.days_total,
                CASE WHEN $4 THEN h.height_cm::text END AS height_cm, CASE WHEN $4 THEN h.weight_kg::text END AS weight_kg,
                CASE WHEN $4 THEN h.bmi::text END AS bmi, CASE WHEN $4 THEN h.blood_group END AS blood_group, h.recorded_on::text
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           LEFT JOIN exam_remarks rm ON rm.exam_id = $3 AND rm.student_id = s.id
           LEFT JOIN exam_attendance ea ON ea.exam_id = $3 AND ea.student_id = s.id
           LEFT JOIN LATERAL (SELECT * FROM health_records hr WHERE hr.student_id = s.id ORDER BY hr.recorded_on DESC, hr.id DESC LIMIT 1) h ON $4
          WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
          ORDER BY e.roll_no NULLS LAST, s.display_name`,
        [section.id, yearId, examId, health],
      );
      const bank = await c.query<{ code: string; text: string }>(
        `SELECT code, text FROM remark_bank WHERE status = 'active' AND (class_id IS NULL OR class_id = $1) ORDER BY sort_order, code`,
        [section.class_id],
      );
      return {
        exam: { id: exam.id, code: exam.code, name: exam.name, marksLocked: exam.marks_locked },
        section: { id: section.id, code: section.code },
        healthVisible: health,
        remarkBank: bank.rows,
        rows: r.rows.map((x) => ({
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          rollNo: x.roll_no,
          remark: x.remark,
          bankCode: x.bank_code,
          daysPresent: x.days_present,
          daysTotal: x.days_total,
          health: health
            ? {
                heightCm: x.height_cm,
                weightKg: x.weight_kg,
                bmi: x.bmi,
                bloodGroup: x.blood_group,
                recordedOn: x.recorded_on,
              }
            : null,
        })),
      };
    });
  }

  private async openForRegister(
    c: PoolClient,
    tenant: TenantContext,
    yearId: string,
    examId: string,
    sectionId: string,
    kind: Kind,
  ) {
    const exam = await this.exam(c, examId, yearId);
    const section = await this.section(c, sectionId, yearId, examId);
    await this.assertMayEnter(c, tenant, yearId, section.id, kind);
    if (exam.marks_locked)
      throw new DomainError('exams.entry_locked', 'The exam is locked', { status: 409 });
    await c.query(`SELECT app.assert_year_open($1, 'exams')`, [yearId]);
    return section;
  }

  async putRemarks(ctx: RequestContext, examId: string, dto: PutRemarksDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const section = await this.openForRegister(
        c,
        tenant,
        yearId,
        examId,
        dto.classSectionId,
        REMARKS,
      );
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      let n = 0;
      for (const r of dto.rows) {
        const u = await c.query(
          `INSERT INTO exam_remarks (school_id, exam_id, student_id, remark, bank_code, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
           ON CONFLICT (exam_id, student_id) DO UPDATE SET remark = EXCLUDED.remark, bank_code = EXCLUDED.bank_code, entered_by = app.current_user_id()
           WHERE exam_remarks.remark <> EXCLUDED.remark OR exam_remarks.bank_code IS DISTINCT FROM EXCLUDED.bank_code`,
          [examId, r.studentId, r.remark, r.bankCode ?? null],
        );
        n += u.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.remarks.enter',
        entityType: 'exams',
        entityId: examId,
        after: { classSectionId: section.id, rows: dto.rows.length, changed: n },
      });
      return { changed: n };
    });
  }

  async putAttendance(ctx: RequestContext, examId: string, dto: PutExamAttendanceDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const section = await this.openForRegister(
        c,
        tenant,
        yearId,
        examId,
        dto.classSectionId,
        ATTENDANCE,
      );
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      const bad = dto.rows.find((r) => r.daysPresent > r.daysTotal);
      if (bad)
        throw new DomainError('exams.attendance_invalid', 'Days present exceed the total', {
          status: 400,
          extra: { studentId: bad.studentId },
        });
      let n = 0;
      for (const r of dto.rows) {
        const u = await c.query(
          `INSERT INTO exam_attendance (school_id, exam_id, student_id, days_present, days_total, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
           ON CONFLICT (exam_id, student_id) DO UPDATE SET days_present = EXCLUDED.days_present, days_total = EXCLUDED.days_total, entered_by = app.current_user_id()
           WHERE exam_attendance.days_present <> EXCLUDED.days_present OR exam_attendance.days_total <> EXCLUDED.days_total`,
          [examId, r.studentId, r.daysPresent, r.daysTotal],
        );
        n += u.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.attendance.enter',
        entityType: 'exams',
        entityId: examId,
        after: { classSectionId: section.id, rows: dto.rows.length, changed: n },
      });
      return { changed: n };
    });
  }

  async putHealth(ctx: RequestContext, examId: string, dto: PutHealthDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const section = await this.openForRegister(
        c,
        tenant,
        yearId,
        examId,
        dto.classSectionId,
        HEALTH,
      );
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      let n = 0;
      for (const r of dto.rows) {
        if (
          r.heightCm == null &&
          r.weightKg == null &&
          r.bloodGroup == null &&
          !r.visionLeft &&
          !r.visionRight &&
          !r.dental &&
          !r.notes
        )
          continue;
        const u = await c.query(
          `INSERT INTO health_records (school_id, student_id, recorded_on, exam_id, height_cm, weight_kg, blood_group, vision_left, vision_right, dental, notes, recorded_by)
           VALUES (app.current_school_id(), $1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, app.current_user_id())
           ON CONFLICT (student_id, recorded_on, COALESCE(exam_id, 0)) DO UPDATE
             SET height_cm = EXCLUDED.height_cm, weight_kg = EXCLUDED.weight_kg, blood_group = EXCLUDED.blood_group, vision_left = EXCLUDED.vision_left,
                 vision_right = EXCLUDED.vision_right, dental = EXCLUDED.dental, notes = EXCLUDED.notes, recorded_by = app.current_user_id()`,
          [
            r.studentId,
            dto.recordedOn ?? null,
            examId,
            r.heightCm ?? null,
            r.weightKg ?? null,
            r.bloodGroup ?? null,
            r.visionLeft ?? null,
            r.visionRight ?? null,
            r.dental ?? null,
            r.notes ?? null,
          ],
        );
        n += u.rowCount ?? 0;
      }
      // sensitive: the audit payload carries counts only; values stay in the row trigger with key masking
      await this.audit.stage(ctx, c, {
        action: 'exams.health.enter',
        entityType: 'exams',
        entityId: examId,
        after: { classSectionId: section.id, rows: dto.rows.length, recorded: n },
      });
      return { recorded: n };
    });
  }

  // ---- masters: indicator sets, exam ↔ set, remark bank -----------------------------------------
  async indicatorSets(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sets = await c.query<{
        id: string;
        code: string;
        name: string;
        grades: string[];
        status: string;
      }>(
        `SELECT id::text, code, name, grades, status::text FROM indicator_sets WHERE deleted_at IS NULL ORDER BY code`,
      );
      const ind = await c.query<{
        id: string;
        set_id: string;
        code: string;
        name: string;
        area: string | null;
        sort_order: number;
      }>(
        `SELECT id::text, set_id::text, code, name, area, sort_order FROM indicators ORDER BY set_id, sort_order, code`,
      );
      return sets.rows.map((s) => ({
        ...s,
        indicators: ind.rows
          .filter((i) => i.set_id === s.id)
          .map((i) => ({
            id: i.id,
            code: i.code,
            name: i.name,
            area: i.area,
            sortOrder: i.sort_order,
          })),
      }));
    });
  }

  async upsertIndicatorSet(ctx: RequestContext, dto: UpsertIndicatorSetDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query<{ id: string }>(
        `INSERT INTO indicator_sets (school_id, code, name, grades, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name, grades = EXCLUDED.grades, updated_by = app.current_user_id()
         RETURNING id::text`,
        [dto.code, dto.name, dto.grades],
      );
      const setId = s.rows[0]!.id;
      const codes = dto.indicators.map((i) => i.code);
      await c.query(`DELETE FROM indicators WHERE set_id = $1 AND NOT (code = ANY($2::text[]))`, [
        setId,
        codes,
      ]);
      for (const i of dto.indicators) {
        await c.query(
          `INSERT INTO indicators (school_id, set_id, code, name, area, sort_order) VALUES (app.current_school_id(), $1, $2, $3, $4, $5)
           ON CONFLICT (set_id, code) DO UPDATE SET name = EXCLUDED.name, area = EXCLUDED.area, sort_order = EXCLUDED.sort_order`,
          [setId, i.code, i.name, i.area ?? null, i.sortOrder],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.indicator_set.upsert',
        entityType: 'indicator_sets',
        entityId: setId,
        after: dto,
      });
      return { id: setId };
    });
  }

  async setExamIndicatorSet(ctx: RequestContext, examId: string, dto: SetExamIndicatorSetDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.exam(c, examId, yearId);
      const cls = await c.query(`SELECT 1 FROM exam_classes WHERE exam_id = $1 AND class_id = $2`, [
        examId,
        dto.classId,
      ]);
      if (cls.rowCount === 0)
        throw new DomainError('exams.class_not_in_exam', 'The class is not part of this exam', {
          status: 404,
        });
      if (dto.setId === null) {
        await c.query(`DELETE FROM exam_indicator_sets WHERE exam_id = $1 AND class_id = $2`, [
          examId,
          dto.classId,
        ]);
      } else {
        await c.query(
          `INSERT INTO exam_indicator_sets (school_id, exam_id, class_id, set_id) VALUES (app.current_school_id(), $1, $2, $3)
           ON CONFLICT (exam_id, class_id) DO UPDATE SET set_id = EXCLUDED.set_id`,
          [examId, dto.classId, dto.setId],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.indicator_set.assign',
        entityType: 'exams',
        entityId: examId,
        after: dto,
      });
      return { ok: true };
    });
  }

  async remarkBank(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        code: string;
        text: string;
        class_id: string | null;
        class_code: string | null;
        sort_order: number;
      }>(
        `SELECT b.id::text, b.code, b.text, b.class_id::text, k.code AS class_code, b.sort_order
           FROM remark_bank b LEFT JOIN classes k ON k.id = b.class_id WHERE b.status = 'active' ORDER BY b.sort_order, b.code`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        code: x.code,
        text: x.text,
        classId: x.class_id,
        classCode: x.class_code,
        sortOrder: x.sort_order,
      }));
    });
  }

  async upsertRemarkBank(ctx: RequestContext, dto: UpsertRemarkBankDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const e of dto.entries) {
        await c.query(
          `INSERT INTO remark_bank (school_id, code, text, class_id, sort_order) VALUES (app.current_school_id(), $1, $2, $3, $4)
           ON CONFLICT (school_id, code) DO UPDATE SET text = EXCLUDED.text, class_id = EXCLUDED.class_id, sort_order = EXCLUDED.sort_order, status = 'active'`,
          [e.code, e.text, e.classId ?? null, e.sortOrder],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.remark_bank.upsert',
        entityType: 'remark_bank',
        entityId: 'bulk',
        after: { entries: dto.entries.length },
      });
      return { entries: dto.entries.length };
    });
  }
}
