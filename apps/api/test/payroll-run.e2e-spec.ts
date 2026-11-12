/**
 * The monthly payroll run (docs/design/86, phase B step 3): the checks before a run block processing (a
 * structure missing); processed in batches; a negative net failed, recovered over the coming months, processed
 * again; rejected and worked out afresh; approved by a checker who did not create it; a salary held and released;
 * locked — the payslips frozen, fee recovery's receipt posted in Fees; reopened by the payroll admin — the fee
 * receipt reversed, the loan balance restored exactly, the one-off lines pending again; a supplementary run only
 * after the regular one is locked, paying a pending arrear as a top-up with PF on what is left of the ceiling.
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

describe('payroll run (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  const emp: Record<string, string> = {};
  const head: Record<string, string> = {};
  let runId = '';
  let loanId = '';
  let student = '';
  const s = stamp('PRN');
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
  const processAll = async (id: string) => {
    for (let i = 0; i < 10; i += 1) {
      const r = await call(maker, 'POST', `/payroll/runs/${id}/process`);
      expect(r.statusCode).toBe(201);
      if (r.json().done) return r.json();
    }
    throw new Error('not done');
  };
  const recordOf = async (id: string, code: string) =>
    (await call(checker, 'GET', `/payroll/runs/${id}/records?size=100`))
      .json()
      .rows.find((r: { code: string }) => r.code === `${s}${code}`);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      for (const [code, gender, mobile] of [
        ['A', 'male', '9876509999'],
        ['B', 'female', null],
        ['C', 'male', null],
        ['E', 'male', null],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, gender, mobile, dob)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', '2020-01-01', $3::gender, $4, '1985-05-05') RETURNING id::text`,
            [school.id, `${s}${code}`, gender, mobile],
          )
        ).rows[0]!.id;
      await c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, '2026-06-01', true)`,
        [school.id],
      );
      // a child of A with fees due, for fee recovery
      student = (
        await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, 'Kid', 'E2E') RETURNING id::text`,
          [school.id, `${s}-S1`],
        )
      ).rows[0]!.id;
      const g = (
        await c.query<{ id: string }>(
          `INSERT INTO guardians (school_id, first_name, mobile) VALUES ($1, 'Parent', '9876509999') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true)`,
        [school.id, student, g],
      );
      const per = (
        await c.query<{ id: string }>(
          `INSERT INTO fee_periods (school_id, academic_year_id, sequence, name, month, year, instalment, due_on)
           VALUES ($1, $2, 1, 'April', 4, 2026, 1, '2026-04-10') RETURNING id::text`,
          [school.id, school.yearId],
        )
      ).rows[0]!.id;
      const fh = (
        await c.query<{ id: string }>(
          `INSERT INTO fee_heads (school_id, code, name, ledger) VALUES ($1, 'TUI', 'Tuition', 'school') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, net, paid, status, due_on, ledger)
         VALUES ($1, $2, $3, $4, $5, 2000, 2000, 0, 'pending', '2026-04-10', 'school')`,
        [school.id, student, school.yearId, per, fh],
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
    await q(`UPDATE payroll_settings SET state_code = 'MH' WHERE school_id = $1`, [school.id]);
    const st = async (code: string, h: string, amount: number) =>
      q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active')`,
        [school.id, emp[code], head[h], amount],
      );
    await st('A', 'BASIC', 56100);
    await st('A', 'DA', 0);
    await st('A', 'HRA', 0);
    await st('A', 'TA', 3600);
    await st('B', 'BASIC', 15000);
    await st('E', 'BASIC', 1000);
    // the month's attendance: everyone present, finalised
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
          month: '2026-06',
          reason: 'Full month',
          dryRun: false,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: '2026-06' }))
        .statusCode,
    ).toBe(201);
    // inputs: a loan for A, fee recovery for A's child, a deduction too large for E
    loanId = (
      await call(maker, 'POST', '/payroll/inputs/loans', {
        employeeId: emp.A,
        loanType: 'ADVANCE',
        principal: '6000',
        emi: '2000',
        startMonth: '2026-06',
      })
    ).json().id;
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/wards', {
          employeeId: emp.A,
          studentId: student,
        })
      ).statusCode,
    ).toBe(201);
    await call(maker, 'POST', '/payroll/inputs/fee-recovery', {
      month: '2026-06',
      employeeId: emp.A,
      payHeadId: head.WARDFEE,
      items: [{ studentId: student, dueOn: '2026-04-10' }],
    });
    await call(maker, 'POST', '/payroll/inputs/adhoc', {
      month: '2026-06',
      employeeId: emp.E,
      payHeadId: head.MISC_DED,
      amount: '5000',
      remarks: 'Damage to school property',
    });
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('a regular run: created by a maker; the checks block it until fixed', async () => {
    expect(
      (
        await call(maker, 'POST', '/payroll/runs', {
          month: '2026-06',
          runType: 'SUPPLEMENTARY',
          employeeIds: [emp.A],
        })
      ).statusCode,
    ).toBe(409);
    const r = await call(maker, 'POST', '/payroll/runs', { month: '2026-06', runType: 'REGULAR' });
    expect(r.statusCode).toBe(201);
    runId = r.json().id;
    expect(r.json().warnings).toEqual(['The first regular run of this school']);
    expect(
      (await call(maker, 'POST', '/payroll/runs', { month: '2026-06', runType: 'REGULAR' }))
        .statusCode,
    ).toBe(409);
    const checks = (await call(maker, 'GET', `/payroll/runs/${runId}/checks`)).json();
    expect(checks.ok).toBe(false);
    expect(checks.red).toEqual([{ employee: `${s}C`, text: 'No salary structure in force' }]);
    const blocked = await call(maker, 'POST', `/payroll/runs/${runId}/process`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().detail).toContain('blocking item');
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/holds', {
          month: '2026-06',
          employeeId: emp.C,
          mode: 'SKIP',
          reason: 'Joins the rolls next month',
        })
      ).statusCode,
    ).toBe(201);
    expect((await call(maker, 'GET', `/payroll/runs/${runId}/checks`)).json().ok).toBe(true);
  });

  it('processed; a negative net fails and is recovered over the coming months', async () => {
    const done = await processAll(runId);
    expect(done.failures).toEqual({ NEGATIVE_NET: 1 });
    const g = (await call(maker, 'GET', `/payroll/runs/${runId}`)).json();
    expect(g.run.stage).toBe('REVIEW');
    expect(g.counts).toEqual({ COMPUTED: 2, FAILED: 1 });
    const a = await recordOf(runId, 'A');
    // basic 56,100 + DA 60 % + HRA 30 % + TA 3,600 + 60 %
    expect(a.gross).toBe('112350.00');
    const detail = (
      await call(checker, 'GET', `/payroll/runs/${runId}/records/${a.id as string}`)
    ).json();
    const amount = (code: string) =>
      detail.lines.find((l: { code: string }) => l.code === code)?.amount;
    // no payroll profile: PF on the whole wage (12 % of basic + DA ₹89,760)
    expect(amount('PF')).toBe('10771.00');
    expect(amount('PT')).toBe('200.00');
    expect(amount('ADV')).toBe('2000.00');
    expect(amount('WARDFEE')).toBe('2000.00');
    expect(detail.statutory).toMatchObject({ erEps: '1250.00', esiCovered: false });
    expect(detail.tax).toMatchObject({ mode: 'PROJECTION', regime: 'NEW', monthsLeft: 10 });
    expect(detail.record.trace.rates.DA_RATE.value).toBe('0.600000');
    expect(
      (
        await q<{ balance: string }>(`SELECT balance::text FROM payroll_loans WHERE id = $1`, [
          loanId,
        ])
      )[0]!.balance,
    ).toBe('4000.00');
    const b = (
      await call(
        checker,
        'GET',
        `/payroll/runs/${runId}/records/${(await recordOf(runId, 'B')).id as string}`,
      )
    ).json();
    expect(b.statutory).toMatchObject({ esiCovered: true, esiEe: '113.00' });
    // approval waits for the failed record
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(409);
    const e = await recordOf(runId, 'E');
    expect(e).toMatchObject({ status: 'FAILED', failureCode: 'NEGATIVE_NET' });
    const rec = await call(
      checker,
      'POST',
      `/payroll/runs/${runId}/records/${e.id as string}/recovery`,
      { emi: '1000' },
    );
    expect(rec.statusCode).toBe(201);
    const loan = (
      await call(checker, 'GET', `/payroll/inputs/loans/${rec.json().loanId as string}`)
    ).json().loan;
    expect(loan).toMatchObject({ loanType: 'RECOVERY', startMonth: '2026-07' });
    await processAll(runId);
    expect(await recordOf(runId, 'E')).toMatchObject({ status: 'COMPUTED', net: '0.00' });
  });

  it('rejected with a comment, then worked out afresh', async () => {
    expect(
      (await call(checker, 'POST', `/payroll/runs/${runId}/reject`, { comment: 'no' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(checker, 'POST', `/payroll/runs/${runId}/reject`, {
          comment: 'Check the DA for June',
        })
      ).statusCode,
    ).toBe(201);
    const again = await processAll(runId);
    expect(again.failures).toEqual({});
    expect((await call(maker, 'GET', `/payroll/runs/${runId}`)).json().run.stage).toBe('REVIEW');
    // the loan took one instalment, not two
    expect(
      (
        await q<{ balance: string }>(`SELECT balance::text FROM payroll_loans WHERE id = $1`, [
          loanId,
        ])
      )[0]!.balance,
    ).toBe('4000.00');
  });

  it('approved by a checker who did not create it; a salary held and released; locked', async () => {
    expect((await call(maker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(403);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(201);
    const b = await recordOf(runId, 'B');
    expect(
      (
        await call(checker, 'POST', `/payroll/runs/${runId}/records/${b.id as string}/hold`, {
          reason: 'Bank details to verify',
        })
      ).statusCode,
    ).toBe(201);
    expect((await recordOf(runId, 'B')).status).toBe('HELD');
    expect(
      (
        await call(checker, 'POST', `/payroll/runs/${runId}/records/${b.id as string}/release`, {
          reason: 'Verified',
        })
      ).statusCode,
    ).toBe(201);
    const lock = await call(checker, 'POST', `/payroll/runs/${runId}/lock`);
    expect(lock.statusCode).toBe(201);
    expect(lock.json().message).toContain('1 fee receipt(s) posted');
    const pay = await q<{ mode_label: string; amount: string }>(
      `SELECT p.mode_label, p.amount::text FROM fee_payments p WHERE p.student_id = $1`,
      [student],
    );
    expect(pay).toEqual([{ mode_label: 'Salary deduction', amount: '2000.00' }]);
    const slip = await q<{ payslip: { employee: { code: string }; totals: { net: string } } }>(
      `SELECT payslip FROM payroll_records WHERE run_id = $1 AND employee_id = $2`,
      [runId, emp.A],
    );
    expect(slip[0]!.payslip.employee.code).toBe(`${s}A`);
  });

  it('reopened by the payroll admin: the fee receipt reversed, the loan restored, the lines pending again', async () => {
    expect(
      (await call(checker, 'POST', `/payroll/runs/${runId}/reopen`, { comment: 'Wrong DA rate' }))
        .statusCode,
    ).toBe(403);
    const r = await call(admin, 'POST', `/payroll/runs/${runId}/reopen`, {
      comment: 'Wrong DA rate',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().message).toContain('1 fee receipt(s) reversed');
    expect(
      (
        await q<{ balance: string }>(`SELECT balance::text FROM payroll_loans WHERE id = $1`, [
          loanId,
        ])
      )[0]!.balance,
    ).toBe('6000.00');
    expect(
      (
        await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_adhoc WHERE employee_id = $1 AND paid_in_record_id IS NULL AND receipt_pending`,
          [emp.A],
        )
      )[0]!.n,
    ).toBe(1);
    expect((await call(maker, 'GET', `/payroll/runs/${runId}`)).json().run.stage).toBe('DRAFT');
    await processAll(runId);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(201);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/lock`)).statusCode).toBe(201);
  });

  it('a supplementary run after the lock pays a pending arrear as a top-up', async () => {
    await q(
      `INSERT INTO payroll_arrears (school_id, employee_id, pay_head_id, period_month, amount, pf_applicable, taxable, source)
       VALUES ($1, $2, $3, '2026-05-01', 6000, true, true, 'MANUAL')`,
      [school.id, emp.A, head.DA_ARR],
    );
    const sup = await call(maker, 'POST', '/payroll/runs', {
      month: '2026-06',
      runType: 'SUPPLEMENTARY',
      employeeIds: [emp.A],
    });
    expect(sup.statusCode).toBe(201);
    const id = sup.json().id as string;
    await processAll(id);
    const a = await recordOf(id, 'A');
    expect(a).toMatchObject({ status: 'COMPUTED', isTopUp: true, gross: '6000.00' });
    const d = (await call(checker, 'GET', `/payroll/runs/${id}/records/${a.id as string}`)).json();
    // no second PT, loan instalment or fee recovery
    expect(d.lines.map((l: { code: string }) => l.code)).not.toContain('PT');
    expect(d.lines.map((l: { code: string }) => l.code)).not.toContain('ADV');
    // the whole-wage (ACTUAL) basis: PF on the whole arrear (only the CEILING basis is cut to what is left)
    expect(d.statutory.pfWage).toBe('6000.00');
    expect(d.tax.mode).toBe('PROJECTION');
    // the regular run cannot be reopened under a later run
    expect(
      (await call(admin, 'POST', `/payroll/runs/${runId}/reopen`, { comment: 'Too late' }))
        .statusCode,
    ).toBe(409);
  });
});
