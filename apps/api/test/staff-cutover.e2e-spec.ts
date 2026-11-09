/**
 * Moving from the earlier leave module (docs/design/85, phase E): the old database as the workers read it
 * (staging rows written here), the preview rolled back, the set-up (types, policies, weekly offs, holidays,
 * shifts, postings, timings, who approves, settings, the reports' lists), the balances to the month before
 * the parallel month, this year's history (leave and its days, attendance kept as it was, late marks,
 * missing punches, corrections, locked months; brought again without doubling), the comparison of the
 * parallel month, and the switch: the leave and correction still waiting start at the first level.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const add = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const month = monthStart(today);
const prevMonth = monthStart(add(month, -1));
const fy =
  Number(today.slice(5, 7)) >= 4
    ? `${today.slice(0, 4)}-04-01`
    : `${String(Number(today.slice(0, 4)) - 1)}-04-01`;
/** weekdays of last month */
const PREV: string[] = [];
for (let d = prevMonth; d < month; d = add(d, 1)) if (dow(d) !== 0 && dow(d) !== 6) PREV.push(d);
/** a day of this month before today (none on the 1st) */
const thisMonthDay = today > month ? add(today, -1) : null;

describe('leave cut-over from the old module (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let office: SeededUser;
  let hod: SeededUser;
  let t1: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('CO');
  const code = (k: string) => `${s}${k}`;
  const call = (u: SeededUser, method: 'GET' | 'POST', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const q = <T>(sql: string, args: unknown[] = []) =>
    withMigrator((c) => c.query<T & Record<string, unknown>>(sql, args)).then((r) => r.rows);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      hod = await seedUser(c, school, `${s}-hod`, 'class_teacher');
      t1 = await seedUser(c, school, `${s}-t1`, 'subject_teacher');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(`SELECT app.staff_leave_seed($1)`, [school.id]);
      await c.query(
        `INSERT INTO departments (school_id, code, name, staff_group) VALUES ($1, 'science', 'Science', 'teaching')`,
        [school.id],
      );
      for (const [k, name, u] of [
        ['H1', 'Hema Head', hod.id],
        ['E1', 'Esha One', t1.id],
        ['E2', 'Eklavya Two', null],
        ['E3', 'Ekta Three', null],
      ] as const)
        ids[k] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, employee_type, gender, user_id)
             VALUES ($1, $2, $3, 'E2E', 'Teacher', 'Science', 'teaching', 'female', $4) RETURNING id::text`,
            [school.id, code(k), name, u],
          )
        ).rows[0]!.id;
      // the old database as the workers read it
      const rows: Array<[string, string, Record<string, unknown>]> = [];
      const base = { Status: 1, isTrash: 0, FinancialYear: '2026-2027' };
      rows.push(
        [
          'al_leave_type',
          '1',
          {
            ...base,
            srno: 1,
            LeaveCode: 'CL',
            LeaveName: 'Casual leave',
            IsPaid: 1,
            IsLossOfPay: 0,
            TrackBalance: 1,
            AllowHalfDay: 1,
            AccrualFrequency: 'M',
            AutoDeductPriority: 1,
            DisplayOrder: 1,
          },
        ],
        [
          'al_leave_type',
          '2',
          {
            ...base,
            srno: 2,
            LeaveCode: 'LWP',
            LeaveName: 'Leave without pay',
            IsPaid: 0,
            IsLossOfPay: 1,
            TrackBalance: 0,
            DisplayOrder: 9,
          },
        ],
        [
          'al_leave_type',
          '3',
          {
            ...base,
            srno: 3,
            LeaveCode: 'SPL',
            LeaveName: 'Special leave',
            IsPaid: 1,
            TrackBalance: 1,
            AccrualFrequency: 'Y',
            DisplayOrder: 5,
          },
        ],
        [
          'al_leave_policy',
          '1',
          {
            ...base,
            srno: 1,
            PolicyName: 'CL all',
            LeaveTypeId: 1,
            ScopeType: 'ALL',
            AnnualEntitlement: '12.00',
            IsAccrual: 1,
            AccrualFrequency: 'M',
            ProRataOnJoin: 1,
            Priority: 10,
          },
        ],
        [
          'al_leave_policy',
          '2',
          {
            ...base,
            srno: 2,
            PolicyName: 'SPL science',
            LeaveTypeId: 3,
            ScopeType: 'DEPARTMENT',
            ScopeValue: 'Science',
            AnnualEntitlement: '4.00',
            IsAccrual: 1,
            AccrualFrequency: 'Y',
            Priority: 5,
            IncludeWeeklyOff: 1,
          },
        ],
        [
          'al_leave_policy',
          '3',
          {
            ...base,
            srno: 3,
            PolicyName: 'Odd scope',
            LeaveTypeId: 1,
            ScopeType: 'CAMPUS',
            ScopeValue: 'North',
            AnnualEntitlement: '1.00',
          },
        ],
        [
          'al_weekoff_rule',
          '1',
          {
            ...base,
            srno: 1,
            RuleName: 'Sundays',
            ScopeType: 'ALL',
            WeekDays: '7',
            RuleKind: 'WEEKLY',
            Priority: 1,
          },
        ],
        [
          'al_weekoff_rule',
          '2',
          {
            ...base,
            srno: 2,
            RuleName: '2nd and 4th Saturday',
            ScopeType: 'ALL',
            WeekDays: '6',
            WeekNumbers: '2,4',
            RuleKind: 'WEEKLY',
            Priority: 2,
          },
        ],
        [
          'al_holiday_master',
          '1',
          {
            ...base,
            srno: 1,
            HolidayName: 'Founders day',
            HolidayDate: add(fy, 40),
            HolidayToDate: add(fy, 40),
            IsRestricted: 0,
          },
        ],
        [
          'al_shift_master',
          '1',
          {
            ...base,
            srno: 1,
            ShiftCode: 'GEN',
            ShiftName: 'General',
            ShiftType: 'DAY',
            StartTime: '08:00:00',
            EndTime: '14:30:00',
            GraceMinutes: 10,
            PresentHours: '6.00',
            HalfDayHours: '3.00',
            TotalHours: '6.50',
            SinglePunchDayType: 'A',
          },
        ],
        [
          'al_shift_master',
          '2',
          {
            ...base,
            srno: 2,
            ShiftCode: 'NIGHT1',
            ShiftName: 'Night watch',
            ShiftType: 'NIGHT',
            StartTime: '20:00:00',
            EndTime: '08:00:00',
            GraceMinutes: 5,
            PresentHours: '10.00',
            HalfDayHours: '5.00',
            TotalHours: '12.00',
            SinglePunchDayType: 'HD',
          },
        ],
        [
          'al_shift_assignment',
          '1',
          { ...base, srno: 1, EmpId: code('E2'), ShiftId: 2, EffectiveFrom: fy },
        ],
        [
          'al_dept_timing',
          '1',
          {
            ...base,
            srno: 1,
            Department: 'Science',
            StartTime: '08:30:00',
            EndTime: '14:30:00',
            PresentHours: '6.00',
            HalfDayHours: '3.00',
            GraceMinutes: 5,
          },
        ],
        [
          'al_emp_timing',
          '1',
          {
            ...base,
            srno: 1,
            EmpId: code('E1'),
            StartTime: '08:00:00',
            EndTime: '14:00:00',
            PresentHours: '5.50',
            HalfDayHours: '3.00',
            GraceMinutes: 0,
          },
        ],
        [
          'al_approval_matrix',
          '1',
          {
            ...base,
            srno: 1,
            RefType: 'LEAVE',
            ScopeType: 'ALL',
            LeaveTypeId: null,
            DayFrom: '0.00',
            DayTo: '365.00',
            ApprovalLevel: 1,
            ApproverEmpId: code('H1'),
            Priority: 10,
          },
        ],
        [
          'al_approval_matrix',
          '2',
          {
            ...base,
            srno: 2,
            RefType: 'REGULARIZATION',
            ScopeType: 'ALL',
            LeaveTypeId: null,
            DayFrom: '0.00',
            DayTo: '365.00',
            ApprovalLevel: 1,
            ApproverEmpId: code('H1'),
            Priority: 10,
          },
        ],
        [
          'al_approval_matrix',
          '3',
          {
            ...base,
            srno: 3,
            RefType: 'LEAVECANCEL',
            ScopeType: 'ALL',
            DayFrom: '0.00',
            DayTo: '365.00',
            ApprovalLevel: 1,
            ApproverEmpId: code('H1'),
            Priority: 10,
          },
        ],
        [
          'tbl_module_settings',
          'a|late',
          {
            page_url: 'Admin/AttendanceLeave/attendance_settings.php',
            setting_key: 'late_marks_per_leave',
            setting_value: '4',
          },
        ],
        [
          'tbl_module_settings',
          'a|forgot',
          {
            page_url: 'Admin/AttendanceLeave/attendance_settings.php',
            setting_key: 'forgot_punches_per_leave',
            setting_value: '5',
          },
        ],
        [
          'tbl_module_settings',
          'm|nr',
          {
            page_url: 'Admin/AttendanceLeave/mis_reports.php',
            setting_key: 'mis_not_required',
            setting_value: `${code('E3')}, NOBODY9`,
          },
        ],
        [
          'tbl_module_settings',
          'm|daily',
          {
            page_url: 'Admin/AttendanceLeave/mis_reports.php',
            setting_key: 'report_access_daily',
            setting_value: code('H1'),
          },
        ],
        // the balance ledger: last month closed; this month as the old module runs it (accruing monthly)
        [
          'al_leave_balance',
          '1',
          {
            ...base,
            srno: 1,
            EmpId: code('E1'),
            LeaveTypeId: 1,
            BalYear: Number(prevMonth.slice(0, 4)),
            BalMonth: Number(prevMonth.slice(5, 7)),
            OpeningBal: '5.00',
            Accrued: '1.00',
            Booked: '2.00',
            CorrectionBal: '0.00',
            ClosingBal: '4.00',
            LapsedBal: '0.00',
            IsClosed: 1,
          },
        ],
        [
          'al_leave_balance',
          '2',
          {
            ...base,
            srno: 2,
            EmpId: code('E1'),
            LeaveTypeId: 1,
            BalYear: Number(month.slice(0, 4)),
            BalMonth: Number(month.slice(5, 7)),
            OpeningBal: '4.00',
            Accrued: '1.00',
            Booked: '1.00',
            CorrectionBal: '0.00',
            ClosingBal: '0.00',
            LapsedBal: '0.00',
            IsClosed: 0,
          },
        ],
        [
          'al_leave_balance',
          '3',
          {
            ...base,
            srno: 3,
            EmpId: 'GONE7',
            LeaveTypeId: 1,
            BalYear: Number(prevMonth.slice(0, 4)),
            BalMonth: Number(prevMonth.slice(5, 7)),
            OpeningBal: '1.00',
            IsClosed: 1,
          },
        ],
        // leave: two days of CL last month (approved), a day this month still waiting, half a day charged for late marks
        [
          'al_leave_request',
          '1',
          {
            ...base,
            srno: 1,
            RequestNumber: 'LV/OLD/1',
            EmpId: code('E1'),
            LeaveTypeId: 1,
            FromDate: PREV[0],
            ToDate: PREV[1],
            NoOfDays: '2.00',
            IsHalfDay: 0,
            Reason: 'Family function',
            ReqStatus: 'Approved',
            Source: 'SELF',
            CreatedAt: `${PREV[0]} 09:00:00`,
            ClosedAt: `${PREV[0]} 12:00:00`,
          },
        ],
        [
          'al_leave_request_day',
          '1',
          {
            ...base,
            srno: 1,
            LeaveRequestId: 1,
            EmpId: code('E1'),
            LeaveDate: PREV[0],
            DayPortion: '1.00',
          },
        ],
        [
          'al_leave_request_day',
          '2',
          {
            ...base,
            srno: 2,
            LeaveRequestId: 1,
            EmpId: code('E1'),
            LeaveDate: PREV[1],
            DayPortion: '1.00',
          },
        ],
        [
          'al_leave_request',
          '2',
          {
            ...base,
            srno: 2,
            RequestNumber: 'LV/OLD/2',
            EmpId: code('E1'),
            LeaveTypeId: 1,
            FromDate: today,
            ToDate: today,
            NoOfDays: '1.00',
            IsHalfDay: 0,
            Reason: 'Doctor',
            ReqStatus: 'Pending',
            Source: 'SELF',
            CreatedAt: `${today} 08:00:00`,
          },
        ],
        [
          'al_leave_request_day',
          '3',
          {
            ...base,
            srno: 3,
            LeaveRequestId: 2,
            EmpId: code('E1'),
            LeaveDate: today,
            DayPortion: '1.00',
          },
        ],
        [
          'al_leave_request',
          '3',
          {
            ...base,
            srno: 3,
            RequestNumber: 'LV/OLD/3',
            EmpId: code('E2'),
            LeaveTypeId: 2,
            FromDate: PREV[2],
            ToDate: PREV[2],
            NoOfDays: '0.50',
            IsHalfDay: 1,
            HalfDaySession: 'FIRST',
            Reason: 'Late marks',
            ReqStatus: 'Approved',
            Source: 'AUTO_LATE',
            CreatedAt: `${PREV[2]} 23:00:00`,
          },
        ],
        [
          'al_leave_request_day',
          '4',
          {
            ...base,
            srno: 4,
            LeaveRequestId: 3,
            EmpId: code('E2'),
            LeaveDate: PREV[2],
            DayPortion: '0.50',
          },
        ],
        // last month's days as the old module had them
        [
          'al_attendance_daily',
          '1',
          { ...base, srno: 1, EmpId: code('E1'), AttDate: PREV[0], DayType: 'LV', LeaveTypeId: 1 },
        ],
        [
          'al_attendance_daily',
          '2',
          {
            ...base,
            srno: 2,
            EmpId: code('E1'),
            AttDate: PREV[2],
            DayType: 'P',
            InTime1: '08:05:00',
            OutTime1: '14:10:00',
            WorkedHours: '6.08',
            LateStatus: 1,
            LateMinutes: 5,
          },
        ],
        [
          'al_attendance_daily',
          '3',
          {
            ...base,
            srno: 3,
            EmpId: code('E1'),
            AttDate: PREV[3],
            DayType: 'HD',
            LeaveTypeId: 1,
            InTime1: '08:00:00',
            OutTime1: '11:00:00',
            WorkedHours: '3.00',
          },
        ],
        [
          'al_late_mark',
          '1',
          {
            ...base,
            srno: 1,
            EmpId: code('E1'),
            AttDate: PREV[2],
            InTime: '08:05:00',
            ShiftStartTime: '08:00:00',
            GraceMinutes: 0,
            LateMinutes: 5,
            LateStatus: 0,
            RollbackReason: 'Bus late',
          },
        ],
        [
          'al_forgot_punch',
          '1',
          {
            ...base,
            srno: 1,
            EmpId: code('E1'),
            AttDate: PREV[4],
            MissingSide: 'OUT',
            PunchStatus: 1,
          },
        ],
        [
          'al_month_lock',
          '1',
          {
            ...base,
            srno: 1,
            LockMonth: prevMonth.slice(0, 7),
            IsLocked: 1,
            LockedAt: `${month} 10:00:00`,
          },
        ],
      );
      if (thisMonthDay) {
        rows.push([
          'al_attendance_daily',
          '9',
          {
            ...base,
            srno: 9,
            EmpId: code('E1'),
            AttDate: thisMonthDay,
            DayType: 'P',
            InTime1: '08:00:00',
            OutTime1: '14:00:00',
            WorkedHours: '6.00',
          },
        ]);
        rows.push([
          'al_regularization',
          '1',
          {
            ...base,
            srno: 1,
            EmpId: code('E1'),
            AttDate: thisMonthDay,
            RequestedInTime: '08:00:00',
            Reason: 'Forgot to punch in',
            ReqStatus: 'Pending',
            CreatedAt: `${thisMonthDay} 18:00:00`,
          },
        ]);
      }
      for (const [tbl, id, p] of rows)
        await c.query(
          `INSERT INTO staff_legacy_rows (school_id, tbl, legacy_id, payload, read_id) VALUES ($1, $2, $3, $4::jsonb, 1)`,
          [school.id, tbl, id, JSON.stringify(p)],
        );
      await c.query(
        `INSERT INTO staff_cutover (school_id, parallel_month, freeze_on, read_at) VALUES ($1, $2::date, $3::date, now())`,
        [school.id, month, today],
      );
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('previews every step and keeps nothing', async () => {
    const o = (await call(office, 'GET', '/staff-cutover')).json();
    expect(o).toMatchObject({ status: 'setup', parallelMonth: month.slice(0, 7), started: true });
    expect(o.staged.al_leave_type).toBe(3);
    const p = (await call(office, 'GET', '/staff-cutover/preview')).json();
    const setup = p.steps.find((x: { step: string }) => x.step === 'setup');
    expect(setup.counts).toMatchObject({
      'leave types': 3,
      policies: 2,
      'weekly-off rules': 2,
      shifts: 2,
    });
    const whats = setup.problems.map((x: { what: string }) => x.what).join(' | ');
    expect(whats).toContain('credited monthly in the old module');
    expect(whats).toContain('a scope the old module had and this one does not');
    expect(whats).toContain('cancellation chains');
    expect(whats).toContain('Not required in the reports: an employee not found here');
    // the history step needs the balances first, but the preview runs them in order
    expect(p.steps.map((x: { step: string; ready: boolean }) => [x.step, x.ready])).toEqual([
      ['setup', true],
      ['balances', true],
      ['history', true],
    ]);
    expect(
      await q(`SELECT 1 FROM staff_leave_types WHERE school_id = $1 AND code = 'SPL'`, [school.id]),
    ).toHaveLength(0);
    expect((await call(office, 'POST', '/staff-cutover/steps/history')).statusCode).toBe(409);
    expect((await call(t1, 'GET', '/staff-cutover')).statusCode).toBe(403);
  });

  it('brings the set-up', async () => {
    const r = await call(office, 'POST', '/staff-cutover/steps/setup');
    expect(r.statusCode).toBe(201);
    const types = await q<{
      code: string;
      credit: string;
      keeps_balance: boolean;
      loss_of_pay: boolean;
    }>(
      `SELECT code, credit, keeps_balance, loss_of_pay FROM staff_leave_types WHERE school_id = $1 AND code IN ('CL', 'LWP', 'SPL') ORDER BY code`,
      [school.id],
    );
    expect(types).toEqual([
      { code: 'CL', credit: 'Q', keeps_balance: true, loss_of_pay: false },
      { code: 'LWP', credit: 'none', keeps_balance: false, loss_of_pay: true },
      { code: 'SPL', credit: 'Y', keeps_balance: true, loss_of_pay: false },
    ]);
    const pol = await q<{
      name: string;
      scope: string;
      scope_values: string[];
      by_attendance: boolean;
      sandwich_weekoff: boolean;
    }>(
      `SELECT name, scope, scope_values, by_attendance, sandwich_weekoff FROM staff_leave_policies WHERE school_id = $1 ORDER BY name`,
      [school.id],
    );
    expect(pol).toEqual([
      {
        name: 'CL all',
        scope: 'all',
        scope_values: [],
        by_attendance: true,
        sandwich_weekoff: false,
      },
      {
        name: 'SPL science',
        scope: 'department',
        scope_values: ['Science'],
        by_attendance: true,
        sandwich_weekoff: true,
      },
    ]);
    const wo = await q<{
      name: string;
      status: string;
      weekdays: number[];
      week_numbers: number[];
    }>(
      `SELECT name, status, weekdays, week_numbers FROM staff_weekoff_rules WHERE school_id = $1 ORDER BY name`,
      [school.id],
    );
    expect(wo).toEqual([
      { name: '2nd and 4th Saturday', status: 'active', weekdays: [6], week_numbers: [2, 4] },
      { name: 'Sunday weekly off', status: 'inactive', weekdays: [7], week_numbers: [] },
      { name: 'Sundays', status: 'active', weekdays: [7], week_numbers: [] },
    ]);
    expect(
      await q(
        `SELECT name FROM holidays WHERE school_id = $1 AND legacy_ref = 'old-leave:1' AND applies_to = 'employees'`,
        [school.id],
      ),
    ).toHaveLength(1);
    expect(
      (
        await q<{ kind: string }>(
          `SELECT kind FROM staff_shifts WHERE school_id = $1 AND code = 'NIGHT1'`,
          [school.id],
        )
      )[0]?.kind,
    ).toBe('night');
    expect(
      await q(`SELECT 1 FROM staff_shift_postings WHERE employee_id = $1 AND status = 'active'`, [
        ids.E2,
      ]),
    ).toHaveLength(1);
    const timings = await q<{ kind: string; note: string | null }>(
      `SELECT kind, note FROM staff_timings WHERE school_id = $1 ORDER BY kind`,
      [school.id],
    );
    expect(timings.map((t) => t.kind)).toEqual(['department', 'special']);
    expect(timings[1]!.note).toMatch(/Own timing in the old module/);
    const rules = await q<{ kind: string; bands: Array<{ levels: unknown[] }> }>(
      `SELECT kind, bands FROM staff_leave_approval_rules WHERE school_id = $1 ORDER BY kind`,
      [school.id],
    );
    expect(rules.map((x) => [x.kind, x.bands.map((b) => b.levels.length)])).toEqual([
      ['leave', [1, 1, 1]],
      ['regularisation', [1]],
    ]);
    expect(
      (
        await q<{ late: number; missing: number }>(
          `SELECT late_marks_per_leave AS late, missing_punches_per_leave AS missing FROM staff_leave_settings WHERE school_id = $1`,
          [school.id],
        )
      )[0],
    ).toEqual({ late: 4, missing: 5 });
    expect(
      await q(`SELECT 1 FROM staff_report_exclusions WHERE employee_id = $1`, [ids.E3]),
    ).toHaveLength(1);
    expect(
      await q(
        `SELECT 1 FROM staff_report_access WHERE school_id = $1 AND report = 'daily' AND user_id = $2`,
        [school.id, hod.id],
      ),
    ).toHaveLength(1);
    // again: the same rows, nothing doubled
    await call(office, 'POST', '/staff-cutover/steps/setup');
    expect(
      await q(`SELECT 1 FROM staff_leave_approval_rules WHERE school_id = $1`, [school.id]),
    ).toHaveLength(2);
    expect(await q(`SELECT 1 FROM staff_timings WHERE school_id = $1`, [school.id])).toHaveLength(
      2,
    );
  });

  it('brings the balances to the month before the parallel month, then the history', async () => {
    const b = (await call(office, 'POST', '/staff-cutover/steps/balances')).json();
    expect(b.counts['balance months']).toBe(prevMonth >= fy ? 1 : 0);
    expect(b.problems.map((x: { what: string }) => x.what)).toContain(
      'Balances: an employee not found here',
    );
    const bal = await q<{
      month: string;
      closing: string | null;
      opening: string;
      closed: boolean;
    }>(
      `SELECT month::text, closing::text, opening::text, closed FROM staff_leave_balances b JOIN staff_leave_types t ON t.id = b.leave_type_id
        WHERE b.employee_id = $1 AND t.code = 'CL' ORDER BY month`,
      [ids.E1],
    );
    if (prevMonth >= fy) {
      expect(bal.find((x) => x.month === prevMonth)).toMatchObject({
        closing: '4.00',
        closed: true,
      });
      expect(bal.find((x) => x.month === month)).toMatchObject({ opening: '4.00', closed: false });
    }
    expect((await call(office, 'GET', '/staff-cutover')).json().status).toBe('parallel');

    const h = (await call(office, 'POST', '/staff-cutover/steps/history')).json();
    expect(h.counts['leave brought']).toBe(3);
    const reqs = await q<{
      number: string;
      status: string;
      source: string;
      days: string;
      wf: string | null;
      n: number;
    }>(
      `SELECT r.number, r.status, r.source, r.days::text, r.workflow_instance_id::text AS wf,
              (SELECT count(*)::int FROM staff_leave_days d WHERE d.request_id = r.id) AS n
         FROM staff_leave_requests r WHERE r.school_id = $1 ORDER BY r.number`,
      [school.id],
    );
    expect(reqs).toEqual([
      { number: 'LV/OLD/1', status: 'approved', source: 'self', days: '2.00', wf: null, n: 2 },
      { number: 'LV/OLD/2', status: 'pending', source: 'self', days: '1.00', wf: null, n: 1 },
      { number: 'LV/OLD/3', status: 'approved', source: 'auto_late', days: '0.50', wf: null, n: 1 },
    ]);
    const days = await q<{
      day: string;
      day_type: string;
      leave_portion: string | null;
      manual: boolean;
      source: string;
      in_t: string | null;
    }>(
      `SELECT day::text, day_type, leave_portion::text, manual, source, to_char(in_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS in_t
         FROM staff_attendance_days WHERE employee_id = $1 AND day < $2::date ORDER BY day`,
      [ids.E1, month],
    );
    expect(days).toEqual([
      {
        day: PREV[0],
        day_type: 'LV',
        leave_portion: '1.00',
        manual: true,
        source: 'import',
        in_t: null,
      },
      {
        day: PREV[2],
        day_type: 'P',
        leave_portion: null,
        manual: true,
        source: 'import',
        in_t: '08:05',
      },
      // a half day with a leave type there is half a day of that leave here
      {
        day: PREV[3],
        day_type: 'LV',
        leave_portion: '0.50',
        manual: true,
        source: 'import',
        in_t: '08:00',
      },
    ]);
    // the day page shows where it came from, not "set by hand"
    const page = (
      await call(office, 'GET', `/staff-attendance/days/${ids.E1!}/${PREV[2]!}`)
    ).json();
    expect(page.row).toMatchObject({ manual: false });
    expect(page.row.how).toMatch(/old module/);
    expect(await q(`SELECT status FROM staff_late_marks WHERE employee_id = $1`, [ids.E1])).toEqual(
      [{ status: 'waived' }],
    );
    expect(
      await q(`SELECT status, missing FROM staff_missing_punches WHERE employee_id = $1`, [ids.E1]),
    ).toEqual([{ status: 'lapsed', missing: 'out' }]);
    expect(
      await q(`SELECT locked FROM staff_month_locks WHERE school_id = $1 AND month = $2::date`, [
        school.id,
        prevMonth,
      ]),
    ).toEqual(prevMonth >= fy ? [{ locked: true }] : []);
    // the waiting leave of this month holds its day
    expect(
      (
        await q<{ held: string }>(
          `SELECT b.held::text FROM staff_leave_balances b JOIN staff_leave_types t ON t.id = b.leave_type_id
          WHERE b.employee_id = $1 AND t.code = 'CL' AND b.month = $2::date`,
          [ids.E1, month],
        )
      )[0]?.held,
    ).toBe('1.00');
    // brought again (as each day of the parallel month): nothing doubles
    const again = (await call(office, 'POST', '/staff-cutover/steps/history')).json();
    expect(again.counts['leave brought'] ?? 0).toBe(0);
    expect(
      await q(`SELECT 1 FROM staff_leave_requests WHERE school_id = $1`, [school.id]),
    ).toHaveLength(3);
  });

  it('compares the parallel month, then switches: what waits starts at the first level', async () => {
    const cmp = (await call(office, 'GET', '/staff-cutover/compare')).json();
    // the old module accrues CL monthly, this one quarterly: the balance differs and says so
    const cl = cmp.balances.rows.find(
      (x: { code: string; type: string }) => x.code === code('E1') && x.type === 'CL',
    );
    expect(cl).toMatchObject({ old: 4 });
    if (thisMonthDay)
      expect(
        cmp.days.rows.some(
          (x: { code: string; old: string }) => x.code === code('E1') && x.old === 'P',
        ),
      ).toBe(true);
    // the switch: after the freeze and a read after it
    const sw = await call(office, 'POST', '/staff-cutover/switch');
    expect(sw.statusCode).toBe(201);
    expect(sw.json().started).toBe(1);
    expect(sw.json().regStarted).toBe(thisMonthDay ? 1 : 0);
    const waiting = (await call(hod, 'GET', '/leave/approvals')).json().rows;
    expect(waiting.map((r: { number: string }) => r.number)).toContain('LV/OLD/2');
    const o = (await call(office, 'GET', '/staff-cutover')).json();
    expect(o.status).toBe('switched');
    expect((await call(office, 'POST', '/staff-cutover/read')).statusCode).toBe(409);
    expect((await call(office, 'POST', '/staff-cutover/steps/history')).statusCode).toBe(409);
  });
});
