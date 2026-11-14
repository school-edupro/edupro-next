/**
 * Fixing a wrong dated set-up row (docs/design/86, "Withdraw and correct"; migration 0380): an approved row no
 * approved, locked or paid run has read is withdrawn by a checker with a reason — kept as WITHDRAWN, never read, and
 * the row it ended is in force again; a run only processed that read it goes back to draft; once an approved run has
 * read it, it is refused with the month to correct it from. A maker cannot withdraw. End keeps a row ACTIVE to its
 * date. The same holds for a salary structure's amount (by the runs that paid that employee).
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

describe('payroll withdraw and correct (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  let emp = '';
  let basic = '';
  const s = stamp('PWD');
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
  const da = () =>
    q<{
      id: string;
      rate_value: string;
      effective_from: string;
      effective_to: string | null;
      status: string;
    }>(
      `SELECT id::text, rate_value::text, effective_from::text, effective_to::text, status FROM payroll_rates
        WHERE school_id = $1 AND rate_code = 'DA_RATE' ORDER BY effective_from`,
      [school.id],
    );
  const run = (month: string, stage: string) =>
    q<{ id: string }>(
      `INSERT INTO payroll_runs (school_id, month, run_type, seq, stage)
       VALUES ($1, $2::date, 'REGULAR', (SELECT COALESCE(max(seq), 0) + 1 FROM payroll_runs WHERE school_id = $1 AND month = $2::date), $3)
       RETURNING id::text`,
      [school.id, month, stage],
    ).then((r) => r[0]!.id);
  const draftDa = async (value: string, from: string) => {
    const r = await call(maker, 'POST', '/payroll/config/rates', {
      rateCode: 'DA_RATE',
      rateValue: value,
      effectiveFrom: from,
      source: 'govt',
      changeReason: 'DA order',
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    expect((await call(checker, 'POST', `/payroll/config/rates/${id}/approve`)).statusCode).toBe(
      201,
    );
    return id;
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      emp = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on)
           VALUES ($1, $2, 'Asha', 'E2E', 'Science', 'Teacher', '2020-01-01') RETURNING id::text`,
          [school.id, `${s}A`],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    await call(admin, 'GET', '/payroll/setup');
    basic = (
      await q<{ id: string }>(
        `SELECT id::text FROM payroll_pay_heads WHERE school_id = $1 AND code = 'BASIC'`,
        [school.id],
      )
    )[0]!.id;
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('a wrong rate no run read is withdrawn: kept, never read, the row before it back in force', async () => {
    const before = await da();
    const open = before.find((r) => r.status === 'active' && r.effective_to === null)!;
    const wrong = await draftDa('6.4', '2027-01-01');
    // approving it ended the row in force the day before
    expect((await da()).find((r) => r.id === open.id)!.effective_to).toBe('2026-12-31');
    const list = (await call(checker, 'GET', '/payroll/config/rates?status=active')).json();
    const row = list.rows.find((r: { id: string }) => r.id === wrong);
    expect(row.usage).toEqual(
      expect.objectContaining({ closed: false, open: [], correctFrom: null }),
    );
    // a maker cannot withdraw; a reason is needed
    expect(
      (
        await call(maker, 'POST', `/payroll/dated/rates/${wrong}/withdraw`, {
          reason: 'Typed 6.4 for 0.64',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call(checker, 'POST', `/payroll/dated/rates/${wrong}/withdraw`, { reason: 'typo' }))
        .statusCode,
    ).toBe(400);
    const w = await call(checker, 'POST', `/payroll/dated/rates/${wrong}/withdraw`, {
      reason: 'Typed 6.4 for 0.64',
    });
    expect(w.statusCode).toBe(201);
    expect(w.json().message).toContain('The row before it is in force again');
    const after = await da();
    expect(after.find((r) => r.id === wrong)!.status).toBe('withdrawn');
    expect(after.find((r) => r.id === open.id)!.effective_to).toBeNull();
    // a second withdrawal is refused; the history keeps it with the reason
    expect(
      (
        await call(checker, 'POST', `/payroll/dated/rates/${wrong}/withdraw`, {
          reason: 'Typed 6.4 for 0.64',
        })
      ).statusCode,
    ).toBe(409);
    const all = (
      await call(checker, 'GET', '/payroll/setup-lists/config?kind=rates&status=withdrawn')
    ).json();
    expect(
      all.rows.map((r: { id: string; withdrawReason: string }) => [r.id, r.withdrawReason]),
    ).toEqual([[wrong, 'Typed 6.4 for 0.64']]);
    const ev = await q(
      `SELECT 1 FROM audit_logs WHERE school_id = $1 AND action = 'payroll.rates.withdraw' AND entity_id = $2`,
      [school.id, wrong],
    );
    expect(ev).toHaveLength(1);
  });

  it('read by an approved run it is corrected, not withdrawn; a processed run goes back to draft', async () => {
    const row = await draftDa('0.64', '2027-02-01');
    await run('2027-02-01', 'APPROVED');
    const list = (await call(checker, 'GET', '/payroll/config/rates?status=active')).json();
    expect(list.rows.find((r: { id: string }) => r.id === row).usage).toEqual(
      expect.objectContaining({
        closed: true,
        closedMonths: ['2027-02'],
        correctFrom: '2027-03-01',
      }),
    );
    const no = await call(checker, 'POST', `/payroll/dated/rates/${row}/withdraw`, {
      reason: 'Wrong DA order applied',
    });
    expect(no.statusCode).toBe(409);
    expect(no.json().detail).toContain('correct it with a new row from 2027-03');
    // a row only processed: the run goes back to draft
    const later = await draftDa('0.66', '2027-04-01');
    const review = await run('2027-04-01', 'REVIEW');
    const ok = await call(checker, 'POST', `/payroll/dated/rates/${later}/withdraw`, {
      reason: 'The order was not for us',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().runsBackToDraft).toEqual(['2027-04']);
    const st = await q<{ stage: string }>(`SELECT stage FROM payroll_runs WHERE id = $1`, [review]);
    expect(st[0]!.stage).toBe('DRAFT');
    // the row it had ended (from February) is open again
    expect((await da()).find((r) => r.id === row)!.effective_to).toBeNull();
  });

  it('End keeps a row ACTIVE to its date (the months before still read it)', async () => {
    const hra = (
      await q<{ id: string }>(
        `SELECT id::text FROM payroll_rates WHERE school_id = $1 AND rate_code = 'HRA_RATE' AND status = 'active'`,
        [school.id],
      )
    )[0]!.id;
    expect(
      (
        await call(checker, 'POST', `/payroll/config/rates/${hra}/end`, {
          effectiveTo: '2027-03-31',
          reason: 'HRA moves to the new order',
        })
      ).statusCode,
    ).toBe(201);
    const r = await q<{ status: string; effective_to: string }>(
      `SELECT status, effective_to::text FROM payroll_rates WHERE id = $1`,
      [hra],
    );
    expect(r[0]).toEqual({ status: 'active', effective_to: '2027-03-31' });
  });

  it('a salary amount: withdrawn while no approved run paid that employee', async () => {
    const save = async (amount: string, from: string) => {
      const r = await call(maker, 'POST', `/payroll/structures/${emp}`, {
        effectiveFrom: from,
        changeReason: 'Pay fixed',
        lines: [{ payHeadId: basic, amount }],
      });
      expect([200, 201]).toContain(r.statusCode);
      expect(
        (await call(checker, 'POST', '/payroll/structures/approve', { employeeIds: [emp] }))
          .statusCode,
      ).toBe(201);
    };
    await save('30000', '2026-04-01');
    await save('3000', '2026-10-01');
    const view = (await call(checker, 'GET', `/payroll/structures/${emp}`)).json();
    const wrong = view.timeline.find((t: { amount: string }) => t.amount === '3000.00');
    expect(wrong.usage.closed).toBe(false);
    // an approved run that paid someone else does not count
    const other = await run('2026-10-01', 'APPROVED');
    expect(other).toBeTruthy();
    const w = await call(
      checker,
      'POST',
      `/payroll/dated/structures/${wrong.id as string}/withdraw`,
      {
        reason: 'A zero was missed',
      },
    );
    expect(w.statusCode).toBe(201);
    const t = await q<{ amount: string; status: string; effective_to: string | null }>(
      `SELECT amount::text, status, effective_to::text FROM payroll_structures WHERE employee_id = $1 ORDER BY effective_from`,
      [emp],
    );
    expect(t).toEqual([
      { amount: '30000.00', status: 'active', effective_to: null },
      { amount: '3000.00', status: 'withdrawn', effective_to: null },
    ]);
  });
});
