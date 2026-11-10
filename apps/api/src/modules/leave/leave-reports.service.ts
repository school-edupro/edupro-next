import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { blankBox, signerOf } from '../purchase/purchase-doc-sign';
import { purchaseHead } from '../purchase/purchase-head';
import { fyStart } from '../purchase/purchase-reports.service';
import { istToday } from '../purchase/purchase-stock-core';
import { LEAVE_REPORTS } from './leave-dashboard.service';
import { addDays, dmy, fail, monthStart, monthWords } from './leave-engine';
import { leaveReportFile, type ReportCell, type ReportTable } from './leave-report-file';
import { shiftCells, shiftList } from './shift-calendar.service';
import {
  LEAVE_OFFICE,
  LEAVE_REPORT_CODES,
  type LeaveReport,
  type LeaveReportQueryDto,
  type ReportAccessDto,
} from './leave.dto';

type Filter =
  | 'day'
  | 'period'
  | 'month'
  | 'months'
  | 'asOn'
  | 'department'
  | 'employeeType'
  | 'employee'
  | 'type'
  | 'status';
const STAFF: Filter[] = ['department', 'employeeType', 'employee'];

/** The reports of the school's earlier MIS (docs/design/85, phase D): name, group, filters, what it shows. */
export const LEAVE_REPORT_DEFS: Record<
  LeaveReport,
  { name: string; group: string; filters: Filter[]; help: string }
> = {
  daily: {
    name: 'Daily attendance',
    group: 'Daily',
    filters: ['day', ...STAFF],
    help: 'Each employee on a day: in, out, attendance, late and early minutes, a missing punch, the shift, hours and the timing that applied.',
  },
  in_out: {
    name: 'Yesterday OUT / today IN',
    group: 'Daily',
    filters: ['day', ...STAFF],
    help: 'The last OUT of the working day before (with its date) beside the IN of the day: who left early, who has not come.',
  },
  monthly_summary: {
    name: 'Monthly summary',
    group: 'Monthly',
    filters: ['month', ...STAFF],
    help: 'A line an employee: working days, present, half days, absent, weekly offs, holidays, paid leave, loss of pay, late marks, missing punches, attendance %.',
  },
  monthly_employee: {
    name: 'Monthly attendance, employee-wise',
    group: 'Monthly',
    filters: ['month', ...STAFF],
    help: 'Each employee’s month day by day (a printed page each): attendance, in, out, hours, late, missing punch, set by hand.',
  },
  monthly_register: {
    name: 'Monthly attendance register',
    group: 'Monthly',
    filters: ['month', ...STAFF],
    help: 'The month’s grid, four lines an employee (status, in, out, hours) with the totals of each kind of day and leave type (A3).',
  },
  shift_roster: {
    name: 'Shift roster',
    group: 'Monthly',
    filters: ['month', ...STAFF],
    help: 'The month’s shifts: each employee’s shift code day by day (WO weekly off, H holiday, * a shift for that day only), and the days of each shift.',
  },
  card: {
    name: 'Monthly employee attendance (card)',
    group: 'Monthly',
    filters: ['month', ...STAFF],
    help: 'A card an employee (a printed page each): present, absent, leave, weekly offs and holidays, hours, then each day with shift, in, late, out, early, status, hours.',
  },
  basic_work: {
    name: 'Monthly basic work',
    group: 'Monthly',
    filters: ['period', ...STAFF],
    help: 'Up to 31 days: status, in, out and hours of each day, four lines an employee, with the totals (five employees a printed page).',
  },
  monthly_cumulative: {
    name: 'Monthly cumulative',
    group: 'Monthly',
    filters: ['month', ...STAFF],
    help: 'The month’s day codes with late marks this month, before it and in the year, and each balance type: credited, taken this month, before, closing.',
  },
  annual: {
    name: 'Annual consolidated',
    group: 'Yearly',
    filters: ['period', ...STAFF],
    help: 'A period (the financial year so far): every kind of day, attendance %, late marks, missing punches, corrections, the system’s deductions, leave taken and the balance of each type.',
  },
  employee_yearly: {
    name: 'Employee yearly',
    group: 'Yearly',
    filters: ['months', ...STAFF],
    help: 'From a month to a month: present, half days, absent, weekly offs, holidays and the days of each leave type, with the paid leave in all.',
  },
  year_on_year: {
    name: 'Cumulative year-on-year (leave)',
    group: 'Yearly',
    filters: ['type', 'department', 'employee'],
    help: 'Each financial year and leave type: opening, credited, corrections, taken, lapsed and closing.',
  },
  late_arrival: {
    name: 'Late arrival',
    group: 'Exceptions',
    filters: ['period', ...STAFF],
    help: 'Each late mark: in time, the shift’s start and grace, minutes late, its status, the marks counting that month and the leave due.',
  },
  early_going: {
    name: 'Early going',
    group: 'Exceptions',
    filters: ['period', ...STAFF],
    help: 'Days left before the shift’s end (up to 31 days): in, out, the shift’s end, minutes early.',
  },
  forgot_punch: {
    name: 'Forgot punch and corrections',
    group: 'Exceptions',
    filters: ['period', ...STAFF],
    help: 'Each missing punch with the correction asked for the day, who decided it, the punches counting that month and the leave due.',
  },
  leave_availed: {
    name: 'Leave availed',
    group: 'Leave',
    filters: ['period', 'type', 'status', ...STAFF],
    help: 'Leave in a period (approved unless another status is picked): the days in the period and in all, reason, who applied, how, when decided.',
  },
  leave_deduction: {
    name: 'Leave deducted by the system',
    group: 'Leave',
    filters: ['period', 'type', ...STAFF],
    help: 'The leave the system charged for late marks, missing punches, absence and the shift’s late or early rule.',
  },
  balance_as_on: {
    name: 'Leave balance as on a date',
    group: 'Leave',
    filters: ['asOn', 'type', ...STAFF],
    help: 'Each employee and leave type on a date: opening, credited, corrections, taken to the date, available.',
  },
  opening_closing: {
    name: 'Monthly opening and closing balance',
    group: 'Leave',
    filters: ['months', 'type', ...STAFF],
    help: 'Each employee and month: for every leave type with a balance, opening, added, taken and closing.',
  },
};

interface Emp {
  id: string;
  code: string;
  name: string;
  department: string | null;
  designation: string | null;
  joined: string | null;
}
interface Day {
  emp: string;
  day: string;
  day_type: string | null;
  marked: boolean;
  joined: boolean;
  leave_code: string | null;
  loss_of_pay: boolean;
  portion: number | null;
  present: number;
  leave: number;
  lop: number;
  in_t: string | null;
  out_t: string | null;
  worked: number | null;
  late: number;
  early: number;
  manual: boolean;
  missing: string | null;
  shift: string | null;
  shift_end: string | null;
  remark: string | null;
}
interface TypeRow {
  id: string;
  code: string;
  name: string;
  lop: boolean;
  balance: boolean;
}
interface Scope {
  day: string;
  from: string;
  to: string;
  month: string;
  monthEnd: string;
  fromMonth: string;
  toMonth: string;
  department: string | null;
  employeeType: string | null;
  employeeId: string | null;
  typeId: string | null;
  status: string | null;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const monthEnd = (m: string) => addDays(monthStart(addDays(m, 32)), -1);
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** decimal hours as H:MM */
const hhmm = (h: number | null) => {
  if (h === null || !Number.isFinite(h)) return '';
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60))}:${String(m % 60).padStart(2, '0')}`;
};
const SOURCE: Record<string, string> = {
  self: 'Self',
  on_behalf: 'By the office',
  auto_late: 'Late marks',
  auto_missing: 'Missing punches',
  auto_absent: 'Absence',
  auto_rule: 'The shift’s late / early rule',
  import: 'Import',
};
const STATUS: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};
const MARK: Record<string, string> = {
  pending: 'Counting',
  used: 'Charged as leave',
  waived: 'Waived',
  retired: 'Cleared',
  lapsed: 'Lapsed',
};
const TIMING: Record<string, string> = {
  SHIFT: 'shift',
  SPECIAL: 'special timing',
  BUS: 'bus duty',
  BUS_SPECIAL: 'bus duty (special)',
  POSTING_DAY: 'one-day posting',
  DEPARTMENT: 'department timing',
};

/** A day's code: P, HD, A, WO, H, HOLD, the leave's code (LOP for loss of pay; ½ a half day), · not marked. */
const codeOf = (d: Day, today: string) =>
  d.day_type === null
    ? d.joined && d.day < today
      ? '·'
      : ''
    : d.day_type === 'LV'
      ? `${d.loss_of_pay ? 'LOP' : (d.leave_code ?? 'LV')}${d.portion !== null && d.portion < 1 ? '½' : ''}`
      : d.day_type;
const marksOf = (d: Day) =>
  `${d.late > 0 ? '·L' : ''}${d.missing ? '·F' : ''}${d.manual ? '·m' : ''}`;

/** The month's figures of an employee from their days. */
function tally(ds: Day[], today: string) {
  const t = {
    P: 0,
    HD: 0,
    A: 0,
    WO: 0,
    H: 0,
    HOLD: 0,
    present: 0,
    leave: 0,
    lop: 0,
    halfWorked: 0,
    notMarked: 0,
    working: 0,
    late: 0,
    missing: 0,
    hours: 0,
    byType: {} as Record<string, number>,
  };
  for (const d of ds) {
    if (!d.joined) continue;
    const past = d.day < today || d.marked;
    if (d.day_type === null) {
      if (d.day < today) {
        t.notMarked += 1;
        t.working += 1;
      }
      continue;
    }
    if (d.day_type !== 'WO' && d.day_type !== 'H' && past) t.working += 1;
    if (d.day_type === 'LV') {
      const code = d.leave_code ?? 'LV';
      const p = d.portion ?? 1;
      t.byType[code] = (t.byType[code] ?? 0) + p;
      if (p < 1) t.halfWorked += 1 - p;
    } else if (d.day_type in t) (t as unknown as Record<string, number>)[d.day_type]! += 1;
    t.present += d.present;
    t.leave += d.leave;
    t.lop += d.lop;
    t.hours += d.worked ?? 0;
    if (d.late > 0) t.late += 1;
    if (d.missing) t.missing += 1;
  }
  return t;
}
const pctOf = (t: ReturnType<typeof tally>) =>
  t.working ? r1(((t.present + t.leave) / t.working) * 100) : null;

/**
 * Staff leave & attendance reports (docs/design/85, phase D): the eighteen reports of the school's earlier
 * MIS (its sixteen, the monthly one in three forms) with its faults fixed — on screen, Excel or PDF with the
 * letterhead and the Prepared / Checked / Principal boxes; every report for those with the reports right
 * (and the leave office), one report for the people it is given to; the "Not required" staff left out.
 */
@Injectable()
export class LeaveReportsService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }

  /** The reports I may open: all with the reports right or the leave office, else those given to me. */
  private async mine(c: PoolClient, ctx: RequestContext): Promise<LeaveReport[]> {
    if (this.has(ctx, LEAVE_REPORTS) || this.has(ctx, LEAVE_OFFICE)) return [...LEAVE_REPORT_CODES];
    const r = await c.query<{ report: string }>(
      `SELECT report FROM staff_report_access WHERE user_id = app.current_user_id()`,
    );
    const given = new Set(r.rows.map((x) => x.report));
    return LEAVE_REPORT_CODES.filter((x) => given.has(x));
  }

  /** How many reports I may open (for a link to them). */
  async count(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      reports: (await this.mine(c, ctx)).length,
    }));
  }

  /** The reports I may open with what they filter by, and the lists to filter with. */
  async catalogue(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const mine = await this.mine(c, ctx);
      const depts = await c.query<{ name: string }>(
        `SELECT DISTINCT btrim(department) AS name FROM employees
          WHERE deleted_at IS NULL AND COALESCE(btrim(department), '') <> '' ORDER BY 1`,
      );
      const etypes = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT e.employee_type::text AS code, COALESCE(t.name, initcap(replace(e.employee_type::text, '_', ' '))) AS name
           FROM employees e LEFT JOIN employee_types t ON t.school_id = e.school_id AND t.code = e.employee_type::text
          WHERE e.deleted_at IS NULL AND e.employee_type IS NOT NULL ORDER BY 2`,
      );
      const emps = await c.query<{ id: string; name: string; code: string }>(
        `SELECT id::text, display_name AS name, employee_code AS code FROM employees
          WHERE deleted_at IS NULL ORDER BY status = 'active' DESC, display_name LIMIT 5000`,
      );
      const types = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM staff_leave_types ORDER BY status = 'active' DESC, sort_order, code`,
      );
      return {
        reports: mine.map((code) => ({ code, ...LEAVE_REPORT_DEFS[code] })),
        departments: depts.rows.map((x) => x.name),
        employeeTypes: etypes.rows,
        employees: emps.rows,
        types: types.rows,
        manage: this.has(ctx, 'leave.setup.manage'),
        all: this.has(ctx, LEAVE_REPORTS) || this.has(ctx, LEAVE_OFFICE),
      };
    });
  }

  // ---- who may open a report ----------------------------------------------------------------------
  private mustManage(ctx: RequestContext) {
    if (!this.has(ctx, 'leave.setup.manage'))
      throw new DomainError('permission-denied', 'Only the leave office gives reports', {
        status: 403,
      });
  }

  /** Each report and the people it is given to (beside those with the reports right). */
  async access(ctx: RequestContext) {
    if (!this.has(ctx, 'leave.setup.view'))
      throw new DomainError('permission-denied', 'Only the leave office', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const given = await c.query<{
        report: string;
        id: string;
        name: string;
        code: string | null;
      }>(
        `SELECT a.report, u.id::text,
                COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.display_name) AS name,
                (SELECT e.employee_code FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1) AS code
           FROM staff_report_access a JOIN users u ON u.id = a.user_id ORDER BY 3`,
      );
      const people = await c.query<{ id: string; name: string; code: string }>(
        `SELECT u.id::text, e.display_name AS name, e.employee_code AS code
           FROM employees e JOIN users u ON u.id = e.user_id
          WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name LIMIT 5000`,
      );
      return {
        reports: LEAVE_REPORT_CODES.map((code) => ({
          code,
          name: LEAVE_REPORT_DEFS[code].name,
          group: LEAVE_REPORT_DEFS[code].group,
          people: given.rows
            .filter((g) => g.report === code)
            .map(({ id, name, code: c2 }) => ({ id, name, code: c2 })),
        })),
        people: people.rows,
        manage: this.has(ctx, 'leave.setup.manage'),
      };
    });
  }

  /** Give a report to these people (and to nobody else). */
  async setAccess(ctx: RequestContext, report: string, dto: ReportAccessDto) {
    this.mustManage(ctx);
    if (!(LEAVE_REPORT_CODES as readonly string[]).includes(report))
      throw new DomainError('not-found', 'No such report', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = [...new Set(dto.userIds)];
      if (ids.length) {
        const ok = await c.query<{ n: number }>(
          `SELECT count(DISTINCT u.id)::int AS n FROM users u JOIN employees e ON e.user_id = u.id
            WHERE u.id = ANY($1::bigint[]) AND e.deleted_at IS NULL AND e.status = 'active'`,
          [ids],
        );
        if (ok.rows[0]!.n !== ids.length) fail('Pick staff with a sign-in');
      }
      await c.query(
        `DELETE FROM staff_report_access WHERE report = $1 AND NOT (user_id = ANY($2::bigint[]))`,
        [report, ids],
      );
      await c.query(
        `INSERT INTO staff_report_access (school_id, report, user_id, granted_by)
         SELECT app.current_school_id(), $1, u, app.current_user_id() FROM unnest($2::bigint[]) u
         ON CONFLICT DO NOTHING`,
        [report, ids],
      );
      return { report, people: ids.length };
    });
  }

  // ---- the scope -------------------------------------------------------------------------------
  private scope(report: LeaveReport, q: LeaveReportQueryDto): Scope {
    const today = istToday();
    const fy = fyStart(today);
    const def = LEAVE_REPORT_DEFS[report].filters;
    const month = q.month ? `${q.month}-01` : monthStart(today);
    let from = q.from ?? '';
    let to = q.to ?? '';
    const cap: Partial<Record<LeaveReport, number>> = {
      basic_work: 31,
      early_going: 31,
      late_arrival: 62,
      forgot_punch: 62,
      annual: 400,
      leave_availed: 400,
      leave_deduction: 400,
    };
    if (def.includes('period')) {
      const long = ['annual', 'leave_availed', 'leave_deduction'].includes(report);
      if (!from) from = long ? fy : monthStart(today);
      if (!to) to = report === 'basic_work' ? [today, addDays(from, 30)].sort()[0]! : today;
      if (from > to) fail('The start is after the end');
      const most = cap[report] ?? 62;
      if (span(from, to) > most) fail(`Up to ${String(most)} days at a time`);
    }
    const fromMonth = q.fromMonth ? `${q.fromMonth}-01` : fy;
    const toMonth = q.toMonth ? `${q.toMonth}-01` : monthStart(today);
    if (def.includes('months')) {
      if (fromMonth > toMonth) fail('The first month is after the last');
      const months =
        (Number(toMonth.slice(0, 4)) - Number(fromMonth.slice(0, 4))) * 12 +
        Number(toMonth.slice(5, 7)) -
        Number(fromMonth.slice(5, 7)) +
        1;
      if (months > 24) fail('Up to 24 months at a time');
    }
    return {
      day: q.day ?? today,
      from,
      to,
      month,
      monthEnd: monthEnd(month),
      fromMonth,
      toMonth,
      department: def.includes('department') ? (q.department ?? null) : null,
      employeeType: def.includes('employeeType') ? (q.employeeType ?? null) : null,
      employeeId: def.includes('employee') ? (q.employeeId ?? null) : null,
      typeId: def.includes('type') ? (q.typeId ?? null) : null,
      status: def.includes('status') ? (q.status ?? 'approved') : null,
    };
  }

  /** The staff of a report: active, filtered; the "Not required" left out unless one of them is picked. */
  private async staff(c: PoolClient, s: Scope): Promise<Emp[]> {
    const r = await c.query<Emp>(
      `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department, e.designation, e.joined_on::text AS joined
         FROM employees e
        WHERE e.deleted_at IS NULL
          AND (($3::bigint IS NOT NULL AND e.id = $3)
               OR ($3::bigint IS NULL AND e.status = 'active'
                   AND NOT EXISTS (SELECT 1 FROM staff_report_exclusions x WHERE x.employee_id = e.id AND x.status = 'active')))
          AND ($1::text IS NULL OR lower(btrim(e.department)) = lower(btrim($1)))
          AND ($2::text IS NULL OR e.employee_type::text = $2)
        ORDER BY e.display_name, e.employee_code LIMIT 3000`,
      [s.department, s.employeeType, s.employeeId],
    );
    return r.rows;
  }

  private async days(c: PoolClient, emps: Emp[], from: string, to: string) {
    const r = await c.query<Day>(
      `SELECT employee_id::text AS emp, day::text, day_type, marked, joined, leave_code, loss_of_pay, portion::float8 AS portion,
              present::float8 AS present, leave::float8 AS leave, lop::float8 AS lop,
              to_char(in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS in_t, to_char(out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS out_t,
              worked::float8 AS worked, late, early, manual, missing, shift, shift_end, remark
         FROM app.staff_report_days($1::bigint[], $2::date, $3::date) ORDER BY employee_id, day`,
      [emps.map((e) => e.id), from, to],
    );
    const by = new Map<string, Day[]>();
    for (const d of r.rows) by.set(d.emp, [...(by.get(d.emp) ?? []), d]);
    return by;
  }

  private async types(c: PoolClient, s: Scope): Promise<TypeRow[]> {
    return (
      await c.query<TypeRow>(
        `SELECT id::text, code, name, loss_of_pay AS lop, keeps_balance AND NOT loss_of_pay AS balance
           FROM staff_leave_types WHERE status = 'active' AND ($1::bigint IS NULL OR id = $1)
          ORDER BY loss_of_pay, sort_order, code`,
        [s.typeId],
      )
    ).rows;
  }

  /** Late marks (not waived) and missing punches (not cleared) of each employee in a range. */
  private async marks(c: PoolClient, emps: Emp[], from: string, to: string) {
    const r = await c.query<{ emp: string; late: number; missing: number }>(
      `SELECT e AS emp,
              (SELECT count(*)::int FROM staff_late_marks x WHERE x.employee_id = e::bigint AND x.day BETWEEN $2::date AND $3::date AND x.status <> 'waived') AS late,
              (SELECT count(*)::int FROM staff_missing_punches x WHERE x.employee_id = e::bigint AND x.day BETWEEN $2::date AND $3::date AND x.status <> 'retired') AS missing
         FROM unnest($1::text[]) e`,
      [emps.map((x) => x.id), from, to],
    );
    return new Map(r.rows.map((x) => [x.emp, x]));
  }

  private async settings(c: PoolClient) {
    return (
      (
        await c.query<{ late: number; missing: number }>(
          `SELECT late_marks_per_leave AS late, missing_punches_per_leave AS missing FROM staff_leave_settings
            WHERE school_id = app.current_school_id()`,
        )
      ).rows[0] ?? { late: 3, missing: 4 }
    );
  }

  // ---- the reports -----------------------------------------------------------------------------
  private async build(c: PoolClient, report: LeaveReport, s: Scope): Promise<ReportTable> {
    const today = istToday();
    const emps = await this.staff(c, s);
    const empOf = new Map(emps.map((e) => [e.id, e]));
    const dayLink = (emp: string, day: string) => `/leave/attendance/day?emp=${emp}&day=${day}`;
    const ids = emps.map((e) => e.id);

    switch (report) {
      case 'daily': {
        const by = await this.days(c, emps, s.day, s.day);
        const tm = await c.query<{
          emp: string;
          shift_code: string | null;
          starts: string | null;
          ends: string | null;
          present_hours: string | null;
          half_day_hours: string | null;
          timing_source: string | null;
        }>(
          `SELECT e.id::text AS emp, tm.shift_code, to_char(tm.starts_at, 'HH24:MI') AS starts, to_char(tm.ends_at, 'HH24:MI') AS ends,
                  tm.present_hours::text, tm.half_day_hours::text, tm.timing_source
             FROM unnest($1::bigint[]) AS e(id) CROSS JOIN LATERAL app.staff_timing(e.id, $2::date) tm`,
          [ids, s.day],
        );
        const tmOf = new Map(tm.rows.map((x) => [x.emp, x]));
        const k = {
          P: 0,
          HD: 0,
          A: 0,
          leave: 0,
          lop: 0,
          off: 0,
          late: 0,
          early: 0,
          miss: 0,
          nm: 0,
          hand: 0,
        };
        const rows: ReportCell[][] = [];
        const links: string[] = [];
        emps.forEach((e, i) => {
          const d = by.get(e.id)?.[0];
          const t = tmOf.get(e.id);
          const code = d ? codeOf(d, today) : '';
          if (d?.day_type === 'P') k.P += 1;
          else if (d?.day_type === 'HD') k.HD += 1;
          else if (d?.day_type === 'A') k.A += 1;
          else if (d?.day_type === 'WO' || d?.day_type === 'H') k.off += 1;
          else if (d?.day_type === 'LV') {
            if (d.loss_of_pay) k.lop += 1;
            else k.leave += 1;
          } else if (d?.day_type === null && d.joined) k.nm += 1;
          if (d && d.late > 0) k.late += 1;
          if (d && d.early > 0) k.early += 1;
          if (d?.missing) k.miss += 1;
          if (d?.manual) k.hand += 1;
          rows.push([
            i + 1,
            e.code,
            e.name,
            e.designation,
            e.department,
            d?.in_t ?? '',
            d?.out_t ?? '',
            code === '·' ? 'Not marked' : code,
            d && d.late > 0 ? d.late : '',
            d && d.early > 0 ? d.early : '',
            d?.missing ? d.missing.toUpperCase() : '',
            d?.shift ?? t?.shift_code ?? '',
            hhmm(d?.worked ?? null),
            t?.starts
              ? `${t.starts}–${t.ends ?? ''} · P≥${String(Number(t.present_hours))}h · HD≥${String(Number(t.half_day_hours))}h · ${TIMING[t.timing_source ?? ''] ?? t.timing_source ?? ''}`
              : '',
            d?.remark ?? '',
          ]);
          links.push(dayLink(e.id, s.day));
        });
        return {
          columns: [
            { label: '#', type: 'number', width: 0.6 },
            { label: 'Emp. code', width: 1.6 },
            { label: 'Employee', width: 3 },
            { label: 'Designation', width: 2 },
            { label: 'Department', width: 2 },
            { label: 'In', width: 1, center: true },
            { label: 'Out', width: 1, center: true },
            { label: 'Attendance', width: 1.9, center: true },
            { label: 'Late (min)', type: 'number', width: 1.1 },
            { label: 'Early (min)', type: 'number', width: 1.1 },
            { label: 'Missing punch', width: 1.6, center: true },
            { label: 'Shift', width: 1.1 },
            { label: 'Hours', width: 1.2, center: true },
            { label: 'Timing', width: 3.4 },
            { label: 'Remark', width: 2.4 },
          ],
          rows,
          links,
          pdfColumns: [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13],
          paper: { portrait: true },
          kpis: [
            { label: 'Staff', value: emps.length },
            { label: 'Present', value: k.P },
            { label: 'Half day', value: k.HD },
            { label: 'Absent', value: k.A },
            { label: 'On leave', value: k.leave },
            { label: 'Loss of pay', value: k.lop },
            { label: 'Weekly off / holiday', value: k.off },
            { label: 'Late', value: k.late },
            { label: 'Left early', value: k.early },
            { label: 'Punch missing', value: k.miss },
            { label: 'Not marked', value: k.nm },
            { label: 'Set by hand', value: k.hand },
          ],
        };
      }

      case 'in_out': {
        const by = await this.days(c, emps, s.day, s.day);
        const prev = await c.query<{
          emp: string;
          day: string;
          out_t: string | null;
          early: number;
          had_in: boolean;
        }>(
          `SELECT DISTINCT ON (a.employee_id) a.employee_id::text AS emp, a.day::text,
                  to_char(a.out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS out_t, a.early_minutes AS early, a.in_at IS NOT NULL AS had_in
             FROM staff_attendance_days a
            WHERE a.employee_id = ANY($1::bigint[]) AND a.day BETWEEN $2::date - 7 AND $2::date - 1
              AND a.day_type IN ('P', 'HD', 'A') AND (a.in_at IS NOT NULL OR a.out_at IS NOT NULL)
            ORDER BY a.employee_id, a.day DESC`,
          [ids, s.day],
        );
        const first = await c.query<{ emp: string; at: string }>(
          `SELECT employee_id::text AS emp, to_char(min(punched_at) AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS at
             FROM staff_punches WHERE employee_id = ANY($1::bigint[])
              AND (punched_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date GROUP BY 1`,
          [ids, s.day],
        );
        const prevOf = new Map(prev.rows.map((x) => [x.emp, x]));
        const firstOf = new Map(first.rows.map((x) => [x.emp, x.at]));
        const k = { in: 0, notIn: 0, leave: 0, late: 0, early: 0, missOut: 0 };
        const rows: ReportCell[][] = [];
        emps.forEach((e, i) => {
          const d = by.get(e.id)?.[0];
          const p = prevOf.get(e.id);
          const inT = d?.in_t ?? firstOf.get(e.id) ?? null;
          const off = d?.day_type === 'WO' || d?.day_type === 'H' || d?.day_type === 'LV';
          const miss = [
            p && p.had_in && !p.out_t ? 'OUT (prev)' : null,
            !inT && !off && s.day <= today ? 'IN (today)' : null,
          ].filter(Boolean);
          if (inT) k.in += 1;
          else if (d?.day_type === 'LV') k.leave += 1;
          else if (!off) k.notIn += 1;
          if (d && d.late > 0) k.late += 1;
          if (p && p.early > 0) k.early += 1;
          if (p && p.had_in && !p.out_t) k.missOut += 1;
          rows.push([
            i + 1,
            e.code,
            e.name,
            e.designation,
            e.department,
            p?.out_t
              ? `${p.out_t} · ${p.day.slice(8, 10)}-${MON[Number(p.day.slice(5, 7)) - 1]!}`
              : '',
            inT ?? '',
            inT
              ? d?.day_type && d.day_type !== 'A'
                ? codeOf(d, today)
                : 'P'
              : d
                ? codeOf(d, today).replace('·', 'Not in') || 'Not in'
                : '',
            d && d.late > 0 ? d.late : '',
            p && p.early > 0 ? p.early : '',
            miss.join(', '),
            d?.shift ?? '',
          ]);
        });
        return {
          columns: [
            { label: '#', type: 'number', width: 0.6 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            { label: 'Designation', width: 2 },
            { label: 'Department', width: 2 },
            { label: 'Last OUT (working day before)', width: 2 },
            { label: 'Today’s IN', width: 1.1, center: true },
            { label: 'Attendance', width: 1.2, center: true },
            { label: 'Late (min)', type: 'number', width: 1 },
            { label: 'Early (min)', type: 'number', width: 1 },
            { label: 'Missing punch', width: 2 },
            { label: 'Shift', width: 1.2 },
          ],
          rows,
          links: emps.map((e) => dayLink(e.id, s.day)),
          pdfColumns: [0, 1, 2, 5, 6, 7, 8, 9, 10, 11],
          paper: { portrait: true },
          kpis: [
            { label: 'Staff', value: emps.length },
            { label: 'In', value: k.in },
            { label: 'Not in', value: k.notIn },
            { label: 'On leave', value: k.leave },
            { label: 'Late today', value: k.late },
            { label: 'Left early (day before)', value: k.early },
          ],
          note: 'Last OUT: the latest OUT of the seven days before, with its date; Early: against the shift’s end of that day. OUT (prev): the working day before has an IN and no OUT.',
        };
      }

      case 'monthly_summary': {
        const by = await this.days(c, emps, s.month, s.monthEnd);
        const mk = await this.marks(c, emps, s.month, s.monthEnd);
        const rows = emps.map((e, i) => {
          const t = tally(by.get(e.id) ?? [], today);
          return [
            i + 1,
            e.code,
            e.name,
            e.department,
            monthWords(s.month),
            span(s.month, s.monthEnd),
            t.working,
            t.P,
            t.HD,
            t.A,
            t.WO,
            t.H,
            r1(t.leave),
            r1(t.lop),
            t.HOLD,
            t.notMarked,
            mk.get(e.id)?.late ?? 0,
            mk.get(e.id)?.missing ?? 0,
            pctOf(t),
          ] as ReportCell[];
        });
        return {
          columns: [
            { label: '#', type: 'number', width: 0.6 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            { label: 'Department', width: 2 },
            { label: 'Month', width: 1.3 },
            ...[
              'Days',
              'Working days',
              'Present',
              'Half day',
              'Absent',
              'Weekly off',
              'Holiday',
              'Paid leave',
              'Loss of pay',
              'Hold',
              'Not marked',
              'Late marks',
              'Missing punches',
              'Attendance %',
            ].map((label) => ({ label, type: 'number' as const, width: 1 })),
          ],
          rows,
          note: 'Working days: the days up to yesterday from joining, less weekly offs and holidays. Attendance % = (present — a half day half, on duty and work from home in full, the worked half of a half day of leave — + paid leave) ÷ working days. A day not worked out yet is "not marked", never absent.',
        };
      }

      case 'monthly_employee':
      case 'card': {
        const by = await this.days(c, emps, s.month, s.monthEnd);
        const rows: ReportCell[][] = [];
        const headings: number[] = [];
        const breaks: number[] = [];
        const links: Array<string | null> = [];
        for (const e of emps) {
          const ds = by.get(e.id) ?? [];
          const t = tally(ds, today);
          breaks.push(rows.length);
          headings.push(rows.length);
          links.push(null);
          rows.push([
            report === 'card'
              ? `${e.code} · ${e.name}${e.department ? ` · ${e.department}` : ''}${e.designation ? ` · ${e.designation}` : ''}`
              : `${e.code} — ${e.name}${e.department ? ` — ${e.department}` : ''}`,
          ]);
          if (report === 'card') {
            headings.push(rows.length);
            links.push(null);
            rows.push([
              `Present ${String(r1(t.present))} · Absent ${String(t.A)} · Leave ${String(r1(t.leave))} · Loss of pay ${String(r1(t.lop))} · Weekly off / holiday ${String(t.WO + t.H)} · Hours worked ${hhmm(t.hours)}`,
            ]);
          }
          for (const d of ds) {
            const code = codeOf(d, today);
            links.push(dayLink(e.id, d.day));
            rows.push(
              report === 'card'
                ? [
                    d.day,
                    WEEKDAY_LONG[wd(d.day)]!,
                    d.shift ?? '',
                    d.in_t ?? '',
                    d.in_t ? (d.late > 0 ? 'Yes' : 'No') : '',
                    d.out_t ?? '',
                    d.early > 0 ? d.early : '',
                    code === '·' ? 'Not marked' : code,
                    hhmm(d.worked),
                  ]
                : [
                    d.day,
                    WEEKDAY[wd(d.day)]!,
                    code === '·' ? 'Not marked' : code,
                    d.in_t ?? '',
                    d.out_t ?? '',
                    hhmm(d.worked),
                    [
                      d.late > 0 ? `Late ${String(d.late)}m` : null,
                      d.early > 0 ? `Early ${String(d.early)}m` : null,
                      d.missing ? `Missing ${d.missing.toUpperCase()}` : null,
                      d.manual ? 'Set by hand' : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    d.remark ?? '',
                  ],
            );
          }
        }
        return {
          columns:
            report === 'card'
              ? [
                  { label: 'Date', type: 'date', width: 1.3 },
                  { label: 'Day', width: 1.5 },
                  { label: 'Shift', width: 1.2 },
                  { label: 'Office in', width: 1, center: true },
                  { label: 'Late', width: 0.8, center: true },
                  { label: 'Office out', width: 1, center: true },
                  { label: 'Early (min)', type: 'number', width: 1 },
                  { label: 'Status', width: 1, center: true },
                  { label: 'Hours worked', width: 1, center: true },
                ]
              : [
                  { label: 'Date', type: 'date', width: 1.3 },
                  { label: 'Day', width: 0.8 },
                  { label: 'Attendance', width: 1.2, center: true },
                  { label: 'In', width: 1, center: true },
                  { label: 'Out', width: 1, center: true },
                  { label: 'Hours', width: 1, center: true },
                  { label: 'Flags', width: 3.5 },
                  { label: 'Remark', width: 3 },
                ],
          rows,
          headings,
          breaks,
          links,
          records: emps.length,
          paper: { portrait: true, fontSize: 7.5 },
          note:
            report === 'card'
              ? 'Present: a present day in full, a half day half, on duty and work from home in full, the worked half of a half day of leave. Leave: paid leave; loss of pay apart.'
              : undefined,
        };
      }

      case 'monthly_register':
      case 'basic_work': {
        const from = report === 'basic_work' ? s.from : s.month;
        const to = report === 'basic_work' ? s.to : s.monthEnd;
        const by = await this.days(c, emps, from, to);
        const types = (await this.types(c, { ...s, typeId: null })).filter((t) => !t.lop);
        const dates: string[] = [];
        for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
        const sums = [
          'P',
          'HD',
          'A',
          'WO',
          'H',
          ...types.map((t) => t.code),
          'LOP',
          'Late',
          'Miss',
        ];
        const rows: ReportCell[][] = [];
        const strong: number[] = [];
        const breaks: number[] = [];
        const links: Array<string | null> = [];
        emps.forEach((e, n) => {
          const ds = by.get(e.id) ?? [];
          const t = tally(ds, today);
          if (report === 'basic_work' && n > 0 && n % 5 === 0) breaks.push(rows.length);
          strong.push(rows.length);
          const totals = [
            t.P + r1(t.halfWorked),
            t.HD,
            t.A,
            t.WO,
            t.H,
            ...types.map((x) => r1(t.byType[x.code] ?? 0)),
            r1(t.lop),
            t.late,
            t.missing,
          ];
          const blank = sums.map(() => '');
          links.push(null, null, null, null);
          rows.push([
            e.code,
            e.name,
            'Status',
            ...ds.map((d) => `${codeOf(d, today)}${marksOf(d)}`),
            ...totals,
          ]);
          rows.push(['', '', 'In', ...ds.map((d) => d.in_t ?? ''), ...blank]);
          rows.push(['', '', 'Out', ...ds.map((d) => d.out_t ?? ''), ...blank]);
          rows.push([
            '',
            '',
            report === 'basic_work' ? 'Total' : 'Hours',
            ...ds.map((d) =>
              d.worked !== null ? hhmm(d.worked) : report === 'basic_work' ? '0:00' : '',
            ),
            ...blank,
          ]);
        });
        return {
          columns: [
            { label: 'Emp. code', width: 1.4 },
            { label: 'Employee', width: 3 },
            { label: '', width: 1 },
            ...dates.map((d) => ({
              label: `${String(Number(d.slice(8, 10)))} ${WEEKDAY[wd(d)]!.slice(0, 2)}`,
              width: 1,
              center: true,
            })),
            ...sums.map((label) => ({ label, type: 'number' as const, width: 0.8 })),
          ],
          rows,
          strong,
          breaks: report === 'basic_work' ? breaks : undefined,
          links,
          records: emps.length,
          paper: { a3: true, fontSize: 5.5 },
          note: 'Status: P present, HD half day, A absent, WO weekly off, H holiday, the leave’s code (½ half a day), LOP loss of pay, HOLD salary hold, · not marked; ·L late, ·F a punch missing, ·m set by hand. P counts the worked half of a half day of leave.',
        };
      }

      case 'shift_roster': {
        const { shifts, defaultShiftId } = await shiftList(c);
        const by = await shiftCells(c, ids, s.month, s.monthEnd, defaultShiftId);
        const code = new Map(shifts.map((x) => [x.id, x.code]));
        const dates: string[] = [];
        for (let d = s.month; d <= s.monthEnd; d = addDays(d, 1)) dates.push(d);
        const rows = emps.map((e) => {
          const n = new Map<string, number>();
          const cells = dates.map((d) => {
            const x = by.get(e.id)?.get(d);
            if (!x) return '';
            if (x.h) return 'H';
            if (x.wo) return 'WO';
            const k = x.s ? (code.get(x.s) ?? '') : '';
            if (k) n.set(k, (n.get(k) ?? 0) + 1);
            return `${k}${x.src === 'day' ? '*' : ''}`;
          });
          return [
            e.code,
            e.name,
            e.department,
            ...cells,
            ...shifts.map((x) => n.get(x.code) ?? 0),
          ] as ReportCell[];
        });
        return {
          columns: [
            { label: 'Emp. code', width: 1.4 },
            { label: 'Employee', width: 3 },
            { label: 'Department', width: 2 },
            ...dates.map((d) => ({
              label: `${String(Number(d.slice(8, 10)))} ${WEEKDAY[wd(d)]!.slice(0, 2)}`,
              width: 1,
              center: true,
            })),
            ...shifts.map((x) => ({ label: x.code, type: 'number' as const, width: 0.9 })),
          ],
          rows,
          records: emps.length,
          paper: { a3: true, fontSize: 6 },
          note: `Each day: the shift’s code (${shifts.map((x) => `${x.code} ${x.name}`).join(', ')}); WO weekly off, H holiday, * a shift for that day only. Staff with no shift posted work the default shift. The totals: the working days of each shift.`,
        };
      }

      case 'monthly_cumulative': {
        const fy = fyStart(s.month);
        const by = await this.days(c, emps, s.month, s.monthEnd);
        const allTypes = (await this.types(c, { ...s, typeId: null })).filter((t) => t.balance);
        const late = await c.query<{ emp: string; now: number; before: number }>(
          `SELECT e AS emp,
                  (SELECT count(*)::int FROM staff_late_marks x WHERE x.employee_id = e::bigint AND x.day BETWEEN $2::date AND $3::date AND x.status <> 'waived') AS now,
                  (SELECT count(*)::int FROM staff_late_marks x WHERE x.employee_id = e::bigint AND x.day >= $4::date AND x.day < $2::date AND x.status <> 'waived') AS before
             FROM unnest($1::text[]) e`,
          [ids, s.month, s.monthEnd, fy],
        );
        const bal = await c.query<{
          emp: string;
          code: string;
          credited: number;
          taken: number;
          before: number;
          closing: number;
        }>(
          `SELECT b.employee_id::text AS emp, t.code, (b.opening + b.credited + b.correction)::float8 AS credited, b.held::float8 AS taken,
                  (SELECT COALESCE(sum(p.held), 0) FROM staff_leave_balances p WHERE p.employee_id = b.employee_id
                      AND p.leave_type_id = b.leave_type_id AND p.month >= $3::date AND p.month < b.month)::float8 AS before,
                  (CASE WHEN b.closed THEN b.closing ELSE app.staff_leave_effective_closing(b) END)::float8 AS closing
             FROM staff_leave_balances b JOIN staff_leave_types t ON t.id = b.leave_type_id
            WHERE b.employee_id = ANY($1::bigint[]) AND b.month = $2::date`,
          [ids, s.month, fy],
        );
        const lateOf = new Map(late.rows.map((x) => [x.emp, x]));
        const balOf = new Map(bal.rows.map((x) => [`${x.emp}|${x.code}`, x]));
        const held = new Set(bal.rows.map((x) => x.code));
        const types = allTypes.filter((t) => held.has(t.code));
        const dates: string[] = [];
        for (let d = s.month; d <= s.monthEnd; d = addDays(d, 1)) dates.push(d);
        const rows = emps.map((e, i) => {
          const ds = by.get(e.id) ?? [];
          const l = lateOf.get(e.id);
          return [
            i + 1,
            e.code,
            e.name,
            ...ds.map((d) =>
              d.late > 0 && (d.day_type === 'P' || d.day_type === 'HD') ? 'LT' : codeOf(d, today),
            ),
            l?.now ?? 0,
            l?.before ?? 0,
            (l?.now ?? 0) + (l?.before ?? 0),
            ...types.flatMap((t): ReportCell[] => {
              const b = balOf.get(`${e.id}|${t.code}`);
              return b
                ? [r2(b.credited), r2(b.taken), r2(b.before), r2(b.taken + b.before), r2(b.closing)]
                : ['', '', '', '', ''];
            }),
          ] as ReportCell[];
        });
        return {
          columns: [
            { label: 'S. no.', type: 'number', width: 0.7 },
            { label: 'Emp. code', width: 1.4 },
            { label: 'Employee', width: 3 },
            ...dates.map((d) => ({
              label: String(Number(d.slice(8, 10))),
              width: 0.8,
              center: true,
            })),
            { label: 'Month', type: 'number', width: 0.9, group: 'Late marks' },
            { label: 'Before', type: 'number', width: 0.9, group: 'Late marks' },
            { label: 'Year', type: 'number', width: 0.9, group: 'Late marks' },
            ...types.flatMap((t) =>
              ['Credited', 'Month', 'Before', 'Year', 'Closing'].map((label) => ({
                label,
                type: 'number' as const,
                width: 0.9,
                group: t.code,
              })),
            ),
          ],
          rows,
          paper: { a3: true, fontSize: 5.5 },
          note: 'LT late; the other codes as on the register. Under each leave type: credited (opening + credited + corrections of the month), taken this month, before it and in the year (held by leave raised; the year from 1 April), closing. Late marks count until waived (marks turned into leave stay counted).',
        };
      }

      case 'annual': {
        const by = await this.days(c, emps, s.from, s.to);
        const mk = await this.marks(c, emps, s.from, s.to);
        const types = await this.types(c, { ...s, typeId: null });
        const extra = await c.query<{ emp: string; regs: number; auto: number }>(
          `SELECT e AS emp,
                  (SELECT count(*)::int FROM staff_regularisations g WHERE g.employee_id = e::bigint AND g.day BETWEEN $2::date AND $3::date AND g.status = 'approved') AS regs,
                  (SELECT count(*)::int FROM staff_leave_requests r WHERE r.employee_id = e::bigint AND r.source LIKE 'auto%'
                      AND r.status = 'approved' AND r.from_date <= $3::date AND r.to_date >= $2::date) AS auto
             FROM unnest($1::text[]) e`,
          [ids, s.from, s.to],
        );
        const taken = await c.query<{ emp: string; code: string; days: number }>(
          `SELECT l.employee_id::text AS emp, t.code, sum(l.portion)::float8 AS days
             FROM staff_leave_days l JOIN staff_leave_requests r ON r.id = l.request_id JOIN staff_leave_types t ON t.id = r.leave_type_id
            WHERE l.employee_id = ANY($1::bigint[]) AND l.status = 'approved' AND l.day BETWEEN $2::date AND $3::date
            GROUP BY 1, 2`,
          [ids, s.from, s.to],
        );
        const bal = await c.query<{ emp: string; code: string; available: number }>(
          `SELECT DISTINCT ON (b.employee_id, b.leave_type_id) b.employee_id::text AS emp, t.code,
                  (CASE WHEN b.closed THEN b.closing ELSE app.staff_leave_effective_closing(b) END)::float8 AS available
             FROM staff_leave_balances b JOIN staff_leave_types t ON t.id = b.leave_type_id
            WHERE b.employee_id = ANY($1::bigint[]) AND b.month <= $2::date
            ORDER BY b.employee_id, b.leave_type_id, b.month DESC`,
          [ids, monthStart(s.to)],
        );
        const exOf = new Map(extra.rows.map((x) => [x.emp, x]));
        const tkOf = new Map(taken.rows.map((x) => [`${x.emp}|${x.code}`, x.days]));
        const blOf = new Map(bal.rows.map((x) => [`${x.emp}|${x.code}`, x.available]));
        const balTypes = types.filter((t) => t.balance);
        const rows = emps.map((e, i) => {
          const t = tally(by.get(e.id) ?? [], today);
          return [
            i + 1,
            e.code,
            e.name,
            e.department,
            `${dmy(s.from)} to ${dmy(s.to)}`,
            t.P,
            t.HD,
            t.A,
            t.WO,
            t.H,
            r1(t.leave),
            r1(t.lop),
            pctOf(t),
            mk.get(e.id)?.late ?? 0,
            mk.get(e.id)?.missing ?? 0,
            exOf.get(e.id)?.regs ?? 0,
            exOf.get(e.id)?.auto ?? 0,
            ...types.map((x) => r1(tkOf.get(`${e.id}|${x.code}`) ?? 0)),
            ...balTypes.map((x) => {
              const v = blOf.get(`${e.id}|${x.code}`);
              return v === undefined ? '' : r2(v);
            }),
          ] as ReportCell[];
        });
        return {
          columns: [
            { label: '#', type: 'number', width: 0.6 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            { label: 'Department', width: 2 },
            { label: 'Period', width: 2.4 },
            ...[
              'Present',
              'Half day',
              'Absent',
              'Weekly off',
              'Holiday',
              'Paid leave',
              'Loss of pay',
              'Attendance %',
              'Late marks',
              'Missing punches',
              'Corrections',
              'Deducted by the system',
            ].map((label) => ({ label, type: 'number' as const, width: 1 })),
            ...types.map((x) => ({
              label: x.code,
              type: 'number' as const,
              width: 0.9,
              group: 'Taken',
            })),
            ...balTypes.map((x) => ({
              label: x.code,
              type: 'number' as const,
              width: 0.9,
              group: 'Balance',
            })),
          ],
          rows,
          note: 'Attendance % = (present — a half day half — + paid leave) ÷ working days (the days up to yesterday from joining, less weekly offs and holidays). Taken: approved leave days in the period. Balance: the last month on or before the period’s end.',
        };
      }

      case 'employee_yearly': {
        const to = monthEnd(s.toMonth);
        const by = await this.days(c, emps, s.fromMonth, to);
        const types = await this.types(c, { ...s, typeId: null });
        const rows = emps.map((e, i) => {
          const t = tally(by.get(e.id) ?? [], today);
          return [
            i + 1,
            e.code,
            e.name,
            t.P,
            t.HD,
            t.A,
            t.WO,
            t.H,
            ...types.map((x) => r1(t.byType[x.code] ?? 0)),
            r1(types.filter((x) => !x.lop).reduce((n, x) => n + (t.byType[x.code] ?? 0), 0)),
          ] as ReportCell[];
        });
        return {
          columns: [
            { label: '#', type: 'number', width: 0.6 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            ...['Present', 'Half day', 'Absent', 'Weekly off', 'Holiday'].map((label) => ({
              label,
              type: 'number' as const,
              width: 1,
            })),
            ...types.map((x) => ({ label: x.code, type: 'number' as const, width: 0.9 })),
            {
              label: `Paid leave (${types
                .filter((x) => !x.lop)
                .map((x) => x.code)
                .join('+')})`,
              type: 'number',
              width: 1.6,
            },
          ],
          rows,
        };
      }

      case 'year_on_year': {
        const r = await c.query<{
          emp: string;
          code: string;
          fy: number;
          opening: number;
          credited: number;
          correction: number;
          taken: number;
          lapsed: number;
          closing: number;
          closed: boolean;
        }>(
          `SELECT b.employee_id::text AS emp, t.code,
                  (CASE WHEN extract(month FROM b.month) >= 4 THEN extract(year FROM b.month) ELSE extract(year FROM b.month) - 1 END)::int AS fy,
                  ((array_agg(b.opening ORDER BY b.month))[1])::float8 AS opening, sum(b.credited)::float8 AS credited,
                  sum(b.correction)::float8 AS correction, sum(b.held)::float8 AS taken, sum(b.lapsed)::float8 AS lapsed,
                  ((array_agg(CASE WHEN b.closed THEN b.closing ELSE app.staff_leave_effective_closing(b) END ORDER BY b.month DESC))[1])::float8 AS closing,
                  bool_and(b.closed) AS closed
             FROM staff_leave_balances b JOIN staff_leave_types t ON t.id = b.leave_type_id
            WHERE b.employee_id = ANY($1::bigint[]) AND ($2::bigint IS NULL OR b.leave_type_id = $2)
            GROUP BY 1, 2, 3, t.sort_order ORDER BY 1, 3, t.sort_order, 2`,
          [ids, s.typeId],
        );
        const order = new Map(emps.map((e, i) => [e.id, i]));
        const rows = [...r.rows]
          .sort((a, b) => (order.get(a.emp) ?? 0) - (order.get(b.emp) ?? 0) || a.fy - b.fy)
          .map((x) => {
            const e = empOf.get(x.emp)!;
            return [
              e.code,
              e.name,
              `${String(x.fy)}-${String((x.fy + 1) % 100).padStart(2, '0')}`,
              x.code,
              r2(x.opening),
              r2(x.credited),
              r2(x.correction),
              r2(x.taken),
              r2(x.lapsed),
              r2(x.closing),
              x.closed ? 'Year closed' : 'Running',
            ] as ReportCell[];
          });
        return {
          columns: [
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            { label: 'Year', width: 1 },
            { label: 'Leave type', width: 1 },
            ...['Opening', 'Credited', 'Corrections', 'Taken', 'Lapsed', 'Closing'].map(
              (label) => ({
                label,
                type: 'number' as const,
                width: 1,
              }),
            ),
            { label: 'Closing is', width: 1.3 },
          ],
          rows,
          note: 'A financial year runs April to March. Opening: the first month’s; taken: held by leave raised in the year; closing: the last month’s (worked out when the month is still running).',
        };
      }

      case 'late_arrival': {
        const set = await this.settings(c);
        const r = await c.query<{
          emp: string;
          day: string;
          in_t: string;
          start: string;
          grace: number;
          late: number;
          status: string;
          number: string | null;
          pending: number;
        }>(
          `SELECT x.employee_id::text AS emp, x.day::text, to_char(x.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS in_t,
                  to_char(x.starts_at, 'HH24:MI') AS start, x.grace, x.late_minutes AS late, x.status,
                  (SELECT r.number FROM staff_leave_requests r WHERE r.id = x.request_id) AS number,
                  (SELECT count(*)::int FROM staff_late_marks y WHERE y.employee_id = x.employee_id AND y.status = 'pending'
                      AND date_trunc('month', y.day) = date_trunc('month', x.day)) AS pending
             FROM staff_late_marks x WHERE x.employee_id = ANY($1::bigint[]) AND x.day BETWEEN $2::date AND $3::date`,
          [ids, s.from, s.to],
        );
        const order = new Map(emps.map((e, i) => [e.id, i]));
        const sorted = [...r.rows].sort(
          (a, b) => (order.get(a.emp) ?? 0) - (order.get(b.emp) ?? 0) || a.day.localeCompare(b.day),
        );
        return {
          columns: [
            { label: 'Date', type: 'date', width: 1.3 },
            { label: 'Day', width: 0.8 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 2.8 },
            { label: 'Department', width: 1.8 },
            { label: 'In', width: 0.9, center: true },
            { label: 'Shift start', width: 1, center: true },
            { label: 'Grace (min)', type: 'number', width: 0.9 },
            { label: 'Late by (min)', type: 'number', width: 0.9 },
            { label: 'Status', width: 1.5 },
            { label: 'As leave', width: 1.8 },
            { label: 'Counting that month', type: 'number', width: 1 },
            { label: 'Due for deduction', width: 2.4 },
          ],
          rows: sorted.map((x) => {
            const e = empOf.get(x.emp)!;
            const due = Math.floor(x.pending / set.late);
            return [
              x.day,
              WEEKDAY[wd(x.day)]!,
              e.code,
              e.name,
              e.department,
              x.in_t,
              x.start,
              x.grace,
              x.late,
              MARK[x.status] ?? x.status,
              x.number ?? '',
              x.pending,
              due
                ? `Yes — ${String(due)} day${due === 1 ? '' : 's'} (${String(set.late)} marks = 1)`
                : 'No',
            ];
          }),
          links: sorted.map((x) => dayLink(x.emp, x.day)),
          note: `Counting that month: the marks of the employee still counting in the whole month of the mark; every ${String(set.late)} become a day of leave at the month’s end.`,
        };
      }

      case 'early_going': {
        const by = await this.days(c, emps, s.from, s.to);
        const list: Array<{ e: Emp; d: Day }> = [];
        for (const e of emps)
          for (const d of by.get(e.id) ?? [])
            if (d.early > 0 && (d.day_type === 'P' || d.day_type === 'HD')) list.push({ e, d });
        list.sort((a, b) => a.d.day.localeCompare(b.d.day));
        return {
          columns: [
            { label: 'Date', type: 'date', width: 1.3 },
            { label: 'Day', width: 0.8 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            { label: 'Department', width: 2 },
            { label: 'In', width: 1, center: true },
            { label: 'Out', width: 1, center: true },
            { label: 'Shift end', width: 1, center: true },
            { label: 'Early by (min)', type: 'number', width: 1 },
            { label: 'Attendance', width: 1, center: true },
            { label: 'Shift', width: 1.2 },
          ],
          rows: list.map(({ e, d }) => [
            d.day,
            WEEKDAY[wd(d.day)]!,
            e.code,
            e.name,
            e.department,
            d.in_t ?? '',
            d.out_t ?? '',
            d.shift_end ?? '',
            d.early,
            codeOf(d, today),
            d.shift ?? '',
          ]),
          links: list.map(({ e, d }) => dayLink(e.id, d.day)),
        };
      }

      case 'forgot_punch': {
        const set = await this.settings(c);
        const r = await c.query<{
          emp: string;
          day: string;
          missing: string;
          status: string;
          in_t: string | null;
          out_t: string | null;
          reg_status: string | null;
          reg_type: string | null;
          reg_in: string | null;
          reg_out: string | null;
          by: string | null;
          at: Date | null;
          pending: number;
        }>(
          `SELECT m.employee_id::text AS emp, m.day::text, m.missing, m.status,
                  to_char(a.in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS in_t, to_char(a.out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS out_t,
                  g.status AS reg_status, g.day_type AS reg_type, to_char(g.in_time, 'HH24:MI') AS reg_in, to_char(g.out_time, 'HH24:MI') AS reg_out,
                  (SELECT COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.display_name)
                     FROM users u WHERE u.id = g.decided_by) AS by,
                  g.decided_at AS at,
                  (SELECT count(*)::int FROM staff_missing_punches y WHERE y.employee_id = m.employee_id AND y.status = 'pending'
                      AND date_trunc('month', y.day) = date_trunc('month', m.day)) AS pending
             FROM staff_missing_punches m
             LEFT JOIN staff_attendance_days a ON a.employee_id = m.employee_id AND a.day = m.day
             LEFT JOIN LATERAL (SELECT * FROM staff_regularisations x WHERE x.employee_id = m.employee_id AND x.day = m.day
                                 ORDER BY x.status IN ('pending', 'approved') DESC, x.created_at DESC LIMIT 1) g ON true
            WHERE m.employee_id = ANY($1::bigint[]) AND m.day BETWEEN $2::date AND $3::date`,
          [ids, s.from, s.to],
        );
        const order = new Map(emps.map((e, i) => [e.id, i]));
        const sorted = [...r.rows].sort(
          (a, b) => (order.get(a.emp) ?? 0) - (order.get(b.emp) ?? 0) || a.day.localeCompare(b.day),
        );
        return {
          columns: [
            { label: 'Date', type: 'date', width: 1.3 },
            { label: 'Day', width: 0.8 },
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 2.6 },
            { label: 'Department', width: 1.6 },
            { label: 'In', width: 0.9, center: true },
            { label: 'Out', width: 0.9, center: true },
            { label: 'Missing', width: 0.9, center: true },
            { label: 'Status', width: 1.4 },
            { label: 'Correction asked', width: 1, center: true },
            { label: 'Asked', width: 1.6 },
            { label: 'Correction', width: 1.3 },
            { label: 'Decided by', width: 2 },
            { label: 'Decided on', type: 'date', width: 1.3 },
            { label: 'Counting that month', type: 'number', width: 1 },
            { label: 'Free before the next day', type: 'number', width: 1 },
            { label: 'Days of leave due', type: 'number', width: 1 },
          ],
          rows: sorted.map((x) => {
            const e = empOf.get(x.emp)!;
            return [
              x.day,
              WEEKDAY[wd(x.day)]!,
              e.code,
              e.name,
              e.department,
              x.in_t ?? '',
              x.out_t ?? '',
              x.missing.toUpperCase(),
              MARK[x.status] ?? x.status,
              x.reg_status ? 'Yes' : 'No',
              x.reg_status
                ? [x.reg_type, [x.reg_in, x.reg_out].filter(Boolean).join('–')]
                    .filter(Boolean)
                    .join(' ')
                : '',
              x.reg_status ? (STATUS[x.reg_status] ?? x.reg_status) : '',
              x.by ?? '',
              x.at
                ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(x.at)
                : '',
              x.pending,
              Math.max(0, set.missing - (x.pending % set.missing)),
              Math.floor(x.pending / set.missing),
            ];
          }),
          links: sorted.map((x) => dayLink(x.emp, x.day)),
          note: `Counting that month: the missing punches of the employee still counting in the whole month; every ${String(set.missing)} become a day of leave at the month’s end.`,
        };
      }

      case 'leave_availed':
      case 'leave_deduction': {
        const auto = report === 'leave_deduction';
        const r = await c.query<{
          id: string;
          number: string;
          emp: string;
          code: string;
          lop: boolean;
          from_date: string;
          to_date: string;
          days: number;
          in_range: number;
          half_day: boolean;
          session: string | null;
          reason: string;
          note: string | null;
          created: Date;
          applied_by: string | null;
          source: string;
          status: string;
          decided: Date | null;
        }>(
          `SELECT r.id::text, r.number, r.employee_id::text AS emp, t.code, t.loss_of_pay AS lop, r.from_date::text, r.to_date::text,
                  r.days::float8 AS days,
                  (SELECT COALESCE(sum(d.portion), 0) FROM staff_leave_days d WHERE d.request_id = r.id AND d.day BETWEEN $2::date AND $3::date)::float8 AS in_range,
                  r.half_day, r.session, r.reason, r.note, r.created_at AS created,
                  (SELECT u.display_name FROM users u WHERE u.id = r.applied_by) AS applied_by, r.source, r.status, r.decided_at AS decided
             FROM staff_leave_requests r JOIN staff_leave_types t ON t.id = r.leave_type_id
            WHERE r.employee_id = ANY($1::bigint[]) AND r.from_date <= $3::date AND r.to_date >= $2::date
              AND ($4::bigint IS NULL OR r.leave_type_id = $4)
              AND ($5::text IS NULL OR $5 = 'all' OR r.status = $5)
              AND ($6::boolean IS FALSE OR r.source LIKE 'auto%')
            ORDER BY r.from_date DESC, r.number`,
          [ids, s.from, s.to, s.typeId, auto ? null : s.status, auto],
        );
        const day = (d: Date | null) =>
          d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d) : '';
        return auto
          ? {
              columns: [
                { label: 'Leave no.', width: 2 },
                { label: 'Emp. code', width: 1.3 },
                { label: 'Employee', width: 2.8 },
                { label: 'Department', width: 1.8 },
                { label: 'Deducted for', width: 2 },
                { label: 'Type', width: 0.9 },
                { label: 'Loss of pay', width: 0.9, center: true },
                { label: 'From', type: 'date', width: 1.3 },
                { label: 'To', type: 'date', width: 1.3 },
                { label: 'Days', type: 'number', width: 0.8 },
                { label: 'Charged on', type: 'date', width: 1.3 },
                { label: 'Status', width: 1.3 },
                { label: 'Note', width: 3.4 },
              ],
              rows: r.rows.map((x) => {
                const e = empOf.get(x.emp)!;
                return [
                  x.number,
                  e.code,
                  e.name,
                  e.department,
                  SOURCE[x.source] ?? x.source,
                  x.code,
                  x.lop ? 'Yes' : 'No',
                  x.from_date,
                  x.to_date,
                  x.days,
                  day(x.created),
                  STATUS[x.status] ?? x.status,
                  x.note ?? x.reason,
                ];
              }),
              links: r.rows.map((x) => `/leave/requests/${x.id}`),
            }
          : {
              columns: [
                { label: 'Leave no.', width: 2 },
                { label: 'Emp. code', width: 1.3 },
                { label: 'Employee', width: 2.6 },
                { label: 'Department', width: 1.6 },
                { label: 'Type', width: 0.9 },
                { label: 'From', type: 'date', width: 1.3 },
                { label: 'To', type: 'date', width: 1.3 },
                { label: 'Days in the period', type: 'number', width: 1 },
                { label: 'Days', type: 'number', width: 0.8 },
                { label: 'Half day', width: 1 },
                { label: 'Reason', width: 3 },
                { label: 'Applied on', type: 'date', width: 1.3 },
                { label: 'Applied by', width: 2 },
                { label: 'How', width: 1.6 },
                { label: 'Status', width: 1.3 },
                { label: 'Decided on', type: 'date', width: 1.3 },
              ],
              rows: r.rows.map((x) => {
                const e = empOf.get(x.emp)!;
                return [
                  x.number,
                  e.code,
                  e.name,
                  e.department,
                  x.code,
                  x.from_date,
                  x.to_date,
                  x.in_range,
                  x.days,
                  x.half_day ? (x.session === 'second' ? 'Second half' : 'First half') : '',
                  x.reason,
                  day(x.created),
                  x.applied_by ?? '',
                  SOURCE[x.source] ?? x.source,
                  STATUS[x.status] ?? x.status,
                  day(x.decided),
                ];
              }),
              links: r.rows.map((x) => `/leave/requests/${x.id}`),
              pdfColumns: [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15],
              note: 'Days in the period: the days of the leave that fall in the period; Days: the whole leave.',
            };
      }

      case 'balance_as_on': {
        const month = monthStart(s.day);
        const r = await c.query<{
          emp: string;
          code: string;
          month: string;
          opening: number;
          credited: number;
          correction: number;
          held: number;
          later: number;
          closing: number | null;
          lapsed: number;
          closed: boolean;
          eff: number;
        }>(
          `SELECT DISTINCT ON (b.employee_id, b.leave_type_id) b.employee_id::text AS emp, t.code, b.month::text,
                  b.opening::float8 AS opening, b.credited::float8 AS credited, b.correction::float8 AS correction, b.held::float8 AS held,
                  (CASE WHEN b.month = $2::date THEN
                     (SELECT COALESCE(sum(r.days), 0) FROM staff_leave_requests r WHERE r.employee_id = b.employee_id
                         AND r.leave_type_id = b.leave_type_id AND r.held_month = b.month AND r.status IN ('pending', 'approved')
                         AND (r.created_at AT TIME ZONE 'Asia/Kolkata')::date > $3::date)
                   ELSE 0 END)::float8 AS later,
                  b.closing::float8 AS closing, b.lapsed::float8 AS lapsed, b.closed, app.staff_leave_effective_closing(b)::float8 AS eff
             FROM staff_leave_balances b
             JOIN staff_leave_types t ON t.id = b.leave_type_id AND t.status = 'active' AND t.keeps_balance AND NOT t.loss_of_pay
            WHERE b.employee_id = ANY($1::bigint[]) AND b.month <= $2::date AND ($4::bigint IS NULL OR b.leave_type_id = $4)
            ORDER BY b.employee_id, b.leave_type_id, b.month DESC`,
          [ids, month, s.day, s.typeId],
        );
        const order = new Map(emps.map((e, i) => [e.id, i]));
        const sorted = [...r.rows].sort(
          (a, b) =>
            (order.get(a.emp) ?? 0) - (order.get(b.emp) ?? 0) || a.code.localeCompare(b.code),
        );
        return {
          columns: [
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            { label: 'Department', width: 2 },
            { label: 'Leave type', width: 1 },
            { label: 'Month', width: 1.2 },
            ...[
              'Opening',
              'Credited',
              'Corrections',
              'Taken to the date',
              'Available',
              'Closing',
              'Lapsed',
            ].map((label) => ({ label, type: 'number' as const, width: 1 })),
            { label: 'Month closed', width: 1, center: true },
          ],
          rows: sorted.map((x) => {
            const e = empOf.get(x.emp)!;
            const current = x.month === month;
            const taken = current ? Math.max(0, x.held - x.later) : x.held;
            return [
              e.code,
              e.name,
              e.department,
              x.code,
              monthWords(x.month),
              r2(x.opening),
              r2(x.credited),
              r2(x.correction),
              r2(taken),
              r2(current && !x.closed ? x.opening + x.credited + x.correction - taken : x.eff),
              x.closed && x.closing !== null ? r2(x.closing) : '',
              r2(x.lapsed),
              x.closed ? 'Yes' : 'No',
            ];
          }),
          note: `As on ${dmy(s.day)}: the month of the date (or the last month before it with a balance). Taken to the date leaves out leave raised after the date.`,
        };
      }

      case 'opening_closing': {
        const r = await c.query<{
          emp: string;
          month: string;
          code: string;
          opening: number;
          added: number;
          taken: number;
          closing: number;
          closed: boolean;
        }>(
          `SELECT b.employee_id::text AS emp, b.month::text, t.code, b.opening::float8 AS opening, (b.credited + b.correction)::float8 AS added,
                  b.held::float8 AS taken, (CASE WHEN b.closed THEN b.closing ELSE app.staff_leave_effective_closing(b) END)::float8 AS closing, b.closed
             FROM staff_leave_balances b
             JOIN staff_leave_types t ON t.id = b.leave_type_id AND t.status = 'active' AND t.keeps_balance AND NOT t.loss_of_pay
            WHERE b.employee_id = ANY($1::bigint[]) AND b.month BETWEEN $2::date AND $3::date AND ($4::bigint IS NULL OR b.leave_type_id = $4)
            ORDER BY t.sort_order, t.code`,
          [ids, s.fromMonth, s.toMonth, s.typeId],
        );
        const codes = [
          ...new Set(
            r.rows.filter((x) => x.opening || x.added || x.taken || x.closing).map((x) => x.code),
          ),
        ];
        const cell = new Map(r.rows.map((x) => [`${x.emp}|${x.month}|${x.code}`, x]));
        const months: string[] = [];
        for (let m = s.fromMonth; m <= s.toMonth; m = monthStart(addDays(m, 32))) months.push(m);
        const rows: ReportCell[][] = [];
        for (const e of emps)
          for (const m of months) {
            const xs = codes.map((code) => cell.get(`${e.id}|${m}|${code}`));
            if (!xs.some(Boolean)) continue;
            const closed = xs.filter(Boolean).map((x) => x!.closed);
            rows.push([
              e.code,
              e.name,
              e.department,
              monthWords(m),
              ...xs.flatMap((x): ReportCell[] =>
                x ? [r2(x.opening), r2(x.added), r2(x.taken), r2(x.closing)] : ['', '', '', ''],
              ),
              closed.every(Boolean) ? 'Closed' : closed.some(Boolean) ? 'Mixed' : 'Open',
            ]);
          }
        return {
          columns: [
            { label: 'Emp. code', width: 1.3 },
            { label: 'Employee', width: 3 },
            { label: 'Department', width: 2 },
            { label: 'Month', width: 1.2 },
            ...codes.flatMap((code) =>
              ['Opening', 'Added', 'Taken', 'Closing'].map((label) => ({
                label,
                type: 'number' as const,
                width: 0.9,
                group: code,
              })),
            ),
            { label: 'Month is', width: 1 },
          ],
          rows,
          note: 'Added: credited and corrections; taken: held by leave raised in the month; closing of a running month worked out as the month’s end would (the carry-forward cap at the session’s end).',
        };
      }
    }
  }

  /** The filters in words: the period, the department, type, employee, leave type and status; the year. */
  private async words(c: PoolClient, report: LeaveReport, s: Scope) {
    const f = LEAVE_REPORT_DEFS[report].filters;
    const out: string[] = [];
    if (f.includes('day')) out.push(`Date ${dmy(s.day)}`);
    if (f.includes('asOn')) out.push(`As on ${dmy(s.day)}`);
    if (f.includes('month')) out.push(monthWords(s.month));
    if (f.includes('period')) out.push(`${dmy(s.from)} to ${dmy(s.to)}`);
    if (f.includes('months')) out.push(`${monthWords(s.fromMonth)} to ${monthWords(s.toMonth)}`);
    if (s.department) out.push(`Department: ${s.department}`);
    if (s.employeeType) out.push(`Employee type: ${s.employeeType.replaceAll('_', ' ')}`);
    if (s.employeeId) {
      const e = (
        await c.query<{ name: string; code: string }>(
          `SELECT display_name AS name, employee_code AS code FROM employees WHERE id = $1`,
          [s.employeeId],
        )
      ).rows[0];
      if (e) out.push(`Employee: ${e.name} (${e.code})`);
    }
    if (s.typeId) {
      const t = (
        await c.query<{ code: string }>(`SELECT code FROM staff_leave_types WHERE id = $1`, [
          s.typeId,
        ])
      ).rows[0];
      if (t) out.push(`Leave type: ${t.code}`);
    }
    if (s.status && report === 'leave_availed')
      out.push(s.status === 'all' ? 'Any status' : (STATUS[s.status] ?? s.status));
    const fy = fyStart(
      f.includes('month')
        ? s.month
        : f.includes('period')
          ? s.from
          : f.includes('months')
            ? s.fromMonth
            : s.day,
    );
    out.push(
      `Financial year ${fy.slice(0, 4)}-${String((Number(fy.slice(0, 4)) + 1) % 100).padStart(2, '0')}`,
    );
    return out.join(' · ');
  }

  /** A report on screen (up to 3,000 rows) or as Excel / PDF (up to 20,000). */
  async report(ctx: RequestContext, report: string, q: LeaveReportQueryDto) {
    if (!(LEAVE_REPORT_CODES as readonly string[]).includes(report))
      throw new DomainError('not-found', 'No such report', { status: 404 });
    const code = report as LeaveReport;
    const s = this.scope(code, q);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!(await this.mine(c, ctx)).includes(code))
        throw new DomainError('permission-denied', 'This report is not given to you', {
          status: 403,
        });
      const t = await this.build(c, code, s);
      const words = await this.words(c, code, s);
      const name = LEAVE_REPORT_DEFS[code].name;
      if (q.format) {
        if (t.rows.length > 20000) fail('More than 20,000 rows: narrow the filters');
        const me = (
          await c.query<{ id: string; name: string }>(
            `SELECT u.id::text, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.display_name) AS name
               FROM users u WHERE u.id = app.current_user_id()`,
          )
        ).rows[0];
        const read = (key: string) => this.storage.read(key);
        const signs = [
          await signerOf(c, read, {
            as: 'Prepared by',
            name: me?.name ?? null,
            userId: me?.id ?? null,
            at: new Date(),
            verb: 'Prepared on',
          }),
          blankBox('Checked by'),
          blankBox('Principal'),
        ];
        return leaveReportFile({
          format: q.format,
          head: await purchaseHead(c, this.storage),
          name,
          slug: `Leave-${code.replaceAll('_', '-')}`,
          words,
          table: t,
          signs,
        });
      }
      const LIMIT = 3000;
      return {
        report: code,
        name,
        words,
        filters: { ...s },
        columns: t.columns,
        rows: t.rows.slice(0, LIMIT),
        headings: (t.headings ?? []).filter((i) => i < LIMIT),
        strong: (t.strong ?? []).filter((i) => i < LIMIT),
        links: t.links?.slice(0, LIMIT) ?? null,
        kpis: t.kpis ?? null,
        note: t.note ?? null,
        more: t.rows.length > LIMIT,
        total: t.rows.length - (t.headings?.length ?? 0),
      };
    });
  }
}
