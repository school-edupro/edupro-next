/**
 * Staff leave and attendance set-up (docs/design/85, phase A): the defaults a school starts with, the
 * masters' rules (policies' credit months, loss of pay, shifts), who approves (rules by scope and leave
 * type, day bands of up to 3 levels, the test of the chain), the settings, and the rights.
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

describe('staff leave set-up (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let office: SeededUser;
  let hod: SeededUser;
  let teacher: SeededUser;
  let accountant: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('LV');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      hod = await seedUser(c, school, `${s}-hod`, 'class_teacher');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      accountant = await seedUser(c, school, `${s}-ac`, 'accountant');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(
        `INSERT INTO departments (school_id, code, name, staff_group) VALUES ($1, 'science', 'Science', 'teaching')`,
        [school.id],
      );
      for (const [code, name, dept, desig, type, u] of [
        ['O1', 'Om Office', 'Administration', 'Office Assistant', 'non_teaching', office],
        ['H1', 'Hari Head', 'Science', 'PGT', 'teaching', hod],
        ['T1', 'Tara Teacher', 'Science', 'TGT', 'teaching', teacher],
        ['A1', 'Asha Accounts', 'Accounts', 'Accountant', 'non_teaching', accountant],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, employee_type, user_id)
             VALUES ($1, $2, $3, 'E2E', $4, $5, $6, $7) RETURNING id::text`,
            [school.id, `${s}${code}`, name, desig, dept, type, u.id],
          )
        ).rows[0]!.id;
      await c.query(
        `UPDATE departments SET hod_employee_id = $2 WHERE school_id = $1 AND name = 'Science'`,
        [school.id, ids.H1],
      );
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    if (app) await app.close();
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
  });

  it('a school starts with the usual leave types, two shifts, Sunday off and the settings; the overview says what is missing', async () => {
    const o = (await call(office, 'GET', '/leave/setup/overview')).json();
    expect(o.types.map((t: { code: string }) => t.code)).toEqual([
      'CL',
      'EL',
      'SL',
      'HPL',
      'CO',
      'OD',
      'WFH',
      'ML',
      'PL',
      'LOP',
    ]);
    expect(o.counts).toMatchObject({
      shifts: 2,
      weekoffs: 1,
      policies: 0,
      leaveRules: 0,
      staff: 4,
    });
    expect(o.counts.noApprover).toBe(4);
    const w = o.warnings.join(' | ');
    expect(w).toContain('CL, EL, SL, HPL, CO keep a balance but have no policy');
    expect(w).toContain('4 of 4 staff have no approver for leave');
    expect(w).toContain('No approver is set for attendance corrections');
    expect(w).not.toContain('no loss-of-pay type');
    // a second look seeds nothing again
    expect((await call(office, 'GET', '/leave/setup/overview')).json().types).toHaveLength(10);
    const types = (await call(office, 'GET', '/masters/staff_leave_types/rows')).json().data;
    ids.CL = types.find((t: { code: string }) => t.code === 'CL').id;
    ids.LOP = types.find((t: { code: string }) => t.code === 'LOP').id;
  });

  it('the masters keep the rules: credit months from the session, loss of pay unpaid, a day shift ends after it starts', async () => {
    const save = (master: string, values: Record<string, unknown>) =>
      call(office, 'POST', `/masters/${master}/rows`, { values });
    const p = await save('staff_leave_policies', {
      name: 'CL teaching',
      leave_type_id: 'CL',
      scope: 'employee_type',
      scope_values: 'teaching',
      annual_days: 12,
      credit: 'H',
      session_start_month: 4,
      priority: 10,
    });
    expect(p.statusCode).toBeLessThan(300);
    const policies = (await call(office, 'GET', '/masters/staff_leave_policies/rows')).json().data;
    expect(policies[0]).toMatchObject({ name: 'CL teaching', credit_months: '4,10' });
    const bad = await save('staff_leave_policies', {
      name: 'CL quarterly',
      leave_type_id: 'CL',
      scope: 'all',
      annual_days: 12,
      credit: 'Q',
      credit_months: '4,10',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toContain('quarterly credit needs 4 credit month(s); 2 given');
    const lop = await save('staff_leave_types', {
      code: 'XLOP',
      name: 'Bad',
      paid: true,
      loss_of_pay: true,
    });
    expect(lop.json().detail).toContain('a loss-of-pay type is not paid');
    const shift = await save('staff_shifts', {
      code: 'EVE',
      name: 'Evening',
      kind: 'day',
      starts_at: '18:00',
      ends_at: '02:00',
    });
    expect(shift.json().detail).toContain('a day shift ends after it starts');
    const night = await save('staff_shifts', {
      code: 'NIGHT',
      name: 'Night',
      kind: 'night',
      starts_at: '22:00',
      ends_at: '06:00',
      present_hours: 7,
      half_day_hours: 3.5,
    });
    expect(night.statusCode).toBeLessThan(300);
    const o = (await call(office, 'GET', '/leave/setup/overview')).json();
    // teaching staff are in the CL policy; the two non-teaching are not
    expect(o.types.find((t: { code: string }) => t.code === 'CL')).toMatchObject({
      policies: 1,
      uncovered: 2,
    });
    expect(o.warnings.join(' | ')).toContain('2 of 4 staff are in no CL policy');
  });

  it('a weekly off edited from the 2nd and 4th Saturday back to every Saturday loses its weeks', async () => {
    const save = (values: Record<string, unknown>, id?: string) =>
      call(office, 'POST', '/masters/staff_weekoff_rules/rows', { id, values });
    const all = { scope_values: null, dates: null, priority: 100 };
    const made = await save({
      ...all,
      name: 'Saturday off',
      scope: 'all',
      kind: 'weekly',
      weekdays: '6',
      week_numbers: '2,4',
    });
    expect(made.statusCode).toBeLessThan(300);
    const id = made.json().id as string;
    const row = async () =>
      (await call(office, 'GET', `/masters/staff_weekoff_rules/rows?id=${id}&size=1&page=1`)).json()
        .data[0];
    expect(await row()).toMatchObject({ weekdays: '6', week_numbers: '2,4' });
    // the edit form sends every field; the weeks left blank mean every week
    const edited = await save(
      {
        ...all,
        name: 'Saturday off',
        scope: 'all',
        kind: 'weekly',
        weekdays: '6',
        week_numbers: null,
      },
      id,
    );
    expect(edited.statusCode).toBeLessThan(300);
    expect(await row()).toMatchObject({ weekdays: '6', week_numbers: '' });
    await withMigrator((c) => c.query(`DELETE FROM staff_weekoff_rules WHERE id = $1`, [id]));
  });

  it('who approves: rules by scope and leave type, day bands of up to 3 levels, worked out for the employee', async () => {
    const all = await call(office, 'POST', '/leave/setup/approvals', {
      kind: 'leave',
      name: 'All staff',
      scope: 'all',
      priority: 100,
    });
    expect(all.statusCode).toBe(201);
    ids.ALL = all.json().id;
    const level = (name: string, by: string, extra: Record<string, unknown> = {}) => ({
      name,
      by,
      employeeIds: [],
      slaHours: 48,
      ...extra,
    });
    expect(
      (
        await call(office, 'PUT', `/leave/setup/approvals/${ids.ALL}/bands/0`, {
          levels: [level('HOD', 'hod')],
        })
      ).statusCode,
    ).toBe(200);
    await call(office, 'PUT', `/leave/setup/approvals/${ids.ALL}/bands/1`, {
      levels: [level('HOD', 'hod'), level('Office', 'employees', { employeeIds: [ids.O1] })],
    });
    // accounts: their own rule, first by priority
    const acc = await call(office, 'POST', '/leave/setup/approvals', {
      kind: 'leave',
      name: 'Accounts',
      scope: 'department',
      scopeValues: ['accounts'],
      priority: 10,
    });
    ids.ACC = acc.json().id;
    await call(office, 'PUT', `/leave/setup/approvals/${ids.ACC}/bands/0`, {
      levels: [level('Office', 'employees', { employeeIds: [ids.O1] })],
    });
    const rules = (await call(office, 'GET', '/leave/setup/approvals')).json();
    expect(rules.rules.find((r: { id: string }) => r.id === ids.ACC)).toMatchObject({
      scopeWords: 'Department: Accounts',
      bands: [{ levels: ['Office'] }, { levels: [] }, { levels: [] }],
    });
    const preview = (q: string) =>
      call(office, 'GET', `/leave/setup/approvals/preview?${q}`).then((r) => r.json());
    const t3 = await preview(`employeeId=${ids.T1}&days=3`);
    expect(t3).toMatchObject({ band: 'Up to 7 days', rule: { name: 'All staff' } });
    expect(t3.levels).toEqual([{ name: 'HOD', people: [`Hari Head E2E (${s}H1)`], note: null }]);
    const t10 = await preview(`employeeId=${ids.T1}&days=10`);
    expect(t10.levels.map((l: { name: string }) => l.name)).toEqual(['HOD', 'Office']);
    // at a boundary the lower band wins
    expect((await preview(`employeeId=${ids.T1}&days=7`)).band).toBe('Up to 7 days');
    const a2 = await preview(`employeeId=${ids.A1}&days=2`);
    expect(a2.rule.name).toBe('Accounts');
    // over 7 days Accounts has no level: the next rule decides (the HOD — Accounts has none — is skipped)
    const a10 = await preview(`employeeId=${ids.A1}&days=10`);
    expect(a10.rule.name).toBe('All staff');
    expect(a10.levels[0].people).toEqual([]);
    expect(a10.levels[1].people).toEqual([`Om Office E2E (${s}O1)`]);
    // the HOD never approves their own leave
    const h = await preview(`employeeId=${ids.H1}&days=2`);
    expect(h.note).toContain('Every level is skipped');
    // a type approved at once needs nobody
    expect((await preview(`employeeId=${ids.T1}&days=1&leaveTypeId=${ids.LOP}`)).note).toContain(
      'approved at once',
    );
    // a regularisation chain
    const reg = await call(office, 'POST', '/leave/setup/approvals', {
      kind: 'regularisation',
      name: 'Corrections',
      scope: 'all',
    });
    await call(office, 'PUT', `/leave/setup/approvals/${reg.json().id}/bands/0`, {
      levels: [level('HOD', 'hod')],
    });
    const r1 = await preview(`employeeId=${ids.T1}&kind=regularisation&days=1`);
    expect(r1).toMatchObject({ band: 'Every correction', rule: { name: 'Corrections' } });
    const o = (await call(office, 'GET', '/leave/setup/overview')).json();
    expect(o.counts).toMatchObject({ leaveRules: 2, regRules: 1, noApprover: 0 });
  });

  it('refuses an unknown scope, a second active rule for the same staff, a fourth level, a band that is not there', async () => {
    const r = await call(office, 'POST', '/leave/setup/approvals', {
      kind: 'leave',
      name: 'Nowhere',
      scope: 'department',
      scopeValues: ['Astronomy'],
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().detail).toContain('Not a department of the school: Astronomy');
    const dup = await call(office, 'POST', '/leave/setup/approvals', {
      kind: 'leave',
      name: 'All again',
      scope: 'all',
    });
    expect(dup.statusCode).toBe(409);
    const four = await call(office, 'PUT', `/leave/setup/approvals/${ids.ALL}/bands/2`, {
      levels: ['A', 'B', 'C', 'D'].map((n) => ({ name: `Level ${n}`, by: 'hod', employeeIds: [] })),
    });
    expect(four.statusCode).toBe(400);
    expect(
      (await call(office, 'PUT', `/leave/setup/approvals/${ids.ALL}/bands/3`, { levels: [] }))
        .statusCode,
    ).toBe(400);
    // switched off, the same staff may get a new rule
    await call(office, 'POST', `/leave/setup/approvals/${ids.ALL}/status`, { status: 'inactive' });
    const again = await call(office, 'POST', '/leave/setup/approvals', {
      kind: 'leave',
      name: 'All again',
      scope: 'all',
    });
    expect(again.statusCode).toBe(201);
  });

  it('settings: the defaults, a change, a bad e-mail refused; staff without the right see nothing', async () => {
    const d = (await call(office, 'GET', '/leave/setup/settings')).json();
    expect(d.settings).toMatchObject({
      lateMarksPerLeave: 3,
      missingPunchesPerLeave: 4,
      lopAfterDays: 7,
      allowOnBehalf: true,
      sendSms: false,
    });
    const gen = d.shifts.find((x: { code: string }) => x.code === 'GEN');
    expect(d.settings.defaultShiftId).toBe(gen.id);
    const body = {
      ...d.settings,
      lateMarksPerLeave: 4,
      exceptionsFrom: '2026-11-01',
      deviceSerials: ['DEV-001', 'DEV-002'],
      missingPunchCc: 'hr@example.com',
    };
    delete body.updatedAt;
    expect((await call(office, 'PUT', '/leave/setup/settings', body)).statusCode).toBe(200);
    expect((await call(office, 'GET', '/leave/setup/settings')).json().settings).toMatchObject({
      lateMarksPerLeave: 4,
      exceptionsFrom: '2026-11-01',
      deviceSerials: ['DEV-001', 'DEV-002'],
    });
    const bad = await call(office, 'PUT', '/leave/setup/settings', {
      ...body,
      missingPunchCc: 'not mail',
    });
    expect(bad.statusCode).toBe(400);
    for (const url of ['/leave/setup/overview', '/leave/setup/settings', '/leave/setup/approvals'])
      expect((await call(teacher, 'GET', url)).statusCode).toBe(403);
    expect(
      (
        await call(teacher, 'POST', '/masters/staff_leave_types/rows', {
          values: { code: 'ZZ', name: 'x' },
        })
      ).statusCode,
    ).toBe(403);
  });
});
