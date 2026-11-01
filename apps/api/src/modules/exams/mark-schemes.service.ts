import { Inject, Injectable } from '@nestjs/common';
import {
  buildReport,
  CBSE_8,
  computeRegister,
  REPORTS,
  fromV1,
  isRegisterDef,
  orderStudents,
  registerProblems,
  SCHEME_PRESETS,
  type GradeBand,
  type PoolClient,
  type RegCode,
  type RegisterDef,
  type RegMark,
  type RegStudent,
  type RegStudentResult,
  type SchemeCode,
  type SchemeDef,
  type TenantContext,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { registerPdf, registerXlsx, type RegisterFileMeta } from './mark-register-file';
import { buildSheet, byDivision, type Sheet } from './mark-register-sheet';
import type {
  CopySchemeDto,
  CreateSchemeDto,
  RegisterQueryDto,
  RemoveAccessDto,
  RestoreSchemeDto,
  SchemeAccessDto,
  UpdateSchemeDto,
} from './mark-schemes.dto';

export const REGISTERS = {
  manage: 'exams.registers.manage',
  assign: 'exams.registers.assign',
} as const;

interface Row {
  id: string;
  chain_id: string;
  name: string;
  purpose: 'result' | 'register';
  term_code: string | null;
  class_ids: string[];
  def: SchemeDef | RegisterDef;
  preset: string | null;
  status: 'draft' | 'locked' | 'superseded';
  version: number;
  previous_id: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  computed_at: Date | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  deleted_at: Date | null;
  results: number;
}
const COLS = `m.id::text, m.chain_id::text, m.name, m.purpose, m.term_code, m.class_ids::text[] AS class_ids, m.def, m.preset, m.status, m.version,
  m.previous_id::text, m.locked_at, u.display_name AS locked_by, m.computed_at, m.created_at, cu.display_name AS created_by,
  m.updated_at, uu.display_name AS updated_by, m.deleted_at,
  (SELECT count(*)::int FROM term_results t WHERE t.scheme_id = m.id) AS results`;
const FROM = `FROM mark_schemes m LEFT JOIN users u ON u.id = m.locked_by LEFT JOIN users cu ON cu.id = m.created_by
  LEFT JOIN users uu ON uu.id = m.updated_by`;

export interface Rights {
  manage: boolean;
  run: boolean;
  edit: boolean;
  delete: boolean;
  assign: boolean;
}
const NONE: Rights = { manage: false, run: false, edit: false, delete: false, assign: false };

/** a name as compared for clashes: capitals and spaces do not make a name different */
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const V1_TREAT: Record<string, RegCode['treat']> = {
  zero: 'zero',
  exclude: 'excl',
  fixed: 'fixed',
  percent: 'pctmax',
  pro_rata: 'prorata',
};

/**
 * Mark registers (docs/design/68; the schemes of docs/design/65 part 3): the school's Term Mark Register.
 * A register keeps its saved versions in a chain: a draft changes in place, a locked one is pinned
 * (saving it makes the next version, a draft, and the locked one stays until that is locked), unlock
 * opens it again, delete puts a draft in the bin (restore it, renamed if its name was taken), a version
 * is restored as a new register, and a copy is made for other classes. Managers (exams.registers.manage)
 * see and change every register; anyone else sees the registers given to them, with Run / Edit /
 * Delete / Assign each (a person with Assign passes on only the rights they hold). A result register
 * makes its classes' term results (report cards, promotion); Run lays any register out for a section, a
 * whole class ranked together, an exam (exam-wise) or one subject, on screen, in PDF and in Excel.
 */
@Injectable()
export class MarkSchemesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
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

  // ---- rights ---------------------------------------------------------------------------------------
  private roleRights(ctx: RequestContext): Rights {
    if (ctx.permissions?.has(REGISTERS.manage))
      return { manage: true, run: true, edit: true, delete: true, assign: true };
    if (ctx.permissions?.has(REGISTERS.assign))
      return { manage: false, run: true, edit: false, delete: false, assign: true };
    return NONE;
  }

  /** what the person may do with a register (a chain), by role or as given to them */
  private async rightsOn(c: PoolClient, ctx: RequestContext, chainId: string): Promise<Rights> {
    const role = this.roleRights(ctx);
    if (role.manage) return role;
    const r = await c.query<{ run: boolean; edit: boolean; del: boolean; assign: boolean }>(
      `SELECT can_run AS run, can_edit AS edit, can_delete AS del, can_assign AS assign
         FROM mark_scheme_access WHERE chain_id = $1 AND user_id = $2`,
      [chainId, ctx.user.id],
    );
    const a = r.rows[0];
    return {
      manage: false,
      run: role.run || Boolean(a && (a.run || a.edit || a.del)),
      edit: Boolean(a?.edit),
      delete: Boolean(a?.del),
      assign: role.assign || Boolean(a?.assign),
    };
  }

  private async must(
    c: PoolClient,
    ctx: RequestContext,
    chainId: string,
    what: keyof Rights,
  ): Promise<Rights> {
    const r = await this.rightsOn(c, ctx, chainId);
    if (!r[what])
      throw new DomainError(
        'permission-denied',
        what === 'manage'
          ? 'Only a register manager (exam office, school admin) does this'
          : `You do not have the ${what === 'run' ? 'Run' : what === 'edit' ? 'Edit' : what === 'delete' ? 'Delete' : 'Assign'} right on this register`,
        { status: 403 },
      );
    return r;
  }

  private mustManage(ctx: RequestContext) {
    if (!this.roleRights(ctx).manage)
      throw new DomainError(
        'permission-denied',
        'Only a register manager (exam office, school admin) does this',
        { status: 403 },
      );
  }

  // ---- reading ---------------------------------------------------------------------------------------
  private async find(c: PoolClient, id: string, lock = false, deleted = false): Promise<Row> {
    if (!/^\d{1,18}$/.test(id)) throw new DomainError('not-found', 'Register not found');
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- COLS / FROM are constants; values are bound
      `SELECT ${COLS} ${FROM} WHERE m.id = $1${deleted ? '' : ' AND m.deleted_at IS NULL'}${lock ? ' FOR UPDATE OF m' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Register not found');
    return r.rows[0];
  }

  /** the school's mark codes as a register's (for each new exam) and as v1 codes */
  private async schoolCodes(c: PoolClient) {
    await c.query(`SELECT app.mark_codes_seed(app.current_school_id())`);
    const r = await c.query<{
      code: string;
      name: string;
      treatment: string;
      value: string | null;
      blocks: boolean;
    }>(
      `SELECT code, name, treatment, value::text, blocks_result AS blocks FROM mark_codes WHERE status = 'active' ORDER BY sort_order, code`,
    );
    const reg: RegCode[] = r.rows.map((x) => ({
      code: x.code,
      meaning: x.name,
      treat: V1_TREAT[x.treatment] ?? 'excl',
      amt: x.value === null ? null : Number(x.value),
      blocks: x.blocks,
      showValue: false,
      prPct: 100,
    }));
    const v1: Record<string, SchemeCode> = Object.fromEntries(
      r.rows.map((x) => [
        x.code,
        {
          treatment: x.treatment as SchemeCode['treatment'],
          value: x.value === null ? null : Number(x.value),
          blocks: x.blocks,
        },
      ]),
    );
    return { reg, v1 };
  }

  /** a grade scale's bands (the one given, or the first class's on the exams) */
  private async bands(
    c: PoolClient,
    scaleId: string | null | undefined,
    examIds: string[],
    classId: string | undefined,
  ): Promise<GradeBand[]> {
    const id =
      scaleId ??
      (classId
        ? (
            await c.query<{ id: string | null }>(
              `SELECT grade_scale_id::text AS id FROM exam_classes WHERE exam_id = ANY($1::bigint[]) AND class_id = $2
                  AND grade_scale_id IS NOT NULL ORDER BY array_position($1::bigint[], exam_id) LIMIT 1`,
              [examIds, classId],
            )
          ).rows[0]?.id
        : null) ??
      null;
    if (!id) return [];
    return (
      await c.query<{ grade: string; min: string; max: string }>(
        `SELECT grade, min_pct::text AS min, max_pct::text AS max FROM grade_bands WHERE scale_id = $1 ORDER BY min_pct DESC`,
        [id],
      )
    ).rows.map((b) => ({ grade: b.grade, minPct: Number(b.min), maxPct: Number(b.max) }));
  }

  /** the subjects the classes have in the exams, in the first class's order */
  private async subjectsOf(c: PoolClient, yearId: string, examIds: string[], classIds: string[]) {
    const r = await c.query<{ id: string }>(
      `SELECT es.subject_id::text AS id, min(app.subject_seq($3::bigint, $4::bigint, es.subject_id)) AS seq, min(sub.code) AS code
         FROM exam_subjects es JOIN subjects sub ON sub.id = es.subject_id
        WHERE es.exam_id = ANY($1::bigint[]) AND es.class_id = ANY($2::bigint[]) AND es.max_marks > 0
        GROUP BY es.subject_id ORDER BY 2, 3`,
      [examIds, classIds, classIds[0], yearId],
    );
    return r.rows.map((x) => x.id);
  }

  /** a definition as a register: a v1 scheme becomes every subject's columns */
  private async asRegister(
    c: PoolClient,
    yearId: string,
    def: SchemeDef | RegisterDef,
    classIds: string[],
  ): Promise<RegisterDef> {
    if (isRegisterDef(def)) return def;
    const examIds = def.exams.map((e) => e.examId);
    const codes = await this.schoolCodes(c);
    const scale = await this.bands(c, def.gradeScaleId, examIds, classIds[0]);
    const reg = fromV1(def, await this.subjectsOf(c, yearId, examIds, classIds), codes.v1, scale);
    if (!scale.length) reg.grades = registerGradesDefault();
    return reg;
  }

  private async view(c: PoolClient, r: Row, ctx: RequestContext, yearId: string) {
    const def = await this.asRegister(c, yearId, r.def, r.class_ids);
    const exams = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM exams WHERE id = ANY($1::bigint[])`,
      [def.exams.map((e) => e.examId)],
    );
    const classes = await c.query<{ id: string; code: string; name: string }>(
      `SELECT id::text, code, name FROM classes WHERE id = ANY($1::bigint[]) ORDER BY display_order, code`,
      [r.class_ids],
    );
    return {
      id: r.id,
      chainId: r.chain_id,
      name: r.name,
      purpose: r.purpose,
      termCode: r.term_code,
      classIds: r.class_ids,
      classes: classes.rows,
      def,
      exams: def.exams.map((e) => ({
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
      createdAt: r.created_at.toISOString(),
      createdBy: r.created_by,
      updatedAt: r.updated_at.toISOString(),
      updatedBy: r.updated_by,
      results: r.results,
      problems: registerProblems(def),
      rights: await this.rightsOn(c, ctx, r.chain_id),
    };
  }

  /**
   * The registers the person may see, one row per register: its newest version that is not replaced
   * or in the bin (a draft being made from a locked one shows the locked version it will replace).
   */
  async list(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const role = this.roleRights(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Row & { in_use: number | null; subjects: number }>(
        // eslint-disable-next-line no-restricted-syntax -- COLS / FROM are constants; values are bound
        `SELECT DISTINCT ON (m.chain_id) ${COLS},
                (SELECT max(o.version) FROM mark_schemes o WHERE o.chain_id = m.chain_id AND o.id <> m.id AND o.status = 'locked' AND o.deleted_at IS NULL) AS in_use
           ${FROM}
          WHERE m.academic_year_id = $1 AND m.deleted_at IS NULL AND m.status <> 'superseded'
            AND ($2::boolean OR EXISTS (SELECT 1 FROM mark_scheme_access a WHERE a.chain_id = m.chain_id AND a.user_id = $3))
          ORDER BY m.chain_id, m.version DESC`,
        [yearId, role.run, ctx.user.id],
      );
      const access = await c.query<{
        chain_id: string;
        name: string;
        run: boolean;
        edit: boolean;
        del: boolean;
        assign: boolean;
      }>(
        `SELECT a.chain_id::text, COALESCE(u.display_name, u.email) AS name, a.can_run AS run, a.can_edit AS edit, a.can_delete AS del, a.can_assign AS assign
           FROM mark_scheme_access a JOIN users u ON u.id = a.user_id
          WHERE a.chain_id = ANY($1::bigint[]) ORDER BY 2`,
        [r.rows.map((x) => x.chain_id)],
      );
      const names = new Map<string, number>();
      for (const x of r.rows) names.set(norm(x.name), (names.get(norm(x.name)) ?? 0) + 1);
      const out = [];
      for (const x of r.rows.sort((a, b) => a.name.localeCompare(b.name))) {
        const v = await this.view(c, x, ctx, yearId);
        out.push({
          ...v,
          def: undefined,
          subjects: v.def.subjects.length,
          layout: v.def.layout,
          type: v.def.type,
          inUse: x.in_use,
          sameName: (names.get(norm(x.name)) ?? 0) > 1,
          assignees: access.rows
            .filter((a) => a.chain_id === x.chain_id)
            .map((a) => ({
              name: a.name,
              rights: [a.run && 'Run', a.edit && 'Edit', a.del && 'Delete', a.assign && 'Assign']
                .filter(Boolean)
                .join('+'),
            })),
        });
      }
      return { data: out, canCreate: role.manage, canAssign: role.assign };
    });
  }

  async get(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await this.find(c, id);
      await this.must(c, ctx, r.chain_id, 'run');
      return this.view(c, r, ctx, yearId);
    });
  }

  /** The exams of the year a definition names, and the classes it covers. */
  private async check(c: PoolClient, yearId: string, def: RegisterDef, classIds: string[]) {
    const ex = await c.query<{ id: string }>(
      `SELECT id::text FROM exams WHERE id = ANY($1::bigint[]) AND academic_year_id = $2 AND deleted_at IS NULL`,
      [def.exams.map((e) => e.examId), yearId],
    );
    const bad = def.exams.find((e) => !ex.rows.some((x) => x.id === e.examId));
    if (bad)
      throw new DomainError('exams.scheme_exam', `${bad.key}: not an exam of the working year`, {
        status: 400,
      });
    if (new Set(def.exams.map((e) => e.key)).size !== def.exams.length)
      throw new DomainError('validation-failed', 'An exam key is there twice', { status: 400 });
    const k = await c.query<{ id: string }>(
      `SELECT id::text FROM classes WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [classIds],
    );
    if (k.rows.length !== new Set(classIds).size)
      throw new DomainError('validation-failed', 'A class is not of this school', { status: 400 });
  }

  /** register names are unique in the year (capitals and extra spaces do not count); versions share one */
  private async nameFree(c: PoolClient, yearId: string, name: string, chainId: string | null) {
    const r = await c.query<{ name: string }>(
      `SELECT name FROM mark_schemes
        WHERE academic_year_id = $1 AND deleted_at IS NULL AND status <> 'superseded'
          AND lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $2 AND ($3::bigint IS NULL OR chain_id <> $3::bigint)
        LIMIT 1`,
      [yearId, norm(name), chainId],
    );
    if (r.rows[0])
      throw new DomainError(
        'exams.register_name',
        `A register is already called "${r.rows[0].name}": give this one another name`,
        { status: 409 },
      );
  }

  /** the classes' choice groups of one subject each (a language) as slots of a new register */
  private async slotsFor(c: PoolClient, yearId: string, classIds: string[]) {
    const r = await c.query<{ name: string; members: string[] }>(
      `SELECT g.name, array_agg(DISTINCT cs.subject_id::text) AS members
         FROM subject_groups g JOIN class_subjects cs ON cs.group_id = g.id AND cs.status = 'active'
        WHERE g.class_id = ANY($1::bigint[]) AND g.academic_year_id = $2 AND g.pick_max = 1
        GROUP BY g.name HAVING count(DISTINCT cs.subject_id) >= 2`,
      [classIds, yearId],
    );
    return r.rows;
  }

  /** a ready-made scheme (DPS Noida) as a register: its columns under every subject, languages in a slot */
  private async fromPreset(
    c: PoolClient,
    yearId: string,
    dto: CreateSchemeDto,
  ): Promise<RegisterDef> {
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
    const v1: SchemeDef = {
      ...rest,
      exams: examKeys.map((k) => ({ key: k.key, examId: map[k.key]! })),
    };
    const reg = await this.asRegister(c, yearId, v1, dto.classIds);
    const slots = await this.slotsFor(c, yearId, dto.classIds);
    for (const s of slots) {
      const at = reg.subjects.findIndex((x) => x.subjectId && s.members.includes(x.subjectId));
      if (at < 0) continue;
      const model = reg.subjects[at]!;
      reg.subjects = reg.subjects.filter((x) => !x.subjectId || !s.members.includes(x.subjectId));
      reg.subjects.splice(at, 0, {
        ...model,
        key: `slot-${String(at)}`,
        subjectId: undefined,
        slot: { name: s.name.toUpperCase(), members: s.members },
      });
    }
    return reg;
  }

  async create(ctx: RequestContext, dto: CreateSchemeDto) {
    this.mustManage(ctx);
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const def = dto.preset
        ? await this.fromPreset(c, yearId, dto)
        : await this.asRegister(c, yearId, dto.def as SchemeDef | RegisterDef, dto.classIds);
      await this.check(c, yearId, def, dto.classIds);
      await this.nameFree(c, yearId, dto.name, null);
      const r = await c.query<{ id: string }>(
        `INSERT INTO mark_schemes (school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::bigint[], $6::jsonb, $7, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          dto.name.trim(),
          dto.purpose,
          dto.purpose === 'result' ? (dto.termCode ?? null) : null,
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
      return this.view(c, await this.find(c, r.rows[0]!.id), ctx, yearId);
    });
  }

  /**
   * Saves a register. A draft changes in place; a locked one is never overwritten: the change becomes
   * the next version (a draft; the draft already being made from it, if there is one).
   */
  async update(ctx: RequestContext, id: string, dto: UpdateSchemeDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      let cur = await this.find(c, id, true);
      await this.must(c, ctx, cur.chain_id, 'edit');
      if (cur.status === 'superseded')
        throw new DomainError(
          'exams.scheme_locked',
          'A later version replaced this one: open that',
          {
            status: 409,
          },
        );
      if (cur.status === 'locked') {
        const open = await c.query<{ id: string }>(
          `SELECT id::text FROM mark_schemes WHERE chain_id = $1 AND status = 'draft' AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`,
          [cur.chain_id],
        );
        const next =
          open.rows[0]?.id ??
          (
            await c.query<{ id: string }>(
              `INSERT INTO mark_schemes (school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, version, previous_id, chain_id, created_by, updated_by)
               SELECT school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset,
                      (SELECT max(version) + 1 FROM mark_schemes WHERE chain_id = m.chain_id), id, chain_id, app.current_user_id(), app.current_user_id()
                 FROM mark_schemes m WHERE id = $1 RETURNING id::text`,
              [cur.id],
            )
          ).rows[0]!.id;
        cur = await this.find(c, next, true);
      }
      const def = dto.def
        ? await this.asRegister(
            c,
            yearId,
            dto.def as SchemeDef | RegisterDef,
            dto.classIds ?? cur.class_ids,
          )
        : await this.asRegister(c, yearId, cur.def, cur.class_ids);
      const classIds = dto.classIds ?? cur.class_ids;
      const purpose = dto.purpose ?? cur.purpose;
      const term =
        purpose === 'register' ? null : dto.termCode === undefined ? cur.term_code : dto.termCode;
      if (purpose === 'result' && !term)
        throw new DomainError('validation-failed', 'A result register needs its term (T1, T2 …)', {
          status: 400,
        });
      const name = dto.name?.trim() ?? cur.name;
      await this.check(c, yearId, def, classIds);
      await this.nameFree(c, yearId, name, cur.chain_id);
      await c.query(
        `UPDATE mark_schemes SET name = $2, purpose = $3, term_code = $4, class_ids = $5::bigint[], def = $6::jsonb,
                updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [cur.id, name, purpose, term, classIds, JSON.stringify(def)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.update',
        entityType: 'mark_schemes',
        entityId: cur.id,
        after: { name, classIds, purpose, term, version: cur.version },
      });
      return this.view(c, await this.find(c, cur.id), ctx, yearId);
    });
  }

  /**
   * Locks a draft as a version (managers). A result register becomes its classes' result for the term:
   * the version it was made from steps aside (its term results go); another register already holding a
   * class for the term is refused.
   */
  async lock(ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id, true);
      if (cur.status !== 'draft')
        throw new DomainError('exams.scheme_locked', 'This version is locked already', {
          status: 409,
        });
      const def = await this.asRegister(c, yearId, cur.def, cur.class_ids);
      const problems = registerProblems(def);
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
              AND m.chain_id <> $3 AND k.id = ANY($4::bigint[])
            LIMIT 1`,
          [id, cur.term_code, cur.chain_id, cur.class_ids],
        );
        if (clash.rows[0])
          throw new DomainError(
            'exams.scheme_clash',
            `Class ${clash.rows[0].code} already has "${clash.rows[0].name}" as its ${cur.term_code ?? ''} result register: change that one instead`,
            { status: 409 },
          );
      }
      // the chain's earlier locked version steps aside
      const older = await c.query<{ id: string }>(
        `UPDATE mark_schemes SET status = 'superseded', updated_at = now() WHERE chain_id = $1 AND id <> $2 AND status = 'locked' RETURNING id::text`,
        [cur.chain_id, id],
      );
      if (older.rows.length)
        await c.query(`DELETE FROM term_results WHERE scheme_id = ANY($1::bigint[])`, [
          older.rows.map((x) => x.id),
        ]);
      await c.query(
        `UPDATE mark_schemes SET status = 'locked', def = $2::jsonb, locked_at = now(), locked_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(def)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.lock',
        entityType: 'mark_schemes',
        entityId: id,
        after: { version: cur.version, supersedes: older.rows.map((x) => x.id) },
      });
      return this.view(c, await this.find(c, id), ctx, yearId);
    });
  }

  /**
   * Unlocks a locked register so it changes in place again (managers). Its term results stay but are
   * not printed on report cards until it is locked and worked out again.
   */
  async unlock(ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id, true);
      if (cur.status !== 'locked')
        throw new DomainError('exams.scheme_draft', 'This register is not locked', { status: 409 });
      const open = await c.query(
        `SELECT 1 FROM mark_schemes WHERE chain_id = $1 AND status = 'draft' AND deleted_at IS NULL`,
        [cur.chain_id],
      );
      if (open.rowCount)
        throw new DomainError(
          'exams.scheme_draft',
          'A new version of it is being made: change that one, or delete it first',
          { status: 409 },
        );
      await c.query(
        `UPDATE mark_schemes SET status = 'draft', locked_at = NULL, locked_by = NULL, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.unlock',
        entityType: 'mark_schemes',
        entityId: id,
        after: { version: cur.version },
      });
      return this.view(c, await this.find(c, id), ctx, yearId);
    });
  }

  /** A new draft version from a locked one. */
  async newVersion(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id);
      await this.must(c, ctx, cur.chain_id, 'edit');
      if (cur.status === 'draft')
        throw new DomainError('exams.scheme_draft', 'This version is still a draft: change it', {
          status: 409,
        });
      const open = await c.query(
        `SELECT 1 FROM mark_schemes WHERE chain_id = $1 AND status = 'draft' AND deleted_at IS NULL`,
        [cur.chain_id],
      );
      if (open.rowCount)
        throw new DomainError('exams.scheme_draft', 'A new version of it is already being made', {
          status: 409,
        });
      const r = await c.query<{ id: string }>(
        `INSERT INTO mark_schemes (school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, version, previous_id, chain_id, created_by, updated_by)
         SELECT school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset,
                (SELECT max(version) + 1 FROM mark_schemes WHERE chain_id = m.chain_id), id, chain_id, app.current_user_id(), app.current_user_id()
           FROM mark_schemes m WHERE id = $1 RETURNING id::text`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.version',
        entityType: 'mark_schemes',
        entityId: r.rows[0]!.id,
        after: { from: id },
      });
      return this.view(c, await this.find(c, r.rows[0]!.id), ctx, yearId);
    });
  }

  /** Puts a draft in the bin (a locked register is unlocked first; its locked version stays). */
  async remove(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id, true);
      await this.must(c, ctx, cur.chain_id, 'delete');
      if (cur.status !== 'draft')
        throw new DomainError(
          'exams.scheme_locked',
          'A locked register is not deleted: unlock it first',
          { status: 409 },
        );
      await c.query(
        `UPDATE mark_schemes SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.remove',
        entityType: 'mark_schemes',
        entityId: id,
      });
      return { removed: true };
    });
  }

  /** The bin: registers of the year with no version left in use, each by its newest deleted version. */
  async deleted(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const role = this.roleRights(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        chain_id: string;
        name: string;
        version: number;
        deleted_at: Date;
        deleted_by: string | null;
        classes: string[];
      }>(
        `SELECT DISTINCT ON (m.chain_id) m.id::text, m.chain_id::text, m.name, m.version, m.deleted_at, u.display_name AS deleted_by,
                ARRAY(SELECT k.code FROM classes k WHERE k.id = ANY(m.class_ids) ORDER BY k.display_order) AS classes
           FROM mark_schemes m LEFT JOIN users u ON u.id = m.deleted_by
          WHERE m.academic_year_id = $1 AND m.deleted_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM mark_schemes o WHERE o.chain_id = m.chain_id AND o.deleted_at IS NULL AND o.status <> 'superseded')
            AND ($2::boolean OR EXISTS (SELECT 1 FROM mark_scheme_access a WHERE a.chain_id = m.chain_id AND a.user_id = $3 AND a.can_delete))
          ORDER BY m.chain_id, m.version DESC`,
        [yearId, role.manage, ctx.user.id],
      );
      return {
        data: r.rows.map((x) => ({
          id: x.id,
          chainId: x.chain_id,
          name: x.name,
          version: x.version,
          classes: x.classes,
          deletedAt: x.deleted_at.toISOString(),
          deletedBy: x.deleted_by,
        })),
      };
    });
  }

  /** Back from the bin (a new name when its old one is taken now). */
  async restore(ctx: RequestContext, id: string, dto: RestoreSchemeDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id, true, true);
      await this.must(c, ctx, cur.chain_id, 'delete');
      if (!cur.deleted_at)
        throw new DomainError('exams.scheme_live', 'This register is not in the bin', {
          status: 409,
        });
      const name = dto.name?.trim() ?? cur.name;
      await this.nameFree(c, yearId, name, cur.chain_id);
      await c.query(
        `UPDATE mark_schemes SET deleted_at = NULL, deleted_by = NULL, name = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, name],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.restore',
        entityType: 'mark_schemes',
        entityId: id,
        after: { name },
      });
      return this.view(c, await this.find(c, id), ctx, yearId);
    });
  }

  /** Every saved version of a register, newest first. */
  async versions(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const cur = await this.find(c, id, false, true);
      await this.must(c, ctx, cur.chain_id, 'edit');
      const r = await c.query<{
        id: string;
        version: number;
        status: string;
        deleted: boolean;
        updated_at: Date;
        updated_by: string | null;
        locked_by: string | null;
        results: number;
      }>(
        `SELECT m.id::text, m.version, m.status, m.deleted_at IS NOT NULL AS deleted, m.updated_at, uu.display_name AS updated_by,
                u.display_name AS locked_by, (SELECT count(*)::int FROM term_results t WHERE t.scheme_id = m.id) AS results
           FROM mark_schemes m LEFT JOIN users uu ON uu.id = m.updated_by LEFT JOIN users u ON u.id = m.locked_by
          WHERE m.chain_id = $1 ORDER BY m.version DESC`,
        [cur.chain_id],
      );
      return {
        name: cur.name,
        data: r.rows.map((x) => ({
          id: x.id,
          version: x.version,
          status: x.deleted ? 'deleted' : x.status,
          updatedAt: x.updated_at.toISOString(),
          updatedBy: x.updated_by,
          lockedBy: x.locked_by,
          results: x.results,
        })),
      };
    });
  }

  /** A saved version as a new register (version 1, unlocked) with that register's people. */
  async restoreVersion(ctx: RequestContext, id: string, dto: RestoreSchemeDto) {
    this.mustManage(ctx);
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const src = await this.find(c, id, false, true);
      const name = dto.name?.trim() ?? `${src.name} (v${String(src.version)})`;
      await this.nameFree(c, yearId, name, null);
      const def = await this.asRegister(c, yearId, src.def, src.class_ids);
      const r = await c.query<{ id: string; chain_id: string }>(
        `INSERT INTO mark_schemes (school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, 'register', NULL, $3::bigint[], $4::jsonb, $5, app.current_user_id(), app.current_user_id())
         RETURNING id::text, chain_id::text`,
        [yearId, name, src.class_ids, JSON.stringify(def), src.preset],
      );
      await c.query(
        `INSERT INTO mark_scheme_access (school_id, chain_id, user_id, can_run, can_edit, can_delete, can_assign, granted_by)
         SELECT school_id, $2, user_id, can_run, can_edit, can_delete, can_assign, app.current_user_id()
           FROM mark_scheme_access WHERE chain_id = $1`,
        [src.chain_id, r.rows[0]!.chain_id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.restore_version',
        entityType: 'mark_schemes',
        entityId: r.rows[0]!.id,
        after: { from: id, version: src.version, name },
      });
      return this.view(c, await this.find(c, r.rows[0]!.id), ctx, yearId);
    });
  }

  /**
   * A copy for other classes, saved at once: a subject the new classes do not have is left out (a slot
   * keeps the members they have); the maxima are read from each class's exams when it runs.
   */
  async copy(ctx: RequestContext, id: string, dto: CopySchemeDto) {
    this.mustManage(ctx);
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const src = await this.find(c, id);
      const def = structuredClone(await this.asRegister(c, yearId, src.def, src.class_ids));
      const offered = new Set(
        (
          await c.query<{ id: string }>(
            `SELECT DISTINCT subject_id::text AS id FROM class_subjects WHERE class_id = ANY($1::bigint[]) AND academic_year_id = $2 AND status = 'active'
             UNION SELECT DISTINCT subject_id::text FROM exam_subjects WHERE class_id = ANY($1::bigint[]) AND exam_id = ANY($3::bigint[])`,
            [dto.classIds, yearId, def.exams.map((e) => e.examId)],
          )
        ).rows.map((x) => x.id),
      );
      const names = new Map(
        (
          await c.query<{ id: string; name: string }>(
            `SELECT id::text, name FROM subjects WHERE id = ANY($1::bigint[])`,
            [def.subjects.flatMap((s) => (s.slot ? s.slot.members : [s.subjectId!]))],
          )
        ).rows.map((x) => [x.id, x.name]),
      );
      const dropped: string[] = [];
      def.subjects = def.subjects.flatMap((s) => {
        if (s.slot) {
          const members = s.slot.members.filter((m) => offered.has(m));
          for (const m of s.slot.members.filter((x) => !offered.has(x)))
            dropped.push(`${names.get(m) ?? m} (from ${s.slot.name})`);
          if (members.length >= 2) return [{ ...s, slot: { ...s.slot, members } }];
          if (members.length === 1) return [{ ...s, slot: undefined, subjectId: members[0] }];
          return [];
        }
        if (offered.has(s.subjectId!)) return [s];
        dropped.push(names.get(s.subjectId!) ?? s.subjectId!);
        return [];
      });
      await this.check(c, yearId, def, dto.classIds);
      await this.nameFree(c, yearId, dto.name, null);
      const r = await c.query<{ id: string }>(
        `INSERT INTO mark_schemes (school_id, academic_year_id, name, purpose, term_code, class_ids, def, preset, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, 'register', NULL, $3::bigint[], $4::jsonb, $5, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [yearId, dto.name.trim(), dto.classIds, JSON.stringify(def), src.preset],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.copy',
        entityType: 'mark_schemes',
        entityId: r.rows[0]!.id,
        after: { from: id, classIds: dto.classIds, dropped },
      });
      return { ...(await this.view(c, await this.find(c, r.rows[0]!.id), ctx, yearId)), dropped };
    });
  }

  // ---- people and their rights -------------------------------------------------------------------
  /** Staff who can sign in, for the Assign dialog. */
  async staff(ctx: RequestContext) {
    if (!this.roleRights(ctx).assign && !ctx.permissions?.has('exams.marks.view'))
      throw new DomainError('permission-denied', 'You cannot give rights on registers', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        user_id: string;
        name: string;
        designation: string | null;
        department: string | null;
      }>(
        `SELECT e.user_id::text, COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)) AS name, e.designation, e.department
           FROM employees e WHERE e.user_id IS NOT NULL AND e.deleted_at IS NULL AND e.status = 'active'
          ORDER BY 2 LIMIT 1000`,
      );
      return {
        data: r.rows.map((x) => ({
          userId: x.user_id,
          name: x.name,
          designation: x.designation,
          department: x.department,
        })),
      };
    });
  }

  async access(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id);
      const mine = await this.must(c, ctx, cur.chain_id, 'assign');
      const r = await c.query<{
        user_id: string;
        name: string;
        designation: string | null;
        run: boolean;
        edit: boolean;
        del: boolean;
        assign: boolean;
      }>(
        `SELECT a.user_id::text, COALESCE(e.display_name, u.display_name, u.email) AS name, e.designation,
                a.can_run AS run, a.can_edit AS edit, a.can_delete AS del, a.can_assign AS assign
           FROM mark_scheme_access a JOIN users u ON u.id = a.user_id
           LEFT JOIN employees e ON e.user_id = a.user_id AND e.deleted_at IS NULL
          WHERE a.chain_id = $1 ORDER BY 2`,
        [cur.chain_id],
      );
      return {
        name: cur.name,
        mine,
        data: r.rows.map((x) => ({
          userId: x.user_id,
          name: x.name,
          designation: x.designation,
          run: x.run,
          edit: x.edit,
          delete: x.del,
          assign: x.assign,
        })),
      };
    });
  }

  /**
   * Gives people rights on a register (the whole list). A manager gives anything; a person given Assign
   * on it passes on only the rights they hold, never Assign, and leaves alone anyone else holding Assign.
   */
  async putAccess(ctx: RequestContext, id: string, dto: SchemeAccessDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id);
      const mine = await this.must(c, ctx, cur.chain_id, 'assign');
      const role = this.roleRights(ctx);
      const before = await c.query<{
        user_id: string;
        run: boolean;
        edit: boolean;
        del: boolean;
        assign: boolean;
      }>(
        `SELECT user_id::text, can_run AS run, can_edit AS edit, can_delete AS del, can_assign AS assign FROM mark_scheme_access WHERE chain_id = $1`,
        [cur.chain_id],
      );
      const want = new Map(dto.rows.map((x) => [x.userId, x]));
      const full = role.manage || role.assign;
      if (!full) {
        for (const b of before.rows) {
          const w = want.get(b.user_id);
          const same =
            w &&
            w.run === b.run &&
            w.edit === b.edit &&
            w.delete === b.del &&
            w.assign === b.assign;
          if ((b.assign || b.user_id === ctx.user.id) && !same)
            throw new DomainError(
              'permission-denied',
              'Only a manager changes the rights of someone who holds Assign (or your own)',
              { status: 403 },
            );
        }
        for (const w of dto.rows) {
          const b = before.rows.find((x) => x.user_id === w.userId);
          if (b?.assign || w.userId === ctx.user.id) continue;
          if (w.assign || (w.edit && !mine.edit) || (w.delete && !mine.delete))
            throw new DomainError(
              'permission-denied',
              'You can pass on only the rights you hold yourself, and not Assign',
              { status: 403 },
            );
        }
      }
      const users = await c.query<{ id: string }>(
        `SELECT id::text FROM users WHERE id = ANY($1::bigint[])`,
        [dto.rows.map((x) => x.userId)],
      );
      if (users.rows.length !== dto.rows.length)
        throw new DomainError('validation-failed', 'Someone in the list cannot sign in', {
          status: 400,
        });
      await c.query(
        `DELETE FROM mark_scheme_access WHERE chain_id = $1 AND NOT (user_id = ANY($2::bigint[]))`,
        [
          cur.chain_id,
          dto.rows.filter((x) => x.run || x.edit || x.delete || x.assign).map((x) => x.userId),
        ],
      );
      for (const w of dto.rows) {
        if (!(w.run || w.edit || w.delete || w.assign)) continue;
        await c.query(
          `INSERT INTO mark_scheme_access (school_id, chain_id, user_id, can_run, can_edit, can_delete, can_assign, granted_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())
           ON CONFLICT (chain_id, user_id) DO UPDATE SET can_run = EXCLUDED.can_run, can_edit = EXCLUDED.can_edit,
             can_delete = EXCLUDED.can_delete, can_assign = EXCLUDED.can_assign, granted_by = EXCLUDED.granted_by, updated_at = now()`,
          [cur.chain_id, w.userId, w.run || w.edit || w.delete, w.edit, w.delete, w.assign],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.access',
        entityType: 'mark_schemes',
        entityId: cur.chain_id,
        after: { people: dto.rows.length },
      });
      return this.access(ctx, id);
    });
  }

  /** Who holds which right on which register (managers and those who assign on every register). */
  async rightsReport(ctx: RequestContext) {
    if (!this.roleRights(ctx).assign)
      throw new DomainError('permission-denied', 'Only a register manager sees every right', {
        status: 403,
      });
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        chain_id: string;
        register: string;
        user_id: string;
        name: string;
        designation: string | null;
        run: boolean;
        edit: boolean;
        del: boolean;
        assign: boolean;
      }>(
        `SELECT a.chain_id::text, (SELECT m.name FROM mark_schemes m WHERE m.chain_id = a.chain_id ORDER BY m.version DESC LIMIT 1) AS register,
                a.user_id::text, COALESCE(e.display_name, u.display_name, u.email) AS name, e.designation,
                a.can_run AS run, a.can_edit AS edit, a.can_delete AS del, a.can_assign AS assign
           FROM mark_scheme_access a JOIN users u ON u.id = a.user_id
           LEFT JOIN employees e ON e.user_id = a.user_id AND e.deleted_at IS NULL
          WHERE EXISTS (SELECT 1 FROM mark_schemes m WHERE m.chain_id = a.chain_id AND m.academic_year_id = $1)
          ORDER BY 2, 4`,
        [yearId],
      );
      return {
        data: r.rows.map((x) => ({
          chainId: x.chain_id,
          register: x.register,
          userId: x.user_id,
          name: x.name,
          designation: x.designation,
          run: x.run,
          edit: x.edit,
          delete: x.del,
          assign: x.assign,
        })),
      };
    });
  }

  async removeAccess(ctx: RequestContext, dto: RemoveAccessDto) {
    if (!this.roleRights(ctx).assign)
      throw new DomainError('permission-denied', 'Only a register manager removes rights here', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let n = 0;
      for (const p of dto.pairs)
        n +=
          (
            await c.query(`DELETE FROM mark_scheme_access WHERE chain_id = $1 AND user_id = $2`, [
              p.chainId,
              p.userId,
            ])
          ).rowCount ?? 0;
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.access_remove',
        entityType: 'mark_scheme_access',
        after: { removed: n },
      });
      return { removed: n };
    });
  }

  // ---- what the builder needs ---------------------------------------------------------------------
  /**
   * For the builder (docs/design/68): the exams of the year; for the classes, their subjects in order
   * with each exam's maximum and parts, the choice groups (slots), the school's mark codes, the grade
   * scales and the classes' own.
   */
  async builderData(ctx: RequestContext, classIds: string[]) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const exams = await c.query<{
        id: string;
        code: string;
        name: string;
        starts_on: string | null;
      }>(
        `SELECT id::text, code, name, starts_on::text FROM exams WHERE academic_year_id = $1 AND deleted_at IS NULL
          ORDER BY app.exam_day(id), id`,
        [yearId],
      );
      const subjects = await c.query<{
        id: string;
        code: string;
        name: string;
        seq: number;
        classes: string[];
      }>(
        `SELECT sub.id::text, sub.code, sub.name, min(app.subject_seq(x.class_id, $2::bigint, sub.id)) AS seq,
                array_agg(DISTINCT k.code) AS classes
           FROM (SELECT class_id, subject_id FROM class_subjects WHERE class_id = ANY($1::bigint[]) AND academic_year_id = $2 AND status = 'active'
                 UNION SELECT es.class_id, es.subject_id FROM exam_subjects es JOIN exams e ON e.id = es.exam_id AND e.academic_year_id = $2
                        WHERE es.class_id = ANY($1::bigint[])) x
           JOIN subjects sub ON sub.id = x.subject_id JOIN classes k ON k.id = x.class_id
          GROUP BY sub.id, sub.code, sub.name ORDER BY 4, 2`,
        [classIds, yearId],
      );
      const papers = await c.query<{
        exam_id: string;
        subject_id: string;
        class_code: string;
        max: string;
        weightage: string | null;
        parts: Array<{ name: string; code: string | null; max: number }> | null;
      }>(
        `SELECT es.exam_id::text, es.subject_id::text, k.code AS class_code, es.max_marks::text AS max, es.weightage::text,
                (SELECT json_agg(json_build_object('name', p.name, 'code', ps.code, 'max', p.max_marks) ORDER BY p.sort_order, p.id)
                   FROM exam_subject_parts p LEFT JOIN subjects ps ON ps.id = p.subject_id WHERE p.exam_subject_id = es.id) AS parts
           FROM exam_subjects es JOIN exams e ON e.id = es.exam_id AND e.academic_year_id = $2 AND e.deleted_at IS NULL
           JOIN classes k ON k.id = es.class_id
          WHERE es.class_id = ANY($1::bigint[])`,
        [classIds, yearId],
      );
      const slots = await this.slotsFor(c, yearId, classIds);
      const codes = await this.schoolCodes(c);
      const scales = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM grade_scales WHERE deleted_at IS NULL ORDER BY code`,
      );
      const scale = await this.bands(
        c,
        null,
        exams.rows.map((e) => e.id),
        classIds[0],
      );
      return {
        exams: exams.rows.map((e) => ({ id: e.id, code: e.code, name: e.name })),
        subjects: subjects.rows.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          classes: s.classes,
          papers: papers.rows
            .filter((p) => p.subject_id === s.id)
            .map((p) => ({
              examId: p.exam_id,
              classCode: p.class_code,
              max: Number(p.max),
              weightage: p.weightage === null ? null : Number(p.weightage),
              parts: (p.parts ?? []).map((x) => ({
                name: x.name,
                code: x.code,
                max: Number(x.max),
              })),
            })),
        })),
        slots,
        codes: codes.reg,
        scales: scales.rows,
        grades: scale.length
          ? scale.map((b) => ({ grade: b.grade, minPct: b.minPct }))
          : registerGradesDefault(),
      };
    });
  }

  // ---- working it out -----------------------------------------------------------------------------
  /** The students of a class (or some sections) with their marks of the register's exams. */
  private async load(
    c: PoolClient,
    yearId: string,
    def: RegisterDef,
    classId: string,
    sectionIds: string[] | null,
  ): Promise<RegStudent[]> {
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
        WHERE es.exam_id = ANY($1::bigint[]) AND es.class_id = $2 AND es.max_marks > 0`,
      [examIds, classId],
    );
    const esIds = es.rows.map((x) => x.id);
    const parts = await c.query<{
      id: string;
      es: string;
      name: string;
      code: string | null;
      max: string;
    }>(
      `SELECT p.id::text, p.exam_subject_id::text AS es, p.name, ps.code, p.max_marks::text AS max
         FROM exam_subject_parts p LEFT JOIN subjects ps ON ps.id = p.subject_id
        WHERE p.exam_subject_id = ANY($1::bigint[]) ORDER BY p.sort_order, p.id`,
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
    const choices = await c.query<{
      student: string;
      subject: string;
      kind: string;
      opted: boolean;
    }>(
      `SELECT student_id::text AS student, subject_id::text AS subject, kind, opted_additional AS opted FROM student_subjects
        WHERE academic_year_id = $1 AND student_id = ANY($2::bigint[])`,
      [yearId, ids],
    );
    // a subject changed mid-year (docs/design/67): the new subject's line carries the old one's marks
    const switched = await c.query<{
      student: string;
      from_sub: string;
      to_sub: string;
      from_name: string;
      before: string[] | null;
    }>(
      `SELECT ch.student_id::text AS student, ch.from_subject_id::text AS from_sub, ch.to_subject_id::text AS to_sub,
              sub.name AS from_name,
              array_agg(x.id::text) FILTER (WHERE app.exam_before(x.id, ch.from_exam_id)) AS before
         FROM student_subject_changes ch JOIN subjects sub ON sub.id = ch.from_subject_id
         CROSS JOIN unnest($3::bigint[]) AS x(id)
        WHERE ch.academic_year_id = $1 AND ch.student_id = ANY($2::bigint[])
        GROUP BY ch.id, ch.student_id, ch.from_subject_id, ch.to_subject_id, sub.name`,
      [yearId, ids, examIds],
    );
    const att = await c.query<{ exam_id: string; student: string; present: number; total: number }>(
      `SELECT exam_id::text, student_id::text AS student, days_present AS present, days_total AS total
         FROM exam_attendance WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[])`,
      [examIds, ids],
    );
    const subjects = new Map<string, { code: string; name: string }>();
    for (const x of es.rows) subjects.set(x.subject_id, { code: x.code, name: x.name });
    const markBy = new Map(me.rows.map((x) => [`${x.es}|${x.student}`, x]));
    const partBy = new Map(pe.rows.map((x) => [`${x.part}|${x.student}`, x]));
    return st.rows.map((s) => {
      const mine = choices.rows.filter((x) => x.student === s.id);
      const attendance: RegStudent['attendance'] = {};
      let present = 0;
      let total = 0;
      for (const a of att.rows.filter((x) => x.student === s.id)) {
        const k = keyOf.get(a.exam_id);
        if (k) attendance[k] = { present: a.present, total: a.total };
        present += a.present;
        total += a.total;
      }
      if (total > 0) attendance['*'] = { present, total };
      return {
        studentId: s.id,
        name: s.name,
        admissionNo: s.admission_no,
        rollNo: s.roll_no,
        sectionId: s.section_id,
        section: s.section,
        attendance,
        subjects: [...subjects.entries()]
          .filter(([sid]) => !mine.length || mine.some((x) => x.subject === sid))
          .map(([sid, sub]) => {
            const marks: Record<string, RegMark | undefined> = {};
            const carry = switched.rows.find((w) => w.student === s.id && w.to_sub === sid);
            const before = carry?.before ?? [];
            const own = [
              ...es.rows.filter((e) => e.subject_id === sid && !before.includes(e.exam_id)),
              ...(carry
                ? es.rows.filter(
                    (e) => e.subject_id === carry.from_sub && before.includes(e.exam_id),
                  )
                : []),
            ];
            for (const x of own) {
              const m = markBy.get(`${x.id}|${s.id}`);
              marks[keyOf.get(x.exam_id)!] = {
                max: Number(x.max),
                marks: m?.marks === null || m?.marks === undefined ? null : Number(m.marks),
                code: m?.code ?? null,
                entered: Boolean(m),
                parts: parts.rows
                  .filter((p) => p.es === x.id)
                  .map((p) => {
                    const pm = partBy.get(`${p.id}|${s.id}`);
                    return {
                      name: p.name,
                      subjectCode: p.code,
                      max: Number(p.max),
                      marks:
                        pm?.marks === null || pm?.marks === undefined ? null : Number(pm.marks),
                      absent: pm?.absent ?? false,
                      entered: Boolean(pm),
                    };
                  }),
              };
            }
            const ch = mine.find((x) => x.subject === sid);
            const kind = (
              ch?.opted ? 'additional' : (ch?.kind ?? 'compulsory')
            ) as RegStudent['subjects'][number]['kind'];
            const keys = before.map((id) => keyOf.get(id)).filter(Boolean);
            return {
              subjectId: sid,
              code: sub.code,
              name: sub.name,
              kind,
              marks,
              ...(carry && keys.length ? { note: `${keys.join(', ')} in ${carry.from_name}` } : {}),
            };
          }),
      };
    });
  }

  private async work(
    c: PoolClient,
    yearId: string,
    def: RegisterDef,
    classId: string,
    sectionIds: string[] | null,
    exam?: string,
  ): Promise<RegStudentResult[]> {
    const students = await this.load(c, yearId, def, classId, sectionIds);
    return computeRegister(def, students, { exam });
  }

  /** A result register's term results for every student of its classes, stored. */
  async compute(ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const s = await this.find(c, id, true);
      if (s.purpose !== 'result' || s.status !== 'locked')
        throw new DomainError(
          'exams.scheme_not_result',
          'Only a locked result register makes term results',
          { status: 409 },
        );
      const counts = await this.computeIn(c, yearId, id, s);
      await this.audit.stage(ctx, c, {
        action: 'exams.scheme.compute',
        entityType: 'mark_schemes',
        entityId: id,
        after: counts,
      });
      return { ...(await this.view(c, await this.find(c, id), ctx, yearId)), counts };
    });
  }

  /**
   * Verified marks change the term results (docs/design/65): every locked result register of the year
   * that reads the exam and was worked out already is worked out again (in the verifier's transaction).
   */
  async recomputeForExam(c: PoolClient, yearId: string, examId: string): Promise<string[]> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM mark_schemes
        WHERE academic_year_id = $1 AND purpose = 'result' AND status = 'locked' AND deleted_at IS NULL AND computed_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(def->'exams') x WHERE x->>'examId' = $2::text)`,
      [yearId, examId],
    );
    for (const x of r.rows) await this.computeIn(c, yearId, x.id, await this.find(c, x.id, true));
    return r.rows.map((x) => x.id);
  }

  private async computeIn(
    c: PoolClient,
    yearId: string,
    id: string,
    s: Row,
  ): Promise<Record<string, number>> {
    const def = await this.asRegister(c, yearId, s.def, s.class_ids);
    await c.query(`DELETE FROM term_results WHERE scheme_id = $1`, [id]);
    const counts: Record<string, number> = {};
    for (const classId of s.class_ids) {
      const rows = await this.work(c, yearId, def, classId, null);
      for (const r of rows) {
        counts[r.result] = (counts[r.result] ?? 0) + 1;
        const subjects = def.subjects
          .map((rs) => r.subjects[rs.key])
          .filter((x): x is NonNullable<typeof x> => !!x)
          .map((x) => {
            const rs = def.subjects.find((y) => y.key === x.key)!;
            return {
              key: x.key,
              subjectId: x.subjectId,
              code: x.code,
              name: x.name,
              kind: x.kind,
              ...(x.note ? { note: x.note } : {}),
              values: {
                ...Object.fromEntries(
                  rs.columns
                    .filter((col) => !col.hidden)
                    .map((col) => {
                      const v = x.values[col.key];
                      return [
                        col.key,
                        v ? { v: v.v, max: v.max, ...(v.code ? { code: v.code } : {}) } : null,
                      ];
                    }),
                ),
                _total: { v: x.total, max: x.max },
              },
              total: x.total,
              max: x.max,
              pct: x.pct,
              grade: x.grade,
              status: x.status,
              inFinal: x.inFinal,
            };
          });
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
            JSON.stringify(subjects),
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
    return counts;
  }

  // ---- Run --------------------------------------------------------------------------------------
  /** each section's subject teachers: `${sectionId}|${subjectId}` → their names */
  private async teachersOf(c: PoolClient, yearId: string, sectionIds: string[]) {
    const r = await c.query<{ section: string; subject: string; name: string }>(
      `SELECT ta.class_section_id::text AS section, ta.subject_id::text AS subject,
              string_agg(DISTINCT COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name)), ', ') AS name
         FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE ta.academic_year_id = $1 AND ta.class_section_id = ANY($2::bigint[]) AND ta.kind = 'subject_teacher'
          AND ta.valid_to IS NULL AND ta.subject_id IS NOT NULL
        GROUP BY 1, 2`,
      [yearId, sectionIds],
    );
    return Object.fromEntries(r.rows.map((x) => [`${x.section}|${x.subject}`, x.name]));
  }

  private async letterhead(c: PoolClient) {
    const sc = await c.query<{
      name: string;
      logo: string | null;
      address: Record<string, string> | null;
    }>(
      `SELECT name, NULLIF(branding->>'logoFileId', '') AS logo, address FROM schools WHERE id = app.current_school_id()`,
    );
    const s = sc.rows[0];
    const logoId = s?.logo;
    const f =
      logoId && /^\d{1,18}$/.test(logoId)
        ? (
            await c.query<{ object_key: string; content_type: string }>(
              `SELECT object_key, content_type FROM files WHERE id = $1 AND deleted_at IS NULL`,
              [logoId],
            )
          ).rows[0]
        : undefined;
    const a = s?.address ?? {};
    return {
      school: s?.name ?? '',
      address: [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', '),
      file: f,
    };
  }

  /** When a paper was made, as the old reports print it: 31-10-2026 08:08 PM (India). */
  private generatedOn() {
    return new Date()
      .toLocaleString('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
      .replace(/\//g, '-')
      .replace(',', '')
      .toUpperCase();
  }

  /**
   * Runs a register: one section, or a whole class ranked together (the merit list; by division too);
   * an exam-wise register on the exam picked; one subject's own sheet. On screen (with what to check),
   * or a PDF / Excel of it, or of every section (a section a page / a sheet).
   */
  async register(ctx: RequestContext, id: string, q: RegisterQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const out = await this.db.tenant(tenant, async (c) => {
      const s = await this.find(c, id);
      await this.must(c, ctx, s.chain_id, 'run');
      const def = await this.asRegister(c, yearId, s.def, s.class_ids);
      const sections = await c.query<{
        id: string;
        class_id: string;
        code: string;
        class_code: string;
      }>(
        `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code, k.code AS class_code
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.class_id = ANY($1::bigint[]) AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active')
          ORDER BY k.display_order, cs.name`,
        [s.class_ids, yearId],
      );
      if (q.exam && !def.exams.some((e) => e.key === q.exam))
        throw new DomainError('validation-failed', 'Not an exam of this register', { status: 400 });
      const exam = def.type === 'examwise' ? (q.exam ?? def.exams[0]?.key) : undefined;
      // what to lay out: [place, class, sections or null (the whole class)]
      const places: Array<{
        place: string;
        classId: string;
        sections: string[] | null;
        merit: boolean;
      }> = [];
      if (q.classSectionId) {
        const sec = sections.rows.find((x) => x.id === q.classSectionId);
        if (!sec)
          throw new DomainError(
            'validation-failed',
            'The section is not of the register’s classes',
            {
              status: 400,
            },
          );
        places.push({ place: sec.code, classId: sec.class_id, sections: [sec.id], merit: false });
      } else if (q.classId) {
        if (!s.class_ids.includes(q.classId))
          throw new DomainError('validation-failed', 'The class is not in the register', {
            status: 400,
          });
        const code = sections.rows.find((x) => x.class_id === q.classId)?.class_code ?? '';
        places.push({
          place: `${code} · all sections`,
          classId: q.classId,
          sections: null,
          merit: true,
        });
      } else {
        const first = sections.rows[0];
        if (first)
          places.push({
            place: first.code,
            classId: first.class_id,
            sections: [first.id],
            merit: false,
          });
      }
      if (q.all && q.format !== 'json') {
        places.length = 0;
        const of = q.classId
          ? sections.rows.filter((x) => x.class_id === q.classId)
          : sections.rows;
        for (const x of of)
          places.push({ place: x.code, classId: x.class_id, sections: [x.id], merit: false });
      }
      const titles: Record<string, string> = {};
      const subjectIds = def.subjects.flatMap((x) => (x.slot ? x.slot.members : [x.subjectId!]));
      const subs = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM subjects WHERE id = ANY($1::bigint[])`,
        [subjectIds],
      );
      for (const x of def.subjects)
        titles[x.key] = x.slot
          ? x.slot.name
          : (subs.rows.find((y) => y.id === x.subjectId)?.name ?? x.key);
      const sheets: Sheet[] = [];
      let firstRows: RegStudentResult[] = [];
      let firstOrder: string[] = [];
      let firstSheets = 0;
      const notes: string[] = [];
      const counts: Record<string, number> = {};
      for (const p of places) {
        // the subjects in the class's order (a slot at its first member's place), unless the register's own
        const seq = new Map(
          (
            await c.query<{ id: string; seq: number }>(
              `SELECT x.id::text, app.subject_seq($1::bigint, $2::bigint, x.id) AS seq FROM unnest($3::bigint[]) AS x(id)`,
              [p.classId, yearId, subjectIds],
            )
          ).rows.map((x) => [x.id, x.seq]),
        );
        const order = def.ownOrder
          ? def.subjects.map((x) => x.key)
          : [...def.subjects]
              .map((x, i) => ({
                key: x.key,
                at: Math.min(
                  ...(x.slot ? x.slot.members : [x.subjectId!]).map((m) => seq.get(m) ?? 9999),
                ),
                i,
              }))
              .sort((a, b) => a.at - b.at || a.i - b.i)
              .map((x) => x.key);
        const students = await this.load(c, yearId, def, p.classId, p.sections);
        let rows = computeRegister(def, students, { exam });
        for (const r of rows) counts[r.result] = (counts[r.result] ?? 0) + 1;
        rows =
          p.merit && q.view === 'division'
            ? byDivision(def, rows)
            : orderStudents(def, rows, p.merit || q.view === 'merit');
        if (!sheets.length) {
          firstRows = rows;
          firstOrder = order;
        }
        if (q.report === 'register')
          sheets.push(
            buildSheet(def, rows, {
              place: p.place,
              merit: p.merit,
              division: q.view === 'division',
              subject: q.subject,
              order,
              titles,
            }),
          );
        else {
          // a report (docs/design/68, phase 2): its tables, one after another
          const teachers =
            q.report === 'entry' || q.report === 'teacher'
              ? await this.teachersOf(c, yearId, [...new Set(students.map((x) => x.sectionId))])
              : undefined;
          const only = q.subject ? order.filter((k) => k === q.subject) : order;
          for (const b of buildReport(q.report, {
            def,
            rows,
            students,
            place: p.place,
            merit: p.merit,
            order: only,
            titles,
            teachers,
            top: q.top,
            margin: q.margin,
          }))
            sheets.push(b.sheet);
          if (!firstSheets) firstSheets = sheets.length;
        }
        if (q.format === 'json') {
          const none = order.filter((k) => !rows.some((r) => r.subjects[k]));
          if (none.length)
            notes.push(`Nobody here takes ${none.map((k) => titles[k]).join(', ')}: left out.`);
          const two = rows.filter((r) => Object.values(r.subjects).some((x) => x?.twoMembers));
          if (two.length)
            notes.push(
              `${two
                .map((r) => r.name)
                .slice(0, 8)
                .join(
                  ', ',
                )} ${two.length === 1 ? 'has' : 'have'} two subjects of one slot: check the subject choices.`,
            );
          const held = rows.filter((r) => r.withheldBy.length);
          if (held.length)
            notes.push(
              `Final withheld (a code that holds it, such as AB): ${held
                .slice(0, 8)
                .map((r) => `${r.name} (${r.withheldBy.join(', ')})`)
                .join(', ')}${held.length > 8 ? ` and ${String(held.length - 8)} more` : ''}.`,
            );
          const gaps = rows.filter((r) => r.result === 'incomplete');
          if (gaps.length)
            notes.push(
              `Marks not entered yet for ${String(gaps.length)} student${gaps.length === 1 ? '' : 's'} (${gaps
                .slice(0, 8)
                .map((r) => r.name)
                .join(', ')}${gaps.length > 8 ? ' …' : ''}): no final for them yet.`,
            );
          const empty = def.exams.filter(
            (e) => !students.some((st) => st.subjects.some((x) => x.marks[e.key]?.entered)),
          );
          if (empty.length && students.length)
            notes.push(`No marks at all yet in ${empty.map((e) => e.key).join(', ')}.`);
        }
      }
      const head = q.format === 'json' ? null : await this.letterhead(c);
      return {
        s,
        def,
        sections: sections.rows,
        sheets,
        firstSheets,
        rows: firstRows,
        order: firstOrder,
        notes,
        counts,
        exam,
        titles,
        head,
      };
    });

    const examName = out.exam
      ? ((await this.db.tenant(
          tenant,
          async (c) =>
            (
              await c.query<{ name: string }>(`SELECT name FROM exams WHERE id = $1`, [
                out.def.exams.find((e) => e.key === out.exam)!.examId,
              ])
            ).rows[0]?.name,
        )) ?? out.exam)
      : null;
    if (q.format === 'json')
      return {
        scheme: {
          id: out.s.id,
          name: out.s.name,
          purpose: out.s.purpose,
          termCode: out.s.term_code,
          status: out.s.status,
          version: out.s.version,
          layout: out.def.layout,
          type: out.def.type,
        },
        places: [
          ...out.sections.map((x) => ({ value: `s:${x.id}`, label: x.code, classId: x.class_id })),
          ...out.s.class_ids
            .filter((k) => out.sections.some((x) => x.class_id === k))
            .map((k) => ({
              value: `c:${k}`,
              label: `${out.sections.find((x) => x.class_id === k)!.class_code} · all sections (merit)`,
              classId: k,
            })),
        ],
        exams: out.def.exams.map((e) => e.key),
        exam: out.exam ?? null,
        examName,
        subjects: out.def.subjects.map((x) => ({ key: x.key, title: out.titles[x.key] })),
        report: q.report,
        /** the reports of the Run menu (Compare sections: a class's all sections) */
        reports: REPORTS.map((x) => ({ kind: x.kind, label: x.label, merit: Boolean(x.merit) })),
        sheet: q.report === 'register' ? (out.sheets[0] ?? null) : null,
        /** a report's tables (of the place shown) */
        blocks:
          q.report === 'register'
            ? []
            : out.sheets
                .slice(0, out.firstSheets || out.sheets.length)
                .map((x) => ({ title: x.title ?? '', sheet: x })),
        /** the worked-out students, in the sheet's order: each subject's values, total, % and status */
        rows: out.rows.map((r) => ({
          ...r,
          subjects: out.order
            .map((k) => r.subjects[k])
            .filter((x): x is NonNullable<typeof x> => !!x),
        })),
        notes: out.notes,
        counts: out.counts,
      };
    let logo: RegisterFileMeta['logo'] = null;
    if (out.head?.file)
      try {
        logo = {
          contentType: out.head.file.content_type,
          bytes: await this.storage.read(out.head.file.object_key),
        };
      } catch {
        logo = null;
      }
    const report = REPORTS.find((x) => x.kind === q.report);
    const label = [
      report
        ? `${report.label}${q.subject ? ` · ${out.titles[q.subject] ?? q.subject}` : ''}`
        : q.subject
          ? `Subject sheet · ${out.titles[q.subject] ?? q.subject}`
          : q.view === 'division'
            ? 'Merit List (division-wise)'
            : (q.view === 'merit' || q.classId) && !q.all
              ? 'Merit List'
              : 'Mark Register',
      examName,
    ]
      .filter(Boolean)
      .join(' · ');
    const meta: RegisterFileMeta = {
      school: out.head?.school ?? '',
      address: out.head?.address ?? '',
      logo,
      label,
      generatedOn: this.generatedOn(),
    };
    const stamp =
      `${out.s.name}-${q.report === 'register' ? '' : `${q.report}-`}${q.all ? 'all' : (out.sheets[0]?.place ?? '')}${out.exam ? `-${out.exam}` : ''}${q.subject ? `-${q.subject}` : ''}`
        .toLowerCase()
        .replace(/[^\w.-]+/g, '-');
    if (q.format === 'xlsx')
      return {
        filename: `register-${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: (await registerXlsx(out.sheets, meta)).toString('base64'),
      };
    return {
      filename: `register-${stamp}.pdf`,
      contentType: 'application/pdf',
      base64: (
        await registerPdf(out.sheets, meta, {
          paper: q.paper,
          orientation: q.orientation,
          fit: q.fit,
        })
      ).toString('base64'),
    };
  }
}

/** CBSE 8-point, when the classes have no scale */
const registerGradesDefault = () => CBSE_8.map((g) => ({ ...g }));
