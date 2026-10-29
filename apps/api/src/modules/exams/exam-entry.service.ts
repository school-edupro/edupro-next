import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  EXAMS,
  type EntryQueryDto,
  type MarksUploadDto,
  type PutExamAttendanceDto,
  type PutHealthDto,
  type PutIndicatorsDto,
  type PutMarksDto,
  type PutPartMarksDto,
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
    parts: PartRow[];
  }>;
}

export interface PartRow {
  id: string;
  name: string;
  subjectId: string | null;
  subjectCode: string | null;
  maxMarks: string;
  /** The caller may enter this part. */
  mine: boolean;
}

export interface RosterStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
}

export interface MarkRow extends RosterStudent {
  /** Marks by part id, when the subject is entered in parts. */
  parts: Record<string, { marks: string | null; absent: boolean }>;
  marks: string | null;
  absent: boolean;
  exempt: boolean;
  /** a marks code in place of marks (AB, ML, ...), and a grade-only subject's grade (docs/design/65) */
  code: string | null;
  grade: string | null;
  /** how the student takes the subject (compulsory / optional / additional); null = not taken */
  taken: string | null;
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
    parts: PartRow[];
    /** maximum 0: a grade of the scale instead of marks */
    gradeOnly: boolean;
  };
  section: { id: string; code: string };
  /** the school's active marks codes, and the grades a grade-only subject takes */
  codes: Array<{ code: string; name: string }>;
  grades: string[];
  /** the section's entry of this subject: open → submitted → verified (docs/design/65, part 2) */
  status: {
    status: 'open' | 'submitted' | 'verified';
    submittedBy: string | null;
    submittedAt: string | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
    remark: string | null;
  };
  rows: MarkRow[];
}

/** What the database's marks checks mean, for people (docs/design/65). */
const MARKS_ERRORS: Record<string, string> = {
  'exams.subject_not_taken':
    'A student does not take this subject (see Subject choices); leave the row empty',
  'exams.unknown_code':
    'That is not a marks code of the school: use the number, or AB, ML, EX, NA, OD, L, NEW ADM',
  'exams.grade_not_allowed': "That grade is not on the subject's grade scale",
  'exams.marks_out_of_range': 'Marks must be between 0 and the maximum',
  'exams.entry_locked': 'Marks entry is locked for this subject',
  'exams.student_not_in_class': 'A student is not in this class this year',
  'exams.entry_submitted':
    'The marks of this section are submitted: the verifier sends them back before they change',
};
const asMarksError = (error: unknown): unknown => {
  const e = error as { code?: string; message?: string; detail?: string };
  if (e.code !== 'P0001' || !e.message || !MARKS_ERRORS[e.message]) return error;
  let extra: Record<string, unknown> | undefined;
  try {
    extra = e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : undefined;
  } catch {
    extra = undefined;
  }
  return new DomainError(e.message, MARKS_ERRORS[e.message]!, { status: 409, extra });
};
const num = (v: string | number) => String(Number(v));

export interface Kind {
  permission: string;
  /** Subject teachers qualify only with a matching subject; the register kinds need the class teacher. */
  subjectAware: boolean;
  /** the exam class's lock of this entry type (docs/design/65) */
  lock?: 'indicators_locked' | 'remarks_locked' | 'attendance_locked' | 'health_locked';
  label?: string;
}

export const MARKS: Kind = { permission: EXAMS.marksEnter, subjectAware: true };
export const INDICATORS: Kind = {
  permission: EXAMS.indicatorEnter,
  subjectAware: false,
  lock: 'indicators_locked',
  label: 'Indicator',
};
export const REMARKS: Kind = {
  permission: EXAMS.remarkEnter,
  subjectAware: false,
  lock: 'remarks_locked',
  label: 'Remarks',
};
const ATTENDANCE: Kind = {
  permission: EXAMS.attendanceEnter,
  subjectAware: false,
  lock: 'attendance_locked',
  label: 'Attendance',
};
const HEALTH: Kind = {
  permission: EXAMS.healthEnter,
  subjectAware: false,
  lock: 'health_locked',
  label: 'Health',
};

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

  year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  async exam(c: PoolClient, id: string, yearId: string) {
    const r = await c.query<{ id: string; code: string; name: string; marks_locked: boolean }>(
      `SELECT id::text, code, name, marks_locked FROM exams WHERE id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
      [id, yearId],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Exam not found in the working year', { status: 404 });
    return r.rows[0];
  }

  async section(c: PoolClient, sectionId: string, yearId: string, examId: string) {
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
  async assertMayEnter(
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

  async roster(c: PoolClient, yearId: string, sectionId: string): Promise<RosterStudent[]> {
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

  assertRoster(rows: Array<{ studentId: string }>, roster: RosterStudent[]) {
    const ids = new Set(roster.map((r) => r.studentId));
    const stranger = rows.find((r) => !ids.has(r.studentId));
    if (stranger)
      throw new DomainError('exams.student_not_in_section', 'A student is not in this section', {
        status: 409,
        extra: { studentId: stranger.studentId },
      });
  }

  /** Marks of a section's subject change only while its entry is open (docs/design/65, part 2). */
  async assertEntryOpen(c: PoolClient, examSubjectId: string, sectionId: string) {
    const r = await c.query<{ status: string }>(
      `SELECT status FROM exam_entry_status WHERE exam_subject_id = $1 AND class_section_id = $2`,
      [examSubjectId, sectionId],
    );
    const st = r.rows[0]?.status;
    if (st && st !== 'open')
      throw new DomainError(
        'exams.entry_submitted',
        st === 'verified'
          ? 'The marks are verified and locked: reopening needs the unlock right and a reason'
          : 'The marks are submitted for verification: the verifier sends them back before they change',
        { status: 409 },
      );
  }

  /** An entry type locked on the exam's class (docs/design/65). */
  async assertTypeOpen(c: PoolClient, examId: string, classId: string, kind: Kind) {
    if (!kind.lock) return;
    const r = await c.query<{ locked: boolean }>(
      // eslint-disable-next-line no-restricted-syntax -- the column is one of the fixed lock names above
      `SELECT ${kind.lock} AS locked FROM exam_classes WHERE exam_id = $1 AND class_id = $2`,
      [examId, classId],
    );
    if (r.rows[0]?.locked)
      throw new DomainError(
        'exams.entry_locked',
        `${kind.label ?? 'This'} entry is locked for the class in this exam`,
        { status: 409 },
      );
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
            WHERE es.exam_id = $1 AND es.class_id = $2
              AND ($5::bigint[] IS NULL OR es.subject_id = ANY($5::bigint[])
                   OR EXISTS (SELECT 1 FROM exam_subject_parts p WHERE p.exam_subject_id = es.id AND p.subject_id = ANY($5::bigint[])))
            ORDER BY sub.display_order, sub.code`,
          [examId, s.class_id, s.id, yearId, s.subject_ids],
        );
        if (!s.register && subs.rowCount === 0) continue;
        out.push({
          classSectionId: s.id,
          classId: s.class_id,
          code: s.code,
          register: s.register,
          subjects: await Promise.all(
            subs.rows.map(async (x) => ({
              parts: await this.partsOf(c, x.id, x.subject_id, s.subject_ids),
              examSubjectId: x.id,
              subjectId: x.subject_id,
              code: x.code,
              name: x.name,
              maxMarks: x.max_marks,
              passMarks: x.pass_marks,
              entryLocked: x.entry_locked,
              entered: x.entered,
            })),
          ),
        });
      }
      return out;
    });
  }

  /** The parts of an exam subject; `mine` says whether the caller (with these teaching subjects; null = any) enters it. */
  private async partsOf(
    c: PoolClient,
    examSubjectId: string,
    subjectId: string,
    mySubjects: string[] | null,
  ): Promise<PartRow[]> {
    const r = await c.query<{
      id: string;
      name: string;
      subject_id: string | null;
      subject_code: string | null;
      max_marks: string;
    }>(
      `SELECT p.id::text, p.name, p.subject_id::text, sub.code AS subject_code, p.max_marks::text
         FROM exam_subject_parts p LEFT JOIN subjects sub ON sub.id = p.subject_id WHERE p.exam_subject_id = $1 ORDER BY p.sort_order, p.id`,
      [examSubjectId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      name: x.name,
      subjectId: x.subject_id,
      subjectCode: x.subject_code,
      maxMarks: x.max_marks,
      mine:
        mySubjects === null ||
        mySubjects.includes(subjectId) ||
        (x.subject_id !== null && mySubjects.includes(x.subject_id)),
    }));
  }

  // ---- marks -------------------------------------------------------------------------------------
  async examSubject(c: PoolClient, examId: string, classId: string, subjectId: string) {
    const r = await c.query<{
      id: string;
      subject_id: string;
      code: string;
      name: string;
      max_marks: string;
      pass_marks: string | null;
      entry_locked: boolean;
      scale_id: string | null;
    }>(
      `SELECT es.id::text, es.subject_id::text, sub.code, sub.name, es.max_marks::text, es.pass_marks::text, es.entry_locked,
              COALESCE(es.grade_scale_id, ec.grade_scale_id)::text AS scale_id
         FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
         JOIN exam_classes ec ON ec.exam_id = es.exam_id AND ec.class_id = es.class_id
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
        code: string | null;
        grade: string | null;
        kind: string | null;
        updated_at: Date | null;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no, m.marks::text, m.absent, m.exempt,
                m.code, m.grade, app.student_subject_kind(s.id, $2, $4) AS kind, m.updated_at
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           LEFT JOIN mark_entries m ON m.student_id = s.id AND m.exam_subject_id = $3
          WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
          ORDER BY e.roll_no NULLS LAST, s.display_name`,
        [section.id, yearId, es.id, es.subject_id],
      );
      await c.query(`SELECT app.mark_codes_seed(app.current_school_id())`);
      const codes = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM mark_codes WHERE status = 'active' ORDER BY sort_order, code`,
      );
      const st = await c.query<{
        status: 'open' | 'submitted' | 'verified';
        submitted_by: string | null;
        submitted_at: Date | null;
        verified_by: string | null;
        verified_at: Date | null;
        remark: string | null;
      }>(
        `SELECT st.status, su.display_name AS submitted_by, st.submitted_at, vu.display_name AS verified_by, st.verified_at, st.remark
           FROM exam_entry_status st LEFT JOIN users su ON su.id = st.submitted_by LEFT JOIN users vu ON vu.id = st.verified_by
          WHERE st.exam_subject_id = $1 AND st.class_section_id = $2`,
        [es.id, section.id],
      );
      const status = {
        status: st.rows[0]?.status ?? ('open' as const),
        submittedBy: st.rows[0]?.submitted_by ?? null,
        submittedAt: st.rows[0]?.submitted_at?.toISOString() ?? null,
        verifiedBy: st.rows[0]?.verified_by ?? null,
        verifiedAt: st.rows[0]?.verified_at?.toISOString() ?? null,
        remark: st.rows[0]?.remark ?? null,
      };
      const grades = es.scale_id
        ? (
            await c.query<{ grade: string }>(
              `SELECT grade FROM grade_bands WHERE scale_id = $1 ORDER BY sort_order, min_pct DESC`,
              [es.scale_id],
            )
          ).rows.map((x) => x.grade)
        : [];
      const mine = await c.query<{ ids: string[] | null; all: boolean }>(
        `SELECT array_agg(DISTINCT ta.subject_id::text) FILTER (WHERE ta.subject_id IS NOT NULL) AS ids,
                COALESCE(bool_or(ta.kind IN ('class_teacher', 'coordinator')), false) AS all
           FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
          WHERE e.user_id = app.current_user_id() AND ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL`,
        [section.id, yearId],
      );
      const unscoped =
        (await this.scopes.filter(tenant, EXAMS.marksEnter, 'class_section')) === null;
      const parts = await this.partsOf(
        c,
        es.id,
        es.subject_id,
        unscoped || mine.rows[0]?.all ? null : (mine.rows[0]?.ids ?? []),
      );
      const partMarks = parts.length
        ? await c.query<{
            part_id: string;
            student_id: string;
            marks: string | null;
            absent: boolean;
          }>(
            `SELECT part_id::text, student_id::text, marks::text, absent FROM mark_part_entries WHERE part_id = ANY($1::bigint[])`,
            [parts.map((p) => p.id)],
          )
        : { rows: [] };
      const byStudent = new Map<
        string,
        Record<string, { marks: string | null; absent: boolean }>
      >();
      for (const m of partMarks.rows)
        byStudent.set(m.student_id, {
          ...(byStudent.get(m.student_id) ?? {}),
          [m.part_id]: { marks: m.marks, absent: m.absent },
        });
      return {
        exam: { id: exam.id, code: exam.code, name: exam.name, marksLocked: exam.marks_locked },
        examSubject: {
          parts,
          id: es.id,
          subjectId: es.subject_id,
          code: es.code,
          name: es.name,
          maxMarks: es.max_marks,
          passMarks: es.pass_marks,
          entryLocked: es.entry_locked,
          gradeOnly: Number(es.max_marks) === 0,
        },
        section: { id: section.id, code: section.code },
        codes: codes.rows,
        grades,
        status,
        rows: r.rows.map((x) => ({
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          rollNo: x.roll_no,
          parts: byStudent.get(x.student_id) ?? {},
          marks: x.marks,
          absent: x.absent ?? false,
          exempt: x.exempt ?? false,
          code: x.code,
          grade: x.grade,
          taken: x.kind,
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
      const es = await this.examSubject(c, examId, section.class_id, dto.subjectId);
      const inParts = await c.query(
        `SELECT 1 FROM exam_subject_parts WHERE exam_subject_id = $1 LIMIT 1`,
        [es.id],
      );
      if (inParts.rowCount)
        throw new DomainError(
          'exams.entered_in_parts',
          'This subject is entered in parts; enter each part and the total is worked out',
          { status: 409 },
        );
      await this.assertMayEnter(c, tenant, yearId, section.id, MARKS, dto.subjectId);
      await this.assertEntryOpen(c, es.id, section.id);
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      const r = await c
        .query<{ o_inserted: number; o_updated: number }>(
          `SELECT o_inserted, o_updated FROM app.enter_marks($1, $2::jsonb)`,
          [es.id, JSON.stringify(dto.rows)],
        )
        .catch((error: unknown) => {
          throw asMarksError(error);
        });
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

  /**
   * One part of an exam subject for a section. The part's teacher enters it (the teacher of the part's
   * teaching subject, or of the exam subject; the class teacher and coordinators any). The exam subject's
   * marks are the sum of the parts entered so far; a pupil absent in every part is absent in the subject.
   */
  async putPartMarks(ctx: RequestContext, examId: string, dto: PutPartMarksDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.exam(c, examId, yearId);
      const section = await this.section(c, dto.classSectionId, yearId, examId);
      const p = await c.query<{
        id: string;
        name: string;
        subject_id: string | null;
        max_marks: string;
        es_id: string;
        es_subject: string;
      }>(
        `SELECT p.id::text, p.name, p.subject_id::text, p.max_marks::text, es.id::text AS es_id, es.subject_id::text AS es_subject
           FROM exam_subject_parts p JOIN exam_subjects es ON es.id = p.exam_subject_id
          WHERE p.id = $1 AND es.exam_id = $2 AND es.class_id = $3`,
        [dto.partId, examId, section.class_id],
      );
      const part = p.rows[0];
      if (!part)
        throw new DomainError('not-found', 'This part is not in the exam for this class', {
          status: 404,
        });
      try {
        await this.assertMayEnter(
          c,
          tenant,
          yearId,
          section.id,
          MARKS,
          part.subject_id ?? part.es_subject,
        );
      } catch (error) {
        // the teacher of the report-card subject itself may enter any of its parts
        if (!(error instanceof DomainError) || !part.subject_id) throw error;
        await this.assertMayEnter(c, tenant, yearId, section.id, MARKS, part.es_subject);
      }
      await this.assertEntryOpen(c, part.es_id, section.id);
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      for (const r of dto.rows) {
        const marks = r.absent ? null : (r.marks ?? null);
        if (!r.absent && marks === null) {
          await c.query(`DELETE FROM mark_part_entries WHERE part_id = $1 AND student_id = $2`, [
            part.id,
            r.studentId,
          ]);
          continue;
        }
        if (marks !== null && marks > Number(part.max_marks))
          throw new DomainError(
            'exams.marks_out_of_range',
            `Marks above the maximum of ${part.max_marks} for ${part.name}`,
            { status: 422, extra: { studentId: r.studentId } },
          );
        await c.query(
          `INSERT INTO mark_part_entries (school_id, part_id, student_id, marks, absent, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
           ON CONFLICT (part_id, student_id) DO UPDATE SET marks = EXCLUDED.marks, absent = EXCLUDED.absent, entered_by = EXCLUDED.entered_by, updated_at = now()`,
          [part.id, r.studentId, marks, r.absent],
        );
      }
      // the subject's marks follow: the sum of the parts entered; absent in every part = absent
      const totals = await c.query<{
        student_id: string;
        total: string | null;
        n: number;
        absent_n: number;
      }>(
        `SELECT m.student_id::text, sum(m.marks)::text AS total, count(*)::int AS n, count(*) FILTER (WHERE m.absent)::int AS absent_n
           FROM mark_part_entries m JOIN exam_subject_parts p ON p.id = m.part_id
          WHERE p.exam_subject_id = $1 AND m.student_id = ANY($2::bigint[]) GROUP BY m.student_id`,
        [part.es_id, dto.rows.map((r) => r.studentId)],
      );
      const rows = totals.rows.map((t) =>
        t.absent_n === t.n
          ? { studentId: t.student_id, marks: null, absent: true, exempt: false }
          : { studentId: t.student_id, marks: Number(t.total ?? 0), absent: false, exempt: false },
      );
      // app.enter_marks keeps the locks and the range of the whole subject
      if (rows.length)
        await c.query(`SELECT o_inserted FROM app.enter_marks($1, $2::jsonb)`, [
          part.es_id,
          JSON.stringify(rows),
        ]);
      const cleared = dto.rows
        .map((r) => r.studentId)
        .filter((id) => !totals.rows.some((t) => t.student_id === id));
      if (cleared.length)
        await c.query(
          `DELETE FROM mark_entries WHERE exam_subject_id = $1 AND student_id = ANY($2::bigint[])`,
          [part.es_id, cleared],
        );
      await this.audit.stage(ctx, c, {
        action: 'exams.marks.enter_part',
        entityType: 'exam_subject_parts',
        entityId: part.id,
        after: { examId, classSectionId: section.id, part: part.name, rows: dto.rows.length },
      });
      return { saved: dto.rows.length };
    });
  }

  // ---- indicators --------------------------------------------------------------------------------
  /** The class's set in the exam with its items (docs/design/65 part 5: a tree, levels or text). */
  async classSet(c: PoolClient, examId: string, classId: string) {
    const set = await c.query<{
      id: string;
      code: string;
      name: string;
      grades: string[];
      kind: 'indicators' | 'hpc';
      level_words: Record<string, string>;
    }>(
      `SELECT s.id::text, s.code, s.name, s.grades, s.kind, s.level_words FROM exam_indicator_sets x JOIN indicator_sets s ON s.id = x.set_id
        WHERE x.exam_id = $1 AND x.class_id = $2 AND s.deleted_at IS NULL`,
      [examId, classId],
    );
    const s = set.rows[0];
    if (!s) return null;
    const ind = await c.query<{
      id: string;
      code: string;
      name: string;
      area: string | null;
      parent_id: string | null;
      kind: 'level' | 'text';
      description: string | null;
      descriptors: Record<string, string>;
    }>(
      `SELECT id::text, code, name, area, parent_id::text, kind, description, descriptors FROM indicators WHERE set_id = $1 ORDER BY sort_order, code`,
      [s.id],
    );
    const parents = new Set(ind.rows.map((i) => i.parent_id).filter(Boolean));
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      grades: s.grades,
      kind: s.kind,
      levelWords: s.level_words,
      indicators: ind.rows.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        area: i.area,
        parentId: i.parent_id,
        kind: i.kind,
        description: i.description,
        descriptors: i.descriptors,
        /** has items under it: a heading, not entered */
        heading: parents.has(i.id),
      })),
    };
  }

  async indicators(ctx: RequestContext, examId: string, q: EntryQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const section = await this.section(c, q.classSectionId, yearId, examId);
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', section.id);
      const set = await this.classSet(c, examId, section.class_id);
      const roster = await this.roster(c, yearId, section.id);
      const entries = await c.query<{
        student_id: string;
        indicator_id: string;
        grade: string | null;
        note: string | null;
      }>(
        `SELECT ie.student_id::text, ie.indicator_id::text, ie.grade, ie.note FROM indicator_entries ie
           JOIN enrolments e ON e.student_id = ie.student_id AND e.class_section_id = $2 AND e.academic_year_id = $3 AND e.status = 'active'
          WHERE ie.exam_id = $1`,
        [examId, section.id, yearId],
      );
      const byStudent = new Map<
        string,
        Record<string, { grade: string | null; note: string | null }>
      >();
      for (const e of entries.rows) {
        const m = byStudent.get(e.student_id) ?? {};
        m[e.indicator_id] = { grade: e.grade, note: e.note };
        byStudent.set(e.student_id, m);
      }
      // the HPC's words (the child's, the parent's, the teacher's) and portfolio photos per student
      const fb = new Map<string, Record<string, { text: string; byFamily: boolean }>>();
      const photos = new Map<string, number>();
      if (set?.kind === 'hpc') {
        const f = await c.query<{
          student_id: string;
          kind: string;
          text: string;
          by_family: boolean;
        }>(
          `SELECT student_id::text, kind, text, by_family FROM hpc_feedback WHERE exam_id = $1 AND student_id = ANY($2::bigint[])`,
          [examId, roster.map((r) => r.studentId)],
        );
        for (const x of f.rows) {
          const m = fb.get(x.student_id) ?? {};
          m[x.kind] = { text: x.text, byFamily: x.by_family };
          fb.set(x.student_id, m);
        }
        const p = await c.query<{ student_id: string; n: number }>(
          `SELECT student_id::text, count(*)::int AS n FROM portfolio_items
            WHERE exam_id = $1 AND student_id = ANY($2::bigint[]) AND deleted_at IS NULL GROUP BY student_id`,
          [examId, roster.map((r) => r.studentId)],
        );
        for (const x of p.rows) photos.set(x.student_id, x.n);
      }
      const lock = await c.query<{ locked: boolean }>(
        `SELECT indicators_locked AS locked FROM exam_classes WHERE exam_id = $1 AND class_id = $2`,
        [examId, section.class_id],
      );
      return {
        exam: { id: exam.id, code: exam.code, name: exam.name, marksLocked: exam.marks_locked },
        section: { id: section.id, code: section.code },
        locked: exam.marks_locked || Boolean(lock.rows[0]?.locked),
        set: set
          ? {
              id: set.id,
              code: set.code,
              name: set.name,
              grades: set.grades,
              kind: set.kind,
              levelWords: set.levelWords,
            }
          : null,
        indicators: set?.indicators ?? [],
        rows: roster.map((s) => ({
          ...s,
          grades: byStudent.get(s.studentId) ?? {},
          ...(set?.kind === 'hpc'
            ? { feedback: fb.get(s.studentId) ?? {}, photos: photos.get(s.studentId) ?? 0 }
            : {}),
        })),
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
      await this.assertTypeOpen(c, examId, section.class_id, INDICATORS);
      await c.query(`SELECT app.assert_year_open($1, 'exams')`, [yearId]);
      const set = await this.classSet(c, examId, section.class_id);
      if (!set)
        throw new DomainError(
          'exams.no_indicator_set',
          'No indicator set is assigned to this class',
          { status: 409 },
        );
      const items = new Map(set.indicators.map((i) => [i.id, i]));
      const grades = new Set(set.grades);
      this.assertRoster(dto.rows, await this.roster(c, yearId, section.id));
      for (const r of dto.rows) {
        const it = items.get(r.indicatorId);
        if (!it)
          throw new DomainError('exams.indicator_not_in_set', 'Indicator is not in the class set', {
            status: 409,
            extra: { indicatorId: r.indicatorId },
          });
        if (it.heading)
          throw new DomainError(
            'exams.indicator_heading',
            `${it.name} is a heading: its items are entered`,
            { status: 409, extra: { indicatorId: r.indicatorId } },
          );
        if (r.grade && it.kind === 'text')
          throw new DomainError(
            'exams.indicator_text',
            `${it.name} takes a written observation, not a level`,
            { status: 409, extra: { indicatorId: r.indicatorId } },
          );
        if (r.grade && !grades.has(r.grade))
          throw new DomainError('exams.grade_not_allowed', `Grade ${r.grade} is not in the set`, {
            status: 409,
            extra: { grade: r.grade, allowed: [...grades] },
          });
      }
      let n = 0;
      for (const r of dto.rows) {
        const grade = r.grade || null;
        const note = r.note?.trim() || null;
        if (!grade && !note) {
          const d = await c.query(
            `DELETE FROM indicator_entries WHERE exam_id = $1 AND indicator_id = $2 AND student_id = $3`,
            [examId, r.indicatorId, r.studentId],
          );
          n += d.rowCount ?? 0;
          continue;
        }
        const u = await c.query(
          `INSERT INTO indicator_entries (school_id, exam_id, indicator_id, student_id, grade, note, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())
           ON CONFLICT (exam_id, indicator_id, student_id) DO UPDATE SET grade = EXCLUDED.grade, note = EXCLUDED.note, entered_by = app.current_user_id()
           WHERE indicator_entries.grade IS DISTINCT FROM EXCLUDED.grade OR indicator_entries.note IS DISTINCT FROM EXCLUDED.note`,
          [examId, r.indicatorId, r.studentId, grade, note],
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
        participation: string | null;
        promoted_to: string | null;
        days_present: number | null;
        days_total: number | null;
        height_cm: string | null;
        weight_kg: string | null;
        bmi: string | null;
        blood_group: string | null;
        recorded_on: string | null;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
                rm.remark, rm.bank_code, rm.participation, rm.promoted_to, ea.days_present, ea.days_total,
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
        `SELECT code, text FROM remark_bank WHERE status = 'active' AND category_id IS NULL AND (class_id IS NULL OR class_id = $1)
          ORDER BY sort_order, code`,
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
          participation: x.participation,
          promotedTo: x.promoted_to,
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
    await this.assertTypeOpen(c, examId, section.class_id, kind);
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
          `INSERT INTO exam_remarks (school_id, exam_id, student_id, remark, bank_code, participation, promoted_to, entered_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())
           ON CONFLICT (exam_id, student_id) DO UPDATE SET remark = EXCLUDED.remark, bank_code = EXCLUDED.bank_code,
             participation = EXCLUDED.participation, promoted_to = EXCLUDED.promoted_to, entered_by = app.current_user_id()
           WHERE exam_remarks.remark IS DISTINCT FROM EXCLUDED.remark OR exam_remarks.bank_code IS DISTINCT FROM EXCLUDED.bank_code
              OR exam_remarks.participation IS DISTINCT FROM EXCLUDED.participation
              OR exam_remarks.promoted_to IS DISTINCT FROM EXCLUDED.promoted_to`,
          [
            examId,
            r.studentId,
            r.remark,
            r.bankCode ?? null,
            r.participation?.trim() || null,
            r.promotedTo?.trim() || null,
          ],
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
    return this.db.tenant(requireTenant(ctx), async (c) => this.setsOf(c));
  }

  private async setsOf(c: PoolClient) {
    const sets = await c.query<{
      id: string;
      code: string;
      name: string;
      grades: string[];
      status: string;
      kind: string;
      level_words: Record<string, string>;
    }>(
      `SELECT id::text, code, name, grades, status::text, kind, level_words FROM indicator_sets WHERE deleted_at IS NULL ORDER BY code`,
    );
    const ind = await c.query<{
      id: string;
      set_id: string;
      code: string;
      name: string;
      area: string | null;
      sort_order: number;
      parent_code: string | null;
      kind: string;
      description: string | null;
      descriptors: Record<string, string>;
    }>(
      `SELECT i.id::text, i.set_id::text, i.code, i.name, i.area, i.sort_order, p.code AS parent_code, i.kind, i.description, i.descriptors
         FROM indicators i LEFT JOIN indicators p ON p.id = i.parent_id ORDER BY i.set_id, i.sort_order, i.code`,
    );
    return sets.rows.map(({ level_words, ...s }) => ({
      ...s,
      levelWords: level_words,
      indicators: ind.rows
        .filter((i) => i.set_id === s.id)
        .map((i) => ({
          id: i.id,
          code: i.code,
          name: i.name,
          area: i.area,
          sortOrder: i.sort_order,
          parentCode: i.parent_code,
          kind: i.kind,
          description: i.description,
          descriptors: i.descriptors,
        })),
    }));
  }

  /** A set with its items; docs/design/65 part 5: an item under another (one level deep), levels or text. */
  async upsertIndicatorSet(ctx: RequestContext, dto: UpsertIndicatorSetDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const id = await this.writeSet(c, dto);
      await this.audit.stage(ctx, c, {
        action: 'exams.indicator_set.upsert',
        entityType: 'indicator_sets',
        entityId: id,
        after: { code: dto.code, kind: dto.kind, grades: dto.grades, items: dto.indicators.length },
      });
      return { id };
    });
  }

  async writeSet(c: PoolClient, dto: UpsertIndicatorSetDto) {
    const codes = new Set<string>();
    for (const i of dto.indicators) {
      if (codes.has(i.code))
        throw new DomainError('validation-failed', `The code ${i.code} is used twice`, {
          status: 400,
        });
      codes.add(i.code);
    }
    const byCode = new Map(dto.indicators.map((i) => [i.code, i]));
    for (const i of dto.indicators) {
      if (!i.parentCode) continue;
      const p = byCode.get(i.parentCode);
      if (!p || p.code === i.code)
        throw new DomainError(
          'validation-failed',
          `${i.code}: no item ${i.parentCode} to go under`,
          {
            status: 400,
          },
        );
      if (p.parentCode)
        throw new DomainError(
          'validation-failed',
          `${i.code}: ${p.code} is itself under another item (three levels at most: area, item, sub-item)`,
          { status: 400 },
        );
    }
    for (const [lvl] of Object.entries(dto.levelWords))
      if (!dto.grades.includes(lvl))
        throw new DomainError('validation-failed', `${lvl} is not one of the levels`, {
          status: 400,
        });
    const s = await c.query<{ id: string }>(
      `INSERT INTO indicator_sets (school_id, code, name, grades, kind, level_words, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, app.current_user_id(), app.current_user_id())
       ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE
         SET name = EXCLUDED.name, grades = EXCLUDED.grades, kind = EXCLUDED.kind, level_words = EXCLUDED.level_words,
             updated_by = app.current_user_id()
       RETURNING id::text`,
      [dto.code, dto.name, dto.grades, dto.kind, JSON.stringify(dto.levelWords)],
    );
    const setId = s.rows[0]!.id;
    await c.query(`DELETE FROM indicators WHERE set_id = $1 AND NOT (code = ANY($2::text[]))`, [
      setId,
      [...codes],
    ]);
    // the items first, then who goes under whom
    for (const i of dto.indicators) {
      await c.query(
        `INSERT INTO indicators (school_id, set_id, code, name, area, sort_order, kind, description, descriptors)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (set_id, code) DO UPDATE SET name = EXCLUDED.name, area = EXCLUDED.area, sort_order = EXCLUDED.sort_order,
           kind = EXCLUDED.kind, description = EXCLUDED.description, descriptors = EXCLUDED.descriptors`,
        [
          setId,
          i.code,
          i.name,
          i.area ?? null,
          i.sortOrder,
          i.kind,
          i.description ?? null,
          JSON.stringify(i.descriptors),
        ],
      );
    }
    await c.query(
      `UPDATE indicators i SET parent_id = p.id
         FROM jsonb_to_recordset($2::jsonb) AS x(code TEXT, "parentCode" TEXT)
         LEFT JOIN indicators p ON p.set_id = $1 AND p.code = x."parentCode"
        WHERE i.set_id = $1 AND i.code = x.code AND i.parent_id IS DISTINCT FROM p.id`,
      [
        setId,
        JSON.stringify(
          dto.indicators.map((i) => ({ code: i.code, parentCode: i.parentCode ?? null })),
        ),
      ],
    );
    return setId;
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

  async remarkBank(ctx: RequestContext, all = false) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        code: string;
        text: string;
        class_id: string | null;
        class_code: string | null;
        sort_order: number;
        category_code: string | null;
        status: string;
      }>(
        `SELECT b.id::text, b.code, b.text, b.class_id::text, k.code AS class_code, b.sort_order, rc.code AS category_code, b.status::text
           FROM remark_bank b LEFT JOIN classes k ON k.id = b.class_id LEFT JOIN remark_categories rc ON rc.id = b.category_id
          WHERE b.status = 'active' OR $1 ORDER BY rc.sort_order NULLS FIRST, b.sort_order, b.code`,
        [all],
      );
      return r.rows.map((x) => ({
        id: x.id,
        code: x.code,
        text: x.text,
        classId: x.class_id,
        classCode: x.class_code,
        sortOrder: x.sort_order,
        /** docs/design/65 part 7: the category the remark is offered in (none: the general remark) */
        categoryCode: x.category_code,
        status: x.status,
      }));
    });
  }

  async upsertRemarkBank(ctx: RequestContext, dto: UpsertRemarkBankDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const e of dto.entries) {
        if (e.categoryCode) {
          const k = await c.query(`SELECT 1 FROM remark_categories WHERE code = $1`, [
            e.categoryCode,
          ]);
          if (!k.rowCount)
            throw new DomainError('not-found', `No remark category ${e.categoryCode}`, {
              status: 404,
            });
        }
        await c.query(
          `INSERT INTO remark_bank (school_id, code, text, class_id, sort_order, category_id, status)
           VALUES (app.current_school_id(), $1, $2, $3, $4, (SELECT id FROM remark_categories WHERE code = $5), $6::row_status)
           ON CONFLICT (school_id, code) DO UPDATE SET text = EXCLUDED.text, class_id = EXCLUDED.class_id, sort_order = EXCLUDED.sort_order,
             category_id = EXCLUDED.category_id, status = EXCLUDED.status`,
          [e.code, e.text, e.classId ?? null, e.sortOrder, e.categoryCode ?? null, e.status],
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

  // ---- marks by Excel (docs/design/65) -------------------------------------------------------------
  /** The columns of a marks sheet: one value per subject, or one per part. */
  private valueColumns(sheet: MarksSheet) {
    const es = sheet.examSubject;
    if (es.parts.length)
      return es.parts.map((p) => ({
        partId: p.id as string | null,
        header: `${p.name} (out of ${num(p.maxMarks)})`,
        max: Number(p.maxMarks),
      }));
    return [
      {
        partId: null as string | null,
        header: es.gradeOnly ? 'Grade' : `Marks (out of ${num(es.maxMarks)})`,
        max: Number(es.maxMarks),
      },
    ];
  }

  /** A section's marks of one subject as an Excel sheet to fill (the marks already entered in it). */
  async marksExcel(ctx: RequestContext, examId: string, q: EntryQueryDto) {
    const sheet = await this.marks(ctx, examId, q);
    const es = sheet.examSubject;
    const cols = this.valueColumns(sheet);
    const valueOf = (r: MarkRow, partId: string | null) => {
      if (partId) {
        const p = r.parts[partId];
        return p ? (p.absent ? 'AB' : p.marks === null ? null : Number(p.marks)) : null;
      }
      return r.code ?? r.grade ?? (r.marks === null ? null : Number(r.marks));
    };
    const bytes = await templateSheet({
      sheet: 'Marks',
      columns: [
        { header: 'Admission no', width: 16, required: true, format: 'text' },
        { header: 'Roll no', width: 8 },
        { header: 'Name', width: 28 },
        ...cols.map((c) => ({
          header: c.header,
          width: 20,
          ...(es.gradeOnly ? { options: sheet.grades } : {}),
          note: es.gradeOnly
            ? 'A grade of the scale, or a code'
            : `0 to ${String(c.max)}, or a code${es.parts.length ? ' (AB only in a part)' : ''}`,
        })),
      ],
      guide: [
        `${sheet.exam.name} · ${sheet.section.code} · ${es.name}`,
        es.gradeOnly
          ? 'Write a grade of the scale in the Grade column.'
          : 'Write the marks, from 0 to the maximum shown in the heading.',
        `Instead of marks, a code: ${sheet.codes.map((x) => `${x.code} (${x.name})`).join(', ')}.`,
        'Leave a cell empty to keep what is entered; students who do not take the subject are not listed.',
        'Do not change the Admission no column; upload the sheet on the marks screen, check the preview, then save.',
      ],
      rows: sheet.rows
        .filter((r) => r.taken)
        .map((r) => [r.admissionNo, r.rollNo, r.name, ...cols.map((c) => valueOf(r, c.partId))]),
    });
    return {
      filename: `marks-${sheet.exam.code}-${sheet.section.code}-${es.code}.xlsx`
        .toLowerCase()
        .replace(/[^\w.-]+/g, '-'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  /**
   * An uploaded marks sheet: every row checked (the student is in the section and takes the subject; the
   * value is a mark in range, a code, or a grade of the scale); nothing is saved until `apply` and no
   * row has an error.
   */
  async marksUpload(ctx: RequestContext, examId: string, dto: MarksUploadDto) {
    const sheet = await this.marks(ctx, examId, {
      classSectionId: dto.classSectionId,
      subjectId: dto.subjectId,
    });
    const es = sheet.examSubject;
    const cols = this.valueColumns(sheet);
    const rows = await readSheet(dto.file, ['Admission no', ...cols.map((c) => c.header)]);
    const byNo = new Map(sheet.rows.map((r) => [r.admissionNo.trim().toLowerCase(), r]));
    const codes = new Set(sheet.codes.map((x) => x.code));
    const grades = new Set(sheet.grades);
    const seen = new Set<string>();
    const checked = rows.map(({ row, cells }) => {
      const no = cells['Admission no']!.trim();
      const student = byNo.get(no.toLowerCase());
      const values: Record<string, string> = {};
      const parsed: Array<{
        partId: string | null;
        marks: number | null;
        code: string | null;
        grade: string | null;
      }> = [];
      let error: string | null = null;
      if (!student) error = `No student with admission no ${no} in ${sheet.section.code}`;
      else if (seen.has(student.studentId)) error = 'The student is in the sheet twice';
      else if (!student.taken) error = 'Does not take this subject';
      if (student) seen.add(student.studentId);
      for (const c of cols) {
        const raw = (cells[c.header] ?? '').trim();
        values[c.header] = raw;
        if (raw === '' || error) continue;
        const up = raw.toUpperCase();
        if (codes.has(up)) {
          if (c.partId && up !== 'AB') error = `${c.header}: only AB in a part`;
          else parsed.push({ partId: c.partId, marks: null, code: up, grade: null });
        } else if (es.gradeOnly) {
          if (!grades.has(raw)) error = `${raw} is not a grade of the scale`;
          else parsed.push({ partId: null, marks: null, code: null, grade: raw });
        } else {
          const n = Number(raw);
          if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(n >= 0 && n <= c.max))
            error = `${c.header}: ${raw} is not 0 to ${String(c.max)} or a code`;
          else parsed.push({ partId: c.partId, marks: n, code: null, grade: null });
        }
      }
      return { row, admissionNo: no, name: student?.name ?? null, student, values, parsed, error };
    });
    const errors = checked.filter((x) => x.error).length;
    const preview = {
      columns: cols.map((c) => c.header),
      rows: checked.map((x) => ({
        row: x.row,
        admissionNo: x.admissionNo,
        name: x.name,
        values: x.values,
        error: x.error,
      })),
      ready: checked.filter((x) => !x.error && x.parsed.length).length,
      errors,
      applied: false,
    };
    if (!dto.apply || errors || !preview.ready) return preview;
    if (es.parts.length) {
      for (const c of cols) {
        const partRows = checked.flatMap((x) =>
          x.parsed
            .filter((v) => v.partId === c.partId)
            .map((v) => ({
              studentId: x.student!.studentId,
              marks: v.marks,
              absent: v.code === 'AB',
            })),
        );
        if (partRows.length)
          await this.putPartMarks(ctx, examId, {
            classSectionId: dto.classSectionId,
            partId: c.partId!,
            rows: partRows,
          });
      }
    } else
      await this.putMarks(ctx, examId, {
        classSectionId: dto.classSectionId,
        subjectId: dto.subjectId,
        rows: checked
          .filter((x) => x.parsed.length)
          .map((x) => {
            const v = x.parsed[0]!;
            return {
              studentId: x.student!.studentId,
              marks: v.marks,
              code: v.code,
              grade: v.grade,
              absent: false,
              exempt: false,
            };
          }),
      });
    return { ...preview, applied: true };
  }
}
