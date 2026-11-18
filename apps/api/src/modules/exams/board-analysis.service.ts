import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { STORAGE_DRIVER } from '../files/storage';
import {
  analyse,
  bestFive,
  round2,
  ruleWords,
  teacherView,
  subjectFigures,
  yearFigures,
  type AnCandidate,
  type AnSubject,
  type AnYear,
  type BoardRules,
  type SubjectFigures,
  yearLabel,
} from './board-analysis';
import { analysisPdf, analysisXlsx, examName, singleTableXlsx } from './board-analysis-file';
import { resultChartsPdf } from './board-charts-pdf';
import { toppersPdf, toppersXlsx } from './board-toppers-file';
import { toppersReport } from './board-toppers';
import { BoardDetailsService } from './board-details.service';
import { marksPdf, marksXlsx } from './board-marks-file';
import { OVERALL_LABELS, rangePdf, rangeXlsx, singleTablePdf } from './board-reports-file';
import {
  rangeOverall,
  rangeSubjectSummary,
  resultAnalysisTable,
  resultCharts,
  subjectPerformance,
  teacherAnalysisTable,
} from './board-reports';
import { filterMarks, marksRows, type MarksRow } from './board-marks';
import { readRules, writeRules } from './board-rules';
import {
  type BoardMarksFileDto,
  type BoardMarksQueryDto,
  type BoardOverallFileDto,
  type BoardOverallQueryDto,
  type BoardRangeFileDto,
  type BoardRangeQueryDto,
  type BoardResultAnalysisFileDto,
  type BoardResultAnalysisQueryDto,
  type BoardSubjectPerfFileDto,
  type BoardSubjectPerfQueryDto,
  type BoardTeacherAnalysisFileDto,
  type BoardTeacherAnalysisQueryDto,
  type BoardToppersFileDto,
  type BoardToppersQueryDto,
  type BoardYearFiguresDto,
} from './board-results.dto';
import { CBSE_SUBJECTS, type BoardSubjectKind } from './board-subjects';
import { registerGeneratedOn, registerLetterhead, registerLogo } from './register-head';

type BoardClass = 'X' | 'XII';
const KEY = 'exams.board_rules';
const PARENTS = 'exams.board_result.parents';
const BAND_WORDS = {
  '90': '90 and above',
  '75': '75 to 89.9',
  '60': '60 to 74.9',
  '45': '45 to 59.9',
  below45: 'below 45',
} as const;
interface TypedSubject {
  appeared: number;
  highest?: number | null;
  aGrades?: number | null;
  compartments?: number | null;
  failures?: number | null;
  distinctions?: number | null;
  average?: number | null;
  pi?: number | null;
}
interface TypedYear {
  id: string;
  examYear: number;
  registered: number | null;
  appeared: number;
  passed: number | null;
  compartments: number | null;
  failures: number | null;
  n90: number | null;
  n75: number | null;
  aggregate: number | null;
  pi: number | null;
  subjects: Record<string, TypedSubject>;
  note: string | null;
  updatedAt: string;
}
const KIND_ORDER: BoardSubjectKind[] = ['language', 'main', 'skill', 'additional', 'internal'];

/**
 * The annexures of a saved CBSE result (docs/design/88, phase C): loads one class and year — its candidates, their
 * subjects and the details kept with them, the earlier years for the five-year rows and the year before for
 * Annexure 5 — and counts them with the school's rules (a setting). The same figures go to the screen, the Excel
 * workbook and the PDF.
 */
@Injectable()
export class BoardAnalysisService {
  constructor(
    private readonly db: DbService,
    private readonly details: BoardDetailsService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async storedRules(c: PoolClient): Promise<unknown> {
    const r = await c.query<{ v: unknown }>(`SELECT app.setting($1) AS v`, [KEY]);
    return r.rows[0]?.v ?? null;
  }

  /** A class's analysis rules (board-rules.ts): its own, the one set saved before, or the defaults. */
  private async rulesOf(
    c: PoolClient,
    classLabel: BoardClass,
  ): Promise<{ rules: BoardRules; isDefault: boolean }> {
    return readRules(await this.storedRules(c), classLabel);
  }

  async rules(ctx: RequestContext, classLabel: BoardClass) {
    return this.db.tenant(requireTenant(ctx), (c) => this.rulesOf(c, classLabel));
  }

  /** A class's rules from today, the other class's kept (the setting keeps its history: earlier values stay with their dates). */
  async saveRules(ctx: RequestContext, classLabel: BoardClass, rules: BoardRules) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stored = await this.storedRules(c);
      const before = readRules(stored, classLabel);
      await c.query(
        `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
          WHERE key = $1 AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
        [KEY],
      );
      await c.query(`DELETE FROM school_settings WHERE key = $1 AND valid_from = CURRENT_DATE`, [
        KEY,
      ]);
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
        [KEY, JSON.stringify(writeRules(stored, classLabel, rules))],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.rules',
        entityType: 'school_settings',
        entityId: requireTenant(ctx).schoolId,
        before: { classLabel, ...before.rules },
        after: { classLabel, ...rules },
      });
      return { rules, isDefault: false };
    });
  }

  /** The school's CBSE subjects of a class, languages first (English first of them), then main, skill, additional. */
  private async subjectsOf(c: PoolClient, classLabel: BoardClass): Promise<AnSubject[]> {
    const r = await c.query<{ code: string; name: string | null; kind: BoardSubjectKind }>(
      `SELECT code, name, kind FROM board_subjects WHERE board = 'CBSE' AND class_label = $1`,
      [classLabel],
    );
    const seed = new Map(CBSE_SUBJECTS[classLabel].map(([code], i) => [code, i]));
    const rank = (s: { code: string; name: string | null; kind: BoardSubjectKind }) => [
      KIND_ORDER.indexOf(s.kind),
      s.kind === 'language' && /english/i.test(s.name ?? '') ? 0 : 1,
      seed.get(s.code) ?? 999,
    ];
    return r.rows
      .sort((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]! || a.code.localeCompare(b.code);
      })
      .map((s) => ({ code: s.code, name: s.name ?? `Subject ${s.code}`, kind: s.kind }));
  }

  /** A saved year's candidates with their subjects and details (one section, when asked). */
  private async candidatesOf(
    c: PoolClient,
    classLabel: BoardClass,
    examYear: number,
    section?: string,
  ): Promise<AnCandidate[]> {
    const cands = await c.query<{
      id: string;
      roll_no: string;
      name: string | null;
      sex: string | null;
      result: string | null;
      compartment: string[];
      section: string | null;
      stream: string | null;
      category: string | null;
      ews: boolean | null;
      cwsn: boolean | null;
      boarder: boolean | null;
      staff_ward: boolean | null;
      admission_no: string | null;
      contact: string | null;
      student_id: string | null;
    }>(
      `SELECT bc.id::text, bc.roll_no, bc.name, bc.sex, bc.result, bc.compartment, bc.section, bc.stream, bc.category,
              bc.ews, bc.cwsn, bc.boarder, bc.staff_ward, s.admission_no, bc.student_id::text,
              (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = bc.student_id ORDER BY sg.is_primary DESC, g.id LIMIT 1) AS contact
         FROM board_candidates bc LEFT JOIN students s ON s.id = bc.student_id
        WHERE bc.board = 'CBSE' AND bc.class_label = $1 AND bc.exam_year = $2
          AND ($3::text IS NULL OR bc.section = $3) ORDER BY bc.roll_no`,
      [classLabel, examYear, section ?? null],
    );
    const marks = await c.query<{
      candidate_id: string;
      code: string;
      total: string | null;
      grade: string | null;
    }>(
      `SELECT r.candidate_id::text, r.subject_code AS code, r.total::text, r.grade
         FROM board_results r JOIN board_candidates bc ON bc.id = r.candidate_id
        WHERE r.board = 'CBSE' AND r.class_label = $1 AND r.exam_year = $2 AND ($3::text IS NULL OR bc.section = $3)
        ORDER BY r.candidate_id, r.slot NULLS LAST, r.subject_code`,
      [classLabel, examYear, section ?? null],
    );
    const by = new Map<string, AnCandidate['marks']>();
    for (const m of marks.rows) {
      const l = by.get(m.candidate_id) ?? [];
      l.push({ code: m.code, marks: m.total === null ? null : Number(m.total), grade: m.grade });
      by.set(m.candidate_id, l);
    }
    return cands.rows.map((x) => ({
      roll: x.roll_no,
      name: x.name,
      sex: x.sex,
      result: x.result,
      compartment: x.compartment,
      section: x.section,
      stream: x.stream,
      category: x.category,
      ews: x.ews,
      cwsn: x.cwsn,
      boarder: x.boarder,
      staffWard: x.staff_ward,
      marks: by.get(x.id) ?? [],
      admissionNo: x.admission_no,
      contact: x.contact,
      studentId: x.student_id,
    }));
  }

  /** The analysis of a class and year (the latest saved when none is asked), with the years and sections to pick. */
  async analysis(
    ctx: RequestContext,
    q: { classLabel: BoardClass; examYear?: number; section?: string },
  ) {
    return this.db.tenant(requireTenant(ctx), (c) => this.build(c, q));
  }

  private async build(
    c: PoolClient,
    q: { classLabel: BoardClass; examYear?: number; section?: string },
  ) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const { rules, isDefault } = await this.rulesOf(c, q.classLabel);
    const examYear = q.examYear ?? years[0];
    if (examYear === undefined || !years.includes(examYear))
      return {
        classLabel: q.classLabel,
        examYear: examYear ?? null,
        years,
        sections: [] as string[],
        section: q.section ?? null,
        rules,
        rulesDefault: isDefault,
        file: null,
        analysis: null,
      };
    const sections = (
      await c.query<{ s: string }>(
        `SELECT DISTINCT section AS s FROM board_candidates
          WHERE board = 'CBSE' AND class_label = $1 AND exam_year = $2 AND section IS NOT NULL`,
        [q.classLabel, examYear],
      )
    ).rows
      .map((r) => r.s)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const subjects = await this.subjectsOf(c, q.classLabel);
    const candidates = await this.candidatesOf(c, q.classLabel, examYear, q.section);
    // the four years before, from their saved files (typed figures come in phase E)
    // the four years before: a saved file's figures, else (for the whole class) the figures typed in — phase E
    const typed = q.section
      ? []
      : (await this.typedOf(c, q.classLabel)).filter((t) => !years.includes(t.examYear));
    const earlier = [
      ...years.filter((x) => x < examYear),
      ...typed.map((t) => t.examYear).filter((x) => x < examYear),
    ]
      .sort((a, b) => b - a)
      .slice(0, 4);
    const history: AnYear[] = [];
    for (const y of earlier) {
      const t = typed.find((x) => x.examYear === y);
      history.push(
        t
          ? BoardAnalysisService.typedYear(t)
          : yearFigures(y, await this.candidatesOf(c, q.classLabel, y, q.section), subjects, rules),
      );
    }
    const typedLast = typed.find((t) => t.examYear === examYear - 1);
    const lastYear = years.includes(examYear - 1)
      ? subjectFigures(await this.candidatesOf(c, q.classLabel, examYear - 1, q.section), rules)
      : typedLast
        ? BoardAnalysisService.typedSubjects(typedLast)
        : null;
    const who = await this.details.teacherResolver(c, 'CBSE', q.classLabel, examYear);
    const file = (
      await c.query<{ id: string; file_name: string | null; committed_at: Date | null }>(
        `SELECT id::text, file_name, committed_at FROM board_result_imports
          WHERE kind = 'gazette' AND status = 'committed' AND replaced_at IS NULL AND board = 'CBSE'
            AND class_label = $1 AND exam_year = $2 ORDER BY id DESC LIMIT 1`,
        [q.classLabel, examYear],
      )
    ).rows[0];
    return {
      classLabel: q.classLabel,
      examYear,
      years,
      sections,
      section: q.section ?? null,
      rules,
      rulesDefault: isDefault,
      file: file
        ? {
            id: file.id,
            fileName: file.file_name,
            savedAt: file.committed_at?.toISOString() ?? null,
          }
        : null,
      analysis: analyse({
        classLabel: q.classLabel,
        examYear,
        rules,
        candidates,
        subjects,
        teacher: (section, code, roll) => who(section, code, roll)?.name ?? null,
        history,
        lastYear,
      }),
    };
  }

  /** The workbook (every annexure) or the PDF (one annexure, or all). */
  async file(
    ctx: RequestContext,
    q: {
      classLabel: BoardClass;
      examYear?: number;
      section?: string;
      format: 'xlsx' | 'pdf';
      annexure?: number;
    },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = await this.build(c, q);
      if (!b.analysis)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result for that year`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        scope: q.section ? `Section ${q.section}` : null,
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.analysis_export',
        entityType: 'board_result_imports',
        entityId: b.file?.id ?? requireTenant(ctx).schoolId,
        after: {
          classLabel: q.classLabel,
          examYear: b.examYear,
          section: q.section ?? null,
          format: q.format,
          annexure: q.annexure ?? null,
        },
      });
      const base = `${examName(b.analysis).replace(/[^\w-]+/g, '-')}${q.section ? `-Section-${q.section}` : ''}${
        q.format === 'pdf' && q.annexure ? `-Annexure-${String(q.annexure)}` : ''
      }`;
      if (q.format === 'xlsx')
        return {
          filename: `${base}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          base64: (await analysisXlsx(b.analysis, head)).toString('base64'),
        };
      return {
        filename: `${base}.pdf`,
        contentType: 'application/pdf',
        base64: (await analysisPdf(b.analysis, head, q.annexure ?? null)).toString('base64'),
      };
    });
  }

  // ---- phase D: the teacher's own page, the student's record, the parent app, the dashboard ----

  /** A school setting from today (as SettingsService.set: the open row closed, today's replaced). */
  private async putSetting(c: PoolClient, key: string, value: unknown) {
    await c.query(
      `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
        WHERE key = $1 AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
      [key],
    );
    await c.query(`DELETE FROM school_settings WHERE key = $1 AND valid_from = CURRENT_DATE`, [
      key,
    ]);
    await c.query(
      `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
      [key, JSON.stringify(value)],
    );
  }

  private async parentsOn(c: PoolClient): Promise<boolean> {
    const r = await c.query<{ v: unknown }>(`SELECT app.setting($1) AS v`, [PARENTS]);
    return r.rows[0]?.v === true;
  }

  async parents(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({ on: await this.parentsOn(c) }));
  }

  /** Show (or stop showing) a child's board result on the parent app. */
  async setParents(ctx: RequestContext, on: boolean) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.parentsOn(c);
      await this.putSetting(c, PARENTS, on);
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.parents',
        entityType: 'school_settings',
        entityId: requireTenant(ctx).schoolId,
        before: { on: before },
        after: { on },
      });
      return { on };
    });
  }

  /** Students' board results, every saved year: subjects with marks and grades, the result, the best five. */
  private async resultsOf(c: PoolClient, studentIds: string[]) {
    if (!studentIds.length) return [];
    const cands = await c.query<{
      id: string;
      student_id: string;
      class_label: BoardClass;
      exam_year: number;
      roll_no: string;
      name: string | null;
      result: string | null;
      compartment: string[];
    }>(
      `SELECT id::text, student_id::text, class_label, exam_year, roll_no, name, result, compartment
         FROM board_candidates WHERE board = 'CBSE' AND student_id = ANY($1::bigint[])
        ORDER BY exam_year DESC, class_label DESC`,
      [studentIds],
    );
    if (!cands.rows.length) return [];
    const marks = await c.query<{
      candidate_id: string;
      code: string;
      total: string | null;
      grade: string | null;
    }>(
      `SELECT candidate_id::text, subject_code AS code, total::text, grade FROM board_results
        WHERE candidate_id = ANY($1::bigint[]) ORDER BY candidate_id, slot NULLS LAST, subject_code`,
      [cands.rows.map((x) => x.id)],
    );
    const lists = new Map<BoardClass, AnSubject[]>();
    const rulesBy = new Map<BoardClass, BoardRules>();
    for (const cls of new Set(cands.rows.map((x) => x.class_label))) {
      lists.set(cls, await this.subjectsOf(c, cls));
      rulesBy.set(cls, (await this.rulesOf(c, cls)).rules);
    }
    return cands.rows.map((x) => {
      const subjects = lists.get(x.class_label)!;
      const rules = rulesBy.get(x.class_label)!;
      const kind = (code: string) => subjects.find((s) => s.code === code)?.kind;
      const nameOf = (code: string) =>
        subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`;
      const ms = marks.rows
        .filter((m) => m.candidate_id === x.id)
        .map((m) => ({
          code: m.code,
          marks: m.total === null ? null : Number(m.total),
          grade: m.grade,
        }));
      const cand: AnCandidate = {
        roll: x.roll_no,
        name: x.name,
        sex: null,
        result: x.result,
        compartment: x.compartment,
        section: null,
        stream: null,
        category: null,
        ews: null,
        cwsn: null,
        boarder: null,
        staffWard: null,
        marks: ms,
      };
      const best = ms.some((m) => m.marks !== null) ? bestFive(cand, kind, rules, nameOf) : null;
      return {
        studentId: x.student_id,
        classLabel: x.class_label,
        examYear: x.exam_year,
        roll: x.roll_no,
        result: x.result,
        compartment: x.compartment.map((code) => ({ code, name: nameOf(code) })),
        subjects: ms.map((m) => ({
          code: m.code,
          name: nameOf(m.code),
          kind: kind(m.code) ?? null,
          marks: m.marks,
          grade: m.grade,
          inBestFive: best?.codes.includes(m.code) ?? false,
        })),
        bestFive: best ? { total: best.total, percent: best.percent } : null,
        rule: ruleWords(rules.bestFive),
      };
    });
  }

  /** One student's board results (the student's record). */
  async student(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      rows: await this.resultsOf(c, [studentId]),
    }));
  }

  /** The family's children's board results — only when the school shows them on the parent app. */
  async family(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'exams.family.view');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const enabled = await this.parentsOn(c);
      if (!enabled || v.kind !== 'family') return { enabled, children: [] };
      const rows = await this.resultsOf(
        c,
        v.students.map((s) => s.id),
      );
      return {
        enabled,
        children: v.students
          .map((s) => ({
            studentId: s.id,
            name: s.name,
            results: rows.filter((r) => r.studentId === s.id),
          }))
          .filter((x) => x.results.length),
      };
    });
  }

  /**
   * My board results (the staff app): for each class with a saved year, the sections and subjects this teacher
   * taught — by the year's teacher assignments or the Teachers tab's overrides.
   */
  async mine(ctx: RequestContext, examYear?: number) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emp = (
        await c.query<{ id: string; name: string }>(
          `SELECT id::text, display_name AS name FROM employees
            WHERE user_id = app.current_user_id() AND deleted_at IS NULL ORDER BY id LIMIT 1`,
        )
      ).rows[0];
      if (!emp) return { employee: null, classes: [] };
      const classes = [];
      for (const cls of ['X', 'XII'] as const) {
        const { rules } = await this.rulesOf(c, cls);
        const years = (
          await c.query<{ y: number }>(
            `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
            [cls],
          )
        ).rows.map((r) => r.y);
        const y = examYear !== undefined && years.includes(examYear) ? examYear : years[0];
        if (y === undefined) continue;
        const who = await this.details.teacherResolver(c, 'CBSE', cls, y);
        const view = teacherView(
          {
            candidates: await this.candidatesOf(c, cls, y),
            subjects: await this.subjectsOf(c, cls),
            rules,
            teacherIds: (section, code, roll) => who(section, code, roll)?.employeeIds ?? [],
          },
          emp.id,
        );
        if (view.tables[0]!.rows.length)
          classes.push({
            classLabel: cls,
            examYear: y,
            years,
            students: view.students,
            tables: view.tables,
          });
      }
      return { employee: emp, classes };
    });
  }

  /** The exam page's figures: each class's latest saved year. */
  async summary(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const out = [];
      for (const cls of ['X', 'XII'] as const) {
        const { rules } = await this.rulesOf(c, cls);
        const y = (
          await c.query<{ y: number | null }>(
            `SELECT max(exam_year) AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1`,
            [cls],
          )
        ).rows[0]?.y;
        if (!y) continue;
        const subjects = await this.subjectsOf(c, cls);
        const f = yearFigures(y, await this.candidatesOf(c, cls, y), subjects, rules);
        out.push({
          classLabel: cls,
          examYear: y,
          appeared: f.appeared,
          passPct: f.passPct ?? null,
          aggregate: f.aggregate,
          pct90: f.pct90,
          pi: f.pi ?? null,
        });
      }
      return { classes: out };
    });
  }

  // ---- phase E: an earlier year's figures typed in (its result file lost) ----

  private async typedOf(c: PoolClient, classLabel: BoardClass): Promise<TypedYear[]> {
    const r = await c.query<{
      id: string;
      exam_year: number;
      registered: number | null;
      appeared: number;
      passed: number | null;
      compartments: number | null;
      failures: number | null;
      n90: number | null;
      n75: number | null;
      aggregate: string | null;
      pi: string | null;
      subjects: Record<string, TypedSubject>;
      note: string | null;
      updated_at: Date;
    }>(
      `SELECT id::text, exam_year, registered, appeared, passed, compartments, failures, n90, n75,
              aggregate::text, pi::text, subjects, note, updated_at
         FROM board_year_figures WHERE board = 'CBSE' AND class_label = $1 ORDER BY exam_year DESC`,
      [classLabel],
    );
    return r.rows.map((x) => ({
      id: x.id,
      examYear: x.exam_year,
      registered: x.registered,
      appeared: x.appeared,
      passed: x.passed,
      compartments: x.compartments,
      failures: x.failures,
      n90: x.n90,
      n75: x.n75,
      aggregate: x.aggregate === null ? null : Number(x.aggregate),
      pi: x.pi === null ? null : Number(x.pi),
      subjects: x.subjects,
      note: x.note,
      updatedAt: x.updated_at.toISOString(),
    }));
  }

  /** A typed year as the five-year rows and the trend read it. */
  private static typedYear(t: TypedYear): AnYear {
    const share = (n: number | null) =>
      n === null || !t.appeared ? null : round2((n * 100) / t.appeared);
    return {
      examYear: t.examYear,
      appeared: t.appeared,
      pct90: share(t.n90),
      pct75: share(t.n75),
      aggregate: t.aggregate,
      passPct: share(t.passed),
      pi: t.pi,
      subjects: Object.fromEntries(
        Object.entries(t.subjects).map(([code, s]) => [
          code,
          { pi: s.pi ?? null, average: s.average ?? null },
        ]),
      ),
    };
  }

  /** A typed year's subjects as Annexure 5 compares with them. */
  private static typedSubjects(t: TypedYear): Map<string, SubjectFigures> {
    return new Map(
      Object.entries(t.subjects).map(([code, s]) => [
        code,
        {
          code,
          appeared: s.appeared,
          highest: s.highest ?? null,
          aGrades: s.aGrades ?? 0,
          compartments: s.compartments ?? 0,
          failures: s.failures ?? 0,
          distinctions: s.distinctions ?? 0,
          average: s.average ?? null,
          pi: s.pi ?? null,
        },
      ]),
    );
  }

  /** The typed years of a class, each with whether a saved file now covers it (the file wins). */
  async yearFigures(ctx: RequestContext, classLabel: BoardClass) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const files = new Set(
        (
          await c.query<{ y: number }>(
            `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1`,
            [classLabel],
          )
        ).rows.map((r) => r.y),
      );
      return {
        classLabel,
        subjects: (await this.subjectsOf(c, classLabel)).filter((s) => s.kind !== 'internal'),
        rows: (await this.typedOf(c, classLabel)).map((t) => ({
          ...t,
          subjects: Object.entries(t.subjects).map(([code, s]) => ({ ...s, code })),
          fileSaved: files.has(t.examYear),
        })),
      };
    });
  }

  /** Type (or correct) an earlier year's figures. A year whose result file is saved takes its figures from the file. */
  async saveYearFigures(ctx: RequestContext, dto: BoardYearFiguresDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const file = await c.query(
        `SELECT 1 FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 AND exam_year = $2 LIMIT 1`,
        [dto.classLabel, dto.examYear],
      );
      if (file.rowCount)
        throw new DomainError(
          'conflict',
          `The Class ${dto.classLabel} ${String(dto.examYear)} result file is saved: its figures come from the file`,
          { status: 409 },
        );
      const subjects = Object.fromEntries(
        dto.subjects.map(({ code, ...s }) => [
          code,
          Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null)),
        ]),
      );
      const r = await c.query<{ id: string; inserted: boolean }>(
        `INSERT INTO board_year_figures (school_id, board, class_label, exam_year, registered, appeared, passed, compartments,
                                         failures, n90, n75, aggregate, pi, subjects, note, created_by, updated_by)
         VALUES (app.current_school_id(), 'CBSE', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13,
                 app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, board, class_label, exam_year) DO UPDATE SET
           registered = EXCLUDED.registered, appeared = EXCLUDED.appeared, passed = EXCLUDED.passed,
           compartments = EXCLUDED.compartments, failures = EXCLUDED.failures, n90 = EXCLUDED.n90, n75 = EXCLUDED.n75,
           aggregate = EXCLUDED.aggregate, pi = EXCLUDED.pi, subjects = EXCLUDED.subjects, note = EXCLUDED.note,
           updated_by = app.current_user_id(), updated_at = now()
         RETURNING id::text, (xmax = 0) AS inserted`,
        [
          dto.classLabel,
          dto.examYear,
          dto.registered ?? null,
          dto.appeared,
          dto.passed ?? null,
          dto.compartments ?? null,
          dto.failures ?? null,
          dto.n90 ?? null,
          dto.n75 ?? null,
          dto.aggregate ?? null,
          dto.pi ?? null,
          JSON.stringify(subjects),
          dto.note ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.year_figures',
        entityType: 'board_year_figures',
        entityId: r.rows[0]!.id,
        after: {
          classLabel: dto.classLabel,
          examYear: dto.examYear,
          appeared: dto.appeared,
          subjects: dto.subjects.length,
          inserted: r.rows[0]!.inserted,
        },
      });
      return { id: r.rows[0]!.id, inserted: r.rows[0]!.inserted };
    });
  }

  async removeYearFigures(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ class_label: string; exam_year: number }>(
        `DELETE FROM board_year_figures WHERE id = $1 RETURNING class_label, exam_year`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.year_figures_remove',
        entityType: 'board_year_figures',
        entityId: id,
        before: { classLabel: r.rows[0].class_label, examYear: r.rows[0].exam_year },
      });
      return { removed: true };
    });
  }

  // ---- the Results tab: candidate-wise marks ----

  private async marksOf(c: PoolClient, q: BoardMarksQueryDto) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const examYear = q.examYear !== undefined && years.includes(q.examYear) ? q.examYear : years[0];
    const { rules } = await this.rulesOf(c, q.classLabel);
    if (examYear === undefined)
      return {
        examYear: null,
        years,
        sections: [] as string[],
        results: [],
        rules,
        rows: [] as MarksRow[],
      };
    const subjects = await this.subjectsOf(c, q.classLabel);
    const all = marksRows(
      await this.candidatesOf(c, q.classLabel, examYear),
      subjects,
      rules,
      q.method,
    );
    const sections = [
      ...new Set(all.map((r) => r.section).filter((x): x is string => Boolean(x))),
    ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const counts = new Map<string, number>();
    for (const r of all) counts.set(r.result ?? '—', (counts.get(r.result ?? '—') ?? 0) + 1);
    return {
      examYear,
      years,
      sections,
      results: [...counts].map(([word, n]) => ({ word, n })).sort((a, b) => b.n - a.n),
      rules,
      rows: filterMarks(all, q),
    };
  }

  /** The Results tab: one row a candidate with every subject, the aggregate, the percentage and the class rank. */
  async marks(ctx: RequestContext, q: BoardMarksQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const m = await this.marksOf(c, q);
      const from = (q.page - 1) * q.size;
      const page = m.rows.slice(from, from + q.size);
      return {
        classLabel: q.classLabel,
        examYear: m.examYear,
        years: m.years,
        sections: m.sections,
        results: m.results,
        method: q.method,
        rule: ruleWords(m.rules.bestFive),
        total: m.rows.length,
        page: q.page,
        size: q.size,
        maxSubjects: Math.max(0, ...page.map((r) => r.subjects.length)),
        rows: page.map((r, i) => ({ sr: from + i + 1, ...r })),
      };
    });
  }

  /** The Results tab's list (every row the filters keep) as Excel or PDF. */
  async marksFile(ctx: RequestContext, q: BoardMarksFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const m = await this.marksOf(c, q);
      if (m.examYear === null)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const words = [
        `Class ${q.classLabel}`,
        q.section ? `Section ${q.section}` : 'all sections',
        q.result ? `result ${q.result}` : '',
        q.band ? `percentage ${BAND_WORDS[q.band]}` : '',
        q.q ? `"${q.q}"` : '',
        `${String(m.rows.length)} candidates`,
      ].filter(Boolean);
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        title: `CBSE ${q.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} result (Class ${q.classLabel}) ${yearLabel(m.examYear)}`,
        scope: words.join(' · '),
        method:
          q.method === 'best5'
            ? `Aggregate: best five (${ruleWords(m.rules.bestFive)})`
            : q.method === 'first5'
              ? 'Aggregate: the first five subjects as CBSE printed them'
              : 'Aggregate: all subjects with marks',
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.marks_export',
        entityType: 'board_candidates',
        entityId: requireTenant(ctx).schoolId,
        after: {
          classLabel: q.classLabel,
          examYear: m.examYear,
          format: q.format,
          rows: m.rows.length,
          method: q.method,
          section: q.section ?? null,
          result: q.result ?? null,
          band: q.band ?? null,
        },
      });
      const base = `CBSE-Class-${q.classLabel}-${String(m.examYear)}-student-marks`;
      return q.format === 'xlsx'
        ? {
            filename: `${base}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: (await marksXlsx(m.rows, q.classLabel, head)).toString('base64'),
          }
        : {
            filename: `${base}.pdf`,
            contentType: 'application/pdf',
            base64: (await marksPdf(m.rows, q.classLabel, head)).toString('base64'),
          };
    });
  }

  // ---- the Reports tab: Range Wise Subject Summary ----

  private async rangeOf(c: PoolClient, q: BoardRangeQueryDto) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const examYear = q.examYear !== undefined && years.includes(q.examYear) ? q.examYear : years[0];
    const { rules } = await this.rulesOf(c, q.classLabel);
    const subjects = await this.subjectsOf(c, q.classLabel);
    if (examYear === undefined) return { examYear: null, years, subjects, rules, summary: null };
    // the year asked and the saved years before it that the comparison takes
    const chosen = [examYear, ...years.filter((y) => y < examYear).slice(0, q.compare)];
    const data = [];
    for (const y of chosen)
      data.push({ examYear: y, candidates: await this.candidatesOf(c, q.classLabel, y) });
    return {
      examYear,
      years,
      subjects,
      rules,
      summary: rangeSubjectSummary(data, subjects, rules, { gender: q.gender, code: q.code }),
    };
  }

  /** Range Wise Subject Summary: each subject's 21 figures for the year and the saved years compared. */
  async rangeSummary(ctx: RequestContext, q: BoardRangeQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.rangeOf(c, q);
      return {
        classLabel: q.classLabel,
        examYear: r.examYear,
        years: r.years,
        compare: q.compare,
        gender: q.gender,
        code: q.code ?? null,
        subjects: r.subjects
          .filter((s) => s.kind !== 'internal')
          .map((s) => ({ code: s.code, name: s.name })),
        grades: r.rules.grades,
        summary: r.summary,
      };
    });
  }

  async rangeSummaryFile(ctx: RequestContext, q: BoardRangeFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.rangeOf(c, q);
      if (!r.summary || r.examYear === null)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        title: `CBSE ${q.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} (Class ${q.classLabel}) · Range wise subject summary`,
        scope: [
          r.summary.years.map((y) => yearLabel(y)).join(' against '),
          q.gender === 'M' ? 'boys' : q.gender === 'F' ? 'girls' : 'all students',
          q.code ? `subject ${q.code}` : 'all subjects',
        ].join(' · '),
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.report_export',
        entityType: 'board_candidates',
        entityId: requireTenant(ctx).schoolId,
        after: {
          report: 'range-subjects',
          classLabel: q.classLabel,
          years: r.summary.years,
          gender: q.gender,
          code: q.code ?? null,
          format: q.format,
        },
      });
      const base = `CBSE-Class-${q.classLabel}-${String(r.examYear)}-range-wise-subject-summary`;
      return q.format === 'xlsx'
        ? {
            filename: `${base}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: (await rangeXlsx(r.summary, head)).toString('base64'),
          }
        : {
            filename: `${base}.pdf`,
            contentType: 'application/pdf',
            base64: (await rangePdf(r.summary, head)).toString('base64'),
          };
    });
  }

  // ---- the Reports tab: Range Wise Summary (the class's result) ----

  private async overallOf(c: PoolClient, q: BoardOverallQueryDto) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const examYear = q.examYear !== undefined && years.includes(q.examYear) ? q.examYear : years[0];
    const { rules } = await this.rulesOf(c, q.classLabel);
    if (examYear === undefined) return { examYear: null, years, rules, summary: null };
    const subjects = await this.subjectsOf(c, q.classLabel);
    const data = [];
    for (const y of [examYear, ...years.filter((x) => x < examYear).slice(0, q.compare)])
      data.push({ examYear: y, candidates: await this.candidatesOf(c, q.classLabel, y) });
    return {
      examYear,
      years,
      rules,
      summary: rangeOverall(data, subjects, rules, { gender: q.gender, method: q.method }),
    };
  }

  /** Range Wise Summary: the class's result in figures for the year and the saved years compared. */
  async overallSummary(ctx: RequestContext, q: BoardOverallQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.overallOf(c, q);
      return {
        classLabel: q.classLabel,
        examYear: r.examYear,
        years: r.years,
        compare: q.compare,
        gender: q.gender,
        method: q.method,
        rule: ruleWords(r.rules.bestFive),
        summary: r.summary,
      };
    });
  }

  async overallSummaryFile(ctx: RequestContext, q: BoardOverallFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.overallOf(c, q);
      if (!r.summary || r.examYear === null)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        title: `CBSE ${q.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} (Class ${q.classLabel}) · Range wise summary`,
        scope: [
          r.summary.years.map((y) => yearLabel(y)).join(' against '),
          q.gender === 'M' ? 'boys' : q.gender === 'F' ? 'girls' : 'all students',
          q.method === 'best5'
            ? `aggregate of the best five (${ruleWords(r.rules.bestFive)})`
            : q.method === 'first5'
              ? 'aggregate of the first five subjects as printed'
              : 'aggregate of all subjects',
        ].join(' · '),
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.report_export',
        entityType: 'board_candidates',
        entityId: requireTenant(ctx).schoolId,
        after: {
          report: 'range-overall',
          classLabel: q.classLabel,
          years: r.summary.years,
          gender: q.gender,
          method: q.method,
          format: q.format,
        },
      });
      const base = `CBSE-Class-${q.classLabel}-${String(r.examYear)}-range-wise-summary`;
      return q.format === 'xlsx'
        ? {
            filename: `${base}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: (await rangeXlsx(r.summary, head, OVERALL_LABELS)).toString('base64'),
          }
        : {
            filename: `${base}.pdf`,
            contentType: 'application/pdf',
            base64: (await rangePdf(r.summary, head, OVERALL_LABELS)).toString('base64'),
          };
    });
  }

  // ---- the Reports tab: Subject Summary (every subject by boys and girls) ----

  private async subjectPerfOf(c: PoolClient, q: BoardSubjectPerfQueryDto) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const examYear = q.examYear !== undefined && years.includes(q.examYear) ? q.examYear : years[0];
    const { rules } = await this.rulesOf(c, q.classLabel);
    const subjects = await this.subjectsOf(c, q.classLabel);
    if (examYear === undefined) return { examYear: null, years, subjects, table: null };
    return {
      examYear,
      years,
      subjects,
      table: subjectPerformance(
        await this.candidatesOf(c, q.classLabel, examYear),
        subjects,
        rules,
        { gender: q.gender, code: q.code },
      ),
    };
  }

  /** Subject Summary: a row a subject with boys and girls, results, averages and the marks ranges. */
  async subjectPerf(ctx: RequestContext, q: BoardSubjectPerfQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.subjectPerfOf(c, q);
      return {
        classLabel: q.classLabel,
        examYear: r.examYear,
        years: r.years,
        gender: q.gender,
        code: q.code ?? null,
        subjects: r.subjects
          .filter((s) => s.kind !== 'internal')
          .map((s) => ({ code: s.code, name: s.name })),
        table: r.table,
      };
    });
  }

  async subjectPerfFile(ctx: RequestContext, q: BoardSubjectPerfFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.subjectPerfOf(c, q);
      if (!r.table || r.examYear === null)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        title: `CBSE ${q.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} result (Class ${q.classLabel}) ${yearLabel(r.examYear)} · all subject performance (percentage-based, not grade-based)`,
        scope: [
          q.gender === 'M' ? 'boys' : q.gender === 'F' ? 'girls' : 'all students',
          q.code ? `subject ${q.code}` : 'all subjects',
        ].join(' · '),
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.report_export',
        entityType: 'board_candidates',
        entityId: requireTenant(ctx).schoolId,
        after: {
          report: 'subject-summary',
          classLabel: q.classLabel,
          examYear: r.examYear,
          gender: q.gender,
          code: q.code ?? null,
          format: q.format,
        },
      });
      const base = `CBSE-Class-${q.classLabel}-${String(r.examYear)}-subject-summary`;
      return q.format === 'xlsx'
        ? {
            filename: `${base}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: (await singleTableXlsx(r.table, head)).toString('base64'),
          }
        : {
            filename: `${base}.pdf`,
            contentType: 'application/pdf',
            base64: (await singleTablePdf(r.table, head)).toString('base64'),
          };
    });
  }

  // ---- the Reports tab: Teacher wise result analysis ----

  private async teacherAnalysisOf(c: PoolClient, q: BoardTeacherAnalysisQueryDto) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const examYear = q.examYear !== undefined && years.includes(q.examYear) ? q.examYear : years[0];
    const { rules } = await this.rulesOf(c, q.classLabel);
    const subjects = await this.subjectsOf(c, q.classLabel);
    if (examYear === undefined)
      return { examYear: null, years, subjects, teachers: [], table: null };
    const who = await this.details.teacherResolver(c, 'CBSE', q.classLabel, examYear);
    const r = teacherAnalysisTable(
      await this.candidatesOf(c, q.classLabel, examYear),
      subjects,
      rules,
      (section, code, roll) => who(section, code, roll)?.people ?? [],
      { gender: q.gender, code: q.code, teacher: q.teacher },
    );
    return { examYear, years, subjects, teachers: r.teachers, table: r.table };
  }

  /** Teacher wise result analysis: a teacher's subjects and sections with the result analysis figures. */
  async teacherAnalysis(ctx: RequestContext, q: BoardTeacherAnalysisQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.teacherAnalysisOf(c, q);
      return {
        classLabel: q.classLabel,
        examYear: r.examYear,
        years: r.years,
        gender: q.gender,
        code: q.code ?? null,
        teacher: q.teacher ?? null,
        subjects: r.subjects
          .filter((s) => s.kind !== 'internal')
          .map((s) => ({ code: s.code, name: s.name })),
        teachers: r.teachers,
        table: r.table,
      };
    });
  }

  async teacherAnalysisFile(ctx: RequestContext, q: BoardTeacherAnalysisFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.teacherAnalysisOf(c, q);
      if (!r.table || r.examYear === null)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const teacher = q.teacher ? r.teachers.find((t) => t.key === q.teacher)?.name : null;
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        title: `CBSE ${q.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} result (Class ${q.classLabel}) ${yearLabel(r.examYear)} · teacher wise result analysis`,
        scope: [
          teacher ?? 'all teachers',
          q.gender === 'M' ? 'boys' : q.gender === 'F' ? 'girls' : 'all students',
          q.code ? `subject ${q.code}` : 'all subjects',
        ].join(' · '),
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.report_export',
        entityType: 'board_candidates',
        entityId: requireTenant(ctx).schoolId,
        after: {
          report: 'teacher-analysis',
          classLabel: q.classLabel,
          examYear: r.examYear,
          gender: q.gender,
          code: q.code ?? null,
          teacher: q.teacher ?? null,
          format: q.format,
        },
      });
      const base = `CBSE-Class-${q.classLabel}-${String(r.examYear)}-teacher-analysis`;
      return q.format === 'xlsx'
        ? {
            filename: `${base}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: (await singleTableXlsx(r.table, head)).toString('base64'),
          }
        : {
            filename: `${base}.pdf`,
            contentType: 'application/pdf',
            base64: (await singleTablePdf(r.table, head)).toString('base64'),
          };
    });
  }

  // ---- the Reports tab: Result Analysis (the subject table and its charts) ----

  private async resultAnalysisOf(c: PoolClient, q: BoardResultAnalysisQueryDto) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const examYear = q.examYear !== undefined && years.includes(q.examYear) ? q.examYear : years[0];
    const { rules } = await this.rulesOf(c, q.classLabel);
    const subjects = await this.subjectsOf(c, q.classLabel);
    if (examYear === undefined)
      return { examYear: null, years, subjects, rules, table: null, charts: null, results: [] };
    const data = [];
    for (const y of [examYear, ...years.filter((x) => x < examYear).slice(0, q.compare)])
      data.push({ examYear: y, candidates: await this.candidatesOf(c, q.classLabel, y) });
    const opts = { gender: q.gender, code: q.code, result: q.result };
    const counts = new Map<string, number>();
    for (const cand of data[0]!.candidates)
      counts.set(cand.result ?? '—', (counts.get(cand.result ?? '—') ?? 0) + 1);
    return {
      examYear,
      years,
      subjects,
      rules,
      table: resultAnalysisTable(data[0]!.candidates, subjects, rules, opts),
      charts: resultCharts(data, subjects, rules, opts),
      results: [...counts].map(([word, n]) => ({ word, n })).sort((a, b) => b.n - a.n),
    };
  }

  /** Result Analysis: the subject table (24 figures a subject) and the charts across the years compared. */
  async resultAnalysis(ctx: RequestContext, q: BoardResultAnalysisQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.resultAnalysisOf(c, q);
      return {
        classLabel: q.classLabel,
        examYear: r.examYear,
        years: r.years,
        compare: q.compare,
        gender: q.gender,
        code: q.code ?? null,
        result: q.result ?? null,
        results: r.results,
        grades: r.rules.grades,
        subjects: r.subjects
          .filter((s) => s.kind !== 'internal')
          .map((s) => ({ code: s.code, name: s.name })),
        table: r.table,
        charts: r.charts,
      };
    });
  }

  async resultAnalysisFile(ctx: RequestContext, q: BoardResultAnalysisFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.resultAnalysisOf(c, q);
      if (!r.table || r.examYear === null)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        title: `CBSE ${q.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} result (Class ${q.classLabel}) ${yearLabel(r.examYear)} · result analysis`,
        scope: [
          q.gender === 'both'
            ? 'all, boys and girls'
            : q.gender === 'M'
              ? 'boys'
              : q.gender === 'F'
                ? 'girls'
                : 'all students',
          q.code ? `subject ${q.code}` : 'all subjects',
          q.result ? `result ${q.result}` : 'all results',
          ...(q.view === 'graphs' && r.charts && r.charts.passTrend.labels.length > 1
            ? [`years ${r.charts.passTrend.labels[0]!} to ${r.charts.passTrend.labels.at(-1)!}`]
            : []),
        ].join(' · '),
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.report_export',
        entityType: 'board_candidates',
        entityId: requireTenant(ctx).schoolId,
        after: {
          report: q.view === 'graphs' ? 'result-analysis-graphs' : 'result-analysis',
          classLabel: q.classLabel,
          examYear: r.examYear,
          gender: q.gender,
          code: q.code ?? null,
          result: q.result ?? null,
          ...(q.view === 'graphs' ? { compare: q.compare } : {}),
          format: q.format,
        },
      });
      const base = `CBSE-Class-${q.classLabel}-${String(r.examYear)}-result-analysis`;
      if (q.view === 'graphs')
        return {
          filename: `${base}-graphs.pdf`,
          contentType: 'application/pdf',
          base64: (await resultChartsPdf(r.charts!, head, { code: q.code })).toString('base64'),
        };
      return q.format === 'xlsx'
        ? {
            filename: `${base}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: (await singleTableXlsx(r.table, head)).toString('base64'),
          }
        : {
            filename: `${base}.pdf`,
            contentType: 'application/pdf',
            base64: (await singleTablePdf(r.table, head)).toString('base64'),
          };
    });
  }

  // ---- the Reports tab: Topper Report ----

  private async toppersOf(c: PoolClient, q: BoardToppersQueryDto) {
    const years = (
      await c.query<{ y: number }>(
        `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 ORDER BY 1 DESC`,
        [q.classLabel],
      )
    ).rows.map((r) => r.y);
    const examYear = q.examYear !== undefined && years.includes(q.examYear) ? q.examYear : years[0];
    const { rules } = await this.rulesOf(c, q.classLabel);
    const subjects = await this.subjectsOf(c, q.classLabel);
    if (examYear === undefined)
      return { examYear: null, years, rules, subjects, sections: [] as string[], report: null };
    const data = [];
    for (const y of [examYear, ...years.filter((x) => x < examYear).slice(0, q.compare)])
      data.push({ examYear: y, candidates: await this.candidatesOf(c, q.classLabel, y) });
    const sections = [
      ...new Set(data[0]!.candidates.map((x) => x.section).filter((x): x is string => Boolean(x))),
    ].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const report = toppersReport(data, subjects, rules, {
      method: q.method,
      gender: q.gender,
      section: q.section,
      show: q.show,
      codes: q.codes ? q.codes.split(',') : undefined,
      top: q.top,
      low: q.low,
      pctOp: q.pct === undefined ? undefined : q.pctOp,
      pct: q.pctOp ? q.pct : undefined,
    });
    return { examYear, years, rules, subjects, sections, report };
  }

  /** Topper Report: the class's and each subject's toppers (dense ranks), the lowest, a percentage list, the years. */
  async toppers(ctx: RequestContext, q: BoardToppersQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.toppersOf(c, q);
      return {
        classLabel: q.classLabel,
        examYear: r.examYear,
        years: r.years,
        compare: q.compare,
        method: q.method,
        rule: ruleWords(r.rules.bestFive),
        gender: q.gender,
        section: q.section ?? null,
        sections: r.sections,
        show: q.show,
        codes: q.codes ? q.codes.split(',') : [],
        top: q.top,
        low: q.low,
        pctOp: q.pctOp && q.pct !== undefined ? q.pctOp : null,
        pct: q.pctOp && q.pct !== undefined ? q.pct : null,
        subjects: r.subjects
          .filter((s) => s.kind !== 'internal')
          .map((s) => ({ code: s.code, name: s.name })),
        report: r.report,
      };
    });
  }

  async toppersFile(ctx: RequestContext, q: BoardToppersFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.toppersOf(c, q);
      if (!r.report || r.examYear === null)
        throw new DomainError('not-found', `No saved Class ${q.classLabel} result`, {
          status: 404,
        });
      const h = await registerLetterhead(c);
      const method =
        q.method === 'best5'
          ? `best five (${ruleWords(r.rules.bestFive)}), out of 500`
          : q.method === 'first5'
            ? 'the first five subjects as CBSE printed them, out of 500'
            : 'all subjects with marks';
      const head = {
        school: h.school,
        address: h.address,
        logo: q.format === 'pdf' ? await registerLogo(this.storage, h.file) : null,
        generatedOn: registerGeneratedOn(),
        by: ctx.user.displayName,
        title: `CBSE ${q.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} result (Class ${q.classLabel}) ${yearLabel(r.examYear)}`,
        scope: [
          q.section ? `Section ${q.section}` : 'all sections',
          q.gender === 'M' ? 'boys' : q.gender === 'F' ? 'girls' : 'all students',
          q.show === 'overall'
            ? 'class toppers'
            : q.show === 'subjects'
              ? 'subject toppers'
              : 'class and subject toppers',
          q.codes ? `subjects ${q.codes.split(',').join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        method,
        top: Math.max(1, q.top),
      };
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.report_export',
        entityType: 'board_candidates',
        entityId: requireTenant(ctx).schoolId,
        after: {
          report: 'toppers',
          classLabel: q.classLabel,
          examYear: r.examYear,
          section: q.section ?? null,
          gender: q.gender,
          show: q.show,
          top: q.top,
          low: q.low,
          format: q.format,
        },
      });
      const pct = q.pctOp && q.pct !== undefined ? { op: q.pctOp, value: q.pct } : {};
      const base = `CBSE-Class-${q.classLabel}-${String(r.examYear)}-toppers`;
      return q.format === 'xlsx'
        ? {
            filename: `${base}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            base64: (await toppersXlsx(r.report, head, pct)).toString('base64'),
          }
        : {
            filename: `${base}.pdf`,
            contentType: 'application/pdf',
            base64: (await toppersPdf(r.report, head, pct)).toString('base64'),
          };
    });
  }
}
