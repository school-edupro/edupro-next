import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import {
  calcOrder,
  compile,
  decToScaled,
  evaluate,
  paiseToString,
  passVars,
  roundHead,
  type Rounding,
} from '@edupro/payroll-engine';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  approveDated,
  DATED,
  deleteDraft,
  endDated,
  loadDated,
  mustOwnDraft,
} from './payroll-dated';
import { istToday, PayrollSetupService } from './payroll-setup.service';
import {
  PAYROLL,
  type EndRowDto,
  type FormulaCheckDto,
  type FormulaTestDto,
  type HeadDto,
  type HeadUpdateDto,
  type MatrixCellDto,
  type MatrixQueryDto,
  type VersionDto,
} from './payroll.dto';

const bad = (message: string, status = 400): never => {
  throw new DomainError(status === 409 ? 'conflict' : 'validation-failed', message, { status });
};
const has = PayrollSetupService.has;
const must = PayrollSetupService.must;

interface VersionRow {
  id: string;
  calc_type: string;
  formula: string | null;
  depends_on: string | null;
  is_taxable: boolean;
  pf_wage: boolean;
  esi_wage: boolean;
  pt_wage: boolean;
  prorate_on_lop: boolean;
  rounding: Rounding;
  effective_from: string;
  effective_to: string | null;
  status: string;
  reference_no: string | null;
  change_reason: string | null;
  created_by: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
}

/**
 * Pay heads (identity), their dated versions with slabs and saved formula tests, the formula check and
 * "Try it" (the engine itself), and the pay matrix (docs/design/86, phase A).
 */
@Injectable()
export class PayrollHeadsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- the list and one head ------------------------------------------------------------------------------
  async heads(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT h.id::text, h.code, h.name, h.head_type, h.category, h.print_order, h.show_if_zero, h.status,
                  (SELECT count(*)::int FROM payroll_pay_head_versions v WHERE v.pay_head_id = h.id) AS versions,
                  (SELECT count(*)::int FROM payroll_pay_head_versions v WHERE v.pay_head_id = h.id AND v.status = 'draft') AS drafts,
                  live.calc_type, live.formula, live.rounding, live.effective_from::text AS live_from,
                  live.pf_wage, live.esi_wage, live.pt_wage, live.is_taxable, live.prorate_on_lop
             FROM payroll_pay_heads h
             LEFT JOIN LATERAL (
               SELECT v.* FROM payroll_pay_head_versions v
                WHERE v.pay_head_id = h.id AND v.status = 'active' AND v.effective_from <= $1::date
                  AND (v.effective_to IS NULL OR v.effective_to >= $1::date)
                ORDER BY v.effective_from DESC LIMIT 1) live ON true
            ORDER BY h.head_type DESC, h.print_order, h.code`,
          [istToday()],
        )
      ).rows;
      return { heads: rows.map(camelRow), can: PayrollSetupService.can(ctx) };
    });
  }

  async head(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, code, name, head_type, category, print_order, show_if_zero, status FROM payroll_pay_heads
            WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!head) throw new DomainError('not-found', 'Pay head not found', { status: 404 });
      const versions = (await this.versions(c, id)).map((v) => ({
        ...camelRow(v as unknown as Record<string, unknown>),
        mine: v.created_by === requireTenant(ctx).userId,
      }));
      const slabs = (
        await c.query<Record<string, unknown>>(
          `SELECT s.version_id::text, s.basis, s.range_from, s.range_to, s.flat_amount, s.percent, s.seq
             FROM payroll_pay_head_slabs s JOIN payroll_pay_head_versions v ON v.id = s.version_id
            WHERE v.pay_head_id = $1 ORDER BY s.version_id, s.seq`,
          [id],
        )
      ).rows.map(camelRow);
      const tests = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, name, inputs, expected, last_result, last_status FROM payroll_formula_tests
            WHERE pay_head_id = $1 ORDER BY name`,
          [id],
        )
      ).rows.map(camelRow);
      return { head: camelRow(head), versions, slabs, tests, can: PayrollSetupService.can(ctx) };
    });
  }

  private async versions(c: PoolClient, headId: string) {
    return (
      await c.query<VersionRow>(
        `SELECT v.id::text, v.calc_type, v.formula, v.depends_on, v.is_taxable, v.pf_wage, v.esi_wage, v.pt_wage,
                v.prorate_on_lop, v.rounding, v.effective_from::text, v.effective_to::text, v.status, v.reference_no,
                v.change_reason, v.created_by::text,
                (SELECT display_name FROM users u WHERE u.id = v.created_by) AS created_by_name,
                (SELECT display_name FROM users u WHERE u.id = v.approved_by) AS approved_by_name
           FROM payroll_pay_head_versions v WHERE v.pay_head_id = $1 ORDER BY v.effective_from DESC`,
        [headId],
      )
    ).rows;
  }

  // ---- making heads and versions --------------------------------------------------------------------------
  async addHead(ctx: RequestContext, dto: HeadDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers add pay heads');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      if ((await c.query(`SELECT 1 FROM payroll_pay_heads WHERE code = $1`, [dto.code])).rowCount)
        bad(`A pay head ${dto.code} is already there`, 409);
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_pay_heads (school_id, code, name, head_type, category, print_order, show_if_zero,
                                          created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [dto.code, dto.name, dto.headType, dto.category, dto.printOrder, dto.showIfZero],
        )
      ).rows[0]!.id;
      const versionId = await this.writeVersion(c, id, dto.headType, dto.version, null);
      await this.audit.stage(ctx, c, {
        action: 'payroll.head.add',
        entityType: 'payroll_pay_heads',
        entityId: id,
        after: { ...dto },
      });
      return { id, versionId };
    });
  }

  async updateHead(ctx: RequestContext, id: string, dto: HeadUpdateDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers change pay heads');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = (
        await c.query(`SELECT * FROM payroll_pay_heads WHERE id = $1 FOR UPDATE`, [id])
      ).rows[0];
      if (!before) throw new DomainError('not-found', 'Pay head not found', { status: 404 });
      await c.query(
        `UPDATE payroll_pay_heads SET name = $2, category = $3, print_order = $4, status = $5,
                updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id, dto.name, dto.category, dto.printOrder, dto.status],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.head.update',
        entityType: 'payroll_pay_heads',
        entityId: id,
        before,
        after: { ...dto },
      });
      return { saved: true };
    });
  }

  /** A new DRAFT version; its saved tests must pass. */
  async addVersion(ctx: RequestContext, headId: string, dto: VersionDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers draft pay-head versions');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = await this.headRow(c, headId);
      const versionId = await this.writeVersion(c, headId, head.head_type, dto, null);
      await this.audit.stage(ctx, c, {
        action: 'payroll.head_version.draft',
        entityType: 'payroll_pay_head_versions',
        entityId: versionId,
        after: { ...dto },
      });
      return { id: versionId, status: 'draft' };
    });
  }

  async editVersion(ctx: RequestContext, versionId: string, dto: VersionDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers change pay-head versions');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await loadDated(c, DATED.versions!, versionId);
      mustOwnDraft(row, requireTenant(ctx).userId!, has(ctx, PAYROLL.approve));
      const head = await this.headRow(c, String(row.pay_head_id));
      await this.writeVersion(c, head.id, head.head_type, dto, versionId);
      await this.audit.stage(ctx, c, {
        action: 'payroll.head_version.draft_edit',
        entityType: 'payroll_pay_head_versions',
        entityId: versionId,
        before: row,
        after: { ...dto },
      });
      return { id: versionId, status: 'draft' };
    });
  }

  async deleteVersion(ctx: RequestContext, versionId: string) {
    must(ctx, PAYROLL.manage, 'Only payroll makers delete pay-head drafts');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await deleteDraft(
        c,
        DATED.versions!,
        versionId,
        requireTenant(ctx).userId!,
        has(ctx, PAYROLL.approve),
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.head_version.draft_delete',
        entityType: 'payroll_pay_head_versions',
        entityId: versionId,
      });
      return { deleted: true };
    });
  }

  async approveVersion(ctx: RequestContext, versionId: string) {
    must(ctx, PAYROLL.approve, 'Only a payroll checker approves a pay-head version');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await loadDated(c, DATED.versions!, versionId);
      // the saved tests are run again: a head never goes live failing its own tests
      const failing = await this.runTests(c, String(row.pay_head_id), versionId);
      if (failing.length) bad(`The version fails its saved test(s): ${failing.join(', ')}`, 409);
      const r = await approveDated(
        c,
        DATED.versions!,
        versionId,
        requireTenant(ctx).userId!,
        has(ctx, PAYROLL.admin),
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.head_version.approve',
        entityType: 'payroll_pay_head_versions',
        entityId: versionId,
        after: r,
      });
      return {
        approved: true,
        message: r.closed
          ? `Approved. The previous version now ends on ${r.closedTo!}.`
          : 'Approved.',
      };
    });
  }

  async endVersion(ctx: RequestContext, versionId: string, dto: EndRowDto) {
    must(ctx, PAYROLL.approve, 'Only a payroll checker ends a pay-head version');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await endDated(c, DATED.versions!, versionId, dto.effectiveTo);
      await this.audit.stage(ctx, c, {
        action: 'payroll.head_version.end',
        entityType: 'payroll_pay_head_versions',
        entityId: versionId,
        after: { ...dto },
      });
      return { ended: true };
    });
  }

  private async headRow(c: PoolClient, id: string) {
    const head = (
      await c.query<{ id: string; code: string; head_type: 'EARNING' | 'DEDUCTION' }>(
        `SELECT id::text, code, head_type FROM payroll_pay_heads WHERE id = $1`,
        [id],
      )
    ).rows[0];
    if (!head) throw new DomainError('not-found', 'Pay head not found', { status: 404 });
    return head;
  }

  /**
   * Checks and writes a version (new, or a draft changed): the formula compiles for its pass (an earning
   * cannot use what is known only after gross), its heads exist, no dependency cycle among the heads of its
   * kind, the slabs; then the saved tests run against it — a failing one refuses the save.
   */
  private async writeVersion(
    c: PoolClient,
    headId: string,
    headType: 'EARNING' | 'DEDUCTION',
    dto: VersionDto,
    versionId: string | null,
  ) {
    const formula = dto.calcType === 'FORMULA' ? (dto.formula ?? '').trim() : null;
    if (formula) {
      const compiled = compile(formula, headType === 'EARNING' ? 1 : 2);
      if (!compiled.ok) bad(compiled.errors[0]!);
      const codes = new Set(
        (await c.query<{ code: string }>(`SELECT code FROM payroll_pay_heads`)).rows.map(
          (r) => r.code,
        ),
      );
      const unknown = compiled.headsUsed.filter((h) => !codes.has(h) && !h.endsWith('_BASE'));
      if (unknown.length) bad(`The formula uses head(s) that do not exist: ${unknown.join(', ')}`);
    }
    const dependsOn = (dto.dependsOn ?? '').trim() || null;
    await this.mustNotCycle(c, headId, headType, dto.calcType, formula, dependsOn);
    const values = [
      dto.calcType,
      formula,
      dependsOn,
      dto.isTaxable,
      dto.pfWage,
      dto.esiWage,
      dto.ptWage,
      dto.prorateOnLop,
      dto.rounding,
      dto.effectiveFrom,
      dto.referenceNo || null,
      dto.changeReason || null,
    ];
    let id = versionId;
    try {
      if (id)
        await c.query(
          `UPDATE payroll_pay_head_versions SET calc_type = $2, formula = $3, depends_on = $4, is_taxable = $5,
                  pf_wage = $6, esi_wage = $7, pt_wage = $8, prorate_on_lop = $9, rounding = $10, effective_from = $11,
                  reference_no = $12, change_reason = $13, updated_by = app.current_user_id(), updated_at = now()
            WHERE id = $1`,
          [id, ...values],
        );
      else
        id = (
          await c.query<{ id: string }>(
            `INSERT INTO payroll_pay_head_versions (school_id, pay_head_id, calc_type, formula, depends_on, is_taxable,
                     pf_wage, esi_wage, pt_wage, prorate_on_lop, rounding, effective_from, reference_no, change_reason,
                     status, created_by, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft',
                     app.current_user_id(), app.current_user_id())
             RETURNING id::text`,
            [headId, ...values],
          )
        ).rows[0]!.id;
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        bad(
          'A version of this head already starts on that date: pick another date or change that one',
          409,
        );
      throw e;
    }
    await c.query(`DELETE FROM payroll_pay_head_slabs WHERE version_id = $1`, [id]);
    for (const [i, s] of (dto.calcType === 'SLAB' ? dto.slabs : []).entries())
      await c.query(
        `INSERT INTO payroll_pay_head_slabs (school_id, version_id, basis, range_from, range_to, flat_amount, percent, seq)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          s.basis,
          s.rangeFrom,
          s.rangeTo ?? null,
          s.flatAmount ?? null,
          s.percent ?? null,
          i + 1,
        ],
      );
    const failing = await this.runTests(c, headId, id!);
    if (failing.length)
      bad(
        `The version fails its saved test(s): ${failing.join(', ')} — fix the formula or the test`,
        409,
      );
    return id!;
  }

  /** The heads of one kind, with this version in place, must have an order (no head waiting on itself). */
  private async mustNotCycle(
    c: PoolClient,
    headId: string,
    headType: string,
    calcType: string,
    formula: string | null,
    dependsOn: string | null,
  ) {
    const others = (
      await c.query<{
        id: string;
        code: string;
        calc_type: string;
        formula: string | null;
        depends_on: string | null;
      }>(
        `SELECT h.id::text, h.code, v.calc_type, v.formula, v.depends_on FROM payroll_pay_heads h
           JOIN LATERAL (SELECT * FROM payroll_pay_head_versions v WHERE v.pay_head_id = h.id AND v.status <> 'ended'
                          ORDER BY v.effective_from DESC LIMIT 1) v ON true
          WHERE h.head_type = $1 AND h.status = 'active'`,
        [headType],
      )
    ).rows;
    const mine = (
      await c.query<{ code: string }>(`SELECT code FROM payroll_pay_heads WHERE id = $1`, [headId])
    ).rows[0]!.code;
    const heads = [
      ...others
        .filter((o) => o.id !== headId)
        .map((o) => ({
          code: o.code,
          calcType: o.calc_type,
          formula: o.formula,
          dependsOn: o.depends_on,
        })),
      { code: mine, calcType, formula, dependsOn },
    ];
    const order = calcOrder(heads, headType === 'EARNING' ? 'earning' : 'deduction');
    if (!order.ok) bad(`${order.error} ${mine} would wait on a head that waits on it.`, 409);
  }

  /** Runs a head's saved tests against a version; records each result; returns the names that fail. */
  private async runTests(c: PoolClient, headId: string, versionId: string): Promise<string[]> {
    const v = (
      await c.query<{ calc_type: string; formula: string | null; rounding: Rounding }>(
        `SELECT calc_type, formula, rounding FROM payroll_pay_head_versions WHERE id = $1`,
        [versionId],
      )
    ).rows[0]!;
    if (v.calc_type !== 'FORMULA' || !v.formula) return [];
    const tests = (
      await c.query<{ id: string; name: string; inputs: Record<string, string>; expected: string }>(
        `SELECT id::text, name, inputs, expected::text FROM payroll_formula_tests WHERE pay_head_id = $1`,
        [headId],
      )
    ).rows;
    const failing: string[] = [];
    for (const t of tests) {
      const r = tryFormula(v.formula, t.inputs, v.rounding);
      const pass = r.ok && r.value === Number(t.expected).toFixed(2);
      if (!pass) failing.push(t.name);
      await c.query(
        `UPDATE payroll_formula_tests SET last_result = $2, last_status = $3 WHERE id = $1`,
        [t.id, r.ok ? r.value : null, pass ? 'pass' : 'fail'],
      );
    }
    return failing;
  }

  // ---- the formula: check and try ---------------------------------------------------------------------------
  /**
   * Checks a formula as it is typed: compile errors, and the heads and names it uses that the school does not
   * have; with inputs, its value (rounded as the head would be, when a rounding is given).
   */
  async checkFormula(ctx: RequestContext, dto: FormulaCheckDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const compiled = compile(dto.formula, dto.pass);
      const heads = new Set(
        (await c.query<{ code: string }>(`SELECT code FROM payroll_pay_heads`)).rows.map(
          (r) => r.code,
        ),
      );
      const rates = new Set(
        (
          await c.query<{ code: string }>(
            `SELECT DISTINCT rate_code AS code FROM payroll_rates WHERE status <> 'ended'`,
          )
        ).rows.map((r) => r.code),
      );
      const attrs = new Set(
        (
          await c.query<{ code: string }>(
            `SELECT a->>'code' AS code FROM payroll_settings, jsonb_array_elements(formula_attributes) a`,
          )
        ).rows.map((r) => r.code),
      );
      const system = new Set([...passVars(2), 'PAY_LEVEL']);
      const warnings: string[] = [];
      for (const h of compiled.headsUsed)
        if (!heads.has(h) && !h.endsWith('_BASE')) warnings.push(`[${h}] is not a pay head`);
      for (const v of compiled.varsUsed)
        if (!system.has(v) && !rates.has(v) && !attrs.has(v))
          warnings.push(
            `${v} is not a rate in the registry, a formula attribute or a system variable`,
          );
      const result = dto.inputs && compiled.ok ? tryFormula(dto.formula, dto.inputs, null) : null;
      return {
        ok: compiled.ok,
        errors: compiled.errors,
        headsUsed: compiled.headsUsed,
        varsUsed: compiled.varsUsed,
        warnings,
        result,
        names: {
          heads: [...heads].sort(),
          rates: [...rates].sort(),
          attributes: [...attrs].sort(),
          system: [...system],
        },
      };
    });
  }

  async addTest(ctx: RequestContext, headId: string, dto: FormulaTestDto) {
    must(ctx, PAYROLL.manage, 'Only payroll makers save formula tests');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.headRow(c, headId);
      try {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO payroll_formula_tests (school_id, pay_head_id, name, inputs, expected, created_by, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, app.current_user_id(), app.current_user_id())
             RETURNING id::text`,
            [headId, dto.name, JSON.stringify(dto.inputs), dto.expected],
          )
        ).rows[0]!.id;
        await this.audit.stage(ctx, c, {
          action: 'payroll.formula_test.add',
          entityType: 'payroll_formula_tests',
          entityId: id,
          after: { ...dto },
        });
        return { id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          bad('A test of that name is already there', 409);
        throw e;
      }
    });
  }

  async deleteTest(ctx: RequestContext, testId: string) {
    must(ctx, PAYROLL.manage, 'Only payroll makers delete formula tests');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM payroll_formula_tests WHERE id = $1`, [testId]);
      if (!r.rowCount) throw new DomainError('not-found', 'Test not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'payroll.formula_test.delete',
        entityType: 'payroll_formula_tests',
        entityId: testId,
      });
      return { deleted: true };
    });
  }

  /** Runs the head's tests against the version given (its newest draft, else the one in force). */
  async runHeadTests(ctx: RequestContext, headId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const versions = await this.versions(c, headId);
      const target =
        versions.find((v) => v.status === 'draft') ?? versions.find((v) => v.status === 'active');
      if (!target) return { failing: [], version: null };
      return { failing: await this.runTests(c, headId, target.id), version: target.id };
    });
  }

  // ---- the pay matrix -------------------------------------------------------------------------------------
  async matrix(ctx: RequestContext, q: MatrixQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PayrollSetupService.seed(c);
      const active = (
        await c.query<{ matrix_code: string }>(`SELECT matrix_code FROM payroll_settings`)
      ).rows[0]!.matrix_code;
      const code = q.code ?? active;
      const codes = (
        await c.query<{ code: string }>(
          `SELECT DISTINCT matrix_code AS code FROM payroll_pay_matrix ORDER BY 1`,
        )
      ).rows.map((r) => r.code);
      const cells = (
        await c.query<{
          pay_level: string;
          level_order: number;
          cell_no: number;
          basic: string;
          effective_from: string;
          used: number;
        }>(
          `SELECT m.pay_level, m.level_order, m.cell_no, m.basic::text, m.effective_from::text,
                  (SELECT count(*)::int FROM payroll_profiles p WHERE p.pay_level = m.pay_level AND p.pay_cell = m.cell_no
                      AND $1 = (SELECT matrix_code FROM payroll_settings)) AS used
             FROM payroll_pay_matrix m WHERE m.matrix_code = $1 ORDER BY m.level_order, m.cell_no`,
          [code],
        )
      ).rows;
      const levels: Array<{
        level: string;
        order: number;
        cells: Array<{ cell: number; basic: string; effectiveFrom: string; used: number }>;
      }> = [];
      for (const x of cells) {
        let l = levels.find((y) => y.level === x.pay_level);
        if (!l) levels.push((l = { level: x.pay_level, order: x.level_order, cells: [] }));
        l.cells.push({
          cell: x.cell_no,
          basic: x.basic,
          effectiveFrom: x.effective_from,
          used: x.used,
        });
      }
      return { code, active, codes, levels, can: PayrollSetupService.can(ctx) };
    });
  }

  /** Adds or corrects a cell (a checker: the pay matrix is never changed by one person alone). */
  async saveCell(ctx: RequestContext, dto: MatrixCellDto) {
    must(ctx, PAYROLL.approve, 'Only a payroll checker changes the pay matrix');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = (
        await c.query(
          `SELECT * FROM payroll_pay_matrix WHERE matrix_code = $1 AND pay_level = $2 AND cell_no = $3`,
          [dto.matrixCode, dto.payLevel, dto.cellNo],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO payroll_pay_matrix (school_id, matrix_code, pay_level, level_order, cell_no, basic, effective_from,
                                         created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(), app.current_user_id())
         ON CONFLICT (school_id, matrix_code, pay_level, cell_no) DO UPDATE
           SET basic = EXCLUDED.basic, level_order = EXCLUDED.level_order, effective_from = EXCLUDED.effective_from,
               updated_by = app.current_user_id(), updated_at = now()`,
        [dto.matrixCode, dto.payLevel, dto.levelOrder, dto.cellNo, dto.basic, dto.effectiveFrom],
      );
      await this.audit.stage(ctx, c, {
        action: before ? 'payroll.matrix.correct' : 'payroll.matrix.add',
        entityType: 'payroll_pay_matrix',
        entityId: `${dto.matrixCode}/${dto.payLevel}/${String(dto.cellNo)}`,
        before,
        after: { ...dto },
      });
      return { saved: true };
    });
  }

  /** Removes a cell, or a whole level (no cell given); refused while a profile uses it. */
  async deleteCell(
    ctx: RequestContext,
    matrixCode: string,
    payLevel: string,
    cellNo: number | null,
  ) {
    must(ctx, PAYROLL.approve, 'Only a payroll checker changes the pay matrix');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const used = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_profiles p
            WHERE p.pay_level = $2 AND ($3::int IS NULL OR p.pay_cell = $3) AND $1 = (SELECT matrix_code FROM payroll_settings)`,
          [matrixCode, payLevel, cellNo],
        )
      ).rows[0]!.n;
      if (used)
        bad(
          `${String(used)} payroll profile(s) are on ${cellNo ? `level ${payLevel}, cell ${String(cellNo)}` : `level ${payLevel}`}: move them first`,
          409,
        );
      const r = await c.query(
        `DELETE FROM payroll_pay_matrix WHERE matrix_code = $1 AND pay_level = $2 AND ($3::int IS NULL OR cell_no = $3)`,
        [matrixCode, payLevel, cellNo],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'No such cell', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'payroll.matrix.delete',
        entityType: 'payroll_pay_matrix',
        entityId: `${matrixCode}/${payLevel}/${cellNo === null ? '*' : String(cellNo)}`,
      });
      return { deleted: r.rowCount };
    });
  }
}

/**
 * A formula with given values (rupees and rates as decimal strings — head codes and names alike), rounded as
 * the head would be when a rounding is given. The value is in rupees ('30160.00').
 */
export function tryFormula(
  formula: string,
  inputs: Record<string, string>,
  rounding: Rounding | null,
): { ok: true; value: string } | { ok: false; errors: string[] } {
  const bag: Record<string, bigint> = {};
  for (const [k, v] of Object.entries(inputs)) {
    const micro = decToScaled(String(v), 6);
    if (micro === null) return { ok: false, errors: [`${k}: '${String(v)}' is not a number`] };
    bag[k.toUpperCase()] = micro;
  }
  const r = evaluate(compile(formula), bag, bag);
  if (!r.ok) return { ok: false, errors: r.errors };
  return { ok: true, value: paiseToString(rounding ? roundHead(r.paise, rounding) : r.paise) };
}

function camelRow(r: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase()),
      v,
    ]),
  );
}
