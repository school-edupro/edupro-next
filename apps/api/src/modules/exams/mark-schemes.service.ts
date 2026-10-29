import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  computeScheme,
  schemeProblems,
  SCHEME_PRESETS,
  type GradeBand,
  type PoolClient,
  type SchemeCode,
  type SchemeDef,
  type SchemeMark,
  type SchemeStudent,
  type SchemeStudentResult,
  type TenantContext,
} from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { tablePdf } from '../engagement/table-pdf';
import { EXAMS } from './exams.dto';
import type { CreateSchemeDto, RegisterQueryDto, UpdateSchemeDto } from './mark-schemes.dto';

interface Row {
  id: string;
  name: string;
  purpose: 'result' | 'register';
  term_code: string | null;
  class_ids: string[];
  def: SchemeDef;
  preset: string | null;
  status: 'draft' | 'locked' | 'superseded';
  version: number;
  previous_id: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  computed_at: Date | null;
  updated_at: Date;
  results: number;
}
const COLS = `m.id::text, m.name, m.purpose, m.term_code, m.class_ids::text[] AS class_ids, m.def, m.preset, m.status, m.version,
  m.previous_id::text, m.locked_at, u.display_name AS locked_by, m.computed_at, m.updated_at,
  (SELECT count(*)::int FROM term_results t WHERE t.scheme_id = m.id) AS results`;
const FROM = `FROM mark_schemes m LEFT JOIN users u ON u.id = m.locked_by`;

const RESULT_LABEL: Record<string, string> = {
  pass: 'Pass',
  compartment: 'Compartment',
  fail: 'Fail',
  absent: 'Absent',
  incomplete: 'Incomplete',
};
const show = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(Math.round(v * 100) / 100);

/**
 * Mark schemes and registers (docs/design/65, part 3). A scheme is built from a ready-made one (the
 * old DPS Noida formulas, its exams mapped to the year's) or column by column, tried on a section,
 * locked (a version; a new version starts from it) and, for a result scheme, made the class's term
 * result: Compute stores every student's term result (subject columns, total, %, grade, division,
 * result, ranks). A register is any scheme's sheet on screen, in Excel or PDF, by roll or as a merit
 * list.
 */
@Injectable()
export class MarkSchemesService {
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

  presets() {
    return {
      data: SCHEME_PRESETS.map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        examKeys: p.def.examKeys,
        columns: p.def.columns.filter((c) => !c.hidden).map((c) => c.label),
      })),
    };
  }

  private async view(c: PoolClient, r: Row) {
    const exams = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM exams WHERE id = ANY($1::bigint[])`,
      [r.def.exams.map((e) => e.examId)],
    );
    const classes = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM classes WHERE id = ANY($1::bigint[]) ORDER BY display_order, code`,
      [r.class_ids],
    );
    return {
      id: r.id,
      name: r.name,
      purpose: r.purpose,
      termCode: r.term_code,
      classIds: r.class_ids,
      classes: classes.rows,
      def: r.def,
      exams: r.def.exams.map((e) => ({
        key: e.key,
        examId: e.examId,
        code: exams.rows.find((x) => x.id === e.examId)?.code ?? null,
        name: exams.rows.find((x) => x.id === e.examId)?.name ?? null,
      })),
      preset: r.preset,
      status: r.status,
      version: r.version,
      previousId: r.previous_id,
      lockedAt: r.locked_at?.toISOString() ?? null,
      lockedBy: r.locked_by,
      computedAt: r.computed_at?.toISOString() ?? null,
      updatedAt: r.updated_at.toISOString(),
      results: r.results,
      problems: schemeProblems(r.def),
    };
  }

  private async find(c: PoolClient, id: string, lock = false): Promise<Row> {
    if (!/^\d{1,18}$/.test(id)) throw new DomainError('not-found', 'Scheme not found');
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- COLS / FROM are constants; values are bound
      `SELECT ${COLS} ${FROM} WHERE m.id = $1 AND m.deleted_at IS NULL${lock ? ' FOR UPDATE OF m' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Scheme not found');
    return r.rows[0];
  }

  async list(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- COLS / FROM are constants; values are bound
        `SELECT ${COLS} ${FROM} WHERE m.academic_year_id = $1 AND m.deleted_at IS NULL
          ORDER BY (m.status = 'superseded'), m.purpose, m.term_code NULLS LAST, m.name, m.version DESC`,
        [yearId],
      );
      const out = [];
      for (const x of r.rows) out.push(await this.view(c, x));
      return { data: out };
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => this.view(c, await this.find(c, id)));
  }

  /** The exams of the year a definition names, and the classes it covers. */
  private async check(c: PoolClient, yearId: string, def: SchemeDef, classIds: string[]) {
    const ex = await c.query<{ id: string }>(
      `SELECT id::text FROM exams WHERE id = ANY($1::bigint[]) AND academic_year_id = $2 AND deleted_at IS NULL`,
      [def.exams.map((e) => e.examId), yearId],
    );
    const bad = def.exams.find((e) => !ex.rows.some((x) => x.id === e.examId));
    if (bad)
      throw new DomainError('exams.scheme_exam', `${bad.key}: not an exam of the working year`, {
        status: 400,
      });
    const keys = new Set(def.exams.map((e) => e.key));
    if (keys.size !== def.exams.length)
      throw new DomainError('validation-failed', 'An exam key is there twice', { status: 400 });
    const k = await c.query<{ id: string }>(
      `SELECT id::text FROM classes WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [classIds],
    );
    if (k.rows.length !== new Set(classIds).size)
      throw new DomainError('validation-failed', 'A class is not of this school', { status: 400 });
  }

  async create(ctx: RequestContext, dto: CreateSchemeDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    let def: SchemeDef;
    if (dto.preset) {
      const p = SCHEME_PRESETS.find((x) => x.code === dto.preset);
      if (!p) throw new DomainError('not-found', 'No such ready-made scheme', { status: 404 });
      const map = dto.examMap ?? {};
      const missing = p.def.examKeys.filter((k) => !map[k.key]);
      if (missing.length)
        throw new DomainError(
          'validation-failed',
          `Choose the exam for ${missing.map((k) => `${k.key} (${k.label})`).join(', ')}`,
          { status: 400 },
        );
      const { examKeys, ...rest } = p.def;
      def = { ...rest, exams: examKeys.map((k) => ({ key: k.key, examId: map[k.key]! })) };
    } else def = dto.def as SchemeDef;
    return this.db.tenant(tenant, async (c) => {
      await this.check(c, yearId, def, dto.classIds);
      const r = await c.query<{ id: string }>(
        `INSERT INTO mark_schemes (school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::bigint[], $6::jsonb, $7, app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          dto.name,
          dto.purpose,
          dto.termCode ?? null,
          dto.classIds,
          JSON.stringify(def),
          dto.preset ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.create',
        entityType: 'mark_schemes',
        entityId: r.rows[0]!.id,
        after: { name: dto.name, purpose: dto.purpose, preset: dto.preset ?? null },
      });
      return this.view(c, await this.find(c, r.rows[0]!.id));
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateSchemeDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id, true);
      if (cur.status !== 'draft')
        throw new DomainError(
          'exams.scheme_locked',
          'A locked scheme does not change: start a new version from it',
          { status: 409 },
        );
      const def = (dto.def as SchemeDef | undefined) ?? cur.def;
      const classIds = dto.classIds ?? cur.class_ids;
      const term = dto.termCode === undefined ? cur.term_code : dto.termCode;
      if (cur.purpose === 'result' && !term)
        throw new DomainError('validation-failed', 'A result scheme needs its term', {
          status: 400,
        });
      await this.check(c, yearId, def, classIds);
      await c.query(
        `UPDATE mark_schemes SET name = COALESCE($2, name), term_code = $3, class_ids = $4::bigint[], def = $5::jsonb, updated_at = now()
          WHERE id = $1`,
        [id, dto.name ?? null, term, classIds, JSON.stringify(def)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.update',
        entityType: 'mark_schemes',
        entityId: id,
        after: dto,
      });
      return this.view(c, await this.find(c, id));
    });
  }

  /**
   * Locks a draft as a version. A result scheme becomes its classes' result for the term: the version
   * it was started from steps aside (its term results go); another scheme already holding a class for
   * the term is refused.
   */
  async lock(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id, true);
      if (cur.status !== 'draft')
        throw new DomainError('exams.scheme_locked', 'This version is locked already', {
          status: 409,
        });
      const problems = schemeProblems(cur.def);
      if (problems.length)
        throw new DomainError('exams.scheme_problems', problems.join('; '), {
          status: 409,
          extra: { problems },
        });
      if (cur.purpose === 'result') {
        const clash = await c.query<{ id: string; name: string; code: string }>(
          `SELECT m.id::text, m.name, k.code FROM mark_schemes m JOIN classes k ON k.id = ANY(m.class_ids)
            WHERE m.academic_year_id = (SELECT academic_year_id FROM mark_schemes WHERE id = $1)
              AND m.purpose = 'result' AND m.status = 'locked' AND m.deleted_at IS NULL AND m.term_code = $2
              AND m.id <> $1 AND k.id = ANY($3::bigint[]) AND m.id IS DISTINCT FROM $4::bigint
            LIMIT 1`,
          [id, cur.term_code, cur.class_ids, cur.previous_id],
        );
        if (clash.rows[0])
          throw new DomainError(
            'exams.scheme_clash',
            `Class ${clash.rows[0].code} already has "${clash.rows[0].name}" as its ${cur.term_code ?? ''} result scheme: start a new version of that one instead`,
            { status: 409 },
          );
      }
      if (cur.previous_id) {
        await c.query(
          `UPDATE mark_schemes SET status = 'superseded', updated_at = now() WHERE id = $1 AND status = 'locked'`,
          [cur.previous_id],
        );
        await c.query(`DELETE FROM term_results WHERE scheme_id = $1`, [cur.previous_id]);
      }
      await c.query(
        `UPDATE mark_schemes SET status = 'locked', locked_at = now(), locked_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.lock',
        entityType: 'mark_schemes',
        entityId: id,
        after: { version: cur.version, supersedes: cur.previous_id },
      });
      return this.view(c, await this.find(c, id));
    });
  }

  /** A new draft version from a locked (or replaced) one. */
  async newVersion(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id);
      if (cur.status === 'draft')
        throw new DomainError('exams.scheme_draft', 'This version is still a draft: change it', {
          status: 409,
        });
      const open = await c.query(
        `SELECT 1 FROM mark_schemes WHERE previous_id = $1 AND status = 'draft' AND deleted_at IS NULL`,
        [id],
      );
      if (open.rowCount)
        throw new DomainError('exams.scheme_draft', 'A new version of it is already being made', {
          status: 409,
        });
      const r = await c.query<{ id: string }>(
        `INSERT INTO mark_schemes (school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, version, previous_id, created_by)
         SELECT school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, version + 1, id, app.current_user_id()
           FROM mark_schemes WHERE id = $1 RETURNING id::text`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.version',
        entityType: 'mark_schemes',
        entityId: r.rows[0]!.id,
        after: { from: id },
      });
      return this.view(c, await this.find(c, r.rows[0]!.id));
    });
  }

  async remove(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id, true);
      if (cur.status !== 'draft')
        throw new DomainError('exams.scheme_locked', 'Only a draft is removed', { status: 409 });
      await c.query(`UPDATE mark_schemes SET deleted_at = now() WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.remove',
        entityType: 'mark_schemes',
        entityId: id,
      });
      return { removed: true };
    });
  }

  // ---- working it out -----------------------------------------------------------------------------
  /** The students of a class (or some sections) with their marks of the scheme's exams. */
  private async load(
    c: PoolClient,
    yearId: string,
    def: SchemeDef,
    classId: string,
    sectionIds: string[] | null,
  ): Promise<{ students: SchemeStudent[]; scale: GradeBand[]; codes: Record<string, SchemeCode> }> {
    const examIds = def.exams.map((e) => e.examId);
    const keyOf = new Map(def.exams.map((e) => [e.examId, e.key]));
    const es = await c.query<{
      id: string;
      exam_id: string;
      subject_id: string;
      code: string;
      name: string;
      max: string;
    }>(
      `SELECT es.id::text, es.exam_id::text, es.subject_id::text, sub.code, sub.name, es.max_marks::text AS max
         FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
        WHERE es.exam_id = ANY($1::bigint[]) AND es.class_id = $2 AND es.max_marks > 0
        ORDER BY sub.display_order, sub.code`,
      [examIds, classId],
    );
    const esIds = es.rows.map((x) => x.id);
    const parts = await c.query<{ id: string; es: string; name: string; max: string }>(
      `SELECT id::text, exam_subject_id::text AS es, name, max_marks::text AS max FROM exam_subject_parts
        WHERE exam_subject_id = ANY($1::bigint[]) ORDER BY sort_order, id`,
      [esIds],
    );
    const st = await c.query<{
      id: string;
      name: string;
      admission_no: string;
      roll_no: number | null;
      section_id: string;
      section: string;
    }>(
      `SELECT s.id::text, s.display_name AS name, s.admission_no, e.roll_no, cs.id::text AS section_id, k.code || '-' || cs.name AS section
         FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
        WHERE cs.class_id = $1 AND e.academic_year_id = $2 AND e.status = 'active' AND cs.deleted_at IS NULL
          AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))
        ORDER BY cs.name, e.roll_no NULLS LAST, s.display_name`,
      [classId, yearId, sectionIds],
    );
    const ids = st.rows.map((x) => x.id);
    const me = await c.query<{
      es: string;
      student: string;
      marks: string | null;
      code: string | null;
    }>(
      `SELECT exam_subject_id::text AS es, student_id::text AS student, marks::text, code FROM mark_entries
        WHERE exam_subject_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[])`,
      [esIds, ids],
    );
    const pe = await c.query<{
      part: string;
      student: string;
      marks: string | null;
      absent: boolean;
    }>(
      `SELECT part_id::text AS part, student_id::text AS student, marks::text, absent FROM mark_part_entries
        WHERE part_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[])`,
      [parts.rows.map((p) => p.id), ids],
    );
    const choices = await c.query<{ student: string; subject: string; kind: string }>(
      `SELECT student_id::text AS student, subject_id::text AS subject, kind FROM student_subjects
        WHERE academic_year_id = $1 AND student_id = ANY($2::bigint[])`,
      [yearId, ids],
    );
    const att = await c.query<{ student: string; present: number; total: number }>(
      `SELECT student_id::text AS student, sum(days_present)::int AS present, sum(days_total)::int AS total
         FROM exam_attendance WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[]) GROUP BY student_id`,
      [examIds, ids],
    );
    await c.query(`SELECT app.mark_codes_seed(app.current_school_id())`);
    const cr = await c.query<{
      code: string;
      treatment: string;
      value: string | null;
      blocks: boolean;
    }>(
      `SELECT code, treatment, value::text, blocks_result AS blocks FROM mark_codes WHERE status = 'active'`,
    );
    const codes: Record<string, SchemeCode> = Object.fromEntries(
      cr.rows.map((x) => [
        x.code,
        {
          treatment: x.treatment as SchemeCode['treatment'],
          value: x.value === null ? null : Number(x.value),
          blocks: x.blocks,
        },
      ]),
    );
    const scaleId =
      def.gradeScaleId ??
      (
        await c.query<{ id: string | null }>(
          `SELECT grade_scale_id::text AS id FROM exam_classes WHERE exam_id = ANY($1::bigint[]) AND class_id = $2
              AND grade_scale_id IS NOT NULL ORDER BY array_position($1::bigint[], exam_id) LIMIT 1`,
          [examIds, classId],
        )
      ).rows[0]?.id ??
      null;
    const scale: GradeBand[] = scaleId
      ? (
          await c.query<{ grade: string; min: string; max: string }>(
            `SELECT grade, min_pct::text AS min, max_pct::text AS max FROM grade_bands WHERE scale_id = $1 ORDER BY min_pct DESC`,
            [scaleId],
          )
        ).rows.map((b) => ({ grade: b.grade, minPct: Number(b.min), maxPct: Number(b.max) }))
      : [];
    // the class's subjects across the exams, each with its marks per exam key
    const subjects = new Map<string, { code: string; name: string }>();
    for (const x of es.rows) subjects.set(x.subject_id, { code: x.code, name: x.name });
    const markBy = new Map(me.rows.map((x) => [`${x.es}|${x.student}`, x]));
    const partBy = new Map(pe.rows.map((x) => [`${x.part}|${x.student}`, x]));
    const students: SchemeStudent[] = st.rows.map((s) => {
      const mine = choices.rows.filter((x) => x.student === s.id);
      const a = att.rows.find((x) => x.student === s.id);
      return {
        studentId: s.id,
        name: s.name,
        admissionNo: s.admission_no,
        rollNo: s.roll_no,
        sectionId: s.section_id,
        section: s.section,
        attendancePct: a && a.total > 0 ? (a.present / a.total) * 100 : null,
        subjects: [...subjects.entries()]
          .filter(([sid]) => !mine.length || mine.some((x) => x.subject === sid))
          .map(([sid, sub]) => {
            const marks: Record<string, SchemeMark | undefined> = {};
            for (const x of es.rows.filter((e) => e.subject_id === sid)) {
              const m = markBy.get(`${x.id}|${s.id}`);
              marks[keyOf.get(x.exam_id)!] = {
                max: Number(x.max),
                marks: m?.marks === null || m?.marks === undefined ? null : Number(m.marks),
                code: m?.code ?? null,
                entered: Boolean(m),
                parts: Object.fromEntries(
                  parts.rows
                    .filter((p) => p.es === x.id)
                    .map((p) => {
                      const pm = partBy.get(`${p.id}|${s.id}`);
                      return [
                        p.name,
                        {
                          max: Number(p.max),
                          marks:
                            pm?.marks === null || pm?.marks === undefined ? null : Number(pm.marks),
                          absent: pm?.absent ?? false,
                          entered: Boolean(pm),
                        },
                      ];
                    }),
                ),
              };
            }
            const kind = (mine.find((x) => x.subject === sid)?.kind ??
              'compulsory') as SchemeStudent['subjects'][number]['kind'];
            return { subjectId: sid, code: sub.code, name: sub.name, kind, marks };
          }),
      };
    });
    return { students, scale, codes };
  }

  private async work(
    c: PoolClient,
    yearId: string,
    s: Row,
    classId: string,
    sectionIds: string[] | null,
  ): Promise<SchemeStudentResult[]> {
    const { students, scale, codes } = await this.load(c, yearId, s.def, classId, sectionIds);
    return computeScheme(s.def, students, codes, scale);
  }

  /** A result scheme's term results for every student of its classes, stored. */
  async compute(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const s = await this.find(c, id, true);
      if (s.purpose !== 'result' || s.status !== 'locked')
        throw new DomainError(
          'exams.scheme_not_result',
          'Only a locked result scheme makes term results',
          { status: 409 },
        );
      await c.query(`DELETE FROM term_results WHERE scheme_id = $1`, [id]);
      const printed = s.def.columns.filter((x) => !x.hidden).map((x) => x.key);
      const counts: Record<string, number> = {};
      for (const classId of s.class_ids) {
        const rows = await this.work(c, yearId, s, classId, null);
        for (const r of rows) {
          counts[r.result] = (counts[r.result] ?? 0) + 1;
          await c.query(
            `INSERT INTO term_results (school_id, academic_year_id, scheme_id, term_code, student_id, class_id, class_section_id, subjects,
                                       total, max_total, pct, grade, division, result, failed, rank_in_section, rank_in_class)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              yearId,
              id,
              s.term_code,
              r.studentId,
              classId,
              r.sectionId,
              JSON.stringify(
                r.subjects.map((x) => ({
                  ...x,
                  values: Object.fromEntries(printed.map((k) => [k, x.values[k] ?? null])),
                })),
              ),
              r.total,
              r.max,
              r.pct,
              r.grade,
              r.division,
              r.result,
              r.failed,
              r.rankInSection,
              r.rankInClass,
            ],
          );
        }
      }
      await c.query(`UPDATE mark_schemes SET computed_at = now() WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.compute',
        entityType: 'mark_schemes',
        entityId: id,
        after: counts,
      });
      return { ...(await this.view(c, await this.find(c, id))), counts };
    });
  }

  /** Any scheme's sheet for a section or a class: by roll, or as a merit list. */
  async register(ctx: RequestContext, id: string, q: RegisterQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    if (q.classSectionId)
      await this.scopes.assert(tenant, EXAMS.marksView, 'class_section', q.classSectionId);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    const out = await this.db.tenant(tenant, async (c) => {
      const s = await this.find(c, id);
      let classId = q.classId ?? s.class_ids[0]!;
      let sections: string[] | null = null;
      let place = '';
      if (q.classSectionId) {
        const sec = await c.query<{ class_id: string; code: string }>(
          `SELECT cs.class_id::text, k.code || '-' || cs.name AS code FROM class_sections cs JOIN classes k ON k.id = cs.class_id
            WHERE cs.id = $1 AND cs.academic_year_id = $2`,
          [q.classSectionId, yearId],
        );
        if (!sec.rows[0] || !s.class_ids.includes(sec.rows[0].class_id))
          throw new DomainError('validation-failed', 'The section is not of the scheme’s classes', {
            status: 400,
          });
        classId = sec.rows[0].class_id;
        sections = [q.classSectionId];
        place = sec.rows[0].code;
      } else {
        if (!s.class_ids.includes(classId))
          throw new DomainError('validation-failed', 'The class is not in the scheme', {
            status: 400,
          });
        sections = allowed === null ? null : allowed.map(String);
        place =
          (await c.query<{ code: string }>(`SELECT code FROM classes WHERE id = $1`, [classId]))
            .rows[0]?.code ?? '';
      }
      const rows = await this.work(c, yearId, s, classId, sections);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      return { s, rows, place, school };
    });
    const printed = out.s.def.columns.filter((x) => !x.hidden);
    const subjects: Array<{ code: string; name: string }> = [];
    for (const r of out.rows)
      for (const x of r.subjects)
        if (!subjects.some((y) => y.code === x.code)) subjects.push({ code: x.code, name: x.name });
    const rows =
      q.view === 'merit'
        ? out.rows
            .filter((r) => r.rankInClass !== null)
            .sort((a, b) => a.rankInClass! - b.rankInClass! || a.name.localeCompare(b.name))
        : out.rows;
    const counts: Record<string, number> = {};
    for (const r of out.rows) counts[r.result] = (counts[r.result] ?? 0) + 1;
    const title = `${out.s.name}${out.s.term_code ? ` · ${out.s.term_code}` : ''} · ${out.place}`;
    if (q.format === 'json')
      return {
        scheme: {
          id: out.s.id,
          name: out.s.name,
          termCode: out.s.term_code,
          status: out.s.status,
          version: out.s.version,
        },
        place: out.place,
        view: q.view,
        columns: printed.map((x) => ({ key: x.key, label: x.label, total: Boolean(x.total) })),
        subjects,
        rows: rows.map((r) => ({
          ...r,
          subjects: r.subjects.map((x) => ({
            ...x,
            values: Object.fromEntries(printed.map((p) => [p.key, x.values[p.key] ?? null])),
          })),
        })),
        counts,
      };
    // a file: per subject its printed columns and grade, then the overall figures
    const head: Array<{ label: string; group?: string }> = [
      { label: q.view === 'merit' ? 'Rank' : 'Roll' },
      { label: 'Adm no' },
      { label: 'Student' },
    ];
    for (const sub of subjects) {
      for (const p of printed) head.push({ label: p.label, group: sub.name });
      head.push({ label: 'Grade', group: sub.name });
    }
    for (const l of ['Total', 'Max', '%', 'Grade', 'Division', 'Result', 'Rank'])
      head.push({ label: l });
    const cell = (v: { v: number | null; code?: string } | null | undefined) =>
      v ? (v.code && (v.v === null || v.v === 0) ? v.code : show(v.v)) : '';
    const body = rows.map((r) => {
      const line: Array<string | number> = [
        q.view === 'merit' ? (r.rankInClass ?? '') : (r.rollNo ?? ''),
        r.admissionNo,
        r.name,
      ];
      for (const sub of subjects) {
        const x = r.subjects.find((y) => y.code === sub.code);
        for (const p of printed) line.push(x ? cell(x.values[p.key]) : '');
        line.push(x ? (x.grade ?? (x.kind === 'additional' ? 'Addl.' : '')) : '');
      }
      line.push(
        show(r.total),
        show(r.max),
        show(r.pct),
        r.grade ?? '',
        r.division ?? '',
        RESULT_LABEL[r.result] ?? r.result,
        r.rankInClass ?? '',
      );
      return line;
    });
    const stamp = `${out.s.name}-${out.place}`.toLowerCase().replace(/[^\w.-]+/g, '-');
    if (q.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Register');
      ws.addRow([title]).font = { bold: true, size: 13 };
      ws.addRow([`${out.school} · ${q.view === 'merit' ? 'merit list' : 'by roll'}`]);
      const groups = ws.addRow(head.map((h) => h.group ?? ''));
      groups.font = { bold: true };
      ws.addRow(head.map((h) => h.label)).font = { bold: true };
      // each subject's name over its columns
      let col = 4;
      for (let i = 0; i < subjects.length; i += 1) {
        const span = printed.length + 1;
        if (span > 1) ws.mergeCells(groups.number, col, groups.number, col + span - 1);
        col += span;
      }
      for (const line of body) ws.addRow(line);
      ws.getColumn(3).width = 26;
      ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 4 }];
      return {
        filename: `register-${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    }
    const bytes = await tablePdf({
      school: out.school,
      title,
      subtitle: [
        q.view === 'merit' ? 'Merit list' : 'Mark register',
        Object.entries(counts)
          .map(([k, n]) => `${RESULT_LABEL[k] ?? k} ${String(n)}`)
          .join(' · '),
      ],
      columns: head.map((h, i) => ({
        label: h.label,
        width: i === 2 ? 4 : i < 2 ? 1.6 : 1.2,
        right: i > 2,
        ...(h.group ? { group: h.group } : {}),
      })),
      rows: body,
      fontSize: head.length > 40 ? 5.5 : head.length > 24 ? 6.5 : 8,
    });
    return {
      filename: `register-${stamp}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }
}
