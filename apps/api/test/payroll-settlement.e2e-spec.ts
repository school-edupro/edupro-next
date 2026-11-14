/**
 * Full and final settlements (docs/design/86, phase E step 4): an accepted exit hands payroll a draft; a maker works
 * it out by the law — gratuity (eligibility, years, the cap), leave encashed from the leave balance (the policy's
 * maximum), the notice short, loans — and the figures go to the exit statement as payroll's lines, which the
 * statement's form does not change; another checker approves; staged into a locked month it is paid by a
 * full-and-final run and settled; below nothing it becomes dues with a numbered letter; on a death the gratuity goes
 * to the nominees by their shares; a cancelled settlement gives the statement its lines back.
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

describe('payroll full and final settlements (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  let checker2: SeededUser;
  const emp: Record<string, string> = {};
  const exit: Record<string, string> = {};
  const fnf: Record<string, string> = {};
  const head: Record<string, string> = {};
  const s = stamp('PFN');
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
  const processRun = async (id: string) => {
    for (let i = 0; i < 10; i += 1)
      if ((await call(maker, 'POST', `/payroll/runs/${id}/process`)).json().done) break;
  };
  const lines = async (code: string) =>
    (
      await q<{ lines: Array<{ code: string; amount: number; fromPayroll?: boolean }> }>(
        `SELECT lines FROM employee_fnf WHERE exit_id = $1`,
        [exit[code]],
      )
    )[0]!.lines;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      checker2 = await seedUser(c, school, `${s}-c2`, 'payroll_checker');
      for (const [code, joined] of [
        ['A', '2015-01-01'],
        ['B', '2024-01-01'],
        ['C', '2024-06-01'],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob, gender)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', $3, '1985-05-05', 'male') RETURNING id::text`,
            [school.id, `${s}${code}`, joined],
          )
        ).rows[0]!.id;
      await c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, '2026-04-01', true)`,
        [school.id],
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
    for (const [code, amount] of [
      ['A', '52000'],
      ['B', '30000'],
      ['C', '30000'],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active')`,
        [school.id, emp[code], head.BASIC, amount],
      );
    // the labour codes' wage rule on from April; C has a special allowance above half of the pay
    await q(
      `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
       VALUES ($1, $2, $3, 40000, '2026-04-01', 'active')`,
      [school.id, emp.C, head.SPL_ALW],
    );
    await q(
      `INSERT INTO payroll_rates (school_id, rate_code, rate_value, effective_from, status, change_reason)
       VALUES ($1, 'LABOUR_CODE_WAGES', 1, '2026-04-01', 'active', 'The labour codes from April')`,
      [school.id],
    );
    // April paid and locked
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month: '2026-04',
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: '2026-04' });
    const april = (
      await call(maker, 'POST', '/payroll/runs', { month: '2026-04', runType: 'REGULAR' })
    ).json().id as string;
    await processRun(april);
    expect((await call(checker, 'POST', `/payroll/runs/${april}/approve`)).statusCode).toBe(201);
    expect((await call(checker, 'POST', `/payroll/runs/${april}/lock`)).statusCode).toBe(201);
    // loans from May; earned leave encashable on exit up to 30 days; C's gratuity nominees
    for (const [code, amount] of [
      ['A', '10000'],
      ['B', '100000'],
    ] as const)
      await q(
        `INSERT INTO payroll_loans (school_id, employee_id, loan_type, principal, emi, balance, start_month, status)
         VALUES ($1, $2, 'SALARY ADVANCE', $3, 1000, $3, '2026-05-01', 'ACTIVE')`,
        [school.id, emp[code], amount],
      );
    const el = (
      await q<{ id: string }>(
        `INSERT INTO staff_leave_types (school_id, code, name, paid, keeps_balance, status)
         VALUES ($1, 'EL', 'Earned leave', true, true, 'active') RETURNING id::text`,
        [school.id],
      )
    )[0]!.id;
    await q(
      `INSERT INTO staff_leave_policies (school_id, name, leave_type_id, scope, scope_values, priority, annual_days,
                                         encash, encash_on_exit, encash_on_exit_days)
       VALUES ($1, 'EL for all', $2, 'all', '{}', 1, 30, true, true, 30)`,
      [school.id, el],
    );
    await q(
      `INSERT INTO staff_leave_balances (school_id, employee_id, leave_type_id, month, opening, closing, closed)
       VALUES ($1, $2, $3, '2026-04-01', 45, 45, true)`,
      [school.id, emp.A, el],
    );
    for (const [name, share] of [
      ['Nominee One', '60'],
      ['Nominee Two', '40'],
    ] as const)
      await q(
        `INSERT INTO payroll_nominees (school_id, employee_id, name, relation, share_percent, purpose)
         VALUES ($1, $2, $3, 'Spouse', $4, 'GRATUITY')`,
        [school.id, emp.C, name, share],
      );
    // the exits, accepted: A resigned 30 days short of the notice; B terminated; C died
    for (const [code, type, notice, last, expected] of [
      ['A', 'resignation', 90, '2026-04-30', '2026-05-30'],
      ['B', 'termination', 0, '2026-05-31', '2026-05-31'],
      ['C', 'death', 0, '2026-04-30', '2026-04-30'],
    ] as const)
      exit[code] = (
        await q<{ id: string }>(
          `INSERT INTO employee_exits (school_id, employee_id, exit_type, reason, proposed_last_day, notice_days, expected_last_day,
                                       accepted_last_day, status)
           VALUES ($1, $2, $3, 'E2E exit', $4::date, $5, $6::date, $4::date, 'approved') RETURNING id::text`,
          [school.id, emp[code], type, last, notice, expected],
        )
      )[0]!.id;
    for (const r of await q<{ id: string; code: string }>(
      `SELECT s.id::text, e.employee_code AS code FROM payroll_settlements s JOIN employees e ON e.id = s.employee_id
        WHERE s.school_id = $1`,
      [school.id],
    ))
      fnf[r.code.slice(-1)] = r.id;
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('an accepted exit hands payroll a draft, worked out by the law and put on the exit statement', async () => {
    const list = (await call(maker, 'GET', '/payroll/settlements')).json();
    expect(
      list.rows
        .map((r: { code: string; status: string; reason: string }) => [r.code, r.status, r.reason])
        .sort(),
    ).toEqual([
      [`${s}A`, 'DRAFT', 'RESIGNATION'],
      [`${s}B`, 'DRAFT', 'TERMINATION'],
      [`${s}C`, 'DRAFT', 'DEATH'],
    ]);
    // forfeiture is a checker's, and only on a dismissal or termination
    expect(
      (
        await call(maker, 'POST', `/payroll/settlements/${fnf.A!}/compute`, {
          forfeit: '1000',
          forfeitReason: 'Misconduct found',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker, 'POST', `/payroll/settlements/${fnf.A!}/compute`, {
          forfeit: '1000',
          forfeitReason: 'Misconduct found',
        })
      ).statusCode,
    ).toBe(400);
    // days other than the balance's need a reason
    expect(
      (await call(maker, 'POST', `/payroll/settlements/${fnf.A!}/compute`, { encashDays: '20' }))
        .statusCode,
    ).toBe(400);
    const r = (await call(maker, 'POST', `/payroll/settlements/${fnf.A!}/compute`, {})).json();
    // 11 years (4 months over do not count) × 52,000 × 15 / 26; 30 of the 45 days; 30 days short; the loan
    expect(r).toMatchObject({
      gratuity: '330000.00',
      encash: '52000.00',
      notice: '52000.00',
      loans: '10000.00',
      net: '320000.00',
      statement: 'updated',
    });
    const got = (await call(maker, 'GET', `/payroll/settlements/${fnf.A!}`)).json();
    expect(got.settlement).toMatchObject({
      status: 'COMPUTED',
      gratuityTaxFree: '330000.00',
      encashTaxFree: '52000.00',
      encashDays: '30.00',
    });
    expect(got.settlement.detail.leave.byType).toEqual([
      { code: 'EL', name: 'Earned leave', balance: 45, counted: 30 },
    ]);
    expect(got.can).toMatchObject({ approve: false, compute: true });
    // on the exit statement as payroll's; the statement's form keeps them as they are
    const before = await lines('A');
    expect(before.find((l) => l.code === 'gratuity')).toMatchObject({
      amount: 330000,
      fromPayroll: true,
    });
    const put = await call(admin, 'PUT', `/people/exits/${exit.A!}/fnf`, {
      lines: before
        .filter((l) => !l.code.startsWith('dues_'))
        .map((l: Record<string, unknown>) => ({
          kind: l.kind,
          code: l.code,
          label: l.label,
          amount: l.code === 'gratuity' ? 1 : l.code === 'salary' ? 5000 : l.amount,
          note: l.note ?? null,
        })),
    });
    expect(put.statusCode).toBe(200);
    const after = await lines('A');
    expect(after.find((l) => l.code === 'gratuity')!.amount).toBe(330000);
    expect(after.find((l) => l.code === 'salary')!.amount).toBe(5000);
  });

  it('another checker approves; staged into locked April, paid by a full-and-final run, then settled', async () => {
    expect((await call(maker, 'POST', `/payroll/settlements/${fnf.A!}/approve`)).statusCode).toBe(
      403,
    );
    expect((await call(maker, 'POST', `/payroll/settlements/${fnf.A!}/run`)).statusCode).toBe(409);
    expect((await call(checker, 'POST', `/payroll/settlements/${fnf.A!}/approve`)).statusCode).toBe(
      201,
    );
    const st = (await call(checker, 'POST', `/payroll/settlements/${fnf.A!}/stage`)).json();
    expect(st).toMatchObject({ status: 'STAGED', payMonth: '2026-04', needsRun: true });
    const items = await q<{ code: string; amount: string }>(
      `SELECT h.code, a.amount::text FROM payroll_adhoc a JOIN payroll_pay_heads h ON h.id = a.pay_head_id
        WHERE a.employee_id = $1 AND a.ref_module = 'FNF' ORDER BY h.code`,
      [emp.A],
    );
    expect(items.map((i) => [i.code, i.amount])).toEqual([
      ['ENCASH_EX', '52000.00'],
      ['FNF_REC', '10000.00'],
      ['GRAT_EX', '330000.00'],
      ['NOTICE_REC', '52000.00'],
    ]);
    const loan = await q<{ status: string; balance: string }>(
      `SELECT status, balance::text FROM payroll_loans WHERE employee_id = $1`,
      [emp.A],
    );
    expect(loan[0]).toEqual({ status: 'CLOSED', balance: '0.00' });
    const runId = (await call(maker, 'POST', `/payroll/settlements/${fnf.A!}/run`)).json()
      .runId as string;
    await processRun(runId);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(201);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/lock`)).statusCode).toBe(201);
    const paid = await q<{ code: string; amount: string; purpose: string }>(
      `SELECT l.code, l.amount::text, u.purpose FROM payroll_record_lines l JOIN payroll_records r ON r.id = l.record_id
         JOIN payroll_runs u ON u.id = r.run_id WHERE u.id = $1 AND l.code IN ('GRAT_EX', 'ENCASH_EX') ORDER BY l.code`,
      [runId],
    );
    expect(paid).toEqual([
      { code: 'ENCASH_EX', amount: '52000.00', purpose: 'FNF' },
      { code: 'GRAT_EX', amount: '330000.00', purpose: 'FNF' },
    ]);
    expect(
      (await call(maker, 'GET', `/payroll/settlements/${fnf.A!}`)).json().settlement.status,
    ).toBe('SETTLED');
    // the statement prints once worked out
    const paper = (await call(maker, 'GET', `/payroll/settlements/${fnf.A!}/statement`)).json();
    expect(
      Buffer.from(paper.base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    expect(
      (await call(maker, 'GET', `/payroll/settlements/${fnf.A!}/dues-letter`)).statusCode,
    ).toBe(409);
  });

  it('below nothing: dues with a letter; on a death the nominees’ shares; a checker never approves their own', async () => {
    // B: two years — no gratuity; the loan outstanding is owed
    const b = (await call(maker, 'POST', `/payroll/settlements/${fnf.B!}/compute`, {})).json();
    expect(b).toMatchObject({ gratuity: '0.00', encash: '0.00', net: '-100000.00' });
    await call(checker, 'POST', `/payroll/settlements/${fnf.B!}/approve`);
    const d = (await call(checker, 'POST', `/payroll/settlements/${fnf.B!}/stage`)).json();
    expect(d).toMatchObject({ status: 'DUES', letterNo: 'DUES/2026/0001' });
    expect(
      (
        await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_adhoc WHERE employee_id = $1`,
          [emp.B],
        )
      )[0]!.n,
    ).toBe(0);
    expect(
      (
        await call(checker, 'POST', `/payroll/settlements/${fnf.B!}/collected`, {
          reference: 'Receipt 123',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(maker, 'GET', `/payroll/settlements/${fnf.B!}`)).json().settlement.status,
    ).toBe('SETTLED');
    const letter = (await call(maker, 'GET', `/payroll/settlements/${fnf.B!}/dues-letter`)).json();
    expect(letter.filename).toBe(`DUES_2026_0001_${s}B.pdf`);
    expect(
      Buffer.from(letter.base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    // C died after 1 year 11 months: gratuity for 2 years whatever the service, on the labour codes' wages — basic
    // 30,000 and an allowance of 40,000: half of the 70,000 is wages, 35,000 × 15 / 26 × 2
    const c = (await call(checker, 'POST', `/payroll/settlements/${fnf.C!}/compute`, {})).json();
    expect(c.gratuity).toBe('40384.62');
    const got = (await call(checker, 'GET', `/payroll/settlements/${fnf.C!}`)).json();
    expect(got.settlement.detail.gratuity).toMatchObject({ wage: '35000.00', labourCode: true });
    expect(got.settlement.detail.nominees.map((n: { amount: string }) => n.amount)).toEqual([
      '24230.77',
      '16153.85',
    ]);
    // the run took the same rule for PF: 5,000 more of PF wages in April
    const tr = await q<{ added: string }>(
      `SELECT r.trace->'labourCode'->>'added' AS added FROM payroll_records r WHERE r.employee_id = $1`,
      [emp.C],
    );
    expect(tr[0]!.added).toBe('500000');
    expect(got.can.approve).toBe(false);
    expect((await call(checker, 'POST', `/payroll/settlements/${fnf.C!}/approve`)).statusCode).toBe(
      403,
    );
    // cancelled: the statement's lines are its own again
    expect(
      (
        await call(checker2, 'POST', `/payroll/settlements/${fnf.C!}/cancel`, {
          reason: 'Too short',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(checker2, 'POST', `/payroll/settlements/${fnf.C!}/cancel`, {
          reason: 'Worked out again by hand',
        })
      ).statusCode,
    ).toBe(201);
    const g = (await lines('C')).find((l) => l.code === 'gratuity')!;
    expect(g.amount).toBe(0);
    expect(g.fromPayroll).toBeUndefined();
    expect((await call(maker, 'GET', `/payroll/settlements/${fnf.C!}/statement`)).statusCode).toBe(
      409,
    );
  });
});
