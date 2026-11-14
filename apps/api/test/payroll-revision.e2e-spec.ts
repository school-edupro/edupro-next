/**
 * Revisions and increments (docs/design/86, phase E step 3): a DA revision dated back into two locked months — the
 * months worked out again, the arrears by employee, head and month, applied by a checker who did not draft it, the
 * new rate in force from the first open month; a second revision of the same months pays only its own difference and
 * changes the same forward row; the yearly increment — due by the increment month, the service and once a year — the
 * next pay-matrix cell, or a % off the matrix; applied by another checker with a numbered letter each.
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

describe('payroll revisions and increments (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  const emp: Record<string, string> = {};
  const head: Record<string, string> = {};
  const s = stamp('PRV');
  const call = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const q = <T>(sql: string, args: unknown[] = []) =>
    withMigrator((c) => c.query<T & Record<string, unknown>>(sql, args)).then((r) => r.rows);
  const runMonth = async (month: string) => {
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month,
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month });
    const id = (await call(maker, 'POST', '/payroll/runs', { month, runType: 'REGULAR' })).json()
      .id as string;
    for (let i = 0; i < 10; i += 1)
      if ((await call(maker, 'POST', `/payroll/runs/${id}/process`)).json().done) break;
    expect((await call(checker, 'POST', `/payroll/runs/${id}/approve`)).statusCode).toBe(201);
    expect((await call(checker, 'POST', `/payroll/runs/${id}/lock`)).statusCode).toBe(201);
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      for (const [code, joined] of [
        ['A', '2018-01-01'],
        ['B', '2019-01-01'],
        ['C', '2026-05-01'],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob, gender)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', $3, '1985-05-05', 'male') RETURNING id::text`,
            [school.id, `${s}${code}`, joined],
          )
        ).rows[0]!.id;
      for (const m of ['2026-04-01', '2026-05-01'])
        await c.query(
          `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)`,
          [school.id, m],
        );
    });
    app = await createApp();
    inject = injector(app);
    await call(admin, 'GET', '/payroll/setup');
    for (const r of await q<{ id: string; code: string }>(
      `SELECT id::text, code FROM payroll_pay_heads WHERE school_id = $1`,
      [school.id],
    ))
      head[r.code] = r.id;
    const cell1 = (
      await q<{ basic: string }>(
        `SELECT basic::text FROM payroll_pay_matrix WHERE school_id = $1 AND matrix_code = 'PM_2016' AND pay_level = '1' AND cell_no = 1`,
        [school.id],
      )
    )[0]!.basic;
    await q(
      `INSERT INTO payroll_profiles (employee_id, school_id, pay_level, pay_cell) VALUES ($1, $2, '1', 1)`,
      [emp.B, school.id],
    );
    for (const [code, h, amount] of [
      ['A', 'BASIC', '50000'],
      ['A', 'DA', '0'],
      ['B', 'BASIC', cell1],
      ['B', 'DA', '0'],
      ['C', 'BASIC', '30000'],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active')`,
        [school.id, emp[code], head[h], amount],
      );
    await runMonth('2026-04');
    await runMonth('2026-05');
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('a DA revision into locked months: arrears by month, applied by another checker, in force from June', async () => {
    const body = {
      kind: 'RATE',
      rateCode: 'DA_RATE',
      newValue: '0.64',
      effectiveFrom: '2026-04-01',
      reason: 'DA 64 % from April',
    };
    expect(
      (await call(maker, 'POST', '/payroll/revisions', { ...body, newValue: 'x' })).statusCode,
    ).toBe(400);
    expect(
      (await call(maker, 'POST', '/payroll/revisions', { ...body, rateCode: 'NOPE' })).statusCode,
    ).toBe(400);
    const id = (await call(maker, 'POST', '/payroll/revisions', body)).json().id as string;
    const sim = (await call(maker, 'GET', `/payroll/revisions/${id}/simulate`)).json();
    expect(sim.firstOpenMonth).toBe('2026-06');
    const a = sim.items.filter(
      (x: { code: string; head: string }) => x.code === `${s}A` && x.head === 'DA',
    );
    // 4 % more of 50,000 in April and May
    expect(a.map((x: { month: string; arrear: string }) => [x.month, x.arrear])).toEqual([
      ['2026-04', '2000.00'],
      ['2026-05', '2000.00'],
    ]);
    expect((await call(maker, 'POST', `/payroll/revisions/${id}/apply`)).statusCode).toBe(403);
    const ok = (await call(checker, 'POST', `/payroll/revisions/${id}/apply`)).json();
    expect(ok).toMatchObject({ firstOpenMonth: '2026-06' });
    expect(ok.arrears).toBeGreaterThanOrEqual(4);
    expect((await call(checker, 'POST', `/payroll/revisions/${id}/apply`)).statusCode).toBe(409);
    const rates = await q<{
      rate_value: string;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT rate_value::text, effective_from::text, effective_to::text FROM payroll_rates
        WHERE school_id = $1 AND rate_code = 'DA_RATE' AND status = 'active' ORDER BY effective_from`,
      [school.id],
    );
    expect(rates.slice(-2)).toEqual([
      { rate_value: '0.600000', effective_from: '2026-01-01', effective_to: '2026-05-31' },
      { rate_value: '0.640000', effective_from: '2026-06-01', effective_to: null },
    ]);
    const arr = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM payroll_arrears WHERE school_id = $1 AND source = 'REVISION' AND revision_id = $2`,
      [school.id, id],
    );
    expect(arr[0]!.n).toBe(ok.arrears);
  });

  it('a second revision of the same months pays only its own difference; a checker never applies their own', async () => {
    // a checker may draft, but never applies their own draft
    const own = (
      await call(checker, 'POST', '/payroll/revisions', {
        kind: 'RATE',
        rateCode: 'DA_RATE',
        newValue: '0.70',
        effectiveFrom: '2026-04-01',
        reason: 'Drafted by the checker',
      })
    ).json().id as string;
    expect((await call(checker, 'POST', `/payroll/revisions/${own}/apply`)).statusCode).toBe(403);
    expect((await call(checker, 'POST', `/payroll/revisions/${own}/cancel`)).statusCode).toBe(201);
    const id = (
      await call(maker, 'POST', '/payroll/revisions', {
        kind: 'RATE',
        rateCode: 'DA_RATE',
        newValue: '0.66',
        effectiveFrom: '2026-04-01',
        reason: 'DA 66 % from April',
      })
    ).json().id as string;
    const sim = (await call(checker, 'GET', `/payroll/revisions/${id}/simulate`)).json();
    const a = sim.items.filter(
      (x: { code: string; head: string }) => x.code === `${s}A` && x.head === 'DA',
    );
    expect(a.map((x: { arrear: string }) => x.arrear)).toEqual(['1000.00', '1000.00']);
    await call(checker, 'POST', `/payroll/revisions/${id}/apply`);
    const rates = await q<{ rate_value: string }>(
      `SELECT rate_value::text FROM payroll_rates WHERE school_id = $1 AND rate_code = 'DA_RATE' AND status = 'active'
        AND effective_from = '2026-06-01'`,
      [school.id],
    );
    expect(rates).toEqual([{ rate_value: '0.660000' }]);
  });

  it('the yearly increment: the next matrix cell or a %, once a year, after the minimum service, with letters', async () => {
    const due = (await call(maker, 'GET', '/payroll/increments?month=2026-07')).json();
    const row = (code: string) => due.rows.find((r: { code: string }) => r.code === `${s}${code}`);
    expect(row('A')).toMatchObject({
      status: 'DUE',
      from: '50000.00',
      to: '51500.00',
      cellTo: null,
    });
    const b = row('B');
    expect(b).toMatchObject({ status: 'DUE', level: '1', cellFrom: 1, cellTo: 2, to: '18500.00' });
    expect(row('C')).toMatchObject({ status: 'NOT_DUE' });
    expect(
      (await call(maker, 'POST', '/payroll/increments', { month: '2026-07', employeeIds: [emp.C] }))
        .statusCode,
    ).toBe(409);
    const p = (
      await call(maker, 'POST', '/payroll/increments', {
        month: '2026-07',
        employeeIds: [emp.A, emp.B],
      })
    ).json();
    expect(p.count).toBe(2);
    const ok = (await call(checker, 'POST', `/payroll/revisions/${p.id as string}/apply`)).json();
    expect(ok.message).toContain('2 increment(s)');
    const basic = await q<{
      code: string;
      amount: string;
      effective_from: string;
      effective_to: string | null;
    }>(
      `SELECT e.employee_code AS code, s.amount::text, s.effective_from::text, s.effective_to::text
         FROM payroll_structures s JOIN employees e ON e.id = s.employee_id
        WHERE s.school_id = $1 AND s.pay_head_id = $2 AND s.status = 'active' AND e.id = ANY($3::bigint[])
        ORDER BY e.employee_code, s.effective_from`,
      [school.id, head.BASIC, [emp.A, emp.B]],
    );
    expect(basic.map((r) => [r.code, r.amount, r.effective_from, r.effective_to])).toEqual([
      [`${s}A`, '50000.00', '2026-04-01', '2026-06-30'],
      [`${s}A`, '51500.00', '2026-07-01', null],
      [`${s}B`, '18000.00', '2026-04-01', '2026-06-30'],
      [`${s}B`, '18500.00', '2026-07-01', null],
    ]);
    const prof = await q<{ pay_cell: number; last_increment_on: string }>(
      `SELECT pay_cell, last_increment_on::text FROM payroll_profiles WHERE employee_id = $1`,
      [emp.B],
    );
    expect(prof[0]).toEqual({ pay_cell: 2, last_increment_on: '2026-07-01' });
    const letters = (
      await call(maker, 'GET', `/payroll/revisions/${p.id as string}/letters`)
    ).json().rows;
    expect(letters.map((l: { letterNo: string }) => l.letterNo)).toEqual([
      'PR/2026/0001',
      'PR/2026/0002',
    ]);
    // once a year
    const again = (await call(maker, 'GET', '/payroll/increments?month=2026-07')).json();
    expect(again.rows.find((r: { code: string }) => r.code === `${s}A`).status).toBe('NOT_DUE');
  });
});
