/**
 * The salary voucher and the compliance calendar (docs/design/86, phase C step 3): the month's voucher — salaries by
 * staff type and the employer's contributions on the debit side, each deduction payable with the employer's share and
 * the net salaries on the credit side — balanced, PROVISIONAL while the run is only approved, its ledger names from
 * the settings, as CSV, Excel and PDF; a financial year's dues set up once (again adds nothing), each due on the
 * statutory day, marked done by a checker with its acknowledgement and the amount set against payroll's figure,
 * never done twice, reopened only by the payroll admin; overdue dues on the payroll set-up page.
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

describe('payroll voucher and compliance (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  const emp: Record<string, string> = {};
  let runId = '';
  const s = stamp('PAC');
  const M = '2026-06';
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
  const text = (f: { base64: string }) => Buffer.from(f.base64, 'base64').toString('utf8');
  const amountOf = (lines: Array<{ ledger: string; amount: string }>, ledger: string) =>
    lines.find((l) => l.ledger === ledger)?.amount;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      for (const [code, type] of [
        ['A', 'Teaching'],
        ['B', 'Administration'],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob,
                                    gender, profile)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', '2020-01-01', '1985-05-05', 'male', $3::jsonb) RETURNING id::text`,
            [school.id, `${s}${code}`, JSON.stringify({ staff_type: type, uan: '100000000001' })],
          )
        ).rows[0]!.id;
      await c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, '2026-06-01', true)`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    await call(admin, 'GET', '/payroll/setup');
    const basic = (
      await q<{ id: string }>(
        `SELECT id::text FROM payroll_pay_heads WHERE school_id = $1 AND code = 'BASIC'`,
        [school.id],
      )
    )[0]!.id;
    await q(
      `UPDATE payroll_settings SET state_code = 'MH', lwf_enabled = true WHERE school_id = $1`,
      [school.id],
    );
    for (const [code, amount] of [
      ['A', 14000],
      ['B', 30000],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active')`,
        [school.id, emp[code], basic, amount],
      );
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month: M,
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: M });
    runId = (await call(maker, 'POST', '/payroll/runs', { month: M, runType: 'REGULAR' })).json()
      .id;
    for (let i = 0; i < 10; i += 1)
      if ((await call(maker, 'POST', `/payroll/runs/${runId}/process`)).json().done) break;
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the voucher: balanced, by staff type, provisional while approved, ledger names from the settings', async () => {
    const v = (await call(maker, 'GET', `/payroll/voucher?month=${M}`)).json();
    expect(v).toMatchObject({ provisional: true, balanced: true, records: 2, ledgersSet: false });
    expect(amountOf(v.debit, 'Salaries & Wages — Teaching')).toBe('14000.00');
    expect(amountOf(v.debit, 'Salaries & Wages — Administration')).toBe('30000.00');
    expect(v.debit.map((l: { ledger: string }) => l.ledger)).toContain('Employer PF Contribution');
    // the PF payable carries the employees' and the employer's PF
    const pf = Number(amountOf(v.credit, "Employees' Provident Fund Payable"));
    const erPf = Number(amountOf(v.debit, 'Employer PF Contribution'));
    expect(pf).toBeGreaterThan(erPf);
    expect(v.totalDebit).toBe(v.totalCredit);
    const csv = text(
      (await call(maker, 'GET', `/payroll/voucher/file?month=${M}&format=csv`)).json(),
    );
    expect(csv.split('\n')[0]).toContain('PROVISIONAL');
    // the payroll admin names the ledgers
    const settings = (await call(admin, 'GET', '/payroll/settings')).json().settings;
    const body = { ...settings };
    delete body.updatedAt;
    expect(
      (
        await call(admin, 'PUT', '/payroll/settings', {
          ...body,
          jvLedgers: {
            salary: { Teaching: 'Teaching Staff Salaries' },
            net: 'Salaries Payable A/c',
          },
        })
      ).statusCode,
    ).toBe(200);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/lock`)).statusCode).toBe(201);
    const named = (await call(maker, 'GET', `/payroll/voucher?month=${M}`)).json();
    expect(named).toMatchObject({ provisional: false, balanced: true, ledgersSet: true });
    expect(amountOf(named.debit, 'Teaching Staff Salaries')).toBe('14000.00');
    expect(amountOf(named.credit, 'Salaries Payable A/c')).toBeDefined();
    const lines = text(
      (await call(maker, 'GET', `/payroll/voucher/file?month=${M}&format=csv`)).json(),
    ).split('\n');
    expect(lines[0]).toBe('Type,Ledger,Amount');
    expect(lines).toContain('Dr,"Teaching Staff Salaries",14000.00');
    const pdf = (await call(maker, 'GET', `/payroll/voucher/file?month=${M}&format=pdf`)).json();
    expect(Buffer.from(pdf.base64, 'base64').toString('latin1').startsWith('%PDF')).toBe(true);
    expect(
      (await call(maker, 'GET', `/payroll/voucher/file?month=2026-09&format=xlsx`)).statusCode,
    ).toBe(409);
  });

  it('the compliance calendar: set up once, marked done against payroll’s figure, reopened by the admin', async () => {
    expect((await call(maker, 'POST', '/payroll/compliance/seed', { fy: 2026 })).statusCode).toBe(
      403,
    );
    const seeded = (await call(checker, 'POST', '/payroll/compliance/seed', { fy: 2026 })).json();
    // ECR, ESI, TDS and PT each month, LWF in June and December, four TDS returns
    expect(seeded.added).toBe(12 * 4 + 2 + 4);
    expect(
      (await call(checker, 'POST', '/payroll/compliance/seed', { fy: 2026 })).json().added,
    ).toBe(0);
    const cal = (await call(maker, 'GET', '/payroll/compliance?fy=2026')).json();
    expect(cal.rows).toHaveLength(54);
    const ecr = cal.rows.find(
      (r: { item: string; period: string }) => r.item === 'ECR' && r.period === M,
    );
    expect(ecr.dueOn).toBe('2026-07-15');
    expect(
      cal.rows.find(
        (r: { item: string; period: string }) => r.item === 'TDS' && r.period === '2027-03',
      ).dueOn,
    ).toBe('2027-04-30');
    expect(
      cal.rows.find(
        (r: { item: string; period: string }) => r.item === 'LWF' && r.period === '2026-12',
      ).dueOn,
    ).toBe('2027-01-15');
    // the set-up page shows the overdue dues
    const setup = (await call(admin, 'GET', '/payroll/setup')).json();
    expect(setup.checks.map((x: { text: string }) => x.text).join(' | ')).toMatch(
      /statutory due\(s\) overdue/,
    );
    const id = ecr.id as string;
    const url = `/payroll/compliance/${id}/done`;
    expect(
      (await call(checker, 'POST', url, { ackNo: 'X', ackDate: '2026-07-10', amountPaid: '100' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(checker, 'POST', url, {
          ackNo: 'TRRN1',
          ackDate: '2099-01-01',
          amountPaid: '100',
        })
      ).statusCode,
    ).toBe(400);
    const challan = (await call(checker, 'GET', `/payroll/statutory/pf?month=${M}`)).json().challan
      .total as string;
    const paid = (Number(challan) - 1).toFixed(2);
    const done = (
      await call(checker, 'POST', url, { ackNo: 'TRRN1', ackDate: '2026-07-10', amountPaid: paid })
    ).json();
    expect(done).toMatchObject({ computed: challan, difference: '-1.00' });
    expect(done.message).toContain('differs');
    expect(
      (
        await call(checker, 'POST', url, {
          ackNo: 'TRRN2',
          ackDate: '2026-07-11',
          amountPaid: paid,
        })
      ).statusCode,
    ).toBe(409);
    const after = (await call(maker, 'GET', '/payroll/compliance?fy=2026')).json();
    expect(after.rows.find((r: { id: string }) => r.id === id)).toMatchObject({
      status: 'DONE',
      ackNo: 'TRRN1',
      difference: '-1.00',
    });
    expect(
      (
        await call(checker, 'POST', `/payroll/compliance/${id}/reopen`, {
          reason: 'Wrong challan entered',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(admin, 'POST', `/payroll/compliance/${id}/reopen`, {
          reason: 'Wrong challan entered',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(maker, 'GET', '/payroll/compliance?fy=2026'))
        .json()
        .rows.find((r: { id: string }) => r.id === id).status,
    ).toBe('OVERDUE');
  });
});
