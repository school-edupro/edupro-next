import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  BUILT_IN_LAYOUTS,
  builtInFingerprint,
  fingerprintOf,
  layoutFits,
  readGazette,
  type BoardClass,
  type GazetteCandidate,
  type GazetteLayout,
  type GazetteProblem,
} from './board-gazette';
import { BoardLayoutAi } from './board-layout-ai';
import type { GazetteUploadDto } from './board-results.dto';
import { IMPORT_COLUMNS, toImport, type BoardImportRow } from './board-results.service';

/** A candidate as kept in the import (preview) and saved on confirm. */
export interface GazetteRow extends GazetteCandidate {
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  match: 'roll' | 'name' | 'none';
}

export interface LayoutRow {
  key: string;
  name: string;
  classLabel: BoardClass;
  source: 'built-in' | 'claude' | 'edited';
  model: string | null;
  notes: string | null;
  active: boolean;
  learnedFrom: { importId: string; fileName: string | null } | null;
  createdAt: string | null;
}

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();

/** The figures shown on the preview (and kept with the import). */
export function gazetteFigures(rows: GazetteRow[], problems: GazetteProblem[]) {
  const results: Record<string, number> = {};
  const subjects = new Map<string, { candidates: number; absent: number; marks: number[] }>();
  for (const r of rows) {
    const word = r.result.split(' ')[0] || '—';
    results[word] = (results[word] ?? 0) + 1;
    for (const s of r.subjects) {
      const x = subjects.get(s.code) ?? { candidates: 0, absent: 0, marks: [] };
      x.candidates += 1;
      if (s.absent) x.absent += 1;
      if (s.marks !== null) x.marks.push(s.marks);
      subjects.set(s.code, x);
    }
  }
  const errors = problems.filter((p) => p.level === 'error');
  return {
    candidates: rows.length,
    appeared: rows.filter((r) => r.subjects.some((s) => s.marks !== null)).length,
    results,
    subjects: [...subjects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, x]) => ({
        code,
        candidates: x.candidates,
        absent: x.absent,
        highest: x.marks.length ? Math.max(...x.marks) : null,
        average: x.marks.length
          ? Math.round((x.marks.reduce((a, b) => a + b, 0) / x.marks.length) * 100) / 100
          : null,
      })),
    matched: {
      roll: rows.filter((r) => r.match === 'roll').length,
      name: rows.filter((r) => r.match === 'name').length,
      none: rows.filter((r) => r.match === 'none').length,
    },
    problems: {
      errors: errors.length,
      warnings: problems.length - errors.length,
      candidatesWithErrors: new Set(errors.map((p) => p.line)).size,
    },
  };
}

/**
 * CBSE result gazettes (docs/design/88, phase A): upload → read with a known layout (by its fingerprint, else
 * by trying each known one) or one Claude learns → checks → preview; confirm saves the candidates and their
 * subjects, replacing an earlier saved file of the same class and year, and keeps a learned layout for next time.
 */
@Injectable()
export class BoardGazetteService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ai: BoardLayoutAi,
  ) {}

  /** Known layouts of a class: the school's kept ones first, then the built-in ones. */
  private async known(c: PoolClient, board: string, classLabel: BoardClass) {
    const kept = await c.query<{
      id: string;
      name: string;
      fingerprint: string;
      spec: GazetteLayout;
    }>(
      `SELECT id::text, name, fingerprint, spec FROM board_layouts
        WHERE board = $1 AND class_label = $2 AND active ORDER BY id DESC`,
      [board, classLabel],
    );
    return [
      ...kept.rows.map((k) => ({
        key: `db:${k.id}`,
        name: k.name,
        fingerprint: k.fingerprint,
        layout: k.spec,
      })),
      ...(board === 'CBSE'
        ? BUILT_IN_LAYOUTS.filter((b) => b.classLabel === classLabel).map((b) => ({
            key: b.key,
            name: b.name,
            fingerprint: builtInFingerprint(b),
            layout: b.layout,
          }))
        : []),
    ];
  }

  /** The academic year and the examination year of an upload (an earlier year may have no academic year). */
  private async years(c: PoolClient, dto: Pick<GazetteUploadDto, 'academicYearId' | 'examYear'>) {
    if (dto.academicYearId) {
      const y = await c.query<{ year: number }>(
        `SELECT EXTRACT(YEAR FROM end_date)::int AS year FROM academic_years WHERE id = $1`,
        [dto.academicYearId],
      );
      if (!y.rows[0])
        throw new DomainError('not-found', 'Academic year not found', { status: 404 });
      return { academicYearId: dto.academicYearId, examYear: y.rows[0].year };
    }
    const y = await c.query<{ id: string }>(
      `SELECT id::text FROM academic_years WHERE EXTRACT(YEAR FROM end_date)::int = $1 ORDER BY id LIMIT 1`,
      [dto.examYear],
    );
    return { academicYearId: y.rows[0]?.id ?? null, examYear: dto.examYear! };
  }

  /** Students of the class that year: the board roll number on the enrolment, else the name (unique in the class). */
  private async match(
    c: PoolClient,
    classLabel: BoardClass,
    academicYearId: string | null,
    candidates: GazetteCandidate[],
  ): Promise<GazetteRow[]> {
    const pupils = academicYearId
      ? (
          await c.query<{ id: string; name: string; roll: string | null; admission_no: string }>(
            `SELECT DISTINCT s.id::text, s.display_name AS name, e.board_roll_no AS roll, s.admission_no
               FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
               JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
              WHERE e.academic_year_id = $1 AND k.code = $2`,
            [academicYearId, classLabel],
          )
        ).rows
      : [];
    const byRoll = new Map(pupils.filter((p) => p.roll).map((p) => [String(p.roll).trim(), p]));
    const names = new Map<string, typeof pupils>();
    for (const p of pupils) names.set(norm(p.name), [...(names.get(norm(p.name)) ?? []), p]);
    return candidates.map((cand) => {
      const roll = byRoll.get(cand.roll);
      const sameName = names.get(norm(cand.name)) ?? [];
      const p = roll ?? (sameName.length === 1 ? sameName[0] : undefined);
      return {
        ...cand,
        studentId: p?.id ?? null,
        student: p?.name ?? null,
        admissionNo: p?.admission_no ?? null,
        match: roll ? 'roll' : p ? 'name' : 'none',
      };
    });
  }

  /** Upload: read, check, match, keep as a preview (nothing saved to the results yet). */
  async upload(ctx: RequestContext, dto: GazetteUploadDto): Promise<BoardImportRow> {
    const tenant = requireTenant(ctx);
    const text = dto.text.replace(/\u0000/g, '');
    if (!/^\s*\d{6,10}\s/m.test(text))
      throw new DomainError(
        'board.not_a_gazette',
        'This does not look like a CBSE result file (no line starts with a roll number)',
        { status: 400 },
      );
    return this.db.tenant(tenant, async (c) => {
      const { academicYearId, examYear } = await this.years(c, dto);
      const fingerprint = fingerprintOf(text);
      const known = await this.known(c, dto.board, dto.classLabel);
      let chosen: { key: string; how: 'fingerprint' | 'tried' | 'claude' } | null = null;
      let read: ReturnType<typeof readGazette> | null = null;
      for (const k of known.filter((x) => x.fingerprint === fingerprint)) {
        const r = readGazette(text, k.layout);
        if (layoutFits(r).ok) {
          chosen = { key: k.key, how: 'fingerprint' };
          read = r;
          break;
        }
      }
      if (!chosen)
        for (const k of known) {
          const r = readGazette(text, k.layout);
          const fit = layoutFits(r);
          if (fit.ok && fit.bad === 0) {
            chosen = { key: k.key, how: 'tried' };
            read = r;
            break;
          }
        }
      // a new layout: Claude learns it from masked headings and samples (a refusal or no AI set up stops here)
      let learned: Awaited<ReturnType<BoardLayoutAi['learn']>> | null = null;
      if (!chosen) {
        learned = await this.ai.learn(c, text, dto.classLabel);
        read = readGazette(text, learned.layout);
      }
      const fit = layoutFits(read!);
      const rows = await this.match(c, dto.classLabel, academicYearId, read!.candidates);
      const figures = {
        ...gazetteFigures(rows, read!.problems),
        layout: learned
          ? {
              model: learned.model,
              notes: learned.notes,
              masked: learned.masked,
              usage: learned.usage,
            }
          : null,
      };
      const status = fit.ok ? 'validated' : 'failed';
      const ins = await c.query<{ id: string }>(
        `INSERT INTO board_result_imports (school_id, academic_year_id, exam_year, kind, board, class_label, file_name, status,
                                           total_rows, ok_rows, rejected_rows, unmatched_rows, report, payload, figures,
                                           layout_how, source_text, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, 'gazette', $3, $4, $5, $6::import_status, $7, $8, $9, $10, $11::jsonb,
                 $12::jsonb, $13::jsonb, $14, $15, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [
          academicYearId,
          examYear,
          dto.board,
          dto.classLabel,
          dto.fileName ?? null,
          status,
          rows.length,
          rows.length - fit.bad,
          fit.bad,
          figures.matched.none,
          JSON.stringify(read!.problems.slice(0, 1000)),
          JSON.stringify(rows),
          JSON.stringify(figures),
          chosen?.how ?? 'claude',
          text,
        ],
      );
      const importId = ins.rows[0]!.id;
      let layoutKey = chosen?.key ?? null;
      if (learned) {
        const l = await c.query<{ id: string }>(
          `INSERT INTO board_layouts (school_id, board, class_label, fingerprint, name, spec, source, model, notes, learned_from, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, 'claude', $6, $7, $8, app.current_user_id())
           RETURNING id::text`,
          [
            dto.board,
            dto.classLabel,
            fingerprint,
            `${dto.board} Class ${dto.classLabel} gazette (learned ${String(examYear)})`,
            JSON.stringify(learned.layout),
            learned.model,
            learned.notes.slice(0, 500) || null,
            importId,
          ],
        );
        layoutKey = `db:${l.rows[0]!.id}`;
      }
      await c.query(`UPDATE board_result_imports SET layout_key = $2 WHERE id = $1`, [
        importId,
        layoutKey,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.gazette_upload',
        entityType: 'board_result_imports',
        entityId: importId,
        after: {
          classLabel: dto.classLabel,
          examYear,
          candidates: rows.length,
          layout: layoutKey,
          how: chosen?.how ?? 'claude',
          status,
        },
      });
      return (await this.one(c, importId))!;
    });
  }

  /** Ask Claude again — told which checks failed — and read the file anew. */
  async relearn(ctx: RequestContext, importId: string): Promise<BoardImportRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = await c.query<{
        status: string;
        kind: string;
        class_label: BoardClass;
        board: string;
        academic_year_id: string | null;
        source_text: string | null;
        report: GazetteProblem[];
        exam_year: number;
      }>(
        `SELECT status::text, kind, class_label, board, academic_year_id::text, source_text, report, exam_year
           FROM board_result_imports WHERE id = $1 FOR UPDATE`,
        [importId],
      );
      const i = imp.rows[0];
      if (!i || i.kind !== 'gazette' || !i.source_text)
        throw new DomainError('not-found', 'Upload not found', { status: 404 });
      if (i.status === 'committed')
        throw new DomainError(
          'conflict',
          'This file is saved already; upload it again to read it anew',
          {
            status: 409,
          },
        );
      const failed = (i.report ?? []).filter((p) => p.level === 'error');
      const learned = await this.ai.learn(c, i.source_text, i.class_label, failed);
      const read = readGazette(i.source_text, learned.layout);
      const fit = layoutFits(read);
      const rows = await this.match(c, i.class_label, i.academic_year_id, read.candidates);
      const figures = {
        ...gazetteFigures(rows, read.problems),
        layout: {
          model: learned.model,
          notes: learned.notes,
          masked: learned.masked,
          usage: learned.usage,
        },
      };
      // the layout an earlier try left (not kept yet) gives way to this one
      await c.query(`DELETE FROM board_layouts WHERE learned_from = $1 AND NOT active`, [importId]);
      const l = await c.query<{ id: string }>(
        `INSERT INTO board_layouts (school_id, board, class_label, fingerprint, name, spec, source, model, notes, learned_from, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, 'claude', $6, $7, $8, app.current_user_id())
         RETURNING id::text`,
        [
          i.board,
          i.class_label,
          fingerprintOf(i.source_text),
          `${i.board} Class ${i.class_label} gazette (learned ${String(i.exam_year)})`,
          JSON.stringify(learned.layout),
          learned.model,
          learned.notes.slice(0, 500) || null,
          importId,
        ],
      );
      await c.query(
        `UPDATE board_result_imports SET status = $2::import_status, total_rows = $3, ok_rows = $4, rejected_rows = $5,
                unmatched_rows = $6, report = $7::jsonb, payload = $8::jsonb, figures = $9::jsonb, layout_key = $10,
                layout_how = 'claude'
          WHERE id = $1`,
        [
          importId,
          fit.ok ? 'validated' : 'failed',
          rows.length,
          rows.length - fit.bad,
          fit.bad,
          figures.matched.none,
          JSON.stringify(read.problems.slice(0, 1000)),
          JSON.stringify(rows),
          JSON.stringify(figures),
          `db:${l.rows[0]!.id}`,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.gazette_relearn',
        entityType: 'board_result_imports',
        entityId: importId,
        after: { status: fit.ok ? 'validated' : 'failed', candidates: rows.length },
      });
      return (await this.one(c, importId))!;
    });
  }

  private async one(c: PoolClient, id: string): Promise<BoardImportRow | null> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- IMPORT_COLUMNS is a constant
      `SELECT ${IMPORT_COLUMNS} FROM board_result_imports WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toImport(r.rows[0]) : null;
  }

  /** One upload with its candidates, problems, the layout it was read with and what it replaces. */
  async detail(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const base = await this.one(c, id);
      if (!base) throw new DomainError('not-found', 'Upload not found', { status: 404 });
      const r = await c.query<{
        payload: GazetteRow[];
        layout_key: string | null;
        academic_year_id: string | null;
        year: string | null;
        by: string | null;
        replaced_by: string | null;
      }>(
        `SELECT i.payload, i.layout_key, i.academic_year_id::text, y.name AS year, u.display_name AS by,
                i.replaced_by::text
           FROM board_result_imports i LEFT JOIN academic_years y ON y.id = i.academic_year_id
           LEFT JOIN users u ON u.id = i.requested_by WHERE i.id = $1`,
        [id],
      );
      const x = r.rows[0]!;
      const layout = await this.layoutRow(c, x.layout_key);
      const current = await c.query<{ id: string; file_name: string | null; committed_at: Date }>(
        `SELECT id::text, file_name, committed_at FROM board_result_imports
          WHERE status = 'committed' AND replaced_at IS NULL AND board = $1 AND class_label = $2 AND exam_year = $3 AND id <> $4
          ORDER BY committed_at DESC LIMIT 1`,
        [base.board, base.classLabel, base.examYear, id],
      );
      return {
        ...base,
        academicYear: x.year,
        by: x.by,
        layout,
        replacedBy: x.replaced_by,
        /** the saved file of the same class and year that confirming this one replaces */
        replaces: current.rows[0]
          ? {
              id: current.rows[0].id,
              fileName: current.rows[0].file_name,
              committedAt: current.rows[0].committed_at.toISOString(),
            }
          : null,
        candidates: base.kind === 'gazette' ? (x.payload ?? []) : [],
      };
    });
  }

  /** The uploaded file as sent (View / Download). */
  async file(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ file_name: string | null; source_text: string | null }>(
        `SELECT file_name, source_text FROM board_result_imports WHERE id = $1`,
        [id],
      );
      if (!r.rows[0]?.source_text)
        throw new DomainError('not-found', 'File not found', { status: 404 });
      return {
        fileName: r.rows[0].file_name ?? `board-result-${id}.txt`,
        text: r.rows[0].source_text,
      };
    });
  }

  /** Confirm: the candidates and their subjects saved; an earlier saved file of the same class and year replaced. */
  async commit(ctx: RequestContext, id: string): Promise<BoardImportRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = await c.query<{
        status: string;
        board: string;
        class_label: BoardClass;
        exam_year: number;
        academic_year_id: string | null;
        payload: GazetteRow[];
        layout_key: string | null;
      }>(
        `SELECT status::text, board, class_label, exam_year, academic_year_id::text, payload, layout_key
           FROM board_result_imports WHERE id = $1 AND kind = 'gazette' FOR UPDATE`,
        [id],
      );
      const i = imp.rows[0];
      if (!i) throw new DomainError('not-found', 'Upload not found', { status: 404 });
      if (i.status !== 'validated')
        throw new DomainError(
          'conflict',
          i.status === 'committed'
            ? 'This file is saved already'
            : 'This file did not pass its checks',
          { status: 409 },
        );
      const keys = [i.board, i.class_label, i.exam_year];
      const earlier = await c.query<{ id: string }>(
        `UPDATE board_result_imports SET replaced_at = now(), replaced_by = $4
          WHERE status = 'committed' AND replaced_at IS NULL AND board = $1 AND class_label = $2 AND exam_year = $3 AND id <> $4
          RETURNING id::text`,
        [...keys, id],
      );
      await c.query(
        `DELETE FROM board_results WHERE board = $1 AND class_label = $2 AND exam_year = $3`,
        keys,
      );
      await c.query(
        `DELETE FROM board_candidates WHERE board = $1 AND class_label = $2 AND exam_year = $3`,
        keys,
      );
      const candidates = i.payload.map((r) => {
        const marked = r.subjects.filter((s) => s.marks !== null);
        const total = marked.reduce((a, s) => a + (s.marks ?? 0), 0);
        return {
          roll: r.roll,
          name: r.name,
          sex: r.sex,
          flag: r.flag,
          result: r.result,
          compartment: r.compartment,
          internal: r.internalGrades.filter(Boolean),
          subjects: r.subjects.length,
          total: marked.length ? total : null,
          percent: marked.length ? Math.round((total / marked.length) * 100) / 100 : null,
          student: r.studentId,
          match: r.match,
          line: r.line,
        };
      });
      await c.query(
        `INSERT INTO board_candidates (school_id, import_id, board, class_label, exam_year, academic_year_id, roll_no, name, sex, flag,
                                       result, compartment, internal_grades, subjects, total, percent, student_id, match, line_no)
         SELECT app.current_school_id(), $1, $2, $3, $4, $5, x.roll, x.name, x.sex, x.flag, x.result,
                ARRAY(SELECT jsonb_array_elements_text(x.compartment)), ARRAY(SELECT jsonb_array_elements_text(x.internal)),
                x.subjects, x.total, x.percent, x.student, x.match, x.line
           FROM jsonb_to_recordset($6::jsonb) AS x(roll text, name text, sex text, flag text, result text, compartment jsonb,
                internal jsonb, subjects int, total numeric, percent numeric, student bigint, match text, line int)`,
        [id, i.board, i.class_label, i.exam_year, i.academic_year_id, JSON.stringify(candidates)],
      );
      const subjects = i.payload.flatMap((r) =>
        r.subjects.map((s) => ({
          roll: r.roll,
          slot: s.slot,
          code: s.code,
          marks: s.marks,
          grade: s.grade || null,
          absent: s.absent,
        })),
      );
      await c.query(
        `INSERT INTO board_results (school_id, academic_year_id, exam_year, board, class_label, roll_no, candidate_name, student_id,
                                    subject_code, total, grade, result, import_id, candidate_id, slot, absent)
         SELECT app.current_school_id(), $2, $3, $4, $5, x.roll, bc.name, bc.student_id, x.code, x.marks, x.grade, bc.result, $1,
                bc.id, x.slot, x.absent
           FROM jsonb_to_recordset($6::jsonb) AS x(roll text, slot int, code text, marks numeric, grade text, absent boolean)
           JOIN board_candidates bc ON bc.import_id = $1 AND bc.roll_no = x.roll`,
        [id, i.academic_year_id, i.exam_year, i.board, i.class_label, JSON.stringify(subjects)],
      );
      // a layout learned for this file is kept for the next one of the same layout
      if (i.layout_key?.startsWith('db:')) {
        const lid = i.layout_key.slice(3);
        await c.query(
          `UPDATE board_layouts SET active = false, updated_at = now()
            WHERE active AND id <> $1 AND (board, class_label, fingerprint) = (SELECT board, class_label, fingerprint FROM board_layouts WHERE id = $1)`,
          [lid],
        );
        await c.query(`UPDATE board_layouts SET active = true, updated_at = now() WHERE id = $1`, [
          lid,
        ]);
      }
      await c.query(
        `UPDATE board_result_imports SET status = 'committed', committed_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.gazette_commit',
        entityType: 'board_result_imports',
        entityId: id,
        after: {
          candidates: candidates.length,
          subjects: subjects.length,
          replaced: earlier.rows.map((r) => r.id),
        },
      });
      return (await this.one(c, id))!;
    });
  }

  private async layoutRow(c: PoolClient, key: string | null): Promise<LayoutRow | null> {
    if (!key) return null;
    if (key.startsWith('builtin:')) {
      const b = BUILT_IN_LAYOUTS.find((x) => x.key === key);
      return b
        ? {
            key: b.key,
            name: b.name,
            classLabel: b.classLabel,
            source: 'built-in',
            model: null,
            notes: null,
            active: true,
            learnedFrom: null,
            createdAt: null,
          }
        : null;
    }
    return (await this.layoutRows(c, key.slice(3)))[0] ?? null;
  }

  private async layoutRows(c: PoolClient, id?: string): Promise<LayoutRow[]> {
    const r = await c.query<{
      id: string;
      name: string;
      class_label: BoardClass;
      source: 'claude' | 'edited';
      model: string | null;
      notes: string | null;
      active: boolean;
      learned_from: string | null;
      file_name: string | null;
      created_at: Date;
    }>(
      `SELECT l.id::text, l.name, l.class_label, l.source, l.model, l.notes, l.active, l.learned_from::text, i.file_name, l.created_at
         FROM board_layouts l LEFT JOIN board_result_imports i ON i.id = l.learned_from
        WHERE ($1::bigint IS NULL OR l.id = $1::bigint) AND ($1::bigint IS NOT NULL OR l.active OR l.source = 'edited'
              OR EXISTS (SELECT 1 FROM board_result_imports x WHERE x.id = l.learned_from AND x.status = 'committed'))
        ORDER BY l.class_label, l.created_at DESC`,
      [id ?? null],
    );
    return r.rows.map((l) => ({
      key: `db:${l.id}`,
      name: l.name,
      classLabel: l.class_label,
      source: l.source,
      model: l.model,
      notes: l.notes,
      active: l.active,
      learnedFrom: l.learned_from ? { importId: l.learned_from, fileName: l.file_name } : null,
      createdAt: l.created_at.toISOString(),
    }));
  }

  /** The school's academic years with the year their board examination falls in (the upload form). */
  async academicYears(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; name: string; exam_year: number; current: boolean }>(
        `SELECT id::text, name, EXTRACT(YEAR FROM end_date)::int AS exam_year, id = app.current_academic_year_id() AS current
           FROM academic_years ORDER BY start_date DESC`,
      );
      return r.rows.map((y) => ({
        id: y.id,
        name: y.name,
        examYear: y.exam_year,
        current: y.current,
      }));
    });
  }

  /** Every layout the school can read with: the built-in ones and those learned and kept. */
  async layouts(ctx: RequestContext): Promise<LayoutRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => [
      ...BUILT_IN_LAYOUTS.map((b): LayoutRow => ({
        key: b.key,
        name: b.name,
        classLabel: b.classLabel,
        source: 'built-in',
        model: null,
        notes: null,
        active: true,
        learnedFrom: null,
        createdAt: null,
      })),
      ...(await this.layoutRows(c)),
    ]);
  }

  /** A learned layout switched off (the next file of that layout is learned again) or back on. */
  async setLayoutActive(ctx: RequestContext, id: string, active: boolean): Promise<LayoutRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ board: string; class_label: string; fingerprint: string }>(
        `SELECT board, class_label, fingerprint FROM board_layouts WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const l = r.rows[0];
      if (!l) throw new DomainError('not-found', 'Layout not found', { status: 404 });
      if (active)
        await c.query(
          `UPDATE board_layouts SET active = false, updated_at = now()
            WHERE active AND id <> $1 AND board = $2 AND class_label = $3 AND fingerprint = $4`,
          [id, l.board, l.class_label, l.fingerprint],
        );
      await c.query(`UPDATE board_layouts SET active = $2, updated_at = now() WHERE id = $1`, [
        id,
        active,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'exams.board_result.layout',
        entityType: 'board_layouts',
        entityId: id,
        after: { active },
      });
      return (await this.layoutRows(c, id))[0]!;
    });
  }
}
