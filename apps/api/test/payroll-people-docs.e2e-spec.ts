/**
 * People papers and transfers (docs/design/86, phase E step 5): the increment letter (to payroll staff, and to the
 * employee in My payslips), the salary certificate of a year (a checker for others; one's own), a loan's statement and
 * its no-dues certificate only once repaid; and a transfer within the group — the destination's checker sees what
 * comes across, read live from the source, and brings it: the earlier-employer record of the tax year (verified), the
 * profile, the pay structure as drafts, the loans owed (closed at the source); once only, and never for a transfer that
 * is not accepted into this school.
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

describe('payroll people papers and transfers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let src: SeededSchool;
  let dst: SeededSchool;
  const u: Record<string, SeededUser> = {};
  let emp = '';
  let there = '';
  let staff: SeededUser;
  let transfer = '';
  let pending = '';
  let loan = '';
  const s = stamp('PPD');
  const call = (
    who: SeededUser,
    school: SeededSchool,
    method: 'GET' | 'POST',
    url: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url,
      headers: headersFor(who.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const q = <T>(sql: string, args: unknown[] = []) =>
    withMigrator((c) => c.query<T & Record<string, unknown>>(sql, args)).then((r) => r.rows);
  const isPdf = (r: { json: () => { base64?: string; contentType?: string } }) => {
    const b = r.json();
    return (
      b.contentType === 'application/pdf' &&
      Buffer.from(b.base64 ?? '', 'base64')
        .subarray(0, 4)
        .toString() === '%PDF'
    );
  };
  const runMonth = async (month: string) => {
    await call(u.ck!, src, 'POST', '/payroll/inputs/attendance/mark-present', {
      month,
      reason: 'Full month',
      dryRun: false,
    });
    await call(u.ck!, src, 'POST', '/payroll/inputs/attendance/finalise', { month });
    const id = (
      await call(u.mk!, src, 'POST', '/payroll/runs', { month, runType: 'REGULAR' })
    ).json().id as string;
    for (let i = 0; i < 10; i += 1)
      if ((await call(u.mk!, src, 'POST', `/payroll/runs/${id}/process`)).json().done) break;
    expect((await call(u.ck!, src, 'POST', `/payroll/runs/${id}/approve`)).statusCode).toBe(201);
    expect((await call(u.ck!, src, 'POST', `/payroll/runs/${id}/lock`)).statusCode).toBe(201);
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      src = await seedSchool(c, `${s}S`);
      dst = await seedSchool(c, `${s}D`);
      const g = (
        await c.query<{ id: string }>(
          `INSERT INTO school_groups (code, name) VALUES ($1, $1) RETURNING id::text`,
          [`${s}G`],
        )
      ).rows[0]!.id;
      await c.query(`UPDATE schools SET group_id = $1 WHERE id IN ($2, $3)`, [g, src.id, dst.id]);
      u.ad = await seedUser(c, src, `${s}-ad`, 'school_admin');
      u.mk = await seedUser(c, src, `${s}-mk`, 'payroll_maker');
      u.ck = await seedUser(c, src, `${s}-ck`, 'payroll_checker');
      u.c2 = await seedUser(c, src, `${s}-c2`, 'payroll_checker');
      u.dad = await seedUser(c, dst, `${s}-dad`, 'school_admin');
      u.dmk = await seedUser(c, dst, `${s}-dmk`, 'payroll_maker');
      u.dck = await seedUser(c, dst, `${s}-dck`, 'payroll_checker');
      staff = await seedUser(c, src, `${s}-st`);
      emp = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob, gender, user_id)
           VALUES ($1, $2, 'Tara', 'E2E', 'Science', 'Teacher', '2018-01-01', '1985-05-05', 'female', $3) RETURNING id::text`,
          [src.id, `${s}T`, staff.id],
        )
      ).rows[0]!.id;
      for (const m of ['2026-04-01', '2026-05-01'])
        await c.query(
          `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)`,
          [src.id, m],
        );
    });
    app = await createApp();
    inject = injector(app);
    await call(u.ad!, src, 'GET', '/payroll/setup');
    await call(u.dad!, dst, 'GET', '/payroll/setup');
    await q(`UPDATE payroll_settings SET tan = 'ABCD12345E' WHERE school_id = $1`, [src.id]);
    await q(
      `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
       SELECT $1, $2, id, 40000, '2026-04-01', 'active' FROM payroll_pay_heads WHERE school_id = $1 AND code = 'BASIC'`,
      [src.id, emp],
    );
    loan = (
      await q<{ id: string }>(
        `INSERT INTO payroll_loans (school_id, employee_id, loan_type, principal, emi, balance, start_month, status)
         VALUES ($1, $2, 'SALARY ADVANCE', 20000, 1000, 20000, '2026-05-01', 'ACTIVE') RETURNING id::text`,
        [src.id, emp],
      )
    )[0]!.id;
    await runMonth('2026-04');
    await runMonth('2026-05');
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id IN ($1, $2)`, [src.id, dst.id]),
    );
    if (app) await app.close();
  });

  it('the increment letter to payroll staff and in My payslips; the salary certificate; the loan papers', async () => {
    const p = (
      await call(u.mk!, src, 'POST', '/payroll/increments', {
        month: '2026-07',
        employeeIds: [emp],
      })
    ).json();
    await call(u.ck!, src, 'POST', `/payroll/revisions/${p.id as string}/apply`);
    expect(
      isPdf(await call(u.mk!, src, 'GET', `/payroll/revisions/${p.id as string}/letters/pdf`)),
    ).toBe(true);
    const mine = (await call(staff, src, 'GET', '/payroll/me/letters')).json().rows;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ letterNo: 'PR/2026/0001', kind: 'INCREMENT' });
    expect(
      isPdf(await call(staff, src, 'GET', `/payroll/me/letters/${mine[0].id as string}/pdf`)),
    ).toBe(true);
    // the salary certificate: one's own, or a checker's for another
    expect(isPdf(await call(staff, src, 'GET', '/payroll/me/salary-certificate?fy=2026-27'))).toBe(
      true,
    );
    expect(
      (await call(staff, src, 'GET', '/payroll/me/salary-certificate?fy=2025-26')).statusCode,
    ).toBe(409);
    expect(
      (await call(u.mk!, src, 'GET', `/payroll/employees/${emp}/salary-certificate?fy=2026-27`))
        .statusCode,
    ).toBe(403);
    expect(
      isPdf(
        await call(u.ck!, src, 'GET', `/payroll/employees/${emp}/salary-certificate?fy=2026-27`),
      ),
    ).toBe(true);
    // the loan: its statement; no certificate while owed
    expect(isPdf(await call(u.mk!, src, 'GET', `/payroll/loans/${loan}/paper`))).toBe(true);
    expect(
      (await call(u.mk!, src, 'GET', `/payroll/loans/${loan}/paper?kind=noc`)).statusCode,
    ).toBe(409);
    const ded = await q<{ amount: string }>(
      `SELECT x.amount::text FROM payroll_record_lines x WHERE x.source_kind = 'loan' AND x.source_id = $1`,
      [loan],
    );
    expect(ded.map((d) => d.amount)).toEqual(['1000.00']);
  });

  it('a transfer within the group: the payroll part seen live, then brought across once by a checker', async () => {
    // the people module took the employee on 1 June (its accept, as rows)
    await withMigrator(async (c) => {
      there = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob, gender)
           VALUES ($1, $2, 'Tara', 'E2E', 'Science', 'Teacher', '2018-01-01', '1985-05-05', 'female') RETURNING id::text`,
          [dst.id, `${s}T2`],
        )
      ).rows[0]!.id;
      transfer = (
        await c.query<{ id: string }>(
          `INSERT INTO employee_school_transfers (from_school_id, to_school_id, from_employee_id, on_date, snapshot, status, to_employee_id)
           VALUES ($1, $2, $3, '2026-06-01', $4::jsonb, 'accepted', $5) RETURNING id::text`,
          [src.id, dst.id, emp, JSON.stringify({ fromSchool: `${s}S` }), there],
        )
      ).rows[0]!.id;
    });
    const list = (await call(u.dmk!, dst, 'GET', '/payroll/transfers')).json();
    expect(list.rows).toEqual([
      expect.objectContaining({
        id: transfer,
        fromSchool: `${s}S`,
        code: `${s}T2`,
        importedAt: null,
      }),
    ]);
    expect((await call(u.dmk!, dst, 'GET', `/payroll/transfers/${transfer}`)).statusCode).toBe(403);
    const plan = (await call(u.dck!, dst, 'GET', `/payroll/transfers/${transfer}`)).json();
    expect(plan.packet.source).toMatchObject({
      school: `${s}S`,
      tan: 'ABCD12345E',
      lastLocked: '2026-05',
    });
    expect(plan.packet.tax).toMatchObject({
      fy: '2026-27',
      months: 2,
      taxable: '80000.00',
      to: '2026-05-31',
    });
    expect(plan.structures).toEqual([{ code: 'BASIC', amount: '40000.00' }]);
    expect(plan.packet.loans).toHaveLength(1);
    expect(plan).toMatchObject({ writesPrev: true, imported: false });
    const owed = plan.packet.loans[0].balance as string;
    const done = (await call(u.dck!, dst, 'POST', `/payroll/transfers/${transfer}/bring`)).json();
    expect(done.message).toContain('the earlier-employer record of 2026-27');
    expect(
      (await call(u.dck!, dst, 'POST', `/payroll/transfers/${transfer}/bring`)).statusCode,
    ).toBe(409);
    const prev = await q<{ gross: string; employer_tan: string; status: string; tds: string }>(
      `SELECT gross::text, employer_tan, status, tds::text FROM payroll_prev_employment WHERE employee_id = $1`,
      [there],
    );
    expect(prev[0]).toMatchObject({
      gross: '80000.00',
      employer_tan: 'ABCD12345E',
      status: 'VERIFIED',
    });
    expect(prev[0]!.tds).toBe(plan.packet.tax.tds);
    const st = await q<{ amount: string; status: string; effective_from: string }>(
      `SELECT amount::text, status, effective_from::text FROM payroll_structures WHERE employee_id = $1`,
      [there],
    );
    expect(st).toEqual([{ amount: '40000.00', status: 'draft', effective_from: '2026-06-01' }]);
    const loans = await q<{ school_id: string; status: string; balance: string; start: string }>(
      `SELECT school_id::text, status, balance::text, start_month::text AS start FROM payroll_loans
        WHERE employee_id IN ($1, $2) ORDER BY school_id`,
      [emp, there],
    );
    expect(loans).toEqual([
      { school_id: src.id, status: 'CLOSED', balance: '0.00', start: '2026-05-01' },
      { school_id: dst.id, status: 'ACTIVE', balance: owed, start: '2026-06-01' },
    ]);
    // a transfer not accepted, or not into this school, is not read
    await withMigrator(async (c) => {
      const other = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, joined_on, dob, gender)
           VALUES ($1, $2, 'Pending', 'E2E', '2020-01-01', '1990-01-01', 'male') RETURNING id::text`,
          [src.id, `${s}P`],
        )
      ).rows[0]!.id;
      pending = (
        await c.query<{ id: string }>(
          `INSERT INTO employee_school_transfers (from_school_id, to_school_id, from_employee_id, on_date, snapshot)
           VALUES ($1, $2, $3, '2026-07-01', '{}'::jsonb) RETURNING id::text`,
          [src.id, dst.id, other],
        )
      ).rows[0]!.id;
    });
    expect((await call(u.dck!, dst, 'GET', `/payroll/transfers/${pending}`)).statusCode).toBe(404);
    expect((await call(u.ck!, src, 'GET', `/payroll/transfers/${transfer}`)).statusCode).toBe(404);
  });
});
