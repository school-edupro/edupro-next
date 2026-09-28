import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { EXAMS } from './exams.dto';

export interface RegisterSheet {
  exam: { id: string; code: string; name: string; marksLocked: boolean; computedAt: string | null };
  section: { id: string; code: string };
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
  }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    marks: Record<string, { marks: string | null; absent: boolean; exempt: boolean }>;
    total: string | null;
    maxTotal: string | null;
    pct: string | null;
    grade: string | null;
    result: string | null;
    rankInSection: number | null;
    rankInClass: number | null;
    failedSubjects: number | null;
  }>;
}

export interface Analysis {
  exam: { id: string; code: string; name: string; computedAt: string | null };
  classId: string | null;
  totals: {
    pupils: number;
    complete: number;
    pass: number;
    fail: number;
    incomplete: number;
    passPct: number | null;
    meanPct: number | null;
  };
  subjects: Array<{
    classCode: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    pupils: number;
    entered: number;
    absent: number;
    exempt: number;
    mean: string | null;
    highest: string | null;
    lowest: string | null;
    passPct: number | null;
  }>;
  grades: Array<{ grade: string; pupils: number }>;
  sections: Array<{
    section: string;
    pupils: number;
    complete: number;
    meanPct: number | null;
    passPct: number | null;
  }>;
  toppers: Array<{
    section: string;
    name: string;
    admissionNo: string;
    pct: string;
    grade: string | null;
    rankInClass: number | null;
  }>;
}

/**
 * Sprint 16: exam results (app.compute_exam_results) and what reads them — the register sheet, the
 * analysis and the promotion proposals. Views follow the entry scope: a teacher sees the sections held.
 */
@Injectable()
export class ExamResultsService {
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
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      marks_locked: boolean;
      computed_at: Date | null;
    }>(
      `SELECT e.id::text, e.code, e.name, e.marks_locked, (SELECT max(computed_at) FROM exam_results x WHERE x.exam_id = e.id) AS computed_at
         FROM exams e WHERE e.id = $1 AND e.academic_year_id = $2 AND e.deleted_at IS NULL`,
      [id, yearId],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Exam not found in the working year', { status: 404 });
    return r.rows[0];
  }

  async compute(ctx: RequestContext, examId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const r = await c.query<{ n: number }>(`SELECT app.compute_exam_results($1) AS n`, [examId]);
      await this.audit.stage(ctx, c, {
        action: 'exams.results.compute',
        entityType: 'exams',
        entityId: exam.id,
        after: { results: r.rows[0]!.n },
      });
      return { results: r.rows[0]!.n };
    });
  }

  async registerSheet(
    ctx: RequestContext,
    examId: string,
    sectionId: string,
  ): Promise<RegisterSheet> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', sectionId);
      const sec = await c.query<{ id: string; class_id: string; code: string }>(
        `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.id = $1 AND cs.academic_year_id = $2 AND EXISTS (SELECT 1 FROM exam_classes ec WHERE ec.exam_id = $3 AND ec.class_id = cs.class_id)`,
        [sectionId, yearId, examId],
      );
      if (!sec.rows[0])
        throw new DomainError('exams.section_not_in_exam', 'This section is not part of the exam', {
          status: 404,
        });
      const subjects = await c.query<{
        id: string;
        code: string;
        name: string;
        max_marks: string;
        pass_marks: string | null;
      }>(
        `SELECT es.id::text, sub.code, sub.name, es.max_marks::text, es.pass_marks::text FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
          WHERE es.exam_id = $1 AND es.class_id = $2 ORDER BY sub.display_order, sub.code`,
        [examId, sec.rows[0].class_id],
      );
      const rows = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        roll_no: number | null;
        marks: Record<string, { marks: string | null; absent: boolean; exempt: boolean }> | null;
        total: string | null;
        max_total: string | null;
        pct: string | null;
        grade: string | null;
        result: string | null;
        rank_in_section: number | null;
        rank_in_class: number | null;
        failed_subjects: number | null;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
                (SELECT jsonb_object_agg(m.exam_subject_id::text, jsonb_build_object('marks', m.marks::text, 'absent', m.absent, 'exempt', m.exempt))
                   FROM mark_entries m JOIN exam_subjects es ON es.id = m.exam_subject_id WHERE es.exam_id = $3 AND m.student_id = s.id) AS marks,
                r.total::text, r.max_total::text, r.pct::text, r.grade, r.result, r.rank_in_section, r.rank_in_class, r.failed_subjects
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           LEFT JOIN exam_results r ON r.exam_id = $3 AND r.student_id = s.id
          WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
          ORDER BY e.roll_no NULLS LAST, s.display_name`,
        [sectionId, yearId, examId],
      );
      return {
        exam: {
          id: exam.id,
          code: exam.code,
          name: exam.name,
          marksLocked: exam.marks_locked,
          computedAt: exam.computed_at?.toISOString() ?? null,
        },
        section: { id: sec.rows[0].id, code: sec.rows[0].code },
        subjects: subjects.rows.map((x) => ({
          id: x.id,
          code: x.code,
          name: x.name,
          maxMarks: x.max_marks,
          passMarks: x.pass_marks,
        })),
        rows: rows.rows.map((x) => ({
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          rollNo: x.roll_no,
          marks: x.marks ?? {},
          total: x.total,
          maxTotal: x.max_total,
          pct: x.pct,
          grade: x.grade,
          result: x.result,
          rankInSection: x.rank_in_section,
          rankInClass: x.rank_in_class,
          failedSubjects: x.failed_subjects,
        })),
      };
    });
  }

  async analysis(ctx: RequestContext, examId: string, classId?: string): Promise<Analysis> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
      const params = [examId, classId ?? null, allowed];
      const totals = await c.query<{
        pupils: number;
        complete: number;
        pass: number;
        fail: number;
        incomplete: number;
        mean_pct: string | null;
      }>(
        `SELECT count(*)::int AS pupils, count(*) FILTER (WHERE result <> 'incomplete')::int AS complete,
                count(*) FILTER (WHERE result = 'pass')::int AS pass, count(*) FILTER (WHERE result = 'fail')::int AS fail,
                count(*) FILTER (WHERE result = 'incomplete')::int AS incomplete, round(avg(pct) FILTER (WHERE result <> 'incomplete'), 1)::text AS mean_pct
           FROM exam_results r WHERE r.exam_id = $1 AND ($2::bigint IS NULL OR r.class_id = $2) AND ($3::bigint[] IS NULL OR r.class_section_id = ANY($3::bigint[]))`,
        params,
      );
      const subjects = await c.query<{
        class_code: string;
        code: string;
        name: string;
        max_marks: string;
        pass_marks: string | null;
        pupils: number;
        entered: number;
        absent: number;
        exempt: number;
        mean: string | null;
        highest: string | null;
        lowest: string | null;
        pass_pct: string | null;
      }>(
        `SELECT k.code AS class_code, sub.code, sub.name, es.max_marks::text, es.pass_marks::text,
                count(DISTINCT e.student_id)::int AS pupils, count(m.id) FILTER (WHERE NOT m.absent AND NOT m.exempt)::int AS entered,
                count(m.id) FILTER (WHERE m.absent)::int AS absent, count(m.id) FILTER (WHERE m.exempt)::int AS exempt,
                round(avg(m.marks) FILTER (WHERE NOT m.absent AND NOT m.exempt), 2)::text AS mean,
                max(m.marks) FILTER (WHERE NOT m.absent AND NOT m.exempt)::text AS highest, min(m.marks) FILTER (WHERE NOT m.absent AND NOT m.exempt)::text AS lowest,
                CASE WHEN es.pass_marks IS NOT NULL AND count(m.id) FILTER (WHERE NOT m.exempt) > 0
                     THEN round(count(m.id) FILTER (WHERE NOT m.absent AND NOT m.exempt AND m.marks >= es.pass_marks)::numeric * 100 / count(m.id) FILTER (WHERE NOT m.exempt), 1)::text END AS pass_pct
           FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id JOIN classes k ON k.id = es.class_id
           JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = (SELECT academic_year_id FROM exams WHERE id = $1) AND cs.deleted_at IS NULL
           JOIN enrolments e ON e.class_section_id = cs.id AND e.academic_year_id = cs.academic_year_id AND e.status = 'active'
           LEFT JOIN mark_entries m ON m.exam_subject_id = es.id AND m.student_id = e.student_id
          WHERE es.exam_id = $1 AND ($2::bigint IS NULL OR es.class_id = $2) AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))
          GROUP BY k.display_order, k.code, sub.display_order, sub.code, sub.name, es.max_marks, es.pass_marks
          ORDER BY k.display_order, sub.display_order`,
        params,
      );
      const grades = await c.query<{ grade: string; pupils: number }>(
        `SELECT COALESCE(grade, '—') AS grade, count(*)::int AS pupils FROM exam_results r
          WHERE r.exam_id = $1 AND r.result <> 'incomplete' AND ($2::bigint IS NULL OR r.class_id = $2) AND ($3::bigint[] IS NULL OR r.class_section_id = ANY($3::bigint[]))
          GROUP BY grade ORDER BY min(pct) DESC`,
        params,
      );
      const sections = await c.query<{
        section: string;
        pupils: number;
        complete: number;
        mean_pct: string | null;
        pass_pct: string | null;
      }>(
        `SELECT k.code || '-' || cs.name AS section, count(*)::int AS pupils, count(*) FILTER (WHERE r.result <> 'incomplete')::int AS complete,
                round(avg(r.pct) FILTER (WHERE r.result <> 'incomplete'), 1)::text AS mean_pct,
                CASE WHEN count(*) FILTER (WHERE r.result <> 'incomplete') > 0 THEN round(count(*) FILTER (WHERE r.result = 'pass')::numeric * 100 / count(*) FILTER (WHERE r.result <> 'incomplete'), 1)::text END AS pass_pct
           FROM exam_results r JOIN class_sections cs ON cs.id = r.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE r.exam_id = $1 AND ($2::bigint IS NULL OR r.class_id = $2) AND ($3::bigint[] IS NULL OR r.class_section_id = ANY($3::bigint[]))
          GROUP BY k.display_order, k.code, cs.name ORDER BY k.display_order, cs.name`,
        params,
      );
      const toppers = await c.query<{
        section: string;
        name: string;
        admission_no: string;
        pct: string;
        grade: string | null;
        rank_in_class: number | null;
      }>(
        `SELECT k.code || '-' || cs.name AS section, s.display_name AS name, s.admission_no, r.pct::text, r.grade, r.rank_in_class
           FROM exam_results r JOIN students s ON s.id = r.student_id JOIN class_sections cs ON cs.id = r.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE r.exam_id = $1 AND r.result <> 'incomplete' AND ($2::bigint IS NULL OR r.class_id = $2) AND ($3::bigint[] IS NULL OR r.class_section_id = ANY($3::bigint[]))
          ORDER BY r.pct DESC, s.display_name LIMIT 10`,
        params,
      );
      const t = totals.rows[0]!;
      return {
        exam: {
          id: exam.id,
          code: exam.code,
          name: exam.name,
          computedAt: exam.computed_at?.toISOString() ?? null,
        },
        classId: classId ?? null,
        totals: {
          pupils: t.pupils,
          complete: t.complete,
          pass: t.pass,
          fail: t.fail,
          incomplete: t.incomplete,
          passPct: t.complete ? Math.round((t.pass * 1000) / t.complete) / 10 : null,
          meanPct: t.mean_pct === null ? null : Number(t.mean_pct),
        },
        subjects: subjects.rows.map((x) => ({
          classCode: x.class_code,
          code: x.code,
          name: x.name,
          maxMarks: x.max_marks,
          passMarks: x.pass_marks,
          pupils: x.pupils,
          entered: x.entered,
          absent: x.absent,
          exempt: x.exempt,
          mean: x.mean,
          highest: x.highest,
          lowest: x.lowest,
          passPct: x.pass_pct === null ? null : Number(x.pass_pct),
        })),
        grades: grades.rows,
        sections: sections.rows.map((x) => ({
          section: x.section,
          pupils: x.pupils,
          complete: x.complete,
          meanPct: x.mean_pct === null ? null : Number(x.mean_pct),
          passPct: x.pass_pct === null ? null : Number(x.pass_pct),
        })),
        toppers: toppers.rows.map((x) => ({
          section: x.section,
          name: x.name,
          admissionNo: x.admission_no,
          pct: x.pct,
          grade: x.grade,
          rankInClass: x.rank_in_class,
        })),
      };
    });
  }

  /** Promotion proposals from the results: promote when complete, above the minimum and within the failed-subject allowance. */
  async promotionProposals(
    ctx: RequestContext,
    examId: string,
    q: { classId?: string; minPct: number; maxFailed: number },
  ) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exam = await this.exam(c, examId, yearId);
      const r = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        section: string;
        class_section_id: string;
        class_id: string;
        pct: string | null;
        grade: string | null;
        result: string;
        failed_subjects: number;
      }>(
        `SELECT r.student_id::text, s.display_name AS name, s.admission_no, k.code || '-' || cs.name AS section, r.class_section_id::text, r.class_id::text,
                r.pct::text, r.grade, r.result, r.failed_subjects
           FROM exam_results r JOIN students s ON s.id = r.student_id JOIN class_sections cs ON cs.id = r.class_section_id JOIN classes k ON k.id = cs.class_id
          WHERE r.exam_id = $1 AND ($2::bigint IS NULL OR r.class_id = $2)
          ORDER BY k.display_order, cs.name, r.rank_in_section NULLS LAST, s.display_name`,
        [examId, q.classId ?? null],
      );
      const proposals = r.rows.map((x) => {
        let decision: 'promote' | 'retain' | 'review' = 'promote';
        let reason = 'Passed';
        if (x.result === 'incomplete') {
          decision = 'review';
          reason = 'Marks incomplete';
        } else if (x.failed_subjects > q.maxFailed) {
          decision = 'retain';
          reason = `${x.failed_subjects} subject(s) below the pass marks`;
        } else if (x.pct !== null && Number(x.pct) < q.minPct) {
          decision = 'retain';
          reason = `${x.pct}% is below the minimum ${q.minPct}%`;
        } else if (x.failed_subjects > 0) {
          reason = `Passed with ${x.failed_subjects} subject(s) below the pass marks (within the allowance)`;
        }
        return {
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          section: x.section,
          classSectionId: x.class_section_id,
          classId: x.class_id,
          pct: x.pct,
          grade: x.grade,
          result: x.result,
          failedSubjects: x.failed_subjects,
          decision,
          reason,
        };
      });
      return {
        exam: {
          id: exam.id,
          code: exam.code,
          name: exam.name,
          computedAt: exam.computed_at?.toISOString() ?? null,
        },
        rule: { minPct: q.minPct, maxFailed: q.maxFailed },
        totals: {
          promote: proposals.filter((p) => p.decision === 'promote').length,
          retain: proposals.filter((p) => p.decision === 'retain').length,
          review: proposals.filter((p) => p.decision === 'review').length,
        },
        proposals,
      };
    });
  }
}
