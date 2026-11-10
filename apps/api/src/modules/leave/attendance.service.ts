/* eslint-disable no-restricted-syntax -- the interpolations in this file are fixed fragments; values are bound */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { MessagesService } from '../comms/messages.service';
import { STORAGE_DRIVER } from '../files/storage';
import { purchaseHead } from '../purchase/purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile } from '../purchase/purchase-list-file';
import { istToday } from '../purchase/purchase-stock-core';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { chainFor } from './leave-chain';
import { notifyLeave } from './leave-notify';
import { LeaveService } from './leave.service';
import { addDays, dmy, fail, leaveFlow, monthStart, monthWords } from './leave-engine';
import {
  LEAVE_OFFICE,
  LEAVE_OWN,
  type DayCorrectDto,
  type DecideDto,
  type ExceptionsDto,
  type LockDto,
  type MyMonthDto,
  type RegisterMonthDto,
  type RegulariseDto,
  type RunDto,
  type SheetDto,
  type TimingBulkDto,
  type TimingDto,
  type WithdrawDto,
} from './leave.dto';

const MY_STEP = `SELECT s.id::text FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
   WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`;

const TYPE_WORDS: Record<string, string> = {
  P: 'Present',
  HD: 'Half day',
  A: 'Absent',
  WO: 'Weekly off',
  H: 'Holiday',
  LV: 'Leave',
  HOLD: 'Salary hold',
};
const TIMING_WORDS: Record<string, string> = {
  SHIFT: 'Shift',
  SPECIAL: 'Special timing',
  BUS: 'Bus-duty shift',
  BUS_SPECIAL: 'Special timing (bus duty)',
  POSTING_DAY: 'Shift posted for the day',
  DEPARTMENT: 'Department timing',
};

interface DayRow {
  id: string;
  employee_id: string;
  day: string;
  day_type: string;
  leave_type_id: string | null;
  leave_code: string | null;
  leave_portion: string | null;
  loss_of_pay: boolean | null;
  in_at: Date | null;
  out_at: Date | null;
  worked_hours: string | null;
  ot_hours: string;
  late_minutes: number;
  early_minutes: number;
  manual: boolean;
  source: string;
  trace: Record<string, unknown>;
  remark: string | null;
}

const hm = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d)
    : null;

/** How the day was worked out, as a sentence (the earlier engine's calculation trace). */
export function traceWords(t: Record<string, unknown>): string {
  if (t?.imported)
    return 'Brought from the old module as it was there: the punches here do not change it.';
  if (!t || !t.timing) return '';
  const parts = [
    `${TIMING_WORDS[String(t.timing)] ?? String(t.timing)} ${String(t.shift)} ${String(t.start)}–${String(t.end)}, grace ${String(t.grace)} min`,
    `IN ${String(t.in)}${Number(t.late) > 0 ? ` (late ${String(t.late)} min)` : ''}`,
    t.out
      ? `OUT ${String(t.out)}${Number(t.early) > 0 ? ` (early ${String(t.early)} min)` : ''}`
      : 'no OUT',
  ];
  if (t.worked !== null && t.worked !== undefined) {
    const forgiven = Number(t.forgiven) > 0 ? ` (${String(t.forgiven)} min forgiven)` : '';
    parts.push(
      `worked ${String(t.worked)} h; present needs ${String(t.presentNow)} h, half day ${String(t.halfNow)} h${forgiven}`,
    );
  } else if (t.singlePunch) parts.push(`one punch: the shift says ${String(t.singlePunch)}`);
  if (t.rule) parts.push(`the ${String(t.rule)} rule applied`);
  if (t.off) parts.push(t.off === 'WO' ? 'a weekly off, worked' : 'a holiday, worked');
  parts.push(`→ ${TYPE_WORDS[String(t.result)] ?? String(t.result)}`);
  return parts.join(' · ');
}

/**
 * Staff attendance (docs/design/85, phase C): the register (a month of every employee), a day (how it was
 * worked out, its punches and history), the office's correction, my month and the corrections I ask for
 * (regularisation, through Who approves), the late marks and missing punches, the payroll month lock, the
 * department and special timings, the uploads (days, punches), the payroll feed, and running the jobs now.
 */
/** The late / early rule's outcome as the timing sheet words it. */
const RULE_WORDS = new Map<string, string>([
  ['No rule', 'none'],
  ['Half day', 'HD'],
  ['Absent', 'A'],
  ['Half day of a leave type', 'leave'],
]);
const RULE_CODES = new Map<string, string>([
  ['none', 'none'],
  ['hd', 'HD'],
  ['a', 'A'],
  ['leave', 'leave'],
]);
/** A timing's values as one text, to tell a row left as it was (empty and null alike). */
const keyOf = (v: Array<string | number | null | undefined>) =>
  v.map((x) => (x === null || x === undefined ? '' : String(x))).join('|');
const wordOf = (action: string) =>
  [...RULE_WORDS.entries()].find(([, v]) => v === action)?.[0] ?? 'No rule';

@Injectable()
export class AttendanceService implements OnModuleInit {
  private readonly log = new Logger(AttendanceService.name);
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly messages: MessagesService,
    private readonly leave: LeaveService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ---- messages of a correction ----------------------------------------------------------------------
  /** A correction's words for the messages: who, the day, what was asked, why. */
  private async regVars(c: PoolClient, id: string) {
    const g = (
      await c.query<{
        employee: string;
        user_id: string | null;
        day: string;
        in_time: string | null;
        out_time: string | null;
        day_type: string | null;
        reason: string;
        note: string | null;
        wf: string | null;
      }>(
        `SELECT e.display_name AS employee, e.user_id::text, g.day::text, to_char(g.in_time, 'HH24:MI') AS in_time,
                to_char(g.out_time, 'HH24:MI') AS out_time, g.day_type, g.reason, g.decision_note AS note,
                g.workflow_instance_id::text AS wf
           FROM staff_regularisations g JOIN employees e ON e.id = g.employee_id WHERE g.id = $1`,
        [id],
      )
    ).rows[0]!;
    return {
      g,
      vars: {
        employee: g.employee,
        day: dmy(g.day),
        asked:
          [
            g.in_time ? `IN ${g.in_time}` : null,
            g.out_time ? `OUT ${g.out_time}` : null,
            g.day_type,
          ]
            .filter(Boolean)
            .join(' · ') || 'the day',
        reason: g.reason.slice(0, 300),
      },
    };
  }
  private async waitingWith(c: PoolClient, instanceId: string | null) {
    if (!instanceId) return [];
    const r = await c.query<{ u: string }>(
      `SELECT unnest(s.assignee_user_ids)::text AS u FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
        WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending'`,
      [instanceId],
    );
    return r.rows.map((x) => x.u);
  }
  /** The approvers at the level a correction waits at are told. */
  private async tellApprovers(c: PoolClient, ctx: RequestContext, id: string) {
    const { g, vars } = await this.regVars(c, id);
    await notifyLeave(
      this.messages,
      this.log,
      c,
      ctx,
      'leave_correction_waiting',
      await this.waitingWith(c, g.wf),
      vars,
    );
  }

  onModuleInit() {
    this.workflow.onComplete('staff_regularisation', (c, ctx, inst, outcome) =>
      this.onRegDecided(c, ctx, inst, outcome),
    );
  }

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private mustOffice(ctx: RequestContext) {
    if (!this.has(ctx, LEAVE_OFFICE))
      throw new DomainError('permission-denied', 'Only the leave office does this', {
        status: 403,
      });
  }
  private async meIn(c: PoolClient) {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL AND status = 'active' ORDER BY id LIMIT 1`,
    );
    return r.rows[0]?.id ?? null;
  }
  private monthOf(m: string | undefined) {
    return m ? `${m}-01` : monthStart(istToday());
  }
  private async locked(c: PoolClient, day: string) {
    const r = await c.query<{ l: boolean }>(
      `SELECT app.staff_month_locked(app.current_school_id(), $1::date) AS l`,
      [day],
    );
    return r.rows[0]!.l;
  }

  // ---- the register --------------------------------------------------------------------------------
  /**
   * A month of every employee (a page at a time): each day's code (P, HD, A, WO, H, the leave's code — ½ for
   * half a day — LOP for loss of pay, HOLD), whether late, a punch missing, set by hand; the totals (P, HD, A,
   * WO, H, each leave type, late, missing, payable days); whether the month is locked.
   */
  async register(ctx: RequestContext, q: RegisterMonthDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), (c) => this.registerIn(c, q, null));
  }

  /** The staff whose reporting manager I am (this year's postings). */
  private async reportees(c: PoolClient) {
    const me = await this.meIn(c);
    if (!me) return [];
    return (
      await c.query<{ id: string }>(
        `SELECT DISTINCT p.employee_id::text AS id FROM postings p JOIN employees e ON e.id = p.employee_id
          WHERE p.reports_to_employee_id = $1 AND p.academic_year_id = app.current_academic_year_id()
            AND e.status = 'active' AND e.deleted_at IS NULL`,
        [me],
      )
    ).rows.map((x) => x.id);
  }

  /** How many staff report to me (the side menu's My team's attendance), without their register. */
  async teamSize(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => (await this.reportees(c)).length);
  }

  /** My team's attendance (docs/design/85, "my reportees' attendance"): the register of those reporting to me. */
  async team(ctx: RequestContext, q: RegisterMonthDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = await this.reportees(c);
      return { ...(await this.registerIn(c, q, ids)), team: ids.length };
    });
  }

  private async registerIn(c: PoolClient, q: RegisterMonthDto, only: string[] | null) {
    const month = this.monthOf(q.month);
    const end = addDays(monthStart(addDays(month, 32)), -1);
    const where = `WHERE e.deleted_at IS NULL AND e.status = 'active'
          AND ($1::bigint IS NULL OR e.id = $1) AND ($2::text IS NULL OR lower(e.department) = lower($2))
          AND ($3::text IS NULL OR e.display_name ILIKE '%' || $3 || '%' OR e.employee_code ILIKE '%' || $3 || '%')
          AND ($6::bigint[] IS NULL OR e.id = ANY($6::bigint[]))`;
    const args = [q.employeeId ?? null, q.department ?? null, q.q ?? null];
    const total = (
      await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM employees e ${where.replace(/\$6/g, () => '$4')}`,
        [...args, only],
      )
    ).rows[0]!.n;
    const emps = (
      await c.query<{ id: string; name: string; code: string; department: string | null }>(
        `SELECT e.id::text, e.display_name AS name, e.employee_code AS code, e.department FROM employees e ${where}
            ORDER BY e.display_name, e.employee_code LIMIT $4 OFFSET $5`,
        [...args, q.size, (q.page - 1) * q.size, only],
      )
    ).rows;
    const ids = emps.map((e) => e.id);
    const days = ids.length
      ? (
          await c.query<DayRow>(
            `SELECT a.id::text, a.employee_id::text, a.day::text, a.day_type, a.leave_type_id::text, t.code AS leave_code,
                      a.leave_portion::text, t.loss_of_pay, a.in_at, a.out_at, a.worked_hours::text, a.ot_hours::text,
                      a.late_minutes, a.early_minutes, a.manual, a.source, a.trace, a.remark
                 FROM staff_attendance_days a LEFT JOIN staff_leave_types t ON t.id = a.leave_type_id
                WHERE a.employee_id = ANY($1::bigint[]) AND a.day BETWEEN $2::date AND $3::date`,
            [ids, month, end],
          )
        ).rows
      : [];
    const missing = ids.length
      ? (
          await c.query<{ employee_id: string; day: string }>(
            `SELECT employee_id::text, day::text FROM staff_missing_punches
                WHERE employee_id = ANY($1::bigint[]) AND day BETWEEN $2::date AND $3::date AND status IN ('pending', 'used')`,
            [ids, month, end],
          )
        ).rows
      : [];
    const miss = new Set(missing.map((m) => `${m.employee_id}|${m.day}`));
    const types = (
      await c.query<{ code: string; lop: boolean }>(
        `SELECT code, loss_of_pay AS lop FROM staff_leave_types WHERE status = 'active' ORDER BY loss_of_pay, sort_order, code`,
      )
    ).rows;
    const lock = (
      await c.query<{
        locked: boolean;
        locked_at: Date;
        by: string | null;
        unlock_reason: string | null;
      }>(
        `SELECT locked, locked_at, (SELECT display_name FROM users u WHERE u.id = l.locked_by) AS by, unlock_reason
             FROM staff_month_locks l WHERE month = $1::date`,
        [month],
      )
    ).rows[0];
    const dates: string[] = [];
    for (let d = month; d <= end; d = addDays(d, 1)) dates.push(d);
    const today = istToday();
    const byEmp = new Map<string, DayRow[]>();
    for (const d of days) byEmp.set(d.employee_id, [...(byEmp.get(d.employee_id) ?? []), d]);
    const rows = emps.map((e) => {
      const mine = new Map((byEmp.get(e.id) ?? []).map((d) => [d.day, d]));
      const totals: Record<string, number> = {
        P: 0,
        HD: 0,
        A: 0,
        WO: 0,
        H: 0,
        HOLD: 0,
        late: 0,
        missing: 0,
      };
      for (const t of types) totals[t.code] = 0;
      const cells = dates.map((day) => {
        const d = mine.get(day);
        if (!d)
          return { day, code: day < today ? '·' : '', title: day < today ? 'Not marked' : '' };
        const half = d.leave_portion !== null && Number(d.leave_portion) < 1;
        if (d.day_type === 'LV') {
          const code = d.leave_code ?? 'LV';
          totals[code] = (totals[code] ?? 0) + (half ? 0.5 : 1);
          if (half) totals.P! += 0.5;
        } else if (d.day_type in totals) totals[d.day_type]! += 1;
        if (d.late_minutes > 0) totals.late! += 1;
        const isMiss = miss.has(`${e.id}|${day}`);
        if (isMiss) totals.missing! += 1;
        return {
          day,
          code:
            d.day_type === 'LV'
              ? `${d.loss_of_pay ? 'LOP' : (d.leave_code ?? 'LV')}${half ? '½' : ''}`
              : d.day_type,
          late: d.late_minutes > 0,
          missing: isMiss,
          manual: d.manual && d.source !== 'import',
          title: [
            TYPE_WORDS[d.day_type],
            d.in_at ? `IN ${hm(d.in_at)}` : null,
            d.out_at ? `OUT ${hm(d.out_at)}` : null,
            d.worked_hours ? `${d.worked_hours} h` : null,
            d.remark,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      });
      const lop = types.filter((t) => t.lop).reduce((s, t) => s + (totals[t.code] ?? 0), 0);
      // a half day pays half; an absent day, loss of pay and a salary hold pay nothing this month
      const payable = dates.length - totals.A! - totals.HD! / 2 - totals.HOLD! - lop;
      // past days nothing worked out (the nightly run has not reached them): payable until marked
      const unmarked = cells.filter((x) => x.code === '·').length;
      return { employee: e, cells, totals, payable, unmarked };
    });
    return {
      month,
      monthWords: monthWords(month),
      dates,
      types: types.map((t) => t.code),
      rows,
      total,
      page: q.page,
      size: q.size,
      lock: lock
        ? {
            locked: lock.locked,
            at: lock.locked_at.toISOString(),
            by: lock.by,
            unlockReason: lock.unlock_reason,
          }
        : null,
      mayLock: month < monthStart(today),
      departments: (
        await c.query<{ d: string }>(
          `SELECT DISTINCT department AS d FROM employees WHERE deleted_at IS NULL AND COALESCE(department, '') <> '' ORDER BY 1`,
        )
      ).rows.map((x) => x.d),
    };
  }

  /** The payroll feed of a month: per employee the days of each kind and the payable days (Excel). */
  async payrollFeed(ctx: RequestContext, q: RegisterMonthDto) {
    const data = await this.register(ctx, { ...q, page: 1, size: 100 });
    const all = [...data.rows];
    for (let p = 2; (p - 1) * 100 < data.total; p += 1)
      all.push(...(await this.register(ctx, { ...q, page: p, size: 100 })).rows);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = await purchaseHead(c, this.storage);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Payroll feed');
      ws.addRow([head.school]).font = { bold: true, size: 14 };
      ws.addRow([
        `Payroll attendance feed · ${data.monthWords}${data.lock?.locked ? ' · locked' : ' · NOT locked'}`,
      ]).font = {
        bold: true,
      };
      ws.addRow([`Generated on ${head.generatedOn}`]);
      // leave at part pay (half-pay leave): information for payroll, as the plan's decision says
      const part = (
        await c.query<{ code: string; pct: string }>(
          `SELECT code, pay_percent::text AS pct FROM staff_leave_types
            WHERE status = 'active' AND paid AND NOT loss_of_pay AND pay_percent IS NOT NULL AND pay_percent < 100`,
        )
      ).rows.map((x) => ({ code: x.code, pct: Number(x.pct) }));
      if (part.length)
        ws.addRow([
          `Part-pay leave: ${part.map((x) => `${x.code} at ${String(x.pct)}% pay`).join(', ')} — "Pay-equivalent days" counts them at that share.`,
        ]);
      else ws.addRow([]);
      const cols = [
        'Emp. code',
        'Employee',
        'Department',
        'Days',
        'Present',
        'Half day',
        'Absent',
        'Weekly off',
        'Holiday',
        ...data.types,
        'Hold',
        'Late marks',
        'Missing punches',
        'Not marked',
        'Payable days',
        'Pay-equivalent days',
      ];
      const h = ws.addRow(cols);
      h.font = { bold: true };
      for (const r of all)
        ws.addRow([
          r.employee.code,
          r.employee.name,
          r.employee.department,
          data.dates.length,
          r.totals.P,
          r.totals.HD,
          r.totals.A,
          r.totals.WO,
          r.totals.H,
          ...data.types.map((t) => r.totals[t] ?? 0),
          r.totals.HOLD,
          r.totals.late,
          r.totals.missing,
          r.unmarked,
          r.payable,
          Math.round(
            (r.payable -
              part.reduce((n, x) => n + (r.totals[x.code] ?? 0) * (1 - x.pct / 100), 0)) *
              100,
          ) / 100,
        ]);
      ws.getColumn(2).width = 28;
      ws.getColumn(3).width = 20;
      ws.views = [{ state: 'frozen', ySplit: 5, xSplit: 2 }];
      // encashment: information for payroll — each employee's policy for each type that may be encashed and
      // the balance it would be paid from (the school's encashment is not run here)
      const enc = await c.query<{
        code: string;
        name: string;
        type: string;
        policy: string;
        balance: string | null;
        min_days: string | null;
        yearly: boolean;
        yearly_days: string | null;
        on_exit: boolean;
        exit_days: string | null;
      }>(
        `SELECT e.employee_code AS code, e.display_name AS name, t.code AS type, p.name AS policy,
                (SELECT CASE WHEN b.closed THEN b.closing ELSE app.staff_leave_effective_closing(b) END FROM staff_leave_balances b
                  WHERE b.employee_id = e.id AND b.leave_type_id = t.id AND b.month <= $1::date ORDER BY b.month DESC LIMIT 1)::text AS balance,
                p.encash_min_days::text AS min_days, p.encash_yearly AS yearly, p.encash_yearly_days::text AS yearly_days,
                p.encash_on_exit AS on_exit, p.encash_on_exit_days::text AS exit_days
           FROM employees e CROSS JOIN staff_leave_types t
           JOIN LATERAL (SELECT x.* FROM staff_leave_policies x WHERE x.leave_type_id = t.id AND x.status = 'active'
                           AND app.staff_in_scope(x.scope, x.scope_values, e.id) ORDER BY x.priority, x.id LIMIT 1) p ON true
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND t.status = 'active' AND p.encash AND e.id = ANY($2::bigint[])
          ORDER BY e.display_name, t.sort_order, t.code`,
        [data.month, all.map((r) => r.employee.id)],
      );
      const es = wb.addWorksheet('Encashment (information)');
      es.addRow([
        'For payroll: the leave each employee may encash under their policy and the balance it is paid from.',
      ]).font = { italic: true };
      es.addRow([
        'Emp. code',
        'Employee',
        'Leave type',
        'Policy',
        'Balance',
        'Keep at least',
        'Each year (days)',
        'On leaving (days)',
      ]).font = { bold: true };
      for (const x of enc.rows)
        es.addRow([
          x.code,
          x.name,
          x.type,
          x.policy,
          x.balance === null ? null : Number(x.balance),
          x.min_days === null ? null : Number(x.min_days),
          x.yearly ? (x.yearly_days === null ? 'Yes' : Number(x.yearly_days)) : 'No',
          x.on_exit ? (x.exit_days === null ? 'Yes' : Number(x.exit_days)) : 'No',
        ]);
      es.getColumn(2).width = 28;
      es.getColumn(4).width = 24;
      return {
        filename: `payroll-feed-${data.month.slice(0, 7)}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64'),
      };
    });
  }

  // ---- a day ---------------------------------------------------------------------------------------
  async day(ctx: RequestContext, employeeId: string, day: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.meIn(c);
      const office = this.has(ctx, LEAVE_OFFICE);
      // an approver of a correction asked for the day sees it too, and decides it here
      const steps = await c.query<{ id: string; may: boolean }>(
        `SELECT g.id::text, bool_or(i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND g.status = 'pending'
                                    AND ${WorkflowService.MAY_ACT}) AS may
           FROM staff_regularisations g JOIN workflow_instances i ON i.id = g.workflow_instance_id
           JOIN workflow_steps s ON s.instance_id = i.id
          WHERE g.employee_id = $1 AND g.day = $2::date
            AND (${WorkflowService.MAY_ACT} OR s.acted_by = app.current_user_id() OR app.current_user_id() = ANY(s.approved_by))
          GROUP BY g.id`,
        [employeeId, day],
      );
      const manager =
        !office && me !== employeeId && !steps.rowCount
          ? (await this.reportees(c)).includes(employeeId)
          : false;
      if (!office && me !== employeeId && !steps.rowCount && !manager)
        throw new DomainError('not-found', 'Not found', { status: 404 });
      const e = (
        await c.query<{ name: string; code: string; department: string | null }>(
          `SELECT display_name AS name, employee_code AS code, department FROM employees WHERE id = $1`,
          [employeeId],
        )
      ).rows[0];
      if (!e) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const d = (
        await c.query<DayRow>(
          `SELECT a.id::text, a.employee_id::text, a.day::text, a.day_type, a.leave_type_id::text, t.code AS leave_code,
                  a.leave_portion::text, t.loss_of_pay, a.in_at, a.out_at, a.worked_hours::text, a.ot_hours::text, a.late_minutes,
                  a.early_minutes, a.manual, a.source, a.trace, a.remark
             FROM staff_attendance_days a LEFT JOIN staff_leave_types t ON t.id = a.leave_type_id
            WHERE a.employee_id = $1 AND a.day = $2::date`,
          [employeeId, day],
        )
      ).rows[0];
      const punches = await c.query<{ at: Date; source: string; device: string }>(
        `SELECT punched_at AS at, source, device FROM staff_punches
          WHERE employee_id = $1 AND punched_at >= ($2::date - 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
            AND punched_at < ($2::date + 2)::timestamp AT TIME ZONE 'Asia/Kolkata' ORDER BY punched_at`,
        [employeeId, day],
      );
      const history = await c.query<{
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        reason: string | null;
        by: string | null;
        at: Date;
      }>(
        `SELECT before, after, reason, (SELECT display_name FROM users u WHERE u.id = h.changed_by) AS by, changed_at AS at
           FROM staff_attendance_history h WHERE employee_id = $1 AND day = $2::date ORDER BY changed_at DESC LIMIT 10`,
        [employeeId, day],
      );
      const marks = await c.query<{
        kind: string;
        status: string;
        detail: string;
        reason: string | null;
      }>(
        `SELECT 'late' AS kind, status, late_minutes || ' min late' AS detail, reason FROM staff_late_marks WHERE employee_id = $1 AND day = $2::date
         UNION ALL SELECT 'missing', status, upper(missing) || ' missing', reason FROM staff_missing_punches WHERE employee_id = $1 AND day = $2::date`,
        [employeeId, day],
      );
      const leave = await c.query<{
        id: string;
        number: string;
        code: string;
        portion: string;
        status: string;
      }>(
        `SELECT r.id::text, r.number, t.code, x.portion::text, r.status FROM staff_leave_days x JOIN staff_leave_requests r ON r.id = x.request_id
           JOIN staff_leave_types t ON t.id = r.leave_type_id WHERE x.employee_id = $1 AND x.day = $2::date AND x.status IN ('pending', 'approved')`,
        [employeeId, day],
      );
      const regs = await c.query<{
        id: string;
        status: string;
        in_time: string | null;
        out_time: string | null;
        day_type: string | null;
        reason: string;
      }>(
        `SELECT id::text, status, to_char(in_time, 'HH24:MI') AS in_time, to_char(out_time, 'HH24:MI') AS out_time, day_type, reason
           FROM staff_regularisations WHERE employee_id = $1 AND day = $2::date ORDER BY id DESC`,
        [employeeId, day],
      );
      const isLocked = await this.locked(c, day);
      const word = (x: Record<string, unknown> | null) =>
        x
          ? `${TYPE_WORDS[String(x.day_type)] ?? String(x.day_type)}${x.in_at ? ` IN ${hm(new Date(String(x.in_at))) ?? ''}` : ''}${x.out_at ? ` OUT ${hm(new Date(String(x.out_at))) ?? ''}` : ''}`
          : 'nothing';
      return {
        employee: { id: employeeId, ...e },
        day,
        row: d
          ? {
              dayType: d.day_type,
              words: TYPE_WORDS[d.day_type] ?? d.day_type,
              leave: d.leave_code
                ? `${d.leave_code}${d.leave_portion && Number(d.leave_portion) < 1 ? ' (half day)' : ''}`
                : null,
              in: hm(d.in_at),
              out: hm(d.out_at),
              worked: d.worked_hours === null ? null : Number(d.worked_hours),
              overtime: Number(d.ot_hours),
              late: d.late_minutes,
              early: d.early_minutes,
              manual: d.manual && d.source !== 'import',
              source: d.source,
              remark: d.remark,
              how: traceWords(d.trace),
            }
          : null,
        punches: punches.rows.map((p) => ({
          at: p.at.toISOString(),
          time: hm(p.at),
          date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(p.at),
          source: p.source,
          device: p.device,
        })),
        history: history.rows.map((h) => ({
          from: word(h.before),
          to: word(h.after),
          reason: h.reason,
          by: h.by ?? 'the system',
          at: h.at.toISOString(),
        })),
        marks: marks.rows,
        leave: leave.rows.map((l) => ({ ...l, portion: Number(l.portion) })),
        regularisations: regs.rows,
        locked: isLocked,
        can: {
          mine: me === employeeId,
          /** a reporting manager's view of their reportee's day */
          team: manager,
          /** the correction waiting at my level, to decide here */
          decide: steps.rows.find((x) => x.may)?.id ?? null,
          correct: office && !isLocked,
          regularise:
            me === employeeId &&
            !isLocked &&
            day <= istToday() &&
            !regs.rows.some((r) => r.status === 'pending' || r.status === 'approved'),
        },
      };
    });
  }

  /**
   * Write a day set by a person (the office's correction, an upload, an approved regularisation): the times
   * on the day (an OUT before the IN is the next morning), the hours, the type given or — when empty —
   * worked out from the hours with the day's timing; the late mark and missing punch it settles cleared.
   */
  private async setDay(
    c: PoolClient,
    employeeId: string,
    day: string,
    x: {
      dayType: string | null;
      in: string | null;
      out: string | null;
      source: 'manual' | 'bulk' | 'regularisation';
      reason: string;
    },
  ) {
    const r = await c.query<{ res: string }>(
      `WITH t AS (SELECT * FROM app.staff_timing($1, $2::date)),
            old AS (SELECT * FROM staff_attendance_days WHERE employee_id = $1 AND day = $2::date),
            v AS (SELECT COALESCE(($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata', (SELECT in_at FROM old)) AS in_at,
                         COALESCE(($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata'
                                   + CASE WHEN $4::time < COALESCE($3::time, '00:00'::time) THEN interval '1 day' ELSE interval '0' END,
                                  (SELECT out_at FROM old)) AS out_at)
       SELECT app.staff_day_write(ROW(NULL, app.current_school_id(), $1, $2::date,
                CASE WHEN $5::text IS NOT NULL THEN $5::text
                     WHEN v.in_at IS NOT NULL AND v.out_at IS NOT NULL THEN
                       CASE WHEN extract(epoch FROM v.out_at - v.in_at) / 3600 >= (SELECT present_hours FROM t) THEN 'P'
                            WHEN extract(epoch FROM v.out_at - v.in_at) / 3600 >= (SELECT half_day_hours FROM t) THEN 'HD' ELSE 'A' END
                     ELSE COALESCE((SELECT day_type FROM old), 'P') END,
                NULL, NULL, (SELECT shift_id FROM t), v.in_at, v.out_at,
                CASE WHEN v.in_at IS NOT NULL AND v.out_at IS NOT NULL THEN round(floor(extract(epoch FROM v.out_at - v.in_at) / 60) / 60.0, 2) END,
                0, 0, 0, true, $6::text, jsonb_build_object('set', $6::text, 'reason', $7::text), $7::text, NULL, now())::staff_attendance_days, $7::text) AS res
         FROM v`,
      [employeeId, day, x.in, x.out, x.dayType, x.source, x.reason],
    );
    await c.query(
      `UPDATE staff_missing_punches m SET status = 'retired', reason = 'Corrected: ' || left($3, 200)
         FROM staff_attendance_days a WHERE a.employee_id = m.employee_id AND a.day = m.day AND m.employee_id = $1 AND m.day = $2::date
          AND m.status = 'pending' AND (a.in_at IS NOT NULL AND a.out_at IS NOT NULL OR a.day_type IN ('A', 'WO', 'H', 'HOLD'))`,
      [employeeId, day, x.reason],
    );
    await c.query(
      `UPDATE staff_late_marks m SET status = 'waived', reason = 'Corrected: ' || left($3, 200)
         FROM staff_attendance_days a, app.staff_timing($1, $2::date) t
        WHERE a.employee_id = m.employee_id AND a.day = m.day AND m.employee_id = $1 AND m.day = $2::date AND m.status = 'pending'
          AND (a.in_at IS NULL OR a.in_at <= ($2::date + t.starts_at) AT TIME ZONE 'Asia/Kolkata' + make_interval(mins => t.grace)
               OR a.day_type IN ('WO', 'H', 'HOLD'))`,
      [employeeId, day, x.reason],
    );
    await this.rollBack(c, employeeId, day, x.reason);
    await c.query(
      `UPDATE staff_attendance_days SET late_minutes = 0 WHERE employee_id = $1 AND day = $2::date
          AND EXISTS (SELECT 1 FROM staff_late_marks m WHERE m.employee_id = $1 AND m.day = $2::date AND m.status = 'waived')`,
      [employeeId, day],
    );
    return r.rows[0]!.res;
  }

  /**
   * The late roll-back (the earlier module's job, done in full here): a late mark or missing punch already
   * turned into leave, corrected away — the mark cleared, that leave cancelled (its days and balance back),
   * its other marks and the month's lapsed ones counting again, and a month already over deducted afresh.
   */
  private async rollBack(c: PoolClient, emp: string, day: string, reason: string) {
    const month = monthStart(day);
    const end = addDays(monthStart(addDays(month, 32)), -1);
    for (const kind of ['late', 'missing'] as const) {
      const done =
        kind === 'late'
          ? await c.query<{ req: string | null }>(
              `UPDATE staff_late_marks m SET status = 'waived', reason = 'Corrected: ' || left($3, 200)
                 FROM staff_attendance_days a, app.staff_timing($1, $2::date) t
                WHERE a.employee_id = m.employee_id AND a.day = m.day AND m.employee_id = $1 AND m.day = $2::date AND m.status = 'used'
                  AND (a.in_at IS NULL OR a.in_at <= ($2::date + t.starts_at) AT TIME ZONE 'Asia/Kolkata' + make_interval(mins => t.grace)
                       OR a.day_type IN ('WO', 'H', 'HOLD'))
               RETURNING m.request_id::text AS req`,
              [emp, day, reason],
            )
          : await c.query<{ req: string | null }>(
              `UPDATE staff_missing_punches m SET status = 'retired', reason = 'Corrected: ' || left($3, 200)
                 FROM staff_attendance_days a WHERE a.employee_id = m.employee_id AND a.day = m.day AND m.employee_id = $1
                  AND m.day = $2::date AND m.status = 'used'
                  AND (a.in_at IS NOT NULL AND a.out_at IS NOT NULL OR a.day_type IN ('A', 'WO', 'H', 'HOLD'))
               RETURNING m.request_id::text AS req`,
              [emp, day, reason],
            );
      const reqs = [...new Set(done.rows.map((x) => x.req).filter((x): x is string => !!x))];
      if (!done.rowCount) continue;
      const table = kind === 'late' ? 'staff_late_marks' : 'staff_missing_punches';
      for (const req of reqs) {
        await this.leave.cancelSystem(
          c,
          req,
          `${kind === 'late' ? 'A late mark' : 'A missing punch'} of ${dmy(day)} corrected`,
        );

        await c.query(
          `UPDATE ${table} SET status = 'pending', request_id = NULL WHERE request_id = $1 AND status = 'used'`,
          [req],
        );
      }

      await c.query(
        `UPDATE ${table} SET status = 'pending' WHERE employee_id = $1 AND status = 'lapsed' AND day BETWEEN $2::date AND $3::date`,
        [emp, month, end],
      );
      if (month < monthStart(istToday())) {
        await c.query(`DELETE FROM staff_attendance_runs WHERE kind = $1 AND month = $2::date`, [
          kind,
          month,
        ]);
        await c.query(`SELECT app.staff_month_deduct($1, $2::date)`, [kind, month]);
      }
    }
  }

  /** The office corrects a day (not one on leave: cancel or shorten the leave first). */
  async correct(ctx: RequestContext, dto: DayCorrectDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (await this.locked(c, dto.day))
        fail(`${monthWords(dto.day)} is locked for payroll: unlock it first`, 409);
      if (dto.day > istToday()) fail('A day still to come is not corrected');
      const s = (
        await c.query<{ allow: boolean }>(
          `SELECT allow_time_edit AS allow FROM staff_leave_settings`,
        )
      ).rows[0];
      if ((dto.in || dto.out) && s && !s.allow)
        fail('Changing punch times is switched off in Leave & attendance settings', 409);
      const lv = await c.query<{ number: string }>(
        `SELECT r.number FROM staff_leave_days x JOIN staff_leave_requests r ON r.id = x.request_id
          WHERE x.employee_id = $1 AND x.day = $2::date AND x.status IN ('pending', 'approved') AND x.portion = 1
            AND r.source NOT IN ('auto_late', 'auto_missing', 'auto_rule') LIMIT 1`,
        [dto.employeeId, dto.day],
      );
      if (lv.rows[0])
        fail(`${lv.rows[0].number} covers this day: cancel or shorten the leave first`, 409);
      const res = await this.setDay(c, dto.employeeId, dto.day, {
        dayType: dto.dayType ?? null,
        in: dto.in ?? null,
        out: dto.out ?? null,
        source: 'manual',
        reason: dto.reason,
      });
      await this.audit.stage(ctx, c, {
        action: 'leave.attendance.correct',
        entityType: 'staff_attendance_days',
        entityId: dto.employeeId,
        after: { ...dto },
      });
      return { result: res };
    });
  }

  // ---- my month and regularisation -----------------------------------------------------------------
  async myMonth(ctx: RequestContext, q: MyMonthDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.meIn(c);
      if (!me)
        return { employee: null, month: this.monthOf(q.month), days: [], regularisations: [] };
      const month = this.monthOf(q.month);
      const end = addDays(monthStart(addDays(month, 32)), -1);
      const rows = await c.query<DayRow>(
        `SELECT a.id::text, a.employee_id::text, a.day::text, a.day_type, a.leave_type_id::text, t.code AS leave_code, a.leave_portion::text,
                t.loss_of_pay, a.in_at, a.out_at, a.worked_hours::text, a.ot_hours::text, a.late_minutes, a.early_minutes, a.manual,
                a.source, a.trace, a.remark
           FROM staff_attendance_days a LEFT JOIN staff_leave_types t ON t.id = a.leave_type_id
          WHERE a.employee_id = $1 AND a.day BETWEEN $2::date AND $3::date ORDER BY a.day`,
        [me, month, end],
      );
      const regs = await c.query<{
        id: string;
        day: string;
        status: string;
        in_time: string | null;
        out_time: string | null;
        day_type: string | null;
        reason: string;
        waiting: string | null;
      }>(
        `SELECT g.id::text, g.day::text, g.status, to_char(g.in_time, 'HH24:MI') AS in_time, to_char(g.out_time, 'HH24:MI') AS out_time,
                g.day_type, g.reason,
                (SELECT s.name || ': ' || COALESCE((SELECT string_agg(u.display_name, ', ') FROM users u WHERE u.id = ANY(s.assignee_user_ids)), 'nobody')
                   FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
                  WHERE i.id = g.workflow_instance_id AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' LIMIT 1) AS waiting
           FROM staff_regularisations g WHERE g.employee_id = $1 AND g.day BETWEEN $2::date AND $3::date ORDER BY g.day DESC`,
        [me, month, end],
      );
      const e = (
        await c.query<{ name: string; code: string }>(
          `SELECT display_name AS name, employee_code AS code FROM employees WHERE id = $1`,
          [me],
        )
      ).rows[0]!;
      return {
        employee: { id: me, ...e },
        month,
        monthWords: monthWords(month),
        locked: await this.locked(c, month),
        days: rows.rows.map((d) => ({
          day: d.day,
          dayType: d.day_type,
          code:
            d.day_type === 'LV'
              ? `${d.loss_of_pay ? 'LOP' : (d.leave_code ?? 'LV')}${d.leave_portion && Number(d.leave_portion) < 1 ? '½' : ''}`
              : d.day_type,
          words: TYPE_WORDS[d.day_type],
          in: hm(d.in_at),
          out: hm(d.out_at),
          worked: d.worked_hours === null ? null : Number(d.worked_hours),
          late: d.late_minutes,
          early: d.early_minutes,
          manual: d.manual && d.source !== 'import',
          remark: d.remark,
        })),
        regularisations: regs.rows,
      };
    });
  }

  /** I ask for my day to be corrected: decided by the regularisation rule of Who approves. */
  async regularise(ctx: RequestContext, dto: RegulariseDto) {
    if (!this.has(ctx, LEAVE_OWN))
      throw new DomainError('permission-denied', 'Not open to you', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.meIn(c);
      if (!me) fail('Your sign-in is not linked to an employee: ask the office', 403);
      if (dto.day > istToday()) fail('A day still to come is not corrected');
      if (await this.locked(c, dto.day)) fail(`${monthWords(dto.day)} is locked for payroll`, 409);
      if (dto.documentFileId) {
        const f = await c.query(
          `SELECT 1 FROM files WHERE id = $1 AND status = 'ready' AND created_by = app.current_user_id()`,
          [dto.documentFileId],
        );
        if (!f.rowCount) fail('Attach your own file');
      }
      const chain = await chainFor(c, me!, 'regularisation', null, 1);
      if (!chain)
        fail('Nobody is set to approve attendance corrections for you: ask the leave office', 409);
      let id: string;
      try {
        id = (
          await c.query<{ id: string }>(
            `INSERT INTO staff_regularisations (school_id, employee_id, day, in_time, out_time, day_type, reason, document_file_id, created_by)
             VALUES (app.current_school_id(), $1, $2::date, $3::time, $4::time, $5, $6, $7, app.current_user_id()) RETURNING id::text`,
            [
              me,
              dto.day,
              dto.in ?? null,
              dto.out ?? null,
              dto.dayType ?? null,
              dto.reason,
              dto.documentFileId ?? null,
            ],
          )
        ).rows[0]!.id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          fail('A correction of that day is already asked (or approved)', 409);
        throw e;
      }
      const e = (
        await c.query<{ name: string; department: string | null }>(
          `SELECT display_name AS name, department FROM employees WHERE id = $1`,
          [me],
        )
      ).rows[0]!;
      const code = await leaveFlow(
        c,
        'staff_regularisation',
        chain!.ruleId,
        chain!.rule,
        chain!.band,
        chain!.levels,
      );
      const inst = await this.workflow.start(c, ctx, {
        definitionCode: code,
        entityType: 'staff_regularisation',
        entityId: id,
        subject: `Attendance correction · ${e.name} · ${dmy(dto.day)}`,
        payload: { employeeId: me, department: e.department ?? '' },
      });
      await c.query(`UPDATE staff_regularisations SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        inst.id,
      ]);
      if (inst.status === 'approved') await this.applyReg(c, id);
      else await this.tellApprovers(c, ctx, id);
      return { id, status: inst.status === 'approved' ? 'approved' : 'pending' };
    });
  }

  /** A correction brought from the old module, approved there: the day set as asked (phase E). */
  async applyImportedReg(c: PoolClient, id: string) {
    const g = (
      await c.query<{
        employee_id: string;
        day: string;
        in_time: string | null;
        out_time: string | null;
        day_type: string | null;
        reason: string;
      }>(
        `SELECT employee_id::text, day::text, to_char(in_time, 'HH24:MI') AS in_time, to_char(out_time, 'HH24:MI') AS out_time, day_type, reason
           FROM staff_regularisations WHERE id = $1 AND status = 'approved'`,
        [id],
      )
    ).rows[0];
    if (!g || (await this.locked(c, g.day))) return;
    await this.setDay(c, g.employee_id, g.day, {
      dayType: g.day_type,
      in: g.in_time,
      out: g.out_time,
      source: 'regularisation',
      reason: `Correction approved in the old module: ${g.reason}`,
    });
  }

  /** A correction brought from the old module still waiting at the switch: its approval starts (phase E). */
  async startImportedReg(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
  ): Promise<'started' | 'approved' | 'nobody'> {
    const g = (
      await c.query<{ employee_id: string; day: string; name: string; department: string | null }>(
        `SELECT g.employee_id::text, g.day::text, e.display_name AS name, e.department
           FROM staff_regularisations g JOIN employees e ON e.id = g.employee_id
          WHERE g.id = $1 AND g.status = 'pending' AND g.workflow_instance_id IS NULL`,
        [id],
      )
    ).rows[0];
    if (!g) return 'nobody';
    const chain = await chainFor(c, g.employee_id, 'regularisation', null, 1);
    if (!chain) return 'nobody';
    const code = await leaveFlow(
      c,
      'staff_regularisation',
      chain.ruleId,
      chain.rule,
      chain.band,
      chain.levels,
    );
    const inst = await this.workflow.start(c, ctx, {
      definitionCode: code,
      entityType: 'staff_regularisation',
      entityId: id,
      subject: `Attendance correction · ${g.name} · ${dmy(g.day)}`,
      payload: { employeeId: g.employee_id, department: g.department ?? '' },
    });
    await c.query(`UPDATE staff_regularisations SET workflow_instance_id = $2 WHERE id = $1`, [
      id,
      inst.id,
    ]);
    if (inst.status === 'approved') {
      await this.applyReg(c, id);
      return 'approved';
    }
    return 'started';
  }

  private async applyReg(c: PoolClient, id: string) {
    const g = (
      await c.query<{
        employee_id: string;
        day: string;
        in_time: string | null;
        out_time: string | null;
        day_type: string | null;
        reason: string;
      }>(
        `SELECT employee_id::text, day::text, to_char(in_time, 'HH24:MI') AS in_time, to_char(out_time, 'HH24:MI') AS out_time, day_type, reason
           FROM staff_regularisations WHERE id = $1`,
        [id],
      )
    ).rows[0]!;
    await c.query(
      `UPDATE staff_regularisations SET status = 'approved', decided_at = now(), decided_by = app.current_user_id() WHERE id = $1`,
      [id],
    );
    await this.setDay(c, g.employee_id, g.day, {
      dayType: g.day_type,
      in: g.in_time,
      out: g.out_time,
      source: 'regularisation',
      reason: `Correction approved: ${g.reason}`,
    });
  }

  private async onRegDecided(
    c: PoolClient,
    ctx: RequestContext,
    inst: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    if (inst.status === 'cancelled') return;
    const g = (
      await c.query<{ status: string; day: string }>(
        `SELECT status, day::text FROM staff_regularisations WHERE id = $1 FOR UPDATE`,
        [inst.entityId],
      )
    ).rows[0];
    if (!g || g.status !== 'pending') return;
    const last = [...inst.steps].reverse().find((s) => s.actedAt);
    if (outcome === 'approved') {
      if (await this.locked(c, g.day)) fail(`${monthWords(g.day)} is locked for payroll`, 409);
      await this.applyReg(c, inst.entityId);
    } else
      await c.query(
        `UPDATE staff_regularisations SET status = 'rejected', decided_at = now(), decided_by = app.current_user_id(), decision_note = $2 WHERE id = $1`,
        [inst.entityId, last?.note ?? null],
      );
    const { g: x, vars } = await this.regVars(c, inst.entityId);
    await notifyLeave(
      this.messages,
      this.log,
      c,
      ctx,
      outcome === 'approved' ? 'leave_correction_approved' : 'leave_correction_rejected',
      [x.user_id],
      { ...vars, by: last?.actedBy ?? 'the approver', note: x.note ?? '' },
    );
  }

  async decideReg(ctx: RequestContext, id: string, dto: DecideDto) {
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const g = (
        await c.query<{ status: string; wf: string | null; day: string }>(
          `SELECT status, workflow_instance_id::text AS wf, day::text FROM staff_regularisations WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!g) throw new DomainError('not-found', 'Not found', { status: 404 });
      if (g.status !== 'pending' || !g.wf) fail('This correction is not waiting', 409);
      if (dto.outcome === 'approved' && (await this.locked(c, g.day)))
        fail(`${monthWords(g.day)} is locked for payroll`, 409);
      const s = await c.query<{ id: string }>(MY_STEP, [g.wf]);
      if (!s.rows[0]) fail('This correction is not waiting for you', 403);
      return s.rows[0]!.id;
    });
    await this.workflow.act(ctx, step, dto.outcome, { note: dto.note || undefined });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const status = (
        await c.query<{ status: string }>(
          `SELECT status FROM staff_regularisations WHERE id = $1`,
          [id],
        )
      ).rows[0]!.status;
      // approved at a level with one to come: the next level is told
      if (status === 'pending') await this.tellApprovers(c, ctx, id);
      return { id, status };
    });
  }

  async withdrawReg(ctx: RequestContext, id: string, dto: WithdrawDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = (
        await c.query<{ status: string; wf: string | null; employee_id: string }>(
          `SELECT status, workflow_instance_id::text AS wf, employee_id::text FROM staff_regularisations WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      const me = await this.meIn(c);
      if (!g || (g.employee_id !== me && !this.has(ctx, LEAVE_OFFICE)))
        throw new DomainError('not-found', 'Not found', { status: 404 });
      if (g.status !== 'pending') fail('Only a correction still waiting is withdrawn', 409);
      if (g.wf) await this.workflow.cancelIn(c, ctx, g.wf, dto.reason || 'Withdrawn');
      await c.query(
        `UPDATE staff_regularisations SET status = 'withdrawn', decided_at = now(), decided_by = app.current_user_id(), decision_note = $2 WHERE id = $1`,
        [id, dto.reason || null],
      );
      return { id, status: 'withdrawn' };
    });
  }

  /** Corrections waiting for my decision (or decided by me). */
  async regApprovals(ctx: RequestContext, view: 'waiting' | 'decided') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await c.query<{
        id: string;
        day: string;
        status: string;
        in_time: string | null;
        out_time: string | null;
        day_type: string | null;
        reason: string;
        employee: string;
        code: string;
        employee_id: string;
        since: Date;
      }>(
        `SELECT g.id::text, g.day::text, g.status, to_char(g.in_time, 'HH24:MI') AS in_time, to_char(g.out_time, 'HH24:MI') AS out_time,
                g.day_type, g.reason, e.display_name AS employee, e.employee_code AS code, e.id::text AS employee_id,
                ${view === 'waiting' ? 'i.requested_at' : 's.acted_at'} AS since
           FROM staff_regularisations g JOIN employees e ON e.id = g.employee_id
           JOIN workflow_instances i ON i.id = g.workflow_instance_id
           JOIN workflow_steps s ON s.instance_id = i.id
          WHERE ${view === 'waiting' ? `i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}` : 's.acted_by = app.current_user_id()'}
          ORDER BY since ${view === 'waiting' ? 'ASC' : 'DESC'} LIMIT 300`,
      );
      const out = [];
      for (const r of rows.rows) {
        const may = view === 'waiting';
        out.push({ ...r, since: r.since.toISOString(), mayDecide: may });
      }
      return { rows: out };
    });
  }

  // ---- exceptions ----------------------------------------------------------------------------------
  async exceptions(ctx: RequestContext, q: ExceptionsDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const month = this.monthOf(q.month);
      const end = addDays(monthStart(addDays(month, 32)), -1);
      const table = {
        late: 'staff_late_marks',
        missing: 'staff_missing_punches',
        regularisation: 'staff_regularisations',
      }[q.kind];
      const detail = {
        late: `x.late_minutes || ' min late (IN ' || to_char(x.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') || ', start ' || to_char(x.starts_at, 'HH24:MI') || ' + ' || x.grace || ')'`,
        missing: `upper(x.missing) || ' missing'`,
        regularisation: `concat_ws(' · ', 'IN ' || to_char(x.in_time, 'HH24:MI'), 'OUT ' || to_char(x.out_time, 'HH24:MI'), x.day_type, x.reason)`,
      }[q.kind];
      const extra = q.kind === 'regularisation' ? `x.decision_note` : `x.reason`;
      const req =
        q.kind === 'regularisation'
          ? `NULL::text`
          : `(SELECT r.number FROM staff_leave_requests r WHERE r.id = x.request_id)`;
      const where = `WHERE x.day BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR x.status = $3)
          AND ($4::bigint IS NULL OR x.employee_id = $4) AND ($5::text IS NULL OR lower(e.department) = lower($5))`;
      const args = [month, end, q.status ?? null, q.employeeId ?? null, q.department ?? null];
      const counts = await c.query<{ status: string; n: number }>(
        `SELECT x.status, count(*)::int AS n FROM ${table} x JOIN employees e ON e.id = x.employee_id
          WHERE x.day BETWEEN $1::date AND $2::date GROUP BY x.status`,
        [month, end],
      );
      const total = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table} x JOIN employees e ON e.id = x.employee_id ${where}`,
          args,
        )
      ).rows[0]!.n;
      const rows = await c.query<{
        id: string;
        day: string;
        employee: string;
        code: string;
        employee_id: string;
        status: string;
        detail: string;
        note: string | null;
        leave: string | null;
      }>(
        `SELECT x.id::text, x.day::text, e.display_name AS employee, e.employee_code AS code, e.id::text AS employee_id, x.status,
                ${detail} AS detail, ${extra} AS note, ${req} AS leave
           FROM ${table} x JOIN employees e ON e.id = x.employee_id ${where}
          ORDER BY x.day DESC, e.display_name LIMIT $6 OFFSET $7`,
        q.format ? [...args, LIST_LIMIT, 0] : [...args, q.size, (q.page - 1) * q.size],
      );
      if (q.format) {
        checkListSize(rows.rows.length, 'rows');
        const title = {
          late: 'Late marks',
          missing: 'Missing punches',
          regularisation: 'Attendance corrections',
        }[q.kind];
        const status: Record<string, string> = {
          pending: q.kind === 'regularisation' ? 'Waiting' : 'Counting',
          used: 'Charged as leave',
          waived: 'Waived',
          retired: 'Cleared',
          lapsed: 'Lapsed',
          approved: 'Approved',
          rejected: 'Not approved',
          withdrawn: 'Withdrawn',
          cancelled: 'Cancelled',
        };
        return purchaseListFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          title: `${title} · ${monthWords(month)}`,
          slug: `Attendance-${q.kind}`,
          words: [monthWords(month), q.status ? `Only: ${status[q.status] ?? q.status}` : null]
            .filter(Boolean)
            .join(' · '),
          list: {
            columns: [
              { label: 'Date', type: 'date' },
              { label: 'Emp. code', width: 1.4 },
              { label: 'Employee', width: 3 },
              { label: 'What', width: 4 },
              { label: 'Status', width: 1.6 },
              { label: 'As leave', width: 1.8 },
              { label: 'Note', width: 3 },
            ],
            rows: rows.rows.map((x) => [
              x.day,
              x.code,
              x.employee,
              x.detail,
              status[x.status] ?? x.status,
              x.leave,
              x.note,
            ]),
          },
        });
      }
      return {
        month,
        monthWords: monthWords(month),
        kind: q.kind,
        counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
        rows: rows.rows,
        total,
        page: q.page,
        size: q.size,
      };
    });
  }

  /** The office waives a late mark or retires a missing punch still pending (with the reason). */
  async clearMark(ctx: RequestContext, kind: 'late' | 'missing', id: string, reason: string) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ day: string }>(
        kind === 'late'
          ? `UPDATE staff_late_marks SET status = 'waived', reason = $2 WHERE id = $1 AND status = 'pending' RETURNING day::text`
          : `UPDATE staff_missing_punches SET status = 'retired', reason = $2 WHERE id = $1 AND status = 'pending' RETURNING day::text`,
        [id, reason],
      );
      if (!r.rows[0])
        fail('Only a pending mark is cleared (one turned into leave: cancel that leave)', 409);
      await this.audit.stage(ctx, c, {
        action: `leave.attendance.${kind === 'late' ? 'waive_late' : 'retire_missing'}`,
        entityType: kind === 'late' ? 'staff_late_marks' : 'staff_missing_punches',
        entityId: id,
        after: { reason },
      });
      return { id, status: kind === 'late' ? 'waived' : 'retired' };
    });
  }

  // ---- the payroll lock ----------------------------------------------------------------------------
  /** Lock a past month (the absent days nobody explained become loss of pay first); unlock with a reason. */
  async lock(ctx: RequestContext, dto: LockDto, lock: boolean) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const month = `${dto.month}-01`;
      if (lock) {
        if (month >= monthStart(istToday())) fail('Only a month that is over is locked', 409);
        if (await this.locked(c, month)) fail(`${monthWords(month)} is already locked`, 409);
        const swept = (
          await c.query<{ n: number }>(`SELECT app.staff_lop_sweep($1::date) AS n`, [month])
        ).rows[0]!.n;
        await c.query(
          `INSERT INTO staff_month_locks (school_id, month, locked, locked_by, locked_at, unlocked_by, unlocked_at, unlock_reason)
           VALUES (app.current_school_id(), $1::date, true, app.current_user_id(), now(), NULL, NULL, NULL)
           ON CONFLICT (school_id, month) DO UPDATE SET locked = true, locked_by = app.current_user_id(), locked_at = now()`,
          [month],
        );
        await this.audit.stage(ctx, c, {
          action: 'leave.month.lock',
          entityType: 'staff_month_locks',
          entityId: '0',
          after: { month, lossOfPay: swept },
        });
        return { month, locked: true, lossOfPay: swept };
      }
      if (dto.reason.length < 3) fail('Say why the month is unlocked');
      const r = await c.query(
        `UPDATE staff_month_locks SET locked = false, unlocked_by = app.current_user_id(), unlocked_at = now(), unlock_reason = $2
          WHERE month = $1::date AND locked`,
        [month, dto.reason],
      );
      if (!r.rowCount) fail(`${monthWords(month)} is not locked`, 409);
      await this.audit.stage(ctx, c, {
        action: 'leave.month.unlock',
        entityType: 'staff_month_locks',
        entityId: '0',
        after: { month, reason: dto.reason },
      });
      return { month, locked: false };
    });
  }

  /** Run a job now: read the punches, the nightly run, work a range out again, a month's deductions. */
  async run(ctx: RequestContext, dto: RunDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_leave_seed_all(app.current_school_id())`);
      let n = 0;
      if (dto.what === 'sync')
        n = (await c.query<{ n: number }>(`SELECT app.staff_attendance_sync(5000) AS n`)).rows[0]!
          .n;
      else if (dto.what === 'nightly')
        n = (await c.query<{ n: number }>(`SELECT app.staff_attendance_nightly() AS n`)).rows[0]!.n;
      else if (dto.what === 'recompute') {
        const to = dto.to ?? addDays(istToday(), -1);
        const from = dto.from ?? addDays(to, -6);
        if (from > to || addDays(from, 62) < to) fail('Up to 62 days at a time');
        if (to >= istToday()) fail('Up to yesterday: today is still running');
        // the punches again, then what the nightly run does for the range: weekly offs and holidays, absence
        // (no punch, no leave), late marks (missing punches stay with the nightly run's last week, so no
        // one is mailed about an old day)
        const lookback = Math.round((Date.parse(istToday()) - Date.parse(from)) / 86_400_000) || 1;
        n = (
          await c.query<{ n: number }>(
            `SELECT app.staff_attendance_recompute($1::date, $2::date)
                  + app.staff_mark_offdays($1::date, $2::date)
                  + app.staff_mark_absent($3::int)
                  + app.staff_late_marks(date_trunc('month', $1::date)::date) AS n`,
            [from, to, lookback],
          )
        ).rows[0]!.n;
      } else {
        const month = dto.month
          ? `${dto.month}-01`
          : monthStart(addDays(monthStart(istToday()), -1));
        if (month >= monthStart(istToday())) fail('A month is deducted once it is over', 409);
        n =
          (
            await c.query<{ n: number }>(`SELECT app.staff_month_deduct('late', $1::date) AS n`, [
              month,
            ])
          ).rows[0]!.n +
          (
            await c.query<{ n: number }>(
              `SELECT app.staff_month_deduct('missing', $1::date) AS n`,
              [month],
            )
          ).rows[0]!.n;
      }
      await this.audit.stage(ctx, c, {
        action: `leave.attendance.run_${dto.what}`,
        entityType: 'staff_attendance_days',
        entityId: '0',
        after: { ...dto, n },
      });
      return { what: dto.what, n };
    });
  }

  // ---- timings -------------------------------------------------------------------------------------
  async timings(ctx: RequestContext) {
    if (!this.has(ctx, 'leave.setup.view'))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        kind: string;
        department: string | null;
        employee: string | null;
        employee_id: string | null;
        from_date: string | null;
        to_date: string | null;
        starts_at: string;
        ends_at: string;
        grace_minutes: number;
        present_hours: string;
        half_day_hours: string;
        late_over_minutes: number | null;
        late_action: string;
        late_type_id: string | null;
        early_over_minutes: number | null;
        early_action: string;
        early_type_id: string | null;
        note: string | null;
      }>(
        `SELECT t.id::text, t.kind, t.department, e.display_name || ' (' || e.employee_code || ')' AS employee, t.employee_id::text,
                t.from_date::text, t.to_date::text, to_char(t.starts_at, 'HH24:MI') AS starts_at, to_char(t.ends_at, 'HH24:MI') AS ends_at,
                t.grace_minutes, t.present_hours::text, t.half_day_hours::text, t.late_over_minutes, t.late_action, t.late_leave_type_id::text AS late_type_id, t.early_over_minutes,
                t.early_action, t.early_leave_type_id::text AS early_type_id, t.note
           FROM staff_timings t LEFT JOIN employees e ON e.id = t.employee_id
          WHERE t.status = 'active' ORDER BY t.kind, t.department, t.from_date DESC`,
      );
      const lists = await c.query<{ kind: string; id: string; name: string }>(
        `SELECT 'dept' AS kind, name AS id, name FROM departments WHERE status = 'active'
         UNION SELECT 'dept', department, department FROM employees WHERE deleted_at IS NULL AND COALESCE(department, '') <> ''
         UNION ALL SELECT 'emp', id::text, display_name || ' (' || employee_code || ')' FROM employees WHERE deleted_at IS NULL AND status = 'active'
         UNION ALL SELECT 'type', id::text, code || ' · ' || name FROM staff_leave_types WHERE status = 'active'
         ORDER BY 1, 3`,
      );
      return {
        rows: r.rows,
        departments: lists.rows.filter((x) => x.kind === 'dept').map((x) => x.name),
        employees: lists.rows.filter((x) => x.kind === 'emp').map(({ id, name }) => ({ id, name })),
        types: lists.rows.filter((x) => x.kind === 'type').map(({ id, name }) => ({ id, name })),
        can: { manage: this.has(ctx, 'leave.setup.manage') },
      };
    });
  }

  async saveTiming(ctx: RequestContext, id: string | null, dto: TimingDto) {
    if (!this.has(ctx, 'leave.setup.manage'))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const args = [
        dto.kind,
        dto.kind === 'department' ? dto.department : null,
        dto.kind === 'special' ? dto.employeeId : null,
        dto.kind === 'special' ? dto.from : null,
        dto.kind === 'special' ? dto.to : null,
        dto.startsAt,
        dto.endsAt,
        dto.grace,
        dto.presentHours,
        dto.halfDayHours,
        dto.lateOver ?? null,
        dto.lateAction,
        dto.lateAction === 'leave' ? (dto.lateTypeId ?? null) : null,
        dto.earlyOver ?? null,
        dto.earlyAction,
        dto.earlyAction === 'leave' ? (dto.earlyTypeId ?? null) : null,
        dto.note ?? null,
      ];
      try {
        if (id) {
          const r = await c.query(
            `UPDATE staff_timings SET kind = $1, department = $2, employee_id = $3, from_date = $4::date, to_date = $5::date, starts_at = $6::time,
                    ends_at = $7::time, grace_minutes = $8, present_hours = $9, half_day_hours = $10, late_over_minutes = $11, late_action = $12,
                    late_leave_type_id = $13, early_over_minutes = $14, early_action = $15, early_leave_type_id = $16, note = $17
              WHERE id = $18 AND status = 'active'`,
            [...args, id],
          );
          if (!r.rowCount) throw new DomainError('not-found', 'Timing not found', { status: 404 });
        } else
          id = (
            await c.query<{ id: string }>(
              `INSERT INTO staff_timings (school_id, kind, department, employee_id, from_date, to_date, starts_at, ends_at, grace_minutes, present_hours,
                                          half_day_hours, late_over_minutes, late_action, late_leave_type_id, early_over_minutes, early_action,
                                          early_leave_type_id, note, created_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::date, $6::time, $7::time, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                       app.current_user_id()) RETURNING id::text`,
              args,
            )
          ).rows[0]!.id;
      } catch (e) {
        const x = e as { code?: string; message?: string };
        if (x.code === '23505') fail('That department already has a timing: change that one', 409);
        if (x.code === '23514') fail(x.message ?? 'Not accepted');
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: 'leave.timing.save',
        entityType: 'staff_timings',
        entityId: id!,
        after: { ...dto },
      });
      return { id };
    });
  }

  /**
   * Bulk edit of special timings (the old module's tick-to-apply): only the ticked fields are written;
   * the rest stay each employee's own. "existing": the special timings of exactly these dates (in the
   * department, or all), nothing made. "department": every active employee of the department — those with
   * no timing for these dates get one, their unticked fields taken from the hours they have on the first
   * day (department timing or shift). dryRun: who changes, who is made, what each field holds now (one
   * value, or mixed), and any row the change would break.
   */
  async bulkTiming(ctx: RequestContext, dto: TimingBulkDto) {
    if (!this.has(ctx, 'leave.setup.manage'))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      type T = {
        id: string | null;
        emp: string;
        name: string;
        startsAt: string;
        endsAt: string;
        grace: number;
        presentHours: number;
        halfDayHours: number;
        note: string | null;
      };
      const dept = dto.department?.trim() || null;
      const existing = (
        await c.query<T>(
          `SELECT t.id::text, e.id::text AS emp, e.display_name || ' (' || e.employee_code || ')' AS name,
                  to_char(t.starts_at, 'HH24:MI') AS "startsAt", to_char(t.ends_at, 'HH24:MI') AS "endsAt",
                  t.grace_minutes AS grace, t.present_hours::float AS "presentHours",
                  t.half_day_hours::float AS "halfDayHours", t.note
             FROM staff_timings t JOIN employees e ON e.id = t.employee_id
            WHERE t.kind = 'special' AND t.status = 'active' AND t.from_date = $1::date AND t.to_date = $2::date
              AND ($3::text IS NULL OR lower(COALESCE(e.department, '')) = lower($3))
            ORDER BY e.display_name`,
          [dto.from, dto.to, dept],
        )
      ).rows;
      const made: T[] =
        dto.scope === 'department'
          ? (
              await c.query<T>(
                `SELECT NULL AS id, e.id::text AS emp, e.display_name || ' (' || e.employee_code || ')' AS name,
                        to_char(x.starts_at, 'HH24:MI') AS "startsAt", to_char(x.ends_at, 'HH24:MI') AS "endsAt",
                        x.grace AS grace, x.present_hours::float AS "presentHours",
                        x.half_day_hours::float AS "halfDayHours", NULL AS note
                   FROM employees e CROSS JOIN LATERAL app.staff_timing(e.id, $1::date) x
                  WHERE e.deleted_at IS NULL AND e.status = 'active'
                    AND lower(COALESCE(e.department, '')) = lower($3)
                    AND NOT EXISTS (SELECT 1 FROM staff_timings t WHERE t.employee_id = e.id AND t.kind = 'special'
                                      AND t.status = 'active' AND t.from_date = $1::date AND t.to_date = $2::date)
                  ORDER BY e.display_name`,
                [dto.from, dto.to, dept],
              )
            ).rows
          : [];
      const all = [...existing, ...made];
      const keys = ['startsAt', 'endsAt', 'grace', 'presentHours', 'halfDayHours', 'note'] as const;
      // what each field holds now: one value for everybody, or mixed
      const current = Object.fromEntries(
        keys.map((k) => {
          const seen = [...new Set(all.map((r) => String(r[k] ?? '')))];
          return [k, { value: seen.length === 1 ? seen[0]! : null, mixed: seen.length > 1 }];
        }),
      );
      const f = dto.fields;
      const after = all.map((r) => ({
        ...r,
        ...(f.startsAt !== undefined ? { startsAt: f.startsAt } : {}),
        ...(f.endsAt !== undefined ? { endsAt: f.endsAt } : {}),
        ...(f.grace !== undefined ? { grace: f.grace } : {}),
        ...(f.presentHours !== undefined ? { presentHours: f.presentHours } : {}),
        ...(f.halfDayHours !== undefined ? { halfDayHours: f.halfDayHours } : {}),
        ...(f.note !== undefined ? { note: f.note || null } : {}),
      }));
      const problems = after.flatMap((r) => {
        const p: string[] = [];
        if (r.endsAt <= r.startsAt) p.push('the end time would not be after the start time');
        if (r.halfDayHours >= r.presentHours)
          p.push('the half-day hours would not be fewer than the present hours');
        return p.length ? [`${r.name}: ${p.join('; ')}`] : [];
      });
      const summary = {
        change: existing.length,
        create: made.length,
        current,
        problems,
        people: all.map((r) => ({ name: r.name, made: r.id === null })),
      };
      if (dto.dryRun) return { ...summary, saved: 0 };
      if (!all.length) fail('Nobody to change: no special timing has exactly these dates here');
      if (problems.length) fail(`Not saved — ${problems.slice(0, 5).join(' · ')}`);
      for (const r of after) {
        if (r.id)
          await c.query(
            `UPDATE staff_timings SET starts_at = $2::time, ends_at = $3::time, grace_minutes = $4, present_hours = $5,
                    half_day_hours = $6, note = $7 WHERE id = $1`,
            [r.id, r.startsAt, r.endsAt, r.grace, r.presentHours, r.halfDayHours, r.note],
          );
        else
          await c.query(
            `INSERT INTO staff_timings (school_id, kind, employee_id, from_date, to_date, starts_at, ends_at, grace_minutes,
                                        present_hours, half_day_hours, note, created_by)
             VALUES (app.current_school_id(), 'special', $1, $2::date, $3::date, $4::time, $5::time, $6, $7, $8, $9, app.current_user_id())`,
            [
              r.emp,
              dto.from,
              dto.to,
              r.startsAt,
              r.endsAt,
              r.grace,
              r.presentHours,
              r.halfDayHours,
              r.note,
            ],
          );
      }
      await this.audit.stage(ctx, c, {
        action: 'leave.timing.bulk',
        entityType: 'staff_timings',
        entityId: `${dto.from}..${dto.to}`,
        after: {
          scope: dto.scope,
          department: dept,
          fields: f,
          changed: existing.length,
          made: made.length,
        },
      });
      return { ...summary, saved: all.length };
    });
  }

  /** Special timings as Excel: every active one, a row each (to change), the lists behind the drop-downs. */
  async specialFormat(ctx: RequestContext) {
    if (!this.has(ctx, 'leave.setup.manage'))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const staff = await c.query<{ label: string }>(
        `SELECT display_name || ' (' || employee_code || ')' AS label FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL ORDER BY display_name LIMIT 5000`,
      );
      const types = await c.query<{ code: string }>(
        `SELECT code FROM staff_leave_types WHERE status = 'active' AND NOT loss_of_pay ORDER BY sort_order, code`,
      );
      const rows = await c.query<{
        label: string;
        from: string;
        to: string;
        starts: string;
        ends: string;
        grace: number;
        present: string;
        half: string;
        late_over: number | null;
        late_action: string;
        late_code: string | null;
        early_over: number | null;
        early_action: string;
        early_code: string | null;
        note: string | null;
      }>(
        `SELECT e.display_name || ' (' || e.employee_code || ')' AS label, to_char(t.from_date, 'DD-MM-YYYY') AS "from",
                to_char(t.to_date, 'DD-MM-YYYY') AS "to", to_char(t.starts_at, 'HH24:MI') AS starts,
                to_char(t.ends_at, 'HH24:MI') AS ends, t.grace_minutes AS grace, t.present_hours::text AS present,
                t.half_day_hours::text AS half, t.late_over_minutes AS late_over, t.late_action,
                lt.code AS late_code, t.early_over_minutes AS early_over, t.early_action, et.code AS early_code, t.note
           FROM staff_timings t JOIN employees e ON e.id = t.employee_id
           LEFT JOIN staff_leave_types lt ON lt.id = t.late_leave_type_id
           LEFT JOIN staff_leave_types et ON et.id = t.early_leave_type_id
          WHERE t.kind = 'special' AND t.status = 'active'
          ORDER BY e.display_name, t.from_date LIMIT 20000`,
      );
      const bytes = await templateSheet({
        sheet: 'Special timings',
        hideLists: true,
        columns: [
          {
            header: 'Employee',
            width: 30,
            required: true,
            options: staff.rows.map((x) => x.label),
            note: 'The employee code in brackets is read; the code alone works too.',
          },
          { header: 'From date', width: 12, required: true, format: 'date', check: true },
          { header: 'To date', width: 12, required: true, format: 'date', check: true },
          {
            header: 'Start time',
            width: 10,
            required: true,
            format: 'text',
            note: '24-hour, like 07:30',
          },
          {
            header: 'End time',
            width: 10,
            required: true,
            format: 'text',
            note: '24-hour, like 15:30',
          },
          { header: 'Grace minutes', width: 9, format: 'whole', note: '0 to 240; empty: 5' },
          {
            header: 'Present hours',
            width: 9,
            required: true,
            format: 'number',
            note: 'Decimal hours: 7 h 30 m is 7.50',
          },
          {
            header: 'Half-day hours',
            width: 9,
            required: true,
            format: 'number',
            note: 'Fewer than the present hours',
          },
          {
            header: 'Late by more than (minutes)',
            width: 12,
            format: 'whole',
            note: '0 or empty: no late rule',
          },
          { header: 'Then (late)', width: 22, options: [...RULE_WORDS.keys()] },
          {
            header: 'Late leave type',
            width: 12,
            options: types.rows.map((t) => t.code),
            note: 'For “Half day of a leave type” only',
          },
          {
            header: 'Left early by more than (minutes)',
            width: 12,
            format: 'whole',
            note: '0 or empty: no early rule',
          },
          { header: 'Then (early)', width: 22, options: [...RULE_WORDS.keys()] },
          {
            header: 'Early leave type',
            width: 12,
            options: types.rows.map((t) => t.code),
            note: 'For “Half day of a leave type” only',
          },
          { header: 'Remark', width: 30, note: 'Up to 200 characters' },
        ],
        guide: [
          'One row per special timing: one employee’s own hours for some dates (a duty, a late bus). A special timing comes before the department timing and the shift.',
          'The sheet comes with the special timings there are now: change a row to change it, add rows for new ones. A row is matched by the employee and exactly its From and To dates; a row left as it was changes nothing.',
          'Times are 24-hour (07:30). Hours are decimal: 7 h 30 m is 7.50. At or above Present hours = P, at or above Half-day hours = HD, below = A.',
          'Late / early rule: past the minutes the day becomes a half day or absent and leave is charged. 0 or empty minutes = no rule.',
          'A row whose dates overlap another special timing of the same employee is refused: change that one instead.',
          'Upload it and press Check: every row is checked first; then save the good rows.',
        ],
        rows: rows.rows.map((r) => [
          r.label,
          r.from,
          r.to,
          r.starts,
          r.ends,
          r.grace,
          Number(r.present),
          Number(r.half),
          r.late_over,
          wordOf(r.late_action),
          r.late_code,
          r.early_over,
          wordOf(r.early_action),
          r.early_code,
          r.note,
        ]),
        examples: [
          [
            'Teacher name (E104)',
            '01-12-2026',
            '05-12-2026',
            '07:30',
            '13:30',
            5,
            5.5,
            3,
            15,
            'Half day',
            null,
            null,
            'No rule',
            null,
            'Exam duty',
          ],
          [
            'Driver name (E210)',
            '01-12-2026',
            '31-12-2026',
            '06:30',
            '15:30',
            10,
            8,
            4,
            null,
            'No rule',
            null,
            30,
            'Half day of a leave type',
            'CL',
            'Winter bus route',
          ],
        ],
      });
      return {
        filename: 'special-timings.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /**
   * Special timings from Excel: each row checked as the dialog checks it; a row with the dates of one the
   * employee has is a change of it, else a new one (refused when it overlaps another of theirs). dryRun
   * only checks; otherwise the good rows are saved, the others named.
   */
  async specialImport(ctx: RequestContext, dto: SheetDto) {
    if (!this.has(ctx, 'leave.setup.manage'))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
    const rows = await readSheet(
      dto.file,
      [
        'Employee',
        'From date',
        'To date',
        'Start time',
        'End time',
        'Present hours',
        'Half-day hours',
      ],
      [
        'Grace minutes',
        'Late by more than (minutes)',
        'Then (late)',
        'Late leave type',
        'Left early by more than (minutes)',
        'Then (early)',
        'Early leave type',
        'Remark',
      ],
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emps = new Map(
        (
          await c.query<{ id: string; code: string; name: string }>(
            `SELECT id::text, upper(employee_code) AS code, display_name AS name FROM employees
              WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL`,
          )
        ).rows.map((e) => [e.code, e]),
      );
      const types = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, upper(code) AS code FROM staff_leave_types WHERE status = 'active' AND NOT loss_of_pay`,
          )
        ).rows.map((t) => [t.code, t.id]),
      );
      const have = (
        await c.query<{
          id: string;
          emp: string;
          from: string;
          to: string;
          starts: string;
          ends: string;
          grace: number;
          present: number;
          half: number;
          late_over: number | null;
          late_action: string;
          late_type: string | null;
          early_over: number | null;
          early_action: string;
          early_type: string | null;
          note: string | null;
        }>(
          `SELECT id::text, employee_id::text AS emp, from_date::text AS "from", to_date::text AS "to",
                  to_char(starts_at, 'HH24:MI') AS starts, to_char(ends_at, 'HH24:MI') AS ends, grace_minutes AS grace,
                  present_hours::float AS present, half_day_hours::float AS half, late_over_minutes AS late_over,
                  late_action, late_leave_type_id::text AS late_type, early_over_minutes AS early_over, early_action,
                  early_leave_type_id::text AS early_type, note
             FROM staff_timings WHERE kind = 'special' AND status = 'active'`,
        )
      ).rows.map((h) => ({
        ...h,
        key: keyOf([
          h.starts,
          h.ends,
          h.grace,
          h.present,
          h.half,
          h.late_over,
          h.late_action,
          h.late_type,
          h.early_over,
          h.early_action,
          h.early_type,
          h.note,
        ]),
      }));
      const day = (v: string) => {
        const t = (v ?? '').trim();
        if (/^\d{2}-\d{2}-\d{4}$/.test(t)) return t.split('-').reverse().join('-');
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return t.split('/').reverse().join('-');
        return t;
      };
      const time = (v: string) => {
        const t = (v ?? '').trim();
        if (/^0?\.\d+$|^0$/.test(t)) {
          // a time Excel kept as a fraction of a day
          const m = Math.round(Number(t) * 24 * 60);
          return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        }
        const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(t);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
        return `${m[1]!.padStart(2, '0')}:${m[2]}`;
      };
      const results: Array<{
        row: number;
        employee: string;
        dates: string;
        what: 'new' | 'change' | 'same' | null;
        ok: boolean;
        error?: string;
      }> = [];
      type Good = {
        id: string | null;
        emp: string;
        from: string;
        to: string;
        starts: string;
        ends: string;
        grace: number;
        present: number;
        half: number;
        lateOver: number | null;
        lateAction: string;
        lateType: string | null;
        earlyOver: number | null;
        earlyAction: string;
        earlyType: string | null;
        note: string | null;
      };
      const good: Good[] = [];
      const inFile: Array<{ emp: string; from: string; to: string; row: number }> = [];
      for (const { row, cells } of rows) {
        const raw = (cells.Employee ?? '').trim();
        const code = (/\(([^()]+)\)\s*$/.exec(raw)?.[1] ?? raw).trim().toUpperCase();
        const e = emps.get(code);
        const from = day(cells['From date'] ?? '');
        const to = day(cells['To date'] ?? '');
        const p: string[] = [];
        if (!e) p.push(`no active employee is ${raw || '(empty)'}`);
        const okDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
        if (!okDay(from)) p.push('the From date is not a date');
        if (!okDay(to)) p.push('the To date is not a date');
        else if (okDay(from) && to < from) p.push('the To date is before the From date');
        const starts = time(cells['Start time'] ?? '');
        const ends = time(cells['End time'] ?? '');
        if (!starts) p.push('the start time is not HH:MM');
        if (!ends) p.push('the end time is not HH:MM');
        else if (starts && ends <= starts) p.push('the end time is not after the start time');
        const graceRaw = (cells['Grace minutes'] ?? '').trim();
        const grace = graceRaw === '' ? 5 : Number(graceRaw);
        if (!Number.isInteger(grace) || grace < 0 || grace > 240)
          p.push('grace minutes are 0 to 240');
        const hrs = (k: string, label: string) => {
          const v = (cells[k] ?? '').trim();
          const n = Number(v);
          if (
            v === '' ||
            !Number.isFinite(n) ||
            n < 0 ||
            n > 24 ||
            Math.round(n * 100) / 100 !== n
          ) {
            p.push(`${label} are 0 to 24 with at most 2 decimals`);
            return NaN;
          }
          return n;
        };
        const present = hrs('Present hours', 'present hours');
        const half = hrs('Half-day hours', 'half-day hours');
        if (Number.isFinite(present) && present <= 0) p.push('present hours are more than 0');
        if (Number.isFinite(present) && Number.isFinite(half) && half >= present)
          p.push('the half-day hours are not fewer than the present hours');
        if (starts && ends && Number.isFinite(present)) {
          const [sh, sm] = starts.split(':').map(Number) as [number, number];
          const [eh, em] = ends.split(':').map(Number) as [number, number];
          if (present * 60 > eh * 60 + em - (sh * 60 + sm))
            p.push('the present hours are longer than the working times');
        }
        const rule = (side: 'Late' | 'Early', mk: string, ak: string, tk: string) => {
          const mRaw = (cells[mk] ?? '').trim();
          const mins = mRaw === '' ? 0 : Number(mRaw);
          const word = (cells[ak] ?? '').trim();
          const action =
            word === '' ? 'none' : (RULE_WORDS.get(word) ?? RULE_CODES.get(word.toLowerCase()));
          const typeCode = (cells[tk] ?? '').trim().toUpperCase();
          if (!Number.isInteger(mins) || mins < 0 || mins > 720)
            p.push(`${side.toLowerCase()} minutes are 0 to 720`);
          if (!action) p.push(`${ak} is one of ${[...RULE_WORDS.keys()].join(', ')}`);
          else if (mins > 0 && action === 'none')
            p.push(`${ak}: say what the day becomes, or set the minutes to 0`);
          else if (mins === 0 && action !== 'none') p.push(`${mk}: give the minutes for the rule`);
          const typeId = typeCode ? types.get(typeCode) : undefined;
          if (action === 'leave' && !typeId)
            p.push(`${tk}: a leave type code${typeCode ? ` (${typeCode} is not one)` : ''}`);
          return {
            over: mins > 0 ? mins : null,
            action: mins > 0 && action ? action : 'none',
            type: action === 'leave' && mins > 0 ? (typeId ?? null) : null,
          };
        };
        const late = rule('Late', 'Late by more than (minutes)', 'Then (late)', 'Late leave type');
        const early = rule(
          'Early',
          'Left early by more than (minutes)',
          'Then (early)',
          'Early leave type',
        );
        const note = (cells.Remark ?? '').trim() || null;
        if (note && note.length > 200) p.push('the remark is longer than 200 characters');
        // the same employee and dates: that timing; overlapping another of theirs (or a row above): refused
        const same = e
          ? have.find((h) => h.emp === e.id && h.from === from && h.to === to)
          : undefined;
        if (e && okDay(from) && okDay(to)) {
          const clash = have.find(
            (h) => h.emp === e.id && h !== same && h.from <= to && h.to >= from,
          );
          if (clash)
            p.push(
              `overlaps their special timing ${dmy(clash.from)} to ${dmy(clash.to)}: change that row instead`,
            );
          const twice = inFile.find((x) => x.emp === e.id && x.from <= to && x.to >= from);
          if (twice) p.push(`overlaps row ${String(twice.row)} for the same employee`);
          inFile.push({ emp: e.id, from, to, row });
        }
        const dates =
          okDay(from) && okDay(to)
            ? `${dmy(from)} to ${dmy(to)}`
            : `${cells['From date'] ?? ''} to ${cells['To date'] ?? ''}`;
        if (p.length) {
          results.push({
            row,
            employee: e ? `${e.name} (${e.code})` : raw || '(empty)',
            dates,
            what: null,
            ok: false,
            error: p.join('; '),
          });
          continue;
        }
        const g: Good = {
          id: same?.id ?? null,
          emp: e!.id,
          from,
          to,
          starts: starts!,
          ends: ends!,
          grace,
          present,
          half,
          lateOver: late.over,
          lateAction: late.action,
          lateType: late.type,
          earlyOver: early.over,
          earlyAction: early.action,
          earlyType: early.type,
          note,
        };
        const key = keyOf([
          g.starts,
          g.ends,
          g.grace,
          g.present,
          g.half,
          g.lateOver,
          g.lateAction,
          g.lateType,
          g.earlyOver,
          g.earlyAction,
          g.earlyType,
          g.note,
        ]);
        const unchanged = same?.key === key;
        results.push({
          row,
          employee: `${e!.name} (${e!.code})`,
          dates,
          what: same ? (unchanged ? 'same' : 'change') : 'new',
          ok: true,
        });
        if (!unchanged) good.push(g);
      }
      if (dto.dryRun) return { rows: results, saved: 0 };
      for (const g of good) {
        const args = [
          g.starts,
          g.ends,
          g.grace,
          g.present,
          g.half,
          g.lateOver,
          g.lateAction,
          g.lateType,
          g.earlyOver,
          g.earlyAction,
          g.earlyType,
          g.note,
        ];
        if (g.id)
          await c.query(
            `UPDATE staff_timings SET starts_at = $1::time, ends_at = $2::time, grace_minutes = $3, present_hours = $4, half_day_hours = $5,
                    late_over_minutes = $6, late_action = $7, late_leave_type_id = $8, early_over_minutes = $9, early_action = $10,
                    early_leave_type_id = $11, note = $12 WHERE id = $13`,
            [...args, g.id],
          );
        else
          await c.query(
            `INSERT INTO staff_timings (school_id, kind, starts_at, ends_at, grace_minutes, present_hours, half_day_hours, late_over_minutes,
                                        late_action, late_leave_type_id, early_over_minutes, early_action, early_leave_type_id, note,
                                        employee_id, from_date, to_date, created_by)
             VALUES (app.current_school_id(), 'special', $1::time, $2::time, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::date, $15::date,
                     app.current_user_id())`,
            [...args, g.emp, g.from, g.to],
          );
      }
      if (good.length)
        await this.audit.stage(ctx, c, {
          action: 'leave.timing.import',
          entityType: 'staff_timings',
          entityId: 'special',
          after: { saved: good.length, rows: results.length },
        });
      return { rows: results, saved: good.length };
    });
  }

  async retireTiming(ctx: RequestContext, id: string) {
    if (!this.has(ctx, 'leave.setup.manage'))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`UPDATE staff_timings SET status = 'retired' WHERE id = $1`, [id]);
      return { id, status: 'retired' };
    });
  }

  // ---- uploads -------------------------------------------------------------------------------------
  async sheetFormat(ctx: RequestContext, what: 'days' | 'punches') {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const staff = await c.query<{ label: string }>(
        `SELECT display_name || ' (' || employee_code || ')' AS label FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL ORDER BY display_name LIMIT 5000`,
      );
      const emp = {
        header: 'Employee',
        width: 30,
        required: true,
        options: staff.rows.map((s) => s.label),
        note: 'The employee code in brackets is read; the code alone works too.',
      };
      const bytes = await templateSheet(
        what === 'days'
          ? {
              sheet: 'Attendance days',
              hideLists: true,
              columns: [
                emp,
                { header: 'Date', width: 12, required: true, format: 'date', check: true },
                {
                  header: 'Day type',
                  width: 10,
                  options: ['P', 'HD', 'A', 'WO', 'H', 'HOLD'],
                  note: 'Empty: worked out from the times',
                },
                { header: 'In', width: 8, format: 'text', note: '24-hour, like 08:05' },
                { header: 'Out', width: 8, format: 'text', note: '24-hour, like 15:40' },
                { header: 'Reason', width: 30, required: true },
              ],
              guide: [
                'One row a day of an employee. The day is set by hand: the punches no longer change it.',
                'A day on leave is skipped (cancel or shorten the leave first); a month locked for payroll is refused.',
                'Upload it and press Check: every row is checked first; then save the good rows.',
              ],
              examples: [
                [
                  'Teacher name (E104)',
                  new Date(Date.UTC(2026, 10, 2)),
                  'P',
                  '08:00',
                  '15:30',
                  'Device was down',
                ],
              ],
            }
          : {
              sheet: 'Punches',
              hideLists: true,
              columns: [
                emp,
                { header: 'Date', width: 12, required: true, format: 'date', check: true },
                { header: 'In', width: 8, format: 'text', note: '24-hour, like 08:05' },
                {
                  header: 'Out',
                  width: 8,
                  format: 'text',
                  note: '24-hour, like 15:40 (the next morning for a night shift)',
                },
              ],
              guide: [
                'Punches the device could not send: one row a day with the IN and OUT (or one of them).',
                'They join the punches and the day is worked out from them as from the device.',
              ],
              examples: [
                ['Teacher name (E104)', new Date(Date.UTC(2026, 10, 2)), '07:58', '15:35'],
              ],
            },
      );
      return {
        filename: what === 'days' ? 'attendance-days.xlsx' : 'attendance-punches.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  async sheetImport(ctx: RequestContext, what: 'days' | 'punches', dto: SheetDto) {
    this.mustOffice(ctx);
    const rows = await readSheet(
      dto.file,
      ['Employee', 'Date'],
      ['Day type', 'In', 'Out', 'Reason'],
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emps = new Map(
        (
          await c.query<{ id: string; code: string; name: string }>(
            `SELECT id::text, upper(employee_code) AS code, display_name AS name FROM employees WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL`,
          )
        ).rows.map((e) => [e.code, e]),
      );
      const today = istToday();
      const time = (v: string) => {
        const t = (v ?? '').trim();
        if (!t) return null;
        const m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(t);
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return 'bad';
        return `${m[1]!.padStart(2, '0')}:${m[2]}`;
      };
      const results: Array<{
        row: number;
        employee: string;
        day: string;
        ok: boolean;
        error?: string;
      }> = [];
      const good: Array<{
        emp: string;
        day: string;
        type: string | null;
        in: string | null;
        out: string | null;
        reason: string;
      }> = [];
      const seen = new Set<string>();
      for (const { row, cells } of rows) {
        const raw = (cells.Employee ?? '').trim();
        const code = (/\(([^()]+)\)\s*$/.exec(raw)?.[1] ?? raw).trim().toUpperCase();
        const e = emps.get(code);
        const d = (cells.Date ?? '').trim();
        const day = /^\d{2}-\d{2}-\d{4}$/.test(d) ? d.split('-').reverse().join('-') : d;
        const tIn = time(cells.In ?? '');
        const tOut = time(cells.Out ?? '');
        const type = (cells['Day type'] ?? '').trim().toUpperCase() || null;
        const reason = (cells.Reason ?? '').trim();
        const problems: string[] = [];
        if (!e) problems.push(`no active employee is ${raw || '(empty)'}`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) problems.push('the date is not a date');
        else if (day > today) problems.push('a day still to come');
        if (tIn === 'bad' || tOut === 'bad') problems.push('a time is not HH:MM');
        if (what === 'days') {
          if (type && !['P', 'HD', 'A', 'WO', 'H', 'HOLD'].includes(type))
            problems.push('the day type is P, HD, A, WO, H or HOLD');
          if (!type && !(tIn && tOut)) problems.push('give the day type, or both times');
          if (reason.length < 3) problems.push('give the reason');
        } else if (!tIn && !tOut) problems.push('give the IN or OUT time');
        if (e && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
          const key = `${e.id}|${day}`;
          if (seen.has(key)) problems.push('the same employee and date again');
          seen.add(key);
          if (await this.locked(c, day)) problems.push(`${monthWords(day)} is locked for payroll`);
          if (what === 'days') {
            const lv = await c.query<{ number: string }>(
              `SELECT r.number FROM staff_leave_days x JOIN staff_leave_requests r ON r.id = x.request_id
                WHERE x.employee_id = $1 AND x.day = $2::date AND x.status IN ('pending', 'approved') AND x.portion = 1
                  AND r.source NOT IN ('auto_late', 'auto_missing', 'auto_rule') LIMIT 1`,
              [e.id, day],
            );
            if (lv.rows[0]) problems.push(`${lv.rows[0].number} covers the day`);
          }
        }
        if (problems.length) {
          results.push({
            row,
            employee: e?.name ?? raw,
            day,
            ok: false,
            error: problems.join('; '),
          });
          continue;
        }
        results.push({ row, employee: `${e!.name} (${code})`, day, ok: true });
        good.push({
          emp: e!.id,
          day,
          type,
          in: tIn as string | null,
          out: tOut as string | null,
          reason,
        });
      }
      if (dto.dryRun) return { rows: results, saved: 0 };
      let saved = 0;
      for (const g of good) {
        if (what === 'days') {
          await this.setDay(c, g.emp, g.day, {
            dayType: g.type,
            in: g.in,
            out: g.out,
            source: 'bulk',
            reason: g.reason,
          });
        } else {
          const code = (
            await c.query<{ code: string }>(
              `SELECT employee_code AS code FROM employees WHERE id = $1`,
              [g.emp],
            )
          ).rows[0]!.code;
          for (const t of [g.in, g.out].filter((x): x is string => !!x)) {
            const next = g.in && g.out && t === g.out && g.out < g.in;
            await c.query(
              `INSERT INTO staff_punches (school_id, employee_id, code, punched_at, source, device, created_by)
               VALUES (app.current_school_id(), $1, $2, (($3::date + CASE WHEN $5 THEN 1 ELSE 0 END) + $4::time) AT TIME ZONE 'Asia/Kolkata', 'import', '', app.current_user_id())
               ON CONFLICT DO NOTHING`,
              [g.emp, code, g.day, t, next],
            );
          }
          await c.query(`SELECT app.staff_attendance_recompute($1::date, $1::date, $2)`, [
            g.day,
            g.emp,
          ]);
        }
        saved += 1;
      }
      await this.audit.stage(ctx, c, {
        action: `leave.attendance.import_${what}`,
        entityType: 'staff_attendance_days',
        entityId: '0',
        after: { saved },
      });
      return { rows: results, saved };
    });
  }
}
