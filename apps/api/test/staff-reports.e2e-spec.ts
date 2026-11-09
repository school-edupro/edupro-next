/**
 * Staff leave & attendance reports (docs/design/85, phase D): every report opens for the reports right; the
 * month's figures (a half day half, half a day of leave half worked, loss of pay apart, a day not worked out
 * never absent); the card and register; the daily report; leave availed / deducted; balances; Excel and
 * PDF; a report given to one person; the "Not required" staff left out unless picked; the dashboard.
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
const prevMonth = monthStart(add(monthStart(today), -1));
const prevEnd = add(monthStart(today), -1);
/** weekdays of last month */
const PREV: string[] = [];
for (let d = prevMonth; d <= prevEnd; d = add(d, 1)) if (dow(d) !== 0 && dow(d) !== 6) PREV.push(d);
const SUNDAYS: string[] = [];
for (let d = prevMonth; d <= prevEnd; d = add(d, 1)) if (dow(d) === 0) SUNDAYS.push(d);
const ALL = [
  'daily',
  'in_out',
  'monthly_summary',
  'monthly_employee',
  'monthly_register',
  'card',
  'basic_work',
  'monthly_cumulative',
  'annual',
  'employee_yearly',
  'year_on_year',
  'late_arrival',
  'early_going',
  'forgot_punch',
  'leave_availed',
  'leave_deduction',
  'balance_as_on',
  'opening_closing',
];

describe('staff leave reports (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let office: SeededUser;
  let t1: SeededUser;
  let t2: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('SR');
  const call = (u: SeededUser, method: 'GET' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const rowOf = (r: { rows: unknown[][] }, code: string) => r.rows.find((x) => x.includes(code));

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      t1 = await seedUser(c, school, `${s}-t1`, 'subject_teacher');
      t2 = await seedUser(c, school, `${s}-t2`, 'subject_teacher');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(`SELECT app.staff_leave_seed($1)`, [school.id]);
      for (const [code, name, u] of [
        ['E1', 'Esha One', t1.id],
        ['E2', 'Eklavya Two', t2.id],
        ['E3', 'Ekta Three', null],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, employee_type, gender, user_id)
             VALUES ($1, $2, $3, 'E2E', 'Teacher', 'Science', 'teaching', 'female', $4) RETURNING id::text`,
            [school.id, `${s}${code}`, name, u],
          )
        ).rows[0]!.id;
      const types = await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM staff_leave_types WHERE school_id = $1`,
        [school.id],
      );
      for (const t of types.rows) ids[t.code] = t.id;
      // E1's last month: present (late 10), a half day, absent, half a day of CL, a day of loss of pay
      const day = (d: string, type: string, extra: Record<string, unknown> = {}) =>
        c.query(
          `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source, in_at, out_at, worked_hours,
                                              late_minutes, early_minutes, leave_type_id, leave_portion)
           VALUES ($1, $2, $3::date, $4, $5, ($3::date + $6::time) AT TIME ZONE 'Asia/Kolkata', ($3::date + $7::time) AT TIME ZONE 'Asia/Kolkata',
                   $8, $9, $10, $11, $12)`,
          [
            school.id,
            extra.emp ?? ids.E1,
            d,
            type,
            type === 'LV' ? 'leave' : 'punches',
            extra.in ?? null,
            extra.out ?? null,
            extra.worked ?? null,
            extra.late ?? 0,
            extra.early ?? 0,
            extra.typeId ?? null,
            extra.portion ?? null,
          ],
        );
      await day(PREV[0]!, 'P', { in: '08:10', out: '15:30', worked: 7.33, late: 10 });
      await day(PREV[1]!, 'HD', { in: '08:00', out: '12:00', worked: 4, early: 210 });
      await day(PREV[2]!, 'A');
      await day(PREV[3]!, 'LV', {
        typeId: ids.CL,
        portion: 0.5,
        in: '08:00',
        out: '11:00',
        worked: 3,
      });
      await day(PREV[4]!, 'LV', { typeId: ids.LOP, portion: 1 });
      await day(PREV[0]!, 'P', { emp: ids.E3, in: '08:00', out: '15:30', worked: 7.5 });
      await c.query(
        `INSERT INTO staff_late_marks (school_id, employee_id, day, in_at, starts_at, grace, late_minutes)
         VALUES ($1, $2, $3::date, ($3::date + time '08:10') AT TIME ZONE 'Asia/Kolkata', '08:00', 0, 10)`,
        [school.id, ids.E1, PREV[0]],
      );
      await c.query(
        `INSERT INTO staff_missing_punches (school_id, employee_id, day, missing) VALUES ($1, $2, $3::date, 'out')`,
        [school.id, ids.E1, PREV[2]],
      );
      // leave: half a day of CL (approved) and a day the system charged for late marks
      for (const [n, typeId, from, days, source, half] of [
        ['1', ids.CL, PREV[3], 0.5, 'self', true],
        ['2', ids.LOP, PREV[4], 1, 'auto_late', false],
      ] as const) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO staff_leave_requests (school_id, number, employee_id, leave_type_id, from_date, to_date, days, half_day, session,
                                             reason, status, source, held_month, created_at)
           VALUES ($1, $2, $3, $4, $5::date, $5::date, $6, $7, $8, 'Family', 'approved', $9, $10::date,
                   ($5::date + time '09:00') AT TIME ZONE 'Asia/Kolkata') RETURNING id::text`,
          [
            school.id,
            `LV/${s}/${n}`,
            ids.E1,
            typeId,
            from,
            days,
            half,
            half ? 'second' : null,
            source,
            prevMonth,
          ],
        );
        await c.query(
          `INSERT INTO staff_leave_days (school_id, request_id, employee_id, day, portion, session, status)
           VALUES ($1, $2, $3, $4::date, $5, $6, 'approved')`,
          [school.id, r.rows[0]!.id, ids.E1, from, days, half ? 'second' : null],
        );
      }
      await c.query(
        `INSERT INTO staff_leave_balances (school_id, employee_id, leave_type_id, month, opening, credited, held)
         VALUES ($1, $2, $3, $4::date, 5, 1, 0.5)`,
        [school.id, ids.E1, ids.CL, prevMonth],
      );
      await c.query(
        `INSERT INTO staff_report_exclusions (school_id, employee_id, reason) VALUES ($1, $2, 'Management')`,
        [school.id, ids.E3],
      );
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('every report opens for the leave office, on screen, in Excel and as a PDF', async () => {
    const cat = (await call(office, 'GET', '/leave-reports/catalogue')).json();
    expect(cat.reports.map((r: { code: string }) => r.code)).toEqual(ALL);
    const month = prevMonth.slice(0, 7);
    const q = (r: string) =>
      ['daily', 'in_out'].includes(r)
        ? `day=${PREV[0]!}`
        : [
              'basic_work',
              'late_arrival',
              'early_going',
              'forgot_punch',
              'leave_availed',
              'leave_deduction',
              'annual',
            ].includes(r)
          ? `from=${prevMonth}&to=${[prevEnd, add(prevMonth, 30)].sort()[0]!}`
          : ['employee_yearly', 'opening_closing'].includes(r)
            ? `fromMonth=${month}&toMonth=${month}`
            : r === 'balance_as_on'
              ? `day=${prevEnd}`
              : `month=${month}`;
    for (const r of ALL) {
      const res = await call(office, 'GET', `/leave-reports/reports/${r}?${q(r)}`);
      expect([r, res.statusCode]).toEqual([r, 200]);
      expect(res.json().columns.length).toBeGreaterThan(2);
    }
    for (const r of ['daily', 'card', 'monthly_register', 'monthly_cumulative', 'opening_closing'])
      for (const format of ['xlsx', 'pdf']) {
        const f = await call(office, 'GET', `/leave-reports/reports/${r}?${q(r)}&format=${format}`);
        expect([r, format, f.statusCode]).toEqual([r, format, 200]);
        expect(f.json().filename).toMatch(
          new RegExp(`^Leave-${r.replaceAll('_', '-')}-.*\\.${format}$`),
        );
        expect(f.json().base64.length).toBeGreaterThan(500);
      }
    // a period too long is refused, not cut
    expect(
      (
        await call(
          office,
          'GET',
          `/leave-reports/reports/early_going?from=${prevMonth}&to=${today}`,
        )
      ).statusCode,
    ).toBe(today > add(prevMonth, 30) ? 400 : 200);
  });

  it('the month: a half day half, half a day of leave half worked, loss of pay apart, never absent unless marked', async () => {
    const r = (
      await call(
        office,
        'GET',
        `/leave-reports/reports/monthly_summary?month=${prevMonth.slice(0, 7)}`,
      )
    ).json();
    const cols: string[] = r.columns.map((c: { label: string }) => c.label);
    const e1 = rowOf(r, `${s}E1`)!;
    const v = (label: string) => e1[cols.indexOf(label)];
    expect([v('Present'), v('Half day'), v('Absent'), v('Paid leave'), v('Loss of pay')]).toEqual([
      1, 1, 1, 0.5, 1,
    ]);
    expect(v('Weekly off')).toBe(SUNDAYS.length);
    expect(v('Late marks')).toBe(1);
    expect(v('Missing punches')).toBe(1);
    // the weekdays and Saturdays nobody worked out are "not marked", not absent
    const days = Number(prevEnd.slice(8, 10));
    expect(v('Not marked')).toBe(days - SUNDAYS.length - 5);
    expect(v('Working days')).toBe(days - SUNDAYS.length);
    // (1 + 0.5 + the worked half of the half CL + 0.5 paid leave) ÷ working days
    expect(v('Attendance %')).toBe(Math.round((2.5 / (days - SUNDAYS.length)) * 1000) / 10);
    // the "Not required" employee is left out, unless picked
    expect(rowOf(r, `${s}E3`)).toBeUndefined();
    const picked = (
      await call(
        office,
        'GET',
        `/leave-reports/reports/monthly_summary?month=${prevMonth.slice(0, 7)}&employeeId=${ids.E3!}`,
      )
    ).json();
    expect(rowOf(picked, `${s}E3`)).toBeDefined();
  });

  it('the card, the register and the daily report', async () => {
    const card = (
      await call(
        office,
        'GET',
        `/leave-reports/reports/card?month=${prevMonth.slice(0, 7)}&employeeId=${ids.E1!}`,
      )
    ).json();
    expect(card.headings).toEqual([0, 1]);
    expect(card.rows[0][0]).toMatch(new RegExp(`^${s}E1 · Esha One`));
    expect(card.rows[1][0]).toMatch(/^Present 2 · Absent 1 · Leave 0\.5 · Loss of pay 1/);
    const reg = (
      await call(
        office,
        'GET',
        `/leave-reports/reports/monthly_register?month=${prevMonth.slice(0, 7)}`,
      )
    ).json();
    const status = rowOf(reg, `${s}E1`)!;
    expect(status).toContain('P·L');
    expect(status).toContain('CL½');
    expect(status).toContain('LOP');
    const daily = (
      await call(office, 'GET', `/leave-reports/reports/daily?day=${PREV[0]!}`)
    ).json();
    const d1 = rowOf(daily, `${s}E1`)!;
    expect(d1.slice(5, 9)).toEqual(['08:10', '15:30', 'P', 10]);
    expect(daily.kpis.find((k: { label: string }) => k.label === 'Late').value).toBe(1);
    expect(rowOf(daily, `${s}E3`)).toBeUndefined();
  });

  it('leave availed and deducted, the balance as on a date', async () => {
    const period = `from=${prevMonth}&to=${prevEnd}`;
    const availed = (
      await call(office, 'GET', `/leave-reports/reports/leave_availed?${period}`)
    ).json();
    expect(availed.rows.map((r: unknown[]) => r[0]).sort()).toEqual([`LV/${s}/1`, `LV/${s}/2`]);
    const ded = (
      await call(office, 'GET', `/leave-reports/reports/leave_deduction?${period}`)
    ).json();
    expect(ded.rows).toHaveLength(1);
    expect(ded.rows[0][4]).toBe('Late marks');
    const bal = (
      await call(
        office,
        'GET',
        `/leave-reports/reports/balance_as_on?day=${prevEnd}&typeId=${ids.CL!}`,
      )
    ).json();
    const cl = rowOf(bal, `${s}E1`)!;
    // opening 5 + credited 1 − taken 0.5
    expect(cl.slice(5, 9)).toEqual([5, 1, 0, 0.5]);
  });

  it('a report given to one person; the others stay closed; the dashboard', async () => {
    expect((await call(t1, 'GET', '/leave-reports/catalogue')).json().reports).toEqual([]);
    expect((await call(t1, 'GET', `/leave-reports/reports/daily?day=${PREV[0]!}`)).statusCode).toBe(
      403,
    );
    expect(
      (await call(office, 'PUT', '/leave-reports/access/daily', { userIds: [t1.id] })).statusCode,
    ).toBe(200);
    expect(
      (await call(t1, 'GET', '/leave-reports/catalogue'))
        .json()
        .reports.map((r: { code: string }) => r.code),
    ).toEqual(['daily']);
    expect((await call(t1, 'GET', `/leave-reports/reports/daily?day=${PREV[0]!}`)).statusCode).toBe(
      200,
    );
    expect((await call(t1, 'GET', '/leave-reports/mine')).json()).toEqual({ reports: 1 });
    expect(
      (
        await call(
          t1,
          'GET',
          `/leave-reports/reports/monthly_summary?month=${prevMonth.slice(0, 7)}`,
        )
      ).statusCode,
    ).toBe(403);
    expect((await call(t2, 'GET', `/leave-reports/reports/daily?day=${PREV[0]!}`)).statusCode).toBe(
      403,
    );
    const acc = (await call(office, 'GET', '/leave-reports/access')).json();
    expect(acc.reports.find((r: { code: string }) => r.code === 'daily').people).toEqual([
      expect.objectContaining({ id: t1.id }),
    ]);
    expect((await call(t1, 'PUT', '/leave-reports/access/daily', { userIds: [] })).statusCode).toBe(
      403,
    );
    expect((await call(t1, 'GET', '/leave-reports/dashboard')).statusCode).toBe(403);
    const dash = (await call(office, 'GET', '/leave-reports/dashboard')).json();
    // E1 and E2; E3 is not required
    expect(dash.figures.staff).toBe(2);
  });
});
