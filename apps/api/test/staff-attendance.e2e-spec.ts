/**
 * Staff attendance (docs/design/85, phase C): the day from its punches (grace, late, half day, one punch,
 * the double tap), a weekly off worked, the nightly marking (weekly offs, holidays, absent, late marks,
 * missing punches), leave on the register, the employee's correction through its approver, the office's
 * correction, the month's deductions, the payroll lock (unexplained absence → loss of pay), the shift's
 * late rule (half a day charged once), a night shift, a department timing, the punch upload, the register.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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
/** the weekdays before today, newest first (Saturday and Sunday are off here) */
const PAST: string[] = [];
for (let d = add(today, -1); PAST.length < 16; d = add(d, -1))
  if (dow(d) !== 0 && dow(d) !== 6) PAST.push(d);
const lastSaturday = (() => {
  let d = add(today, -1);
  while (dow(d) !== 6) d = add(d, -1);
  return d;
})();
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const prevMonth = monthStart(add(monthStart(today), -1));
/** two months ago: the payroll lock's month (its loss of pay touches no other test's days) */
const oldMonth = monthStart(add(prevMonth, -1));
const OLD: string[] = [];
for (let d = oldMonth; d < prevMonth; d = add(d, 1)) if (dow(d) !== 0 && dow(d) !== 6) OLD.push(d);
/** weekdays of last month */
const PREV: string[] = [];
for (let d = prevMonth; d < monthStart(today); d = add(d, 1))
  if (dow(d) !== 0 && dow(d) !== 6) PREV.push(d);

describe('staff attendance (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let office: SeededUser;
  let hod: SeededUser;
  let t1: SeededUser;
  let t2: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('SA');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const punch = (code: string, day: string, ...times: string[]) =>
    withMigrator(async (c) => {
      for (const t of times)
        await c.query(
          `INSERT INTO staff_punches (school_id, code, punched_at, source, device)
           VALUES ($1, $2, ($3::date + $4::time) AT TIME ZONE 'Asia/Kolkata', 'manual', 'test')`,
          [school.id, code, day, t],
        );
    });
  const dayOf = (u: SeededUser, emp: string, day: string) =>
    call(u, 'GET', `/staff-attendance/days/${emp}/${day}`).then((r) => r.json());
  const run = (what: string, extra: Record<string, unknown> = {}) =>
    call(office, 'POST', '/staff-attendance/run', { what, ...extra }).then((r) => r.json());

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      hod = await seedUser(c, school, `${s}-hod`, 'class_teacher');
      t1 = await seedUser(c, school, `${s}-t1`, 'subject_teacher');
      t2 = await seedUser(c, school, `${s}-t2`, 'subject_teacher');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(
        `INSERT INTO departments (school_id, code, name, staff_group) VALUES ($1, 'science', 'Science', 'teaching')`,
        [school.id],
      );
      for (const [code, name, u] of [
        ['H1', 'Hari Head', hod],
        ['T1', 'Tara Teacher', t1],
        ['T2', 'Tarun Teacher', t2],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, employee_type, gender, user_id)
             VALUES ($1, $2, $3, 'E2E', 'Staff', 'Science', 'teaching', 'female', $4) RETURNING id::text`,
            [school.id, `${s}${code}`, name, u.id],
          )
        ).rows[0]!.id;
      await c.query(
        `UPDATE departments SET hod_employee_id = $2 WHERE school_id = $1 AND name = 'Science'`,
        [school.id, ids.H1],
      );
    });
    app = await createApp();
    inject = injector(app);
    await call(office, 'GET', '/leave/setup/overview');
    await withMigrator((c) =>
      c.query(`UPDATE staff_weekoff_rules SET weekdays = '{6,7}' WHERE school_id = $1`, [
        school.id,
      ]),
    );
    const types = (await call(office, 'GET', '/masters/staff_leave_types/rows?size=50')).json()
      .data;
    for (const t of types as Array<{ code: string; id: string }>) ids[t.code] = t.id;
    await call(office, 'POST', '/masters/staff_leave_policies/rows', {
      values: { name: 'CL all', leave_type_id: 'CL', scope: 'all', annual_days: 12, credit: 'H' },
    });
    for (const kind of ['leave', 'regularisation']) {
      const r = (
        await call(office, 'POST', '/leave/setup/approvals', {
          kind,
          name: `All ${kind}`,
          scope: 'all',
        })
      ).json();
      await call(office, 'PUT', `/leave/setup/approvals/${r.id}/bands/0`, {
        levels: [{ name: 'HOD', by: 'hod', employeeIds: [] }],
      });
    }
    await call(office, 'POST', '/leave/balances/adjust', {
      employeeId: ids.T1,
      leaveTypeId: ids.CL,
      days: 2,
      reason: 'Opening',
    });
    // no automatic loss of pay in the nightly run here (tested with the month's lock)
    const st = (await call(office, 'GET', '/leave/setup/settings')).json().settings;
    delete st.updatedAt;
    expect(
      (await call(office, 'PUT', '/leave/setup/settings', { ...st, lopAfterDays: 60 })).statusCode,
    ).toBe(200);
    ids.GEN = (
      await withMigrator((c) =>
        c.query<{ id: string }>(
          `SELECT id::text FROM staff_shifts WHERE school_id = $1 AND code = 'GEN'`,
          [school.id],
        ),
      )
    ).rows[0]!.id;
  });
  afterAll(async () => {
    if (app) await app.close();
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
  });

  it('works a day out from its punches: on time, late after the grace, half a day, one punch, a double tap', async () => {
    const T1 = `${s}T1`;
    await punch(T1, PAST[0]!, '08:03', '15:40');
    await punch(T1, PAST[1]!, '08:20', '15:35');
    await punch(T1, PAST[2]!, '08:00', '11:30');
    await punch(T1, PAST[3]!, '08:00');
    await punch(T1, PAST[4]!, '08:00', '08:04');
    expect((await run('sync')).n).toBeGreaterThanOrEqual(5);
    const d0 = await dayOf(office, ids.T1!, PAST[0]!);
    expect(d0.row).toMatchObject({ dayType: 'P', in: '08:03', out: '15:40', late: 0 });
    expect(d0.row.how).toContain('Shift GEN 08:00–15:30');
    const d1 = (await dayOf(office, ids.T1!, PAST[1]!)).row;
    expect(d1).toMatchObject({ dayType: 'P', late: 15 });
    expect((await dayOf(office, ids.T1!, PAST[2]!)).row.dayType).toBe('HD');
    const d3 = (await dayOf(office, ids.T1!, PAST[3]!)).row;
    expect(d3).toMatchObject({ dayType: 'A', in: '08:00', out: null });
    expect(d3.remark).toContain('One punch');
    // a second punch four minutes after the first is a double tap: still one punch
    expect((await dayOf(office, ids.T1!, PAST[4]!)).row.out).toBeNull();
    // a weekly off worked keeps its punches
    await punch(T1, lastSaturday, '09:00', '13:00');
    await run('sync');
    expect((await dayOf(office, ids.T1!, lastSaturday)).row).toMatchObject({
      dayType: 'WO',
      in: '09:00',
      out: '13:00',
    });
  });

  it('the nightly run marks weekly offs, holidays and absences, and finds late marks and missing punches', async () => {
    await withMigrator(async (c) => {
      const y = (
        await c.query<{ id: string }>(`SELECT id::text FROM academic_years WHERE school_id = $1`, [
          school.id,
        ])
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO holidays (school_id, academic_year_id, name, kind, starts_on, ends_on, applies_to)
         VALUES ($1, $2, 'Founders day', 'holiday', $3::date, $3::date, 'everyone')`,
        [school.id, y, PAST[5]],
      );
      // last month is left alone by the nightly deductions here (tested on its own)
      await c.query(
        `INSERT INTO staff_attendance_runs (school_id, kind, month) VALUES ($1, 'late', $2), ($1, 'missing', $2)`,
        [school.id, prevMonth],
      );
    });
    expect((await run('nightly')).n).toBeGreaterThan(0);
    expect((await dayOf(office, ids.T2!, PAST[6]!)).row).toMatchObject({
      dayType: 'A',
      source: 'absent',
    });
    expect((await dayOf(office, ids.T2!, PAST[5]!)).row).toMatchObject({
      dayType: 'H',
      remark: 'Founders day',
    });
    expect((await dayOf(office, ids.T2!, lastSaturday)).row.dayType).toBe('WO');
    const ex = (
      await call(
        office,
        'GET',
        `/staff-attendance/exceptions?kind=late&month=${PAST[1]!.slice(0, 7)}`,
      )
    ).json();
    expect(
      ex.rows.find(
        (r: { day: string; employee_id: string }) => r.day === PAST[1] && r.employee_id === ids.T1,
      ),
    ).toMatchObject({ status: 'pending' });
    const mp = (
      await call(
        office,
        'GET',
        `/staff-attendance/exceptions?kind=missing&month=${PAST[3]!.slice(0, 7)}`,
      )
    ).json();
    expect(
      mp.rows.some(
        (r: { day: string; employee_id: string }) => r.day === PAST[3] && r.employee_id === ids.T1,
      ),
    ).toBe(true);
  });

  it('leave shows on the register (the punches kept) and comes off when cancelled', async () => {
    const r = (
      await call(t1, 'POST', '/leave/apply', {
        leaveTypeId: ids.CL,
        from: PAST[0],
        to: PAST[0],
        reason: 'Family work',
      })
    ).json();
    expect(r.status).toBe('pending');
    await call(hod, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'approved' });
    const lv = (await dayOf(office, ids.T1!, PAST[0]!)).row;
    expect(lv).toMatchObject({ dayType: 'LV', leave: 'CL', in: '08:03' });
    await call(office, 'POST', `/leave/requests/${r.id}/cancel`, { reason: 'Came to school' });
    expect((await dayOf(office, ids.T1!, PAST[0]!)).row).toMatchObject({
      dayType: 'P',
      in: '08:03',
    });
  });

  it('a correction the employee asks for: the approver decides, the day is set, the missing punch retired', async () => {
    const ask = await call(t1, 'POST', '/staff-attendance/regularisations', {
      day: PAST[3],
      out: '15:35',
      reason: 'Forgot to punch out',
    });
    expect(ask.statusCode).toBe(201);
    const id = ask.json().id;
    expect(
      (
        await call(t1, 'POST', '/staff-attendance/regularisations', {
          day: PAST[3],
          out: '15:30',
          reason: 'Again',
        })
      ).statusCode,
    ).toBe(409);
    const w = (await call(hod, 'GET', '/staff-attendance/regularisations/approvals')).json();
    expect(w.rows.map((x: { id: string }) => x.id)).toContain(id);
    // the approver opens the day and may decide it there; a colleague who is neither may not open it
    const seen = await call(hod, 'GET', `/staff-attendance/days/${ids.T1!}/${PAST[3]!}`);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().can).toMatchObject({
      mine: false,
      decide: id,
      correct: false,
      regularise: false,
    });
    expect(
      (await call(t2, 'GET', `/staff-attendance/days/${ids.T1!}/${PAST[3]!}`)).statusCode,
    ).toBe(404);
    expect(
      (
        await call(t1, 'POST', `/staff-attendance/regularisations/${id}/decide`, {
          outcome: 'approved',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(hod, 'POST', `/staff-attendance/regularisations/${id}/decide`, {
          outcome: 'approved',
        })
      ).json().status,
    ).toBe('approved');
    const d = (await dayOf(t1, ids.T1!, PAST[3]!)).row;
    expect(d).toMatchObject({
      dayType: 'P',
      in: '08:00',
      out: '15:35',
      manual: true,
      source: 'regularisation',
    });
    const mp = (
      await call(
        office,
        'GET',
        `/staff-attendance/exceptions?kind=missing&month=${PAST[3]!.slice(0, 7)}`,
      )
    ).json();
    expect(
      mp.rows.find(
        (r: { day: string; employee_id: string }) => r.day === PAST[3] && r.employee_id === ids.T1,
      ).status,
    ).toBe('retired');
    // the punches no longer change a day set by a person
    await withMigrator((c) =>
      c.query(`UPDATE staff_punches SET read = false WHERE school_id = $1`, [school.id]),
    );
    await run('sync');
    expect((await dayOf(t1, ids.T1!, PAST[3]!)).row.out).toBe('15:35');
    // my month; another employee's day is not mine to see
    const mine = (
      await call(t1, 'GET', `/staff-attendance/mine?month=${PAST[3]!.slice(0, 7)}`)
    ).json();
    expect(mine.days.some((x: { day: string }) => x.day === PAST[3])).toBe(true);
    expect(
      (await call(t1, 'GET', `/staff-attendance/days/${ids.T2!}/${PAST[3]!}`)).statusCode,
    ).toBe(404);
  });

  it('the office corrects a day; the month is locked (absence becomes loss of pay), then unlocked with a reason', async () => {
    const c1 = await call(office, 'POST', '/staff-attendance/days', {
      employeeId: ids.T2,
      day: PAST[6],
      in: '08:00',
      out: '15:30',
      reason: 'Device down',
    });
    expect(c1.statusCode).toBe(201);
    expect((await dayOf(office, ids.T2!, PAST[6]!)).row).toMatchObject({
      dayType: 'P',
      manual: true,
      worked: 7.5,
    });
    await withMigrator((c) =>
      c.query(
        `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source) VALUES ($1, $2, $3::date, 'A', 'absent')
         ON CONFLICT (employee_id, day) DO UPDATE SET day_type = 'A', source = 'absent', manual = false, leave_type_id = NULL`,
        [school.id, ids.T2, OLD[0]],
      ),
    );
    const lock = (
      await call(office, 'POST', '/staff-attendance/lock', { month: oldMonth.slice(0, 7) })
    ).json();
    expect(lock.locked).toBe(true);
    expect(lock.lossOfPay).toBeGreaterThanOrEqual(1);
    expect((await dayOf(office, ids.T2!, OLD[0]!)).row).toMatchObject({
      dayType: 'LV',
      leave: 'LOP',
    });
    const refused = await call(office, 'POST', '/staff-attendance/days', {
      employeeId: ids.T2,
      day: OLD[1],
      dayType: 'P',
      reason: 'x y z',
    });
    expect(refused.statusCode).toBe(409);
    expect(
      (await call(office, 'POST', '/staff-attendance/lock', { month: today.slice(0, 7) }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(office, 'POST', '/staff-attendance/unlock', {
          month: oldMonth.slice(0, 7),
          reason: '',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(office, 'POST', '/staff-attendance/unlock', {
          month: oldMonth.slice(0, 7),
          reason: 'Payroll redone',
        })
      ).json().locked,
    ).toBe(false);
  });

  it('a month’s late marks: every three a day of leave on the first of them, the rest lapse', async () => {
    await withMigrator(async (c) => {
      await c.query(`DELETE FROM staff_attendance_runs WHERE school_id = $1 AND month = $2`, [
        school.id,
        prevMonth,
      ]);
      for (const d of PREV.slice(1, 5))
        await c.query(
          `INSERT INTO staff_late_marks (school_id, employee_id, day, in_at, starts_at, grace, late_minutes)
           VALUES ($1, $2, $3::date, ($3::date + time '08:30') AT TIME ZONE 'Asia/Kolkata', '08:00', 5, 25)`,
          [school.id, ids.T1, d],
        );
    });
    await call(office, 'POST', '/leave/balances/adjust', {
      employeeId: ids.T1,
      leaveTypeId: ids.CL,
      days: 3,
      reason: 'More',
    });
    const before = (await call(office, 'GET', `/leave/balances?employeeId=${ids.T1!}`))
      .json()
      .rows.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'CL').available;
    expect((await run('deduct', { month: prevMonth.slice(0, 7) })).n).toBe(1);
    const marks = (
      await call(
        office,
        'GET',
        `/staff-attendance/exceptions?kind=late&month=${prevMonth.slice(0, 7)}`,
      )
    )
      .json()
      .rows.filter((r: { employee_id: string }) => r.employee_id === ids.T1);
    expect(marks.filter((m: { status: string }) => m.status === 'used')).toHaveLength(3);
    expect(marks.filter((m: { status: string }) => m.status === 'lapsed')).toHaveLength(1);
    const used = marks.find((m: { status: string; leave: string | null }) => m.status === 'used');
    expect(used.leave).toMatch(/^LV\//);
    const after = (await call(office, 'GET', `/leave/balances?employeeId=${ids.T1!}`))
      .json()
      .rows.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'CL').available;
    expect(after).toBe(before - 1);
    // once a month
    expect((await run('deduct', { month: prevMonth.slice(0, 7) })).n).toBe(0);
  });

  it('the shift’s late rule: a day late past the minutes is a half day, half a day charged once', async () => {
    await withMigrator((c) =>
      c.query(`UPDATE staff_shifts SET late_over_minutes = 60, late_action = 'HD' WHERE id = $1`, [
        ids.GEN,
      ]),
    );
    await punch(`${s}T2`, PAST[7]!, '09:30', '16:40');
    await run('sync');
    expect((await dayOf(office, ids.T2!, PAST[7]!)).row).toMatchObject({ dayType: 'HD', late: 85 });
    await run('recompute', { from: PAST[7], to: PAST[7] });
    const charged = await withMigrator((c) =>
      c.query<{ days: string; code: string }>(
        `SELECT r.days::text, t.code FROM staff_leave_requests r JOIN staff_leave_types t ON t.id = r.leave_type_id
          WHERE r.employee_id = $1 AND r.source = 'auto_rule' AND r.from_date = $2::date`,
        [ids.T2, PAST[7]],
      ),
    );
    expect(charged.rows).toEqual([{ days: '0.50', code: 'LOP' }]);
    await withMigrator((c) =>
      c.query(
        `UPDATE staff_shifts SET late_over_minutes = NULL, late_action = 'none' WHERE id = $1`,
        [ids.GEN],
      ),
    );
  });

  it('a night shift takes the next morning’s OUT; a department timing changes the hours', async () => {
    await withMigrator(async (c) => {
      const n = (
        await c.query<{ id: string }>(
          `INSERT INTO staff_shifts (school_id, code, name, kind, starts_at, ends_at, present_hours, half_day_hours, total_hours)
           VALUES ($1, 'NIGHT', 'Night', 'night', '22:00', '06:00', 7, 3.5, 8) RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO staff_shift_postings (school_id, employee_id, shift_id, from_date, to_date) VALUES ($1, $2, $3, $4::date, $4::date)`,
        [school.id, ids.H1, n, PAST[8]],
      );
    });
    await punch(`${s}H1`, PAST[8]!, '22:02');
    await punch(`${s}H1`, add(PAST[8]!, 1), '06:05');
    await run('sync');
    expect((await dayOf(office, ids.H1!, PAST[8]!)).row).toMatchObject({
      dayType: 'P',
      in: '22:02',
      out: '06:05',
    });
    // Science works 07:00 to 13:00 (present 5 h): a 6-hour day is present
    const t = await call(office, 'POST', '/staff-attendance/timings', {
      kind: 'department',
      department: 'Science',
      startsAt: '07:00',
      endsAt: '13:00',
      grace: 5,
      presentHours: 5,
      halfDayHours: 2.5,
    });
    expect(t.statusCode).toBe(201);
    await punch(`${s}H1`, PAST[9]!, '07:00', '12:10');
    await run('sync');
    const d = (await dayOf(office, ids.H1!, PAST[9]!)).row;
    expect(d.dayType).toBe('P');
    expect(d.how).toContain('Department timing');
    expect((await call(t1, 'GET', '/staff-attendance/timings')).statusCode).toBe(403);
  });

  it('bulk edit of special timings: only the ticked fields; existing only, or the whole department made', async () => {
    const [from, to] = ['2027-03-01', '2027-03-05'];
    const one = await call(office, 'POST', '/staff-attendance/timings', {
      kind: 'special',
      employeeId: ids.T1,
      from,
      to,
      startsAt: '08:00',
      endsAt: '14:00',
      grace: 10,
      presentHours: 6,
      halfDayHours: 3,
      note: 'Exam duty',
    });
    expect(one.statusCode).toBe(201);
    const bulk = (body: Record<string, unknown>) =>
      call(office, 'POST', '/staff-attendance/timings/bulk', { from, to, ...body });
    const mine = async (emp: string) =>
      (await call(office, 'GET', '/staff-attendance/timings'))
        .json()
        .rows.filter(
          (r: { employee_id: string; from_date: string }) =>
            r.employee_id === emp && r.from_date === from,
        );
    // the check: who changes, who would be made, what they hold now
    const a = (await bulk({ scope: 'existing', department: 'Science', dryRun: true })).json();
    expect(a).toMatchObject({ change: 1, create: 0, saved: 0 });
    expect(a.current.grace).toEqual({ value: '10', mixed: false });
    const b = (await bulk({ scope: 'department', department: 'Science', dryRun: true })).json();
    expect(b.change).toBe(1);
    expect(b.create).toBeGreaterThanOrEqual(2);
    expect(b.current.startsAt.mixed).toBe(true); // T1 at 08:00, the rest on Science's 07:00
    // existing only: the grace changes, nothing else, nobody made
    const c1 = (
      await bulk({ scope: 'existing', department: 'Science', fields: { grace: 20 }, dryRun: false })
    ).json();
    expect(c1).toMatchObject({ change: 1, create: 0, saved: 1 });
    expect(await mine(ids.T1!)).toEqual([
      expect.objectContaining({
        grace_minutes: 20,
        starts_at: '08:00',
        ends_at: '14:00',
        note: 'Exam duty',
      }),
    ]);
    expect(await mine(ids.H1!)).toEqual([]);
    // the whole department: the missing ones made from their own hours, the ticked end time for all
    const c2 = (
      await bulk({
        scope: 'department',
        department: 'Science',
        fields: { endsAt: '15:00' },
        dryRun: false,
      })
    ).json();
    expect(c2.create).toBeGreaterThanOrEqual(2);
    expect(await mine(ids.T1!)).toEqual([
      expect.objectContaining({ starts_at: '08:00', ends_at: '15:00', grace_minutes: 20 }),
    ]);
    expect(await mine(ids.H1!)).toEqual([
      expect.objectContaining({ starts_at: '07:00', ends_at: '15:00', present_hours: '5.00' }),
    ]);
    // a change that would break a row is refused, and nothing is written
    const bad = await bulk({
      scope: 'existing',
      department: 'Science',
      fields: { halfDayHours: 5.5 },
      dryRun: false,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toContain('half-day hours would not be fewer than the present hours');
    expect((await bulk({ scope: 'existing', fields: {}, dryRun: false })).statusCode).toBe(400);
    expect(
      (await call(t1, 'POST', '/staff-attendance/timings/bulk', { scope: 'existing', from, to }))
        .statusCode,
    ).toBe(403);
  });

  it('punches from Excel; the register and the payroll feed', async () => {
    const f = (await call(office, 'GET', '/staff-attendance/sheets/punches/format')).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(f.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    ws.getRow(2).values = [`Tarun Teacher E2E (${s}T2)`, PAST[10]!, '08:01', '15:31'];
    ws.getRow(3).values = [`${s}T2`, add(today, 3), '08:00', '15:30'];
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(office, 'POST', '/staff-attendance/sheets/punches/import', { file, dryRun: true })
    ).json();
    expect(dry.rows.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
    expect(dry.rows[1].error).toContain('still to come');
    expect(
      (
        await call(office, 'POST', '/staff-attendance/sheets/punches/import', {
          file,
          dryRun: false,
        })
      ).json().saved,
    ).toBe(1);
    expect((await dayOf(office, ids.T2!, PAST[10]!)).row).toMatchObject({
      dayType: 'P',
      in: '08:01',
      out: '15:31',
    });
    const reg = (
      await call(office, 'GET', `/staff-attendance/register?month=${PAST[0]!.slice(0, 7)}`)
    ).json();
    const t1row = reg.rows.find((r: { employee: { id: string } }) => r.employee.id === ids.T1);
    expect(t1row.cells.find((x: { day: string }) => x.day === PAST[0]).code).toBe('P');
    expect(t1row.totals.P).toBeGreaterThanOrEqual(1);
    // payable days: the month less absence, half of each half day, loss of pay and holds
    expect(t1row.payable).toBe(
      reg.dates.length -
        t1row.totals.A -
        t1row.totals.HD / 2 -
        t1row.totals.HOLD -
        reg.types
          .filter((c: string) => c === 'LWP' || c === 'LOP')
          .reduce((n: number, c: string) => n + (t1row.totals[c] ?? 0), 0),
    );
    expect(typeof t1row.unmarked).toBe('number');
    // working days out again stops at yesterday
    expect(
      (
        await call(office, 'POST', '/staff-attendance/run', {
          what: 'recompute',
          from: PAST[0],
          to: today,
        })
      ).statusCode,
    ).toBe(400);
    const feed = (
      await call(
        office,
        'GET',
        `/staff-attendance/register?month=${PAST[0]!.slice(0, 7)}&format=xlsx`,
      )
    ).json();
    expect(feed.filename).toMatch(/^payroll-feed-/);
    expect((await call(t1, 'GET', '/staff-attendance/register')).statusCode).toBe(403);
  });

  it('leave credited by attendance: the days lost in its period come off the credit', async () => {
    const m = Number(today.slice(5, 7));
    // EL for T2 alone: a day for each day of the year, credited this month, first without attendance
    await withMigrator((c) =>
      c.query(
        `INSERT INTO staff_leave_policies (school_id, name, leave_type_id, scope, scope_values, priority, annual_days,
                                           credit, credit_months, days_per_credit, pro_rata)
         VALUES ($1, 'EL by attendance', $2, 'employee', ARRAY[$3], 1, 365, 'Y', ARRAY[$4::int], 365, false)`,
        [school.id, ids.EL, `${s}T2`, m],
      ),
    );
    const el = async () =>
      (await call(office, 'GET', `/leave/balances?employeeId=${ids.T2!}`))
        .json()
        .rows.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'EL');
    await call(office, 'POST', '/leave/balances/run-month', {});
    expect((await el()).credited).toBe(365);
    await withMigrator((c) =>
      c.query(
        `UPDATE staff_leave_policies SET by_attendance = true WHERE school_id = $1 AND name = 'EL by attendance'`,
        [school.id],
      ),
    );
    await call(office, 'POST', '/leave/balances/run-month', {});
    const before = (await el()).credited as number;
    expect(before).toBeLessThanOrEqual(365);
    // two absent days and a half day, long ago in the period: two and a half days less
    await withMigrator(async (c) => {
      for (const [back, type] of [
        [300, 'A'],
        [301, 'A'],
        [302, 'HD'],
      ] as const)
        await c.query(
          `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source) VALUES ($1, $2, $3::date, $4, 'manual')`,
          [school.id, ids.T2, add(today, -back), type],
        );
    });
    await call(office, 'POST', '/leave/balances/run-month', {});
    const after = await el();
    expect(after.credited).toBe(before - 2.5);
    expect(after.trail.join(' ')).toMatch(/by attendance: [\d.]+ of \d+ days/);
  });
});
