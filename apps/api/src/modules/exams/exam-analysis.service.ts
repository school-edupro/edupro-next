import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { tablePdf } from '../engagement/table-pdf';
import { ExamEntryService } from './exam-entry.service';
import { EXAMS, type ExamReportQueryDto, type DivisionsQueryDto } from './exams.dto';

type Cell = string | number | null;
export interface ReportTable {
  title?: string;
  columns: Array<{ key: string; label: string; right?: boolean; group?: string }>;
  rows: Cell[][];
  /** rows by position: a heading across the table, or a summary line */
  shade?: Record<number, 'heading' | 'subtotal'>;
}
export interface ExamReport {
  kind: string;
  title: string;
  subtitle: string[];
  school: string;
  tables: ReportTable[];
}

export const REPORT_KINDS = ['subjects', 'ranges', 'toppers', 'teachers', 'status', 'missing'];

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const n = (v: string | null) => (v === null ? null : Number(v));
const DEFAULT_BANDS = [91, 81, 71, 61, 51, 41, 33, 0];
const STATUS: Record<string, string> = {
  open: 'Open',
  submitted: 'Submitted',
  verified: 'Verified',
};
const RESULT: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  compartment: 'Compartment',
  absent: 'Absent',
  incomplete: 'Incomplete',
};

/** One student's mark in one subject of the exam, for the analyses. */
interface MarkRow {
  class_id: string;
  class_code: string;
  class_section_id: string;
  section: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  sub_order: number;
  max_marks: string;
  pass_marks: string | null;
  student_id: string;
  name: string;
  admission_no: string;
  roll_no: number | null;
  marks: string | null;
  absent: boolean;
  code: string | null;
  grade: string | null;
  entered: boolean;
}

/**
 * Examination analysis and exports (docs/design/65, part 6): for an exam, the section-wise subject
 * analysis, mark-range bands (the class's grade scale or the school's own ranges), toppers (top N, at
 * or above / below a %, in a subject), the subject teachers' analysis, the upload status and the
 * missing marks; for a locked result scheme, the merit list by division. Each is a screen, an Excel
 * file and a PDF. Staff read their scoped sections only; subjects a student does not take and
 * grade-only subjects are left out of the figures.
 */
@Injectable()
export class ExamAnalysisService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
    private readonly entry: ExamEntryService,
  ) {}

  async report(ctx: RequestContext, examId: string, kind: string, q: ExamReportQueryDto) {
    if (!REPORT_KINDS.includes(kind))
      throw new DomainError('not-found', 'No such report', { status: 404 });
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    const report = await this.db.tenant(tenant, async (c) => {
      const exam = await this.entry.exam(c, examId, yearId);
      const school = await this.schoolName(c);
      const where = await this.placeLabel(c, q);
      const base = {
        school,
        subtitle: [`${exam.name} (${exam.code})${where ? ` · ${where}` : ''}`],
      };
      const sections = q.classSectionId
        ? [q.classSectionId].filter((s) => allowed === null || allowed.map(String).includes(s))
        : allowed;
      const p = { examId, yearId, classId: q.classId ?? null, sections };
      switch (kind) {
        case 'subjects':
          return { kind, ...base, ...this.subjects(await this.marks(c, p)) };
        case 'ranges':
          return { kind, ...base, ...(await this.ranges(c, p, q)) };
        case 'toppers':
          return { kind, ...base, ...(await this.toppers(c, p, q)) };
        case 'teachers':
          return { kind, ...base, ...(await this.teachers(c, p)) };
        case 'status':
          return { kind, ...base, ...(await this.status(c, p)) };
        default:
          return { kind, ...base, ...this.missing(await this.marks(c, p)) };
      }
    });
    return this.output(report, q.format, `${kind}-${examId}`);
  }

  private async schoolName(c: PoolClient) {
    return (
      await c.query<{ name: string }>(`SELECT name FROM schools WHERE id = app.current_school_id()`)
    ).rows[0]!.name;
  }

  private async placeLabel(c: PoolClient, q: { classId?: string; classSectionId?: string }) {
    if (q.classSectionId)
      return (
        await c.query<{ x: string }>(
          `SELECT k.code || '-' || cs.name AS x FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
          [q.classSectionId],
        )
      ).rows[0]?.x;
    if (q.classId)
      return (
        await c.query<{ x: string }>(`SELECT 'Class ' || code AS x FROM classes WHERE id = $1`, [
          q.classId,
        ])
      ).rows[0]?.x;
    return null;
  }

  /** Every student × subject they take (numeric subjects), with the mark if any. */
  private async marks(
    c: PoolClient,
    p: { examId: string; yearId: string; classId: string | null; sections: string[] | null },
  ): Promise<MarkRow[]> {
    return (
      await c.query<MarkRow>(
        `SELECT k.id::text AS class_id, k.code AS class_code, cs.id::text AS class_section_id, k.code || '-' || cs.name AS section,
                sub.id::text AS subject_id, sub.code AS subject_code, sub.name AS subject_name, sub.display_order AS sub_order,
                es.max_marks::text, es.pass_marks::text, s.id::text AS student_id, s.display_name AS name, s.admission_no, en.roll_no,
                m.marks::text, COALESCE(m.absent, false) AS absent, m.code, m.grade, (m.id IS NOT NULL) AS entered
           FROM exam_subjects es
           JOIN subjects sub ON sub.id = es.subject_id
           JOIN classes k ON k.id = es.class_id
           JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL
           JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = $2 AND en.status = 'active'
           JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
           LEFT JOIN mark_entries m ON m.exam_subject_id = es.id AND m.student_id = s.id
          WHERE es.exam_id = $1 AND es.max_marks > 0
            AND ($3::bigint IS NULL OR es.class_id = $3::bigint)
            AND ($4::bigint[] IS NULL OR cs.id = ANY($4::bigint[]))
            AND app.student_subject_kind(s.id, $2, es.subject_id) IS NOT NULL
          ORDER BY k.display_order, k.code, cs.name, sub.display_order, sub.code, en.roll_no NULLS LAST, s.display_name`,
        [p.examId, p.yearId, p.classId, p.sections],
      )
    ).rows;
  }

  /** Mean, highest, lowest, pass % per section and subject; the class line under a subject's sections. */
  private subjects(rows: MarkRow[]): Pick<ExamReport, 'title' | 'tables'> {
    const groups = new Map<string, MarkRow[]>();
    for (const r of rows) {
      const k = `${r.class_id}|${r.subject_id}|${r.class_section_id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    const figures = (list: MarkRow[]) => {
      const max = Number(list[0]!.max_marks);
      const pass = list[0]!.pass_marks === null ? null : Number(list[0]!.pass_marks);
      const got = list.filter((x) => x.marks !== null).map((x) => Number(x.marks));
      const mean = got.length ? got.reduce((a, b) => a + b, 0) / got.length : null;
      const passed = pass === null ? null : got.filter((v) => v >= pass).length;
      return [
        list.length,
        got.length,
        list.filter((x) => x.absent || x.code === 'AB').length,
        r1(mean),
        mean === null ? null : r1((mean / max) * 100),
        got.length ? Math.max(...got) : null,
        got.length ? Math.min(...got) : null,
        passed,
        passed === null || !got.length ? null : r1((passed * 100) / got.length),
      ] as Cell[];
    };
    const out: Cell[][] = [];
    const shade: Record<number, 'subtotal'> = {};
    const bySubject = new Map<string, MarkRow[][]>();
    for (const [k, list] of groups) {
      const key = k.split('|').slice(0, 2).join('|');
      if (!bySubject.has(key)) bySubject.set(key, []);
      bySubject.get(key)!.push(list);
    }
    for (const lists of bySubject.values()) {
      const first = lists[0]![0]!;
      for (const list of lists)
        out.push([
          list[0]!.section,
          `${first.subject_name} (${String(Number(first.max_marks))})`,
          ...figures(list),
        ]);
      if (lists.length > 1) {
        shade[out.length] = 'subtotal';
        out.push([
          `Class ${first.class_code}`,
          `${first.subject_name} (${String(Number(first.max_marks))})`,
          ...figures(lists.flat()),
        ]);
      }
    }
    return {
      title: 'Section-wise subject analysis',
      tables: [
        {
          columns: [
            { key: 'section', label: 'Section' },
            { key: 'subject', label: 'Subject (max)' },
            { key: 'students', label: 'Students', right: true },
            { key: 'appeared', label: 'Appeared', right: true },
            { key: 'absent', label: 'Absent', right: true },
            { key: 'mean', label: 'Mean', right: true },
            { key: 'mean_pct', label: 'Mean %', right: true },
            { key: 'highest', label: 'Highest', right: true },
            { key: 'lowest', label: 'Lowest', right: true },
            { key: 'passed', label: 'Passed', right: true },
            { key: 'pass_pct', label: 'Pass %', right: true },
          ],
          rows: out,
          shade,
        },
      ],
    };
  }

  /** How many students' subject % fall in each band. */
  private async ranges(
    c: PoolClient,
    p: { examId: string; yearId: string; classId: string | null; sections: string[] | null },
    q: ExamReportQueryDto,
  ): Promise<Pick<ExamReport, 'title' | 'tables'>> {
    let bands: Array<{ label: string; min: number; max: number }>;
    if (q.ranges?.length) {
      const lows = [...new Set(q.ranges)].sort((a, b) => b - a);
      bands = lows.map((min, i) => ({
        label: i === 0 ? `${String(min)}-100` : `${String(min)}-${String(lows[i - 1]! - 0.01)}`,
        min,
        max: i === 0 ? 100 : lows[i - 1]! - 0.01,
      }));
    } else {
      // the class's grade scale for this exam (a class chosen), else ten-point ranges
      const scale = p.classId
        ? await c.query<{ grade: string; min_pct: string; max_pct: string }>(
            `SELECT b.grade, b.min_pct::text, b.max_pct::text FROM exam_classes ec JOIN grade_bands b ON b.scale_id = ec.grade_scale_id
              WHERE ec.exam_id = $1 AND ec.class_id = $2 ORDER BY b.min_pct DESC`,
            [p.examId, p.classId],
          )
        : { rows: [] };
      bands = scale.rows.length
        ? scale.rows.map((b) => ({
            label: `${b.grade} (${String(Number(b.min_pct))}-${String(Number(b.max_pct))})`,
            min: Number(b.min_pct),
            max: Number(b.max_pct),
          }))
        : DEFAULT_BANDS.map((min, i) => ({
            label:
              i === 0
                ? `${String(min)}-100`
                : `${String(min)}-${String(DEFAULT_BANDS[i - 1]! - 1)}`,
            min,
            max: i === 0 ? 100 : DEFAULT_BANDS[i - 1]! - 0.01,
          }));
    }
    const rows = await this.marks(c, p);
    const groups = new Map<string, MarkRow[]>();
    for (const r of rows) {
      const k = `${r.class_id}|${r.subject_id}|${r.class_section_id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    const out: Cell[][] = [];
    for (const list of groups.values()) {
      const max = Number(list[0]!.max_marks);
      const pcts = list.filter((x) => x.marks !== null).map((x) => (Number(x.marks) / max) * 100);
      out.push([
        list[0]!.section,
        list[0]!.subject_name,
        pcts.length,
        // a % between two bands (89.5 under 90-100 and 80-89) goes to the lower one
        ...bands.map(
          (b, i) =>
            pcts.filter((v) => v >= b.min && (i === 0 ? v <= b.max : v < bands[i - 1]!.min)).length,
        ),
      ]);
    }
    return {
      title: 'Mark-range analysis',
      tables: [
        {
          columns: [
            { key: 'section', label: 'Section' },
            { key: 'subject', label: 'Subject' },
            { key: 'appeared', label: 'Appeared', right: true },
            ...bands.map((b, i) => ({
              key: `b${String(i)}`,
              label: b.label,
              right: true,
              group: '% range',
            })),
          ],
          rows: out,
        },
      ],
    };
  }

  /** The top N of the class (or section), those at or above a %, below a %, or the toppers of a subject. */
  private async toppers(
    c: PoolClient,
    p: { examId: string; yearId: string; classId: string | null; sections: string[] | null },
    q: ExamReportQueryDto,
  ): Promise<Pick<ExamReport, 'title' | 'tables'>> {
    const top = q.top ?? 10;
    if (q.subjectId) {
      const rows = (await this.marks(c, p)).filter(
        (r) => r.subject_id === q.subjectId && r.marks !== null,
      );
      const max = rows[0] ? Number(rows[0].max_marks) : 0;
      const sorted = [...rows].sort((a, b) => Number(b.marks) - Number(a.marks));
      let rank = 0;
      let last: number | null = null;
      const ranked = sorted.map((r, i) => {
        if (Number(r.marks) !== last) rank = i + 1;
        last = Number(r.marks);
        return { r, rank };
      });
      const keep = ranked.filter(
        (x) =>
          (q.minPct === undefined || (Number(x.r.marks) / max) * 100 >= q.minPct) &&
          (q.belowPct === undefined || (Number(x.r.marks) / max) * 100 < q.belowPct) &&
          (q.minPct !== undefined || q.belowPct !== undefined || x.rank <= top),
      );
      return {
        title: `Toppers · ${rows[0]?.subject_name ?? 'subject'}`,
        tables: [
          {
            columns: [
              { key: 'rank', label: 'Rank', right: true },
              { key: 'section', label: 'Section' },
              { key: 'roll', label: 'Roll', right: true },
              { key: 'admission_no', label: 'Admission no' },
              { key: 'name', label: 'Student' },
              { key: 'marks', label: `Marks / ${String(max)}`, right: true },
              { key: 'pct', label: '%', right: true },
            ],
            rows: keep.map((x) => [
              x.rank,
              x.r.section,
              x.r.roll_no,
              x.r.admission_no,
              x.r.name,
              Number(x.r.marks),
              r1((Number(x.r.marks) / max) * 100),
            ]),
          },
        ],
      };
    }
    const bySection = q.by === 'section';
    const r = await c.query<{
      section: string;
      roll_no: number | null;
      admission_no: string;
      name: string;
      total: string;
      max_total: string;
      pct: string | null;
      grade: string | null;
      result: string;
      rank: number | null;
    }>(
      `SELECT k.code || '-' || cs.name AS section, en.roll_no, s.admission_no, s.display_name AS name, x.total::text, x.max_total::text,
              x.pct::text, x.grade, x.result, CASE WHEN $5::boolean THEN x.rank_in_section ELSE x.rank_in_class END AS rank
         FROM exam_results x JOIN students s ON s.id = x.student_id
         JOIN class_sections cs ON cs.id = x.class_section_id JOIN classes k ON k.id = cs.class_id
         LEFT JOIN enrolments en ON en.student_id = x.student_id AND en.class_section_id = cs.id AND en.academic_year_id = $2 AND en.status = 'active'
        WHERE x.exam_id = $1 AND x.result <> 'incomplete'
          AND ($3::bigint IS NULL OR x.class_id = $3::bigint) AND ($4::bigint[] IS NULL OR x.class_section_id = ANY($4::bigint[]))
          AND ($6::numeric IS NULL OR x.pct >= $6) AND ($7::numeric IS NULL OR x.pct < $7)
          AND ($6::numeric IS NOT NULL OR $7::numeric IS NOT NULL OR (CASE WHEN $5::boolean THEN x.rank_in_section ELSE x.rank_in_class END) <= $8::int)
        ORDER BY k.display_order, CASE WHEN $5::boolean THEN cs.name ELSE '' END, x.pct DESC NULLS LAST, s.display_name`,
      [
        p.examId,
        p.yearId,
        p.classId,
        p.sections,
        bySection,
        q.minPct ?? null,
        q.belowPct ?? null,
        top,
      ],
    );
    const what =
      q.minPct !== undefined && q.belowPct !== undefined
        ? `${String(q.minPct)}% to below ${String(q.belowPct)}%`
        : q.minPct !== undefined
          ? `${String(q.minPct)}% and above`
          : q.belowPct !== undefined
            ? `below ${String(q.belowPct)}%`
            : `top ${String(top)} of each ${bySection ? 'section' : 'class'}`;
    return {
      title: `Toppers · ${what}`,
      tables: [
        {
          columns: [
            { key: 'rank', label: 'Rank', right: true },
            { key: 'section', label: 'Section' },
            { key: 'roll', label: 'Roll', right: true },
            { key: 'admission_no', label: 'Admission no' },
            { key: 'name', label: 'Student' },
            { key: 'total', label: 'Total', right: true },
            { key: 'pct', label: '%', right: true },
            { key: 'grade', label: 'Grade' },
            { key: 'result', label: 'Result' },
          ],
          rows: r.rows.map((x) => [
            x.rank,
            x.section,
            x.roll_no,
            x.admission_no,
            x.name,
            `${String(Number(x.total))} / ${String(Number(x.max_total))}`,
            n(x.pct),
            x.grade,
            RESULT[x.result] ?? x.result,
          ]),
        },
      ],
    };
  }

  /** Each subject teacher's sections and subjects: appeared, mean %, pass %, highest; their overall line. */
  private async teachers(
    c: PoolClient,
    p: { examId: string; yearId: string; classId: string | null; sections: string[] | null },
  ): Promise<Pick<ExamReport, 'title' | 'tables'>> {
    const rows = await this.marks(c, p);
    const t = await c.query<{ class_section_id: string; subject_id: string; teacher: string }>(
      `SELECT DISTINCT ta.class_section_id::text, ta.subject_id::text, concat_ws(' ', em.first_name, em.last_name) AS teacher
         FROM teacher_assignments ta JOIN employees em ON em.id = ta.employee_id
        WHERE ta.academic_year_id = $1 AND ta.kind = 'subject_teacher' AND ta.valid_to IS NULL AND ta.subject_id IS NOT NULL`,
      [p.yearId],
    );
    const who = new Map<string, string[]>();
    for (const x of t.rows) {
      const k = `${x.class_section_id}|${x.subject_id}`;
      who.set(k, [...(who.get(k) ?? []), x.teacher]);
    }
    const byTeacher = new Map<string, Map<string, MarkRow[]>>();
    for (const r of rows) {
      const k = `${r.class_section_id}|${r.subject_id}`;
      for (const teacher of who.get(k) ?? ['(no subject teacher)']) {
        if (!byTeacher.has(teacher)) byTeacher.set(teacher, new Map());
        const m = byTeacher.get(teacher)!;
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(r);
      }
    }
    const figures = (list: MarkRow[]) => {
      const got = list.filter((x) => x.marks !== null);
      const pcts = got.map((x) => (Number(x.marks) / Number(x.max_marks)) * 100);
      const withPass = got.filter((x) => x.pass_marks !== null);
      const passed = withPass.filter((x) => Number(x.marks) >= Number(x.pass_marks)).length;
      return [
        list.length,
        got.length,
        pcts.length ? r1(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
        withPass.length ? r1((passed * 100) / withPass.length) : null,
        pcts.length ? r1(Math.max(...pcts)) : null,
      ] as Cell[];
    };
    const out: Cell[][] = [];
    const shade: Record<number, 'heading' | 'subtotal'> = {};
    for (const [teacher, m] of [...byTeacher.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      shade[out.length] = 'heading';
      out.push([teacher, null, null, null, null, null, null]);
      for (const list of m.values())
        out.push([list[0]!.section, list[0]!.subject_name, ...figures(list)]);
      if (m.size > 1) {
        shade[out.length] = 'subtotal';
        out.push(['All', `${teacher}`, ...figures([...m.values()].flat())]);
      }
    }
    return {
      title: 'Subject teachers’ analysis',
      tables: [
        {
          columns: [
            { key: 'section', label: 'Section' },
            { key: 'subject', label: 'Subject' },
            { key: 'students', label: 'Students', right: true },
            { key: 'appeared', label: 'Appeared', right: true },
            { key: 'mean_pct', label: 'Mean %', right: true },
            { key: 'pass_pct', label: 'Pass %', right: true },
            { key: 'highest_pct', label: 'Highest %', right: true },
          ],
          rows: out,
          shade,
        },
      ],
    };
  }

  /** Every section × subject: students who take it, marks entered, still to enter, the status and by whom. */
  private async status(
    c: PoolClient,
    p: { examId: string; yearId: string; classId: string | null; sections: string[] | null },
  ): Promise<Pick<ExamReport, 'title' | 'tables'>> {
    const r = await c.query<{
      section: string;
      subject: string;
      takers: number;
      entered: number;
      status: string;
      submitted_by: string | null;
      submitted_at: Date | null;
      verified_by: string | null;
      verified_at: Date | null;
    }>(
      `SELECT k.code || '-' || cs.name AS section, sub.name AS subject,
              (SELECT count(*)::int FROM enrolments en WHERE en.class_section_id = cs.id AND en.academic_year_id = $2 AND en.status = 'active'
                  AND app.student_subject_kind(en.student_id, $2, es.subject_id) IS NOT NULL) AS takers,
              (SELECT count(*)::int FROM enrolments en JOIN mark_entries m ON m.student_id = en.student_id AND m.exam_subject_id = es.id
                WHERE en.class_section_id = cs.id AND en.academic_year_id = $2 AND en.status = 'active'
                  AND app.student_subject_kind(en.student_id, $2, es.subject_id) IS NOT NULL) AS entered,
              COALESCE(st.status, 'open') AS status, su.display_name AS submitted_by, st.submitted_at, vu.display_name AS verified_by, st.verified_at
         FROM exam_subjects es
         JOIN subjects sub ON sub.id = es.subject_id JOIN classes k ON k.id = es.class_id
         JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL AND cs.status = 'active'
         LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
         LEFT JOIN users su ON su.id = st.submitted_by LEFT JOIN users vu ON vu.id = st.verified_by
        WHERE es.exam_id = $1 AND ($3::bigint IS NULL OR es.class_id = $3::bigint) AND ($4::bigint[] IS NULL OR cs.id = ANY($4::bigint[]))
        ORDER BY k.display_order, k.code, cs.name, sub.display_order, sub.code`,
      [p.examId, p.yearId, p.classId, p.sections],
    );
    const day = (d: Date | null) =>
      d
        ? d.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : null;
    const done = r.rows.filter((x) => x.entered >= x.takers).length;
    return {
      title: 'Marks upload status',
      tables: [
        {
          columns: [
            { key: 'section', label: 'Section' },
            { key: 'subject', label: 'Subject' },
            { key: 'takers', label: 'Students', right: true },
            { key: 'entered', label: 'Entered', right: true },
            { key: 'left', label: 'To enter', right: true },
            { key: 'status', label: 'Status' },
            { key: 'submitted', label: 'Submitted by' },
            { key: 'verified', label: 'Verified by' },
          ],
          rows: r.rows.map((x) => [
            x.section,
            x.subject,
            x.takers,
            x.entered,
            Math.max(x.takers - x.entered, 0),
            STATUS[x.status] ?? x.status,
            x.submitted_by ? `${x.submitted_by} · ${day(x.submitted_at) ?? ''}` : null,
            x.verified_by ? `${x.verified_by} · ${day(x.verified_at) ?? ''}` : null,
          ]),
        },
        {
          title: 'Summary',
          columns: [
            { key: 'what', label: 'Sheets' },
            { key: 'n', label: 'Number', right: true },
          ],
          rows: [
            ['All', r.rows.length],
            ['Every mark entered', done],
            ['Marks still to enter', r.rows.length - done],
            ['Submitted', r.rows.filter((x) => x.status === 'submitted').length],
            ['Verified', r.rows.filter((x) => x.status === 'verified').length],
          ],
        },
      ],
    };
  }

  /** Students without a mark or a code, by section and subject. */
  private missing(rows: MarkRow[]): Pick<ExamReport, 'title' | 'tables'> {
    const out: Cell[][] = [];
    const shade: Record<number, 'heading'> = {};
    let at = '';
    for (const r of rows.filter((x) => !x.entered)) {
      const k = `${r.section} · ${r.subject_name}`;
      if (k !== at) {
        shade[out.length] = 'heading';
        out.push([k, null, null, null]);
        at = k;
      }
      out.push([r.section, r.roll_no, r.admission_no, r.name]);
    }
    return {
      title: 'Missing marks',
      tables: [
        {
          columns: [
            { key: 'section', label: 'Section' },
            { key: 'roll', label: 'Roll', right: true },
            { key: 'admission_no', label: 'Admission no' },
            { key: 'name', label: 'Student' },
          ],
          rows: out,
          shade,
        },
      ],
    };
  }

  /** A locked result scheme's term results: the merit list by division and the count per section. */
  async divisions(ctx: RequestContext, schemeId: string, q: DivisionsQueryDto) {
    const tenant = requireTenant(ctx);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    const report = await this.db.tenant(tenant, async (c) => {
      const sc = await c.query<{
        name: string;
        term_code: string;
        status: string;
        def: { result?: { divisions?: Array<{ name: string; minPct: number }> } };
      }>(
        `SELECT name, term_code, status, def FROM mark_schemes WHERE id = $1 AND purpose = 'result' AND deleted_at IS NULL`,
        [schemeId],
      );
      const s = sc.rows[0];
      if (!s) throw new DomainError('not-found', 'Result scheme not found', { status: 404 });
      if (s.status !== 'locked')
        throw new DomainError(
          'exams.scheme_not_locked',
          'The merit list comes from a locked result scheme: lock it and work out the term results',
          { status: 409 },
        );
      const r = await c.query<{
        section: string;
        class_section_id: string;
        roll_no: number | null;
        admission_no: string;
        name: string;
        total: string | null;
        max_total: string;
        pct: string | null;
        grade: string | null;
        division: string | null;
        result: string;
        rank_in_class: number | null;
        rank_in_section: number | null;
      }>(
        `SELECT k.code || '-' || cs.name AS section, cs.id::text AS class_section_id, en.roll_no, st.admission_no, st.display_name AS name,
                t.total::text, t.max_total::text, t.pct::text, t.grade, t.division, t.result, t.rank_in_class, t.rank_in_section
           FROM term_results t JOIN students st ON st.id = t.student_id
           JOIN class_sections cs ON cs.id = t.class_section_id JOIN classes k ON k.id = cs.class_id
           LEFT JOIN enrolments en ON en.student_id = t.student_id AND en.class_section_id = cs.id AND en.academic_year_id = t.academic_year_id AND en.status = 'active'
          WHERE t.scheme_id = $1 AND ($2::bigint IS NULL OR t.class_id = $2::bigint)
            AND ($3::bigint IS NULL OR t.class_section_id = $3::bigint) AND ($4::bigint[] IS NULL OR t.class_section_id = ANY($4::bigint[]))
          ORDER BY t.rank_in_class NULLS LAST, t.pct DESC NULLS LAST, st.display_name`,
        [schemeId, q.classId ?? null, q.classSectionId ?? null, allowed],
      );
      const order = (s.def.result?.divisions ?? []).map((d) => d.name);
      const divisionOf = (x: (typeof r.rows)[number]) =>
        x.result === 'pass' ? (x.division ?? 'Pass') : (RESULT[x.result] ?? x.result);
      const heads = [
        ...order,
        ...new Set(r.rows.map(divisionOf).filter((d) => !order.includes(d))),
      ];
      const list: Cell[][] = [];
      const shade: Record<number, 'heading'> = {};
      for (const d of heads) {
        const of = r.rows.filter((x) => divisionOf(x) === d);
        if (!of.length) continue;
        shade[list.length] = 'heading';
        list.push([`${d} (${String(of.length)})`, null, null, null, null, null, null, null]);
        for (const x of of)
          list.push([
            x.rank_in_class,
            x.section,
            x.roll_no,
            x.admission_no,
            x.name,
            x.total === null ? null : `${String(Number(x.total))} / ${String(Number(x.max_total))}`,
            n(x.pct),
            x.grade,
          ]);
      }
      const sections = [...new Set(r.rows.map((x) => x.section))];
      const summary: Cell[][] = sections.map((sec) => {
        const of = r.rows.filter((x) => x.section === sec);
        return [sec, of.length, ...heads.map((d) => of.filter((x) => divisionOf(x) === d).length)];
      });
      if (sections.length > 1)
        summary.push([
          'All',
          r.rows.length,
          ...heads.map((d) => r.rows.filter((x) => divisionOf(x) === d).length),
        ]);
      const where = await this.placeLabel(c, q);
      return {
        kind: 'divisions',
        title: `Merit list by division · ${s.name}`,
        subtitle: [`Term ${s.term_code}${where ? ` · ${where}` : ''}`],
        school: await this.schoolName(c),
        tables: [
          {
            columns: [
              { key: 'rank', label: 'Rank', right: true },
              { key: 'section', label: 'Section' },
              { key: 'roll', label: 'Roll', right: true },
              { key: 'admission_no', label: 'Admission no' },
              { key: 'name', label: 'Student' },
              { key: 'total', label: 'Total', right: true },
              { key: 'pct', label: '%', right: true },
              { key: 'grade', label: 'Grade' },
            ],
            rows: list,
            shade,
          },
          {
            title: 'By section',
            columns: [
              { key: 'section', label: 'Section' },
              { key: 'students', label: 'Students', right: true },
              ...heads.map((d, i) => ({ key: `d${String(i)}`, label: d, right: true })),
            ],
            rows: summary,
            ...(sections.length > 1
              ? { shade: { [summary.length - 1]: 'subtotal' as const } }
              : {}),
          },
        ],
      } satisfies ExamReport;
    });
    return this.output(report, q.format, `divisions-${schemeId}`);
  }

  /** The same report on the screen, as Excel (a sheet per table) or as a PDF (later tables under it). */
  private async output(report: ExamReport, format: 'json' | 'xlsx' | 'pdf', stem: string) {
    if (format === 'json') return report;
    if (format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      for (const [i, t] of report.tables.entries()) {
        const ws = wb.addWorksheet(
          (t.title ?? (i === 0 ? 'Report' : `Table ${String(i + 1)}`)).slice(0, 31),
        );
        ws.addRow([report.title]).font = { bold: true, size: 13 };
        ws.addRow([report.school, ...report.subtitle]);
        if (t.columns.some((col) => col.group))
          ws.addRow(t.columns.map((col) => col.group ?? '')).font = { bold: true };
        ws.addRow(t.columns.map((col) => col.label)).font = { bold: true };
        for (const [k, row] of t.rows.entries()) {
          const line = ws.addRow(row.map((v) => v ?? ''));
          if (t.shade?.[k]) line.font = { bold: true };
        }
        t.columns.forEach((col, k) => {
          ws.getColumn(k + 1).width = ['name', 'subject', 'submitted', 'verified'].includes(col.key)
            ? 28
            : col.key === 'section'
              ? 16
              : 12;
        });
      }
      return {
        filename: `${stem}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    }
    const [main, ...rest] = report.tables;
    const wide = (key: string) =>
      ['name', 'subject', 'submitted', 'verified'].includes(key)
        ? 3
        : key === 'section'
          ? 1.6
          : 1.1;
    const bytes = await tablePdf({
      school: report.school,
      title: report.title,
      subtitle: report.subtitle,
      columns: main!.columns.map((col) => ({
        label: col.label,
        width: wide(col.key),
        right: Boolean(col.right),
        ...(col.group ? { group: col.group } : {}),
      })),
      rows: main!.rows,
      shade: main!.shade,
      rowCount: main!.rows.length - Object.keys(main!.shade ?? {}).length,
      fontSize: main!.columns.length > 12 ? 7 : 8,
      after: rest.map((t) => ({
        title: t.title ?? '',
        columns: t.columns.map((col) => ({
          label: col.label,
          width: wide(col.key),
          right: Boolean(col.right),
        })),
        rows: t.rows,
        total: Boolean(t.shade && Object.values(t.shade).includes('subtotal')),
      })),
    });
    return {
      filename: `${stem}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }
}
