import { Inject, Injectable } from '@nestjs/common';
import {
  areaKey,
  arrange,
  buildGradeSheet,
  buildStudentWise,
  gradeAnalysis,
  gradeAnalysisAll,
  gradeProblems,
  gradeStats,
  gradeSummary,
  type GradeLeaf,
  type GradeRegisterDef,
  type GradeSheetInput,
  type GradeTree,
  type PoolClient,
  type Sheet,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import type {
  CopyGradeRegisterDto,
  CreateGradeRegisterDto,
  GradeRunQueryDto,
  RestoreGradeRegisterDto,
  UpdateGradeRegisterDto,
} from './grade-registers.dto';
import type { RemoveAccessDto, SchemeAccessDto } from './mark-schemes.dto';
import { registerPdf, registerXlsx } from './mark-register-file';
import { MarkSchemesService, REGISTERS, type Rights } from './mark-schemes.service';
import { registerGeneratedOn, registerLetterhead, registerLogo } from './register-head';

const REPORT_LABEL: Record<GradeRunQueryDto['report'], string> = {
  sheet: '',
  summary: 'Grade Summary',
  analysis: 'Analysis',
  'analysis-all': 'Analysis (all sections)',
};

interface Row {
  id: string;
  chain_id: string;
  name: string;
  class_ids: string[];
  def: GradeRegisterDef;
  access_type: 'all' | 'mapping';
  status: 'draft' | 'locked' | 'superseded';
  version: number;
  previous_id: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
  deleted_at: Date | null;
}
const COLS = `g.id::text, g.chain_id::text, g.name, g.class_ids::text[] AS class_ids, g.def, g.access_type, g.status, g.version,
  g.previous_id::text, g.locked_at, u.display_name AS locked_by, g.created_at, cu.display_name AS created_by,
  g.updated_at, uu.display_name AS updated_by, g.deleted_at`;
const FROM = `FROM grade_registers g LEFT JOIN users u ON u.id = g.locked_by LEFT JOIN users cu ON cu.id = g.created_by
  LEFT JOIN users uu ON uu.id = g.updated_by`;
const NONE: Rights = { manage: false, run: false, edit: false, delete: false, assign: false };

/** a name as compared for clashes: capitals and spaces do not make a name different */
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Grade registers (docs/design/69, part 2): the school's legacy Grade Register — the indicator grades of
 * some classes for some exams. Kept like mark registers (docs/design/68): every saved version in a chain;
 * a draft changes in place, a locked one is pinned (saving it makes the next version, which replaces it
 * once locked), unlock opens it again, delete puts a draft in the bin, a version is restored as a new
 * register, a copy is made for other classes (without its people). The same rights as mark registers:
 * exams.registers.manage sees and changes every register, exams.registers.assign gives rights on any;
 * anyone else sees the registers given to them with Run / Edit / Delete / Assign. The access type says
 * whether a teacher sees every indicator of a register or only the areas given to them (part 3).
 */
@Injectable()
export class GradeRegistersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly marks: MarkSchemesService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private year(ctx: RequestContext): string {
    const id = requireTenant(ctx).academicYearId;
    if (!id)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return id;
  }

  // ---- rights (as mark registers) ------------------------------------------------------------------
  private roleRights(ctx: RequestContext): Rights {
    if (ctx.permissions?.has(REGISTERS.manage))
      return { manage: true, run: true, edit: true, delete: true, assign: true };
    if (ctx.permissions?.has(REGISTERS.assign))
      return { manage: false, run: true, edit: false, delete: false, assign: true };
    return NONE;
  }

  private async rightsOn(c: PoolClient, ctx: RequestContext, chainId: string): Promise<Rights> {
    const role = this.roleRights(ctx);
    if (role.manage) return role;
    const r = await c.query<{ run: boolean; edit: boolean; del: boolean; assign: boolean }>(
      `SELECT can_run AS run, can_edit AS edit, can_delete AS del, can_assign AS assign
         FROM grade_register_access WHERE chain_id = $1 AND user_id = $2`,
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

  private async must(c: PoolClient, ctx: RequestContext, chainId: string, what: keyof Rights) {
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

  // ---- reading -------------------------------------------------------------------------------------
  private async find(c: PoolClient, id: string, lock = false, deleted = false): Promise<Row> {
    if (!/^\d{1,18}$/.test(id)) throw new DomainError('not-found', 'Register not found');
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- COLS / FROM are constants; values are bound
      `SELECT ${COLS} ${FROM} WHERE g.id = $1${deleted ? '' : ' AND g.deleted_at IS NULL'}${lock ? ' FOR UPDATE OF g' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Register not found');
    return r.rows[0];
  }

  private async view(c: PoolClient, r: Row, ctx: RequestContext) {
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
      chainId: r.chain_id,
      name: r.name,
      classIds: r.class_ids,
      classes: classes.rows,
      def: r.def,
      exams: r.def.exams.map((e) => {
        const x = exams.rows.find((y) => y.id === e.examId);
        return { examId: e.examId, label: e.label, code: x?.code ?? null, name: x?.name ?? null };
      }),
      accessType: r.access_type,
      status: r.status,
      version: r.version,
      previousId: r.previous_id,
      lockedAt: r.locked_at?.toISOString() ?? null,
      lockedBy: r.locked_by,
      createdAt: r.created_at.toISOString(),
      createdBy: r.created_by,
      updatedAt: r.updated_at.toISOString(),
      updatedBy: r.updated_by,
      problems: gradeProblems(r.def),
      rights: await this.rightsOn(c, ctx, r.chain_id),
    };
  }

  /** The registers the person may see: each one's newest version not replaced or in the bin. */
  async list(ctx: RequestContext) {
    const yearId = this.year(ctx);
    const role = this.roleRights(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row & { in_use: number | null }>(
        // eslint-disable-next-line no-restricted-syntax -- COLS / FROM are constants; values are bound
        `SELECT DISTINCT ON (g.chain_id) ${COLS},
                (SELECT max(o.version) FROM grade_registers o WHERE o.chain_id = g.chain_id AND o.id <> g.id AND o.status = 'locked' AND o.deleted_at IS NULL) AS in_use
           ${FROM}
          WHERE g.academic_year_id = $1 AND g.deleted_at IS NULL AND g.status <> 'superseded'
            AND ($2::boolean OR EXISTS (SELECT 1 FROM grade_register_access a WHERE a.chain_id = g.chain_id AND a.user_id = $3))
          ORDER BY g.chain_id, g.version DESC`,
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
           FROM grade_register_access a JOIN users u ON u.id = a.user_id
          WHERE a.chain_id = ANY($1::bigint[]) ORDER BY 2`,
        [r.rows.map((x) => x.chain_id)],
      );
      const names = new Map<string, number>();
      for (const x of r.rows) names.set(norm(x.name), (names.get(norm(x.name)) ?? 0) + 1);
      const out = [];
      // the newest first, as the legacy lists them
      for (const x of r.rows.sort((a, b) => Number(b.chain_id) - Number(a.chain_id))) {
        const v = await this.view(c, x, ctx);
        out.push({
          ...v,
          def: undefined,
          assessments: v.exams.map((e) => e.code ?? e.label),
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
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.find(c, id);
      await this.must(c, ctx, r.chain_id, 'run');
      return this.view(c, r, ctx);
    });
  }

  // ---- what the builder needs ------------------------------------------------------------------------
  /**
   * The classes of the school (with "no grades yet"), the year's exams that rate indicators for the
   * classes chosen, and for the exams chosen the indicator tree of the sets those classes use, with
   * the sets' levels (a starting grade scale).
   */
  async builder(ctx: RequestContext, classIds: string[] = [], examIds: string[] = []) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const classes = await c.query<{ id: string; code: string; name: string; graded: boolean }>(
        `SELECT k.id::text, k.code, k.name,
                EXISTS (SELECT 1 FROM indicator_entries ie
                          JOIN exams e ON e.id = ie.exam_id AND e.academic_year_id = $1
                          JOIN enrolments en ON en.student_id = ie.student_id AND en.academic_year_id = $1
                          JOIN class_sections cs ON cs.id = en.class_section_id AND cs.class_id = k.id) AS graded
           FROM classes k WHERE k.deleted_at IS NULL ORDER BY k.display_order, k.code`,
        [yearId],
      );
      const exams = classIds.length
        ? (
            await c.query<{ id: string; code: string; name: string; classes: string[] }>(
              `SELECT e.id::text, e.code, e.name,
                      ARRAY(SELECT k.code FROM exam_indicator_sets x JOIN classes k ON k.id = x.class_id
                             WHERE x.exam_id = e.id AND x.class_id = ANY($2::bigint[]) ORDER BY k.display_order) AS classes
                 FROM exams e
                WHERE e.academic_year_id = $1 AND e.deleted_at IS NULL AND 'indicators' = ANY(e.areas)
                  AND EXISTS (SELECT 1 FROM exam_indicator_sets x WHERE x.exam_id = e.id AND x.class_id = ANY($2::bigint[]))
                ORDER BY e.starts_on NULLS LAST, e.code`,
              [yearId, classIds],
            )
          ).rows
        : [];
      const picked = examIds.filter((x) => exams.some((e) => e.id === x));
      const tree = classIds.length && picked.length ? await this.tree(c, classIds, picked) : null;
      const levels = classIds.length
        ? (
            await c.query<{ grades: string[] }>(
              `SELECT DISTINCT s.grades FROM exam_indicator_sets x JOIN indicator_sets s ON s.id = x.set_id
                WHERE x.class_id = ANY($1::bigint[]) AND x.exam_id = ANY($2::bigint[])`,
              [classIds, picked.length ? picked : exams.map((e) => e.id)],
            )
          ).rows.flatMap((x) => x.grades)
        : [];
      return {
        classes: classes.rows.map((k) => ({
          id: k.id,
          code: k.code,
          name: k.name,
          noGrades: !k.graded,
        })),
        exams,
        tree,
        levels: [...new Set(levels)],
      };
    });
  }

  /**
   * The indicator tree of the sets the classes use in the exams: the rated items (an item with no
   * sub-items, or a sub-item; written observations left out), area by area in the master's order.
   */
  async tree(c: PoolClient, classIds: string[], examIds: string[]): Promise<GradeTree> {
    const r = await c.query<{
      id: string;
      name: string;
      description: string | null;
      area: string;
      item_id: string | null;
      item_name: string | null;
      set_name: string;
    }>(
      `SELECT DISTINCT ON (i.id) i.id::text, i.name, i.description, COALESCE(btrim(i.area), '') AS area,
              i.parent_id::text AS item_id, p.name AS item_name, s.name AS set_name,
              COALESCE(ar.sort_order, 1000000) AS area_order, COALESCE(p.sort_order, i.sort_order) AS item_order,
              i.sort_order AS own_order
         FROM exam_indicator_sets x
         JOIN indicator_sets s ON s.id = x.set_id
         JOIN indicators i ON i.set_id = x.set_id AND i.kind = 'level'
         LEFT JOIN indicators p ON p.id = i.parent_id
         LEFT JOIN indicator_areas ar ON lower(btrim(ar.name)) = lower(btrim(i.area))
        WHERE x.exam_id = ANY($1::bigint[]) AND x.class_id = ANY($2::bigint[])
          AND NOT EXISTS (SELECT 1 FROM indicators ch WHERE ch.parent_id = i.id)
        ORDER BY i.id`,
      [examIds, classIds],
    );
    const rows = r.rows as Array<
      (typeof r.rows)[number] & { area_order: number; item_order: number; own_order: number }
    >;
    rows.sort(
      (a, b) =>
        a.area_order - b.area_order ||
        a.area.localeCompare(b.area) ||
        a.item_order - b.item_order ||
        (a.item_id ?? a.id).localeCompare(b.item_id ?? b.id) ||
        a.own_order - b.own_order,
    );
    const areas: GradeTree['areas'] = [];
    for (const x of rows)
      if (!areas.some((a) => a.key === areaKey(x.area)))
        areas.push({ key: areaKey(x.area), name: x.area });
    return {
      areas,
      leaves: rows.map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        area: x.area,
        itemId: x.item_id,
        itemName: x.item_name,
        setName: x.set_name,
      })),
    };
  }

  /** The exams of the year a definition names, the classes, and what keeps it from being saved. */
  private async check(c: PoolClient, yearId: string, def: GradeRegisterDef, classIds: string[]) {
    const ex = await c.query<{ id: string }>(
      `SELECT id::text FROM exams WHERE id = ANY($1::bigint[]) AND academic_year_id = $2 AND deleted_at IS NULL`,
      [def.exams.map((e) => e.examId), yearId],
    );
    if (def.exams.some((e) => !ex.rows.some((x) => x.id === e.examId)))
      throw new DomainError(
        'exams.scheme_exam',
        'An assessment is not an exam of the working year',
        {
          status: 400,
        },
      );
    const k = await c.query<{ id: string }>(
      `SELECT id::text FROM classes WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [classIds],
    );
    if (k.rows.length !== new Set(classIds).size)
      throw new DomainError('validation-failed', 'A class is not of this school', { status: 400 });
    const problems = gradeProblems(
      def,
      await this.tree(
        c,
        classIds,
        def.exams.map((e) => e.examId),
      ),
    );
    if (problems.length)
      throw new DomainError('exams.register_problems', problems.join('; '), {
        status: 400,
        extra: { problems },
      });
  }

  /** names are unique in the year among grade registers (capitals and spaces do not count) */
  private async nameFree(c: PoolClient, yearId: string, name: string, chainId: string | null) {
    const r = await c.query<{ name: string }>(
      `SELECT name FROM grade_registers
        WHERE academic_year_id = $1 AND deleted_at IS NULL AND status <> 'superseded'
          AND lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $2 AND ($3::bigint IS NULL OR chain_id <> $3::bigint)
        LIMIT 1`,
      [yearId, norm(name), chainId],
    );
    if (r.rows[0])
      throw new DomainError(
        'exams.register_name',
        `A grade register is already called "${r.rows[0].name}": give this one another name`,
        { status: 409 },
      );
  }

  // ---- saving --------------------------------------------------------------------------------------
  async create(ctx: RequestContext, dto: CreateGradeRegisterDto) {
    this.mustManage(ctx);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const def = dto.def as GradeRegisterDef;
      await this.check(c, yearId, def, dto.classIds);
      await this.nameFree(c, yearId, dto.name, null);
      const r = await c.query<{ id: string }>(
        `INSERT INTO grade_registers (school_id, academic_year_id, name, class_ids, def, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::bigint[], $4::jsonb, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [yearId, dto.name.trim(), dto.classIds, JSON.stringify(def)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.create',
        entityType: 'grade_registers',
        entityId: r.rows[0]!.id,
        after: { name: dto.name, classIds: dto.classIds },
      });
      return this.view(c, await this.find(c, r.rows[0]!.id), ctx);
    });
  }

  /** A draft changes in place; a locked one is never overwritten: the change becomes the next version. */
  async update(ctx: RequestContext, id: string, dto: UpdateGradeRegisterDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
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
          `SELECT id::text FROM grade_registers WHERE chain_id = $1 AND status = 'draft' AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`,
          [cur.chain_id],
        );
        const next =
          open.rows[0]?.id ??
          (
            await c.query<{ id: string }>(
              `INSERT INTO grade_registers (school_id, academic_year_id, name, class_ids, def, access_type, version, previous_id, chain_id, created_by, updated_by)
               SELECT school_id, academic_year_id, name, class_ids, def, access_type,
                      (SELECT max(version) + 1 FROM grade_registers WHERE chain_id = g.chain_id), id, chain_id,
                      app.current_user_id(), app.current_user_id()
                 FROM grade_registers g WHERE id = $1 RETURNING id::text`,
              [cur.id],
            )
          ).rows[0]!.id;
        cur = await this.find(c, next, true);
      }
      const def = (dto.def as GradeRegisterDef | undefined) ?? cur.def;
      const classIds = dto.classIds ?? cur.class_ids;
      const name = dto.name?.trim() ?? cur.name;
      await this.check(c, yearId, def, classIds);
      await this.nameFree(c, yearId, name, cur.chain_id);
      await c.query(
        `UPDATE grade_registers SET name = $2, class_ids = $3::bigint[], def = $4::jsonb, updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [cur.id, name, classIds, JSON.stringify(def)],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.update',
        entityType: 'grade_registers',
        entityId: cur.id,
        after: { name, classIds, version: cur.version },
      });
      return this.view(c, await this.find(c, cur.id), ctx);
    });
  }

  /** Locks a draft (managers); the chain's earlier locked version steps aside. */
  async lock(ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id, true);
      if (cur.status !== 'draft')
        throw new DomainError('exams.scheme_locked', 'This version is locked already', {
          status: 409,
        });
      await this.check(c, yearId, cur.def, cur.class_ids);
      const older = await c.query<{ id: string }>(
        `UPDATE grade_registers SET status = 'superseded', updated_at = now() WHERE chain_id = $1 AND id <> $2 AND status = 'locked' RETURNING id::text`,
        [cur.chain_id, id],
      );
      await c.query(
        `UPDATE grade_registers SET status = 'locked', locked_at = now(), locked_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.lock',
        entityType: 'grade_registers',
        entityId: id,
        after: { version: cur.version, supersedes: older.rows.map((x) => x.id) },
      });
      return this.view(c, await this.find(c, id), ctx);
    });
  }

  async unlock(ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id, true);
      if (cur.status !== 'locked')
        throw new DomainError('exams.scheme_draft', 'This register is not locked', { status: 409 });
      const open = await c.query(
        `SELECT 1 FROM grade_registers WHERE chain_id = $1 AND status = 'draft' AND deleted_at IS NULL`,
        [cur.chain_id],
      );
      if (open.rowCount)
        throw new DomainError(
          'exams.scheme_draft',
          'A new version of it is being made: change that one, or delete it first',
          { status: 409 },
        );
      await c.query(
        `UPDATE grade_registers SET status = 'draft', locked_at = NULL, locked_by = NULL, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.unlock',
        entityType: 'grade_registers',
        entityId: id,
        after: { version: cur.version },
      });
      return this.view(c, await this.find(c, id), ctx);
    });
  }

  /** All (every indicator) or As per mapping (a teacher: the areas given to them); managers. */
  async setAccessType(ctx: RequestContext, id: string, type: 'all' | 'mapping') {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id, true);
      // the whole chain: every version of the register is run the same way
      await c.query(
        `UPDATE grade_registers SET access_type = $2, updated_at = now(), updated_by = app.current_user_id() WHERE chain_id = $1`,
        [cur.chain_id, type],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.access_type',
        entityType: 'grade_registers',
        entityId: id,
        after: { type },
      });
      return this.view(c, await this.find(c, id), ctx);
    });
  }

  /** Puts a draft in the bin (a locked register is unlocked first). */
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
        `UPDATE grade_registers SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.remove',
        entityType: 'grade_registers',
        entityId: id,
      });
      return { removed: true };
    });
  }

  /** The bin: registers of the year with no version left in use, each by its newest deleted version. */
  async deleted(ctx: RequestContext) {
    const yearId = this.year(ctx);
    const role = this.roleRights(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        chain_id: string;
        name: string;
        version: number;
        deleted_at: Date;
        deleted_by: string | null;
        classes: string[];
      }>(
        `SELECT DISTINCT ON (g.chain_id) g.id::text, g.chain_id::text, g.name, g.version, g.deleted_at, u.display_name AS deleted_by,
                ARRAY(SELECT k.code FROM classes k WHERE k.id = ANY(g.class_ids) ORDER BY k.display_order) AS classes
           FROM grade_registers g LEFT JOIN users u ON u.id = g.deleted_by
          WHERE g.academic_year_id = $1 AND g.deleted_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM grade_registers o WHERE o.chain_id = g.chain_id AND o.deleted_at IS NULL AND o.status <> 'superseded')
            AND ($2::boolean OR EXISTS (SELECT 1 FROM grade_register_access a WHERE a.chain_id = g.chain_id AND a.user_id = $3 AND a.can_delete))
          ORDER BY g.chain_id, g.version DESC`,
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
  async restore(ctx: RequestContext, id: string, dto: RestoreGradeRegisterDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await this.find(c, id, true, true);
      await this.must(c, ctx, cur.chain_id, 'delete');
      if (!cur.deleted_at)
        throw new DomainError('exams.scheme_live', 'This register is not in the bin', {
          status: 409,
        });
      const name = dto.name?.trim() ?? cur.name;
      await this.nameFree(c, yearId, name, cur.chain_id);
      await c.query(
        `UPDATE grade_registers SET deleted_at = NULL, deleted_by = NULL, name = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id, name],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.restore',
        entityType: 'grade_registers',
        entityId: id,
        after: { name },
      });
      return this.view(c, await this.find(c, id), ctx);
    });
  }

  /** Every saved version of a register, newest first. */
  async versions(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
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
      }>(
        `SELECT g.id::text, g.version, g.status, g.deleted_at IS NOT NULL AS deleted, g.updated_at, uu.display_name AS updated_by,
                u.display_name AS locked_by
           FROM grade_registers g LEFT JOIN users uu ON uu.id = g.updated_by LEFT JOIN users u ON u.id = g.locked_by
          WHERE g.chain_id = $1 ORDER BY g.version DESC`,
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
          results: 0,
        })),
      };
    });
  }

  /** A saved version as a new register (version 1, unlocked) with that register's people. */
  async restoreVersion(ctx: RequestContext, id: string, dto: RestoreGradeRegisterDto) {
    this.mustManage(ctx);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const src = await this.find(c, id, false, true);
      const name = dto.name?.trim() ?? `${src.name} (v${String(src.version)})`;
      await this.nameFree(c, yearId, name, null);
      const r = await c.query<{ id: string; chain_id: string }>(
        `INSERT INTO grade_registers (school_id, academic_year_id, name, class_ids, def, access_type, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::bigint[], $4::jsonb, $5, app.current_user_id(), app.current_user_id())
         RETURNING id::text, chain_id::text`,
        [yearId, name, src.class_ids, JSON.stringify(src.def), src.access_type],
      );
      await c.query(
        `INSERT INTO grade_register_access (school_id, chain_id, user_id, can_run, can_edit, can_delete, can_assign, granted_by)
         SELECT school_id, $2, user_id, can_run, can_edit, can_delete, can_assign, app.current_user_id()
           FROM grade_register_access WHERE chain_id = $1`,
        [src.chain_id, r.rows[0]!.chain_id],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.restore_version',
        entityType: 'grade_registers',
        entityId: r.rows[0]!.id,
        after: { from: id, version: src.version, name },
      });
      return this.view(c, await this.find(c, r.rows[0]!.id), ctx);
    });
  }

  /**
   * A copy for other classes, saved at once (as the legacy: every setting, not the people). Each class
   * prints its own indicator set when it runs; what is left out stays left out.
   */
  async copy(ctx: RequestContext, id: string, dto: CopyGradeRegisterDto) {
    this.mustManage(ctx);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const src = await this.find(c, id);
      await this.check(c, yearId, src.def, dto.classIds);
      await this.nameFree(c, yearId, dto.name, null);
      const r = await c.query<{ id: string }>(
        `INSERT INTO grade_registers (school_id, academic_year_id, name, class_ids, def, access_type, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::bigint[], $4::jsonb, $5, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [yearId, dto.name.trim(), dto.classIds, JSON.stringify(src.def), src.access_type],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.copy',
        entityType: 'grade_registers',
        entityId: r.rows[0]!.id,
        after: { from: id, classIds: dto.classIds },
      });
      return { ...(await this.view(c, await this.find(c, r.rows[0]!.id), ctx)), dropped: [] };
    });
  }

  // ---- people and their rights (as mark registers) ---------------------------------------------------
  staff(ctx: RequestContext) {
    return this.marks.staff(ctx);
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
           FROM grade_register_access a JOIN users u ON u.id = a.user_id
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
   * on it passes on only the rights they hold, never Assign, and leaves alone anyone holding Assign.
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
        `SELECT user_id::text, can_run AS run, can_edit AS edit, can_delete AS del, can_assign AS assign FROM grade_register_access WHERE chain_id = $1`,
        [cur.chain_id],
      );
      const want = new Map(dto.rows.map((x) => [x.userId, x]));
      if (!(role.manage || role.assign)) {
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
        `DELETE FROM grade_register_access WHERE chain_id = $1 AND NOT (user_id = ANY($2::bigint[]))`,
        [
          cur.chain_id,
          dto.rows.filter((x) => x.run || x.edit || x.delete || x.assign).map((x) => x.userId),
        ],
      );
      for (const w of dto.rows) {
        if (!(w.run || w.edit || w.delete || w.assign)) continue;
        await c.query(
          `INSERT INTO grade_register_access (school_id, chain_id, user_id, can_run, can_edit, can_delete, can_assign, granted_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())
           ON CONFLICT (chain_id, user_id) DO UPDATE SET can_run = EXCLUDED.can_run, can_edit = EXCLUDED.can_edit,
             can_delete = EXCLUDED.can_delete, can_assign = EXCLUDED.can_assign, granted_by = EXCLUDED.granted_by, updated_at = now()`,
          [cur.chain_id, w.userId, w.run || w.edit || w.delete, w.edit, w.delete, w.assign],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.access',
        entityType: 'grade_registers',
        entityId: cur.chain_id,
        after: { people: dto.rows.length },
      });
      return this.access(ctx, id);
    });
  }

  /** Who holds which right on which grade register (managers and those who assign on every one). */
  async rightsReport(ctx: RequestContext) {
    if (!this.roleRights(ctx).assign)
      throw new DomainError('permission-denied', 'Only a register manager sees every right', {
        status: 403,
      });
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
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
        `SELECT a.chain_id::text, (SELECT g.name FROM grade_registers g WHERE g.chain_id = a.chain_id ORDER BY g.version DESC LIMIT 1) AS register,
                a.user_id::text, COALESCE(e.display_name, u.display_name, u.email) AS name, e.designation,
                a.can_run AS run, a.can_edit AS edit, a.can_delete AS del, a.can_assign AS assign
           FROM grade_register_access a JOIN users u ON u.id = a.user_id
           LEFT JOIN employees e ON e.user_id = a.user_id AND e.deleted_at IS NULL
          WHERE EXISTS (SELECT 1 FROM grade_registers g WHERE g.chain_id = a.chain_id AND g.academic_year_id = $1)
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
            await c.query(
              `DELETE FROM grade_register_access WHERE chain_id = $1 AND user_id = $2`,
              [p.chainId, p.userId],
            )
          ).rowCount ?? 0;
      await this.audit.stage(ctx, c, {
        action: 'exams.grade_register.access_remove',
        entityType: 'grade_register_access',
        after: { removed: n },
      });
      return { removed: n };
    });
  }

  // ---- Run (part 3) ---------------------------------------------------------------------------------
  /**
   * Runs a register for a section (any section of its classes with students): the class sheet or
   * student-wise, or the Grade summary, the Analysis, the Analysis of every section side by side; on
   * screen or as a PDF / Excel (of the section, or of every section). Filters by area and item. "As per
   * mapping": a teacher who does not manage registers sees only the areas of their Indicator assignment
   * of the section (an assignment naming no area covers every area).
   */
  async run(ctx: RequestContext, id: string, q: GradeRunQueryDto) {
    const yearId = this.year(ctx);
    const role = this.roleRights(ctx);
    const out = await this.db.tenant(requireTenant(ctx), async (c) => {
      const reg = await this.find(c, id);
      await this.must(c, ctx, reg.chain_id, 'run');
      const secs = (
        await c.query<{ id: string; class_id: string; code: string; class_name: string }>(
          `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code, k.name AS class_name
             FROM class_sections cs JOIN classes k ON k.id = cs.class_id
            WHERE cs.class_id = ANY($1::bigint[]) AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active')
            ORDER BY k.display_order, cs.name`,
          [reg.class_ids, yearId],
        )
      ).rows;
      const exRows = (
        await c.query<{ id: string; code: string; name: string }>(
          `SELECT id::text, code, name FROM exams WHERE id = ANY($1::bigint[])`,
          [reg.def.exams.map((e) => e.examId)],
        )
      ).rows;
      const exams = reg.def.exams.map((e) => {
        const x = exRows.find((y) => y.id === e.examId);
        return {
          examId: e.examId,
          label: e.label || x?.code || 'T',
          name: x ? `${x.code} · ${x.name}` : 'an exam no longer there',
        };
      });
      const place = secs.find((x) => x.id === q.classSectionId) ?? secs[0] ?? null;
      const mapping = reg.access_type === 'mapping' && !(role.manage || role.assign);
      const areaPick = q.areas ? new Set(q.areas.split('|').filter(Boolean)) : null;
      const itemPick = q.items ? new Set(q.items.split(',')) : null;
      const load = (sec: (typeof secs)[number]) =>
        this.sectionRun(c, reg.def, exams, sec, yearId, mapping, areaPick, itemPick);
      const all = q.report === 'analysis-all' || (q.all && q.format !== 'json');
      const runs = place ? (all ? await Promise.all(secs.map(load)) : [await load(place)]) : [];
      const head = q.format === 'json' ? null : await registerLetterhead(c);
      return { reg, secs, place, exams, runs, head };
    });
    const { reg, secs, place, exams, runs } = out;
    const sheets: Sheet[] =
      q.report === 'analysis-all'
        ? runs.length
          ? [
              gradeAnalysisAll(
                reg.name,
                runs.map((r) => ({ place: r.input.place, stats: gradeStats(r.input) })),
                exams,
              ),
            ]
          : []
        : runs.flatMap((r) =>
            q.report === 'summary'
              ? [gradeSummary(r.input)]
              : q.report === 'analysis'
                ? [gradeAnalysis(r.input)]
                : q.layout === 'student'
                  ? buildStudentWise(r.input, (st) =>
                      q.format === 'pdf' ? `${r.input.place} · ${st.name}` : r.input.place,
                    )
                  : buildGradeSheet(r.input),
          );
    const first = runs.find((r) => r.input.place === place?.code) ?? runs[0];
    if (q.format === 'json')
      return {
        register: {
          id: reg.id,
          name: reg.name,
          version: reg.version,
          status: reg.status,
          accessType: reg.access_type,
        },
        places: secs.map((x) => ({ value: x.id, label: x.code })),
        place: place?.id ?? null,
        layout: q.layout,
        report: q.report,
        exams,
        /** the filter's choices: the section's areas and items (as per mapping, before the filter) */
        areas: first?.areas ?? [],
        items: first?.items ?? [],
        chosen: { areas: q.areas ? q.areas.split('|') : null, items: q.items?.split(',') ?? null },
        sheets,
        notes: first?.notes ?? [],
        mapped: reg.access_type === 'mapping' && !(role.manage || role.assign),
      };
    if (!sheets.length)
      throw new DomainError('exams.register_empty', 'Nothing to print for the section chosen', {
        status: 409,
      });
    const label = [`Grade Register · ${reg.name}`, REPORT_LABEL[q.report]]
      .filter(Boolean)
      .join(' · ');
    const meta = {
      school: out.head?.school ?? '',
      address: out.head?.address ?? '',
      logo: await registerLogo(this.storage, out.head?.file),
      label,
      generatedOn: registerGeneratedOn(),
    };
    const stamp =
      `grade-register-${reg.name}-${q.all || q.report === 'analysis-all' ? 'all' : (place?.code ?? '')}${q.report === 'sheet' ? (q.layout === 'student' ? '-student-wise' : '') : `-${q.report}`}`
        .toLowerCase()
        .replace(/[^\w.-]+/g, '-');
    if (q.format === 'xlsx')
      return {
        filename: `${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: (await registerXlsx(sheets, meta)).toString('base64'),
      };
    return {
      filename: `${stamp}.pdf`,
      contentType: 'application/pdf',
      base64: (
        await registerPdf(sheets, meta, {
          paper: q.paper,
          orientation: q.orientation,
          fit: q.fit,
        })
      ).toString('base64'),
    };
  }

  /** One section's run: its students, its class's tree (as per mapping and the filter), the grades. */
  private async sectionRun(
    c: PoolClient,
    def: GradeRegisterDef,
    exams: GradeSheetInput['exams'],
    sec: { id: string; class_id: string; code: string; class_name: string },
    yearId: string,
    mapping: boolean,
    areaPick: Set<string> | null,
    itemPick: Set<string> | null,
  ) {
    const notes: string[] = [];
    const examIds = exams.map((e) => e.examId);
    const tree = await this.tree(c, [sec.class_id], examIds);
    const sets = await c.query<{ exam_id: string }>(
      `SELECT exam_id::text FROM exam_indicator_sets WHERE class_id = $1 AND exam_id = ANY($2::bigint[])`,
      [sec.class_id, examIds],
    );
    for (const e of exams)
      if (!sets.rows.some((x) => x.exam_id === e.examId))
        notes.push(
          `${e.label} (${e.name}) has no indicator set for ${sec.class_name}: its columns stay empty.`,
        );
    // as per mapping: the areas of the person's Indicator assignments of the section
    let mapped: Set<string> | null = null;
    if (mapping) {
      const r = await c.query<{ ids: string[] }>(
        `SELECT ta.indicator_area_ids::text[] AS ids FROM teacher_assignments ta
           JOIN employees e ON e.id = ta.employee_id AND e.user_id = app.current_user_id()
          WHERE ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL AND ta.kind = 'indicator'`,
        [sec.id, yearId],
      );
      if (!r.rows.length) {
        mapped = new Set();
        notes.push(
          'This register shows each teacher the indicator areas given to them, and no Indicator assignment of this section is yours (Academics → Teacher assignments).',
        );
      } else if (!r.rows.some((x) => !x.ids.length)) {
        const names = await c.query<{ name: string }>(
          `SELECT name FROM indicator_areas WHERE id = ANY($1::bigint[])`,
          [r.rows.flatMap((x) => x.ids)],
        );
        mapped = new Set(names.rows.map((x) => areaKey(x.name)));
        notes.push('Only the indicator areas given to you in this section are shown.');
      }
    }
    const inMap = (l: GradeLeaf) => !mapped || mapped.has(areaKey(l.area));
    const choices = arrange(tree, def, inMap);
    const areas = arrange(
      tree,
      def,
      (l) =>
        inMap(l) &&
        (!areaPick || areaPick.has(areaKey(l.area))) &&
        (!itemPick || itemPick.has(l.itemId ?? l.id)),
    );
    if (choices.length && !areas.length) notes.push('No indicator matches the filter.');
    const st = await c.query<{ id: string; name: string; adm: string; roll: number | null }>(
      `SELECT s.id::text, s.display_name AS name, s.admission_no AS adm, en.roll_no AS roll
         FROM enrolments en JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
        WHERE en.class_section_id = $1 AND en.academic_year_id = $2 AND en.status = 'active'
        ORDER BY en.roll_no NULLS LAST, s.display_name`,
      [sec.id, yearId],
    );
    const leafIds = areas.flatMap((a) => a.items.flatMap((it) => it.leaves.map((l) => l.id)));
    const g = await c.query<{ exam: string; leaf: string; student: string; grade: string }>(
      `SELECT exam_id::text AS exam, indicator_id::text AS leaf, student_id::text AS student, grade
         FROM indicator_entries
        WHERE exam_id = ANY($1::bigint[]) AND student_id = ANY($2::bigint[]) AND indicator_id = ANY($3::bigint[])
          AND grade IS NOT NULL`,
      [examIds, st.rows.map((x) => x.id), leafIds],
    );
    const grades = new Map(g.rows.map((x) => [`${x.leaf}|${x.exam}|${x.student}`, x.grade]));
    const input: GradeSheetInput = {
      place: sec.code,
      areas,
      def,
      exams,
      students: st.rows,
      grade: (leafId, examId, studentId) => grades.get(`${leafId}|${examId}|${studentId}`),
    };
    return {
      input,
      notes,
      areas: choices.map((a) => ({ key: a.key, name: a.name })),
      items: choices.flatMap((a) =>
        a.items.map((it) => ({ key: it.key, name: it.name, area: a.key })),
      ),
    };
  }
}
