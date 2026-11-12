import { Injectable } from '@nestjs/common';
import { loanSchedule, paiseToString, toPaise, type InterestMethod } from '@edupro/payroll-engine';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  RUN,
  type AdhocDto,
  type AdhocListDto,
  type ClaimDecideDto,
  type ClaimDto,
  type ClaimListDto,
  type FeeRecoveryDto,
  type LoanDto,
  type LoanListDto,
  type LoanScheduleDto,
  type LoanStatusDto,
  type OvertimeDto,
  type PayeeDto,
  type RecurringDto,
  type RecurringListDto,
  type RecurringStatusDto,
  type WardLinkDto,
} from './payroll-inputs.dto';
import {
  addMonths,
  bad,
  camelRow,
  firstOf,
  hiddenFor,
  monthOf,
  monthWords,
  must,
  mustBeOpen,
  runCan,
  today,
} from './payroll-month';

/** the heads payroll works out itself: never typed as a one-off or a recurring deduction */
export const ENGINE_OWNED = ['PF', 'VPF', 'NPS', 'ESI', 'PT', 'LWF', 'TDS', 'ADV'];
const P = (v: string) => toPaise(v) ?? 0n;
const R = (p: bigint) => paiseToString(p);
const page = <T>(rows: T[], q: { page: number; size: number }) => ({
  rows: rows.slice((q.page - 1) * q.size, q.page * q.size),
  total: rows.length,
  page: q.page,
  size: q.size,
});

/**
 * The monthly inputs besides attendance (docs/design/86, phase B step 1; PAYROLL_RUN_SPEC.md §7.8–7.11, 7.14):
 * loans and advances with their schedule, one-off earnings and deductions, fee recovery from a staff child's
 * dues, recurring deductions and their payees, claims, rate-based overtime.
 */
@Injectable()
export class PayrollItemsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async employee(c: PoolClient, ctx: RequestContext, id: string) {
    if ((await hiddenFor(c, ctx)).includes(id)) bad('Not found', 404);
    const e = (
      await c.query<{
        id: string;
        code: string;
        name: string;
        type: string | null;
        mobile: string | null;
        user_id: string | null;
      }>(
        `SELECT id::text, employee_code AS code, display_name AS name, profile->>'staff_type' AS type, mobile, user_id::text
           FROM employees WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    if (!e) bad('Employee not found', 404);
    return e!;
  }
  private async head(c: PoolClient, id: string) {
    const h = (
      await c.query<{
        id: string;
        code: string;
        name: string;
        head_type: string;
        category: string;
        status: string;
      }>(
        `SELECT id::text, code, name, head_type, category, status FROM payroll_pay_heads WHERE id = $1`,
        [id],
      )
    ).rows[0];
    if (!h) bad('Pay head not found', 404);
    return h!;
  }
  /** a head usable as a one-off or recurring line: not one payroll works out, with a version in force that month */
  private async usableHead(c: PoolClient, id: string, month: string) {
    const h = await this.head(c, id);
    if (ENGINE_OWNED.includes(h.code))
      bad(
        `${h.code} is worked out by payroll: ${
          h.code === 'ADV'
            ? 'add a loan or advance instead'
            : h.code === 'TDS'
              ? 'type the month’s tax instead'
              : 'change its rule or the payroll profile'
        }`,
      );
    if (h.status !== 'active') bad(`${h.code} is not in use`);
    const v = (
      await c.query(
        `SELECT 1 FROM payroll_pay_head_versions WHERE pay_head_id = $1 AND status = 'active'
            AND effective_from <= ($2::date + interval '1 month - 1 day') AND (effective_to IS NULL OR effective_to >= $2::date)`,
        [id, firstOf(month)],
      )
    ).rowCount;
    if (!v) bad(`${h.code} has no version in force in ${monthWords(month)}`);
    return h;
  }

  // ---- loans and advances -----------------------------------------------------------------------------------
  schedulePreview(dto: LoanScheduleDto) {
    const s = loanSchedule({
      principal: P(dto.principal),
      emi: P(dto.emi),
      rate: dto.rate,
      method: dto.method as InterestMethod,
    });
    if (!s.ok) bad(s.error);
    const ok = s as Extract<typeof s, { ok: true }>;
    return {
      months: ok.months.map((m, i) => ({
        month: addMonths(dto.startMonth, i),
        opening: R(m.opening),
        interest: R(m.interest),
        emi: R(m.emi),
        principal: R(m.principalPart),
        closing: R(m.closing),
      })),
      count: ok.months.length,
      totalInterest: R(ok.totalInterest),
      lastMonth: addMonths(dto.startMonth, ok.months.length - 1),
    };
  }

  async loans(ctx: RequestContext, q: LoanListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT l.id::text, l.employee_id::text, e.employee_code AS code, e.display_name AS name, e.department, l.loan_type,
                  l.principal::text, l.emi::text, l.interest_rate::text, l.interest_method, l.balance::text,
                  to_char(l.start_month, 'YYYY-MM') AS start_month, l.status, l.created_at
             FROM payroll_loans l JOIN employees e ON e.id = l.employee_id
            WHERE ($1 = 'all' OR l.status = $1) AND NOT (l.employee_id::text = ANY($2::text[]))
              AND ($3::text IS NULL OR e.employee_code ILIKE '%' || $3 || '%' OR e.display_name ILIKE '%' || $3 || '%')
            ORDER BY l.status, e.employee_code, l.id`,
          [q.status, hidden, q.q ?? null],
        )
      ).rows.map(camelRow);
      const figures = (
        await c.query<{ active: number; hold: number; owed: string }>(
          `SELECT count(*) FILTER (WHERE status = 'ACTIVE')::int AS active, count(*) FILTER (WHERE status = 'HOLD')::int AS hold,
                  COALESCE(sum(balance) FILTER (WHERE status <> 'CLOSED'), 0)::text AS owed
             FROM payroll_loans WHERE NOT (employee_id::text = ANY($1::text[]))`,
          [hidden],
        )
      ).rows[0];
      return { ...page(rows, q), figures, can: runCan(ctx) };
    });
  }

  async loan(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = (
        await c.query<Record<string, unknown>>(
          `SELECT l.id::text, l.employee_id::text, e.employee_code AS code, e.display_name AS name, l.loan_type,
                  l.principal::text, l.emi::text, l.interest_rate::text, l.interest_method, l.balance::text,
                  to_char(l.start_month, 'YYYY-MM') AS start_month, l.status, l.remarks, l.created_at,
                  u.display_name AS created_by_name
             FROM payroll_loans l JOIN employees e ON e.id = l.employee_id LEFT JOIN users u ON u.id = l.created_by
            WHERE l.id = $1`,
          [id],
        )
      ).rows[0];
      if (!l || (await hiddenFor(c, ctx)).includes(l.employee_id as string)) bad('Not found', 404);
      const terms = {
        principal: P(l!.principal as string),
        emi: P(l!.emi as string),
        rate: l!.interest_rate as string,
        method: l!.interest_method as InterestMethod,
      };
      const balance = P(l!.balance as string);
      const next =
        balance > 0n && l!.status !== 'CLOSED'
          ? (() => {
              const s = loanSchedule(terms, balance);
              return s.ok
                ? s.months.map((m) => ({
                    opening: R(m.opening),
                    interest: R(m.interest),
                    emi: R(m.emi),
                    principal: R(m.principalPart),
                    closing: R(m.closing),
                  }))
                : [];
            })()
          : [];
      return { loan: camelRow(l!), remaining: next, can: runCan(ctx) };
    });
  }

  async addLoan(ctx: RequestContext, dto: LoanDto) {
    must(ctx, RUN.manage, 'Only payroll makers add loans');
    const preview = this.schedulePreview(dto);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.employee(c, ctx, dto.employeeId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO payroll_loans (school_id, employee_id, loan_type, principal, emi, interest_rate, interest_method, balance,
                                    start_month, status, remarks, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $3, $7::date, 'ACTIVE', $8, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.employeeId,
          dto.loanType,
          dto.principal,
          dto.emi,
          dto.rate,
          dto.method,
          firstOf(dto.startMonth),
          dto.remarks ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.loan.add',
        entityType: 'payroll_loans',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id, months: preview.count, lastMonth: preview.lastMonth };
    });
  }

  /** On hold or back (a maker); foreclosed (a checker): the balance is then settled by a one-off line. */
  async loanStatus(ctx: RequestContext, id: string, dto: LoanStatusDto) {
    must(
      ctx,
      dto.status === 'CLOSED' ? RUN.approve : RUN.manage,
      dto.status === 'CLOSED'
        ? 'Only a payroll checker forecloses a loan'
        : 'Only payroll makers hold a loan',
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = (
        await c.query<{ status: string; employee_id: string; balance: string }>(
          `SELECT status, employee_id::text, balance::text FROM payroll_loans WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!l || (await hiddenFor(c, ctx)).includes(l.employee_id)) bad('Not found', 404);
      if (l!.status === 'CLOSED') bad('A closed loan does not change', 409);
      if (l!.status === dto.status) bad(`It is already ${dto.status.toLowerCase()}`, 409);
      await c.query(
        `UPDATE payroll_loans SET status = $2, balance = CASE WHEN $2 = 'CLOSED' THEN 0 ELSE balance END,
                remarks = left(concat_ws(E'\\n', remarks, $3::text), 1000), updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [id, dto.status, `${dto.status}: ${dto.reason}`],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.loan.status',
        entityType: 'payroll_loans',
        entityId: id,
        before: { status: l!.status, balance: l!.balance },
        after: { ...dto },
      });
      return {
        message:
          dto.status === 'CLOSED'
            ? `Foreclosed. The ₹${l!.balance} still owed is no longer deducted: settle it with a one-off deduction if it is to be recovered.`
            : dto.status === 'HOLD'
              ? 'On hold: no instalment is deducted until it is active again.'
              : 'Active again: the next run deducts its instalment.',
      };
    });
  }

  // ---- one-off earnings and deductions ---------------------------------------------------------------------------
  async adhoc(ctx: RequestContext, q: AdhocListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT a.id::text, a.employee_id::text, e.employee_code AS code, e.display_name AS name, h.code AS head_code,
                  h.name AS head_name, h.head_type, a.amount::text, a.ref_module, a.ref_id, a.remarks, a.receipt_pending,
                  a.paid_in_record_id::text, a.detail, a.created_at, u.display_name AS by_name
             FROM payroll_adhoc a JOIN employees e ON e.id = a.employee_id JOIN payroll_pay_heads h ON h.id = a.pay_head_id
             LEFT JOIN users u ON u.id = a.created_by
            WHERE a.month = $1::date AND a.deleted_at IS NULL AND NOT (a.employee_id::text = ANY($2::text[]))
              AND ($3::text IS NULL OR e.employee_code ILIKE '%' || $3 || '%' OR e.display_name ILIKE '%' || $3 || '%')
            ORDER BY e.employee_code, h.head_type DESC, a.id`,
          [firstOf(q.month), hidden, q.q ?? null],
        )
      ).rows.map(camelRow);
      const sum = (t: string) =>
        R(rows.filter((r) => r.headType === t).reduce((n, r) => n + P(r.amount as string), 0n));
      const heads = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          head_type: string;
          category: string;
        }>(
          `SELECT id::text, code, name, head_type, category FROM payroll_pay_heads
            WHERE status = 'active' AND NOT (code = ANY($1::text[])) ORDER BY head_type DESC, print_order, code`,
          [ENGINE_OWNED],
        )
      ).rows.map(camelRow);
      return {
        month: q.month,
        ...page(rows, q),
        figures: { earnings: sum('EARNING'), deductions: sum('DEDUCTION'), count: rows.length },
        heads,
        can: runCan(ctx),
      };
    });
  }

  async addAdhoc(ctx: RequestContext, dto: AdhocDto) {
    must(ctx, RUN.manage, 'Only payroll makers add one-off items');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stages = await mustBeOpen(c, dto.month, 'one-off items');
      await this.employee(c, ctx, dto.employeeId);
      const h = await this.usableHead(c, dto.payHeadId, dto.month);
      if (h.head_type === 'EARNING') {
        // an earning already on the salary structure is paid by a revision or an arrear, not twice
        const inStructure = (
          await c.query(
            `SELECT 1 FROM payroll_structures WHERE employee_id = $1 AND pay_head_id = $2 AND status = 'active'
                AND effective_from <= ($3::date + interval '1 month - 1 day') AND (effective_to IS NULL OR effective_to >= $3::date)`,
            [dto.employeeId, dto.payHeadId, firstOf(dto.month)],
          )
        ).rowCount;
        if (inStructure && h.code !== 'OT')
          bad(
            `${h.code} is on this employee\u2019s salary structure: change the structure, or pay the difference as an arrear`,
          );
        if (h.code === 'OT') {
          const ot = (
            await c.query(
              `SELECT 1 FROM payroll_ot_entries WHERE employee_id = $1 AND month = $2::date AND deleted_at IS NULL`,
              [dto.employeeId, firstOf(dto.month)],
            )
          ).rowCount;
          if (ot) bad('This month’s overtime is already entered on the Overtime tab');
        }
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO payroll_adhoc (school_id, employee_id, month, pay_head_id, amount, remarks, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [dto.employeeId, firstOf(dto.month), dto.payHeadId, dto.amount, dto.remarks],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.adhoc.add',
        entityType: 'payroll_adhoc',
        entityId: r.rows[0]!.id,
        after: { ...dto, head: h.code },
      });
      return {
        id: r.rows[0]!.id,
        message: stages.length
          ? 'Saved. A run of this month exists: process it again for this to count.'
          : 'Saved.',
      };
    });
  }

  async deleteAdhoc(ctx: RequestContext, id: string) {
    must(ctx, RUN.manage, 'Only payroll makers remove one-off items');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = (
        await c.query<{
          month: string;
          employee_id: string;
          paid: string | null;
          ref_module: string | null;
        }>(
          `SELECT month::text, employee_id::text, paid_in_record_id::text AS paid, ref_module
             FROM payroll_adhoc WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        )
      ).rows[0];
      if (!a || (await hiddenFor(c, ctx)).includes(a.employee_id)) bad('Not found', 404);
      // the legacy let a paid line be trashed when a later run existed; a paid line stays
      if (a!.paid)
        bad('A run has paid this line: it stays (correct it with another one-off line)', 409);
      if (a!.ref_module === 'CLAIM')
        bad('This pays a claim: reject or change the claim instead', 409);
      if (a!.ref_module === 'OT')
        bad('This is the month’s overtime: remove it on the Overtime tab', 409);
      await mustBeOpen(c, monthOf(a!.month), 'one-off items');
      await c.query(
        `UPDATE payroll_adhoc SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.adhoc.delete',
        entityType: 'payroll_adhoc',
        entityId: id,
      });
      return { ok: true };
    });
  }

  // ---- fee recovery: a staff member's children and their dues ------------------------------------------------------
  async wards(ctx: RequestContext, employeeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.employee(c, ctx, employeeId);
      const linked = (
        await c.query<Record<string, unknown>>(
          `SELECT w.id::text, w.student_id::text, s.admission_no, btrim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS name,
                  w.source, w.active
             FROM payroll_ward_links w JOIN students s ON s.id = w.student_id
            WHERE w.employee_id = $1 ORDER BY w.active DESC, s.admission_no`,
          [employeeId],
        )
      ).rows.map(camelRow);
      const mobile = (e.mobile ?? '').replace(/\D/g, '').slice(-10);
      // children whose guardian has the employee's mobile or sign-in: offered, a checker links them
      const found = (
        await c.query<Record<string, unknown>>(
          `SELECT DISTINCT s.id::text AS student_id, s.admission_no, btrim(s.first_name || ' ' || COALESCE(s.last_name, '')) AS name
             FROM students s JOIN student_guardians sg ON sg.student_id = s.id JOIN guardians g ON g.id = sg.guardian_id
            WHERE s.deleted_at IS NULL AND s.status = 'active'
              AND (($1 <> '' AND right(regexp_replace(COALESCE(g.mobile, ''), '\\D', '', 'g'), 10) = $1)
                   OR ($2::bigint IS NOT NULL AND g.user_id = $2::bigint))
              AND NOT EXISTS (SELECT 1 FROM payroll_ward_links w WHERE w.employee_id = $3 AND w.student_id = s.id)
            ORDER BY s.admission_no`,
          [mobile, e.user_id, employeeId],
        )
      ).rows.map(camelRow);
      const ids = linked.filter((w) => w.active).map((w) => w.studentId as string);
      const dues = (
        await c.query<Record<string, unknown>>(
          `SELECT d.student_id::text, d.academic_year_id::text, d.due_on::text, string_agg(DISTINCT h.name, ', ') AS heads,
                  sum(d.net - d.paid)::text AS outstanding
             FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id
            WHERE d.student_id::text = ANY($1::text[]) AND d.status IN ('pending', 'partial') AND d.ledger = 'school'
              AND d.net > d.paid
            GROUP BY d.student_id, d.academic_year_id, d.due_on ORDER BY d.student_id, d.due_on`,
          [ids],
        )
      ).rows.map(camelRow);
      const staged = new Set(
        (
          await c.query<{ ref: string }>(
            `SELECT ref_id AS ref FROM payroll_adhoc WHERE employee_id = $1 AND ref_module = 'FEE' AND deleted_at IS NULL`,
            [employeeId],
          )
        ).rows.map((r) => r.ref),
      );
      const wardFee = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM payroll_pay_heads WHERE code = 'WARDFEE' AND head_type = 'DEDUCTION' AND status = 'active'`,
        )
      ).rows[0];
      return {
        employee: { id: e.id, code: e.code, name: e.name },
        linked,
        found,
        dues: dues.map((d) => ({
          ...d,
          staged: staged.has(`FEE/${String(d.studentId)}/${String(d.dueOn)}`),
        })),
        wardFeeHeadId: wardFee?.id ?? null,
        can: runCan(ctx),
      };
    });
  }

  async linkWard(ctx: RequestContext, dto: WardLinkDto) {
    must(ctx, RUN.approve, 'Only a payroll checker links a staff member’s child');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await this.employee(c, ctx, dto.employeeId);
      const s = (
        await c.query<{ mobile_match: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                           WHERE sg.student_id = s.id
                             AND ((right(regexp_replace(COALESCE(g.mobile, ''), '\\D', '', 'g'), 10) = $2 AND $2 <> '')
                                  OR ($3::bigint IS NOT NULL AND g.user_id = $3::bigint))) AS mobile_match
             FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
          [dto.studentId, (e.mobile ?? '').replace(/\D/g, '').slice(-10), e.user_id],
        )
      ).rows[0];
      if (!s) bad('Student not found', 404);
      const r = await c.query<{ id: string }>(
        `INSERT INTO payroll_ward_links (school_id, employee_id, student_id, source, active, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, true, app.current_user_id(), app.current_user_id())
         ON CONFLICT (employee_id, student_id) DO UPDATE SET active = true, updated_by = app.current_user_id(), updated_at = now()
         RETURNING id::text`,
        [dto.employeeId, dto.studentId, s!.mobile_match ? 'mobile' : 'manual'],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.ward.link',
        entityType: 'payroll_ward_links',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async unlinkWard(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker unlinks a child');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE payroll_ward_links SET active = false, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id],
      );
      if (!r.rowCount) bad('Not found', 404);
      await this.audit.stage(ctx, c, {
        action: 'payroll.ward.unlink',
        entityType: 'payroll_ward_links',
        entityId: id,
      });
      return { ok: true };
    });
  }

  /** The dues picked become one-off deductions (one per child and due date); the receipt is posted at Lock. */
  async stageFeeRecovery(ctx: RequestContext, dto: FeeRecoveryDto) {
    must(ctx, RUN.manage, 'Only payroll makers stage fee recovery');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, dto.month, 'one-off items');
      await this.employee(c, ctx, dto.employeeId);
      const h = await this.usableHead(c, dto.payHeadId, dto.month);
      if (h.head_type !== 'DEDUCTION') bad('Fee recovery needs a deduction head (WARDFEE)');
      const linked = new Set(
        (
          await c.query<{ id: string }>(
            `SELECT student_id::text AS id FROM payroll_ward_links WHERE employee_id = $1 AND active`,
            [dto.employeeId],
          )
        ).rows.map((r) => r.id),
      );
      let staged = 0;
      let skipped = 0;
      for (const it of dto.items) {
        if (!linked.has(it.studentId))
          bad('A child is not linked to this employee: a checker links them first');
        const ref = `FEE/${it.studentId}/${it.dueOn}`;
        const due = (
          await c.query<{ year: string; amount: string; heads: string; ids: string[] }>(
            `SELECT min(d.academic_year_id)::text AS year, sum(d.net - d.paid)::text AS amount,
                    string_agg(DISTINCT h.name, ', ') AS heads, array_agg(d.id::text) AS ids
               FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id
              WHERE d.student_id = $1 AND d.due_on = $2::date AND d.status IN ('pending', 'partial') AND d.ledger = 'school'
                AND d.net > d.paid`,
            [it.studentId, it.dueOn],
          )
        ).rows[0];
        if (!due?.amount || P(due.amount) <= 0n) {
          skipped += 1;
          continue;
        }
        const r = await c.query(
          `INSERT INTO payroll_adhoc (school_id, employee_id, month, pay_head_id, amount, ref_module, ref_id, detail,
                                      receipt_pending, remarks, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, 'FEE', $5, $6::jsonb, true, $7, app.current_user_id(), app.current_user_id())
           ON CONFLICT (school_id, ref_id) WHERE ref_id IS NOT NULL AND deleted_at IS NULL DO NOTHING`,
          [
            dto.employeeId,
            firstOf(dto.month),
            dto.payHeadId,
            due.amount,
            ref,
            JSON.stringify({
              studentId: it.studentId,
              academicYearId: due.year,
              dueOn: it.dueOn,
              heads: due.heads,
              demandIds: due.ids,
            }),
            `Fees due ${it.dueOn} (${due.heads})`.slice(0, 200),
          ],
        );
        if (r.rowCount) staged += 1;
        else skipped += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.fee_recovery.stage',
        entityType: 'payroll_adhoc',
        entityId: dto.employeeId,
        after: { ...dto, staged },
      });
      return {
        staged,
        skipped,
        message: `${String(staged)} due(s) will be deducted in ${monthWords(dto.month)}; their fee receipts are posted when the run is locked.`,
      };
    });
  }

  // ---- payees and recurring deductions ---------------------------------------------------------------------------
  async payees(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      rows: (
        await c.query<Record<string, unknown>>(
          `SELECT p.id::text, p.name, p.party_type, p.payee_account, p.remarks, p.active,
                  (SELECT count(*)::int FROM payroll_recurring r WHERE r.payee_id = p.id AND r.status = 'ACTIVE') AS deductions
             FROM payroll_payees p ORDER BY p.active DESC, p.name`,
        )
      ).rows.map(camelRow),
      can: runCan(ctx),
    }));
  }

  async savePayee(ctx: RequestContext, id: string | null, dto: PayeeDto) {
    must(ctx, RUN.manage, 'Only payroll makers keep payees');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const vals = [
        dto.name,
        dto.partyType,
        dto.payeeAccount ?? null,
        dto.remarks ?? null,
        dto.active,
      ];
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE payroll_payees SET name = $2, party_type = $3, payee_account = $4, remarks = $5, active = $6,
                    updated_by = app.current_user_id(), updated_at = now() WHERE id = $1 RETURNING id::text`,
            [id, ...vals],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO payroll_payees (school_id, name, party_type, payee_account, remarks, active, created_by, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
            vals,
          );
      if (!r.rows[0]) bad('Not found', 404);
      await this.audit.stage(ctx, c, {
        action: id ? 'payroll.payee.update' : 'payroll.payee.add',
        entityType: 'payroll_payees',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async recurring(ctx: RequestContext, q: RecurringListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT r.id::text, r.employee_id::text, e.employee_code AS code, e.display_name AS name, h.code AS head_code,
                  h.name AS head_name, p.name AS payee, r.payee_id::text, r.amount::text, r.reference_no,
                  to_char(r.start_month, 'YYYY-MM') AS start_month, to_char(r.end_month, 'YYYY-MM') AS end_month, r.status, r.remarks
             FROM payroll_recurring r JOIN employees e ON e.id = r.employee_id JOIN payroll_pay_heads h ON h.id = r.pay_head_id
             LEFT JOIN payroll_payees p ON p.id = r.payee_id
            WHERE ($1 = 'all' OR r.status = $1) AND NOT (r.employee_id::text = ANY($2::text[]))
              AND ($3::text IS NULL OR e.employee_code ILIKE '%' || $3 || '%' OR e.display_name ILIKE '%' || $3 || '%')
              AND ($4::bigint IS NULL OR r.payee_id = $4::bigint)
            ORDER BY e.employee_code, h.print_order, r.id`,
          [q.status, hidden, q.q ?? null, q.payeeId ?? null],
        )
      ).rows.map(camelRow);
      const heads = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, code, name FROM payroll_pay_heads
            WHERE status = 'active' AND head_type = 'DEDUCTION' AND NOT (code = ANY($1::text[])) ORDER BY print_order, code`,
          [ENGINE_OWNED],
        )
      ).rows.map(camelRow);
      const payees = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, name FROM payroll_payees WHERE active ORDER BY name`,
        )
      ).rows.map(camelRow);
      return { ...page(rows, q), heads, payees, can: runCan(ctx) };
    });
  }

  async addRecurring(ctx: RequestContext, dto: RecurringDto) {
    must(ctx, RUN.manage, 'Only payroll makers add recurring deductions');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.employee(c, ctx, dto.employeeId);
      const h = await this.usableHead(c, dto.payHeadId, dto.startMonth);
      if (h.head_type !== 'DEDUCTION') bad('A recurring deduction needs a deduction head');
      if (dto.endMonth && dto.endMonth < dto.startMonth) bad('It ends before it starts');
      // the same head, payee and reference already live over those months: deducted twice (the legacy only warned)
      const clash = (
        await c.query(
          `SELECT 1 FROM payroll_recurring
            WHERE employee_id = $1 AND pay_head_id = $2 AND COALESCE(payee_id, 0) = COALESCE($3::bigint, 0)
              AND COALESCE(reference_no, '') = COALESCE($4, '') AND status = 'ACTIVE'
              AND start_month <= COALESCE($6::date, 'infinity'::date) AND COALESCE(end_month, 'infinity'::date) >= $5::date`,
          [
            dto.employeeId,
            dto.payHeadId,
            dto.payeeId ?? null,
            dto.referenceNo ?? null,
            firstOf(dto.startMonth),
            dto.endMonth ? firstOf(dto.endMonth) : null,
          ],
        )
      ).rowCount;
      if (clash)
        bad('The same deduction (head, payee and reference) already runs over those months', 409);
      const r = await c.query<{ id: string }>(
        `INSERT INTO payroll_recurring (school_id, employee_id, pay_head_id, payee_id, amount, reference_no, start_month, end_month,
                                        status, remarks, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::date, $7::date, 'ACTIVE', $8, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.employeeId,
          dto.payHeadId,
          dto.payeeId ?? null,
          dto.amount,
          dto.referenceNo ?? null,
          firstOf(dto.startMonth),
          dto.endMonth ? firstOf(dto.endMonth) : null,
          dto.remarks ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.recurring.add',
        entityType: 'payroll_recurring',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async recurringStatus(ctx: RequestContext, id: string, dto: RecurringStatusDto) {
    must(ctx, RUN.manage, 'Only payroll makers change recurring deductions');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ status: string; employee_id: string; start: string }>(
          `SELECT status, employee_id::text, to_char(start_month, 'YYYY-MM') AS start FROM payroll_recurring WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!r || (await hiddenFor(c, ctx)).includes(r.employee_id)) bad('Not found', 404);
      if (r!.status === 'ENDED') bad('An ended deduction does not change; add a new one', 409);
      // ending: the last month deducted (the legacy stamped today's calendar month)
      const end =
        dto.status === 'ENDED' ? (dto.endMonth ?? addMonths(today().slice(0, 7), -1)) : null;
      if (end && end < r!.start) bad('It would end before it starts');
      await c.query(
        `UPDATE payroll_recurring SET status = $2, end_month = COALESCE($3::date, end_month),
                remarks = left(concat_ws(E'\\n', remarks, $4::text), 200), updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [id, dto.status, end ? firstOf(end) : null, `${dto.status}: ${dto.reason}`],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.recurring.status',
        entityType: 'payroll_recurring',
        entityId: id,
        before: { status: r!.status },
        after: { ...dto, endMonth: end },
      });
      return { ok: true };
    });
  }

  /** What is deducted for each payee in a month (a checker): the amounts configured for it. */
  async payout(ctx: RequestContext, month: string) {
    must(ctx, RUN.approve, 'Only a payroll checker sees the payee payout');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT COALESCE(p.name, '(no payee)') AS payee, p.party_type, p.payee_account, count(*)::int AS deductions,
                  sum(r.amount)::text AS amount
             FROM payroll_recurring r LEFT JOIN payroll_payees p ON p.id = r.payee_id
            WHERE r.status = 'ACTIVE' AND r.start_month <= $1::date AND (r.end_month IS NULL OR r.end_month >= $1::date)
            GROUP BY p.name, p.party_type, p.payee_account ORDER BY 1`,
          [firstOf(month)],
        )
      ).rows.map(camelRow);
      return { month, rows };
    });
  }

  // ---- claims ---------------------------------------------------------------------------------------------------
  async claims(ctx: RequestContext, q: ClaimListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT k.id::text, k.employee_id::text, e.employee_code AS code, e.display_name AS name, h.code AS head_code,
                  h.name AS head_name, k.amount_claimed::text, k.amount_approved::text, k.bill_date::text, k.description,
                  k.proof_file_id::text, k.status, to_char(k.pay_month, 'YYYY-MM') AS pay_month, k.decision_remark,
                  k.created_at, u.display_name AS by_name, d.display_name AS decided_by_name, k.decided_at,
                  (k.created_by = app.current_user_id()) AS mine
             FROM payroll_claims k JOIN employees e ON e.id = k.employee_id JOIN payroll_pay_heads h ON h.id = k.pay_head_id
             LEFT JOIN users u ON u.id = k.created_by LEFT JOIN users d ON d.id = k.decided_by
            WHERE ($1 = 'all' OR k.status = $1) AND NOT (k.employee_id::text = ANY($2::text[]))
              AND ($3::text IS NULL OR e.employee_code ILIKE '%' || $3 || '%' OR e.display_name ILIKE '%' || $3 || '%')
            ORDER BY k.created_at DESC`,
          [q.status, hidden, q.q ?? null],
        )
      ).rows.map(camelRow);
      const heads = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, code, name FROM payroll_pay_heads WHERE status = 'active' AND category = 'REIMB' AND head_type = 'EARNING'
            ORDER BY print_order, code`,
        )
      ).rows.map(camelRow);
      const waiting = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_claims WHERE status = 'SUBMITTED'`,
        )
      ).rows[0]!.n;
      return { ...page(rows, q), heads, waiting, can: runCan(ctx) };
    });
  }

  async addClaim(ctx: RequestContext, dto: ClaimDto) {
    must(ctx, RUN.manage, 'Only payroll makers enter claims');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.employee(c, ctx, dto.employeeId);
      const h = await this.head(c, dto.payHeadId);
      if (h.category !== 'REIMB' || h.head_type !== 'EARNING')
        bad('A claim is paid on a reimbursement head');
      const r = await c.query<{ id: string }>(
        `INSERT INTO payroll_claims (school_id, employee_id, pay_head_id, amount_claimed, bill_date, description, proof_file_id,
                                     status, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5, $6, 'SUBMITTED', app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.employeeId,
          dto.payHeadId,
          dto.amountClaimed,
          dto.billDate ?? null,
          dto.description,
          dto.proofFileId ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.claim.add',
        entityType: 'payroll_claims',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id };
    });
  }

  /** A checker who did not enter it approves (a one-off earning in the month chosen) or rejects with a reason. */
  async decideClaim(ctx: RequestContext, id: string, dto: ClaimDecideDto) {
    must(ctx, RUN.approve, 'Only a payroll checker decides claims');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = (
        await c.query<{
          status: string;
          employee_id: string;
          pay_head_id: string;
          claimed: string;
          mine: boolean;
          description: string;
        }>(
          `SELECT status, employee_id::text, pay_head_id::text, amount_claimed::text AS claimed, description,
                  (created_by = app.current_user_id()) AS mine
             FROM payroll_claims WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!k || (await hiddenFor(c, ctx)).includes(k.employee_id)) bad('Not found', 404);
      if (k!.status !== 'SUBMITTED') bad(`The claim is already ${k!.status.toLowerCase()}`, 409);
      // the legacy allowed no exemption here, not even for the admin
      if (k!.mine) bad('You entered this claim: another checker decides it', 403);
      let adhocId: string | null = null;
      if (dto.decision === 'APPROVED') {
        if (P(dto.amountApproved!) > P(k!.claimed)) bad('More is approved than was claimed');
        await mustBeOpen(c, dto.payMonth!, 'one-off items');
        adhocId = (
          await c.query<{ id: string }>(
            `INSERT INTO payroll_adhoc (school_id, employee_id, month, pay_head_id, amount, ref_module, ref_id, remarks,
                                        created_by, updated_by)
             VALUES (app.current_school_id(), $1, $2::date, $3, $4, 'CLAIM', $5, $6, app.current_user_id(), app.current_user_id())
             RETURNING id::text`,
            [
              k!.employee_id,
              firstOf(dto.payMonth!),
              k!.pay_head_id,
              dto.amountApproved,
              `CLAIM/${id}`,
              `Claim: ${k!.description}`.slice(0, 200),
            ],
          )
        ).rows[0]!.id;
      }
      await c.query(
        `UPDATE payroll_claims SET status = $2, amount_approved = $3, pay_month = $4::date, adhoc_id = $5, decided_by = app.current_user_id(),
                decided_at = now(), decision_remark = $6, updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [
          id,
          dto.decision,
          dto.decision === 'APPROVED' ? dto.amountApproved : null,
          dto.decision === 'APPROVED' ? firstOf(dto.payMonth!) : null,
          adhocId,
          dto.remark ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.claim.decide',
        entityType: 'payroll_claims',
        entityId: id,
        after: { ...dto },
      });
      return {
        message:
          dto.decision === 'APPROVED'
            ? `Approved: ₹${dto.amountApproved!} is paid with ${monthWords(dto.payMonth!)}'s salary.`
            : 'Rejected.',
      };
    });
  }

  // ---- rate-based overtime ---------------------------------------------------------------------------------------
  async overtime(ctx: RequestContext, month: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT o.id::text, o.employee_id::text, e.employee_code AS code, e.display_name AS name, o.basis, o.qty::text,
                  o.employee_type, o.rate::text, o.derived_amount::text, o.amount::text, o.reason,
                  a.paid_in_record_id::text AS paid, o.updated_at
             FROM payroll_ot_entries o JOIN employees e ON e.id = o.employee_id LEFT JOIN payroll_adhoc a ON a.id = o.adhoc_id
            WHERE o.month = $1::date AND o.deleted_at IS NULL AND NOT (o.employee_id::text = ANY($2::text[]))
            ORDER BY e.employee_code`,
          [firstOf(month), hidden],
        )
      ).rows.map(camelRow);
      return {
        month,
        rows,
        total: R(rows.reduce((n, r) => n + P(r.amount as string), 0n)),
        can: runCan(ctx),
      };
    });
  }

  /** The month's overtime of an employee at the dated rate of their type; it replaces an earlier unpaid entry. */
  async saveOvertime(ctx: RequestContext, dto: OvertimeDto) {
    must(ctx, RUN.manage, 'Only payroll makers enter overtime');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mustBeOpen(c, dto.month, 'overtime');
      const e = await this.employee(c, ctx, dto.employeeId);
      const m = firstOf(dto.month);
      const ot = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM payroll_pay_heads WHERE code = 'OT' AND head_type = 'EARNING' AND status = 'active'`,
        )
      ).rows[0];
      if (!ot) bad('There is no OT earning head in use');
      const handOt = (
        await c.query(
          `SELECT 1 FROM payroll_adhoc WHERE employee_id = $1 AND month = $2::date AND pay_head_id = $3 AND ref_module IS NULL
              AND deleted_at IS NULL`,
          [dto.employeeId, m, ot!.id],
        )
      ).rowCount;
      if (handOt) bad('An OT one-off line is already typed for this month: remove it first', 409);
      const rate = (
        await c.query<{ daily: string; hourly: string }>(
          `SELECT daily_amount::text AS daily, hourly_amount::text AS hourly FROM payroll_ot_rates
            WHERE status = 'active' AND lower(employee_type) = lower($1) AND effective_from <= ($2::date + interval '1 month - 1 day')
              AND (effective_to IS NULL OR effective_to >= $2::date)
            ORDER BY effective_from DESC LIMIT 1`,
          [e.type ?? '', m],
        )
      ).rows[0];
      const r = dto.basis === 'DAY' ? rate?.daily : rate?.hourly;
      if (!r || P(r) <= 0n)
        bad(
          `No ${dto.basis === 'DAY' ? 'daily' : 'hourly'} overtime rate in force for ${e.type ?? 'this employee type'} (Rates → Overtime rates)`,
        );
      if (dto.basis === 'HOUR') {
        // the monthly hours limit holds for rate-based hours too (the legacy only checked attendance hours)
        const limit = (
          await c.query<{ v: string }>(`SELECT ot_hours_limit::text AS v FROM payroll_settings`)
        ).rows[0]?.v;
        if (limit && Number(dto.qty) > Number(limit))
          bad(`More hours than the monthly limit of ${limit}`);
      }
      // rate × quantity, half-up to the paisa
      const derived = (P(r!) * BigInt(Math.round(Number(dto.qty) * 100)) + 50n) / 100n;
      const amount = dto.amount ? P(dto.amount) : derived;
      if (amount !== derived && !(dto.reason && dto.reason.length >= 3))
        bad('Say why the amount differs from rate × quantity');
      const prev = (
        await c.query<{ id: string; adhoc_id: string | null; paid: string | null }>(
          `SELECT o.id::text, o.adhoc_id::text, a.paid_in_record_id::text AS paid
             FROM payroll_ot_entries o LEFT JOIN payroll_adhoc a ON a.id = o.adhoc_id
            WHERE o.employee_id = $1 AND o.month = $2::date AND o.deleted_at IS NULL`,
          [dto.employeeId, m],
        )
      ).rows[0];
      if (prev?.paid) bad('This month’s overtime is already paid', 409);
      if (prev) {
        await c.query(
          `UPDATE payroll_ot_entries SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
          [prev.id],
        );
        if (prev.adhoc_id)
          await c.query(
            `UPDATE payroll_adhoc SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
            [prev.adhoc_id],
          );
      }
      const adhoc = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_adhoc (school_id, employee_id, month, pay_head_id, amount, ref_module, ref_id, detail, remarks,
                                      created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, 'OT', $5, $6::jsonb, $7, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            dto.employeeId,
            m,
            ot!.id,
            R(amount),
            `OT/${dto.month}/${dto.employeeId}`,
            JSON.stringify({ basis: dto.basis, qty: dto.qty, rate: r }),
            `Overtime ${dto.qty} ${dto.basis === 'DAY' ? 'day(s)' : 'hour(s)'} × ₹${r!}`,
          ],
        )
      ).rows[0]!.id;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_ot_entries (school_id, employee_id, month, basis, qty, employee_type, rate, derived_amount, amount,
                                           reason, adhoc_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            dto.employeeId,
            m,
            dto.basis,
            dto.qty,
            e.type,
            r,
            R(derived),
            R(amount),
            dto.reason ?? null,
            adhoc,
          ],
        )
      ).rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: prev ? 'payroll.overtime.replace' : 'payroll.overtime.add',
        entityType: 'payroll_ot_entries',
        entityId: id,
        after: { ...dto, rate: r, derived: R(derived) },
      });
      return { id, amount: R(amount), derived: R(derived) };
    });
  }

  async deleteOvertime(ctx: RequestContext, id: string) {
    must(ctx, RUN.manage, 'Only payroll makers remove overtime');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const o = (
        await c.query<{
          month: string;
          employee_id: string;
          adhoc_id: string | null;
          paid: string | null;
        }>(
          `SELECT o.month::text, o.employee_id::text, o.adhoc_id::text, a.paid_in_record_id::text AS paid
             FROM payroll_ot_entries o LEFT JOIN payroll_adhoc a ON a.id = o.adhoc_id WHERE o.id = $1 AND o.deleted_at IS NULL`,
          [id],
        )
      ).rows[0];
      if (!o || (await hiddenFor(c, ctx)).includes(o.employee_id)) bad('Not found', 404);
      if (o!.paid) bad('This overtime is already paid', 409);
      await mustBeOpen(c, monthOf(o!.month), 'overtime');
      await c.query(
        `UPDATE payroll_ot_entries SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      if (o!.adhoc_id)
        await c.query(
          `UPDATE payroll_adhoc SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
          [o!.adhoc_id],
        );
      await this.audit.stage(ctx, c, {
        action: 'payroll.overtime.delete',
        entityType: 'payroll_ot_entries',
        entityId: id,
      });
      return { ok: true };
    });
  }
}
