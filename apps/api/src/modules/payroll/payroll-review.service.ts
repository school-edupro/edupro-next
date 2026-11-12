import { Injectable } from '@nestjs/common';
import { calculate, divHalfUp, paiseToString, toPaise } from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { loadEmployee, monthContext } from './payroll-calc-input';
import { Month, RUN } from './payroll-inputs.dto';
import { bad, camelRow, firstOf, has, hiddenFor, monthWords, must, runCan } from './payroll-month';
import { PAYROLL } from './payroll.dto';

const Id = z.string().regex(/^\d{1,18}$/);
const Days = z
  .string()
  .trim()
  .regex(/^-?\d{1,2}(\.\d{1,2})?$/, 'days, + to give back, − to charge');
export const LopPreviewSchema = z.object({ employeeId: Id, sourceMonth: Month, days: Days });
export class LopPreviewDto extends createZodDto(LopPreviewSchema) {}
export const LopSchema = LopPreviewSchema.extend({ reason: z.string().trim().min(3).max(200) });
export class LopDto extends createZodDto(LopSchema) {}
export const LopListSchema = z.object({
  status: z.enum(['all', 'DRAFT', 'APPROVED', 'CANCELLED']).default('DRAFT'),
});
export class LopListDto extends createZodDto(LopListSchema) {}
export const CancelSchema = z.object({ reason: z.string().trim().min(3).max(200) });
export class CancelDto extends createZodDto(CancelSchema) {}
export const ReconcileSchema = z.object({ employeeId: Id, month: Month });
export class ReconcileDto extends createZodDto(ReconcileSchema) {}

const P = (v: string | null | undefined) => toPaise(String(v ?? '0')) ?? 0n;
const S = paiseToString;

/**
 * Review tools (docs/design/86, phase B step 4): loss-of-pay reversal — days of a locked month given back or
 * charged, valued from its frozen record, paid as arrears — and salary reconciliation: one employee's month worked
 * out again as a dry run beside what was paid (it saves nothing; the legacy wrote the tax and ESI rows).
 */
@Injectable()
export class PayrollReviewService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** The record a month was paid by and what a day of it is worth: PF part and the rest. */
  private async valuation(c: PoolClient, dto: LopPreviewDto) {
    const rec = (
      await c.query<{ id: string; month_days: string; lop_days: string; paid_days: string }>(
        `SELECT r.id::text, r.month_days::text, r.lop_days::text, r.paid_days::text FROM payroll_records r
           JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.employee_id = $1 AND r.month = $2::date AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL
            AND r.status <> 'FAILED' AND NOT r.is_top_up
          ORDER BY r.id DESC LIMIT 1`,
        [dto.employeeId, firstOf(dto.sourceMonth)],
      )
    ).rows[0];
    if (!rec)
      bad(
        `${monthWords(dto.sourceMonth)} has no locked salary for this employee: a month is corrected once it is locked`,
        409,
      );
    const heads = (await monthContext(c, dto.sourceMonth)).heads;
    const lines = (
      await c.query<{ code: string; rate: string }>(
        `SELECT code, rate::text FROM payroll_record_lines
          WHERE record_id = $1 AND head_type = 'EARNING' AND is_structure AND NOT is_arrear`,
        [rec!.id],
      )
    ).rows;
    const monthH = BigInt(Math.round(Number(rec!.month_days) * 100));
    let pfDay = 0n;
    let otherDay = 0n;
    for (const l of lines) {
      const v = heads[l.code]?.version;
      if (!v?.prorateOnLop) continue;
      const day = monthH > 0n ? divHalfUp(P(l.rate) * 100n, monthH) : 0n;
      if (v.pfWage) pfDay += day;
      else otherDay += day;
    }
    const days = Number(dto.days);
    if (days > Number(rec!.lop_days))
      bad(
        `At most ${rec!.lop_days} day(s) can be given back: the loss of pay of ${monthWords(dto.sourceMonth)}`,
      );
    if (days < 0 && -days > Number(rec!.paid_days))
      bad(`At most ${rec!.paid_days} day(s) can be charged: the days paid that month`);
    const dh = BigInt(Math.round(days * 100));
    return {
      record: rec!,
      pfDay,
      otherDay,
      amountPf: divHalfUp(pfDay * dh, 100n),
      amountOther: divHalfUp(otherDay * dh, 100n),
    };
  }

  async lopPreview(ctx: RequestContext, dto: LopPreviewDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await hiddenFor(c, ctx)).includes(dto.employeeId)) bad('Not found', 404);
      const v = await this.valuation(c, dto);
      return {
        sourceMonth: dto.sourceMonth,
        monthDays: v.record.month_days,
        lopDays: v.record.lop_days,
        perDay: { pf: S(v.pfDay), other: S(v.otherDay) },
        amountPf: S(v.amountPf),
        amountOther: S(v.amountOther),
        total: S(v.amountPf + v.amountOther),
      };
    });
  }

  async lopList(ctx: RequestContext, q: LopListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT l.id::text, l.employee_id::text, e.employee_code AS code, e.display_name AS name,
                  to_char(l.source_month, 'YYYY-MM') AS source_month, l.days::text, l.amount_pf::text, l.amount_other::text,
                  l.reason, l.status, l.cancelled_reason, l.created_at, u.display_name AS by_name, a.display_name AS approved_by_name,
                  (l.created_by = app.current_user_id()) AS mine,
                  (SELECT bool_or(x.paid_in_record_id IS NOT NULL) FROM payroll_arrears x
                    WHERE x.id IN (l.arrear_pf_id, l.arrear_other_id)) AS paid
             FROM payroll_lop_reversals l JOIN employees e ON e.id = l.employee_id
             LEFT JOIN users u ON u.id = l.created_by LEFT JOIN users a ON a.id = l.approved_by
            WHERE ($1 = 'all' OR l.status = $1) AND NOT (l.employee_id::text = ANY($2::text[]))
            ORDER BY l.created_at DESC`,
          [q.status, hidden],
        )
      ).rows.map(camelRow);
      return { rows, can: runCan(ctx) };
    });
  }

  async lopAdd(ctx: RequestContext, dto: LopDto) {
    must(ctx, RUN.manage, 'Only payroll makers stage a loss-of-pay reversal');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await hiddenFor(c, ctx)).includes(dto.employeeId)) bad('Not found', 404);
      const v = await this.valuation(c, dto);
      if (v.amountPf === 0n && v.amountOther === 0n)
        bad('Nothing to reverse: no prorated line that month');
      const dup = (
        await c.query(
          `SELECT 1 FROM payroll_lop_reversals WHERE employee_id = $1 AND source_month = $2::date AND status <> 'CANCELLED'`,
          [dto.employeeId, firstOf(dto.sourceMonth)],
        )
      ).rowCount;
      if (dup)
        bad(
          `${monthWords(dto.sourceMonth)} already has a reversal for this employee: cancel it first`,
          409,
        );
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_lop_reversals (school_id, employee_id, source_month, source_record_id, days, amount_pf, amount_other,
                                              reason, status, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5, $6, $7, 'DRAFT', app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            dto.employeeId,
            firstOf(dto.sourceMonth),
            v.record.id,
            dto.days,
            S(v.amountPf),
            S(v.amountOther),
            dto.reason,
          ],
        )
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'payroll.lop_reversal.add',
        entityType: 'payroll_lop_reversals',
        entityId: id,
        after: { ...dto },
      });
      return { id, total: S(v.amountPf + v.amountOther) };
    });
  }

  /** A checker who did not stage it (the admin excepted): two arrears, paid by the next run. */
  async lopApprove(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker approves a loss-of-pay reversal');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = (
        await c.query<{
          employee_id: string;
          source_month: string;
          amount_pf: string;
          amount_other: string;
          status: string;
          mine: boolean;
        }>(
          `SELECT employee_id::text, source_month::text, amount_pf::text, amount_other::text, status, (created_by = app.current_user_id()) AS mine
             FROM payroll_lop_reversals WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!l || (await hiddenFor(c, ctx)).includes(l.employee_id)) bad('Not found', 404);
      if (l!.status !== 'DRAFT') bad(`It is already ${l!.status.toLowerCase()}`, 409);
      if (l!.mine && !has(ctx, PAYROLL.admin))
        bad('You staged it: a different checker approves it', 403);
      const heads = Object.fromEntries(
        (
          await c.query<{ code: string; id: string }>(
            `SELECT code, id::text FROM payroll_pay_heads WHERE code IN ('LOP_REV', 'LOP_REVO') AND status = 'active'`,
          )
        ).rows.map((r) => [r.code, r.id]),
      );
      if (!heads.LOP_REV || !heads.LOP_REVO)
        bad('The LOP_REV and LOP_REVO earning heads must be in use', 409);
      const arrear = async (headId: string, amount: string, pf: boolean) =>
        Number(amount) === 0
          ? null
          : (
              await c.query<{ id: string }>(
                `INSERT INTO payroll_arrears (school_id, employee_id, pay_head_id, period_month, amount, pf_applicable, taxable, source,
                                              source_id, created_by)
                 VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, true, 'LOP_REVERSAL', $6, app.current_user_id())
                 RETURNING id::text`,
                [l!.employee_id, headId, l!.source_month, amount, pf, id],
              )
            ).rows[0]!.id;
      const pf = await arrear(heads.LOP_REV!, l!.amount_pf, true);
      const other = await arrear(heads.LOP_REVO!, l!.amount_other, false);
      await c.query(
        `UPDATE payroll_lop_reversals SET status = 'APPROVED', approved_by = app.current_user_id(), approved_at = now(),
                arrear_pf_id = $2, arrear_other_id = $3, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id, pf, other],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.lop_reversal.approve',
        entityType: 'payroll_lop_reversals',
        entityId: id,
      });
      return { message: 'Approved: paid as arrears by the next run that processes the employee.' };
    });
  }

  /** A draft by a maker or a checker; an approved one only by a checker, while its arrears are unpaid. */
  async lopCancel(ctx: RequestContext, id: string, dto: CancelDto) {
    must(ctx, RUN.manage, 'Only payroll staff cancel a loss-of-pay reversal');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = (
        await c.query<{
          status: string;
          employee_id: string;
          pf: string | null;
          other: string | null;
        }>(
          `SELECT status, employee_id::text, arrear_pf_id::text AS pf, arrear_other_id::text AS other
             FROM payroll_lop_reversals WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!l || (await hiddenFor(c, ctx)).includes(l.employee_id)) bad('Not found', 404);
      if (l!.status === 'CANCELLED') bad('It is already cancelled', 409);
      if (l!.status === 'APPROVED') {
        must(ctx, RUN.approve, 'Only a payroll checker cancels an approved reversal');
        const paid = (
          await c.query(
            `SELECT 1 FROM payroll_arrears WHERE id::text = ANY($1::text[]) AND paid_in_record_id IS NOT NULL`,
            [[l!.pf, l!.other].filter(Boolean)],
          )
        ).rowCount;
        if (paid)
          bad(
            'Its arrears are already paid: correct it with a new reversal of the opposite days',
            409,
          );
        await c.query(
          `UPDATE payroll_arrears SET cancelled_at = now() WHERE id::text = ANY($1::text[])`,
          [[l!.pf, l!.other].filter(Boolean)],
        );
      }
      await c.query(
        `UPDATE payroll_lop_reversals SET status = 'CANCELLED', cancelled_reason = $2, updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [id, dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.lop_reversal.cancel',
        entityType: 'payroll_lop_reversals',
        entityId: id,
        after: { ...dto },
      });
      return { ok: true };
    });
  }

  // ---- salary reconciliation: a dry run beside what was paid -------------------------------------------------------
  async reconcile(ctx: RequestContext, dto: ReconcileDto) {
    must(ctx, RUN.approve, 'Only a payroll checker reconciles a salary');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await hiddenFor(c, ctx)).includes(dto.employeeId)) bad('Not found', 404);
      const mc = await monthContext(c, dto.month);
      const loaded = await loadEmployee(c, mc, dto.employeeId, {
        topUp: null,
        needAttendance: false,
      });
      const stored = (
        await c.query<{
          id: string;
          run_id: string;
          stage: string;
          gross: string;
          ded: string;
          net: string;
          paid: string;
          pf: string;
          esi: string;
          pt: string;
          it: string;
        }>(
          `SELECT r.id::text, r.run_id::text, u.stage, r.gross_earned::text AS gross, r.total_deductions::text AS ded, r.net_pay::text AS net,
                  r.paid_days::text AS paid, r.pf_wage::text AS pf, r.esi_wage::text AS esi, r.pt_amount::text AS pt,
                  (r.it_amount + r.cess_amount)::text AS it
             FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
            WHERE r.employee_id = $1 AND r.month = $2::date AND u.stage IN ('REVIEW', 'APPROVED', 'LOCKED', 'PAID')
              AND u.deleted_at IS NULL AND r.status <> 'FAILED' AND NOT r.is_top_up
            ORDER BY r.id DESC LIMIT 1`,
          [dto.employeeId, firstOf(dto.month)],
        )
      ).rows[0];
      const storedLines = stored
        ? (
            await c.query<{ code: string; head_type: string; amount: string; is_arrear: boolean }>(
              `SELECT code, head_type, amount::text, is_arrear FROM payroll_record_lines WHERE record_id = $1`,
              [stored.id],
            )
          ).rows
        : [];
      if (!loaded.ok)
        return {
          ok: false as const,
          reason: loaded.reason,
          stored: stored ?? null,
          can: runCan(ctx),
        };
      const r = calculate(loaded.input);
      if (!r.ok)
        return { ok: false as const, reason: r.reason, stored: stored ?? null, can: runCan(ctx) };
      const key = (code: string, arrear: boolean) => `${code}${arrear ? ' (arrear)' : ''}`;
      const now = new Map<string, bigint>();
      for (const l of r.lines)
        now.set(key(l.code, l.isArrear), (now.get(key(l.code, l.isArrear)) ?? 0n) + l.earned);
      const then = new Map<string, bigint>();
      for (const l of storedLines)
        then.set(
          key(l.code, l.is_arrear),
          (then.get(key(l.code, l.is_arrear)) ?? 0n) + P(l.amount),
        );
      const lineDiff = [...new Set([...now.keys(), ...then.keys()])]
        .map((k) => {
          const n = now.get(k) ?? 0n;
          const t = then.get(k);
          return {
            line: k,
            now: S(n),
            paid: t === undefined ? null : S(t),
            diff: S(n - (t ?? 0n)),
          };
        })
        .filter((x) => x.diff !== '0.00');
      return {
        ok: true as const,
        computed: {
          paidDays: loaded.input.attendance.paidDays,
          gross: S(r.grossEarned),
          deductions: S(r.totalDeductions),
          net: S(r.netPay),
          pfWage: S(r.pfWage),
          esiWage: S(r.esiWage),
          pt: S(r.ptAmount),
          tax: S(r.itAmount + r.cessAmount),
          lines: r.lines.map((l) => ({
            code: l.code,
            name: l.name,
            headType: l.headType,
            amount: S(l.earned),
            arrear: l.isArrear,
            source: l.source.kind,
          })),
          warnings: r.warnings,
          skipped: (r.trace.skipped as string[]) ?? [],
        },
        stored: stored ?? null,
        lineDiff,
        can: runCan(ctx),
      };
    });
  }
}
