import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import {
  analyse,
  DEFAULT_BOARD_RULES,
  headlineOf,
  subjectFigures,
  type AnCandidate,
  type AnSubject,
  type AnYear,
  type BoardRules,
} from './board-analysis';
import { analysisPdf, analysisXlsx, examName } from './board-analysis-file';
import { BoardDetailsService } from './board-details.service';
import { BoardRulesSchema } from './board-results.dto';
import { CBSE_SUBJECTS, type BoardSubjectKind } from './board-subjects';
import { registerGeneratedOn, registerLetterhead, registerLogo } from './register-head';

type BoardClass = 'X' | 'XII';
const KEY = 'exams.board_rules';
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
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async rulesOf(c: PoolClient): Promise<{ rules: BoardRules; isDefault: boolean }> {
    const r = await c.query<{ v: unknown }>(`SELECT app.setting($1) AS v`, [KEY]);
    const parsed = BoardRulesSchema.safeParse({
      ...DEFAULT_BOARD_RULES,
      ...((r.rows[0]?.v as object | null) ?? {}),
    });
    return {
      rules: parsed.success ? parsed.data : DEFAULT_BOARD_RULES,
      isDefault: r.rows[0]?.v == null,
    };
  }

  async rules(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => this.rulesOf(c));
  }

  /** The rules from today (the setting keeps its history: earlier values stay with their dates). */
  async saveRules(ctx: RequestContext, rules: BoardRules) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.rulesOf(c);
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
        [KEY, JSON.stringify(rules)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.rules',
        entityType: 'school_settings',
        entityId: requireTenant(ctx).schoolId,
        before: before.rules,
        after: rules,
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
    }>(
      `SELECT id::text, roll_no, name, sex, result, compartment, section, stream, category, ews, cwsn, boarder, staff_ward
         FROM board_candidates WHERE board = 'CBSE' AND class_label = $1 AND exam_year = $2
          AND ($3::text IS NULL OR section = $3) ORDER BY roll_no`,
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
    const { rules, isDefault } = await this.rulesOf(c);
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
    const history: AnYear[] = [];
    for (const y of years.filter((x) => x < examYear).slice(0, 4)) {
      const h = headlineOf(await this.candidatesOf(c, q.classLabel, y, q.section), subjects, rules);
      history.push({
        examYear: y,
        appeared: h.appeared,
        pct90: h.pct90,
        pct75: h.pct75,
        aggregate: h.aggregate,
      });
    }
    const lastYear = years.includes(examYear - 1)
      ? subjectFigures(await this.candidatesOf(c, q.classLabel, examYear - 1, q.section), rules)
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
}
