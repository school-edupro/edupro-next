/**
 * Staff leave (docs/design/85, phase B): applying with the earlier module's checks (the paid + loss-of-pay
 * split, the sandwich and the bridge, overlap, half days, gender, documents, nobody to approve, the payroll
 * lock), approving through Who approves (the employee's own level passes on), withdraw, reject, the
 * cancellation request, the office's trim, decision and entry, the register, the balances and the month.
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
/** the Monday on or after the day */
const monday = (d: string) => add(d, (8 - new Date(`${d}T00:00:00Z`).getUTCDay()) % 7);
// weeks of working days well ahead (Saturday and Sunday are off in this school)
const W = (week: number, day: 0 | 1 | 2 | 3 | 4 | 5 | 6) =>
  add(monday(add(today, 14)), week * 7 + day);

describe('staff leave requests (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let hod: SeededUser;
  let t1: SeededUser;
  let t2: SeededUser;
  let acc: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('LR');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const apply = (u: SeededUser, body: Record<string, unknown>) =>
    call(u, 'POST', '/leave/apply', { reason: 'Family work', ...body });
  const balance = async (u: SeededUser, code: string) =>
    (await call(u, 'GET', '/leave/mine'))
      .json()
      .balances.find((b: { code: string }) => b.code === code);
  const detail = (u: SeededUser, id: string | undefined) =>
    call(u, 'GET', `/leave/requests/${id ?? '0'}`).then((r) => r.json());

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      hod = await seedUser(c, school, `${s}-hod`, 'class_teacher');
      t1 = await seedUser(c, school, `${s}-t1`, 'subject_teacher');
      t2 = await seedUser(c, school, `${s}-t2`, 'subject_teacher');
      acc = await seedUser(c, school, `${s}-ac`, 'accountant');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(
        `INSERT INTO departments (school_id, code, name, staff_group) VALUES ($1, 'science', 'Science', 'teaching')`,
        [school.id],
      );
      for (const [code, name, dept, gender, u] of [
        ['O1', 'Om Office', 'Administration', 'male', office],
        ['H1', 'Hari Head', 'Science', 'male', hod],
        ['T1', 'Tara Teacher', 'Science', 'female', t1],
        ['T2', 'Tarun Teacher', 'Science', 'male', t2],
        ['A1', 'Asha Accounts', 'Accounts', 'female', acc],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, employee_type, gender, user_id)
             VALUES ($1, $2, $3, 'E2E', 'Staff', $4, 'teaching', $5, $6) RETURNING id::text`,
            [school.id, `${s}${code}`, name, dept, gender, u.id],
          )
        ).rows[0]!.id;
      await c.query(
        `UPDATE departments SET hod_employee_id = $2 WHERE school_id = $1 AND name = 'Science'`,
        [school.id, ids.H1],
      );
    });
    app = await createApp();
    inject = injector(app);
    // the set-up: the defaults, Saturday and Sunday off, CL (no sandwich) and EL (sandwich) for all staff
    await call(office, 'GET', '/leave/setup/overview');
    await withMigrator((c) =>
      c.query(`UPDATE staff_weekoff_rules SET weekdays = '{6,7}' WHERE school_id = $1`, [
        school.id,
      ]),
    );
    const types = (await call(office, 'GET', '/masters/staff_leave_types/rows?size=50')).json()
      .data;
    for (const t of types as Array<{ code: string; id: string }>) ids[t.code] = t.id;
    const policy = (values: Record<string, unknown>) =>
      call(office, 'POST', '/masters/staff_leave_policies/rows', { values });
    expect(
      (
        await policy({
          name: 'CL all',
          leave_type_id: 'CL',
          scope: 'all',
          annual_days: 12,
          credit: 'H',
        })
      ).statusCode,
    ).toBeLessThan(300);
    expect(
      (
        await policy({
          name: 'EL all',
          leave_type_id: 'EL',
          scope: 'all',
          annual_days: 15,
          credit: 'Y',
          carry_forward: true,
          sandwich_weekoff: true,
          sandwich_holiday: true,
        })
      ).statusCode,
    ).toBeLessThan(300);
    const rule = (
      await call(office, 'POST', '/leave/setup/approvals', {
        kind: 'leave',
        name: 'All',
        scope: 'all',
      })
    ).json();
    await call(office, 'PUT', `/leave/setup/approvals/${rule.id}/bands/0`, {
      levels: [{ name: 'HOD', by: 'hod', employeeIds: [] }],
    });
    await call(office, 'PUT', `/leave/setup/approvals/${rule.id}/bands/1`, {
      levels: [
        { name: 'HOD', by: 'hod', employeeIds: [] },
        { name: 'Office', by: 'employees', employeeIds: [ids.O1] },
      ],
    });
    for (const [emp, type, days] of [
      ['T1', 'CL', 3],
      ['T1', 'EL', 5],
      ['T2', 'CL', 4],
      ['H1', 'CL', 2],
      ['A1', 'CL', 1],
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
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
  });

  it('short of balance: the paid part + loss of pay, shown first; the HOD approves both; the activity log knows', async () => {
    const ask = await apply(t1, { leaveTypeId: ids.CL, from: W(0, 0), to: W(0, 4) });
    expect(ask.json().confirm).toMatchObject({ kind: 'split', paid: 3, lop: 2 });
    const r = (
      await apply(t1, { leaveTypeId: ids.CL, from: W(0, 0), to: W(0, 4), splitOk: true })
    ).json();
    expect(r).toMatchObject({ status: 'pending', days: 5 });
    expect(r.lopNumber).toMatch(/^LV\//);
    ids.SPLIT = r.id;
    const d = await detail(t1, r.id);
    expect(d.dayRows.map((x: { portion: number }) => x.portion)).toEqual([1, 1, 1, 1, 1]);
    expect(d.lopPart).toMatchObject({ days: 2, leaveType: { code: 'LOP' } });
    expect(d.can).toMatchObject({ withdraw: true, decide: false });
    expect(await balance(t1, 'CL')).toMatchObject({ available: 0, held: 3 });
    // waiting with the HOD, who is told
    const waiting = (await call(hod, 'GET', '/leave/approvals')).json().rows;
    expect(waiting.map((x: { id: string }) => x.id)).toContain(r.id);
    const told = await withMigrator((c) =>
      c.query(
        `SELECT 1 FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = 'leave_waiting' AND m.recipient_user_id = $2`,
        [school.id, hod.id],
      ),
    );
    expect(told.rowCount).toBeGreaterThan(0);
    expect(
      (await call(t1, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(hod, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'rejected' }))
        .statusCode,
    ).toBe(400);
    const ok = (
      await call(hod, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'approved' })
    ).json();
    expect(ok.status).toBe('approved');
    expect((await detail(t1, d.lopPart.id)).status).toBe('approved');
    const logs = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM activity_logs WHERE employee_id = $1 AND leave_kind = 'full' AND on_date BETWEEN $2 AND $3`,
        [ids.T1, W(0, 0), W(0, 4)],
      ),
    );
    expect(logs.rows[0]!.n).toBe(5);
  });

  it('the sandwich: weekly offs between leave days count where the policy says; the bridge to a leave nearby is asked first', async () => {
    // EL (sandwich on) Friday to Monday: 4 days; CL (no sandwich) the same: 2
    const el = (await apply(t2, { leaveTypeId: ids.EL, from: W(1, 4), to: W(2, 0) })).json();
    expect(el.confirm?.kind).toBe('split'); // T2 has no EL
    const cl = (await apply(t2, { leaveTypeId: ids.CL, from: W(1, 4), to: W(2, 0) })).json();
    expect(cl).toMatchObject({ status: 'pending', days: 2 });
    ids.T2CL = cl.id;
    // T1: EL on Friday, then EL on Monday — Saturday and Sunday between belong to the second
    const fri = (await apply(t1, { leaveTypeId: ids.EL, from: W(3, 4), to: W(3, 4) })).json();
    expect(fri).toMatchObject({ status: 'pending', days: 1 });
    const mon = (await apply(t1, { leaveTypeId: ids.EL, from: W(4, 0), to: W(4, 0) })).json();
    expect(mon.confirm).toMatchObject({ kind: 'bridge', from: W(3, 5), to: W(4, 0) });
    const mon2 = (
      await apply(t1, { leaveTypeId: ids.EL, from: W(4, 0), to: W(4, 0), bridgeOk: true })
    ).json();
    expect(mon2).toMatchObject({ status: 'pending', days: 3 });
    expect(mon2.note).toContain('next to other leave counted');
    ids.BRIDGE = mon2.id;
    expect((await detail(t1, mon2.id)).from).toBe(W(3, 5));
    expect(await balance(t1, 'EL')).toMatchObject({ available: 1, held: 4 });
  });

  it('refuses overlap (the other half of a day allowed), a type not for men, a missing document, nobody to approve, a locked month', async () => {
    const clash = await apply(t1, { leaveTypeId: ids.CL, from: W(0, 2), to: W(0, 2) });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().detail).toContain('already covers');
    const h1 = await apply(t2, {
      leaveTypeId: ids.CL,
      from: W(5, 1),
      to: W(5, 1),
      halfDay: true,
      session: 'first',
    });
    expect(h1.json()).toMatchObject({ status: 'pending', days: 0.5 });
    const h2 = await apply(t2, {
      leaveTypeId: ids.CL,
      from: W(5, 1),
      to: W(5, 1),
      halfDay: true,
      session: 'second',
    });
    expect(h2.json().days).toBe(0.5);
    expect(
      (
        await apply(t2, {
          leaveTypeId: ids.CL,
          from: W(5, 1),
          to: W(5, 1),
          halfDay: true,
          session: 'first',
        })
      ).statusCode,
    ).toBe(409);
    const ml = await apply(t2, { leaveTypeId: ids.ML, from: W(6, 0), to: W(6, 0) });
    expect(ml.json().detail).toContain('is not for men');
    const sl = await apply(t1, { leaveTypeId: ids.SL, from: W(6, 0), to: W(6, 0) });
    expect(sl.json().detail).toContain('needs a document');
    // Accounts has no HOD: the only level is skipped, nobody approves — nothing is kept
    const nobody = await apply(acc, { leaveTypeId: ids.CL, from: W(6, 1), to: W(6, 1) });
    expect(nobody.statusCode).toBe(409);
    expect(await balance(acc, 'CL')).toMatchObject({ available: 1, held: 0 });
    expect(
      (await apply(t1, { leaveTypeId: ids.LOP, from: W(6, 2), to: W(6, 2) })).json().detail,
    ).toContain('Loss of pay is not applied for');
    // a month after every other date of this file (week 9 at most), whatever day the tests run
    await withMigrator((c) =>
      c.query(
        `INSERT INTO staff_month_locks (school_id, month) VALUES ($1, date_trunc('month', $2::date))`,
        [school.id, W(20, 0)],
      ),
    );
    const locked = await apply(t1, { leaveTypeId: ids.EL, from: W(20, 0), to: W(20, 0) });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().detail).toContain('locked for payroll');
  });

  it('the HOD’s own leave: their level passes on to the school admin', async () => {
    const r = (await apply(hod, { leaveTypeId: ids.CL, from: W(7, 0), to: W(7, 0) })).json();
    expect(r.status).toBe('pending');
    const d = await detail(hod, r.id);
    expect(d.waitingWith).toContain(`${s}-ad`);
    expect(
      (await call(hod, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(admin, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'approved' })).json()
        .status,
    ).toBe('approved');
  });

  it('a level of two who must both approve; the same person at the next level is not asked again', async () => {
    // A1's own rule: L1 the office and the HOD, both; L2 the HOD again
    const rule = (
      await call(office, 'POST', '/leave/setup/approvals', {
        kind: 'leave',
        name: 'Asha: both, then the HOD',
        scope: 'employee',
        scopeValues: [`${s}A1`],
        priority: 1,
      })
    ).json();
    const set = await call(office, 'PUT', `/leave/setup/approvals/${rule.id}/bands/0`, {
      levels: [
        { name: 'Office and HOD', by: 'employees', employeeIds: [ids.O1, ids.H1], need: 'all' },
        { name: 'HOD', by: 'employees', employeeIds: [ids.H1] },
      ],
    });
    expect(set.statusCode).toBeLessThan(300);
    const shown = (await call(office, 'GET', `/leave/setup/approvals/${rule.id}`)).json();
    expect(shown.bands[0].levels.map((l: { need: string }) => l.need)).toEqual(['all', 'any']);
    await call(office, 'POST', '/leave/balances/adjust', {
      employeeId: ids.A1,
      leaveTypeId: ids.CL,
      days: 1,
      reason: 'For the two-approver test',
    });
    const r = (await apply(acc, { leaveTypeId: ids.CL, from: W(9, 3), to: W(9, 3) })).json();
    expect(r.status).toBe('pending');
    // the HOD approves first: the office has not, so it still waits at L1
    expect(
      (await call(hod, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'approved' })).json()
        .status,
    ).toBe('pending');
    // the office approves: L1 is done, and L2 (the HOD, who approved already) passes by itself
    expect(
      (await call(office, 'POST', `/leave/requests/${r.id}/decide`, { outcome: 'approved' })).json()
        .status,
    ).toBe('approved');
    await call(office, 'POST', `/leave/setup/approvals/${rule.id}/status`, { status: 'inactive' });
  });

  it('withdraw and reject give the balance back; a cancellation request of an approved leave goes through its chain', async () => {
    const before = (await balance(t2, 'CL')).available;
    const w = (await apply(t2, { leaveTypeId: ids.CL, from: W(8, 1), to: W(8, 1) })).json();
    expect((await balance(t2, 'CL')).available).toBe(before - 1);
    expect((await call(t2, 'POST', `/leave/requests/${w.id}/withdraw`, {})).json().status).toBe(
      'withdrawn',
    );
    expect((await balance(t2, 'CL')).available).toBe(before);
    const j = (await apply(t2, { leaveTypeId: ids.CL, from: W(8, 2), to: W(8, 2) })).json();
    const rej = await call(hod, 'POST', `/leave/requests/${j.id}/decide`, {
      outcome: 'rejected',
      note: 'Exams that day',
    });
    expect(rej.json().status).toBe('rejected');
    expect((await balance(t2, 'CL')).available).toBe(before);
    expect((await detail(t2, j.id)).decisionNote).toBe('Exams that day');
    // T1 asks to cancel the approved split leave: the HOD approves, both parts cancelled, the days back
    expect(
      (await call(t1, 'POST', `/leave/requests/${ids.SPLIT}/withdraw`, {})).json().detail,
    ).toContain('cancellation request');
    const cr = await call(t1, 'POST', `/leave/requests/${ids.SPLIT}/cancel-request`, {
      reason: 'Plans changed',
    });
    expect(cr.json().cancelStatus).toBe('pending');
    const waiting = (await call(hod, 'GET', '/leave/approvals')).json().rows;
    expect(waiting.find((x: { id: string }) => x.id === ids.SPLIT)?.what).toBe('cancellation');
    const done = (
      await call(hod, 'POST', `/leave/requests/${ids.SPLIT}/cancel-decide`, { outcome: 'approved' })
    ).json();
    expect(done).toMatchObject({ status: 'cancelled', cancelStatus: 'approved' });
    expect(await balance(t1, 'CL')).toMatchObject({ available: 3, held: 0 });
    const logs = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM activity_logs WHERE employee_id = $1 AND leave_kind IS NOT NULL AND on_date BETWEEN $2 AND $3`,
        [ids.T1, W(0, 0), W(0, 4)],
      ),
    );
    expect(logs.rows[0]!.n).toBe(0);
  });

  it('the office: trims an approved leave, decides for the approvers, enters leave for an employee', async () => {
    await call(hod, 'POST', `/leave/requests/${ids.BRIDGE}/decide`, { outcome: 'approved' });
    expect(
      (
        await call(t1, 'POST', `/leave/requests/${ids.BRIDGE}/trim`, {
          from: W(3, 6),
          to: W(4, 0),
          reason: 'x',
        })
      ).statusCode,
    ).toBe(403);
    const both = await call(office, 'POST', `/leave/requests/${ids.BRIDGE}/trim`, {
      from: W(3, 6),
      to: W(3, 6),
      reason: 'Both ends',
    });
    expect(both.json().detail).toContain('one end at a time');
    const tr = (
      await call(office, 'POST', `/leave/requests/${ids.BRIDGE}/trim`, {
        from: W(3, 6),
        to: W(4, 0),
        reason: 'Came back early',
      })
    ).json();
    expect(tr).toMatchObject({ from: W(3, 6), to: W(4, 0), days: 2 });
    expect(await balance(t1, 'EL')).toMatchObject({ available: 2, held: 3 });
    expect((await detail(office, ids.BRIDGE)).changes).toHaveLength(1);
    // decided for the approvers
    const p = (await apply(t2, { leaveTypeId: ids.CL, from: W(9, 0), to: W(9, 0) })).json();
    const ov = await call(office, 'POST', `/leave/requests/${p.id}/override`, {
      outcome: 'approved',
      reason: 'HOD away',
    });
    expect(ov.json().status).toBe('approved');
    expect((await detail(t2, p.id)).decisionNote).toContain('Decided by the leave office');
    const held = (await balance(t2, 'CL')).held;
    // the office's entry replaces it: approved at once, loss of pay allowed
    const ob = (
      await call(office, 'POST', '/leave/on-behalf', {
        employeeId: ids.T2,
        leaveTypeId: ids.LOP,
        from: W(9, 0),
        to: W(9, 0),
        reason: 'Absent without leave',
      })
    ).json();
    expect(ob).toMatchObject({ status: 'approved', replaced: [p.number] });
    expect((await detail(t2, p.id)).status).toBe('cancelled');
    // the replaced CL is given back once
    expect((await balance(t2, 'CL')).held).toBe(held - 1);
    // a teacher sees neither the register nor another's leave
    expect((await call(t1, 'GET', '/leave/register')).statusCode).toBe(403);
    expect((await call(t1, 'GET', `/leave/requests/${p.id}`)).statusCode).toBe(404);
  });

  it('the register: nine figures, filters, Excel', async () => {
    const reg = (await call(office, 'GET', '/leave/register?size=25')).json();
    expect(reg.figures.total).toBeGreaterThanOrEqual(8);
    expect(reg.figures.approved).toBeGreaterThanOrEqual(2);
    expect(reg.figures.lop).toBeGreaterThanOrEqual(1);
    const t1rows = (await call(office, 'GET', `/leave/register?employeeId=${ids.T1}`)).json();
    expect(t1rows.rows.every((x: { employee: { id: string } }) => x.employee.id === ids.T1)).toBe(
      true,
    );
    const rej = (await call(office, 'GET', '/leave/register?bucket=rejected')).json();
    expect(rej.rows.every((x: { status: string }) => x.status === 'rejected')).toBe(true);
    const x = (await call(office, 'GET', '/leave/register?format=xlsx')).json();
    expect(x.filename).toMatch(/^Leave-register-/);
    // each row as the old Approve / Reject Leave: stage, last action, current approver, the office's icons
    type Row = {
      id: string;
      number: string;
      status: string;
      source: string;
      days: number;
      stage: string;
      appliedPerson: string | null;
      lastAction: { words: string; by: string | null; at: string | null };
      approver: { head: string; people: string | null };
      can: { override: boolean; trim: boolean; cancel: boolean };
    };
    const rowOf = async (id: string) =>
      ((await call(office, 'GET', '/leave/register?size=100')).json().rows as Row[]).find(
        (r) => r.id === id,
      )!;
    const w = (await apply(t1, { leaveTypeId: ids.CL, from: W(11, 0), to: W(11, 0) })).json();
    expect(await rowOf(w.id)).toMatchObject({
      stage: 'Pending',
      lastAction: { words: 'L1 Pending', by: null, at: null },
      approver: { head: 'LEVEL 1 PENDING', people: expect.any(String) },
      can: { override: true, trim: false, cancel: false },
    });
    // the trimmed bridge: approved by the HOD at level 1, two days — Edit dates and Cancel
    const bridge = await rowOf(ids.BRIDGE!);
    expect(bridge.lastAction.words).toMatch(/^L1 Approved$/);
    expect(bridge.lastAction.by).toBeTruthy();
    expect(bridge).toMatchObject({
      stage: 'L1 Approved',
      approver: { head: 'APPROVED' },
      can: { override: false, trim: true, cancel: true },
    });
    // the office's own entry: loss of pay, applied and approved on behalf, by the office
    const ob = (await call(office, 'GET', '/leave/register?size=100&source=on_behalf')).json()
      .rows[0] as Row;
    expect(ob).toMatchObject({
      stage: 'LWP',
      lastAction: { words: 'Applied & approved on behalf' },
      can: { override: false, trim: false, cancel: true },
    });
    expect(ob.appliedPerson).toBeTruthy();
    // its Leave Approval Details: the levels with the approvers as "CODE — Name", no cancellation yet
    const det = (await call(office, 'GET', `/leave/requests/${w.id as string}`)).json();
    expect(det.approval[0]).toMatchObject({ level: 1, status: 'pending', actedBy: null });
    expect(det.approval[0].people[0]).toMatch(/^\S+ — \S/);
    expect(det).toMatchObject({ cancelRaisedAt: null, cancellation: [] });
    expect(det.dayRows[0]).toMatchObject({ day: W(11, 0), status: 'pending' });
    // rejected by the office from the row: the reason kept as the office's
    await call(office, 'POST', `/leave/requests/${w.id as string}/override`, {
      outcome: 'rejected',
      reason: 'Exams that week',
    });
    expect(await rowOf(w.id)).toMatchObject({
      stage: 'Rejected',
      lastAction: { words: 'Rejected by the leave office' },
      approver: { head: 'REJECTED' },
      can: { override: false, trim: false, cancel: false },
    });
    const pdf = (await call(office, 'GET', '/leave/register?format=pdf')).json();
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('balances: the month’s ledger, opening balances from Excel (a second run changes nothing), the month closed and credited', async () => {
    const b = (await call(office, 'GET', `/leave/balances?employeeId=${ids.T1}`)).json();
    expect(
      b.rows.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'CL'),
    ).toMatchObject({
      available: 3,
      correction: 3,
    });
    const f = (await call(office, 'GET', '/leave/balances/format')).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(f.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    let filled = 0;
    ws.eachRow((row, n) => {
      if (n > 1 && row.getCell(1).value === `${s}T2` && row.getCell(3).value === 'EL') {
        row.getCell(4).value = 10;
        filled += 1;
      }
    });
    expect(filled).toBe(1);
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(office, 'POST', '/leave/balances/import', { file, dryRun: true })
    ).json();
    expect(dry.rows).toEqual([expect.objectContaining({ ok: true, balance: 10, now: 0 })]);
    expect(
      (await call(office, 'POST', '/leave/balances/import', { file, dryRun: false })).json().saved,
    ).toBe(1);
    expect((await balance(t2, 'EL')).available).toBe(10);
    expect(
      (await call(office, 'POST', '/leave/balances/import', { file, dryRun: false })).json().saved,
    ).toBe(0);
    // a month before this one still open closes, and this month opens at its closing; CL is credited now
    const prev = add(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    await withMigrator(async (c) => {
      await c.query(
        `INSERT INTO staff_leave_balances (school_id, employee_id, leave_type_id, month, opening) VALUES ($1, $2, $3, $4::date, 2)`,
        [school.id, ids.A1, ids.EL, `${prev}-01`],
      );
      const m = Number(today.slice(5, 7));
      await c.query(
        `UPDATE staff_leave_policies SET credit_months = $2 WHERE school_id = $1 AND name = 'CL all'`,
        [school.id, [m, ((m + 5) % 12) + 1]],
      );
      await c.query(`UPDATE employees SET joined_on = $2::date WHERE id = $1`, [
        ids.A1,
        add(`${today.slice(0, 7)}-01`, -91),
      ]);
    });
    expect(
      (await call(office, 'POST', '/leave/balances/run-month', {})).json().rows,
    ).toBeGreaterThan(0);
    const after = (await call(office, 'GET', `/leave/balances?employeeId=${ids.A1}`)).json().rows;
    expect(
      after.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'EL'),
    ).toMatchObject({ opening: 2 });
    const cl = after.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'CL');
    // six days a credit, pro rata from joining about three months into the six
    expect(cl.credited).toBeGreaterThanOrEqual(2.5);
    expect(cl.credited).toBeLessThanOrEqual(3.5);
    const full = (await call(office, 'GET', `/leave/balances?employeeId=${ids.T1}`)).json().rows;
    expect(
      full.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'CL').credited,
    ).toBe(6);
    const closed = await withMigrator((c) =>
      c.query<{ closed: boolean; closing: string }>(
        `SELECT closed, closing::text FROM staff_leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND month = $3::date`,
        [ids.A1, ids.EL, `${prev}-01`],
      ),
    );
    expect(closed.rows[0]).toEqual({ closed: true, closing: '2.00' });
    // a second run credits nothing new
    const again = (await call(office, 'GET', `/leave/balances?employeeId=${ids.T1}`)).json().rows;
    expect(
      again.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'CL').credited,
    ).toBe(6);
    // every month, newest first, as the old Employee Leave Balance: this month (Open), then before (Closed)
    type B = {
      id: string;
      month: string;
      current: boolean;
      closed: boolean;
      closing: number | null;
      leaveType: { code: string };
    };
    const every = (
      await call(office, 'GET', `/leave/balances?employeeId=${ids.A1}&size=100`)
    ).json();
    expect(every.month).toBeNull();
    const months = (every.rows as B[]).map((r) => r.month);
    expect(months[0]).toBe(`${today.slice(0, 7)}-01`);
    expect([...months].sort().reverse()).toEqual(months);
    expect(every.rows[0]).toMatchObject({ current: true, closed: false });
    expect(
      (every.rows as B[]).find((r) => r.month === `${prev}-01` && r.leaveType.code === 'EL'),
    ).toMatchObject({ current: false, closed: true, closing: 2 });
    expect(every.total).toBe(every.rows.length);
    // one month only
    const one = (
      await call(office, 'GET', `/leave/balances?employeeId=${ids.A1}&month=${prev}`)
    ).json();
    expect(one.rows.length).toBeGreaterThan(0);
    expect((one.rows as B[]).every((r) => r.month === `${prev}-01` && !r.current)).toBe(true);
    // the pages run on from this month into the months before
    const key = (r: B) => `${r.id}|${r.month}`;
    const fifty = (await call(office, 'GET', '/leave/balances?size=50')).json();
    const second = (await call(office, 'GET', '/leave/balances?size=25&page=2')).json();
    expect((second.rows as B[]).map(key)).toEqual((fifty.rows as B[]).slice(25, 50).map(key));
    for (const f of ['xlsx', 'pdf'])
      expect(
        (await call(office, 'GET', `/leave/balances?employeeId=${ids.A1}&format=${f}`)).json()
          .filename,
      ).toMatch(/^Leave-balances/);
  });

  it('leave waiting for me / decided by me: figures, filters, a page at a time, Excel and PDF', async () => {
    type A = {
      rows: Array<{ id: string; what: string; decided: string | null; employee: { id: string } }>;
      total: number;
      figures: { n: number; approved: number; rejected: number; cancels: number; overdue: number };
      lists: { employees: Array<{ id: string }> };
    };
    const get = async (u: SeededUser, qs: string) =>
      (await call(u, 'GET', `/leave/approvals?${qs}`)).json() as Promise<A>;
    const all = await get(hod, 'view=decided&size=100');
    expect(all.total).toBeGreaterThan(0);
    expect(all.figures.n).toBe(all.total);
    expect(all.figures.approved + all.figures.rejected).toBe(all.total);
    // one row a leave or its cancellation, however many levels I acted on
    expect(new Set(all.rows.map((r) => `${r.id}-${r.what}`)).size).toBe(all.rows.length);
    const approved = await get(hod, 'view=decided&outcome=approved&size=100');
    expect(approved.total).toBe(all.figures.approved);
    expect(approved.rows.every((r) => r.decided === 'approved')).toBe(true);
    const one = all.rows[0]!.employee.id;
    const mine = await get(hod, `view=decided&employeeId=${one}&size=100`);
    expect(mine.rows.every((r) => r.employee.id === one)).toBe(true);
    expect(all.lists.employees.map((e) => e.id)).toContain(one);
    // a page at a time
    const p1 = await get(hod, 'view=decided&size=25&page=1');
    expect(p1.rows.length).toBe(Math.min(25, all.total));
    expect((await get(hod, 'view=decided&q=no-such-leave')).total).toBe(0);
    // waiting: the cancellations only, waiting 3 days or more
    const w = await get(hod, 'view=waiting&size=100');
    expect(w.figures.n).toBe(w.total);
    expect(
      (await get(hod, 'view=waiting&kind=cancellation&size=100')).rows.every(
        (r) => r.what === 'cancellation',
      ),
    ).toBe(true);
    expect((await get(hod, 'view=waiting&overdue=1')).total).toBe(w.figures.overdue);
    for (const [view, f] of [
      ['decided', 'xlsx'],
      ['waiting', 'pdf'],
    ] as const)
      expect(
        (await call(hod, 'GET', `/leave/approvals?view=${view}&format=${f}`)).json().filename,
      ).toMatch(view === 'decided' ? /^Leave-decided-by-me/ : /^Leave-waiting-for-me/);
  });

  it('balances: a row’s Leave Details — the policy, the credit worked out as the run does, the days behind it', async () => {
    const month = today.slice(0, 7);
    const start = `${month}-01`;
    const back6 = new Date(`${start}T00:00:00Z`);
    back6.setUTCMonth(back6.getUTCMonth() - 6);
    const from = back6.toISOString().slice(0, 10);
    const to = add(start, -1);
    const n = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    const lbd = (u: SeededUser, emp: string, type: string, m = month) =>
      call(u, 'GET', `/leave/balances/detail?employeeId=${emp}&leaveTypeId=${type}&month=${m}`);
    type Day = { day: string; code: string; present: string; lop: boolean; lopPct: number | null };
    // a full credit: CL, half-yearly, credited this month for the six months before
    const t = (await lbd(office, ids.T1!, ids.CL!)).json();
    expect(t.employee.code).toBe(`${s}T1`);
    expect(t.policy).toMatchObject({ name: 'CL all', annualDays: 12 });
    expect(t.policy.accrual).toMatch(/^Half-yearly, 6 days a credit, in /);
    expect(t.note).toMatch(/\(credited from .+ attendance\)$/);
    expect(t.accrual).toMatchObject({
      kind: 'credit',
      period: { from, to },
      daysInPeriod: n,
      accrued: 6,
      onRow: 6,
      formula: '(12 ÷ 2) = 6.00',
      remark: null,
    });
    expect(t.days).toHaveLength(n);
    expect(t.balance.trail.some((x: string) => x.includes(' credited 6'))).toBe(true);
    // pro rata from joining: the days before it count nothing, and the figure is the row's
    const a = (await lbd(office, ids.A1!, ids.CL!)).json();
    const cl = (await call(office, 'GET', `/leave/balances?employeeId=${ids.A1}`))
      .json()
      .rows.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'CL');
    expect(a.accrual.accrued).toBe(cl.credited);
    expect(a.accrual.formula).toMatch(/^\(12 ÷ 2\) × \(\d+ ÷ \d+\) = /);
    expect((a.days as Day[]).some((d) => d.code === '—' && d.present === 'No')).toBe(true);
    // by attendance: an absent day in the period is a day lost, 100% LOP
    const absent = add(from, 10);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE staff_leave_policies SET by_attendance = true WHERE school_id = $1 AND name = 'CL all'`,
        [school.id],
      );
      await c.query(
        `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, source, manual)
         VALUES ($1, $2, $3::date, 'A', 'manual', true)
         ON CONFLICT (employee_id, day) DO UPDATE SET day_type = 'A', leave_type_id = NULL, leave_portion = NULL`,
        [school.id, ids.T1, absent],
      );
    });
    const b = (await lbd(office, ids.T1!, ids.CL!)).json();
    expect(b.accrual).toMatchObject({ lostDays: 1, presentDays: n - 1, accrued: 6 });
    expect(b.accrual.formula).toBe(
      `(12 ÷ 2) × (${String(n - 1)} ÷ ${String(n)}) = ${((6 * (n - 1)) / n).toFixed(2)} → 6.00 to the half day`,
    );
    expect(b.accrual.rule).toMatch(/^Present, weekly off/);
    expect((b.days as Day[]).find((d) => d.day === absent)).toMatchObject({
      code: 'A',
      present: 'No',
      lop: true,
      lopPct: 100,
    });
    await withMigrator((c) =>
      c.query(
        `UPDATE staff_leave_policies SET by_attendance = false WHERE school_id = $1 AND name = 'CL all'`,
        [school.id],
      ),
    );
    // a month kept before this one, a month with none kept, a month to come; the office only
    const prev = add(start, -1).slice(0, 7);
    const el = (await lbd(office, ids.A1!, ids.EL!, prev)).json();
    expect(el.balance).toMatchObject({ closed: true, closing: 2 });
    const none = add(`${prev}-01`, -1).slice(0, 7);
    expect((await lbd(office, ids.A1!, ids.EL!, none)).statusCode).toBe(404);
    const next = add(add(start, 31).slice(0, 7) + '-01', 0).slice(0, 7);
    expect((await lbd(office, ids.A1!, ids.EL!, next)).statusCode).toBe(400);
    expect((await lbd(t1, ids.T1!, ids.CL!)).statusCode).toBe(403);
  });
});
