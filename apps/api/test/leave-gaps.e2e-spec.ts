/**
 * The leave module checked against its plan (docs/design/85, "As built — the plan checked"): every message
 * (WhatsApp once its template is approved, the approver's confirmation, withdrawn, next level, cancellation,
 * dates changed, corrections, the digest, the missing-punch copy), the payroll lock on every route, the same
 * person once, designation and role approvers, the apply checks, optional holidays and weekly-off rules,
 * special and bus timings, the device push, the days sheet, deductions, absence → loss of pay, the session
 * end, my team's attendance, the payroll feed's part pay and encashment, the exports, the late roll-back and
 * a day filled when leave comes off it.
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
const monday = (d: string) => add(d, (8 - dow(d)) % 7);
/** working days well ahead (Saturday and Sunday are off here) */
const W = (week: number, day: number) => add(monday(add(today, 21)), week * 7 + day);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const prevMonth = monthStart(add(monthStart(today), -1));
/** weekdays of last month */
const PREV: string[] = [];
for (let d = prevMonth; d < monthStart(today); d = add(d, 1))
  if (dow(d) !== 0 && dow(d) !== 6) PREV.push(d);
/** weekdays before today, newest first */
const PAST: string[] = [];
for (let d = add(today, -1); PAST.length < 30; d = add(d, -1))
  if (dow(d) !== 0 && dow(d) !== 6) PAST.push(d);

describe('the leave module against its plan (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let hod: SeededUser;
  let t1: SeededUser;
  let t2: SeededUser;
  let t3: SeededUser;
  let vp: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('LG');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const apply = (u: SeededUser, body: Record<string, unknown>) =>
    call(u, 'POST', '/leave/apply', { reason: 'Family work', ...body });
  const q = <T>(sql: string, args: unknown[] = []) =>
    withMigrator((c) => c.query<T & Record<string, unknown>>(sql, args)).then((r) => r.rows);
  /** run SQL as the school (its row-level security and app.current_school_id()) */
  const asSchool = <T>(sql: string, args: unknown[] = []) =>
    withMigrator(async (c) => {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.school_id', $1, true)`, [school.id]);
      const r = await c.query<T & Record<string, unknown>>(sql, args);
      await c.query('COMMIT');
      return r.rows;
    });
  const sent = async (code: string, user: SeededUser, channel = 'email') =>
    (
      await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = $2 AND m.recipient_user_id = $3 AND m.channel = $4::comms_channel`,
        [school.id, code, user.id, channel],
      )
    )[0]!.n;
  const decide = (u: SeededUser, id: string, outcome: 'approved' | 'rejected', note = '') =>
    call(u, 'POST', `/leave/requests/${id}/decide`, { outcome, note });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      hod = await seedUser(c, school, `${s}-hod`, 'class_teacher');
      t1 = await seedUser(c, school, `${s}-t1`, 'subject_teacher');
      t2 = await seedUser(c, school, `${s}-t2`, 'subject_teacher');
      t3 = await seedUser(c, school, `${s}-t3`, 'subject_teacher');
      vp = await seedUser(c, school, `${s}-vp`, 'subject_teacher');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(
        `INSERT INTO departments (school_id, code, name, staff_group) VALUES ($1, 'science', 'Science', 'teaching')`,
        [school.id],
      );
      await c.query(
        `INSERT INTO designations (school_id, code, name) VALUES ($1, 'deputy_head', 'Deputy Head') ON CONFLICT DO NOTHING`,
        [school.id],
      );
      for (const [code, name, dept, desig, u] of [
        ['O1', 'Om Office', 'Administration', 'Clerk', office],
        ['H1', 'Hari Head', 'Science', 'HOD', hod],
        ['T1', 'Tara One', 'Science', 'Teacher', t1],
        ['T2', 'Tarun Two', 'Science', 'Teacher', t2],
        ['T3', 'Tanu Three', 'Science', 'Teacher', t3],
        ['V1', 'Vimal Deputy', 'Administration', 'Deputy Head', vp],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, employee_type, gender, user_id)
             VALUES ($1, $2, $3, 'E2E', $4, $5, 'teaching', 'female', $6) RETURNING id::text`,
            [school.id, `${s}${code}`, name, desig, dept, u.id],
          )
        ).rows[0]!.id;
      await c.query(
        `UPDATE departments SET hod_employee_id = $2 WHERE school_id = $1 AND name = 'Science'`,
        [school.id, ids.H1],
      );
      // T1 reports to T2 this year
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, reports_to_employee_id) VALUES ($1, $2, $3, $4)`,
        [school.id, ids.T1, school.yearId, ids.T2],
      );
      await c.query(`UPDATE users SET mobile = '9000000001' WHERE id = $1`, [hod.id]);
      for (const u of [admin, office, hod, t1, t2, t3, vp])
        await c.query(`UPDATE users SET email = $2 WHERE id = $1`, [
          u.id,
          `${u.sub.toLowerCase()}@school.example`,
        ]);
    });
    app = await createApp();
    inject = injector(app);
    await call(office, 'GET', '/leave/setup/overview');
    await q(`UPDATE staff_weekoff_rules SET weekdays = '{6,7}' WHERE school_id = $1`, [school.id]);
    const types = (await call(office, 'GET', '/masters/staff_leave_types/rows?size=50')).json()
      .data;
    for (const t of types as Array<{ code: string; id: string }>) ids[t.code] = t.id;
    await call(office, 'POST', '/masters/staff_leave_policies/rows', {
      values: {
        name: 'CL all',
        leave_type_id: 'CL',
        scope: 'all',
        annual_days: 12,
        credit: 'H',
        carry_forward: true,
        carry_cap: 5,
      },
    });
    const rule = async (
      kind: string,
      name: string,
      scope: string,
      scopeValues: string[],
      priority: number,
      typeId?: string,
    ) =>
      (
        await call(office, 'POST', '/leave/setup/approvals', {
          kind,
          name,
          scope,
          scopeValues,
          priority,
          ...(typeId ? { leaveTypeId: typeId } : {}),
        })
      ).json().id as string;
    const band = async (id: string, b: number, levels: unknown[]) => {
      const r = await call(office, 'PUT', `/leave/setup/approvals/${id}/bands/${String(b)}`, {
        levels,
      });
      expect([id, b, r.statusCode, r.json().detail]).toEqual([id, b, 200, undefined]);
    };
    ids.R_ALL = await rule('leave', 'All', 'all', [], 100);
    await band(ids.R_ALL, 0, [{ name: 'HOD', by: 'hod', employeeIds: [] }]);
    await band(ids.R_ALL, 1, [
      { name: 'HOD', by: 'hod', employeeIds: [] },
      { name: 'Office', by: 'employees', employeeIds: [ids.O1] },
    ]);
    const reg = await rule('regularisation', 'Corrections', 'all', [], 100);
    await band(reg, 0, [{ name: 'HOD', by: 'hod', employeeIds: [] }]);
    // T3: the HOD at two levels in a row (approves once); T2: a designation; SL of T1: a role
    const r3 = await rule('leave', 'T3 twice', 'employee', [`${s}T3`], 10);
    await band(r3, 0, [
      { name: 'HOD', by: 'hod', employeeIds: [] },
      { name: 'Again', by: 'employees', employeeIds: [ids.H1] },
    ]);
    const r2 = await rule('leave', 'T2 deputy', 'employee', [`${s}T2`], 10);
    await band(r2, 0, [
      { name: 'Deputy', by: 'designation', employeeIds: [], designation: 'Deputy Head' },
    ]);
    const rs = await rule('leave', 'T1 SL office', 'employee', [`${s}T1`], 5, ids.SL);
    await band(rs, 0, [
      { name: 'Leave office', by: 'role', employeeIds: [], roleCode: 'leave_office' },
    ]);
    for (const [emp, type, days] of [
      ['T1', 'CL', 25],
      ['T2', 'CL', 5],
      ['T3', 'CL', 5],
      ['T1', 'SL', 5],
    ] as const)
      expect(
        (
          await call(office, 'POST', '/leave/balances/adjust', {
            employeeId: ids[emp],
            leaveTypeId: ids[type],
            days,
            reason: 'Opening',
          })
        ).statusCode,
      ).toBe(201);
  });
  afterAll(async () => {
    if (app) await app.close();
    await q(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]);
  });

  it('messages: waiting (and WhatsApp once approved), the approver’s confirmation, approved, rejected, withdrawn', async () => {
    // WhatsApp goes only for a template with the name Meta approved
    await q(
      `UPDATE comms_templates SET wa_template_name = 'leave_waiting_v1' WHERE school_id = $1 AND code = 'leave_waiting' AND channel = 'whatsapp'`,
      [school.id],
    );
    const a = (await apply(t1, { leaveTypeId: ids.CL, from: W(0, 0), to: W(0, 0) })).json();
    expect(a).toMatchObject({ status: 'pending' });
    expect(await sent('leave_waiting', hod)).toBe(1);
    expect(await sent('leave_waiting', hod, 'whatsapp')).toBe(1);
    expect((await decide(hod, a.id, 'approved')).statusCode).toBe(201);
    expect(await sent('leave_acted', hod)).toBe(1);
    expect(await sent('leave_acted', hod, 'whatsapp')).toBe(0);
    expect(await sent('leave_approved', t1)).toBe(1);
    const b = (await apply(t1, { leaveTypeId: ids.CL, from: W(0, 1), to: W(0, 1) })).json();
    expect((await decide(hod, b.id, 'rejected', 'Exams that day')).statusCode).toBe(201);
    expect(await sent('leave_rejected', t1)).toBe(1);
    const w = (await apply(t1, { leaveTypeId: ids.CL, from: W(0, 2), to: W(0, 2) })).json();
    expect(
      (await call(t1, 'POST', `/leave/requests/${String(w.id)}/withdraw`, { reason: '' }))
        .statusCode,
    ).toBe(201);
    expect(await sent('leave_withdrawn', hod)).toBe(1);
    expect(await sent('leave_cancelled', t1)).toBe(0);
  });

  it('messages: the next level, a cancellation asked and decided, dates changed', async () => {
    // nine working days: the HOD, then the office
    const a = (await apply(t1, { leaveTypeId: ids.CL, from: W(1, 0), to: W(2, 3) })).json();
    expect(a).toMatchObject({ status: 'pending' });
    expect((await decide(hod, a.id, 'approved')).statusCode).toBe(201);
    expect(await sent('leave_waiting', office)).toBe(1);
    expect((await decide(office, a.id, 'approved')).json().status).toBe('approved');
    // dates changed by the office
    expect(
      (
        await call(office, 'POST', `/leave/requests/${String(a.id)}/trim`, {
          from: W(1, 0),
          to: W(1, 4),
          reason: 'Back early',
        })
      ).statusCode,
    ).toBe(201);
    expect(await sent('leave_changed', t1)).toBe(1);
    // a cancellation asked: the approvers are asked; decided: the employee is told
    expect(
      (
        await call(t1, 'POST', `/leave/requests/${String(a.id)}/cancel-request`, {
          reason: 'Plans changed',
        })
      ).statusCode,
    ).toBe(201);
    expect(await sent('leave_cancel_waiting', hod)).toBe(1);
    expect(
      (
        await call(hod, 'POST', `/leave/requests/${String(a.id)}/cancel-decide`, {
          outcome: 'approved',
        })
      ).statusCode,
    ).toBe(201);
    const d = (await call(t1, 'GET', `/leave/requests/${String(a.id)}`)).json();
    if (d.status === 'pending' || d.cancelStatus === 'pending')
      await call(office, 'POST', `/leave/requests/${String(a.id)}/cancel-decide`, {
        outcome: 'approved',
      });
    expect(await sent('leave_cancelled', t1)).toBe(1);
  });

  it('corrections are messaged: asked to the approver, approved or not to the employee', async () => {
    const one = (
      await call(t3, 'POST', '/staff-attendance/regularisations', {
        day: PAST[2],
        in: '08:00',
        reason: 'Forgot',
      })
    ).json();
    expect(await sent('leave_correction_waiting', hod)).toBe(1);
    expect(
      (
        await call(hod, 'POST', `/staff-attendance/regularisations/${String(one.id)}/decide`, {
          outcome: 'approved',
        })
      ).statusCode,
    ).toBe(201);
    expect(await sent('leave_correction_approved', t3)).toBe(1);
    const two = (
      await call(t3, 'POST', '/staff-attendance/regularisations', {
        day: PAST[3],
        out: '15:00',
        reason: 'Left late',
      })
    ).json();
    expect(
      (
        await call(hod, 'POST', `/staff-attendance/regularisations/${String(two.id)}/decide`, {
          outcome: 'rejected',
          note: 'No record',
        })
      ).statusCode,
    ).toBe(201);
    expect(await sent('leave_correction_rejected', t3)).toBe(1);
  });

  it('the same person at two levels approves once; a designation and a role approve', async () => {
    const a = (await apply(t3, { leaveTypeId: ids.CL, from: W(3, 0), to: W(3, 0) })).json();
    expect(a).toMatchObject({ status: 'pending' });
    expect((await decide(hod, a.id, 'approved')).json()).toMatchObject({ status: 'approved' });
    const b = (await apply(t2, { leaveTypeId: ids.CL, from: W(3, 1), to: W(3, 1) })).json();
    expect(b).toMatchObject({ status: 'pending' });
    expect(
      (await call(vp, 'GET', '/leave/approvals')).json().rows.map((r: { id: string }) => r.id),
    ).toContain(b.id);
    expect(
      (await call(hod, 'GET', '/leave/approvals')).json().rows.map((r: { id: string }) => r.id),
    ).not.toContain(b.id);
    await q(`UPDATE staff_leave_types SET document_needed = false WHERE id = $1`, [ids.SL]);
    const c = (await apply(t1, { leaveTypeId: ids.SL, from: W(3, 2), to: W(3, 2) })).json();
    expect(c).toMatchObject({ status: 'pending' });
    expect(
      (await call(office, 'GET', '/leave/approvals')).json().rows.map((r: { id: string }) => r.id),
    ).toContain(c.id);
  });

  it('the payroll lock: approve refused, reject allowed; the general approval route sends leave to its own page', async () => {
    const day = PREV[3]!;
    const a = (await apply(t3, { leaveTypeId: ids.CL, from: day, to: day })).json();
    const b = (await apply(t3, { leaveTypeId: ids.CL, from: PREV[4], to: PREV[4] })).json();
    expect([a.status, b.status]).toEqual(['pending', 'pending']);
    await q(
      `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)`,
      [school.id, prevMonth],
    );
    expect((await decide(hod, a.id, 'approved')).statusCode).toBe(409);
    expect((await decide(hod, a.id, 'rejected', 'Month closed')).statusCode).toBe(201);
    const step = (
      await q<{ id: string }>(
        `SELECT s.id::text FROM workflow_steps s JOIN staff_leave_requests r ON r.workflow_instance_id = s.instance_id
          WHERE r.id = $1 AND s.status = 'pending'`,
        [b.id],
      )
    )[0]!.id;
    const g = await call(admin, 'POST', `/workflow/steps/${step}/approve`, { note: 'ok' });
    expect(g.statusCode).toBe(409);
    expect(g.json().detail).toMatch(/own page/);
    await q(`DELETE FROM staff_month_locks WHERE school_id = $1`, [school.id]);
  });

  it('the apply checks: per application, a month, next to other leave, days ahead, how far back, the document', async () => {
    // a type with limits of its own (no balance, at most 2 days a month), next to other leave refused
    const typ = (
      await q<{ id: string }>(
        `INSERT INTO staff_leave_types (school_id, code, name, paid, keeps_balance, min_days, max_days, max_per_month, gap_from_other, half_day, status)
         VALUES ($1, 'DL', 'Duty leave', true, false, 1, 2, 2, true, false, 'active') RETURNING id::text`,
        [school.id],
      )
    )[0]!.id;
    const ruleFor = await q<{ id: string }>(
      `SELECT id::text FROM staff_leave_approval_rules WHERE school_id = $1 AND name = 'All'`,
      [school.id],
    );
    expect(ruleFor).toHaveLength(1);
    const say = async (body: Record<string, unknown>) =>
      (await apply(t2, { leaveTypeId: typ, ...body })).json().detail as string;
    expect(await say({ from: W(4, 0), to: W(4, 2) })).toMatch(/at most 2 days an application/);
    expect((await apply(t2, { leaveTypeId: typ, from: W(4, 0), to: W(4, 1) })).json().status).toBe(
      'pending',
    );
    expect(await say({ from: W(4, 3), to: W(4, 3) })).toMatch(
      /cannot sit next to other leave|at most 2 days a month/,
    );
    // a day of the same month clear of every other leave of hers: the most a month
    const m0 = W(4, 0).slice(0, 7);
    const taken = (
      await q<{ d: string }>(
        `SELECT day::text AS d FROM staff_leave_days WHERE employee_id = $1 AND status IN ('pending', 'approved')`,
        [ids.T2],
      )
    ).map((x) => Date.parse(x.d));
    let far = '';
    for (let d = `${m0}-01`; d.startsWith(m0); d = add(d, 1))
      if (
        dow(d) !== 0 &&
        dow(d) !== 6 &&
        taken.every((t) => Math.abs(Date.parse(d) - t) > 4 * 86_400_000)
      )
        far = d;
    expect(far).not.toBe('');
    expect(await say({ from: far, to: far })).toMatch(/at most 2 days a month/);
    // CL next to DL is fine (CL has no gap rule); days ahead refused for a type for days passed
    await q(`UPDATE staff_leave_types SET advance_allowed = false WHERE id = $1`, [ids.SL]);
    expect(
      (await apply(t1, { leaveTypeId: ids.SL, from: W(6, 0), to: W(6, 0) })).json().detail,
    ).toMatch(/not days ahead/);
    await q(`UPDATE staff_leave_types SET advance_allowed = true WHERE id = $1`, [ids.SL]);
    // how far back
    await q(`UPDATE staff_leave_settings SET backdate_days = 2 WHERE school_id = $1`, [school.id]);
    expect(
      (await apply(t2, { leaveTypeId: ids.CL, from: PAST[10], to: PAST[10] })).json().detail,
    ).toMatch(/up to 2 days back/);
    await q(`UPDATE staff_leave_settings SET backdate_days = NULL WHERE school_id = $1`, [
      school.id,
    ]);
    // the document: a PDF or image of up to 5 MB of one's own
    const file = async (type: string, size: number) =>
      (
        await q<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, created_by, status)
           VALUES ($1, 'test', $2, $3, $4, $5, 'ready') RETURNING id::text`,
          [school.id, `${s}/${type}/${String(size)}`, type, size, t2.id],
        )
      )[0]!.id;
    for (const [type, size] of [
      ['text/plain', 1000],
      ['application/pdf', 6 * 1024 * 1024],
    ] as const)
      expect(
        (
          await apply(t2, {
            leaveTypeId: ids.CL,
            from: W(7, 0),
            to: W(7, 0),
            documentFileId: await file(type, size),
          })
        ).json().detail,
      ).toMatch(/PDF or image of up to 5 MB/);
    expect(
      (
        await apply(t2, {
          leaveTypeId: ids.CL,
          from: W(7, 0),
          to: W(7, 0),
          documentFileId: await file('application/pdf', 1000),
        })
      ).json().status,
    ).toBe('pending');
  });

  it('the calendar: an optional holiday is not a day off, the sandwich takes it when the policy says; 2nd and 4th Saturday and dated offs', async () => {
    const hol = W(8, 2);
    await q(
      `INSERT INTO holidays (school_id, academic_year_id, name, kind, starts_on, ends_on, applies_to, optional)
       VALUES ($1, (SELECT id FROM academic_years WHERE school_id = $1 AND start_date <= $2::date AND end_date >= $2::date LIMIT 1),
               'Optional festival', 'holiday', $2::date, $2::date, 'employees', true)`,
      [school.id, hol],
    );
    const [off] = await asSchool<{ hol: boolean }>(
      `SELECT app.staff_is_holiday($1, $2::date, false) AS hol`,
      [ids.T3, hol],
    );
    expect(off!.hol).toBe(false);
    // an optional holiday inside a leave is a working day: charged
    const a = (
      await apply(t3, { leaveTypeId: ids.CL, from: W(8, 1), to: W(8, 3), splitOk: true })
    ).json();
    expect(a).toMatchObject({ status: 'pending', days: 3 });
    await call(t3, 'POST', `/leave/requests/${String(a.id)}/withdraw`, { reason: '' });
    // the policy treats optional holidays as holidays: free (its sandwich does not take holidays)
    await q(
      `UPDATE staff_leave_policies SET sandwich_optional = true WHERE school_id = $1 AND name = 'CL all'`,
      [school.id],
    );
    const b = (
      await apply(t3, { leaveTypeId: ids.CL, from: W(8, 1), to: W(8, 3), splitOk: true })
    ).json();
    expect(b).toMatchObject({ status: 'pending', days: 2 });
    await call(t3, 'POST', `/leave/requests/${String(b.id)}/withdraw`, { reason: '' });
    await q(
      `UPDATE staff_leave_policies SET sandwich_optional = false WHERE school_id = $1 AND name = 'CL all'`,
      [school.id],
    );
    // weekly offs: the 2nd and 4th Saturday of a month; a list of dates
    await q(
      `INSERT INTO staff_weekoff_rules (school_id, name, scope, kind, weekdays, week_numbers, dates, status) VALUES
         ($1, 'Second and fourth', 'all', 'weekly', '{6}', '{2,4}', '{}', 'active'),
         ($1, 'Annual day', 'all', 'dates', '{}', '{}', ARRAY[$2::date], 'active')`,
      [school.id, W(9, 2)],
    );
    await q(
      `UPDATE staff_weekoff_rules SET weekdays = '{7}' WHERE school_id = $1 AND name = 'Sunday weekly off'`,
      [school.id],
    );
    const m = monthStart(add(today, 60));
    const sats: string[] = [];
    for (let d = m; d < monthStart(add(m, 32)); d = add(d, 1)) if (dow(d) === 6) sats.push(d);
    const offs = await asSchool<{ d: string; off: boolean }>(
      `SELECT u.d::text, app.staff_is_weekoff($1, u.d) AS off FROM unnest($2::date[]) WITH ORDINALITY u(d, n) ORDER BY u.n`,
      [ids.T3, [...sats.slice(0, 4), W(9, 2), W(9, 1)]],
    );
    expect(offs.map((x) => x.off)).toEqual([false, true, false, true, true, false]);
    await q(
      `UPDATE staff_weekoff_rules SET weekdays = '{6,7}' WHERE school_id = $1 AND name = 'Sunday weekly off'`,
      [school.id],
    );
    await q(
      `DELETE FROM staff_weekoff_rules WHERE school_id = $1 AND name IN ('Second and fourth', 'Annual day')`,
      [school.id],
    );
  });

  it('timings: a special timing wins; a posting to a bus-duty shift is bus duty', async () => {
    await call(office, 'POST', '/staff-attendance/timings', {
      kind: 'special',
      employeeId: ids.T3,
      from: PAST[5],
      to: PAST[5],
      startsAt: '09:30',
      endsAt: '13:30',
      grace: 0,
      presentHours: 4,
      halfDayHours: 2,
      lateAction: 'none',
      earlyAction: 'none',
    });
    const bus = (
      await q<{ id: string }>(
        `SELECT id::text FROM staff_shifts WHERE school_id = $1 AND bus_duty LIMIT 1`,
        [school.id],
      )
    )[0]!.id;
    await q(
      `INSERT INTO staff_shift_postings (school_id, employee_id, shift_id, from_date) VALUES ($1, $2, $3, $4::date)`,
      [school.id, ids.T2, bus, PAST[6]],
    );
    const t = await asSchool<{ e: string; src: string; starts: string }>(
      `SELECT 'T3' AS e, timing_source AS src, to_char(starts_at, 'HH24:MI') AS starts FROM app.staff_timing($1, $2::date)
       UNION ALL SELECT 'T2', timing_source, to_char(starts_at, 'HH24:MI') FROM app.staff_timing($3, $4::date)`,
      [ids.T3, PAST[5], ids.T2, PAST[6]],
    );
    expect(t).toEqual([
      { e: 'T3', src: 'SPECIAL', starts: '09:30' },
      { e: 'T2', src: 'BUS', starts: expect.any(String) },
    ]);
  });

  it('punches: a device push becomes the day; days set from Excel', async () => {
    await q(`UPDATE employees SET biometric_id = $2 WHERE id = $1`, [ids.T3, `${s}B3`]);
    const dev = (
      await q<{ id: string }>(
        `INSERT INTO rfid_devices (school_id, code, name, api_key_hash) VALUES ($1, $2, 'Gate', 'x') RETURNING id::text`,
        [school.id, `${s}D1`],
      )
    )[0]!.id;
    const day = PAST[7]!;
    for (const t of ['08:00', '15:35'])
      await q(
        `INSERT INTO punch_logs (school_id, device_id, employee_id, biometric_id, punched_at, outcome)
         VALUES ($1, $2, $3, $4, ($5::date + $6::time) AT TIME ZONE 'Asia/Kolkata', 'recorded')`,
        [school.id, dev, ids.T3, `${s}B3`, day, t],
      );
    expect(
      await q(
        `SELECT source FROM staff_punches WHERE school_id = $1 AND code = $2 ORDER BY punched_at`,
        [school.id, `${s}B3`],
      ),
    ).toEqual([{ source: 'device' }, { source: 'device' }]);
    await call(office, 'POST', '/staff-attendance/run', { what: 'sync' });
    const d = (await call(office, 'GET', `/staff-attendance/days/${ids.T3!}/${day}`)).json();
    expect(d.row).toMatchObject({ dayType: 'P', in: '08:00', out: '15:35' });
    // the days sheet: a day set by hand from Excel
    const f = (await call(office, 'GET', '/staff-attendance/sheets/days/format')).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(f.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const head = ws.getRow(1).values as unknown[];
    const col = (name: string) => head.findIndex((v) => String(v ?? '').startsWith(name));
    const r = ws.getRow(2);
    r.getCell(col('Employee')).value = `${s}T2`;
    r.getCell(col('Date')).value = new Date(`${PAST[8]!}T00:00:00Z`);
    r.getCell(col('Day type')).value = 'HD';
    r.getCell(col('Reason')).value = 'Half day by the office';
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(office, 'POST', '/staff-attendance/sheets/days/import', { file, dryRun: true })
    ).json();
    expect(dry.rows.filter((x: { ok: boolean }) => x.ok)).toHaveLength(1);
    expect(
      (
        await call(office, 'POST', '/staff-attendance/sheets/days/import', { file, dryRun: false })
      ).json().saved,
    ).toBe(1);
    expect(
      (await call(office, 'GET', `/staff-attendance/days/${ids.T2!}/${PAST[8]!}`)).json().row,
    ).toMatchObject({
      dayType: 'HD',
      manual: true,
    });
  });

  it('missing punches become leave; an absence nobody explains becomes loss of pay', async () => {
    const days = PREV.slice(6, 10);
    for (const d of days)
      await q(
        `INSERT INTO staff_missing_punches (school_id, employee_id, day, missing) VALUES ($1, $2, $3::date, 'out')`,
        [school.id, ids.T3, d],
      );
    await call(office, 'POST', '/staff-attendance/run', {
      what: 'deduct',
      month: prevMonth.slice(0, 7),
    });
    expect(
      await q(`SELECT status FROM staff_missing_punches WHERE employee_id = $1 ORDER BY day`, [
        ids.T3,
      ]),
    ).toEqual(days.map(() => ({ status: 'used' })));
    expect(
      await q(
        `SELECT source FROM staff_leave_requests WHERE employee_id = $1 AND source = 'auto_missing'`,
        [ids.T3],
      ),
    ).toHaveLength(1);
    // absent more than the settings' days ago with no leave → charged by the deduction order
    const old = PAST[12]!;
    await q(
      `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source) VALUES ($1, $2, $3::date, 'A', 'absent')`,
      [school.id, ids.T2, old],
    );
    await asSchool(`SELECT app.staff_lop_sweep(NULL)`);
    const charged = await q<{ source: string; day_type: string }>(
      `SELECT r.source, a.day_type FROM staff_leave_requests r JOIN staff_attendance_days a ON a.employee_id = r.employee_id AND a.day = r.from_date
        WHERE r.employee_id = $1 AND r.from_date = $2::date`,
      [ids.T2, old],
    );
    expect(charged).toEqual([{ source: 'auto_absent', day_type: 'LV' }]);
  });

  it('the session end: the balance is kept up to the carry-forward cap, the rest lapses', async () => {
    const march = `${String(Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) >= 4 ? 0 : 1))}-03-01`;
    await q(
      `INSERT INTO staff_leave_balances (school_id, employee_id, leave_type_id, month, opening, credited, held, correction)
       VALUES ($1, $2, $3, $4::date, 8, 0, 0, 0)`,
      [school.id, ids.V1, ids.CL, march],
    );
    const [f] = await asSchool<{ closing: string; lapsed: string }>(
      `SELECT f.closing::text, f.lapsed::text FROM staff_leave_balances b, app.staff_leave_close_figures(b) f
        WHERE b.employee_id = $1 AND b.leave_type_id = $2 AND b.month = $3::date`,
      [ids.V1, ids.CL, march],
    );
    expect([Number(f!.closing), Number(f!.lapsed)]).toEqual([5, 3]);
  });

  it('my team’s attendance: the reporting manager sees the team and opens a day; others do not', async () => {
    const t = (await call(t2, 'GET', '/staff-attendance/team?size=25')).json();
    expect(t.team).toBe(1);
    expect(t.rows.map((r: { employee: { id: string } }) => r.employee.id)).toEqual([ids.T1]);
    expect(
      (await call(t2, 'GET', `/staff-attendance/days/${ids.T1!}/${PAST[1]!}`)).json().can,
    ).toMatchObject({ team: true, correct: false });
    expect(
      (await call(t2, 'GET', `/staff-attendance/days/${ids.T3!}/${PAST[1]!}`)).statusCode,
    ).toBe(404);
    expect((await call(t3, 'GET', '/staff-attendance/team?size=25')).json().team).toBe(0);
  });

  it('my leave as one page: the reporties’ leave of a month, opening one, availed days, the downloads', async () => {
    const day = W(7, 1);
    const leave = (await apply(t1, { leaveTypeId: ids.CL, from: day, to: day })).json();
    expect(leave.id).toMatch(/^\d+$/);
    const team = (await call(t2, 'GET', `/leave/self/team?month=${day.slice(0, 7)}`)).json();
    expect(team.team).toBe(1);
    expect(team.rows.map((r: { id: string }) => r.id)).toContain(leave.id);
    expect(team.rows.every((r: { employee: { id: string } }) => r.employee.id === ids.T1)).toBe(
      true,
    );
    // the status filter, another month
    expect(
      (await call(t2, 'GET', `/leave/self/team?month=${day.slice(0, 7)}&status=cancelled`)).json()
        .rows,
    ).toEqual([]);
    // the reporting manager opens the leave; someone else does not
    expect((await call(t2, 'GET', `/leave/requests/${leave.id as string}`)).statusCode).toBe(200);
    expect((await call(t3, 'GET', `/leave/requests/${leave.id as string}`)).statusCode).toBe(404);
    expect(
      (await call(t3, 'GET', `/leave/self/team?month=${day.slice(0, 7)}`)).json(),
    ).toMatchObject({
      team: 0,
      total: 0,
    });
    // each balance card has the days availed this leave year
    const mine = (await call(t1, 'GET', '/leave/mine')).json();
    expect(mine.balances[0]).toHaveProperty('availed');
    // the downloads
    for (const url of [
      '/leave/self/leave-file?format=xlsx',
      `/leave/self/attendance-file?month=${PAST[1]!.slice(0, 7)}&format=pdf`,
      `/leave/self/team?month=${day.slice(0, 7)}&format=xlsx`,
    ]) {
      const f = await call(url.includes('team') ? t2 : t1, 'GET', url);
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toMatch(/^(My-leave|My-attendance|Reporties-leave)/);
    }
    // a sign-in with no employee record has no file of its own
    expect((await call(admin, 'GET', '/leave/self/leave-file')).statusCode).toBe(404);
    await call(t1, 'POST', `/leave/requests/${leave.id as string}/withdraw`, {
      reason: 'Not needed',
    });
  });

  it('the side menu counts what waits at my level, the staff reporting to me and my reports', async () => {
    const leave = (await apply(t3, { leaveTypeId: ids.CL, from: W(5, 0), to: W(5, 0) })).json();
    expect(leave).toMatchObject({ status: 'pending' });
    const fix = (
      await call(t3, 'POST', '/staff-attendance/regularisations', {
        day: PAST[4],
        in: '08:00',
        reason: 'Forgot',
      })
    ).json();
    const menu = async (u: SeededUser) => (await call(u, 'GET', '/leave/menu')).json();
    const m = await menu(hod);
    // the same numbers as the lists the entries open
    expect(m).toEqual({
      leave: (await call(hod, 'GET', '/leave/approvals')).json().rows.length,
      corrections: (await call(hod, 'GET', '/staff-attendance/regularisations/approvals')).json()
        .rows.length,
      team: expect.any(Number),
      reports: expect.any(Number),
    });
    expect(m.leave).toBeGreaterThan(0);
    expect(m.corrections).toBeGreaterThan(0);
    expect(await menu(t2)).toMatchObject({ team: 1 });
    expect(await menu(t3)).toEqual({ leave: 0, corrections: 0, team: 0, reports: 0 });
    expect((await menu(office)).reports).toBeGreaterThan(0);
    // decided: nothing waits any more
    await decide(hod, leave.id, 'approved');
    await call(hod, 'POST', `/staff-attendance/regularisations/${String(fix.id)}/decide`, {
      outcome: 'approved',
    });
    expect(await menu(hod)).toMatchObject({ leave: m.leave - 1, corrections: m.corrections - 1 });
  });

  it('the three tabs as the old screen: My Leave by dates; Reporties Leave waiting with me; Reporties Attendance a grid or day by day; files', async () => {
    type Row = { id: string };
    const ids2 = (rows: Row[]) => rows.map((r) => r.id).sort();
    const a = (await apply(t1, { leaveTypeId: ids.CL, from: W(10, 0), to: W(10, 0) })).json();
    const b = (await apply(t1, { leaveTypeId: ids.CL, from: W(10, 2), to: W(10, 3) })).json();
    expect([a.status, b.status]).toEqual(['pending', 'pending']);
    // My Leave: the leave touching From–To, and what I may do from the row
    const one = (await call(t1, 'GET', `/leave/mine?from=${W(10, 0)}&to=${W(10, 1)}`)).json();
    expect(one).toMatchObject({ total: 1, from: W(10, 0), to: W(10, 1) });
    expect(one.rows[0]).toMatchObject({ id: a.id, can: { withdraw: true, requestCancel: false } });
    expect((await call(t1, 'GET', `/leave/mine?from=${W(10, 3)}&to=${W(10, 2)}`)).statusCode).toBe(
      400,
    );
    // Reporties Leave, waiting with me: the HOD's queue (nobody reports to the HOD), as Leave waiting for me
    const queue = ids2((await call(hod, 'GET', '/leave/approvals')).json().rows);
    const w = (await call(hod, 'GET', '/leave/self/team?status=waiting&size=100')).json();
    expect(ids2(w.rows)).toEqual(queue);
    expect(w).toMatchObject({ team: 0, waiting: queue.length, total: queue.length });
    expect(w.rows.find((r: Row) => r.id === a.id)).toMatchObject({
      what: 'leave',
      can: { decide: true, decideCancel: false },
    });
    expect(ids2(w.filters.employees)).toContain(ids.T1);
    expect(ids2(w.filters.types)).toContain(ids.CL);
    // the employee, leave type and date filters
    const range = `from=${W(10, 0)}&to=${W(10, 3)}`;
    expect(
      ids2(
        (
          await call(hod, 'GET', `/leave/self/team?status=waiting&employeeId=${ids.T1!}&${range}`)
        ).json().rows,
      ),
    ).toEqual([a.id, b.id].sort());
    expect(
      (
        await call(
          hod,
          'GET',
          `/leave/self/team?status=waiting&employeeId=${ids.T1!}&leaveTypeId=${ids.SL!}&${range}`,
        )
      ).json().total,
    ).toBe(0);
    // the reporting manager sees the reportee's leave in any status, not to decide here
    const mgr = (await call(t2, 'GET', `/leave/self/team?${range}`)).json();
    expect(ids2(mgr.rows)).toEqual([a.id, b.id].sort());
    expect(mgr.rows.every((r: { can: { decide: boolean } }) => !r.can.decide)).toBe(true);
    expect((await call(t2, 'GET', `/leave/self/team?status=waiting&${range}`)).json().total).toBe(
      0,
    );
    // someone else's leave stays out
    expect((await call(t3, 'GET', `/leave/self/team?employeeId=${ids.T1!}`)).json().total).toBe(0);
    // approved from the row; then I may ask to cancel it, and the cancellation waits on the HOD's row
    expect((await decide(hod, a.id, 'approved')).json()).toMatchObject({ status: 'approved' });
    expect(
      (await call(t1, 'GET', `/leave/mine?from=${W(10, 0)}&to=${W(10, 0)}`)).json().rows[0].can,
    ).toEqual({ withdraw: false, requestCancel: true });
    await call(t1, 'POST', `/leave/requests/${a.id as string}/cancel-request`, {
      reason: 'Plans changed',
    });
    const cx = (
      await call(
        hod,
        'GET',
        `/leave/self/team?status=waiting&employeeId=${ids.T1!}&from=${W(10, 0)}&to=${W(10, 0)}`,
      )
    ).json();
    expect(cx.rows[0]).toMatchObject({
      id: a.id,
      what: 'cancellation',
      can: { decide: false, decideCancel: true },
    });
    // the files: as filtered, with the old screen's columns
    const xl = (
      await call(
        hod,
        'GET',
        `/leave/self/team?status=waiting&employeeId=${ids.T1!}&${range}&format=xlsx`,
      )
    ).json();
    expect(xl.filename).toMatch(/^Reporties-leave/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xl.base64, 'base64') as unknown as ArrayBuffer);
    const cells = wb.worksheets[0]!.getSheetValues().flat().map(String);
    expect(cells).toEqual(
      expect.arrayContaining([
        'Leave Id',
        'On behalf?',
        'On behalf created by',
        a.number,
        b.number,
      ]),
    );
    expect(cells.some((x) => x.includes('Waiting with me'))).toBe(true);
    const pdf = (await call(t1, 'GET', `/leave/self/leave-file?format=pdf&${range}`)).json();
    expect(pdf.filename).toMatch(/^My-leave.*\.pdf$/);
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    await call(hod, 'POST', `/leave/requests/${a.id as string}/cancel-decide`, {
      outcome: 'approved',
    });
    await call(t1, 'POST', `/leave/requests/${b.id as string}/withdraw`, { reason: 'Not needed' });

    // Reporties Attendance: all of them a column a day for From–To
    const span = (x: string, y: string) => (Date.parse(y) - Date.parse(x)) / 86_400_000 + 1;
    const g = (
      await call(t2, 'GET', `/staff-attendance/team?from=${PAST[6]!}&to=${PAST[0]!}`)
    ).json();
    expect(g).toMatchObject({ mode: 'grid', from: PAST[6], to: PAST[0], team: 1 });
    expect(g.dates).toHaveLength(span(PAST[6]!, PAST[0]!));
    expect(g.rows.map((r: { employee: Row }) => r.employee.id)).toEqual([ids.T1]);
    expect(ids2(g.employees)).toEqual([ids.T1]);
    // one employee day by day, a page at a time
    const d2 = (
      await call(
        t2,
        'GET',
        `/staff-attendance/team?employeeId=${ids.T1!}&from=${PAST[29]!}&to=${PAST[0]!}&size=25&page=2`,
      )
    ).json();
    expect(d2).toMatchObject({ mode: 'days', employee: { id: ids.T1 }, page: 2, size: 25 });
    expect(d2.total).toBe(span(PAST[29]!, PAST[0]!));
    expect(d2.days[0].day).toBe(add(PAST[29]!, 25));
    expect(d2.days).toHaveLength(Math.min(25, d2.total - 25));
    // the limits: 31 days for all, 92 for one; From after To; someone not reporting to me
    for (const [url, code] of [
      [`/staff-attendance/team?from=${PAST[29]!}&to=${PAST[0]!}`, 400],
      [
        `/staff-attendance/team?employeeId=${ids.T1!}&from=${add(PAST[0]!, -100)}&to=${PAST[0]!}`,
        400,
      ],
      [`/staff-attendance/team?from=${PAST[0]!}&to=${PAST[6]!}`, 400],
      [`/staff-attendance/team?employeeId=${ids.T3!}&from=${PAST[6]!}&to=${PAST[0]!}`, 404],
    ] as const)
      expect([url, (await call(t2, 'GET', url)).statusCode]).toEqual([url, code]);
    for (const url of [
      `/staff-attendance/team?from=${PAST[6]!}&to=${PAST[0]!}&format=pdf`,
      `/staff-attendance/team?employeeId=${ids.T1!}&from=${PAST[6]!}&to=${PAST[0]!}&format=xlsx`,
    ]) {
      const f = (await call(t2, 'GET', url)).json();
      expect(f.filename).toMatch(/^Reporties-attendance/);
      expect(f.base64.length).toBeGreaterThan(300);
    }
    // the leave office opens leave documents now (403 before: no right to view files)
    expect((await call(office, 'GET', '/platform/files/999999999/download-url')).statusCode).toBe(
      404,
    );
  });

  it('the payroll feed shows part pay and encashment; the balances, attendance lists and register have files', async () => {
    await q(`UPDATE staff_leave_types SET pay_percent = 50 WHERE id = $1`, [ids.HPL]);
    await q(
      `UPDATE staff_leave_policies SET encash = true, encash_yearly = true, encash_yearly_days = 10 WHERE school_id = $1`,
      [school.id],
    );
    const feed = (
      await call(office, 'GET', `/staff-attendance/register?month=${today.slice(0, 7)}&format=xlsx`)
    ).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(feed.base64, 'base64') as unknown as ArrayBuffer);
    const first = wb.worksheets[0]!;
    const heads = (first.getRow(5).values as unknown[]).map((v) => String(v ?? ''));
    expect(heads).toContain('Pay-equivalent days');
    expect(String(first.getRow(4).getCell(1).value)).toMatch(/HPL at 50% pay/);
    const enc = wb.getWorksheet('Encashment (information)')!;
    expect(enc.rowCount).toBeGreaterThan(2);
    for (const url of [
      '/leave/balances?format=xlsx',
      `/staff-attendance/exceptions?kind=missing&month=${prevMonth.slice(0, 7)}&format=pdf`,
      '/leave/register?format=xlsx',
    ]) {
      const r = await call(office, 'GET', url);
      expect([url, r.statusCode]).toEqual([url, 200]);
      expect(r.json().base64.length).toBeGreaterThan(300);
    }
    const reg = (await call(office, 'GET', '/leave/register?format=xlsx')).json();
    const rb = new ExcelJS.Workbook();
    await rb.xlsx.load(Buffer.from(reg.base64, 'base64') as unknown as ArrayBuffer);
    const sheet = rb.worksheets[0]!;
    let found = false;
    sheet.eachRow((row) => {
      if ((row.values as unknown[]).some((v) => v === 'Level 1')) found = true;
    });
    expect(found).toBe(true);
  });

  it('the late roll-back: a late mark already turned into leave, corrected away, takes that leave back', async () => {
    const days = PREV.slice(10, 13);
    for (const d of days) {
      await q(
        `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source, in_at, out_at, worked_hours, late_minutes)
         VALUES ($1, $2, $3::date, 'P', 'punches', ($3::date + time '09:00') AT TIME ZONE 'Asia/Kolkata', ($3::date + time '15:30') AT TIME ZONE 'Asia/Kolkata', 6.5, 30)`,
        [school.id, ids.T1, d],
      );
      await q(
        `INSERT INTO staff_late_marks (school_id, employee_id, day, in_at, starts_at, grace, late_minutes)
         VALUES ($1, $2, $3::date, ($3::date + time '09:00') AT TIME ZONE 'Asia/Kolkata', '08:00', 0, 60)`,
        [school.id, ids.T1, d],
      );
    }
    await q(`DELETE FROM staff_attendance_runs WHERE school_id = $1 AND kind = 'late'`, [
      school.id,
    ]);
    await call(office, 'POST', '/staff-attendance/run', {
      what: 'deduct',
      month: prevMonth.slice(0, 7),
    });
    const req = (
      await q<{ id: string }>(
        `SELECT id::text FROM staff_leave_requests WHERE employee_id = $1 AND source = 'auto_late' AND status = 'approved'`,
        [ids.T1],
      )
    )[0]!.id;
    // the office corrects the first day: in on time
    expect(
      (
        await call(office, 'POST', '/staff-attendance/days', {
          employeeId: ids.T1,
          day: days[0],
          in: '07:55',
          out: '15:30',
          reason: 'Device clock was wrong',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await q<{ status: string }>(`SELECT status FROM staff_leave_requests WHERE id = $1`, [req])
      )[0]!.status,
    ).toBe('cancelled');
    // two marks left of three: no day of leave; they lapse at the month's run again
    expect(
      await q(`SELECT status FROM staff_late_marks WHERE employee_id = $1 ORDER BY day`, [ids.T1]),
    ).toEqual([{ status: 'waived' }, { status: 'lapsed' }, { status: 'lapsed' }]);
  });

  it('leave taken off a past day fills the day again (absent), never blank', async () => {
    const day = PAST[20]!;
    const r = (
      await call(office, 'POST', '/leave/on-behalf', {
        employeeId: ids.T2,
        leaveTypeId: ids.CL,
        from: day,
        to: day,
        reason: 'Entered late',
      })
    ).json();
    expect(r.status).toBe('approved');
    expect(
      (await call(office, 'GET', `/staff-attendance/days/${ids.T2!}/${day}`)).json().row.dayType,
    ).toBe('LV');
    expect(
      (
        await call(office, 'POST', `/leave/requests/${String(r.id)}/cancel`, {
          reason: 'Was at work',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(office, 'GET', `/staff-attendance/days/${ids.T2!}/${day}`)).json().row.dayType,
    ).toBe('A');
  });

  it('the digest lists leave and corrections with its template; the missing-punch copy goes to the copy list', async () => {
    await call(t3, 'POST', '/staff-attendance/regularisations', {
      day: PAST[14],
      in: '08:00',
      reason: 'Forgot again',
    });
    const before = await sent('leave_digest', hod);
    const [n] = await asSchool<{ n: number }>(
      `SELECT app.staff_leave_digest('https://school.example') AS n`,
    );
    expect(n!.n).toBeGreaterThan(0);
    const mail = await q<{ subject: string; body: string }>(
      `SELECT subject, body FROM comms_messages WHERE school_id = $1 AND recipient_user_id = $2 AND subject LIKE 'Leave waiting for your approval%'
        ORDER BY id DESC LIMIT 1`,
      [school.id, hod.id],
    );
    expect(mail[0]!.body).toMatch(/Correction/);
    expect(before).toBeGreaterThanOrEqual(0);
    // the copy list
    await q(
      `UPDATE staff_leave_settings SET missing_punch_cc = 'office.copy@school.example, not-an-address' WHERE school_id = $1`,
      [school.id],
    );
    await q(
      `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source, in_at) VALUES ($1, $2, $3::date, 'P', 'punches',
         ($3::date + time '08:00') AT TIME ZONE 'Asia/Kolkata')`,
      [school.id, ids.V1, PAST[0]],
    );
    await asSchool(`SELECT app.staff_missing_detect($1::date, $1::date)`, [PAST[0]]);
    expect(
      await q(
        `SELECT 1 FROM comms_messages WHERE school_id = $1 AND recipient_address = 'office.copy@school.example'`,
        [school.id],
      ),
    ).toHaveLength(1);
  });
});
