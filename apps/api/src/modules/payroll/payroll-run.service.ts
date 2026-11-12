import { Injectable } from '@nestjs/common';
import { calculate, paiseToString, toPaise, type CalcResult } from '@edupro/payroll-engine';
import { decryptField, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { loadEmployee, monthContext, type Snapshot } from './payroll-calc-input';
import { RUN } from './payroll-inputs.dto';
import {
  addMonths,
  bad,
  camelRow,
  firstOf,
  has,
  hiddenFor,
  monthWords,
  must,
  ROSTER_SQL,
  runCan,
  today,
  windowOf,
} from './payroll-month';
import { buildPayslip } from './payroll-payslip';
import type {
  CommentDto,
  DropDto,
  HoldRecordDto,
  RecordListDto,
  RecoveryDto,
  RunCreateDto,
  RunListDto,
} from './payroll-run.dto';
import { amountInWords } from './payroll-words';
import { PAYROLL } from './payroll.dto';

const P = (v: string | null | undefined) => toPaise(String(v ?? '0')) ?? 0n;
const S = paiseToString;
const BATCH = 25;
interface RunRow {
  id: string;
  month: string;
  run_type: 'REGULAR' | 'SUPPLEMENTARY' | 'BONUS';
  seq: number;
  employee_ids: string[] | null;
  stage: string;
  created_by: string | null;
  mine: boolean;
}

/**
 * The monthly run (docs/design/86, phase B step 3; PAYROLL_RUN_SPEC.md §2–6): create, the checks before a run,
 * process in batches (each employee in its own savepoint; a failure is kept as a FAILED record with its reason),
 * review, approve by a checker who did not create it, reject with a comment, lock (the payslips frozen, the fee
 * receipts of fee recovery posted), unapprove and reopen by the payroll admin, drop failed records, hold and
 * release a record, a negative net recovered over the coming months.
 */
@Injectable()
export class PayrollRunService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async runRow(c: PoolClient, id: string, lock = false) {
    const r = (
      await c.query<RunRow>(
        lock
          ? `SELECT id::text, to_char(month, 'YYYY-MM') AS month, run_type, seq, employee_ids::text[] AS employee_ids, stage,
                    created_by::text, (created_by = app.current_user_id()) AS mine
               FROM payroll_runs WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`
          : `SELECT id::text, to_char(month, 'YYYY-MM') AS month, run_type, seq, employee_ids::text[] AS employee_ids, stage,
                    created_by::text, (created_by = app.current_user_id()) AS mine
               FROM payroll_runs WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    if (!r) bad('Run not found', 404);
    return r!;
  }
  private async event(
    c: PoolClient,
    runId: string,
    action: string,
    from: string | null,
    to: string | null,
    comment: string | null = null,
    detail: Record<string, unknown> = {},
  ) {
    await c.query(
      `INSERT INTO payroll_run_events (school_id, run_id, action, stage_from, stage_to, comment, detail, created_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, app.current_user_id())`,
      [runId, action, from, to, comment, JSON.stringify(detail)],
    );
  }
  private async setStage(c: PoolClient, runId: string, from: string, to: string, extra = '') {
    const r = await c.query(
      // eslint-disable-next-line no-restricted-syntax -- `extra` is one of the fixed stamp fragments below; values are bound
      `UPDATE payroll_runs SET stage = $3, updated_by = app.current_user_id(), updated_at = now() ${extra}
        WHERE id = $1 AND stage = $2`,
      [runId, from, to],
    );
    if (!r.rowCount) bad(`The run is no longer ${from.toLowerCase()}: refresh and try again`, 409);
  }

  /** Who a run works out: the roster (less those skipped), the staff named, or for a bonus who has something pending. */
  private async eligible(c: PoolClient, run: RunRow): Promise<string[]> {
    const m = run.month;
    if (run.run_type === 'SUPPLEMENTARY') return run.employee_ids!;
    const { from, to } = await windowOf(c, m);
    const roster = (
      await c.query<{ employee_id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- ROSTER_SQL is a fixed fragment; values are bound
        `SELECT r.employee_id FROM (${ROSTER_SQL}) r
          WHERE NOT EXISTS (SELECT 1 FROM payroll_holds h WHERE h.employee_id = r.id AND h.month = $3::date AND h.active AND h.mode = 'SKIP')
          ORDER BY r.employee_code`,
        [from, to, firstOf(m)],
      )
    ).rows.map((r) => r.employee_id);
    if (run.run_type === 'REGULAR') return roster;
    const pending = new Set(
      (
        await c.query<{ id: string }>(
          `SELECT DISTINCT a.employee_id::text AS id FROM payroll_adhoc a JOIN payroll_pay_heads h ON h.id = a.pay_head_id
            WHERE a.month = $1::date AND a.deleted_at IS NULL AND a.paid_in_record_id IS NULL AND h.head_type = 'EARNING'
           UNION SELECT employee_id::text FROM payroll_arrears WHERE paid_in_record_id IS NULL AND cancelled_at IS NULL`,
          [firstOf(m)],
        )
      ).rows.map((r) => r.id),
    );
    return roster.filter((id) => pending.has(id));
  }

  /** The month already paid to an employee by a locked run: the PF wage it used (a top-up then pays what is pending). */
  private async paidThisMonth(c: PoolClient, run: RunRow, employeeIds: string[]) {
    const rows = (
      await c.query<{ id: string; pf: string }>(
        `SELECT r.employee_id::text AS id, sum(r.pf_wage)::text AS pf FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.month = $1::date AND u.id <> $2 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL
            AND r.status <> 'FAILED' AND r.employee_id::text = ANY($3::text[])
          GROUP BY r.employee_id`,
        [firstOf(run.month), run.id, employeeIds],
      )
    ).rows;
    return new Map(rows.map((r) => [r.id, P(r.pf)]));
  }

  // ---- runs -----------------------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: RunListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const now = today();
      const fy =
        q.fy ??
        (Number(now.slice(5, 7)) >= 4 ? Number(now.slice(0, 4)) : Number(now.slice(0, 4)) - 1);
      const rows = (
        await c.query<Record<string, unknown>>(
          `SELECT u.id::text, to_char(u.month, 'YYYY-MM') AS month, u.run_type, u.seq, u.stage, u.emp_count, u.failed_count,
                  u.gross_total::text, u.deduction_total::text, u.net_total::text, u.progress, u.created_at, u.approved_at,
                  u.locked_at, c.display_name AS created_by_name, a.display_name AS approved_by_name,
                  cardinality(u.employee_ids) AS named
             FROM payroll_runs u LEFT JOIN users c ON c.id = u.created_by LEFT JOIN users a ON a.id = u.approved_by
            WHERE u.deleted_at IS NULL AND u.month BETWEEN make_date($1, 4, 1) AND make_date($1 + 1, 3, 1)
            ORDER BY u.month DESC, u.id DESC`,
          [fy],
        )
      ).rows.map(camelRow);
      return { fy, rows, thisMonth: now.slice(0, 7), can: runCan(ctx) };
    });
  }

  async create(ctx: RequestContext, dto: RunCreateDto) {
    must(ctx, RUN.manage, 'Only payroll makers create runs');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const m = dto.month;
      const runs = (
        await c.query<{ run_type: string; stage: string; month: string }>(
          `SELECT run_type, stage, to_char(month, 'YYYY-MM') AS month FROM payroll_runs
            WHERE deleted_at IS NULL AND month IN ($1::date, $2::date)`,
          [firstOf(m), firstOf(addMonths(m, -1))],
        )
      ).rows;
      const regular = runs.find((r) => r.month === m && r.run_type === 'REGULAR');
      const warnings: string[] = [];
      if (dto.runType === 'REGULAR') {
        if (regular)
          bad(
            `${monthWords(m)} already has its regular run: correct it there, or use a supplementary run once it is locked`,
            409,
          );
        const prev = runs.find((r) => r.month === addMonths(m, -1) && r.run_type === 'REGULAR');
        const anyEarlier = (
          await c.query(
            `SELECT 1 FROM payroll_runs WHERE deleted_at IS NULL AND run_type = 'REGULAR' AND month < $1::date LIMIT 1`,
            [firstOf(m)],
          )
        ).rowCount;
        if (prev && !['LOCKED', 'PAID'].includes(prev.stage))
          bad(
            `${monthWords(addMonths(m, -1))}'s regular run is ${prev.stage.toLowerCase()}: lock it first`,
            409,
          );
        if (!prev && anyEarlier)
          bad(`${monthWords(addMonths(m, -1))} has no regular run: run the months in order`, 409);
        if (!prev && !anyEarlier) warnings.push('The first regular run of this school');
      } else {
        // a supplementary or bonus run only once the regular run is locked (two open runs paid twice)
        if (!regular || !['LOCKED', 'PAID'].includes(regular.stage))
          bad(
            `Lock ${monthWords(m)}'s regular run first: a ${dto.runType.toLowerCase()} run comes after it`,
            409,
          );
      }
      if (dto.runType === 'SUPPLEMENTARY') {
        const hidden = await hiddenFor(c, ctx);
        const ok = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM employees WHERE id::text = ANY($1::text[]) AND deleted_at IS NULL`,
            [dto.employeeIds],
          )
        ).rows.map((r) => r.id);
        if (
          ok.length !== new Set(dto.employeeIds).size ||
          dto.employeeIds!.some((id) => hidden.includes(id))
        )
          bad('An employee named is not found');
      }
      const seq = (
        await c.query<{ n: number }>(
          `SELECT COALESCE(max(seq), 0)::int + 1 AS n FROM payroll_runs WHERE month = $1::date AND run_type = $2`,
          [firstOf(m), dto.runType],
        )
      ).rows[0]!.n;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_runs (school_id, month, run_type, seq, employee_ids, stage, remark, created_by, updated_by)
           VALUES (app.current_school_id(), $1::date, $2, $3, $4::bigint[], 'DRAFT', $5, app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            firstOf(m),
            dto.runType,
            seq,
            dto.runType === 'SUPPLEMENTARY' ? [...new Set(dto.employeeIds)] : null,
            dto.remark ?? null,
          ],
        )
      ).rows[0]!.id;
      await this.event(c, id, 'create', null, 'DRAFT', dto.remark ?? null, { warnings });
      await this.audit.stage(ctx, c, {
        action: 'payroll.run.create',
        entityType: 'payroll_runs',
        entityId: id,
        after: { ...dto },
      });
      return { id, warnings };
    });
  }

  async remove(ctx: RequestContext, id: string) {
    must(ctx, RUN.manage, 'Only payroll makers remove a run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      const n = (await c.query(`SELECT 1 FROM payroll_records WHERE run_id = $1 LIMIT 1`, [id]))
        .rowCount;
      if (run.stage !== 'DRAFT' || n)
        bad('Only a draft run with nothing worked out is removed', 409);
      await c.query(
        `UPDATE payroll_runs SET deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.event(c, id, 'remove', 'DRAFT', null);
      return { ok: true };
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = (
        await c.query<Record<string, unknown>>(
          `SELECT u.id::text, to_char(u.month, 'YYYY-MM') AS month, u.run_type, u.seq, u.stage, u.progress, u.emp_count,
                  u.failed_count, u.gross_total::text, u.deduction_total::text, u.net_total::text, u.remark,
                  u.employee_ids::text[] AS employee_ids, u.created_at, u.approved_at, u.locked_at,
                  c.display_name AS created_by_name, a.display_name AS approved_by_name, l.display_name AS locked_by_name,
                  (u.created_by = app.current_user_id()) AS mine
             FROM payroll_runs u LEFT JOIN users c ON c.id = u.created_by LEFT JOIN users a ON a.id = u.approved_by
             LEFT JOIN users l ON l.id = u.locked_by WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [id],
        )
      ).rows[0];
      if (!run) bad('Run not found', 404);
      const events = (
        await c.query<Record<string, unknown>>(
          `SELECT e.action, e.stage_from, e.stage_to, e.comment, e.detail, e.created_at, u.display_name AS by_name
             FROM payroll_run_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.run_id = $1 ORDER BY e.created_at DESC`,
          [id],
        )
      ).rows.map(camelRow);
      const counts = (
        await c.query<{ status: string; n: number }>(
          `SELECT status, count(*)::int AS n FROM payroll_records WHERE run_id = $1 GROUP BY status`,
          [id],
        )
      ).rows;
      const todo = (await this.eligible(c, await this.runRow(c, id))).length;
      const receipts = (
        await c.query<{ pending: number; posted: number }>(
          `SELECT count(*) FILTER (WHERE a.receipt_pending)::int AS pending, count(*) FILTER (WHERE a.fee_payment_id IS NOT NULL)::int AS posted
             FROM payroll_adhoc a JOIN payroll_records r ON r.id = a.paid_in_record_id WHERE r.run_id = $1 AND a.ref_module = 'FEE'`,
          [id],
        )
      ).rows[0];
      return {
        run: camelRow(run!),
        monthWords: monthWords(run!.month as string),
        counts: Object.fromEntries(counts.map((x) => [x.status, x.n])),
        eligible: todo,
        receipts,
        events,
        can: runCan(ctx),
      };
    });
  }

  // ---- the checks before a run (red stops processing, amber informs) ------------------------------------------------
  async checks(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.checksIn(c, ctx, await this.runRow(c, id)),
    );
  }

  private async checksIn(c: PoolClient, ctx: RequestContext, run: RunRow) {
    const ids = await this.eligible(c, run);
    const m = firstOf(run.month);
    const red: Array<{ employee?: string; text: string }> = [];
    const amber: Array<{ employee?: string; text: string }> = [];
    const hidden = new Set(await hiddenFor(c, ctx));
    if (!ids.length) red.push({ text: 'Nobody to work out in this run' });
    const paid = run.run_type === 'REGULAR' ? new Map() : await this.paidThisMonth(c, run, ids);
    const fullMonth = ids.filter((e) => run.run_type !== 'BONUS' && !paid.has(e));
    const people = (
      await c.query<{
        id: string;
        code: string;
        finalised: boolean | null;
        unmarked: number | null;
        structure: number;
        unversioned: string[];
        profile: boolean;
        pf: boolean | null;
        nps: boolean | null;
        regime: string | null;
        tds_mode: string | null;
        pay_mode: string | null;
        pan: boolean;
        uan: boolean;
        bank: boolean;
        gender: string;
        typed_tax: boolean;
      }>(
        `SELECT e.id::text, e.employee_code AS code, a.finalised, a.unmarked_days AS unmarked,
                (SELECT count(*)::int FROM payroll_structures s WHERE s.employee_id = e.id AND s.status = 'active'
                    AND s.effective_from <= ($2::date + interval '1 month - 1 day') AND (s.effective_to IS NULL OR s.effective_to >= $2::date)) AS structure,
                ARRAY(SELECT DISTINCT h.code FROM payroll_structures s JOIN payroll_pay_heads h ON h.id = s.pay_head_id
                       WHERE s.employee_id = e.id AND s.status = 'active'
                         AND s.effective_from <= ($2::date + interval '1 month - 1 day') AND (s.effective_to IS NULL OR s.effective_to >= $2::date)
                         AND NOT EXISTS (SELECT 1 FROM payroll_pay_head_versions v WHERE v.pay_head_id = h.id AND v.status = 'active'
                                           AND v.effective_from <= ($2::date + interval '1 month - 1 day')
                                           AND (v.effective_to IS NULL OR v.effective_to >= $2::date))) AS unversioned,
                (p.employee_id IS NOT NULL) AS profile, p.pf_applicable AS pf, p.nps_applicable AS nps, p.tax_regime AS regime,
                p.tds_mode, p.pay_mode, (e.secure ? 'pan') AS pan, (COALESCE(e.profile->>'uan', '') <> '') AS uan,
                (e.secure ? 'bank_account_no') AS bank, e.gender::text AS gender,
                EXISTS (SELECT 1 FROM payroll_tds_manual t WHERE t.employee_id = e.id AND t.month = $2::date) AS typed_tax
           FROM employees e LEFT JOIN payroll_profiles p ON p.employee_id = e.id
           LEFT JOIN payroll_attendance a ON a.employee_id = e.id AND a.month = $2::date
          WHERE e.id::text = ANY($1::text[]) ORDER BY e.employee_code`,
        [ids, m],
      )
    ).rows;
    const heads = new Set(
      (
        await c.query<{ code: string }>(
          `SELECT code FROM payroll_pay_heads WHERE status = 'active'`,
        )
      ).rows.map((r) => r.code),
    );
    const s = (
      await c.query<{ state: string | null }>(`SELECT state_code AS state FROM payroll_settings`)
    ).rows[0];
    const fy =
      Number(run.month.slice(5, 7)) >= 4
        ? Number(run.month.slice(0, 4))
        : Number(run.month.slice(0, 4)) - 1;
    const fyLabel = `${String(fy)}-${String((fy + 1) % 100).padStart(2, '0')}`;
    const rules = new Set(
      (
        await c.query<{ regime: string }>(
          `SELECT DISTINCT regime FROM payroll_tds_slabs WHERE fy = $1 AND regime IN (SELECT regime FROM payroll_tds_config WHERE fy = $1)`,
          [fyLabel],
        )
      ).rows.map((r) => r.regime),
    );
    const full = new Set(fullMonth);
    const show = (p: { id: string; code: string }) =>
      hidden.has(p.id) ? 'a confidential employee' : p.code;
    for (const p of people) {
      const who = show(p);
      if (full.has(p.id)) {
        if (!p.finalised)
          red.push({ employee: who, text: 'Attendance not finalised for the month' });
        if (!p.structure) red.push({ employee: who, text: 'No salary structure in force' });
        for (const h of p.unversioned)
          red.push({ employee: who, text: `${h} on the structure has no version in force` });
        if (p.unmarked)
          amber.push({
            employee: who,
            text: `${String(p.unmarked)} unmarked day(s) counted as the settings say`,
          });
      }
      if (!p.profile)
        amber.push({
          employee: who,
          text: 'No payroll profile: the defaults apply (PF and ESI on, new regime)',
        });
      if (!p.pan)
        amber.push({ employee: who, text: 'No PAN: tax at least 20 % of the taxable income' });
      if ((p.pf ?? true) && !p.uan) amber.push({ employee: who, text: 'No UAN while PF applies' });
      if ((p.pay_mode ?? 'BANK') === 'BANK' && !p.bank)
        amber.push({ employee: who, text: 'Paid by bank but no bank account' });
      if (s?.state && p.gender === 'unspecified')
        amber.push({ employee: who, text: 'Gender not set: profession tax as for men' });
      if (
        (p.tds_mode ?? 'PROJECTION') === 'PROJECTION' &&
        !p.typed_tax &&
        !rules.has(p.regime ?? 'NEW')
      )
        red.push({
          employee: who,
          text: `No income-tax slabs for the ${(p.regime ?? 'NEW') === 'NEW' ? 'new' : 'old'} regime in ${fyLabel}`,
        });
    }
    if (people.some((p) => p.nps) && !heads.has('NPS'))
      red.push({ text: 'Staff are on NPS but there is no NPS deduction head' });
    for (const h of ['PF', 'ESI', 'PT', 'TDS'] as const)
      if (!heads.has(h)) red.push({ text: `There is no ${h} deduction head in use` });
    // the same recurring deduction live twice this month
    const dup = (
      await c.query<{ code: string; n: number }>(
        `SELECT e.employee_code AS code, count(*)::int AS n FROM payroll_recurring r JOIN employees e ON e.id = r.employee_id
          WHERE r.status = 'ACTIVE' AND r.start_month <= $1::date AND (r.end_month IS NULL OR r.end_month >= $1::date)
            AND r.employee_id::text = ANY($2::text[])
          GROUP BY e.employee_code, r.pay_head_id, r.payee_id, COALESCE(r.reference_no, '') HAVING count(*) > 1`,
        [m, ids],
      )
    ).rows;
    for (const d of dup)
      amber.push({
        employee: d.code,
        text: `The same recurring deduction ${String(d.n)} times this month`,
      });
    return {
      red,
      amber,
      people: ids.length,
      fullMonth: fullMonth.length,
      topUps: ids.length - fullMonth.length,
      ok: red.length === 0,
    };
  }

  // ---- process: a batch at a time --------------------------------------------------------------------------------
  async process(ctx: RequestContext, id: string) {
    must(ctx, RUN.manage, 'Only payroll makers process a run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let run = await this.runRow(c, id, true);
      if (run.stage === 'REJECTED') {
        // a rejected run is worked out afresh for everyone (the legacy kept the old records and stayed rejected)
        await this.purge(c, id);
        await this.setStage(c, id, 'REJECTED', 'DRAFT');
        await this.event(c, id, 'recompute', 'REJECTED', 'DRAFT');
        run = await this.runRow(c, id);
      }
      if (!['DRAFT', 'PROCESSING'].includes(run.stage))
        bad(`The run is ${run.stage.toLowerCase()}: it is not processed now`, 409);
      const checks = await this.checksIn(c, ctx, run);
      if (!checks.ok)
        bad(
          `${String(checks.red.length)} blocking item(s) must be fixed first: ${checks.red
            .slice(0, 3)
            .map((r) => `${r.employee ? `${r.employee}: ` : ''}${r.text}`)
            .join('; ')}`,
          409,
        );
      const all = await this.eligible(c, run);
      const have = new Set(
        (
          await c.query<{ id: string }>(
            `SELECT employee_id::text AS id FROM payroll_records WHERE run_id = $1 AND status <> 'FAILED'`,
            [id],
          )
        ).rows.map((r) => r.id),
      );
      const todo = all.filter((e) => !have.has(e));
      const slice = todo.slice(0, BATCH);
      await c.query(
        `DELETE FROM payroll_records WHERE run_id = $1 AND status = 'FAILED' AND employee_id::text = ANY($2::text[])`,
        [id, slice],
      );
      if (run.stage === 'DRAFT') {
        await this.setStage(c, id, 'DRAFT', 'PROCESSING');
        await this.event(c, id, 'process', 'DRAFT', 'PROCESSING');
      }
      const mc = await monthContext(c, run.month);
      const paid =
        run.run_type === 'REGULAR'
          ? new Map<string, bigint>()
          : await this.paidThisMonth(c, run, slice);
      const holds = new Map(
        (
          await c.query<{ id: string; reason: string }>(
            `SELECT employee_id::text AS id, reason FROM payroll_holds WHERE month = $1::date AND active AND mode = 'HOLD'`,
            [firstOf(run.month)],
          )
        ).rows.map((r) => [r.id, r.reason]),
      );
      const failures: Record<string, number> = {};
      for (const e of slice) {
        const topUp =
          run.run_type === 'BONUS' || paid.has(e) ? { pfWageUsed: paid.get(e) ?? 0n } : null;
        await c.query('SAVEPOINT pr_emp');
        let failure: {
          code: string;
          reason: string;
          who: { code: string; name: string };
          shortfall?: string;
        } | null = null;
        try {
          const loaded = await loadEmployee(c, mc, e, { topUp, needAttendance: topUp === null });
          if (!loaded.ok)
            failure = { code: loaded.code, reason: loaded.reason, who: loaded.snapshot };
          else {
            const r = calculate(loaded.input);
            if (!r.ok) {
              const short = /-(\d+\.\d{2})/.exec(r.reason)?.[1];
              failure = {
                code: r.code,
                reason: r.reason,
                who: loaded.snapshot,
                ...(short ? { shortfall: short } : {}),
              };
            } else {
              const reason =
                holds.get(e) ??
                (loaded.snapshot.holdProfile ? 'The payroll profile is on hold' : null);
              await this.persist(c, run, e, loaded, r, reason, mc.headIds, mc.fy);
            }
          }
          await c.query('RELEASE SAVEPOINT pr_emp');
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT pr_emp');
          failure = {
            code: 'ERROR',
            reason: err instanceof Error ? err.message : 'Could not be worked out',
            who: { code: '?', name: '?' },
          };
        }
        if (failure) {
          failures[failure.code] = (failures[failure.code] ?? 0) + 1;
          const who =
            failure.who.code === '?'
              ? ((
                  await c.query<{ code: string; name: string }>(
                    `SELECT employee_code AS code, display_name AS name FROM employees WHERE id = $1`,
                    [e],
                  )
                ).rows[0] ?? failure.who)
              : failure.who;
          await c.query(
            `INSERT INTO payroll_records (school_id, run_id, employee_id, month, status, failure_code, failure_reason,
                                          employee_code, employee_name, trace)
             VALUES (app.current_school_id(), $1, $2, $3::date, 'FAILED', $4, $5, $6, $7, $8::jsonb)`,
            [
              id,
              e,
              firstOf(run.month),
              failure.code,
              failure.reason.slice(0, 300),
              who.code,
              who.name,
              JSON.stringify(failure.shortfall ? { shortfall: failure.shortfall } : {}),
            ],
          );
        }
      }
      const left = todo.length - slice.length;
      const progress = all.length ? Math.floor(((all.length - left) / all.length) * 100) : 100;
      await this.totals(c, id, progress);
      if (left === 0) {
        await this.setStage(c, id, 'PROCESSING', 'REVIEW');
        await this.event(c, id, 'processed', 'PROCESSING', 'REVIEW', null, { failures });
      }
      return { done: left === 0, processed: slice.length, left, progress, failures };
    });
  }

  private async totals(c: PoolClient, runId: string, progress?: number) {
    await c.query(
      `UPDATE payroll_runs u SET emp_count = t.n, failed_count = t.f, gross_total = t.g, deduction_total = t.d, net_total = t.net,
              progress = COALESCE($2, u.progress), updated_at = now()
         FROM (SELECT count(*) FILTER (WHERE status <> 'FAILED')::int AS n, count(*) FILTER (WHERE status = 'FAILED')::int AS f,
                      COALESCE(sum(gross_earned) FILTER (WHERE status <> 'FAILED'), 0) AS g,
                      COALESCE(sum(total_deductions) FILTER (WHERE status <> 'FAILED'), 0) AS d,
                      COALESCE(sum(net_pay) FILTER (WHERE status <> 'FAILED'), 0) AS net
                 FROM payroll_records WHERE run_id = $1) t
        WHERE u.id = $1`,
      [runId, progress ?? null],
    );
  }

  /** The record, its lines and side rows; and in the same savepoint what it consumed. */
  private async persist(
    c: PoolClient,
    run: RunRow,
    employeeId: string,
    loaded: Extract<Awaited<ReturnType<typeof loadEmployee>>, { ok: true }>,
    r: CalcResult,
    holdReason: string | null,
    headIds: Record<string, string>,
    fy: string,
  ) {
    const sn: Snapshot = loaded.snapshot;
    const a = loaded.input.attendance;
    const top = loaded.input.topUp !== null;
    const net = S(r.netPay);
    const recordId = (
      await c.query<{ id: string }>(
        `INSERT INTO payroll_records (school_id, run_id, employee_id, month, status, is_top_up, employee_code, employee_name,
                                      designation, department, pan_masked, uan, pf_number, esi_number, pay_level, pay_mode, bank_name,
                                      bank_ifsc, bank_account_masked, bank_account_enc, tax_regime, month_days, paid_days, lop_days,
                                      ncp_days, gross_fixed, gross_earned, lop_amount, pf_wage, esi_wage, pt_wage, pt_amount, it_amount,
                                      cess_amount, total_deductions, net_pay, net_in_words, trace, warnings, held_reason)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                 $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37::jsonb, $38::text[], $39)
         RETURNING id::text`,
        [
          run.id,
          employeeId,
          firstOf(run.month),
          holdReason ? 'HELD' : 'COMPUTED',
          top,
          sn.code,
          sn.name,
          sn.designation,
          sn.department,
          sn.panMasked,
          sn.uan,
          sn.pfNumber,
          sn.esiNumber,
          sn.payLevel,
          sn.payMode,
          sn.bankName,
          sn.bankIfsc,
          sn.bankMasked,
          sn.bankEnc,
          sn.taxRegime,
          top ? '0' : a.monthDays,
          top ? '0' : a.paidDays,
          top ? '0' : a.lopDays,
          (Number(r.ncpDays) / 100).toFixed(2),
          S(r.grossFixed),
          S(r.grossEarned),
          S(r.lopAmount),
          S(r.pfWage),
          S(r.esiWage),
          S(r.ptWage),
          S(r.ptAmount),
          S(r.itAmount),
          S(r.cessAmount),
          S(r.totalDeductions),
          net,
          amountInWords(net),
          JSON.stringify(r.trace, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
          r.warnings,
          holdReason,
        ],
      )
    ).rows[0]!.id;
    for (const l of r.lines)
      await c.query(
        `INSERT INTO payroll_record_lines (school_id, record_id, pay_head_id, code, name, head_type, rate, amount, is_arrear,
                                           is_structure, is_taxable, calc_order, print_order, show_if_zero, source_kind, source_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          recordId,
          headIds[l.code] ?? null,
          l.code,
          l.name,
          l.headType,
          S(l.rate),
          S(l.earned),
          l.isArrear,
          l.isStructure,
          l.taxable,
          l.calcOrder,
          l.printOrder,
          l.showIfZero,
          l.source.kind,
          l.source.id ?? null,
        ],
      );
    const pf = r.pf;
    await c.query(
      `INSERT INTO payroll_record_statutory (record_id, school_id, pf_wage, eps_wage, edli_wage, ee_pf, vpf, er_eps, er_epf, edli,
                                             pf_admin, ncp_days, nps_wage, nps_ee, nps_er, esi_covered, esi_wage, esi_ee, esi_er,
                                             lwf_state, lwf_ee, lwf_er)
       VALUES ($1, app.current_school_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
               (SELECT state_code FROM payroll_settings), $19, $20)`,
      [
        recordId,
        S(pf?.pfWage ?? 0n),
        S(pf?.epsWage ?? 0n),
        S(pf?.edliWage ?? 0n),
        S(pf?.eePf ?? 0n),
        S(pf?.vpf ?? 0n),
        S(pf?.erEps ?? 0n),
        S(pf?.erEpf ?? 0n),
        S(pf?.edli ?? 0n),
        S(pf?.admin ?? 0n),
        (Number(r.ncpDays) / 100).toFixed(2),
        r.nps ? S(r.nps.wage) : null,
        r.nps ? S(r.nps.ee) : null,
        r.nps ? S(r.nps.er) : null,
        r.esi ? r.esi.covered : null,
        r.esi ? S(r.esi.wage) : null,
        r.esi ? S(r.esi.ee) : null,
        r.esi ? S(r.esi.er) : null,
        r.lwf ? S(r.lwf.ee) : null,
        r.lwf ? S(r.lwf.er) : null,
      ],
    );
    const t = r.tds;
    if (t && 'manual' in t)
      await c.query(
        `INSERT INTO payroll_record_tax (record_id, school_id, fy, mode, monthly_tds) VALUES ($1, app.current_school_id(), $2, 'TYPED', $3)`,
        [recordId, fy, S(t.it + t.cess)],
      );
    else if (t)
      await c.query(
        `INSERT INTO payroll_record_tax (record_id, school_id, fy, mode, regime, gross_projection, standard_deduction, pt_deduction,
                                         other_deductions, taxable_income, slab_tax, rebate, surcharge, cess, annual_tax, ytd_tds,
                                         months_left, monthly_tds, pan_absent)
         VALUES ($1, app.current_school_id(), $2, 'PROJECTION', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          recordId,
          fy,
          loaded.input.profile.taxRegime,
          S(t.gross),
          S(t.standardDeduction),
          S(t.ptDeduction),
          S(t.otherDeductions),
          S(t.tax.taxable),
          S(t.tax.slabTax),
          S(t.tax.rebate),
          S(t.tax.surcharge),
          S(t.tax.cess),
          S(t.tax.total),
          S(t.ytdTds),
          t.monthsLeft,
          S(t.monthly),
          t.tax.panAbsent,
        ],
      );
    else
      await c.query(
        `INSERT INTO payroll_record_tax (record_id, school_id, fy, mode, monthly_tds) VALUES ($1, app.current_school_id(), $2, 'NONE', 0)`,
        [recordId, fy],
      );
    for (const l of r.loans) {
      await c.query(
        `INSERT INTO payroll_record_loans (record_id, loan_id, school_id, opening, interest, emi, principal, closing)
         SELECT $1, $2, app.current_school_id(), balance, $3, $4, $5, $6 FROM payroll_loans WHERE id = $2`,
        [recordId, l.id, S(l.interest), S(l.emi), S(l.principal), S(l.closing)],
      );
      await c.query(
        `UPDATE payroll_loans SET balance = $2, status = CASE WHEN $2::numeric <= 0 THEN 'CLOSED' ELSE status END,
                updated_at = now() WHERE id = $1`,
        [l.id, S(l.closing < 0n ? 0n : l.closing)],
      );
    }
    if (r.used.arrears.length)
      await c.query(
        `UPDATE payroll_arrears SET paid_in_record_id = $1 WHERE id::text = ANY($2::text[])`,
        [recordId, r.used.arrears],
      );
    if (r.used.adhoc.length) {
      await c.query(
        `UPDATE payroll_adhoc SET paid_in_record_id = $1, updated_at = now() WHERE id::text = ANY($2::text[])`,
        [recordId, r.used.adhoc],
      );
      await c.query(
        `UPDATE payroll_claims SET status = 'PAID', paid_in_record_id = $1, updated_at = now()
          WHERE adhoc_id::text = ANY($2::text[]) AND status = 'APPROVED'`,
        [recordId, r.used.adhoc],
      );
    }
    if (r.esi && !loaded.esiDecided)
      await c.query(
        `INSERT INTO payroll_esi_coverage (school_id, employee_id, period_start, covered, wage_at_start, record_id)
         VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [employeeId, loaded.esiPeriod, r.esi.covered, S(r.esi.wage), recordId],
      );
    return recordId;
  }

  /** Everything a run's records consumed given back, then the records removed (a reprocess starts clean). */
  private async purge(c: PoolClient, runId: string) {
    await c.query(
      `UPDATE payroll_loans l SET balance = l.balance + x.principal,
              status = CASE WHEN l.status = 'CLOSED' AND x.closing <= 0 THEN 'ACTIVE' ELSE l.status END, updated_at = now()
         FROM payroll_record_loans x JOIN payroll_records r ON r.id = x.record_id
        WHERE r.run_id = $1 AND l.id = x.loan_id`,
      [runId],
    );
    await c.query(
      `UPDATE payroll_arrears SET paid_in_record_id = NULL
        WHERE paid_in_record_id IN (SELECT id FROM payroll_records WHERE run_id = $1)`,
      [runId],
    );
    await c.query(
      `UPDATE payroll_adhoc SET paid_in_record_id = NULL
        WHERE paid_in_record_id IN (SELECT id FROM payroll_records WHERE run_id = $1)`,
      [runId],
    );
    await c.query(
      `UPDATE payroll_claims SET status = 'APPROVED', paid_in_record_id = NULL
        WHERE paid_in_record_id IN (SELECT id FROM payroll_records WHERE run_id = $1)`,
      [runId],
    );
    await c.query(`DELETE FROM payroll_records WHERE run_id = $1`, [runId]);
    await this.totals(c, runId, 0);
  }

  // ---- review ------------------------------------------------------------------------------------------------
  async records(ctx: RequestContext, id: string, q: RecordListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id);
      const hidden = await hiddenFor(c, ctx);
      const rows = (
        await c.query<{
          id: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
          department: string | null;
          status: string;
          failure_code: string | null;
          failure_reason: string | null;
          is_top_up: boolean;
          paid_days: string;
          lop_days: string;
          gross_earned: string;
          total_deductions: string;
          net_pay: string;
          bank_account_enc: string | null;
          bank_ifsc: string | null;
          pay_mode: string | null;
          warnings: string[];
          held_reason: string | null;
          prev_net: string | null;
          prev_lop: string | null;
          prev_bank: string | null;
          prev_ifsc: string | null;
        }>(
          `SELECT r.id::text, r.employee_id::text, r.employee_code, r.employee_name, r.department, r.status, r.failure_code,
                  r.failure_reason, r.is_top_up, r.paid_days::text, r.lop_days::text, r.gross_earned::text,
                  r.total_deductions::text, r.net_pay::text, r.bank_account_enc, r.bank_ifsc, r.pay_mode, r.warnings, r.held_reason,
                  p.net_pay::text AS prev_net, p.lop_days::text AS prev_lop, p.bank_account_enc AS prev_bank, p.bank_ifsc AS prev_ifsc
             FROM payroll_records r
             LEFT JOIN LATERAL (
               SELECT x.* FROM payroll_records x JOIN payroll_runs u ON u.id = x.run_id
                WHERE x.employee_id = r.employee_id AND x.month = ($2::date - interval '1 month')::date AND x.status <> 'FAILED'
                  AND NOT x.is_top_up AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL
                ORDER BY x.id DESC LIMIT 1) p ON true
            WHERE r.run_id = $1 AND NOT (r.employee_id::text = ANY($3::text[]))
            ORDER BY (r.status = 'FAILED') DESC, r.employee_code`,
          [id, firstOf(run.month), hidden],
        )
      ).rows;
      const plain = (v: string | null) => (v ? decryptField(v) : null);
      const accounts = new Map<string, number>();
      for (const r of rows) {
        const acc = plain(r.bank_account_enc);
        if (acc && r.status !== 'FAILED')
          accounts.set(
            `${r.bank_ifsc ?? ''}|${acc}`,
            (accounts.get(`${r.bank_ifsc ?? ''}|${acc}`) ?? 0) + 1,
          );
      }
      const shaped = rows.map((r) => {
        const flags: string[] = [];
        if (r.status !== 'FAILED') {
          const net = Number(r.net_pay);
          if (net === 0) flags.push('ZERO_NET');
          if (r.prev_net === null) flags.push('NEW');
          else if (
            Number(r.prev_net) > 0 &&
            Math.abs(net - Number(r.prev_net)) / Number(r.prev_net) > 0.1
          )
            flags.push('NET_CHANGED');
          const acc = plain(r.bank_account_enc);
          const prev = plain(r.prev_bank);
          if (prev && (prev !== acc || r.prev_ifsc !== r.bank_ifsc)) flags.push('BANK_CHANGED');
          if (r.prev_lop !== null && Number(r.lop_days) - Number(r.prev_lop) > 10)
            flags.push('LOP_SPIKE');
          if (acc && (accounts.get(`${r.bank_ifsc ?? ''}|${acc}`) ?? 0) > 1)
            flags.push('SAME_ACCOUNT');
          if (r.pay_mode === 'BANK' && !acc && net > 0) flags.push('NO_BANK');
        }
        return {
          id: r.id,
          employeeId: r.employee_id,
          code: r.employee_code,
          name: r.employee_name,
          department: r.department,
          status: r.status,
          failureCode: r.failure_code,
          failureReason: r.failure_reason,
          isTopUp: r.is_top_up,
          paidDays: r.paid_days,
          lopDays: r.lop_days,
          gross: r.gross_earned,
          deductions: r.total_deductions,
          net: r.net_pay,
          prevNet: r.prev_net,
          heldReason: r.held_reason,
          warnings: r.warnings,
          flags,
        };
      });
      const text = (q.q ?? '').toLowerCase();
      const shown = shaped.filter((r) => {
        if (text && !`${r.code} ${r.name}`.toLowerCase().includes(text)) return false;
        if (q.show === 'failed') return r.status === 'FAILED';
        if (q.show === 'held') return r.status === 'HELD';
        if (q.show === 'flagged') return r.flags.length > 0 || r.warnings.length > 0;
        if (q.show === 'topup') return r.isTopUp;
        return true;
      });
      return {
        rows: shown.slice((q.page - 1) * q.size, q.page * q.size),
        total: shown.length,
        page: q.page,
        size: q.size,
        summary: {
          records: shaped.length,
          failed: shaped.filter((r) => r.status === 'FAILED').length,
          held: shaped.filter((r) => r.status === 'HELD').length,
          flagged: shaped.filter((r) => r.flags.length > 0).length,
          zeroNet: shaped.filter((r) => r.flags.includes('ZERO_NET')).length,
          new: shaped.filter((r) => r.flags.includes('NEW')).length,
        },
        can: runCan(ctx),
      };
    });
  }

  /** One record: its lines, statutory figures, tax, loans and the trace of where each amount came from. */
  async record(ctx: RequestContext, id: string, recordId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<Record<string, unknown>>(
          `SELECT r.*, r.id::text AS id, r.employee_id::text AS employee_id, r.run_id::text AS run_id, to_char(r.month, 'YYYY-MM') AS month,
                  u.stage AS run_stage, u.run_type
             FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id WHERE r.id = $1 AND r.run_id = $2`,
          [recordId, id],
        )
      ).rows[0];
      if (!r || (await hiddenFor(c, ctx)).includes(r.employee_id as string))
        bad('Record not found', 404);
      const rec = camelRow(r!);
      delete rec.bankAccountEnc;
      delete rec.schoolId;
      delete rec.payslip;
      const lines = (
        await c.query<Record<string, unknown>>(
          `SELECT code, name, head_type, rate::text, amount::text, is_arrear, is_structure, is_taxable, calc_order, print_order,
                  source_kind, source_id FROM payroll_record_lines WHERE record_id = $1 ORDER BY calc_order`,
          [recordId],
        )
      ).rows.map(camelRow);
      const statutory = (
        await c.query<Record<string, unknown>>(
          `SELECT * FROM payroll_record_statutory WHERE record_id = $1`,
          [recordId],
        )
      ).rows.map(camelRow)[0];
      const tax = (
        await c.query<Record<string, unknown>>(
          `SELECT * FROM payroll_record_tax WHERE record_id = $1`,
          [recordId],
        )
      ).rows.map(camelRow)[0];
      const loans = (
        await c.query<Record<string, unknown>>(
          `SELECT x.loan_id::text, l.loan_type, x.opening::text, x.interest::text, x.emi::text, x.principal::text, x.closing::text
             FROM payroll_record_loans x JOIN payroll_loans l ON l.id = x.loan_id WHERE x.record_id = $1`,
          [recordId],
        )
      ).rows.map(camelRow);
      for (const o of [statutory, tax]) if (o) delete o.schoolId;
      return {
        record: rec,
        lines,
        statutory: statutory ?? null,
        tax: tax ?? null,
        loans,
        can: runCan(ctx),
      };
    });
  }

  // ---- the stages ----------------------------------------------------------------------------------------------------
  async approve(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker approves a run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      if (run.stage !== 'REVIEW')
        bad(`The run is ${run.stage.toLowerCase()}: only a run in review is approved`, 409);
      if (run.mine && !has(ctx, PAYROLL.admin))
        bad('You created this run: a different checker approves it', 403);
      const n = (
        await c.query<{ failed: number; ok: number }>(
          `SELECT count(*) FILTER (WHERE status = 'FAILED')::int AS failed, count(*) FILTER (WHERE status <> 'FAILED')::int AS ok
             FROM payroll_records WHERE run_id = $1`,
          [id],
        )
      ).rows[0]!;
      if (n.failed)
        bad(
          `${String(n.failed)} record(s) failed: fix them and process again, or drop them first`,
          409,
        );
      // the legacy let an empty run be approved after a reopen
      if (!n.ok) bad('The run has no records: process it first', 409);
      await this.setStage(
        c,
        id,
        'REVIEW',
        'APPROVED',
        ', approved_by = app.current_user_id(), approved_at = now()',
      );
      await this.event(c, id, 'approve', 'REVIEW', 'APPROVED');
      await this.audit.stage(ctx, c, {
        action: 'payroll.run.approve',
        entityType: 'payroll_runs',
        entityId: id,
      });
      return { message: 'Approved. Lock it to release the payslips.' };
    });
  }

  async reject(ctx: RequestContext, id: string, dto: CommentDto) {
    must(ctx, RUN.approve, 'Only a payroll checker rejects a run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      if (run.stage !== 'REVIEW')
        bad(`The run is ${run.stage.toLowerCase()}: only a run in review is rejected`, 409);
      await this.setStage(c, id, 'REVIEW', 'REJECTED');
      await this.event(c, id, 'reject', 'REVIEW', 'REJECTED', dto.comment);
      await this.audit.stage(ctx, c, {
        action: 'payroll.run.reject',
        entityType: 'payroll_runs',
        entityId: id,
        after: { ...dto },
      });
      return { message: 'Rejected: a maker corrects the inputs and processes it again.' };
    });
  }

  /** Lock (a checker): the payslips are frozen and released; fee recovery's receipts are posted in Fees. */
  async lock(ctx: RequestContext, id: string) {
    must(ctx, RUN.approve, 'Only a payroll checker locks a run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      if (run.stage !== 'APPROVED')
        bad(`The run is ${run.stage.toLowerCase()}: only an approved run is locked`, 409);
      await this.setStage(
        c,
        id,
        'APPROVED',
        'LOCKED',
        ', locked_by = app.current_user_id(), locked_at = now()',
      );
      const recs = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM payroll_records WHERE run_id = $1 AND status <> 'FAILED'`,
          [id],
        )
      ).rows;
      for (const r of recs) {
        const slip = await buildPayslip(c, r.id);
        await c.query(`UPDATE payroll_records SET payslip = $2::jsonb WHERE id = $1`, [
          r.id,
          JSON.stringify(slip),
        ]);
      }
      const receipts = await this.postReceipts(c, id, run.month);
      await this.event(c, id, 'lock', 'APPROVED', 'LOCKED', null, receipts);
      await this.audit.stage(ctx, c, {
        action: 'payroll.run.lock',
        entityType: 'payroll_runs',
        entityId: id,
        after: receipts,
      });
      return {
        message: `Locked: ${String(recs.length)} payslip(s) released.${
          receipts.posted ? ` ${String(receipts.posted)} fee receipt(s) posted.` : ''
        }${receipts.failed.length ? ` ${String(receipts.failed.length)} fee receipt(s) could not be posted: ${receipts.failed[0]!}` : ''}`,
      };
    });
  }

  /** Fee recovery's receipts, posted in Fees as "Salary deduction" (the legacy only listed them). */
  private async postReceipts(c: PoolClient, runId: string, month: string) {
    const rows = (
      await c.query<{
        id: string;
        amount: string;
        detail: { studentId?: string; academicYearId?: string; dueOn?: string };
        code: string;
      }>(
        `SELECT a.id::text, a.amount::text, a.detail, r.employee_code AS code FROM payroll_adhoc a
           JOIN payroll_records r ON r.id = a.paid_in_record_id
          WHERE r.run_id = $1 AND r.status <> 'FAILED' AND a.ref_module = 'FEE' AND a.receipt_pending`,
        [runId],
      )
    ).rows;
    let posted = 0;
    const failed: string[] = [];
    for (const r of rows) {
      await c.query('SAVEPOINT pr_fee');
      try {
        const pay = (
          await c.query<{ o_payment_id: string }>(
            `SELECT o_payment_id::text FROM app.post_receipt($1, $2, $3, $4::date, 'bank', $5, $6, NULL, NULL, NULL, NULL, 'school'::ledger_type, false, false)`,
            [
              r.detail.studentId,
              r.detail.academicYearId,
              r.amount,
              today(),
              `Salary ${monthWords(month)}`.slice(0, 60),
              `Deducted from the salary of ${r.code} for ${monthWords(month)}`.slice(0, 300),
            ],
          )
        ).rows[0]!.o_payment_id;
        await c.query(`UPDATE fee_payments SET mode_label = 'Salary deduction' WHERE id = $1`, [
          pay,
        ]);
        await c.query(
          `UPDATE payroll_adhoc SET fee_payment_id = $2, receipt_pending = false, updated_at = now() WHERE id = $1`,
          [r.id, pay],
        );
        await c.query('RELEASE SAVEPOINT pr_fee');
        posted += 1;
      } catch (err) {
        await c.query('ROLLBACK TO SAVEPOINT pr_fee');
        failed.push(`${r.code}: ${err instanceof Error ? err.message : 'refused'}`.slice(0, 200));
      }
    }
    return { posted, failed };
  }

  async unapprove(ctx: RequestContext, id: string, dto: CommentDto) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin unapproves a run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      if (run.stage !== 'APPROVED')
        bad(
          run.stage === 'LOCKED'
            ? 'A locked run is reopened, not unapproved'
            : 'Only an approved run is unapproved',
          409,
        );
      await this.setStage(
        c,
        id,
        'APPROVED',
        'REJECTED',
        ', approved_by = NULL, approved_at = NULL',
      );
      await this.event(c, id, 'unapprove', 'APPROVED', 'REJECTED', dto.comment);
      await this.audit.stage(ctx, c, {
        action: 'payroll.run.unapprove',
        entityType: 'payroll_runs',
        entityId: id,
        after: { ...dto },
      });
      return { message: 'Unapproved: it is rejected; processing it again works it out afresh.' };
    });
  }

  /** Reopen (the payroll admin): back to draft, everything it consumed given back, its fee receipts reversed. */
  async reopen(ctx: RequestContext, id: string, dto: CommentDto) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin reopens a run');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      if (run.stage !== 'LOCKED')
        bad(
          run.stage === 'PAID'
            ? 'A paid run is never reopened: correct it with arrears or a supplementary run'
            : 'Only a locked run is reopened',
          409,
        );
      const later = (
        await c.query(
          `SELECT 1 FROM payroll_runs WHERE deleted_at IS NULL AND id <> $1 AND month >= $2::date AND stage <> 'DRAFT'
              AND (month > $2::date OR run_type <> 'REGULAR') LIMIT 1`,
          [id, firstOf(run.month)],
        )
      ).rowCount;
      if (later) bad('A later run exists: reopen it first (from the latest)', 409);
      const fees = (
        await c.query<{ id: string; pay: string }>(
          `SELECT a.id::text, a.fee_payment_id::text AS pay FROM payroll_adhoc a JOIN payroll_records r ON r.id = a.paid_in_record_id
            WHERE r.run_id = $1 AND a.fee_payment_id IS NOT NULL`,
          [id],
        )
      ).rows;
      for (const f of fees) {
        await c.query(`SELECT app.reverse_fee_payment($1, 'reversed', $2, 0, NULL)`, [
          f.pay,
          `Payroll run reopened: ${dto.comment}`.slice(0, 300),
        ]);
        await c.query(
          `UPDATE payroll_adhoc SET fee_payment_id = NULL, receipt_pending = true, updated_at = now() WHERE id = $1`,
          [f.id],
        );
      }
      await this.purge(c, id);
      await this.setStage(
        c,
        id,
        'LOCKED',
        'DRAFT',
        ', approved_by = NULL, approved_at = NULL, locked_by = NULL, locked_at = NULL',
      );
      await this.event(c, id, 'reopen', 'LOCKED', 'DRAFT', dto.comment, {
        feeReceiptsReversed: fees.length,
      });
      await this.audit.stage(ctx, c, {
        action: 'payroll.run.reopen',
        entityType: 'payroll_runs',
        entityId: id,
        after: { ...dto },
      });
      return {
        message: `Reopened: back to draft, to be processed again.${fees.length ? ` ${String(fees.length)} fee receipt(s) reversed.` : ''}`,
      };
    });
  }

  async dropFailed(ctx: RequestContext, id: string, dto: DropDto) {
    must(ctx, RUN.approve, 'Only a payroll checker drops failed records');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      if (!['DRAFT', 'REVIEW', 'REJECTED'].includes(run.stage))
        bad(`The run is ${run.stage.toLowerCase()}: nothing is dropped now`, 409);
      const gone = (
        await c.query<{ code: string }>(
          `DELETE FROM payroll_records WHERE run_id = $1 AND status = 'FAILED' RETURNING employee_code AS code`,
          [id],
        )
      ).rows;
      if (!gone.length) bad('No failed record to drop', 409);
      await this.totals(c, id);
      await this.event(c, id, 'drop_failed', run.stage, run.stage, dto.reason, {
        employees: gone.map((g) => g.code),
      });
      await this.audit.stage(ctx, c, {
        action: 'payroll.run.drop_failed',
        entityType: 'payroll_runs',
        entityId: id,
        after: { ...dto, gone },
      });
      return {
        message: `${String(gone.length)} dropped: they are not paid in this run (a supplementary run can pay them later).`,
      };
    });
  }

  async hold(
    ctx: RequestContext,
    id: string,
    recordId: string,
    dto: HoldRecordDto,
    release: boolean,
  ) {
    must(ctx, RUN.approve, 'Only a payroll checker holds or releases a salary');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id);
      if (!['APPROVED', 'LOCKED', 'PAID'].includes(run.stage))
        bad('A salary is held or released once the run is approved', 409);
      const r = await c.query(
        `UPDATE payroll_records SET status = $3, held_reason = $4, updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1 AND run_id = $2 AND status = $5`,
        [
          recordId,
          id,
          release ? 'RELEASED' : 'HELD',
          release ? null : dto.reason,
          release ? 'HELD' : 'COMPUTED',
        ],
      );
      if (!r.rowCount)
        bad(
          release ? 'Only a held salary is released' : 'Only a salary not yet held or paid is held',
          409,
        );
      await this.event(c, id, release ? 'release' : 'hold', run.stage, run.stage, dto.reason, {
        record: recordId,
      });
      return {
        message: release
          ? 'Released: it is paid with the bank file.'
          : 'Held: not paid until released.',
      };
    });
  }

  /** A negative net carried as a recovery: a no-interest loan from next month and an offset this month, together. */
  async recovery(ctx: RequestContext, id: string, recordId: string, dto: RecoveryDto) {
    must(ctx, RUN.approve, 'Only a payroll checker sets up a recovery');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runRow(c, id, true);
      if (!['DRAFT', 'PROCESSING', 'REVIEW', 'REJECTED'].includes(run.stage))
        bad('Not while the run is approved or locked', 409);
      const r = (
        await c.query<{ employee_id: string; code: string; shortfall: string | null }>(
          `SELECT employee_id::text, failure_code AS code, trace->>'shortfall' AS shortfall FROM payroll_records
            WHERE id = $1 AND run_id = $2 AND status = 'FAILED'`,
          [recordId, id],
        )
      ).rows[0];
      if (!r || r.code !== 'NEGATIVE_NET' || !r.shortfall)
        bad('Only a record failed for a negative net is recovered', 409);
      // the head first: the legacy created the loan before finding the head missing
      const misc = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM payroll_pay_heads WHERE code = 'MISC_DED' AND head_type = 'DEDUCTION' AND status = 'active'`,
        )
      ).rows[0];
      if (!misc) bad('There is no MISC_DED deduction head in use: add it in Pay heads first', 409);
      const loan = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_loans (school_id, employee_id, loan_type, principal, emi, interest_rate, interest_method, balance,
                                      start_month, status, remarks, created_by, updated_by)
           VALUES (app.current_school_id(), $1, 'RECOVERY', $2, LEAST($3::numeric, $2::numeric), 0, 'NONE', $2, $4::date, 'ACTIVE', $5,
                   app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            r!.employee_id,
            r!.shortfall,
            dto.emi,
            firstOf(addMonths(run.month, 1)),
            `The negative net of ${monthWords(run.month)}`,
          ],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO payroll_adhoc (school_id, employee_id, month, pay_head_id, amount, ref_module, ref_id, remarks, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::date, $3, -$4::numeric, 'RECOVERY', $5, 'Carried to the recovery schedule',
                 app.current_user_id(), app.current_user_id())`,
        [r!.employee_id, firstOf(run.month), misc!.id, r!.shortfall, `RECOVERY/${loan}`],
      );
      await c.query(`DELETE FROM payroll_records WHERE id = $1`, [recordId]);
      if (run.stage === 'REVIEW') await this.setStage(c, id, 'REVIEW', 'PROCESSING');
      await this.totals(c, id);
      await this.event(
        c,
        id,
        'recovery',
        run.stage,
        run.stage === 'REVIEW' ? 'PROCESSING' : run.stage,
        null,
        {
          record: recordId,
          loan,
          shortfall: r!.shortfall,
        },
      );
      return {
        loanId: loan,
        message: `₹${r!.shortfall} is recovered from next month. Process the run again for this employee.`,
      };
    });
  }
}
