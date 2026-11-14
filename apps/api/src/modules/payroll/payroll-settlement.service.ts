import { Injectable } from '@nestjs/common';
import {
  codeWages,
  gratuity,
  leaveEncashment,
  leaveEncashmentTaxFree,
  noticeShortfall,
  serviceLength,
} from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { bad, camelRow, firstOf, has, hiddenFor, must, mustBeOpenForTopUp } from './payroll-month';
import { FNF_FIXED, type FnfLine } from '../people/exits/exit-settle.service';
import type { ComputeDto } from './payroll-settlement.dto';
import { PAYROLL } from './payroll.dto';

const P = (v: string | number | null | undefined) => {
  const s = String(v ?? '0');
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
const ANY_SERVICE = ['DEATH', 'DISABLEMENT'];
/** the exit statement's lines payroll fills (codes of employee_fnf.lines) */
const STATEMENT: Record<string, { kind: 'earning' | 'deduction'; label: string }> = {
  gratuity: { kind: 'earning', label: 'Gratuity' },
  leave_encashment: { kind: 'earning', label: 'Leave encashment' },
  notice: { kind: 'deduction', label: 'Notice period shortfall' },
  advances: { kind: 'deduction', label: 'Advances and loans' },
};

/**
 * A leaver's settlement (docs/design/86, phase E step 4; PAYROLL_PEOPLE_SPEC.md §5). An accepted exit hands payroll a
 * draft; a maker works it out — gratuity by the law (eligibility, years, the cap, the tax-free part; a dismissal's
 * forfeiture only by a checker with a reason), leave encashed from the leave module's balance on the last day of the
 * types encashable on exit (each type's and the school's maximum; changed by payroll only with a reason), the notice
 * shortfall the exit noted, loans outstanding, the clearance dues and anything else payable or recoverable — and the
 * figures go to the exit's statement as payroll's lines. Another checker approves; then the items are staged for the
 * run of the month (a full-and-final run once that month's regular run is locked) and the loans closed — or, when the
 * balance is below nothing, the dues are noted for the school to collect, with a letter.
 */
@Injectable()
export class PayrollSettlementService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async row(c: PoolClient, id: string, lock = false) {
    const r = (
      await c.query<{
        id: string;
        employee_id: string;
        exit_id: string | null;
        last_day: string;
        reason: string;
        fixed_term: boolean;
        notice_days_short: string;
        status: string;
        computed_by: string | null;
        computed_mine: boolean;
        net: string;
        detail: Record<string, unknown>;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- the lock clause is one of two fixed strings
        `SELECT id::text, employee_id::text, exit_id::text, last_day::text, reason, fixed_term, notice_days_short::text, status,
                computed_by::text, (computed_by = app.current_user_id()) AS computed_mine, net::text, detail
           FROM payroll_settlements WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
    if (!r) bad('Settlement not found', 404);
    return r!;
  }

  /** A staged settlement is settled once a locked run has paid all its items. */
  private async refresh(c: PoolClient) {
    await c.query(
      `UPDATE payroll_settlements s SET status = 'SETTLED', updated_at = now()
        WHERE s.status = 'STAGED' AND NOT EXISTS (
          SELECT 1 FROM payroll_adhoc a
           WHERE a.ref_module = 'FNF' AND a.ref_id LIKE 'FNF/' || s.id || '/%' AND a.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
                              WHERE r.id = a.paid_in_record_id AND u.stage IN ('LOCKED', 'PAID')))`,
    );
  }

  async list(ctx: RequestContext, status?: string) {
    must(ctx, RUN.view, 'Only payroll staff see the settlements');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.refresh(c);
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query(
          `SELECT s.id::text, s.employee_id::text, e.employee_code AS code, e.display_name AS name, s.last_day::text, s.reason,
                  s.status, s.gratuity::text, s.encash_amount::text, s.net::text, s.exit_id::text, f.status AS statement_status
             FROM payroll_settlements s JOIN employees e ON e.id = s.employee_id
             LEFT JOIN employee_fnf f ON f.exit_id = s.exit_id
            WHERE ($1::text IS NULL OR s.status = $1) AND NOT (s.employee_id::text = ANY($2::text[]))
            ORDER BY (s.status IN ('SETTLED', 'CANCELLED')), s.last_day DESC LIMIT 300`,
          [status ?? null, hidden],
        )
      ).rows.map(camelRow);
      return { rows, can: { compute: has(ctx, RUN.manage), approve: has(ctx, RUN.approve) } };
    });
  }

  async get(ctx: RequestContext, id: string) {
    must(ctx, RUN.view, 'Only payroll staff see a settlement');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.refresh(c);
      const s = await this.row(c, id);
      if ((await hiddenFor(c, ctx)).includes(s.employee_id)) bad('Settlement not found', 404);
      const full = (
        await c.query(
          `SELECT s.*, s.id::text, s.employee_id::text, s.exit_id::text, s.last_day::text, s.pay_month::text,
                  e.employee_code AS code, e.display_name AS name, e.joined_on::text, e.designation,
                  f.status AS statement_status, cu.display_name AS computed_by_name, au.display_name AS approved_by_name
             FROM payroll_settlements s JOIN employees e ON e.id = s.employee_id
             LEFT JOIN employee_fnf f ON f.exit_id = s.exit_id
             LEFT JOIN users cu ON cu.id = s.computed_by LEFT JOIN users au ON au.id = s.approved_by
            WHERE s.id = $1`,
          [id],
        )
      ).rows[0]!;
      return {
        settlement: camelRow(full),
        can: {
          compute: has(ctx, RUN.manage) && ['DRAFT', 'COMPUTED'].includes(s.status),
          forfeit: has(ctx, RUN.approve) && ['DRAFT', 'COMPUTED'].includes(s.status),
          approve:
            has(ctx, RUN.approve) &&
            s.status === 'COMPUTED' &&
            (!s.computed_mine || has(ctx, PAYROLL.admin)),
          stage: has(ctx, RUN.approve) && s.status === 'APPROVED',
          cancel: has(ctx, RUN.approve) && ['DRAFT', 'COMPUTED', 'APPROVED'].includes(s.status),
          collect: has(ctx, RUN.approve) && s.status === 'DUES',
        },
      };
    });
  }

  /** The settlement worked out; its figures written to the exit's statement as payroll's lines. */
  async compute(ctx: RequestContext, id: string, dto: ComputeDto) {
    must(ctx, RUN.manage, 'Only payroll staff work out a settlement');
    if (dto.forfeit && Number(dto.forfeit) > 0)
      must(ctx, RUN.approve, 'Only a payroll checker forfeits gratuity');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.row(c, id, true);
      if (!['DRAFT', 'COMPUTED'].includes(s.status))
        bad(`The settlement is ${s.status.toLowerCase()}`, 409);
      if ((await hiddenFor(c, ctx)).includes(s.employee_id)) bad('Settlement not found', 404);
      const e = (
        await c.query<{ code: string; joined_on: string | null; contract: boolean }>(
          `SELECT employee_code AS code, joined_on::text, employee_type::text = 'contract' AS contract FROM employees WHERE id = $1`,
          [s.employee_id],
        )
      ).rows[0]!;
      if (!e.joined_on) bad('The employee record has no date of joining');
      const st = (
        await c.query<{
          gratuity_cap: string;
          gratuity_tax_free_cap: string;
          encash_tax_free_cap: string;
          encash_max_days: string;
        }>(
          `SELECT gratuity_cap::text, gratuity_tax_free_cap::text, encash_tax_free_cap::text, encash_max_days::text FROM payroll_settings`,
        )
      ).rows[0]!;
      // the basis: the last locked month's basic and DA (each at the full month)
      const recs = (
        await c.query<{ month: string; basis: string; pay: string }>(
          `SELECT to_char(r.month, 'YYYY-MM') AS month,
                  (SELECT COALESCE(sum(l.rate), 0) FROM payroll_record_lines l
                    WHERE l.record_id = r.id AND l.is_structure AND NOT l.is_arrear AND l.code IN ('BASIC', 'DA'))::text AS basis,
                  (SELECT COALESCE(sum(l.rate), 0) FROM payroll_record_lines l
                    WHERE l.record_id = r.id AND l.is_structure AND NOT l.is_arrear AND l.head_type = 'EARNING')::text AS pay
             FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
            WHERE r.employee_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
              AND NOT r.is_top_up
            ORDER BY r.month DESC, r.id DESC LIMIT 10`,
          [s.employee_id],
        )
      ).rows.filter((r) => P(r.basis) > 0n);
      if (!recs.length)
        bad('No locked month with basic and DA: the settlement stands on the last month paid', 409);
      const basis = P(recs[0]!.basis);
      // gratuity on the labour codes' wages once the school has switched the rule on for the last day: allowances
      // above half of the month's pay count as wages too (leave and notice stay on basic + DA)
      const codeRule =
        Number(
          (
            await c.query<{ v: string }>(
              `SELECT rate_value::text AS v FROM payroll_rates WHERE rate_code = 'LABOUR_CODE_WAGES' AND status = 'active'
                  AND effective_from <= $1::date AND (effective_to IS NULL OR effective_to >= $1::date)
                ORDER BY effective_from DESC LIMIT 1`,
              [s.last_day],
            )
          ).rows[0]?.v ?? 0,
        ) >= 1;
      const gratuityWage = codeRule ? codeWages(basis, P(recs[0]!.pay)) : basis;
      const average = recs.reduce((t, r) => t + P(r.basis), 0n) / BigInt(recs.length);
      const fixedTerm =
        dto.fixedTerm ?? (s.fixed_term || e.contract || s.reason === 'CONTRACT_END');
      // gratuity
      const g = gratuity({
        monthlyWage: gratuityWage,
        from: e.joined_on!,
        to: s.last_day,
        rule: {
          minYears: fixedTerm ? 1 : 5,
          daysPerYear: 15,
          divisor: 26,
          cap: P(st.gratuity_cap),
          taxFreeCap: P(st.gratuity_tax_free_cap),
        },
        anyService: ANY_SERVICE.includes(s.reason),
      });
      const forfeit = dto.forfeit ? P(dto.forfeit) : 0n;
      if (forfeit > 0n && s.reason !== 'DISMISSAL' && s.reason !== 'TERMINATION')
        bad('Gratuity is forfeited only on a dismissal or termination for misconduct');
      if (forfeit > g.amount) bad('More than the gratuity');
      if (forfeit > 0n && (!dto.forfeitReason || dto.forfeitReason.length < 10))
        bad('Say why it is forfeited');
      const gratuityPaid = g.amount - forfeit;
      const gratuityTaxFree = gratuityPaid < g.taxFree ? gratuityPaid : g.taxFree;
      // leave encashed on exit: the balance on the last day of the types encashable on exit
      const month = firstOf(s.last_day.slice(0, 7));
      const leave = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          max: string | null;
          available: string | null;
        }>(
          // the employee's policy of each type (as the attendance export finds it) and the latest balance by then
          `SELECT t.id::text, t.code, t.name, p.encash_on_exit_days::text AS max,
                  (SELECT CASE WHEN b.closed THEN b.closing ELSE app.staff_leave_effective_closing(b) END FROM staff_leave_balances b
                    WHERE b.employee_id = $1 AND b.leave_type_id = t.id AND b.month <= $2::date
                    ORDER BY b.month DESC LIMIT 1)::text AS available
             FROM staff_leave_types t
             JOIN LATERAL (SELECT x.* FROM staff_leave_policies x WHERE x.leave_type_id = t.id AND x.status = 'active'
                             AND app.staff_in_scope(x.scope, x.scope_values, $1) ORDER BY x.priority, x.id LIMIT 1) p ON true
            WHERE t.status = 'active' AND p.encash_on_exit
            ORDER BY t.sort_order, t.code`,
          [s.employee_id, month],
        )
      ).rows;
      const byType = leave.map((t) => {
        const avail = Math.max(0, Number(t.available ?? 0));
        const days = t.max !== null ? Math.min(avail, Number(t.max)) : avail;
        return { code: t.code, name: t.name, balance: avail, counted: days };
      });
      const fromBalance = Math.min(
        Number(st.encash_max_days),
        byType.reduce((t, x) => t + x.counted, 0),
      );
      let encashDays = fromBalance;
      if (dto.encashDays !== undefined && dto.encashDays !== null && dto.encashDays !== '') {
        encashDays = Number(dto.encashDays);
        if (!(encashDays >= 0)) bad('Leave days are a number');
        if (encashDays !== fromBalance && (!dto.encashReason || dto.encashReason.length < 3))
          bad('Say why the days differ from the leave balance');
      }
      const encash = leaveEncashment(encashDays, basis);
      const service = serviceLength(e.joined_on!, s.last_day);
      const encashTaxFree =
        s.reason === 'DEATH'
          ? encash
          : leaveEncashmentTaxFree({
              amount: encash,
              averageMonthly: average,
              leaveDays: encashDays,
              completedYears: service.years,
              cap: P(st.encash_tax_free_cap),
            });
      // the notice short, loans outstanding, the clearance dues, anything else
      const notice = noticeShortfall({
        noticeDays: Number(s.notice_days_short),
        servedDays: 0,
        monthlyWage: basis,
      });
      const loans = (
        await c.query<{ id: string; loan_type: string; balance: string }>(
          `SELECT id::text, loan_type, balance::text FROM payroll_loans WHERE employee_id = $1 AND status IN ('ACTIVE', 'HOLD') AND balance > 0`,
          [s.employee_id],
        )
      ).rows;
      const loanTotal = loans.reduce((t, l) => t + P(l.balance), 0n);
      const dues = s.exit_id
        ? P(
            (
              await c.query<{ d: string }>(
                `SELECT COALESCE(sum(dues), 0)::text AS d FROM exit_clearances WHERE exit_id = $1`,
                [s.exit_id],
              )
            ).rows[0]!.d,
          )
        : 0n;
      const otherPayable = dto.otherPayable ? P(dto.otherPayable) : 0n;
      const otherRecovery = (dto.otherRecovery ? P(dto.otherRecovery) : 0n) + dues;
      const net = gratuityPaid + encash + otherPayable - notice.amount - loanTotal - otherRecovery;
      // gratuity on death goes to the nominees by their shares
      const nominees =
        s.reason === 'DEATH' && gratuityPaid > 0n
          ? (
              await c.query<{ name: string; relation: string | null; share: string }>(
                `SELECT name, relation, share_percent::text AS share FROM payroll_nominees
                  WHERE employee_id = $1 AND purpose = 'GRATUITY' ORDER BY id`,
                [s.employee_id],
              )
            ).rows
          : [];
      let given = 0n;
      const shares = nominees.map((n, i) => {
        const amount =
          i === nominees.length - 1 ? gratuityPaid - given : (gratuityPaid * P(n.share)) / 10000n;
        given += amount;
        return { name: n.name, relation: n.relation, share: n.share, amount: S(amount) };
      });
      const detail = {
        basisMonth: recs[0]!.month,
        averageMonthly: S(average),
        service: { ...service, from: e.joined_on, to: s.last_day },
        gratuity: {
          ...g,
          wage: S(gratuityWage),
          labourCode: codeRule,
          amount: S(g.amount),
          taxFree: S(g.taxFree),
          taxable: S(g.taxable),
          fixedTerm,
        },
        leave: {
          byType,
          fromBalance,
          days: encashDays,
          adjusted: encashDays !== fromBalance,
          reason: dto.encashReason ?? null,
        },
        notice: { days: notice.days },
        loans: loans.map((l) => ({ id: l.id, type: l.loan_type, balance: l.balance })),
        clearanceDues: S(dues),
        nominees: shares,
      };
      await c.query(
        `UPDATE payroll_settlements SET status = 'COMPUTED', fixed_term = $2, basis = $3, gratuity = $4, gratuity_tax_free = $5,
                gratuity_forfeited = $6, forfeit_reason = $7, encash_days = $8, encash_amount = $9, encash_tax_free = $10,
                encash_adjust_reason = $11, notice_amount = $12, loans = $13, other_payable = $14, other_recovery = $15, net = $16,
                detail = $17::jsonb, computed_by = app.current_user_id(), computed_at = now(), updated_at = now()
          WHERE id = $1`,
        [
          id,
          fixedTerm,
          S(basis),
          S(gratuityPaid),
          S(gratuityTaxFree),
          S(forfeit),
          forfeit > 0n ? dto.forfeitReason : null,
          String(encashDays),
          S(encash),
          S(encashTaxFree),
          encashDays !== fromBalance ? dto.encashReason : null,
          S(notice.amount),
          S(loanTotal),
          S(otherPayable),
          S(otherRecovery),
          S(net),
          JSON.stringify(detail),
        ],
      );
      const statement = s.exit_id
        ? await this.toStatement(
            c,
            s.exit_id,
            {
              gratuity: gratuityPaid,
              leave_encashment: encash,
              notice: notice.amount,
              advances: loanTotal,
            },
            {
              gratuity: `${String(g.years)} year(s)${forfeit > 0n ? `, Rs. ${S(forfeit)} forfeited` : ''}`,
              leave_encashment: `${String(encashDays)} day(s)`,
              notice: notice.days ? `${String(notice.days)} day(s) short` : null,
              advances: loans.length ? `${String(loans.length)} loan(s)` : null,
            },
          )
        : null;
      await this.audit.stage(ctx, c, {
        action: 'payroll.settlement.compute',
        entityType: 'payroll_settlements',
        entityId: id,
        after: { gratuity: S(gratuityPaid), encash: S(encash), net: S(net), forfeit: S(forfeit) },
      });
      return {
        net: S(net),
        gratuity: S(gratuityPaid),
        encash: S(encash),
        notice: S(notice.amount),
        loans: S(loanTotal),
        statement,
        message:
          statement === 'locked'
            ? 'Worked out. The exit statement is already sent for approval: send it back to take these figures.'
            : 'Worked out, and the figures are on the exit statement.',
      };
    });
  }

  /**
   * Payroll's lines on the exit's statement, in the statement's own places (marked as payroll's: its form keeps them as
   * they are). Made with the statement's lines when accounts has not opened it yet. `release` gives the lines back to
   * the statement, at nothing, when the settlement is cancelled. A statement already sent for approval is not changed.
   */
  private async toStatement(
    c: PoolClient,
    exitId: string,
    amounts: Record<string, bigint> | null,
    notes: Record<string, string | null> = {},
  ): Promise<'updated' | 'locked'> {
    const f = (
      await c.query<{ status: string; lines: FnfLine[] }>(
        `SELECT status, lines FROM employee_fnf WHERE exit_id = $1 FOR UPDATE`,
        [exitId],
      )
    ).rows[0];
    if (f && f.status !== 'draft') return 'locked';
    let lines: FnfLine[] = f?.lines ?? [
      ...FNF_FIXED.map((x) => ({ ...x, amount: 0, note: null })),
      ...(
        await c.query<{ department: string; name: string; dues: string; note: string | null }>(
          `SELECT department, name, dues::text, note FROM exit_clearances WHERE exit_id = $1 AND dues > 0 ORDER BY sort_order, name`,
          [exitId],
        )
      ).rows.map((d) => ({
        kind: 'deduction' as const,
        code: `dues_${d.department}`,
        label: `Dues: ${d.name}`,
        amount: Number(d.dues),
        note: d.note,
        fromClearance: true,
      })),
    ];
    for (const [code, x] of Object.entries(STATEMENT))
      if (!lines.some((l) => l.code === code))
        lines.push({ kind: x.kind, code, label: x.label, amount: 0, note: null });
    lines = lines.map((l) => {
      if (!(l.code in STATEMENT)) return l;
      if (!amounts)
        return l.fromPayroll
          ? { kind: l.kind, code: l.code, label: l.label, amount: 0, note: null }
          : l;
      return {
        ...l,
        amount: Number(S(amounts[l.code] ?? 0n)),
        note: notes[l.code] ?? null,
        fromPayroll: true,
      };
    });
    const sum = (k: string) =>
      lines.filter((l) => l.kind === k).reduce((t, l) => t + Number(l.amount || 0), 0);
    const earnings = Math.round(sum('earning') * 100) / 100;
    const deductions = Math.round(sum('deduction') * 100) / 100;
    const args = [
      exitId,
      JSON.stringify(lines),
      earnings,
      deductions,
      Math.round((earnings - deductions) * 100) / 100,
    ];
    if (f)
      await c.query(
        `UPDATE employee_fnf SET lines = $2::jsonb, earnings = $3, deductions = $4, net = $5, updated_at = now(),
                updated_by = app.current_user_id() WHERE exit_id = $1`,
        args,
      );
    else
      await c.query(
        `INSERT INTO employee_fnf (school_id, exit_id, lines, earnings, deductions, net, prepared_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::jsonb, $3, $4, $5, app.current_user_id(), app.current_user_id())`,
        args,
      );
    return 'updated';
  }

  async approve(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker approves a settlement');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.row(c, id, true);
      if (s.status !== 'COMPUTED') bad('Only a worked-out settlement is approved', 409);
      if (s.computed_mine && !has(ctx, PAYROLL.admin))
        bad('You worked it out: another checker approves it', 403);
      await c.query(
        `UPDATE payroll_settlements SET status = 'APPROVED', approved_by = app.current_user_id(), approved_at = now(), updated_at = now()
          WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.settlement.approve',
        entityType: 'payroll_settlements',
        entityId: id,
        ...(s.computed_mine ? { after: { selfApproved: true } } : {}),
      });
      return { ok: true };
    });
  }

  /**
   * Paid through payroll: the items as one-off lines of the month (the last day's month while its regular run is open,
   * else the first open month — a full-and-final run pays them), the loans closed. Below nothing: the dues noted for
   * the school to collect, with a numbered letter; nothing staged.
   */
  async stage(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker sends a settlement to be paid');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.row(c, id, true);
      if (s.status !== 'APPROVED') bad('Only an approved settlement is paid', 409);
      const f = (
        await c.query<{
          gratuity: string;
          gratuity_tax_free: string;
          encash_amount: string;
          encash_tax_free: string;
          notice_amount: string;
          loans: string;
          other_payable: string;
          other_recovery: string;
          net: string;
          detail: { loans?: Array<{ id: string }> };
        }>(
          `SELECT gratuity::text, gratuity_tax_free::text, encash_amount::text, encash_tax_free::text, notice_amount::text, loans::text,
                  other_payable::text, other_recovery::text, net::text, detail FROM payroll_settlements WHERE id = $1`,
          [id],
        )
      ).rows[0]!;
      const loanIds = (f.detail.loans ?? []).map((l) => l.id);
      // the loans end here: recovered in the settlement, or carried into the dues
      const closeLoans = async (why: string) => {
        if (loanIds.length)
          await c.query(
            `UPDATE payroll_loans SET status = 'CLOSED', balance = 0,
                    remarks = left(concat_ws(E'\\n', remarks, $2::text), 1000), updated_by = app.current_user_id(), updated_at = now()
              WHERE id = ANY($1::bigint[]) AND status <> 'CLOSED'`,
            [loanIds, `CLOSED: ${why} (settlement ${id})`],
          );
      };
      if (P(f.net) < 0n) {
        const year = new Date().getFullYear();
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('payroll.dues.' || $1))`, [
          String(year),
        ]);
        const n = (
          await c.query<{ n: number }>(
            `SELECT count(*)::int + 1 AS n FROM payroll_settlements WHERE dues_letter_no LIKE $1`,
            [`DUES/${String(year)}/%`],
          )
        ).rows[0]!.n;
        const no = `DUES/${String(year)}/${String(n).padStart(4, '0')}`;
        await closeLoans('carried into the dues');
        await c.query(
          `UPDATE payroll_settlements SET status = 'DUES', dues_letter_no = $2, staged_by = app.current_user_id(), staged_at = now(),
                  updated_at = now() WHERE id = $1`,
          [id, no],
        );
        await this.audit.stage(ctx, c, {
          action: 'payroll.settlement.dues',
          entityType: 'payroll_settlements',
          entityId: id,
          after: { dues: S(-P(f.net)), letter: no },
        });
        return {
          status: 'DUES',
          letterNo: no,
          message: `₹${S(-P(f.net))} is due from the employee: letter ${no}.`,
        };
      }
      // the month that pays: the last day's month while its regular run is open, else the first open month
      const lastMonth = s.last_day.slice(0, 7);
      const locked = (
        await c.query<{ m: string | null }>(
          `SELECT to_char(max(month), 'YYYY-MM') AS m FROM payroll_runs
            WHERE run_type = 'REGULAR' AND stage IN ('LOCKED', 'PAID') AND deleted_at IS NULL`,
        )
      ).rows[0]?.m;
      const payMonth = locked && locked >= lastMonth ? locked : lastMonth;
      await mustBeOpenForTopUp(c, payMonth, 'the settlement');
      const heads = Object.fromEntries(
        (
          await c.query<{ code: string; id: string }>(
            `SELECT code, id::text FROM payroll_pay_heads WHERE code IN ('GRAT_EX', 'GRAT_TX', 'ENCASH_EX', 'ENCASH_TX', 'NOTICE_REC', 'FNF_REC', 'OTH_ARR')`,
          )
        ).rows.map((r) => [r.code, r.id]),
      );
      if (Object.keys(heads).length < 7)
        bad('The settlement heads are missing (open Payroll set-up once)', 409);
      const items: Array<[string, bigint]> = [
        ['GRAT_EX', P(f.gratuity_tax_free)],
        ['GRAT_TX', P(f.gratuity) - P(f.gratuity_tax_free)],
        ['ENCASH_EX', P(f.encash_tax_free)],
        ['ENCASH_TX', P(f.encash_amount) - P(f.encash_tax_free)],
        // anything else payable: taxable salary, on the school's own other-arrears head
        ['OTH_ARR', P(f.other_payable)],
        ['NOTICE_REC', P(f.notice_amount)],
        ['FNF_REC', P(f.loans) + P(f.other_recovery)],
      ];
      let staged = 0;
      for (const [code, amount] of items) {
        if (amount <= 0n) continue;
        await c.query(
          `INSERT INTO payroll_adhoc (school_id, employee_id, month, pay_head_id, amount, remarks, ref_module, ref_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5, 'FNF', $6, app.current_user_id(), app.current_user_id())`,
          [
            s.employee_id,
            firstOf(payMonth),
            heads[code],
            S(amount),
            `Full and final settlement ${id}`,
            `FNF/${id}/${code}`,
          ],
        );
        staged += 1;
      }
      await closeLoans('recovered in the full and final settlement');
      await c.query(
        `UPDATE payroll_settlements SET status = 'STAGED', pay_month = $2::date, staged_by = app.current_user_id(), staged_at = now(),
                updated_at = now() WHERE id = $1`,
        [id, firstOf(payMonth)],
      );
      const regularOpen = !(locked && locked >= lastMonth);
      await this.audit.stage(ctx, c, {
        action: 'payroll.settlement.stage',
        entityType: 'payroll_settlements',
        entityId: id,
        after: { payMonth, items: staged },
      });
      return {
        status: 'STAGED',
        payMonth,
        message: regularOpen
          ? `${String(staged)} item(s) go in ${payMonth}'s regular run.`
          : `${String(staged)} item(s) staged for ${payMonth}: make the full-and-final run.`,
        needsRun: !regularOpen,
      };
    });
  }

  /** The full-and-final run for a staged settlement whose month's regular run is already locked. */
  async run(ctx: RequestContext, id: string) {
    must(ctx, RUN.manage, 'Only payroll staff make a full-and-final run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.row(c, id);
      if (s.status !== 'STAGED') bad('Only a staged settlement has a full-and-final run', 409);
      const pm = (
        await c.query<{ m: string }>(
          `SELECT to_char(pay_month, 'YYYY-MM') AS m FROM payroll_settlements WHERE id = $1`,
          [id],
        )
      ).rows[0]!.m;
      const regular = (
        await c.query<{ stage: string }>(
          `SELECT stage FROM payroll_runs WHERE month = $1::date AND run_type = 'REGULAR' AND deleted_at IS NULL`,
          [firstOf(pm)],
        )
      ).rows[0];
      if (!regular || !['LOCKED', 'PAID'].includes(regular.stage))
        bad(`${pm}'s regular run pays it: no separate run is needed`, 409);
      const seq = (
        await c.query<{ n: number }>(
          `SELECT COALESCE(max(seq), 0)::int + 1 AS n FROM payroll_runs WHERE month = $1::date AND run_type = 'SUPPLEMENTARY'`,
          [firstOf(pm)],
        )
      ).rows[0]!.n;
      const runId = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_runs (school_id, month, run_type, seq, employee_ids, stage, remark, purpose, created_by, updated_by)
           VALUES (app.current_school_id(), $1::date, 'SUPPLEMENTARY', $2, ARRAY[$3]::bigint[], 'DRAFT', $4, 'FNF',
                   app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [firstOf(pm), seq, s.employee_id, `Full and final settlement ${id}`],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO payroll_run_events (school_id, run_id, action, stage_from, stage_to, comment, created_by)
         VALUES (app.current_school_id(), $1, 'create', NULL, 'DRAFT', $2, app.current_user_id())`,
        [runId, `Full and final settlement ${id}`],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.settlement.run',
        entityType: 'payroll_runs',
        entityId: runId,
        after: { settlement: id },
      });
      return { runId };
    });
  }

  async collected(ctx: RequestContext, id: string, reference: string) {
    must(ctx, RUN.approve, 'Only a payroll checker records the dues collected');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.row(c, id, true);
      if (s.status !== 'DUES') bad('Only dues are collected', 409);
      await c.query(
        `UPDATE payroll_settlements SET status = 'SETTLED', detail = detail || jsonb_build_object('collected', $2::text, 'collectedOn', now()::date::text),
                updated_at = now() WHERE id = $1`,
        [id, reference],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.settlement.collected',
        entityType: 'payroll_settlements',
        entityId: id,
        after: { reference },
      });
      return { ok: true };
    });
  }

  async cancel(ctx: RequestContext, id: string, reason: string) {
    must(ctx, RUN.approve, 'Only a payroll checker cancels a settlement');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.row(c, id, true);
      if (!['DRAFT', 'COMPUTED', 'APPROVED'].includes(s.status))
        bad(`A ${s.status.toLowerCase()} settlement stays`, 409);
      await c.query(
        `UPDATE payroll_settlements SET status = 'CANCELLED', cancel_reason = $2, cancelled_by = app.current_user_id(),
                cancelled_at = now(), updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      if (s.exit_id) await this.toStatement(c, s.exit_id, null);
      await this.audit.stage(ctx, c, {
        action: 'payroll.settlement.cancel',
        entityType: 'payroll_settlements',
        entityId: id,
        after: { reason },
      });
      return { ok: true };
    });
  }
}
