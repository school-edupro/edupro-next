import { Injectable } from '@nestjs/common';
import { calculate, compile, type CalcInput } from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { loadEmployee, monthContext, type MonthContext } from './payroll-calc-input';
import { approveDated, DATED } from './payroll-dated';
import { RUN } from './payroll-inputs.dto';
import { bad, camelRow, firstOf, has, hiddenFor, monthWords, must } from './payroll-month';
import { istToday } from './payroll-setup.service';
import { PAYROLL } from './payroll.dto';

const P = (v: string | null | undefined) => {
  const s = v ?? '0';
  const neg = s.startsWith('-');
  const [r, p = ''] = s.replace('-', '').split('.');
  const abs = BigInt(r || '0') * 100n + BigInt((p + '00').slice(0, 2));
  return neg ? -abs : abs;
};
const S = (p: bigint) => {
  const neg = p < 0n;
  const s = (neg ? -p : p).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
};
const addMonths = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

type Override = (input: CalcInput, employeeId: string) => void;
interface ArrearItem {
  employeeId: string;
  code: string;
  month: string;
  headId: string;
  paid: bigint;
  due: bigint;
  arrear: bigint;
  pf: boolean;
  taxable: boolean;
}

/**
 * Revisions and increments (docs/design/86, phase E step 3; PAYROLL_PEOPLE_SPEC.md §2–4). A revision — a registry rate
 * (DA) or a head's formula — is drafted by a maker and applied by another checker: each locked regular month from its
 * date is worked out again through the engine with the change (every head built on it follows, overtime with the
 * hours paid) and the difference, less what earlier revisions already gave, becomes arrears paid by the next run;
 * from the first open month the new rate or formula is in force. The yearly increment: on each employee's increment
 * month, once a year, after the minimum service, the next cell of their pay-matrix level (a % off the matrix),
 * proposed by a maker, applied by another checker — the new basic in force from the month, the profile's cell moved,
 * a numbered revision letter each.
 */
@Injectable()
export class PayrollRevisionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- the arithmetic -------------------------------------------------------------------------------------------
  /** The locked regular months from a month on, each with its records (non-failed, not top-ups). */
  private async lockedRecords(c: PoolClient, fromMonth: string, employeeIds?: string[]) {
    return (
      await c.query<{ record_id: string; employee_id: string; month: string }>(
        `SELECT r.id::text AS record_id, r.employee_id::text, to_char(r.month, 'YYYY-MM') AS month
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE u.run_type = 'REGULAR' AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL
            AND r.status <> 'FAILED' AND NOT r.is_top_up AND r.month >= $1::date
            AND ($2::text[] IS NULL OR r.employee_id::text = ANY($2::text[]))
          ORDER BY r.month, r.employee_id`,
        [firstOf(fromMonth), employeeIds ?? null],
      )
    ).rows;
  }

  /** Each head's arrear for the locked months, from working each month again with the change. */
  private async arrears(
    c: PoolClient,
    fromMonth: string,
    override: Override,
    employeeIds?: string[],
  ) {
    const recs = await this.lockedRecords(c, fromMonth, employeeIds);
    const months = new Map<string, MonthContext>();
    const items: ArrearItem[] = [];
    const skipped: string[] = [];
    for (const rec of recs) {
      if (!months.has(rec.month)) months.set(rec.month, await monthContext(c, rec.month));
      const m = months.get(rec.month)!;
      const l = await loadEmployee(c, m, rec.employee_id, { topUp: null, needAttendance: true });
      if (!l.ok) {
        skipped.push(`${l.snapshot.code} ${rec.month}: ${l.reason}`);
        continue;
      }
      const input = structuredClone(l.input);
      override(input, rec.employee_id);
      const out = calculate({ ...input, tax: { ...input.tax, manual: null } });
      if (!out.ok) {
        skipped.push(`${l.snapshot.code} ${rec.month}: ${out.reason}`);
        continue;
      }
      const due = new Map<string, bigint>();
      for (const line of out.lines)
        if (line.headType === 'EARNING' && line.isStructure && !line.isArrear)
          due.set(line.code, (due.get(line.code) ?? 0n) + line.earned);
      const paidRows = (
        await c.query<{ code: string; amount: string }>(
          `SELECT code, sum(amount)::text AS amount FROM payroll_record_lines
            WHERE record_id = $1 AND head_type = 'EARNING' AND is_structure AND NOT is_arrear GROUP BY code`,
          [rec.record_id],
        )
      ).rows;
      const paid = new Map(paidRows.map((r) => [r.code, P(r.amount)]));
      // what earlier revisions already gave for the month
      const earlier = (
        await c.query<{ code: string; amount: string }>(
          `SELECT h.code, sum(a.amount)::text AS amount FROM payroll_arrears a JOIN payroll_pay_heads h ON h.id = a.pay_head_id
            WHERE a.employee_id = $1 AND a.period_month = $2::date AND a.source = 'REVISION' AND a.cancelled_at IS NULL
            GROUP BY h.code`,
          [rec.employee_id, firstOf(rec.month)],
        )
      ).rows;
      for (const e of earlier) paid.set(e.code, (paid.get(e.code) ?? 0n) + P(e.amount));
      for (const code of new Set([...due.keys(), ...paid.keys()])) {
        const d = due.get(code) ?? 0n;
        const p = paid.get(code) ?? 0n;
        const head = m.heads[code];
        if (d === p || !head?.version) continue;
        items.push({
          employeeId: rec.employee_id,
          code,
          month: rec.month,
          headId: head.id,
          paid: p,
          due: d,
          arrear: d - p,
          pf: head.version.pfWage,
          taxable: head.version.isTaxable,
        });
      }
    }
    return { items, records: recs.length, skipped };
  }

  private overrideOf(rev: { kind: string; detail: Record<string, unknown> }): Override {
    if (rev.kind === 'RATE') {
      const code = String(rev.detail.rateCode);
      const value = String(rev.detail.newValue);
      return (input) => {
        input.rates = { ...input.rates, [code]: { value, id: 'revision' } };
      };
    }
    if (rev.kind === 'FORMULA') {
      const code = String(rev.detail.headCode);
      const formula = String(rev.detail.formula);
      return (input) => {
        const h = input.heads[code];
        if (h?.version)
          input.heads = {
            ...input.heads,
            [code]: { ...h, version: { ...h.version, calcType: 'FORMULA', formula } },
          };
      };
    }
    const rows = (rev.detail.employees ?? []) as Array<{ employeeId: string; to: string }>;
    const basic = new Map(rows.map((r) => [r.employeeId, P(r.to)]));
    return (input, employeeId) => {
      const b = basic.get(employeeId);
      if (b !== undefined)
        input.structure = input.structure.map((s) =>
          s.code === 'BASIC' ? { ...s, amount: b } : s,
        );
    };
  }

  /** The first month no locked run covers: the new rate starts there (or at the revision's own month, if later). */
  private async firstOpenMonth(c: PoolClient, effective: string) {
    const last = (
      await c.query<{ m: string | null }>(
        `SELECT to_char(max(month), 'YYYY-MM') AS m FROM payroll_runs WHERE stage IN ('LOCKED', 'PAID') AND deleted_at IS NULL`,
      )
    ).rows[0]?.m;
    const open = last ? addMonths(last, 1) : istToday().slice(0, 7);
    return open > effective ? open : effective;
  }

  // ---- revisions ------------------------------------------------------------------------------------------------
  async list(ctx: RequestContext) {
    must(ctx, RUN.view, 'Only payroll staff see the revisions');
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      rows: (
        await c.query(
          `SELECT r.id::text, r.kind, r.detail, r.effective_from::text, r.notified_on::text, r.reason, r.status,
                  r.arrears_total::text, r.arrears_count, r.created_at, cu.display_name AS created_by_name,
                  r.applied_at, au.display_name AS applied_by_name, (r.created_by = app.current_user_id()) AS mine
             FROM payroll_revisions r LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users au ON au.id = r.applied_by
            ORDER BY r.created_at DESC LIMIT 100`,
        )
      ).rows.map(camelRow),
      can: { manage: has(ctx, RUN.manage), apply: has(ctx, RUN.approve) },
    }));
  }

  async create(
    ctx: RequestContext,
    dto: {
      kind: 'RATE' | 'FORMULA';
      rateCode?: string;
      newValue?: string;
      headCode?: string;
      formula?: string;
      effectiveFrom: string;
      notifiedOn?: string | null;
      reason: string;
    },
  ) {
    must(ctx, RUN.manage, 'Only a payroll maker drafts a revision');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let detail: Record<string, unknown>;
      if (dto.kind === 'RATE') {
        const known = (
          await c.query(
            `SELECT 1 FROM payroll_rates WHERE rate_code = $1 AND status = 'active' LIMIT 1`,
            [dto.rateCode],
          )
        ).rowCount;
        if (!known) bad(`No rate ${dto.rateCode ?? ''} is in force`);
        if (!/^\d{1,6}(\.\d{1,6})?$/.test(dto.newValue ?? ''))
          bad('The new value is a number (0.60 for 60 %)');
        detail = { rateCode: dto.rateCode, newValue: dto.newValue };
      } else {
        const head = (
          await c.query(
            `SELECT 1 FROM payroll_pay_heads WHERE code = $1 AND head_type = 'EARNING'`,
            [dto.headCode],
          )
        ).rowCount;
        if (!head) bad(`No earning head ${dto.headCode ?? ''}`);
        const compiled = compile(dto.formula ?? '', 1);
        if (!compiled.ok) bad(`The formula does not work: ${compiled.errors.join('; ')}`);
        detail = { headCode: dto.headCode, formula: dto.formula };
      }
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_revisions (school_id, kind, detail, effective_from, notified_on, reason, created_by)
           VALUES (app.current_school_id(), $1, $2::jsonb, $3::date, $4::date, $5, app.current_user_id()) RETURNING id::text`,
          [dto.kind, JSON.stringify(detail), dto.effectiveFrom, dto.notifiedOn ?? null, dto.reason],
        )
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'payroll.revision.draft',
        entityType: 'payroll_revisions',
        entityId: id,
        after: { ...dto },
      });
      return { id };
    });
  }

  private async revision(c: PoolClient, id: string, lock = false) {
    const r = (
      await c.query<{
        id: string;
        kind: string;
        detail: Record<string, unknown>;
        effective_from: string;
        status: string;
        created_by: string | null;
        mine: boolean;
        reason: string;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the lock clause is one of two fixed strings
        `SELECT id::text, kind, detail, effective_from::text, status, created_by::text, (created_by = app.current_user_id()) AS mine,
                reason FROM payroll_revisions WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
    if (!r) bad('Revision not found', 404);
    return r!;
  }

  /** What applying would give: each employee's arrears by head and month (nothing written). */
  async simulate(ctx: RequestContext, id: string) {
    must(ctx, RUN.view, 'Only payroll staff see a revision');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rev = await this.revision(c, id);
      const from = rev.effective_from.slice(0, 7);
      const ids =
        rev.kind === 'INCREMENT'
          ? ((rev.detail.employees ?? []) as Array<{ employeeId: string }>).map((e) => e.employeeId)
          : undefined;
      const a = await this.arrears(c, from, this.overrideOf(rev), ids);
      const hidden = new Set(await hiddenFor(c, ctx));
      const who = new Map(
        (
          await c.query<{ id: string; code: string; name: string }>(
            `SELECT id::text, employee_code AS code, display_name AS name FROM employees WHERE id = ANY($1::bigint[])`,
            [[...new Set(a.items.map((x) => x.employeeId))]],
          )
        ).rows.map((r) => [r.id, r]),
      );
      return {
        revision: camelRow(rev),
        firstOpenMonth: await this.firstOpenMonth(c, from),
        records: a.records,
        employees: new Set(a.items.map((x) => x.employeeId)).size,
        total: S(a.items.reduce((s, x) => s + x.arrear, 0n)),
        items: a.items
          .filter((x) => !hidden.has(x.employeeId))
          .map((x) => ({
            code: who.get(x.employeeId)?.code ?? x.employeeId,
            name: who.get(x.employeeId)?.name ?? '',
            head: x.code,
            month: x.month,
            paid: S(x.paid),
            due: S(x.due),
            arrear: S(x.arrear),
          })),
        skipped: a.skipped,
      };
    });
  }

  /** A checker who did not draft it applies it: arrears for the locked months, the change in force from the first open one. */
  async apply(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker applies a revision');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rev = await this.revision(c, id, true);
      if (rev.status !== 'DRAFT') bad(`The revision is ${rev.status.toLowerCase()}`, 409);
      if (rev.mine && !has(ctx, PAYROLL.admin))
        bad('You drafted it: another checker applies it', 403);
      const from = rev.effective_from.slice(0, 7);
      const open = await this.firstOpenMonth(c, from);
      const me = (await c.query<{ id: string }>(`SELECT app.current_user_id()::text AS id`))
        .rows[0]!.id;
      const isAdmin = has(ctx, PAYROLL.admin);
      let employees: Array<{
        employeeId: string;
        from: string;
        to: string;
        level: string | null;
        cellFrom: number | null;
        cellTo: number | null;
      }> = [];
      if (rev.kind === 'INCREMENT') {
        employees = (rev.detail.employees ?? []) as typeof employees;
        if (!employees.length) bad('Nobody in this increment', 409);
      }
      const a = await this.arrears(
        c,
        from,
        this.overrideOf(rev),
        rev.kind === 'INCREMENT' ? employees.map((e) => e.employeeId) : undefined,
      );
      for (const x of a.items)
        await c.query(
          `INSERT INTO payroll_arrears (school_id, employee_id, pay_head_id, period_month, amount, pf_applicable, taxable, source,
                                        source_id, revision_id, created_by)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, 'REVISION', $7, $7, app.current_user_id())`,
          [x.employeeId, x.headId, firstOf(x.month), S(x.arrear), x.pf, x.taxable, id],
        );
      // the change in force from the first open month (drafted in the maker's name, approved by the checker)
      if (rev.kind === 'RATE') {
        // a second revision of the rate in the same first open month changes that month's row
        const same = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM payroll_rates WHERE rate_code = $1 AND status = 'active' AND effective_from = $2::date`,
            [rev.detail.rateCode, firstOf(open)],
          )
        ).rows[0];
        if (same)
          await c.query(
            `UPDATE payroll_rates SET rate_value = $2, change_reason = $3, updated_by = app.current_user_id(), updated_at = now()
              WHERE id = $1`,
            [same.id, rev.detail.newValue, `Revision ${id}`],
          );
        else {
          const rid = (
            await c.query<{ id: string }>(
              `INSERT INTO payroll_rates (school_id, rate_code, rate_value, notified_on, source, effective_from, status, change_reason, created_by)
               VALUES (app.current_school_id(), $1, $2, $3::date, 'school', $4::date, 'draft', $5, $6) RETURNING id::text`,
              [
                rev.detail.rateCode,
                rev.detail.newValue,
                rev.effective_from,
                firstOf(open),
                `Revision ${id}`,
                rev.created_by,
              ],
            )
          ).rows[0]!.id;
          await approveDated(c, DATED.rates!, rid, me, isAdmin);
        }
      } else if (rev.kind === 'FORMULA') {
        const cur = (
          await c.query<{
            pay_head_id: string;
            depends_on: string | null;
            is_taxable: boolean;
            pf_wage: boolean;
            esi_wage: boolean;
            pt_wage: boolean;
            prorate_on_lop: boolean;
            rounding: string;
          }>(
            `SELECT h.id::text AS pay_head_id, v.depends_on, v.is_taxable, v.pf_wage, v.esi_wage, v.pt_wage, v.prorate_on_lop, v.rounding
               FROM payroll_pay_heads h JOIN payroll_pay_head_versions v ON v.pay_head_id = h.id
              WHERE h.code = $1 AND v.status = 'active' AND v.effective_from <= $2::date
              ORDER BY v.effective_from DESC LIMIT 1`,
            [rev.detail.headCode, firstOf(open)],
          )
        ).rows[0];
        if (!cur) bad('The head has no version in force', 409);
        const vid = (
          await c.query<{ id: string }>(
            `INSERT INTO payroll_pay_head_versions (school_id, pay_head_id, calc_type, formula, depends_on, is_taxable, pf_wage, esi_wage,
                                                    pt_wage, prorate_on_lop, rounding, effective_from, status, change_reason, created_by)
             VALUES (app.current_school_id(), $1, 'FORMULA', $2, $3, $4, $5, $6, $7, $8, $9, $10::date, 'draft', $11, $12) RETURNING id::text`,
            [
              cur!.pay_head_id,
              rev.detail.formula,
              cur!.depends_on,
              cur!.is_taxable,
              cur!.pf_wage,
              cur!.esi_wage,
              cur!.pt_wage,
              cur!.prorate_on_lop,
              cur!.rounding,
              firstOf(open),
              `Revision ${id}`,
              rev.created_by,
            ],
          )
        ).rows[0]!.id;
        await approveDated(c, DATED.versions!, vid, me, isAdmin);
      } else {
        // the increment: the new basic from the month, the profile's cell, a numbered letter each
        const month = rev.effective_from;
        const basicHead = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM payroll_pay_heads WHERE code = 'BASIC'`,
          )
        ).rows[0]!.id;
        for (const e of employees) {
          const before = await this.payOf(c, e.employeeId, month);
          const sid = (
            await c.query<{ id: string }>(
              `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, revision_id, effective_from, status,
                                               change_reason, created_by, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, 'draft', $6, $7, $7) RETURNING id::text`,
              [
                e.employeeId,
                basicHead,
                e.to,
                id,
                month,
                `Yearly increment (revision ${id})`,
                rev.created_by,
              ],
            )
          ).rows[0]!.id;
          await approveDated(c, DATED.structures!, sid, me, isAdmin);
          await c.query(
            `INSERT INTO payroll_profiles (employee_id, school_id, pay_cell, last_increment_on)
             VALUES ($1, app.current_school_id(), $2, $3::date)
             ON CONFLICT (employee_id) DO UPDATE SET pay_cell = COALESCE(EXCLUDED.pay_cell, payroll_profiles.pay_cell),
               last_increment_on = EXCLUDED.last_increment_on`,
            [e.employeeId, e.cellTo, month],
          );
          await this.letter(c, id, e.employeeId, month, before, {
            ...before,
            BASIC: e.to,
            level: e.level,
            cell: e.cellTo,
          });
        }
      }
      const total = a.items.reduce((s, x) => s + x.arrear, 0n);
      await c.query(
        `UPDATE payroll_revisions SET status = 'APPLIED', applied_by = app.current_user_id(), applied_at = now(),
                arrears_total = $2, arrears_count = $3 WHERE id = $1`,
        [id, S(total), a.items.length],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.revision.apply',
        entityType: 'payroll_revisions',
        entityId: id,
        after: {
          arrears: a.items.length,
          total: S(total),
          firstOpenMonth: open,
          increments: employees.length,
          ...(rev.mine ? { selfApproved: true } : {}),
        },
      });
      return {
        arrears: a.items.length,
        total: S(total),
        firstOpenMonth: open,
        message:
          `Applied: ${String(a.items.length)} arrear line(s), ₹${S(total)}, paid by the next run` +
          (rev.kind === 'INCREMENT'
            ? `; ${String(employees.length)} increment(s) in force from ${monthWords(rev.effective_from.slice(0, 7))}, each with its letter.`
            : `; in force from ${monthWords(open)}.`),
      };
    });
  }

  async cancel(ctx: RequestContext, id: string) {
    must(ctx, RUN.manage, 'Only payroll staff cancel a draft revision');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rev = await this.revision(c, id, true);
      if (rev.status !== 'DRAFT') bad('Only a draft is cancelled', 409);
      await c.query(
        `UPDATE payroll_revisions SET status = 'CANCELLED', cancelled_by = app.current_user_id(), cancelled_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.revision.cancel',
        entityType: 'payroll_revisions',
        entityId: id,
      });
      return { ok: true };
    });
  }

  // ---- increments ---------------------------------------------------------------------------------------------
  private async payOf(c: PoolClient, employeeId: string, day: string) {
    const rows = (
      await c.query<{ code: string; amount: string }>(
        `SELECT DISTINCT ON (s.pay_head_id) h.code, s.amount::text FROM payroll_structures s JOIN payroll_pay_heads h ON h.id = s.pay_head_id
          WHERE s.employee_id = $1 AND s.status = 'active' AND s.effective_from <= $2::date
            AND (s.effective_to IS NULL OR s.effective_to >= $2::date)
          ORDER BY s.pay_head_id, s.effective_from DESC`,
        [employeeId, day],
      )
    ).rows;
    return Object.fromEntries(rows.map((r) => [r.code, r.amount])) as Record<
      string,
      string | number | null
    >;
  }

  /** Who is due an increment in a month, and to what: the next cell of their level, or the % off the matrix. */
  async due(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff see the increments');
    return this.db.tenant(requireTenant(ctx), async (c) => this.dueIn(c, ctx, month));
  }

  private async dueIn(c: PoolClient, ctx: RequestContext, month: string) {
    const st = (
      await c.query<{
        increment_month: number;
        increment_min_months: number;
        increment_pct: string;
        matrix_code: string;
      }>(
        `SELECT increment_month, increment_min_months, increment_pct::text, matrix_code FROM payroll_settings`,
      )
    ).rows[0]!;
    const start = firstOf(month);
    const hidden = new Set(await hiddenFor(c, ctx));
    const rows = (
      await c.query<{
        id: string;
        code: string;
        name: string;
        joined_on: string | null;
        left_on: string | null;
        inc_month: number | null;
        last_inc: string | null;
        level: string | null;
        cell: number | null;
        basic: string | null;
      }>(
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.joined_on::text, e.left_on::text,
                p.increment_month AS inc_month, p.last_increment_on::text AS last_inc, p.pay_level AS level, p.pay_cell AS cell,
                (SELECT s.amount::text FROM payroll_structures s JOIN payroll_pay_heads h ON h.id = s.pay_head_id
                  WHERE s.employee_id = e.id AND h.code = 'BASIC' AND s.status = 'active' AND s.effective_from <= $1::date
                    AND (s.effective_to IS NULL OR s.effective_to >= $1::date)
                  ORDER BY s.effective_from DESC LIMIT 1) AS basic
           FROM employees e LEFT JOIN payroll_profiles p ON p.employee_id = e.id
          WHERE e.deleted_at IS NULL AND (e.left_on IS NULL OR e.left_on >= $1::date)
          ORDER BY e.display_name`,
        [start],
      )
    ).rows;
    const cells = (
      await c.query<{ level: string; cell: number; basic: string }>(
        `SELECT pay_level AS level, cell_no AS cell, basic::text FROM payroll_pay_matrix WHERE matrix_code = $1`,
        [st.matrix_code],
      )
    ).rows;
    const cellOf = (level: string, cell: number) =>
      cells.find((x) => x.level === level && x.cell === cell);
    const m = Number(month.slice(5, 7));
    const minJoin = new Date(
      Date.UTC(Number(month.slice(0, 4)), m - 1 - st.increment_min_months, 1),
    )
      .toISOString()
      .slice(0, 10);
    const yearAgo = new Date(Date.UTC(Number(month.slice(0, 4)), m - 1 - 11, 1))
      .toISOString()
      .slice(0, 10);
    const out = rows
      .filter(
        (r) => !hidden.has(r.id) && r.basic !== null && (r.inc_month ?? st.increment_month) === m,
      )
      .map((r) => {
        let status = 'DUE';
        let note: string | null = null;
        let to: string | null = null;
        let cellTo: number | null = null;
        if (r.joined_on && r.joined_on > minJoin) {
          status = 'NOT_DUE';
          note = `joined ${r.joined_on}: under ${String(st.increment_min_months)} months by then`;
        } else if (r.last_inc && r.last_inc >= yearAgo) {
          status = 'NOT_DUE';
          note = `last increment ${r.last_inc}: once a year`;
        } else if (r.level && r.cell) {
          const next = cellOf(r.level, r.cell + 1);
          if (next) {
            to = next.basic;
            cellTo = r.cell + 1;
          } else {
            status = 'TOP';
            note = `at the top of level ${r.level}`;
          }
        } else {
          const raw = Number(r.basic) * (1 + Number(st.increment_pct) / 100);
          to = (Math.ceil(raw / 100) * 100).toFixed(2);
          note = `${st.increment_pct} % (not on the pay matrix)`;
        }
        return {
          employeeId: r.id,
          code: r.code,
          name: r.name,
          joinedOn: r.joined_on,
          lastIncrement: r.last_inc,
          level: r.level,
          cellFrom: r.cell,
          cellTo,
          from: r.basic,
          to,
          status,
          note,
        };
      });
    return {
      month,
      rule: {
        month: st.increment_month,
        minMonths: st.increment_min_months,
        pct: st.increment_pct,
        matrix: st.matrix_code,
      },
      rows: out,
      can: { propose: has(ctx, RUN.manage), apply: has(ctx, RUN.approve) },
    };
  }

  /** A maker proposes the month's increments for the staff ticked (those due): another checker applies them. */
  async propose(ctx: RequestContext, month: string, employeeIds: string[], reason: string) {
    must(ctx, RUN.manage, 'Only a payroll maker proposes increments');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const due = await this.dueIn(c, ctx, month);
      const pick = due.rows.filter((r) => employeeIds.includes(r.employeeId));
      if (pick.length !== new Set(employeeIds).size)
        bad('Someone ticked is not in the month’s list');
      const notDue = pick.filter((r) => r.status !== 'DUE');
      if (notDue.length)
        bad(`Not due: ${notDue.map((r) => `${r.code} (${r.note ?? ''})`).join(', ')}`, 409);
      const employees = pick.map((r) => ({
        employeeId: r.employeeId,
        from: r.from,
        to: r.to,
        level: r.level,
        cellFrom: r.cellFrom,
        cellTo: r.cellTo,
      }));
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_revisions (school_id, kind, detail, effective_from, reason, created_by)
           VALUES (app.current_school_id(), 'INCREMENT', $1::jsonb, $2::date, $3, app.current_user_id()) RETURNING id::text`,
          [JSON.stringify({ month, employees }), firstOf(month), reason],
        )
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'payroll.increment.propose',
        entityType: 'payroll_revisions',
        entityId: id,
        after: { month, count: employees.length },
      });
      return { id, count: employees.length };
    });
  }

  // ---- letters --------------------------------------------------------------------------------------------------
  private async letter(
    c: PoolClient,
    revisionId: string,
    employeeId: string,
    from: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    const year = from.slice(0, 4);
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('payroll.letter.' || $1))`, [year]);
    const n = (
      await c.query<{ n: number }>(
        `SELECT count(*)::int + 1 AS n FROM payroll_revision_letters WHERE letter_no LIKE $1`,
        [`PR/${year}/%`],
      )
    ).rows[0]!.n;
    await c.query(
      `INSERT INTO payroll_revision_letters (school_id, revision_id, employee_id, letter_no, before, after, effective_from, issued_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5::jsonb, $6::date, app.current_user_id())
       ON CONFLICT (revision_id, employee_id) DO NOTHING`,
      [
        revisionId,
        employeeId,
        `PR/${year}/${String(n).padStart(4, '0')}`,
        JSON.stringify(before),
        JSON.stringify(after),
        from,
      ],
    );
  }

  async letters(ctx: RequestContext, revisionId: string) {
    must(ctx, RUN.view, 'Only payroll staff see the letters');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      return {
        rows: (
          await c.query(
            `SELECT l.id::text, l.letter_no, l.employee_id::text, e.employee_code AS code, e.display_name AS name, l.before, l.after,
                    l.effective_from::text, l.issued_at
               FROM payroll_revision_letters l JOIN employees e ON e.id = l.employee_id
              WHERE l.revision_id = $1 AND NOT (l.employee_id::text = ANY($2::text[])) ORDER BY l.letter_no`,
            [revisionId, hidden],
          )
        ).rows.map(camelRow),
      };
    });
  }
}
