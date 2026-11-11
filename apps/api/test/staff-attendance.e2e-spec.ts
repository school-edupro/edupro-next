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
      // a timing applies from its date: from before the day worked out below
      from: PAST[15],
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

  it('special timings from Excel: the sheet has the ones there are; new, changed, refused and unchanged rows', async () => {
    const f = (await call(office, 'GET', '/staff-attendance/timings/special-format')).json();
    expect(f.filename).toBe('special-timings.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(f.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const head = (ws.getRow(1).values as string[]).map((v) => String(v ?? '').replace(/ \*$/, ''));
    const col = (h: string) => head.indexOf(h);
    // the timings there are come with the sheet (T1's from the bulk edit above)
    let t1Row = 0;
    ws.eachRow((r, n) => {
      if (
        n > 1 &&
        String(r.getCell(col('Employee')).value).includes(`(${s}T1)`) &&
        String(r.getCell(col('From date')).value) === '01-03-2027'
      )
        t1Row = n;
    });
    expect(t1Row).toBeGreaterThan(1);
    ws.getRow(t1Row).getCell(col('Remark')).value = 'Exam duty, changed by Excel';
    const add = (vals: Record<string, string | number>) => {
      const r = ws.addRow([]);
      for (const [k, v] of Object.entries(vals)) r.getCell(col(k)).value = v;
      return r.number;
    };
    const base = {
      'Start time': '07:30',
      'End time': '13:30',
      'Present hours': 5.5,
      'Half-day hours': 3,
    };
    const newRow = add({
      Employee: `Tarun Teacher E2E (${s}T2)`,
      'From date': '01-04-2027',
      'To date': '03-04-2027',
      ...base,
      'Late by more than (minutes)': 15,
      'Then (late)': 'Half day',
    });
    const badRow = add({
      Employee: `${s}T2`,
      'From date': '10-04-2027',
      'To date': '12-04-2027',
      ...base,
      'End time': '07:00',
    });
    const overlapRow = add({
      Employee: `${s}T1`,
      'From date': '03-03-2027',
      'To date': '08-03-2027',
      ...base,
    });
    const ruleRow = add({
      Employee: `${s}T2`,
      'From date': '20-04-2027',
      'To date': '21-04-2027',
      ...base,
      'Left early by more than (minutes)': 20,
      'Then (early)': 'Half day of a leave type',
    });
    const file = async () => Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const send = async (dryRun: boolean) =>
      (
        await call(office, 'POST', '/staff-attendance/timings/special-import', {
          file: await file(),
          dryRun,
        })
      ).json();
    const checked = await send(true);
    const at = (n: number) => checked.rows.find((r: { row: number }) => r.row === n);
    expect(at(t1Row)).toMatchObject({ ok: true, what: 'change' });
    expect(at(newRow)).toMatchObject({ ok: true, what: 'new', dates: '01-04-2027 to 03-04-2027' });
    expect(at(badRow).error).toContain('the end time is not after the start time');
    expect(at(overlapRow).error).toContain(
      'overlaps their special timing 01-03-2027 to 05-03-2027',
    );
    expect(at(ruleRow).error).toContain('Early leave type: a leave type code');
    expect(checked.saved).toBe(0);
    // save: the good rows only
    expect((await send(false)).saved).toBe(2);
    const rows = (await call(office, 'GET', '/staff-attendance/timings')).json().rows;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employee_id: ids.T2,
          from_date: '2027-04-01',
          starts_at: '07:30',
          late_over_minutes: 15,
          late_action: 'HD',
        }),
        expect.objectContaining({
          employee_id: ids.T1,
          from_date: '2027-03-01',
          note: 'Exam duty, changed by Excel',
        }),
      ]),
    );
    expect(rows.some((r: { from_date: string }) => r.from_date === '2027-04-10')).toBe(false);
    // the same file again: the saved rows are as they are now
    const again = await send(true);
    expect(again.rows.find((r: { row: number }) => r.row === newRow).what).toBe('same');
    expect(again.rows.find((r: { row: number }) => r.row === t1Row).what).toBe('same');
    expect((await call(t1, 'GET', '/staff-attendance/timings/special-format')).statusCode).toBe(
      403,
    );
  });

  it('the timings list: a tab each, search, department, the days covered, a page at a time, Excel and PDF', async () => {
    const list = (qs: string) =>
      call(office, 'GET', `/staff-attendance/timings/list?${qs}`).then((r) => r.json());
    const sp = await list('kind=special&size=25');
    expect(sp.counts.department).toBeGreaterThanOrEqual(1);
    expect(sp.counts.special).toBe(sp.page.total);
    expect(sp.page).toMatchObject({ page: 1, size: 25 });
    // search by the employee's code; the department of the employee; the days covered
    const t2 = await list(`kind=special&q=${s}T2`);
    expect(t2.rows.every((r: { employee: string }) => r.employee.includes(`${s}T2`))).toBe(true);
    expect(t2.page.total).toBeGreaterThanOrEqual(1);
    expect((await list('kind=special&department=Nowhere')).page.total).toBe(0);
    const april = await list('kind=special&from=2027-04-02&to=2027-04-02');
    expect(april.rows.map((r: { from_date: string }) => r.from_date)).toEqual(['2027-04-01']);
    expect((await list('kind=special&from=2030-01-01')).page.total).toBe(0);
    // a page at a time
    const one = await list('kind=special&size=25&page=2');
    expect(one.page.page).toBe(2);
    expect((await call(office, 'GET', '/staff-attendance/timings/list?size=7')).statusCode).toBe(
      400,
    );
    // the department tab, and the same rows as files
    const dept = await list('kind=department&q=Science');
    expect(dept.rows[0]).toMatchObject({ kind: 'department', department: 'Science' });
    for (const format of ['xlsx', 'pdf']) {
      const f = await list(`kind=special&q=${s}T2&format=${format}`);
      expect(f.filename).toMatch(new RegExp(`^Special-timings-.*\\.${format}$`));
      expect(f.rows).toBe(t2.page.total);
    }
    // the dialogs' lists: department timings and the one edited only
    const slim = (
      await call(
        office,
        'GET',
        `/staff-attendance/timings?only=department&id=${april.rows[0].id as string}`,
      )
    ).json();
    expect(
      slim.rows.every(
        (r: { kind: string; id: string }) => r.kind === 'department' || r.id === april.rows[0].id,
      ),
    ).toBe(true);
    expect((await call(t1, 'GET', '/staff-attendance/timings/list')).statusCode).toBe(403);
  });

  it('department timings by date: a change from a day, scheduled ahead, never overlapping; back-dating; the log', async () => {
    const base = {
      startsAt: '07:00',
      endsAt: '13:00',
      grace: 5,
      presentHours: 5,
      halfDayHours: 2.5,
    };
    const hours = async (emp: string, day: string) =>
      withMigrator(
        async (c) =>
          (
            await c.query<{ s: string; src: string }>(
              `SELECT to_char(starts_at, 'HH24:MI') AS s, timing_source AS src FROM app.staff_timing($1, $2::date)`,
              [emp, day],
            )
          ).rows[0],
      );
    const science = (
      await call(office, 'GET', '/staff-attendance/timings/list?kind=department&q=Science')
    )
      .json()
      .rows.find((r: { department: string }) => r.department === 'Science');
    const later = add(today, 10);
    // the change from a later day: the version in force ends the day before, a new one is scheduled
    const ch = await call(office, 'PUT', `/staff-attendance/timings/${science.id as string}`, {
      kind: 'department',
      department: 'Science',
      applyFrom: later,
      ...base,
      startsAt: '07:30',
    });
    expect(ch.statusCode).toBe(200);
    const next = ch.json().id as string;
    expect(next).not.toBe(science.id);
    expect(await hours(ids.H1!, PAST[9]!)).toMatchObject({ s: '07:00', src: 'DEPARTMENT' });
    expect(await hours(ids.H1!, add(later, 3))).toMatchObject({ s: '07:30', src: 'DEPARTMENT' });
    const now = (
      await call(office, 'GET', '/staff-attendance/timings/list?kind=department&q=Science')
    ).json().rows;
    expect(
      now.map((r: { from_date: string | null; to_date: string | null }) => [
        r.from_date,
        r.to_date,
      ]),
    ).toEqual([
      [PAST[15], add(later, -1)],
      [later, null],
    ]);
    // a scheduled version is changed as it is; a second one over the same days is refused
    const same = await call(office, 'PUT', `/staff-attendance/timings/${next}`, {
      kind: 'department',
      department: 'Science',
      from: later,
      ...base,
      startsAt: '07:30',
      endsAt: '13:30',
    });
    expect(same.json().id).toBe(next);
    const clash = await call(office, 'POST', '/staff-attendance/timings', {
      kind: 'department',
      department: 'Science',
      from: add(today, 20),
      ...base,
    });
    expect(clash.statusCode).toBe(400);
    expect(clash.json().detail).toContain('Science already has a timing');
    // back-dating: into a month locked for payroll refused; else the past days worked out again
    const lib = (
      await call(office, 'POST', '/staff-attendance/timings', {
        kind: 'department',
        department: 'Library',
        from: PAST[15],
        ...base,
      })
    ).json().id as string;
    const old = `${add(today.slice(0, 7) + '-01', -40).slice(0, 7)}-01`;
    await withMigrator((c) =>
      c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)
         ON CONFLICT ON CONSTRAINT staff_month_locks_pkey DO UPDATE SET locked = true`,
        [school.id, old],
      ),
    );
    const locked = await call(office, 'PUT', `/staff-attendance/timings/${lib}`, {
      kind: 'department',
      department: 'Library',
      applyFrom: old,
      from: old,
      ...base,
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().detail).toContain('locked for payroll');
    await withMigrator((c) =>
      c.query(
        `UPDATE staff_month_locks SET locked = false WHERE school_id = $1 AND month = $2::date`,
        [school.id, old],
      ),
    );
    const back = await call(office, 'PUT', `/staff-attendance/timings/${lib}`, {
      kind: 'department',
      department: 'Library',
      applyFrom: PAST[3],
      ...base,
      startsAt: '06:45',
    });
    expect(back.statusCode).toBe(200);
    // removing one that already applied ends it yesterday (the past keeps it)
    const end = (
      await call(office, 'POST', `/staff-attendance/timings/${back.json().id as string}/retire`, {})
    ).json();
    expect(end).toMatchObject({ status: 'ended', on: add(today, -1) });
    // the log: who, what, old and new
    const log = (
      await call(office, 'GET', '/staff-attendance/timings/log?department=Library&size=25')
    ).json();
    expect(log.rows.map((r: { action: string }) => r.action)).toEqual(
      expect.arrayContaining(['added', 'ended']),
    );
    const started = log.rows.find(
      (r: { action: string; changes: Array<{ field: string }> }) =>
        r.action === 'added' && r.changes.some((x) => x.field === 'Start time'),
    );
    expect(started.by).toBeTruthy();
    const sciLog = (
      await call(office, 'GET', '/staff-attendance/timings/log?department=Science')
    ).json().rows;
    expect(
      sciLog.some(
        (r: { action: string; changes: Array<{ field: string; old: unknown; new: unknown }> }) =>
          r.action === 'changed' &&
          r.changes.some((x) => x.field === 'End time' && x.old === '13:00' && x.new === '13:30'),
      ),
    ).toBe(true);
    for (const format of ['xlsx', 'pdf'])
      expect(
        (await call(office, 'GET', `/staff-attendance/timings/log?format=${format}`)).json()
          .filename,
      ).toMatch(/^Timing-change-log-/);
    expect((await call(t1, 'GET', '/staff-attendance/timings/log')).statusCode).toBe(403);
  });

  it('a special timing for several employees at once: those with an overlapping one are skipped and named', async () => {
    const body = {
      kind: 'special',
      startsAt: '08:00',
      endsAt: '14:00',
      grace: 5,
      presentHours: 5,
      halfDayHours: 2.5,
    };
    const one = await call(office, 'POST', '/staff-attendance/timings', {
      ...body,
      employeeIds: [ids.T1],
      from: '2027-06-01',
      to: '2027-06-02',
    });
    expect(one.json().created).toHaveLength(1);
    const many = (
      await call(office, 'POST', '/staff-attendance/timings', {
        ...body,
        employeeIds: [ids.T1, ids.T2, ids.H1],
        from: '2027-06-02',
        to: '2027-06-03',
        note: 'Sports day',
      })
    ).json();
    expect(many.created).toHaveLength(2);
    expect(many.skipped).toEqual([
      expect.objectContaining({ reason: 'already has a special timing 01-06-2027 to 02-06-2027' }),
    ]);
    const none = await call(office, 'POST', '/staff-attendance/timings', {
      ...body,
      employeeIds: [ids.T2, ids.H1],
      from: '2027-06-03',
      to: '2027-06-04',
    });
    expect(none.statusCode).toBe(400);
    expect(none.json().detail).toContain('Not saved');
  });

  it('the shift calendar: post for days and one day, give way, take a day back, copy a month, the log, back-dating', async () => {
    const [r1, r2, gen] = await withMigrator(async (c) => {
      const mk = async (code: string, name: string) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, employee_type, gender)
             VALUES ($1, $2, $3, 'E2E', 'Staff', 'Roster', 'non_teaching', 'male') RETURNING id::text`,
            [school.id, `${s}${code}`, name],
          )
        ).rows[0]!.id;
      const g = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM staff_shifts WHERE school_id = $1 AND code = 'GEN'`,
          [school.id],
        )
      ).rows[0]!.id;
      return [await mk('R1', 'Ravi Roster'), await mk('R2', 'Rina Roster'), g];
    });
    const early = await call(office, 'POST', '/masters/staff_shifts/rows', {
      values: {
        code: 'EARLY',
        name: 'Early',
        kind: 'day',
        colour: '#7C3AED',
        starts_at: '06:30',
        ends_at: '13:30',
        grace_minutes: 5,
        present_hours: 6,
        half_day_hours: 3,
        total_hours: 7,
      },
    });
    expect(early.statusCode).toBe(201);
    const ear = await withMigrator(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM staff_shifts WHERE school_id = $1 AND code = 'EARLY'`,
            [school.id],
          )
        ).rows[0]!.id,
    );
    const cal = async (q = '') =>
      (
        await call(
          office,
          'GET',
          `/staff-attendance/shift-calendar?month=2027-07&department=Roster${q}`,
        )
      ).json();
    let m = await cal();
    expect(m.page.total).toBe(2);
    expect(m.rows.every((r: { posted: boolean }) => !r.posted)).toBe(true);
    expect(m.shifts.find((x: { code: string }) => x.code === 'EARLY').colour).toBe('#7C3AED');
    expect(m.rows[0].cells[0]).toMatchObject({ s: m.defaultShiftId, src: 'default' });

    // a dry run changes nothing; then EARLY for 05 to 20 July for both
    const body = { employeeIds: [r1, r2], shiftId: ear, from: '2027-07-05', to: '2027-07-20' };
    const dry = (
      await call(office, 'POST', '/staff-attendance/shift-calendar/assign', {
        ...body,
        dryRun: true,
      })
    ).json();
    expect(dry).toMatchObject({ dryRun: true, changed: 2 });
    expect((await cal()).rows.every((r: { posted: boolean }) => !r.posted)).toBe(true);
    const done = (
      await call(office, 'POST', '/staff-attendance/shift-calendar/assign', body)
    ).json();
    expect(done).toMatchObject({ changed: 2, same: 0 });
    // the same again: nothing changes
    expect(
      (await call(office, 'POST', '/staff-attendance/shift-calendar/assign', body)).json(),
    ).toMatchObject({
      changed: 0,
      same: 2,
    });
    m = await cal();
    const ravi = m.rows.find((r: { id: string }) => r.id === r1);
    expect(ravi.cells[3]).toMatchObject({ src: 'default' });
    expect(ravi.cells[4]).toMatchObject({ s: ear, src: 'posted' });
    expect(ravi.cells[19]).toMatchObject({ s: ear, src: 'posted' });
    expect(ravi.cells[20]).toMatchObject({ src: 'default' });
    expect(ravi.cells.filter((x: { wo: boolean }) => x.wo).length).toBeGreaterThan(0);
    // the filters: by shift, and those with none posted
    expect((await cal(`&shiftId=${ear}`)).page.total).toBe(2);
    expect((await cal('&unposted=1')).page.total).toBe(0);
    expect((await cal('&q=Rina')).rows.map((r: { id: string }) => r.id)).toEqual([r2]);

    // GEN for 10 July only: that day changes, EARLY resumes the next
    await call(office, 'POST', '/staff-attendance/shift-calendar/assign', {
      employeeIds: [r1],
      shiftId: gen,
      from: '2027-07-10',
      to: '2027-07-10',
    });
    m = await cal();
    let cells = m.rows.find((r: { id: string }) => r.id === r1).cells;
    expect(cells[9]).toMatchObject({ s: gen, src: 'day' });
    expect(cells[10]).toMatchObject({ s: ear, src: 'posted' });
    // GEN from 15 July until changed: EARLY ends on the 14th (the 10th's own day stays)
    const open = (
      await call(office, 'POST', '/staff-attendance/shift-calendar/assign', {
        employeeIds: [r1],
        shiftId: gen,
        from: '2027-07-15',
        to: null,
        dryRun: true,
      })
    ).json();
    expect(open.lines[0].changes).toEqual([
      'EARLY from 05-07-2027 now ends 14-07-2027',
      'GEN 15-07-2027 to until changed',
    ]);
    // take the 10th back: it follows EARLY again; a day with no posting of its own is refused
    expect(
      (
        await call(office, 'POST', '/staff-attendance/shift-calendar/clear-day', {
          employeeId: r1,
          day: '2027-07-10',
        })
      ).json(),
    ).toMatchObject({ cleared: 1 });
    cells = (await cal()).rows.find((r: { id: string }) => r.id === r1).cells;
    expect(cells[9]).toMatchObject({ s: ear, src: 'posted' });
    expect(
      (
        await call(office, 'POST', '/staff-attendance/shift-calendar/clear-day', {
          employeeId: r1,
          day: '2027-07-11',
        })
      ).statusCode,
    ).toBe(404);

    // copy July onto August: date for date; a second copy leaves them (posted there already)
    const preview = (
      await call(office, 'POST', '/staff-attendance/shift-calendar/copy', {
        source: '2027-07',
        target: '2027-08',
        department: 'Roster',
      })
    ).json();
    expect(preview).toMatchObject({ dryRun: true, copied: 2, postings: 2 });
    expect(preview.lines[0].changes).toEqual(['EARLY 05-08-2027 to 20-08-2027']);
    await call(office, 'POST', '/staff-attendance/shift-calendar/copy', {
      source: '2027-07',
      target: '2027-08',
      department: 'Roster',
      dryRun: false,
    });
    const aug = (
      await call(office, 'GET', '/staff-attendance/shift-calendar?month=2027-08&department=Roster')
    ).json();
    expect(aug.rows[0].cells[4]).toMatchObject({ s: ear, src: 'posted' });
    const again = (
      await call(office, 'POST', '/staff-attendance/shift-calendar/copy', {
        source: '2027-07',
        target: '2027-08',
        department: 'Roster',
      })
    ).json();
    expect(again).toMatchObject({
      copied: 0,
      skipped: expect.arrayContaining([expect.stringContaining('Ravi')]),
    });

    // the log: each posting, who, what
    const log = (
      await call(office, 'GET', `/staff-attendance/shift-calendar/log?employeeId=${r1}&size=50`)
    ).json();
    expect(log.rows.map((x: { action: string }) => x.action)).toEqual(
      expect.arrayContaining(['added', 'removed']),
    );
    expect(log.rows.find((x: { action: string }) => x.action === 'added').shift).toContain('EARLY');

    // back-dating: a past day is worked out again; a locked month refuses
    // 6 h 14 m: a half day on the default shift (present from 7 h), present on EARLY (from 6 h)
    await punch(`${s}R2`, PAST[3]!, '06:31', '12:45');
    await run('sync');
    expect((await dayOf(office, r2, PAST[3]!)).row.dayType).toBe('HD');
    const back = (
      await call(office, 'POST', '/staff-attendance/shift-calendar/assign', {
        employeeIds: [r2],
        shiftId: ear,
        from: PAST[3],
        to: PAST[3],
      })
    ).json();
    expect(back.worked).toBeGreaterThan(0);
    expect((await dayOf(office, r2, PAST[3]!)).row.dayType).toBe('P');
    await withMigrator((c) =>
      c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)
         ON CONFLICT ON CONSTRAINT staff_month_locks_pkey DO UPDATE SET locked = true`,
        [school.id, oldMonth],
      ),
    );
    const refused = await call(office, 'POST', '/staff-attendance/shift-calendar/assign', {
      employeeIds: [r2],
      shiftId: ear,
      from: OLD[2],
      to: OLD[2],
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toContain('locked for payroll');
    await withMigrator((c) =>
      c.query(
        `UPDATE staff_month_locks SET locked = false WHERE school_id = $1 AND month = $2::date`,
        [school.id, oldMonth],
      ),
    );

    // Excel and PDF; the roster report; only the office posts
    const x = (
      await call(
        office,
        'GET',
        '/staff-attendance/shift-calendar?month=2027-07&department=Roster&format=xlsx',
      )
    ).json();
    expect(x.filename).toMatch(/^Shift-calendar-2027-07/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(x.base64, 'base64') as unknown as ArrayBuffer);
    const texts: string[] = [];
    book.worksheets[0]!.eachRow((row) => row.eachCell((cell) => texts.push(String(cell.value))));
    // the display name carries the last name (Ravi Roster E2E)
    expect(texts.some((t) => t.startsWith('Ravi Roster'))).toBe(true);
    expect(texts).toContain('EARLY');
    const roster = (
      await call(
        office,
        'GET',
        '/leave-reports/reports/shift_roster?month=2027-07&department=Roster',
      )
    ).json();
    expect(roster.columns.map((c: { label: string }) => c.label)).toEqual(
      expect.arrayContaining(['EARLY', 'GEN']),
    );
    expect(
      (await call(t1, 'POST', '/staff-attendance/shift-calendar/assign', { ...body, dryRun: true }))
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

  it('the register as the old Payroll / Attendance Register: IN, OUT, HRS, the status filter, hidden staff, quick edit and bulk update with their guards', async () => {
    type Cell = {
      day: string;
      code: string;
      type?: string;
      in?: string;
      out?: string;
      hrs?: number;
    };
    type Row = {
      employee: { id: string; department: string | null };
      cells: Cell[];
      totals: Record<string, number>;
    };
    const reg = async (qs: string) =>
      (await call(office, 'GET', `/staff-attendance/register?${qs}`)).json();
    // each day carries its IN, OUT and hours (the punches from Excel on PAST[10])
    const m10 = PAST[10]!.slice(0, 7);
    const r10 = await reg(`month=${m10}`);
    const t2 = (r10.rows as Row[]).find((r) => r.employee.id === ids.T2)!;
    expect(t2.cells.find((c) => c.day === PAST[10])).toMatchObject({
      type: 'P',
      in: '08:01',
      out: '15:31',
      hrs: 7.5,
    });
    expect(r10.employees.map((e: { id: string }) => e.id)).toEqual(
      expect.arrayContaining([ids.T1, ids.T2, ids.H1]),
    );
    expect(r10.checks).toMatchObject({
      missingTotal: expect.any(Number),
      missing: expect.any(Array),
      noDepartment: expect.any(Array),
    });
    // the status filter: only staff with such a day in the month
    for (const [code, key] of [
      ['A', 'A'],
      ['WO', 'WO'],
      ['late', 'late'],
    ] as const) {
      const f = await reg(`month=${m10}&status=${code}`);
      expect((f.rows as Row[]).every((r) => (r.totals[key] ?? 0) > 0)).toBe(true);
    }
    // staff not required in the reports: left out unless asked, counted
    await withMigrator((c) =>
      c.query(
        `INSERT INTO staff_report_exclusions (school_id, employee_id, reason) VALUES ($1, $2, 'Vendor account')`,
        [school.id, ids.H1],
      ),
    );
    const hid = await reg(`month=${m10}`);
    expect((hid.rows as Row[]).map((r) => r.employee.id)).not.toContain(ids.H1);
    expect(hid).toMatchObject({ excluded: 1, all: false });
    expect(((await reg(`month=${m10}&all=1`)).rows as Row[]).map((r) => r.employee.id)).toContain(
      ids.H1,
    );
    await withMigrator((c) =>
      c.query(`UPDATE staff_report_exclusions SET status = 'retired' WHERE employee_id = $1`, [
        ids.H1,
      ]),
    );
    // quick edit: a weekly off made absent must be confirmed
    const sat = add(lastSaturday, -7);
    await withMigrator((c) =>
      c.query(
        `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source)
         SELECT $1, x, $3::date, 'WO', 'weekoff' FROM unnest($2::bigint[]) AS x
         ON CONFLICT (employee_id, day) DO UPDATE SET day_type = 'WO', source = 'weekoff', manual = false, leave_type_id = NULL`,
        [school.id, [ids.T1, ids.T2], sat],
      ),
    );
    const no = await call(office, 'POST', '/staff-attendance/days', {
      employeeId: ids.T1,
      day: sat,
      dayType: 'A',
      reason: 'Called in, did not come',
    });
    expect(no.statusCode).toBe(409);
    expect(no.json().detail).toContain('weekly off');
    expect(
      (
        await call(office, 'POST', '/staff-attendance/days', {
          employeeId: ids.T1,
          day: sat,
          dayType: 'A',
          reason: 'Called in, did not come',
          confirmOff: true,
        })
      ).statusCode,
    ).toBe(201);
    expect((await dayOf(office, ids.T1!, sat)).row).toMatchObject({ dayType: 'A', manual: true });
    // bulk update: the same for both over the days; a day under a full day's leave is left as it is
    const lv = (
      await call(t1, 'POST', '/leave/apply', {
        leaveTypeId: ids.CL,
        from: PAST[13],
        to: PAST[13],
        reason: 'Family',
      })
    ).json();
    if (lv.status === 'pending')
      await call(hod, 'POST', `/leave/requests/${lv.id as string}/decide`, { outcome: 'approved' });
    const bulk = (body: Record<string, unknown>) =>
      call(office, 'POST', '/staff-attendance/days/bulk', body);
    const b1 = (
      await bulk({
        employeeIds: [ids.T1, ids.T2],
        from: PAST[13],
        to: PAST[13],
        dayType: 'P',
        reason: 'Training day at school',
      })
    ).json();
    expect(b1).toMatchObject({ set: 1, onLeave: 1, employees: 2 });
    expect((await dayOf(office, ids.T2!, PAST[13]!)).row).toMatchObject({
      dayType: 'P',
      manual: true,
    });
    // a department; the weekly off in the range needs the tick when made absent
    const dept = t2.employee.department!;
    const off = await bulk({
      department: dept,
      from: sat,
      to: sat,
      dayType: 'A',
      reason: 'Called in',
    });
    expect(off.statusCode).toBe(409);
    expect(off.json().detail).toContain('weekly off');
    expect(
      (
        await bulk({
          department: dept,
          from: sat,
          to: sat,
          dayType: 'A',
          reason: 'Called in',
          confirmOff: true,
        })
      ).json(),
    ).toMatchObject({ set: 3, employees: 3 });
    // refused: nobody picked, more than 62 days, a day to come, a locked month
    for (const [body, code] of [
      [{ from: PAST[12], to: PAST[12], dayType: 'P', reason: 'x y z' }, 400],
      [
        {
          employeeIds: [ids.T1],
          from: add(today, -80),
          to: PAST[0],
          dayType: 'P',
          reason: 'x y z',
        },
        400,
      ],
      [
        { employeeIds: [ids.T1], from: PAST[0], to: add(today, 2), dayType: 'P', reason: 'x y z' },
        400,
      ],
    ] as const)
      expect((await bulk(body)).statusCode).toBe(code);
    await call(office, 'POST', '/staff-attendance/lock', { month: oldMonth.slice(0, 7) });
    const locked = await bulk({
      employeeIds: [ids.T1],
      from: OLD[2],
      to: OLD[2],
      dayType: 'P',
      reason: 'Too late',
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().detail).toContain('locked');
    await call(office, 'POST', '/staff-attendance/unlock', {
      month: oldMonth.slice(0, 7),
      reason: 'Bulk update checked',
    });
    // the spreadsheet as the old module's: a CSV with its headings, no Reason column, the Default Reason
    const csv = (rows: string[]) => Buffer.from(rows.join('\r\n')).toString('base64');
    const file = csv([
      'EmpId,Date,DayType,InTime,OutTime',
      `${s}T2,${PAST[14]!},P,08:00,15:30`,
      `${s}T1,${PAST[13]!},P,,`,
    ]);
    const sheet = (body: Record<string, unknown>) =>
      call(office, 'POST', '/staff-attendance/sheets/days/import', body).then((r) => r.json());
    const noWhy = await sheet({ file, dryRun: true });
    expect(noWhy.rows[0].error).toContain('Default Reason');
    const dry = await sheet({
      file,
      dryRun: true,
      reason: 'Device down, declared by the principal',
    });
    expect(dry.rows.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
    expect(dry.rows[1].error).toMatch(/^skipped: .* \(leave\) covers the day/);
    expect(
      (await sheet({ file, dryRun: false, reason: 'Device down, declared by the principal' }))
        .saved,
    ).toBe(1);
    expect((await dayOf(office, ids.T2!, PAST[14]!)).row).toMatchObject({
      dayType: 'P',
      manual: true,
      in: '08:00',
      out: '15:30',
    });
    expect(
      (
        await call(office, 'POST', '/staff-attendance/sheets/days/import', {
          file: Buffer.from('not a sheet').toString('base64'),
        })
      ).json().detail,
    ).toContain('CSV');
    expect(
      (
        await call(t1, 'POST', '/staff-attendance/days/bulk', {
          employeeIds: [ids.T1],
          from: PAST[12],
          to: PAST[12],
          dayType: 'P',
          reason: 'x y z',
        })
      ).statusCode,
    ).toBe(403);
  });
});
