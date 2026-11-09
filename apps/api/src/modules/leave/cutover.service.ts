import { Injectable } from '@nestjs/common';
import { QUEUES, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { buildLevels } from '../people/approval-levels';
import { fyStart } from '../purchase/purchase-reports.service';
import { istToday } from '../purchase/purchase-stock-core';
import { AttendanceService } from './attendance.service';
import { addDays, dmy, fail, monthStart, monthWords } from './leave-engine';
import { BANDS, REG_BAND, type CutoverSettingsDto } from './leave.dto';
import { LeaveService } from './leave.service';

export type CutoverStep = 'setup' | 'balances' | 'history';
const STEPS: CutoverStep[] = ['setup', 'balances', 'history'];
type P = Record<string, unknown>;
export interface Problem {
  step: CutoverStep;
  what: string;
  count: number;
  examples: string[];
}
class Run {
  counts: Record<string, number> = {};
  problems: Problem[] = [];
  constructor(public step: CutoverStep) {}
  add(k: string, n = 1) {
    this.counts[k] = (this.counts[k] ?? 0) + n;
  }
  problem(what: string, example?: string | null) {
    let p = this.problems.find((x) => x.what === what);
    if (!p) this.problems.push((p = { step: this.step, what, count: 0, examples: [] }));
    p.count += 1;
    if (example && p.examples.length < 8 && !p.examples.includes(example)) p.examples.push(example);
  }
}

const b = (v: unknown) => v === 1 || v === '1' || v === true;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const pos = (v: unknown) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const time = (v: unknown) => (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str(v)) ? str(v).slice(0, 8) : null);
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : null);
const live = (p: P) => !b(p.isTrash) && str(p.Status) !== '0';
/** The old "Financial year" text to sort by (the latest first). */
const fyKey = (p: P) => str(p.FinancialYear);
const SCOPES: Record<string, string> = {
  '': 'all',
  ALL: 'all',
  DEPARTMENT: 'department',
  DESIGNATION: 'designation',
  EMPLOYEETYPE: 'employee_type',
  EMPID: 'employee',
};
/** The old reports' access keys and the reports here they open. */
const REPORT_KEYS: Record<string, string[]> = {
  daily: ['daily'],
  youttin: ['in_out'],
  monthly: ['monthly_summary', 'monthly_employee', 'monthly_register'],
  monthempatt: ['card'],
  monthbasic: ['basic_work'],
  monthcum: ['monthly_cumulative'],
  annual: ['annual'],
  empyearly: ['employee_yearly'],
  cumulative: ['year_on_year'],
  late: ['late_arrival'],
  early: ['early_going'],
  forgot: ['forgot_punch'],
  availed: ['leave_availed'],
  deduction: ['leave_deduction'],
  balance: ['balance_as_on'],
  monthbal: ['opening_closing'],
};

/**
 * Moving from the earlier leave module (docs/design/85, phase E): the workers read the old database into the
 * staging rows; here they are previewed (each step run and rolled back, with what would come and what
 * cannot), then brought step by step — the set-up, the balances to the month before the parallel month,
 * this year's history (again each day of the parallel month: the old module stays the record until the
 * switch) — compared during the parallel month, and switched: what still waits comes in waiting at the
 * first level.
 */
@Injectable()
export class LeaveCutoverService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly leave: LeaveService,
    private readonly att: AttendanceService,
  ) {}

  private must(ctx: RequestContext, manage = true) {
    if (!(ctx.permissions?.has(manage ? 'leave.setup.manage' : 'leave.setup.view') ?? false))
      throw new DomainError(
        'permission-denied',
        'Only the leave office moves from the old module',
        {
          status: 403,
        },
      );
  }

  /** The school's cut-over (made by the first action; reading it changes nothing). */
  private async row(c: PoolClient, make = true) {
    if (make)
      await c.query(
        `INSERT INTO staff_cutover (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
      );
    const found = (
      await c.query<{
        parallel_month: string | null;
        freeze_on: string | null;
        status: 'setup' | 'parallel' | 'switched';
        read_requested_at: Date | null;
        read_started_at: Date | null;
        read_at: Date | null;
        read_error: string | null;
        read_counts: Record<string, number>;
        steps: Record<
          string,
          { at: string; by: string | null; counts: Record<string, number>; problems?: Problem[] }
        >;
        switched_at: Date | null;
      }>(
        `SELECT parallel_month::text, freeze_on::text, status, read_requested_at, read_started_at, read_at, read_error, read_counts,
                steps, switched_at FROM staff_cutover`,
      )
    ).rows[0];
    return (
      found ?? {
        parallel_month: null,
        freeze_on: null,
        status: 'setup' as const,
        read_requested_at: null,
        read_started_at: null,
        read_at: null,
        read_error: null,
        read_counts: {},
        steps: {},
        switched_at: null,
      }
    );
  }

  /** Where the cut-over is: the months, the last read, each step, what is in the staging area. */
  async overview(ctx: RequestContext) {
    this.must(ctx, false);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c, false);
      const staged = await c.query<{ tbl: string; n: number }>(
        `SELECT tbl, count(*)::int AS n FROM staff_legacy_rows GROUP BY tbl ORDER BY tbl`,
      );
      const today = istToday();
      return {
        today,
        parallelMonth: r.parallel_month?.slice(0, 7) ?? null,
        parallelWords: r.parallel_month ? monthWords(r.parallel_month) : null,
        freezeOn: r.freeze_on,
        status: r.status,
        read: {
          requestedAt: r.read_requested_at?.toISOString() ?? null,
          startedAt: r.read_started_at?.toISOString() ?? null,
          at: r.read_at?.toISOString() ?? null,
          error: r.read_error,
          counts: r.read_counts,
          waiting:
            !!r.read_requested_at &&
            (!r.read_started_at || r.read_started_at < r.read_requested_at),
        },
        staged: Object.fromEntries(staged.rows.map((x) => [x.tbl, x.n])),
        steps: r.steps,
        started: !!r.parallel_month && today >= r.parallel_month,
        switchedAt: r.switched_at?.toISOString() ?? null,
        canSwitch:
          r.status === 'parallel' &&
          !!r.freeze_on &&
          today >= r.freeze_on &&
          !!r.read_at &&
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(r.read_at) >=
            r.freeze_on,
      };
    });
  }

  /** The parallel month (this month or the next) and the freeze date (in or after it). */
  async settings(ctx: RequestContext, dto: CutoverSettingsDto) {
    this.must(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c);
      if (r.status === 'switched') fail('The switch is done', 409);
      const today = istToday();
      const month = `${dto.parallelMonth}-01`;
      const now = monthStart(today);
      const next = monthStart(addDays(now, 32));
      if (r.status === 'setup' && month !== now && month !== next)
        fail(
          `The parallel month is this month or the next (${monthWords(now)} or ${monthWords(next)})`,
        );
      if (r.status === 'parallel' && r.parallel_month && month !== r.parallel_month)
        fail('The balances came in for the parallel month already: it stays', 409);
      if (dto.freezeOn && dto.freezeOn < month)
        fail('The freeze comes in the parallel month or after it');
      await c.query(
        `UPDATE staff_cutover SET parallel_month = $1::date, freeze_on = $2::date, updated_at = now()`,
        [month, dto.freezeOn ?? null],
      );
      return { parallelMonth: dto.parallelMonth, freezeOn: dto.freezeOn ?? null };
    });
  }

  /** Ask the workers to read the old database now. */
  async requestRead(ctx: RequestContext) {
    this.must(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c);
      if (r.status === 'switched') fail('The switch is done: nothing more is read', 409);
      await c.query(`UPDATE staff_cutover SET read_requested_at = now(), updated_at = now()`);
      await this.outbox.enqueue(c, ctx, QUEUES.maintenance, 'staff.legacy_read', {
        schoolIds: [requireTenant(ctx).schoolId],
      });
      return { requested: true };
    });
  }

  /** Every step run and rolled back: what would come, what cannot (and why). */
  async preview(ctx: RequestContext) {
    this.must(ctx, false);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c, false);
      const today = istToday();
      const out: Array<{
        step: CutoverStep;
        ready: boolean;
        why: string | null;
        counts: Record<string, number>;
        problems: Problem[];
      }> = [];
      await c.query('SAVEPOINT cut_preview');
      try {
        for (const step of STEPS) {
          const why = this.notReady(step, r, today);
          if (why) {
            out.push({ step, ready: false, why, counts: {}, problems: [] });
            continue;
          }
          const run = await this.runStep(c, ctx, step, r.parallel_month);
          out.push({ step, ready: true, why: null, counts: run.counts, problems: run.problems });
        }
      } finally {
        await c.query('ROLLBACK TO SAVEPOINT cut_preview');
      }
      return { steps: out };
    });
  }

  private notReady(
    step: CutoverStep,
    r: { status: string; read_at: Date | null; parallel_month: string | null },
    today: string,
  ) {
    if (r.status === 'switched') return 'The switch is done';
    if (!r.read_at) return 'Read the old database first';
    if (step === 'setup') return null;
    if (!r.parallel_month) return 'Set the parallel month first';
    if (today < r.parallel_month)
      return `Comes in once the parallel month (${monthWords(r.parallel_month)}) has begun`;
    return null;
  }

  /** Bring one step in. */
  async run(ctx: RequestContext, step: CutoverStep) {
    this.must(ctx);
    if (!STEPS.includes(step)) throw new DomainError('not-found', 'No such step', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c);
      const why = this.notReady(step, r, istToday());
      if (why) fail(why, 409);
      if (step === 'history' && !r.steps.balances) fail('Bring the balances first', 409);
      const run = await this.runStep(c, ctx, step, r.parallel_month);
      const by = (
        await c.query<{ name: string }>(
          `SELECT display_name AS name FROM users WHERE id = app.current_user_id()`,
        )
      ).rows[0]?.name;
      await c.query(
        `UPDATE staff_cutover SET steps = steps || jsonb_build_object($1::text, $2::jsonb),
                status = CASE WHEN $1 = 'balances' THEN 'parallel' ELSE status END, updated_at = now()`,
        [
          step,
          JSON.stringify({
            at: new Date().toISOString(),
            by: by ?? null,
            counts: run.counts,
            problems: run.problems.slice(0, 50),
          }),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: `leave.cutover.${step}`,
        entityType: 'staff_cutover',
        entityId: '0',
        after: { counts: run.counts, problems: run.problems.length },
      });
      return { step, counts: run.counts, problems: run.problems };
    });
  }

  private async runStep(
    c: PoolClient,
    ctx: RequestContext,
    step: CutoverStep,
    parallel: string | null,
  ): Promise<Run> {
    const run = new Run(step);
    if (step === 'setup') await this.setup(c, run, parallel);
    else if (step === 'balances') await this.balances(c, run, parallel!);
    else await this.history(c, run, parallel!);
    void ctx;
    return run;
  }

  private async staged(c: PoolClient, tbl: string) {
    return (
      await c.query<{ id: string; p: P }>(
        `SELECT legacy_id AS id, payload AS p FROM staff_legacy_rows WHERE tbl = $1 ORDER BY legacy_id::text`,
        [tbl],
      )
    ).rows;
  }
  private async mapTo(c: PoolClient, tbl: string, legacyId: string, newId: string) {
    await c.query(
      `INSERT INTO staff_legacy_map (school_id, tbl, legacy_id, new_id) VALUES (app.current_school_id(), $1, $2, $3)
       ON CONFLICT (school_id, tbl, legacy_id) DO UPDATE SET new_id = EXCLUDED.new_id`,
      [tbl, legacyId, newId],
    );
  }
  private async mapped(c: PoolClient, tbl: string, legacyId: string) {
    return (
      await c.query<{ id: string }>(
        `SELECT new_id::text AS id FROM staff_legacy_map WHERE tbl = $1 AND legacy_id = $2`,
        [tbl, legacyId],
      )
    ).rows[0]?.id;
  }
  /** One row in a savepoint: a refusal is a problem, the rest goes on. */
  private async one<T>(
    c: PoolClient,
    run: Run,
    what: string,
    example: string,
    fn: () => Promise<T>,
  ) {
    await c.query('SAVEPOINT cut_one');
    try {
      const v = await fn();
      await c.query('RELEASE SAVEPOINT cut_one');
      return v;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT cut_one');
      run.problem(`${what}: ${(e as Error).message.slice(0, 160)}`, example);
      return null;
    }
  }
  private async emp(c: PoolClient, code: string) {
    return (
      await c.query<{ id: string | null; code: string | null; user_id: string | null }>(
        `SELECT e.id::text, e.employee_code AS code, e.user_id::text FROM employees e WHERE e.id = app.staff_legacy_emp($1)`,
        [code],
      )
    ).rows[0];
  }
  /** The old scope as here: the kind and the values (an employee scope by the employee code here). */
  private async scope(c: PoolClient, run: Run, type: unknown, value: unknown, what: string) {
    const kind = SCOPES[str(type).toUpperCase()];
    if (!kind) {
      run.problem(`${what}: a scope the old module had and this one does not`, str(type));
      return null;
    }
    const values = str(value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (kind === 'all' || !values.length) return { scope: 'all', values: [] as string[] };
    if (kind !== 'employee') return { scope: kind, values };
    const codes: string[] = [];
    for (const v of values) {
      const e = await this.emp(c, v);
      if (e?.code) codes.push(e.code);
      else run.problem(`${what}: an employee not found here`, v);
    }
    return codes.length ? { scope: 'employee', values: codes } : null;
  }
  /** The latest row of each key (the old masters were kept a financial year at a time). */
  private latest(rows: Array<{ id: string; p: P }>, key: (p: P) => string) {
    const by = new Map<string, { id: string; p: P; ids: string[] }>();
    const sorted = [...rows].sort(
      (x, y) =>
        Number(live(y.p)) - Number(live(x.p)) ||
        fyKey(y.p).localeCompare(fyKey(x.p)) ||
        Number(y.id) - Number(x.id),
    );
    for (const r of sorted) {
      const k = key(r.p);
      if (!k) continue;
      const cur = by.get(k);
      if (cur) cur.ids.push(r.id);
      else by.set(k, { ...r, ids: [r.id] });
    }
    return [...by.values()];
  }

  // ---- 1. the set-up --------------------------------------------------------------------------------
  private async setup(c: PoolClient, run: Run, parallel: string | null) {
    await c.query(`SELECT app.staff_leave_seed(app.current_school_id())`);
    const today = istToday();
    const fy = fyStart(parallel ?? today);

    // leave types, by their code
    for (const t of this.latest(await this.staged(c, 'al_leave_type'), (p) =>
      str(p.LeaveCode)
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, ''),
    )) {
      const p = t.p;
      if (!live(p)) continue;
      const code = str(p.LeaveCode)
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '')
        .slice(0, 20);
      if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(code)) {
        run.problem('Leave types: a code that does not start with a letter', str(p.LeaveCode));
        continue;
      }
      const lop = b(p.IsLossOfPay);
      const keeps = b(p.TrackBalance ?? 1) && !lop;
      const f = str(p.AccrualFrequency).toUpperCase();
      const credit = !keeps
        ? 'none'
        : f.startsWith('Y')
          ? 'Y'
          : f.startsWith('H')
            ? 'H'
            : f.startsWith('Q') || f.startsWith('M')
              ? 'Q'
              : 'Y';
      if (keeps && f.startsWith('M'))
        run.problem('Leave types: credited monthly in the old module, quarterly here', code);
      const lopPct = num(p.LopPercent);
      const id = await this.one(
        c,
        run,
        'Leave types',
        code,
        async () =>
          (
            await c.query<{ id: string }>(
              `INSERT INTO staff_leave_types (school_id, code, name, paid, loss_of_pay, keeps_balance, counts_present, half_day, auto_approve,
                                            document_needed, gap_from_other, advance_allowed, min_days, max_days, max_per_month, deduct_order,
                                            credit, carry_forward, carry_cap, for_male, for_female, pay_percent, sort_order, status)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'active')
             ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, paid = EXCLUDED.paid, loss_of_pay = EXCLUDED.loss_of_pay,
               keeps_balance = EXCLUDED.keeps_balance, counts_present = EXCLUDED.counts_present, half_day = EXCLUDED.half_day,
               auto_approve = EXCLUDED.auto_approve, document_needed = EXCLUDED.document_needed, gap_from_other = EXCLUDED.gap_from_other,
               advance_allowed = EXCLUDED.advance_allowed, min_days = EXCLUDED.min_days, max_days = EXCLUDED.max_days,
               max_per_month = EXCLUDED.max_per_month, deduct_order = EXCLUDED.deduct_order, credit = EXCLUDED.credit,
               carry_forward = EXCLUDED.carry_forward, carry_cap = EXCLUDED.carry_cap, for_male = EXCLUDED.for_male,
               for_female = EXCLUDED.for_female, pay_percent = EXCLUDED.pay_percent, sort_order = EXCLUDED.sort_order,
               status = 'active', updated_at = now()
             RETURNING id::text`,
              [
                code,
                (str(p.LeaveName) || code).slice(0, 100),
                !lop && b(p.IsPaid ?? 1),
                lop,
                keeps,
                b(p.CountsAsPresent),
                lop || b(p.AllowHalfDay),
                b(p.AutoApprove),
                b(p.RequireAttachment),
                b(p.RequireGapFromOther),
                b(p.AllowAdvance ?? 1),
                pos(p.MinPerApplication),
                pos(p.MaxPerApplication),
                pos(p.MaxPerMonth),
                pos(p.AutoDeductPriority) === null
                  ? null
                  : clamp(pos(p.AutoDeductPriority)!, 1, 9999),
                credit,
                keeps && b(p.CarryForward),
                keeps ? pos(p.CarryForwardMax) : null,
                b(p.Male ?? 1),
                b(p.Female ?? 1),
                lopPct !== null && lopPct > 0 && lopPct < 100 ? 100 - lopPct : null,
                clamp(num(p.DisplayOrder) ?? 100, 0, 100000),
              ],
            )
          ).rows[0]!.id,
      );
      if (!id) continue;
      for (const lid of t.ids) await this.mapTo(c, 'al_leave_type', lid, id);
      run.add('leave types');
    }

    // policies, by their name
    for (const t of this.latest(await this.staged(c, 'al_leave_policy'), (p) =>
      str(p.PolicyName).toLowerCase(),
    )) {
      const p = t.p;
      if (!live(p)) continue;
      const name = str(p.PolicyName).slice(0, 100);
      const typeId = await this.mapped(c, 'al_leave_type', str(p.LeaveTypeId));
      if (!typeId) {
        run.problem('Policies: the leave type did not come', name);
        continue;
      }
      const sc = await this.scope(c, run, p.ScopeType, p.ScopeValue, 'Policies');
      if (!sc) continue;
      const f = str(p.AccrualFrequency).toUpperCase();
      const id = await this.one(
        c,
        run,
        'Policies',
        name,
        async () =>
          (
            await c.query<{ id: string }>(
              `INSERT INTO staff_leave_policies (school_id, name, framework, leave_type_id, scope, scope_values, priority, annual_days, accrues,
                                               credit, credit_months, pro_rata, carry_forward, carry_cap, min_days, max_days,
                                               sandwich_weekoff, sandwich_holiday, sandwich_optional, encash, encash_min_days, encash_on_exit,
                                               encash_on_exit_days, encash_yearly, encash_yearly_days, by_attendance, status)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                     $20, $21, $22, $23, true, 'active')
             ON CONFLICT (school_id, name) DO UPDATE SET framework = EXCLUDED.framework, leave_type_id = EXCLUDED.leave_type_id,
               scope = EXCLUDED.scope, scope_values = EXCLUDED.scope_values, priority = EXCLUDED.priority, annual_days = EXCLUDED.annual_days,
               accrues = EXCLUDED.accrues, credit = EXCLUDED.credit, credit_months = '{}', pro_rata = EXCLUDED.pro_rata,
               carry_forward = EXCLUDED.carry_forward, carry_cap = EXCLUDED.carry_cap, min_days = EXCLUDED.min_days, max_days = EXCLUDED.max_days,
               sandwich_weekoff = EXCLUDED.sandwich_weekoff, sandwich_holiday = EXCLUDED.sandwich_holiday,
               sandwich_optional = EXCLUDED.sandwich_optional, encash = EXCLUDED.encash, encash_min_days = EXCLUDED.encash_min_days,
               encash_on_exit = EXCLUDED.encash_on_exit, encash_on_exit_days = EXCLUDED.encash_on_exit_days,
               encash_yearly = EXCLUDED.encash_yearly, encash_yearly_days = EXCLUDED.encash_yearly_days, by_attendance = true,
               status = 'active', updated_at = now()
             RETURNING id::text`,
              [
                name,
                str(p.PolicyFramework).slice(0, 100) || null,
                typeId,
                sc.scope,
                sc.values,
                clamp(num(p.Priority) ?? 100, 1, 9999),
                num(p.AnnualEntitlement) ?? 0,
                b(p.IsAccrual ?? 1),
                f.startsWith('Y')
                  ? 'Y'
                  : f.startsWith('H')
                    ? 'H'
                    : f.startsWith('Q') || f.startsWith('M')
                      ? 'Q'
                      : null,
                b(p.ProRataOnJoin),
                b(p.IsCarryForward),
                pos(p.CarryForwardMax),
                pos(p.MinDaysPerApplication),
                pos(p.MaxDaysPerApplication),
                b(p.IncludeWeeklyOff),
                b(p.IncludeHoliday) || b(p.IncludeDeclaredHoliday),
                b(p.IncludeFestival),
                b(p.IsEncash),
                pos(p.EncashEligibleDays),
                b(p.IsEncashOnSeparation),
                pos(p.EncashOnSeparationValue),
                b(p.IsYearlyEncash),
                pos(p.YearlyEncashValue),
              ],
            )
          ).rows[0]!.id,
      );
      if (!id) continue;
      for (const lid of t.ids) await this.mapTo(c, 'al_leave_policy', lid, id);
      run.add('policies');
    }

    // weekly offs: the old rules replace the starting ones
    const wos = this.latest(await this.staged(c, 'al_weekoff_rule'), (p) =>
      str(p.RuleName).toLowerCase(),
    ).filter((t) => live(t.p));
    const woIds: string[] = [];
    for (const t of wos) {
      const p = t.p;
      const name = (str(p.RuleName) || `Weekly off ${t.id}`).slice(0, 100);
      const sc = await this.scope(c, run, p.ScopeType, p.ScopeValue, 'Weekly offs');
      if (!sc) continue;
      const dates = str(p.RuleKind).toUpperCase() === 'DATES';
      const ints = (v: unknown, hi: number) =>
        str(v)
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= hi);
      const id = await this.one(
        c,
        run,
        'Weekly offs',
        name,
        async () =>
          (
            await c.query<{ id: string }>(
              `INSERT INTO staff_weekoff_rules (school_id, name, scope, scope_values, kind, weekdays, week_numbers, dates, priority, status)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::date[], $8, 'active')
             ON CONFLICT (school_id, name) DO UPDATE SET scope = EXCLUDED.scope, scope_values = EXCLUDED.scope_values, kind = EXCLUDED.kind,
               weekdays = EXCLUDED.weekdays, week_numbers = EXCLUDED.week_numbers, dates = EXCLUDED.dates, priority = EXCLUDED.priority,
               status = 'active'
             RETURNING id::text`,
              [
                name,
                sc.scope,
                sc.values,
                dates ? 'dates' : 'weekly',
                dates ? [] : ints(p.WeekDays, 7),
                dates ? [] : ints(p.WeekNumbers, 5),
                dates
                  ? str(p.SpecificDates)
                      .split(',')
                      .map((d) => day(d.trim()))
                      .filter(Boolean)
                  : [],
                clamp(num(p.Priority) ?? 100, 1, 999),
              ],
            )
          ).rows[0]!.id,
      );
      if (!id) continue;
      woIds.push(id);
      for (const lid of t.ids) await this.mapTo(c, 'al_weekoff_rule', lid, id);
      run.add('weekly-off rules');
    }
    if (woIds.length) {
      const off = await c.query(
        `UPDATE staff_weekoff_rules SET status = 'inactive' WHERE status = 'active' AND NOT (id = ANY($1::bigint[]))`,
        [woIds],
      );
      if (off.rowCount) run.add('starting weekly-off rules switched off', off.rowCount);
    }

    // holidays (for staff) on the school calendar
    const scopes = (await this.staged(c, 'al_holiday_scope')).filter((s) => live(s.p));
    for (const t of (await this.staged(c, 'al_holiday_master')).filter((h) => live(h.p))) {
      const p = t.p;
      const from = day(p.HolidayDate);
      const to = day(p.HolidayToDate) ?? from;
      const name = (str(p.HolidayName) || 'Holiday').slice(0, 150);
      if (!from || !to || to < from) {
        run.problem('Holidays: no date', name);
        continue;
      }
      const sc = scopes.filter((s) => str(s.p.HolidayId) === t.id);
      let scope = { scope: 'all', values: [] as string[] };
      if (sc.length) {
        const kinds = [...new Set(sc.map((s) => str(s.p.ScopeType).toUpperCase()))];
        if (kinds.length > 1) run.problem('Holidays: for staff of two kinds; the first kept', name);
        const first = sc.filter((s) => str(s.p.ScopeType).toUpperCase() === kinds[0]);
        scope =
          (await this.scope(
            c,
            run,
            kinds[0],
            first.map((s) => str(s.p.ScopeValue)).join(','),
            'Holidays',
          )) ?? scope;
      }
      const ref = `old-leave:${t.id}`;
      const id = await this.one(c, run, 'Holidays', name, async () => {
        const have = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM holidays WHERE legacy_ref = $1
             UNION ALL
             SELECT id::text FROM holidays WHERE starts_on = $2::date AND ends_on = $3::date AND applies_to IN ('everyone', 'employees')
             LIMIT 1`,
            [ref, from, to],
          )
        ).rows[0];
        if (have) {
          await c.query(
            `UPDATE holidays SET optional = $2, staff_scope = $3, staff_scope_values = $4 WHERE id = $1 AND legacy_ref = $5`,
            [have.id, b(p.IsRestricted), scope.scope, scope.values, ref],
          );
          run.add('holidays already on the calendar');
          return have.id;
        }
        const ay = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM academic_years WHERE school_id = app.current_school_id() AND start_date <= $1::date AND end_date >= $1::date
              ORDER BY start_date DESC LIMIT 1`,
            [from],
          )
        ).rows[0];
        if (!ay) throw new Error(`no academic year holds ${dmy(from)}`);
        const r = await c.query<{ id: string }>(
          `INSERT INTO holidays (school_id, academic_year_id, name, kind, starts_on, ends_on, applies_to, legacy_ref, optional, staff_scope, staff_scope_values)
           VALUES (app.current_school_id(), $1, $2, 'holiday', $3, $4, 'employees', $5, $6, $7, $8) RETURNING id::text`,
          [ay.id, name, from, to, ref, b(p.IsRestricted), scope.scope, scope.values],
        );
        run.add('holidays');
        return r.rows[0]!.id;
      });
      if (id) await this.mapTo(c, 'al_holiday_master', t.id, id);
    }

    // shifts, by their code
    for (const t of this.latest(await this.staged(c, 'al_shift_master'), (p) =>
      str(p.ShiftCode)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, ''),
    )) {
      const p = t.p;
      if (!live(p)) continue;
      const code = str(p.ShiftCode)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 30);
      const sp = str(p.SinglePunchDayType).toUpperCase();
      const id = await this.one(
        c,
        run,
        'Shifts',
        code,
        async () =>
          (
            await c.query<{ id: string }>(
              `INSERT INTO staff_shifts (school_id, code, name, kind, starts_at, ends_at, grace_minutes, present_hours, half_day_hours, total_hours,
                                       overtime, overtime_limit, bus_duty, single_punch, status)
             VALUES (app.current_school_id(), $1, $2, $3, $4::time, $5::time, $6, $7, $8, $9, $10, $11, $12, $13, 'active')
             ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, starts_at = EXCLUDED.starts_at,
               ends_at = EXCLUDED.ends_at, grace_minutes = EXCLUDED.grace_minutes, present_hours = EXCLUDED.present_hours,
               half_day_hours = EXCLUDED.half_day_hours, total_hours = EXCLUDED.total_hours, overtime = EXCLUDED.overtime,
               overtime_limit = EXCLUDED.overtime_limit, bus_duty = EXCLUDED.bus_duty, single_punch = EXCLUDED.single_punch, status = 'active'
             RETURNING id::text`,
              [
                code,
                (str(p.ShiftName) || code).slice(0, 100),
                str(p.ShiftType).toUpperCase() === 'NIGHT' ? 'night' : 'day',
                time(p.StartTime),
                time(p.EndTime),
                clamp(num(p.GraceMinutes) ?? 0, 0, 240),
                clamp(num(p.PresentHours) ?? 8, 0, 24),
                clamp(num(p.HalfDayHours) ?? 4.5, 0, 24),
                clamp(num(p.TotalHours) ?? num(p.PresentHours) ?? 8, 0, 24),
                b(p.IsOtApplicable),
                clamp(num(p.OtLimitHours) ?? 0, 0, 24),
                b(p.IsBusDuty),
                ['A', 'HD', 'P'].includes(sp) ? sp : 'A',
              ],
            )
          ).rows[0]!.id,
      );
      if (!id) continue;
      for (const lid of t.ids) await this.mapTo(c, 'al_shift_master', lid, id);
      run.add('shifts');
    }

    // shift postings
    for (const t of (await this.staged(c, 'al_shift_assignment')).filter((a) => live(a.p))) {
      const p = t.p;
      const e = await this.emp(c, str(p.EmpId));
      const shift = await this.mapped(c, 'al_shift_master', str(p.ShiftId));
      const from = day(p.EffectiveFrom);
      if (!e?.id) {
        run.problem('Shift postings: an employee not found here', str(p.EmpId));
        continue;
      }
      if (!shift || !from) {
        run.problem('Shift postings: no shift or no start', str(p.EmpId));
        continue;
      }
      const id = await this.one(c, run, 'Shift postings', str(p.EmpId), async () => {
        const have = await this.mapped(c, 'al_shift_assignment', t.id);
        if (have) {
          await c.query(
            `UPDATE staff_shift_postings SET shift_id = $2, from_date = $3, to_date = $4, status = 'active' WHERE id = $1`,
            [have, shift, from, day(p.EffectiveTo)],
          );
          return have;
        }
        const r = await c.query<{ id: string }>(
          `INSERT INTO staff_shift_postings (school_id, employee_id, shift_id, from_date, to_date)
           VALUES (app.current_school_id(), $1, $2, $3, $4)
           ON CONFLICT (employee_id, shift_id, from_date) WHERE status = 'active' DO UPDATE SET to_date = EXCLUDED.to_date
           RETURNING id::text`,
          [e.id, shift, from, day(p.EffectiveTo)],
        );
        return r.rows[0]!.id;
      });
      if (!id) continue;
      await this.mapTo(c, 'al_shift_assignment', t.id, id);
      run.add('shift postings');
    }

    // department timings; an employee's timing for some dates; an employee's own timing (this year)
    const fyEnd = addDays(`${String(Number(fy.slice(0, 4)) + 1)}-04-01`, -1);
    for (const tbl of ['al_dept_timing', 'al_emp_timing_special', 'al_emp_timing'] as const) {
      for (const t of (await this.staged(c, tbl)).filter((x) => live(x.p))) {
        const p = t.p;
        const dept = tbl === 'al_dept_timing';
        let empId: string | null = null;
        if (!dept) {
          const e = await this.emp(c, str(p.EmpId));
          if (!e?.id) {
            run.problem('Timings: an employee not found here', str(p.EmpId));
            continue;
          }
          empId = e.id;
        }
        const from = tbl === 'al_emp_timing' ? fy : day(p.FromDate);
        const to = tbl === 'al_emp_timing' ? fyEnd : day(p.ToDate);
        const args = [
          dept ? 'department' : 'special',
          dept ? str(p.Department).slice(0, 100) : null,
          empId,
          dept ? null : from,
          dept ? null : to,
          time(p.StartTime),
          time(p.EndTime),
          clamp(num(p.GraceMinutes) ?? 0, 0, 240),
          clamp(num(p.PresentHours) ?? 8, 0, 24),
          clamp(num(p.HalfDayHours) ?? 4.5, 0, 24),
          (
            (tbl === 'al_emp_timing' ? 'Own timing in the old module' : '') +
            (str(p.Remark) ? ` ${str(p.Remark)}` : '')
          )
            .trim()
            .slice(0, 200) || null,
        ];
        const id = await this.one(
          c,
          run,
          'Timings',
          dept ? str(p.Department) : str(p.EmpId),
          async () => {
            const have =
              (await this.mapped(c, tbl, t.id)) ??
              (dept
                ? (
                    await c.query<{ id: string }>(
                      `SELECT id::text FROM staff_timings WHERE kind = 'department' AND status = 'active' AND lower(department) = lower($1) LIMIT 1`,
                      [args[1]],
                    )
                  ).rows[0]?.id
                : undefined);
            if (have) {
              await c.query(
                `UPDATE staff_timings SET kind = $2, department = $3, employee_id = $4, from_date = $5, to_date = $6, starts_at = $7::time,
                      ends_at = $8::time, grace_minutes = $9, present_hours = $10, half_day_hours = $11, note = $12, status = 'active'
                WHERE id = $1`,
                [have, ...args],
              );
              return have;
            }
            return (
              await c.query<{ id: string }>(
                `INSERT INTO staff_timings (school_id, kind, department, employee_id, from_date, to_date, starts_at, ends_at, grace_minutes,
                                          present_hours, half_day_hours, note)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::time, $7::time, $8, $9, $10, $11) RETURNING id::text`,
                args,
              )
            ).rows[0]!.id;
          },
        );
        if (!id) continue;
        await this.mapTo(c, tbl, t.id, id);
        run.add('timings');
      }
    }

    // who approves: the old matrix's rows, a rule each scope, leave type and priority; its day ranges our bands
    const matrix = (await this.staged(c, 'al_approval_matrix')).filter((m) => live(m.p));
    const groups = new Map<string, Array<{ id: string; p: P }>>();
    for (const m of matrix) {
      const ref = str(m.p.RefType).toUpperCase();
      if (ref === 'LEAVECANCEL') {
        run.problem('Who approves: cancellation chains go through the leave’s own rule here', m.id);
        continue;
      }
      if (ref !== 'LEAVE' && ref !== 'REGULARIZATION') {
        run.problem('Who approves: a kind of request this module does not have', ref);
        continue;
      }
      const k = [
        ref,
        str(m.p.ScopeType).toUpperCase(),
        str(m.p.ScopeValue).toLowerCase(),
        str(m.p.LeaveTypeId),
        str(m.p.Priority),
      ].join('|');
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }
    for (const [k, rows] of groups) {
      const p0 = rows[0]!.p;
      const kind = str(p0.RefType).toUpperCase() === 'LEAVE' ? 'leave' : 'regularisation';
      const sc = await this.scope(c, run, p0.ScopeType, p0.ScopeValue, 'Who approves');
      if (!sc) continue;
      const typeId = str(p0.LeaveTypeId)
        ? await this.mapped(c, 'al_leave_type', str(p0.LeaveTypeId))
        : null;
      const bands = kind === 'leave' ? BANDS.map((x) => ({ from: x.from, to: x.to })) : [REG_BAND];
      const stored: Array<{ from: number; to: number; levels: unknown[] }> = [];
      for (const band of bands) {
        const inBand = rows.filter((r) => {
          const lo = num(r.p.DayFrom) ?? 0;
          const hi = num(r.p.DayTo) ?? 999;
          return (
            kind === 'regularisation' || (band.to > lo && band.from < hi) || (lo === 0 && hi === 0)
          );
        });
        const byLevel = new Map<number, string[]>();
        let manager = new Set<number>();
        for (const r of inBand) {
          const lv = Math.max(1, num(r.p.ApprovalLevel) ?? 1);
          const who = str(r.p.ApproverEmpId);
          if (who) {
            const e = await this.emp(c, who);
            if (!e?.id) {
              run.problem('Who approves: an approver not found here', who);
              continue;
            }
            byLevel.set(lv, [...new Set([...(byLevel.get(lv) ?? []), e.id])]);
          } else if (str(r.p.ApproverRule).toUpperCase() === 'REPORTING_MANAGER') {
            manager = new Set([...manager, lv]);
            byLevel.set(lv, byLevel.get(lv) ?? []);
          } else run.problem('Who approves: a level with nobody named', k);
        }
        const levels = [...byLevel.keys()].sort((x, y) => x - y);
        if (levels.length > 3) run.problem('Who approves: more than 3 levels; the first 3 kept', k);
        const input = levels.slice(0, 3).map((lv, i) =>
          manager.has(lv) && !byLevel.get(lv)!.length
            ? {
                name: `Level ${String(i + 1)} (reporting manager)`,
                by: 'manager' as const,
                employeeIds: [] as string[],
              }
            : {
                name: `Level ${String(i + 1)}`,
                by: 'employees' as const,
                employeeIds: byLevel.get(lv)!,
              },
        );
        const built = input.length
          ? await this.one(c, run, 'Who approves', k, () =>
              buildLevels(c, input as Parameters<typeof buildLevels>[1], { allowManager: true }),
            )
          : [];
        stored.push({ from: band.from, to: band.to, levels: built ?? [] });
      }
      const words =
        sc.scope === 'all' ? 'all staff' : `${sc.scope.replace('_', ' ')} ${sc.values.join(', ')}`;
      const name = `Old module: ${kind === 'leave' ? 'leave' : 'corrections'} · ${words}`.slice(
        0,
        100,
      );
      const id = await this.one(c, run, 'Who approves', k, async () => {
        const have = await this.mapped(c, 'approval_rule', k.slice(0, 200));
        const args = [
          kind,
          name,
          sc.scope,
          sc.values,
          typeId ?? null,
          JSON.stringify(stored),
          clamp(num(p0.Priority) ?? 100, 1, 9999),
        ];
        if (have) {
          await c.query(
            `UPDATE staff_leave_approval_rules SET kind = $2, name = $3, scope = $4, scope_values = $5, leave_type_id = $6,
                    bands = $7::jsonb, priority = $8, status = 'active', updated_at = now() WHERE id = $1`,
            [have, ...args],
          );
          return have;
        }
        return (
          await c.query<{ id: string }>(
            `INSERT INTO staff_leave_approval_rules (school_id, kind, name, scope, scope_values, leave_type_id, bands, priority)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id::text`,
            args,
          )
        ).rows[0]!.id;
      });
      if (!id) continue;
      await this.mapTo(c, 'approval_rule', k.slice(0, 200), id);
      run.add('who-approves rules');
    }

    // settings, the reports' "Not required" list and who opens each report
    const settings = new Map(
      (await this.staged(c, 'tbl_module_settings')).map((s) => [
        `${str(s.p.page_url).split('/').pop()}|${str(s.p.setting_key)}`,
        str(s.p.setting_value),
      ]),
    );
    const set = (k: string) => settings.get(`attendance_settings.php|${k}`);
    if ([...settings.keys()].some((k) => k.startsWith('attendance_settings.php|'))) {
      const shift = set('default_shift_code')
        ? (
            await c.query<{ id: string }>(
              `SELECT id::text FROM staff_shifts WHERE code = upper($1)`,
              [set('default_shift_code')],
            )
          ).rows[0]?.id
        : undefined;
      await c.query(
        `UPDATE staff_leave_settings SET late_marks_per_leave = COALESCE($1, late_marks_per_leave),
                missing_punches_per_leave = COALESCE($2, missing_punches_per_leave), allow_time_edit = COALESCE($3, allow_time_edit),
                allow_on_behalf = COALESCE($4, allow_on_behalf), send_email = COALESCE($5, send_email),
                default_shift_id = COALESCE($6::bigint, default_shift_id), updated_at = now()`,
        [
          set('late_marks_per_leave')
            ? clamp(Number(set('late_marks_per_leave')) || 3, 1, 10)
            : null,
          set('forgot_punches_per_leave')
            ? clamp(Number(set('forgot_punches_per_leave')) || 4, 1, 10)
            : null,
          set('allow_time_edit') !== undefined ? set('allow_time_edit') === '1' : null,
          set('allow_onbehalf') !== undefined ? set('allow_onbehalf') === '1' : null,
          set('email_enabled') !== undefined ? set('email_enabled') === '1' : null,
          shift ?? null,
        ],
      );
      run.add('settings');
    }
    const ids = (v: string | undefined) =>
      (v ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    for (const code of ids(settings.get('mis_reports.php|mis_not_required'))) {
      const e = await this.emp(c, code);
      if (!e?.id) {
        run.problem('Not required in the reports: an employee not found here', code);
        continue;
      }
      const r = await c.query(
        `INSERT INTO staff_report_exclusions (school_id, employee_id, reason)
         SELECT app.current_school_id(), $1, 'Not required in the old module'
          WHERE NOT EXISTS (SELECT 1 FROM staff_report_exclusions WHERE employee_id = $1 AND status = 'active')`,
        [e.id],
      );
      run.add('not required in the reports', r.rowCount ?? 0);
    }
    for (const [key, reports] of Object.entries(REPORT_KEYS))
      for (const code of ids(settings.get(`mis_reports.php|report_access_${key}`))) {
        const e = await this.emp(c, code);
        if (!e?.user_id) {
          run.problem('Report access: an employee with no sign-in here', code);
          continue;
        }
        for (const rep of reports) {
          const r = await c.query(
            `INSERT INTO staff_report_access (school_id, report, user_id) VALUES (app.current_school_id(), $1, $2) ON CONFLICT DO NOTHING`,
            [rep, e.user_id],
          );
          run.add('reports given', r.rowCount ?? 0);
        }
      }
  }

  // ---- 2. the balances --------------------------------------------------------------------------------
  private async balances(c: PoolClient, run: Run, parallel: string) {
    const fy = fyStart(parallel);
    const bad = await c.query<{ what: string; code: string; n: number }>(
      `SELECT CASE WHEN app.staff_legacy_emp(payload->>'EmpId') IS NULL THEN 'employee' ELSE 'type' END AS what,
              CASE WHEN app.staff_legacy_emp(payload->>'EmpId') IS NULL THEN payload->>'EmpId' ELSE payload->>'LeaveTypeId' END AS code,
              count(*)::int AS n
         FROM staff_legacy_rows WHERE tbl = 'al_leave_balance' AND COALESCE(payload->>'isTrash', '0') <> '1'
          AND (app.staff_legacy_emp(payload->>'EmpId') IS NULL OR app.staff_legacy_id('al_leave_type', payload->>'LeaveTypeId') IS NULL)
        GROUP BY 1, 2 ORDER BY 3 DESC`,
    );
    for (const x of bad.rows)
      for (let i = 0; i < x.n; i += 1)
        run.problem(
          x.what === 'employee'
            ? 'Balances: an employee not found here'
            : 'Balances: a leave type that did not come',
          x.code,
        );
    const r = await c.query<{ n: number; pairs: number }>(
      `WITH src AS (
         SELECT DISTINCT ON (emp, typ, month) * FROM (
           SELECT app.staff_legacy_emp(payload->>'EmpId') AS emp, app.staff_legacy_id('al_leave_type', payload->>'LeaveTypeId') AS typ,
                  make_date((payload->>'BalYear')::int, (payload->>'BalMonth')::int, 1) AS month, legacy_id::bigint AS lid,
                  COALESCE((payload->>'OpeningBal')::numeric, 0) AS opening, COALESCE((payload->>'Accrued')::numeric, 0) AS credited,
                  GREATEST(COALESCE((payload->>'Booked')::numeric, 0), 0) AS held, COALESCE((payload->>'CorrectionBal')::numeric, 0) AS correction,
                  (payload->>'ClosingBal')::numeric AS closing, COALESCE((payload->>'LapsedBal')::numeric, 0) AS lapsed,
                  (payload->>'IsClosed') = '1' AS closed
             FROM staff_legacy_rows WHERE tbl = 'al_leave_balance' AND COALESCE(payload->>'isTrash', '0') <> '1') x
          WHERE emp IS NOT NULL AND typ IS NOT NULL AND month >= $1::date AND month < $2::date
            AND EXISTS (SELECT 1 FROM staff_leave_types t WHERE t.id = typ AND t.keeps_balance AND NOT t.loss_of_pay)
          ORDER BY emp, typ, month, lid DESC
       ), up AS (
         INSERT INTO staff_leave_balances (school_id, employee_id, leave_type_id, month, opening, credited, held, correction, closing, lapsed,
                                           closed, imported, trail)
         SELECT app.current_school_id(), emp, typ, month, opening, credited, held, correction,
                CASE WHEN closed AND closing IS NOT NULL THEN closing ELSE opening + credited + correction - held END, lapsed, true, true,
                ARRAY[to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'DD-MM-YYYY') || ' from the old module: opening ' || opening
                      || ', credited ' || credited || ', booked ' || held || ', correction ' || correction || ', closing '
                      || CASE WHEN closed AND closing IS NOT NULL THEN closing ELSE opening + credited + correction - held END]
           FROM src
         ON CONFLICT (employee_id, leave_type_id, month) DO UPDATE SET opening = EXCLUDED.opening, credited = EXCLUDED.credited,
           held = EXCLUDED.held, correction = EXCLUDED.correction, closing = EXCLUDED.closing, lapsed = EXCLUDED.lapsed, closed = true,
           imported = true, trail = staff_leave_balances.trail || EXCLUDED.trail, updated_at = now()
         RETURNING employee_id, leave_type_id
       )
       SELECT count(*)::int AS n, count(DISTINCT (employee_id, leave_type_id))::int AS pairs FROM up`,
      [fy, parallel],
    );
    run.add('balance months', r.rows[0]!.n);
    run.add('employees × leave types', r.rows[0]!.pairs);
    // the months from the parallel one: opened at the last imported closing, credited by the policies here
    await c.query(`SELECT app.staff_leave_month_end()`);
    await c.query(
      `SELECT app.staff_leave_resync(b.employee_id, b.leave_type_id, b.month)
         FROM (SELECT DISTINCT ON (employee_id, leave_type_id) employee_id, leave_type_id, month FROM staff_leave_balances
                WHERE imported AND month < $1::date ORDER BY employee_id, leave_type_id, month DESC) b`,
      [parallel],
    );
  }

  // ---- 3. this year's history (again each day of the parallel month) ---------------------------------------
  private async history(c: PoolClient, run: Run, parallel: string) {
    const fy = fyStart(parallel);
    const today = istToday();
    // leave: new ones get their ids first, so the days and the map can follow in one go each
    await c.query(`DROP TABLE IF EXISTS cut_req`);
    await c.query(
      `CREATE TEMP TABLE cut_req ON COMMIT DROP AS
       SELECT x.*, COALESCE(app.staff_legacy_id('al_leave_request', x.lid), nextval(pg_get_serial_sequence('staff_leave_requests', 'id'))) AS new_id,
              app.staff_legacy_id('al_leave_request', x.lid) IS NULL AS fresh
         FROM (
           SELECT legacy_id AS lid, app.staff_legacy_emp(payload->>'EmpId') AS emp, payload->>'EmpId' AS emp_code,
                  app.staff_legacy_id('al_leave_type', payload->>'LeaveTypeId') AS typ, NULLIF(btrim(payload->>'RequestNumber'), '') AS old_number,
                  (payload->>'FromDate')::date AS from_date, (payload->>'ToDate')::date AS to_date,
                  GREATEST(COALESCE((payload->>'NoOfDays')::numeric, 0), 0.5) AS days, (payload->>'IsHalfDay') = '1' AS half,
                  CASE WHEN upper(COALESCE(payload->>'HalfDaySession', '')) IN ('SECOND', 'PM', 'SH', '2') THEN 'second' ELSE 'first' END AS session,
                  left(COALESCE(NULLIF(btrim(payload->>'Reason'), ''), 'From the old module'), 1000) AS reason,
                  CASE lower(COALESCE(payload->>'ReqStatus', '')) WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected'
                       WHEN 'cancelled' THEN 'cancelled' WHEN 'canceled' THEN 'cancelled' WHEN 'withdrawn' THEN 'withdrawn' ELSE 'pending' END AS status,
                  CASE upper(COALESCE(payload->>'Source', '')) WHEN 'ONBEHALF' THEN 'on_behalf' WHEN 'AUTO_LATE' THEN 'auto_late'
                       WHEN 'AUTO_FORGOTPUNCH' THEN 'auto_missing' WHEN 'AUTO_ABSENT' THEN 'auto_absent' ELSE 'self' END AS source,
                  ((payload->>'CreatedAt')::timestamp AT TIME ZONE 'Asia/Kolkata') AS created,
                  ((payload->>'ClosedAt')::timestamp AT TIME ZONE 'Asia/Kolkata') AS closed
             FROM staff_legacy_rows WHERE tbl = 'al_leave_request' AND COALESCE(payload->>'isTrash', '0') <> '1'
         ) x
        WHERE x.emp IS NOT NULL AND x.typ IS NOT NULL AND x.to_date >= $1::date AND x.from_date <= x.to_date`,
      [fy],
    );
    const skipped = await c.query<{ code: string; why: string }>(
      `SELECT COALESCE(payload->>'EmpId', '') AS code,
              CASE WHEN app.staff_legacy_emp(payload->>'EmpId') IS NULL THEN 'employee' ELSE 'type' END AS why
         FROM staff_legacy_rows WHERE tbl = 'al_leave_request' AND COALESCE(payload->>'isTrash', '0') <> '1'
          AND (app.staff_legacy_emp(payload->>'EmpId') IS NULL OR app.staff_legacy_id('al_leave_type', payload->>'LeaveTypeId') IS NULL)`,
    );
    for (const s of skipped.rows)
      run.problem(
        s.why === 'employee'
          ? 'Leave: an employee not found here'
          : 'Leave: a leave type that did not come',
        s.code,
      );
    // the leave of the parallel month approved before comes off the days before it is brought again
    const before = await c.query<{ id: string; emp: string; days: string[] }>(
      `SELECT r.id::text, r.employee_id::text AS emp, array_agg(d.day::text) AS days
         FROM cut_req q JOIN staff_leave_requests r ON r.id = q.new_id JOIN staff_leave_days d ON d.request_id = r.id
        WHERE NOT q.fresh AND r.status = 'approved' AND d.day >= $1::date GROUP BY 1, 2`,
      [parallel],
    );
    for (const x of before.rows)
      await c.query(`SELECT app.staff_attendance_remove_leave($1, $2::date[])`, [x.emp, x.days]);
    const ins = await c.query(
      `INSERT INTO staff_leave_requests (id, school_id, number, employee_id, leave_type_id, from_date, to_date, days, half_day, session, reason,
                                         status, source, held_month, note, decided_at, created_at, updated_at)
       OVERRIDING SYSTEM VALUE
       SELECT q.new_id, app.current_school_id(),
              CASE WHEN q.old_number IS NULL OR count(*) OVER (PARTITION BY q.old_number) > 1
                     OR EXISTS (SELECT 1 FROM staff_leave_requests z WHERE z.number = q.old_number) THEN 'OLD-' || q.lid ELSE q.old_number END,
              q.emp, q.typ, q.from_date, q.to_date, q.days, q.half, CASE WHEN q.half THEN q.session END, q.reason, q.status, q.source,
              date_trunc('month', COALESCE(q.created, q.from_date::timestamptz) AT TIME ZONE 'Asia/Kolkata')::date, 'From the old module',
              CASE WHEN q.status <> 'pending' THEN q.closed END, COALESCE(q.created, now()), now()
         FROM cut_req q WHERE q.fresh`,
    );
    run.add('leave brought', ins.rowCount ?? 0);
    const upd = await c.query(
      `UPDATE staff_leave_requests r SET from_date = q.from_date, to_date = q.to_date, days = q.days, half_day = q.half,
              session = CASE WHEN q.half THEN q.session END, reason = q.reason, status = q.status,
              decided_at = CASE WHEN q.status <> 'pending' THEN q.closed END, updated_at = now()
         FROM cut_req q WHERE NOT q.fresh AND r.id = q.new_id AND r.workflow_instance_id IS NULL
          AND (r.status, r.from_date, r.to_date, r.days) IS DISTINCT FROM (q.status, q.from_date, q.to_date, q.days)`,
    );
    run.add('leave changed in the old module', upd.rowCount ?? 0);
    await c.query(
      `INSERT INTO staff_legacy_map (school_id, tbl, legacy_id, new_id)
       SELECT app.current_school_id(), 'al_leave_request', lid, new_id FROM cut_req WHERE fresh ON CONFLICT DO NOTHING`,
    );
    // the days of each leave, as the old module counted them
    await c.query(
      `DELETE FROM staff_leave_days d USING cut_req q, staff_leave_requests r
        WHERE d.request_id = q.new_id AND r.id = q.new_id AND r.workflow_instance_id IS NULL`,
    );
    const days = await c.query(
      `INSERT INTO staff_leave_days (school_id, request_id, employee_id, day, portion, session, kind, status)
       SELECT DISTINCT ON (q.new_id, (d.payload->>'LeaveDate')::date) app.current_school_id(), q.new_id, q.emp, (d.payload->>'LeaveDate')::date,
              CASE WHEN COALESCE((d.payload->>'DayPortion')::numeric, 1) < 0.75 THEN 0.5 ELSE 1 END,
              CASE WHEN COALESCE((d.payload->>'DayPortion')::numeric, 1) < 0.75 THEN q.session END, 'work', q.status
         FROM staff_legacy_rows d JOIN cut_req q ON q.lid = d.payload->>'LeaveRequestId'
         JOIN staff_leave_requests r ON r.id = q.new_id AND r.workflow_instance_id IS NULL
        WHERE d.tbl = 'al_leave_request_day' AND COALESCE(d.payload->>'isTrash', '0') <> '1'
          AND COALESCE((d.payload->>'DayPortion')::numeric, 1) > 0 AND d.payload->>'LeaveDate' IS NOT NULL
       ON CONFLICT (request_id, day) DO NOTHING`,
    );
    run.add('leave days', days.rowCount ?? 0);
    // the parallel month's approved leave goes onto the days worked out here; what is held there follows
    const apply = await c.query<{ id: string }>(
      `SELECT r.id::text FROM cut_req q JOIN staff_leave_requests r ON r.id = q.new_id
        WHERE r.status = 'approved' AND r.to_date >= $1::date`,
      [parallel],
    );
    for (const x of apply.rows)
      await c.query(`SELECT app.staff_attendance_apply_leave($1)`, [x.id]);
    await c.query(
      `UPDATE staff_leave_balances b SET held = COALESCE((
          SELECT sum(r.days) FROM staff_leave_requests r WHERE r.employee_id = b.employee_id AND r.leave_type_id = b.leave_type_id
             AND r.held_month = b.month AND r.status IN ('pending', 'approved')), 0), updated_at = now()
        WHERE b.month >= $1::date AND NOT b.closed`,
      [parallel],
    );

    // the days before the parallel month, as the old module had them (the punches never change them)
    const att = await c.query(
      `WITH lp AS (
         SELECT employee_id, day, sum(portion) AS portion FROM staff_leave_days
          WHERE status = 'approved' AND day >= $1::date AND day < $2::date GROUP BY 1, 2
       ), src AS (
         SELECT DISTINCT ON (emp, d) * FROM (
           SELECT app.staff_legacy_emp(payload->>'EmpId') AS emp, (payload->>'AttDate')::date AS d, upper(btrim(payload->>'DayType')) AS t,
                  app.staff_legacy_id('al_leave_type', payload->>'LeaveTypeId') AS typ, app.staff_legacy_id('al_shift_master', payload->>'ShiftId') AS shift,
                  (payload->>'InTime1')::time AS tin, COALESCE((payload->>'OutTime2')::time, (payload->>'OutTime1')::time) AS tout,
                  (payload->>'WorkedHours')::numeric AS worked, COALESCE((payload->>'OtHours')::numeric, 0) AS ot,
                  CASE WHEN COALESCE((payload->>'LateStatus')::int, 0) <> 0 THEN GREATEST(COALESCE((payload->>'LateMinutes')::int, 0), 0) ELSE 0 END AS late,
                  left(NULLIF(btrim(payload->>'Remark'), ''), 300) AS remark, legacy_id::bigint AS lid
             FROM staff_legacy_rows WHERE tbl = 'al_attendance_daily' AND COALESCE(payload->>'isTrash', '0') <> '1') x
          WHERE emp IS NOT NULL AND d >= $1::date AND d < $2::date AND t IN ('P', 'HD', 'A', 'WO', 'H', 'LV', 'HOLD')
          ORDER BY emp, d, lid DESC
       )
       INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, leave_type_id, leave_portion, shift_id, in_at, out_at,
                                          worked_hours, ot_hours, late_minutes, manual, source, trace, remark)
       SELECT app.current_school_id(), s.emp, s.d,
              CASE WHEN s.t = 'HD' AND s.typ IS NOT NULL THEN 'LV' ELSE s.t END,
              CASE WHEN s.t IN ('LV', 'HD') THEN s.typ END,
              CASE WHEN s.t = 'LV' THEN CASE WHEN COALESCE(lp.portion, 1) < 1 THEN 0.5 ELSE 1 END WHEN s.t = 'HD' AND s.typ IS NOT NULL THEN 0.5 END,
              s.shift, (s.d + s.tin) AT TIME ZONE 'Asia/Kolkata',
              CASE WHEN s.tout IS NOT NULL THEN (s.d + s.tout + CASE WHEN s.tin IS NOT NULL AND s.tout < s.tin THEN interval '1 day' ELSE interval '0' END)
                   AT TIME ZONE 'Asia/Kolkata' END,
              LEAST(s.worked, 99), LEAST(s.ot, 99), s.late, true, 'import', jsonb_build_object('imported', true), s.remark
         FROM src s LEFT JOIN lp ON lp.employee_id = s.emp AND lp.day = s.d
       ON CONFLICT (employee_id, day) DO UPDATE SET day_type = EXCLUDED.day_type, leave_type_id = EXCLUDED.leave_type_id,
         leave_portion = EXCLUDED.leave_portion, shift_id = EXCLUDED.shift_id, in_at = EXCLUDED.in_at, out_at = EXCLUDED.out_at,
         worked_hours = EXCLUDED.worked_hours, ot_hours = EXCLUDED.ot_hours, late_minutes = EXCLUDED.late_minutes, remark = EXCLUDED.remark,
         updated_at = now()
       WHERE staff_attendance_days.source = 'import'`,
      [fy, parallel],
    );
    run.add('attendance days', att.rowCount ?? 0);
    const noEmp = await c.query<{ code: string; n: number }>(
      `SELECT payload->>'EmpId' AS code, count(*)::int AS n FROM staff_legacy_rows
        WHERE tbl = 'al_attendance_daily' AND app.staff_legacy_emp(payload->>'EmpId') IS NULL GROUP BY 1`,
    );
    for (const x of noEmp.rows) run.problem('Attendance: an employee not found here', x.code);

    // late marks and missing punches before the parallel month (counted then; what was left lapsed)
    const late = await c.query(
      `INSERT INTO staff_late_marks (school_id, employee_id, day, in_at, starts_at, grace, late_minutes, status, request_id, reason)
       SELECT DISTINCT ON (emp, d) app.current_school_id(), emp, d, (d + tin) AT TIME ZONE 'Asia/Kolkata', start, grace, late,
              CASE st WHEN 0 THEN 'waived' WHEN 2 THEN 'used' ELSE 'lapsed' END,
              CASE WHEN st = 2 THEN app.staff_legacy_id('al_leave_request', req) END, left(reason, 300)
         FROM (SELECT app.staff_legacy_emp(payload->>'EmpId') AS emp, (payload->>'AttDate')::date AS d, (payload->>'InTime')::time AS tin,
                      COALESCE((payload->>'ShiftStartTime')::time, '00:00') AS start, COALESCE((payload->>'GraceMinutes')::int, 0) AS grace,
                      COALESCE((payload->>'LateMinutes')::int, 0) AS late, COALESCE((payload->>'LateStatus')::int, 1) AS st,
                      payload->>'ConsumedByLeaveId' AS req, NULLIF(btrim(payload->>'RollbackReason'), '') AS reason
                 FROM staff_legacy_rows WHERE tbl = 'al_late_mark' AND COALESCE(payload->>'isTrash', '0') <> '1') x
        WHERE emp IS NOT NULL AND tin IS NOT NULL AND late > 0 AND d >= $1::date AND d < $2::date
       ON CONFLICT (employee_id, day) DO NOTHING`,
      [fy, parallel],
    );
    run.add('late marks', late.rowCount ?? 0);
    const miss = await c.query(
      `INSERT INTO staff_missing_punches (school_id, employee_id, day, missing, status, request_id, reason, mailed_at)
       SELECT DISTINCT ON (emp, d) app.current_school_id(), emp, d, side, CASE st WHEN 0 THEN 'retired' WHEN 2 THEN 'used' ELSE 'lapsed' END,
              CASE WHEN st = 2 THEN app.staff_legacy_id('al_leave_request', req) END, left(reason, 300), mailed
         FROM (SELECT app.staff_legacy_emp(payload->>'EmpId') AS emp, (payload->>'AttDate')::date AS d, lower(btrim(payload->>'MissingSide')) AS side,
                      COALESCE((payload->>'PunchStatus')::int, 1) AS st, payload->>'ConsumedByLeaveId' AS req,
                      NULLIF(btrim(payload->>'RetireReason'), '') AS reason,
                      (payload->>'MailSentAt')::timestamp AT TIME ZONE 'Asia/Kolkata' AS mailed
                 FROM staff_legacy_rows WHERE tbl = 'al_forgot_punch' AND COALESCE(payload->>'isTrash', '0') <> '1') x
        WHERE emp IS NOT NULL AND side IN ('in', 'out') AND d >= $1::date AND d < $2::date
       ON CONFLICT (employee_id, day) DO NOTHING`,
      [fy, parallel],
    );
    run.add('missing punches', miss.rowCount ?? 0);

    // corrections asked (the parallel month's approved ones set the day here too)
    for (const t of await this.staged(c, 'al_regularization')) {
      const p = t.p;
      if (b(p.isTrash)) continue;
      const d = day(p.AttDate);
      if (!d || d < fy) continue;
      const e = await this.emp(c, str(p.EmpId));
      if (!e?.id) {
        run.problem('Corrections: an employee not found here', str(p.EmpId));
        continue;
      }
      const st = str(p.ReqStatus).toLowerCase();
      const status = ['approved', 'rejected', 'withdrawn', 'cancelled'].includes(st)
        ? st
        : st === 'canceled'
          ? 'cancelled'
          : 'pending';
      const dt = str(p.RequestedDayType).toUpperCase();
      const dayType = ['P', 'HD', 'A', 'WO', 'H'].includes(dt) ? dt : null;
      const tin = time(p.RequestedInTime);
      const tout = time(p.RequestedOutTime);
      if (!tin && !tout && !dayType) {
        run.problem('Corrections: nothing asked (no time, no day type)', str(p.EmpId));
        continue;
      }
      const reason =
        str(p.Reason).length >= 3 ? str(p.Reason).slice(0, 500) : 'From the old module';
      const id = await this.one(c, run, 'Corrections', `${str(p.EmpId)} ${d}`, async () => {
        const have = await this.mapped(c, 'al_regularization', t.id);
        if (have) {
          await c.query(
            `UPDATE staff_regularisations SET status = $2, in_time = $3::time, out_time = $4::time, day_type = $5
              WHERE id = $1 AND workflow_instance_id IS NULL`,
            [have, status, tin, tout, dayType],
          );
          return { id: have, fresh: false };
        }
        const r = await c.query<{ id: string }>(
          `INSERT INTO staff_regularisations (school_id, employee_id, day, in_time, out_time, day_type, reason, status, decided_at, decision_note,
                                              created_at)
           VALUES (app.current_school_id(), $1, $2, $3::time, $4::time, $5, $6, $7,
                   CASE WHEN $7 <> 'pending' THEN ($8::timestamp AT TIME ZONE 'Asia/Kolkata') END, left($9, 500),
                   COALESCE($10::timestamp AT TIME ZONE 'Asia/Kolkata', now()))
           RETURNING id::text`,
          [
            e.id,
            d,
            tin,
            tout,
            dayType,
            reason,
            status,
            str(p.ActedAt) || null,
            str(p.ActionRemark) || null,
            str(p.CreatedAt) || null,
          ],
        );
        return { id: r.rows[0]!.id, fresh: true };
      });
      if (!id) continue;
      if (id.fresh) await this.mapTo(c, 'al_regularization', t.id, id.id);
      run.add(id.fresh ? 'corrections brought' : 'corrections seen again');
      if (status === 'approved' && d >= parallel && d < today)
        await this.att.applyImportedReg(c, id.id);
    }

    // the payroll months the old module locked
    const locks = await c.query(
      `INSERT INTO staff_month_locks (school_id, month, locked, locked_at, unlock_reason)
       SELECT app.current_school_id(), m, true, COALESCE(at, now()), NULL
         FROM (SELECT DISTINCT ON (m) (left(payload->>'LockMonth', 7) || '-01')::date AS m,
                      (payload->>'LockedAt')::timestamp AT TIME ZONE 'Asia/Kolkata' AS at
                 FROM staff_legacy_rows WHERE tbl = 'al_month_lock' AND COALESCE(payload->>'isTrash', '0') <> '1'
                  AND (payload->>'IsLocked') = '1' AND payload->>'LockMonth' ~ '^\\d{4}-\\d{2}') x
        WHERE m >= $1::date AND m < $2::date
       ON CONFLICT (school_id, month) DO NOTHING`,
      [fy, parallel],
    );
    run.add('payroll months locked', locks.rowCount ?? 0);
  }

  // ---- the parallel month: old and new side by side ------------------------------------------------
  async compare(ctx: RequestContext) {
    this.must(ctx, false);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c, false);
      if (!r.parallel_month) fail('Set the parallel month first', 409);
      const from = r.parallel_month!;
      const end = addDays(monthStart(addDays(from, 32)), -1);
      const yesterday = addDays(istToday(), -1);
      const to = end < yesterday ? end : yesterday;
      const days = await c.query<{
        emp: string;
        code: string;
        name: string;
        day: string;
        old: string | null;
        new: string | null;
        old_in: string | null;
        old_out: string | null;
        new_in: string | null;
        new_out: string | null;
      }>(
        `WITH o AS (
           SELECT DISTINCT ON (emp, d) emp, d, CASE WHEN t IN ('LV', 'HD') AND typ IS NOT NULL
                    THEN (SELECT CASE WHEN x.loss_of_pay THEN 'LOP' ELSE x.code END FROM staff_leave_types x WHERE x.id = typ) || CASE WHEN t = 'HD' THEN '½' ELSE '' END
                    ELSE t END AS code, tin, tout
             FROM (SELECT app.staff_legacy_emp(payload->>'EmpId') AS emp, (payload->>'AttDate')::date AS d, upper(btrim(payload->>'DayType')) AS t,
                          app.staff_legacy_id('al_leave_type', payload->>'LeaveTypeId') AS typ, left(payload->>'InTime1', 5) AS tin,
                          left(COALESCE(payload->>'OutTime2', payload->>'OutTime1'), 5) AS tout, legacy_id::bigint AS lid
                     FROM staff_legacy_rows WHERE tbl = 'al_attendance_daily' AND COALESCE(payload->>'isTrash', '0') <> '1') s
            WHERE emp IS NOT NULL AND d BETWEEN $1::date AND $2::date ORDER BY emp, d, lid DESC
         ), n AS (
           SELECT a.employee_id AS emp, a.day AS d,
                  CASE WHEN a.day_type = 'LV' THEN CASE WHEN t.loss_of_pay THEN 'LOP' ELSE t.code END
                       || CASE WHEN a.leave_portion < 1 THEN '½' ELSE '' END ELSE a.day_type END AS code,
                  to_char(a.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS tin, to_char(a.out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS tout
             FROM staff_attendance_days a LEFT JOIN staff_leave_types t ON t.id = a.leave_type_id
            WHERE a.day BETWEEN $1::date AND $2::date
         )
         SELECT COALESCE(o.emp, n.emp)::text AS emp, e.employee_code AS code, e.display_name AS name, COALESCE(o.d, n.d)::text AS day,
                o.code AS old, n.code AS new, o.tin AS old_in, o.tout AS old_out, n.tin AS new_in, n.tout AS new_out
           FROM o FULL JOIN n ON n.emp = o.emp AND n.d = o.d
           JOIN employees e ON e.id = COALESCE(o.emp, n.emp)
          WHERE o.code IS DISTINCT FROM n.code
          ORDER BY e.display_name, 4 LIMIT 2001`,
        [from, to],
      );
      const total = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM staff_legacy_rows WHERE tbl = 'al_attendance_daily' AND COALESCE(payload->>'isTrash', '0') <> '1'
              AND (payload->>'AttDate')::date BETWEEN $1::date AND $2::date`,
          [from, to],
        )
      ).rows[0]!.n;
      const bal = await c.query<{
        code: string;
        name: string;
        type: string;
        old: string;
        new: string | null;
        old_credit: string;
        new_credit: string | null;
      }>(
        `WITH o AS (
           SELECT DISTINCT ON (emp, typ) emp, typ,
                  COALESCE((payload->>'OpeningBal')::numeric, 0) + COALESCE((payload->>'Accrued')::numeric, 0)
                    + COALESCE((payload->>'CorrectionBal')::numeric, 0) - COALESCE((payload->>'Booked')::numeric, 0) AS avail,
                  COALESCE((payload->>'Accrued')::numeric, 0) AS credit
             FROM (SELECT app.staff_legacy_emp(payload->>'EmpId') AS emp, app.staff_legacy_id('al_leave_type', payload->>'LeaveTypeId') AS typ,
                          payload, legacy_id::bigint AS lid
                     FROM staff_legacy_rows WHERE tbl = 'al_leave_balance' AND COALESCE(payload->>'isTrash', '0') <> '1'
                      AND make_date((payload->>'BalYear')::int, (payload->>'BalMonth')::int, 1) = $1::date) s
            WHERE emp IS NOT NULL AND typ IS NOT NULL ORDER BY emp, typ, lid DESC
         )
         SELECT e.employee_code AS code, e.display_name AS name, t.code AS type, round(o.avail, 2)::text AS old,
                round(b.opening + b.credited + b.correction - b.held, 2)::text AS new, round(o.credit, 2)::text AS old_credit,
                round(b.credited, 2)::text AS new_credit
           FROM o JOIN employees e ON e.id = o.emp JOIN staff_leave_types t ON t.id = o.typ
           LEFT JOIN staff_leave_balances b ON b.employee_id = o.emp AND b.leave_type_id = o.typ AND b.month = $1::date
          WHERE b.id IS NULL OR abs((b.opening + b.credited + b.correction - b.held) - o.avail) >= 0.01
          ORDER BY e.display_name, t.code LIMIT 2001`,
        [from],
      );
      const balTotal = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM staff_legacy_rows WHERE tbl = 'al_leave_balance' AND COALESCE(payload->>'isTrash', '0') <> '1'
              AND make_date((payload->>'BalYear')::int, (payload->>'BalMonth')::int, 1) = $1::date`,
          [from],
        )
      ).rows[0]!.n;
      return {
        month: monthWords(from),
        from,
        to,
        readAt: r.read_at?.toISOString() ?? null,
        days: {
          compared: total,
          differ: days.rows.length > 2000 ? '2000+' : days.rows.length,
          rows: days.rows.slice(0, 2000),
        },
        balances: {
          compared: balTotal,
          differ: bal.rows.length > 2000 ? '2000+' : bal.rows.length,
          rows: bal.rows.slice(0, 2000).map((x) => ({
            ...x,
            old: Number(x.old),
            new: x.new === null ? null : Number(x.new),
            old_credit: Number(x.old_credit),
            new_credit: x.new_credit === null ? null : Number(x.new_credit),
          })),
        },
      };
    });
  }

  // ---- the switch ------------------------------------------------------------------------------------
  /** After the freeze: the last read in, what still waits starts at the first level here; the old module stops. */
  async switchOver(ctx: RequestContext) {
    this.must(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.row(c);
      const today = istToday();
      if (r.status !== 'parallel') fail('Bring the balances (the parallel month) first', 409);
      if (!r.freeze_on || today < r.freeze_on)
        fail(
          `The switch comes on or after the freeze date${r.freeze_on ? ` (${dmy(r.freeze_on)})` : ''}`,
          409,
        );
      const readDay = r.read_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(r.read_at)
        : null;
      if (!readDay || readDay < r.freeze_on!)
        fail('Read the old database again after the freeze, then switch', 409);
      const run = await this.runStep(c, ctx, 'history', r.parallel_month);
      const waiting = await c.query<{ id: string }>(
        `SELECT r.id::text FROM staff_leave_requests r JOIN staff_legacy_map m ON m.tbl = 'al_leave_request' AND m.new_id = r.id
          WHERE r.status = 'pending' AND r.workflow_instance_id IS NULL AND r.linked_request_id IS NULL ORDER BY r.created_at`,
      );
      let started = 0;
      const nobody: string[] = [];
      for (const w of waiting.rows) {
        const res = await this.leave.startImported(c, ctx, w.id);
        if (res === 'nobody') nobody.push(w.id);
        else started += 1;
      }
      const regs = await c.query<{ id: string }>(
        `SELECT g.id::text FROM staff_regularisations g JOIN staff_legacy_map m ON m.tbl = 'al_regularization' AND m.new_id = g.id
          WHERE g.status = 'pending' AND g.workflow_instance_id IS NULL ORDER BY g.created_at`,
      );
      let regStarted = 0;
      for (const g of regs.rows) {
        const res = await this.att.startImportedReg(c, ctx, g.id);
        if (res !== 'nobody') regStarted += 1;
        else
          run.problem(
            'Corrections: nobody approves this one here (the leave office decides it)',
            g.id,
          );
      }
      for (const id of nobody)
        run.problem('Leave: nobody approves this one here (decide it from the leave register)', id);
      await c.query(
        `UPDATE staff_cutover SET status = 'switched', switched_at = now(), switched_by = app.current_user_id(),
                steps = steps || jsonb_build_object('switch', $1::jsonb), updated_at = now()`,
        [
          JSON.stringify({
            at: new Date().toISOString(),
            counts: {
              ...run.counts,
              'leave waiting at level 1': started,
              'corrections waiting at level 1': regStarted,
            },
            problems: run.problems.slice(0, 50),
          }),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'leave.cutover.switch',
        entityType: 'staff_cutover',
        entityId: '0',
        after: { started, regStarted, problems: run.problems.length },
      });
      return { started, regStarted, counts: run.counts, problems: run.problems };
    });
  }
}
