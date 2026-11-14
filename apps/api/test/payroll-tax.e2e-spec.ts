/**
 * Income tax (docs/design/86, phase D step 3): the tax year's settings (the payroll admin); an employee's own
 * declarations — HRA by month with the landlord (PAN above ₹1 lakh a year), 80C with a proof they uploaded — and one
 * made by a maker for staff without a sign-in; the run counting declared amounts until the proof deadline; a checker
 * verifying part of one, rejecting another with a reason, never their own; the earlier employer; the regime in its
 * window; perquisites; the school's final figure; TDS challans against the deducted months; the PAN check; a closed
 * year refusing changes.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { encryptField } from '@edupro/db';
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
const y0 =
  Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
const FY = `${String(y0)}-${String((y0 + 1) % 100).padStart(2, '0')}`;
const PREV_FY = `${String(y0 - 1)}-${String(y0 % 100).padStart(2, '0')}`;
const APRIL = `${String(y0)}-04`;

describe('payroll income tax (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  let checker2: SeededUser;
  let staffA: SeededUser;
  const emp: Record<string, string> = {};
  const head: Record<string, string> = {};
  let runId = '';
  let proof = '';
  const s = stamp('PTX');
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
  const fileOf = async (u: SeededUser, type = 'application/pdf') =>
    (
      await q<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
         VALUES ($1, 'test', $2, $3, 2048, 'proof.pdf', 'ready', $4) RETURNING id::text`,
        [school.id, `${s}/${String(Math.random())}`, type, u.id],
      )
    )[0]!.id;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      checker2 = await seedUser(c, school, `${s}-c2`, 'payroll_checker');
      staffA = await seedUser(c, school, `${s}-st`);
      for (const [code, user, pan] of [
        ['A', staffA.id, 'ABCDE1234F'],
        ['B', null, null],
        ['C', checker2.id, 'ABCDE5678G'],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob,
                                    gender, user_id, secure)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', '2020-01-01', '1985-05-05', 'male', $3, $4::jsonb) RETURNING id::text`,
            [school.id, `${s}${code}`, user, JSON.stringify(pan ? { pan: encryptField(pan) } : {})],
          )
        ).rows[0]!.id;
      await c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)`,
        [school.id, `${APRIL}-01`],
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
    // the regime may be changed all year in this test; A is in the old regime
    await q(
      `UPDATE payroll_settings SET regime_cutoff_month = 3, state_code = 'MH' WHERE school_id = $1`,
      [school.id],
    );
    await q(
      `INSERT INTO payroll_profiles (employee_id, school_id, tax_regime) VALUES ($1, $2, 'OLD')`,
      [emp.A, school.id],
    );
    for (const [code, h, amount] of [
      ['A', 'BASIC', 60000],
      ['A', 'DA', 0],
      ['A', 'HRA', 0],
      ['B', 'BASIC', 40000],
      ['C', 'BASIC', 30000],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, $5::date, 'active')`,
        [school.id, emp[code], head[h], amount, `${APRIL}-01`],
      );
    proof = await fileOf(staffA);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the tax year: set by the payroll admin; HRA counts at 50 % in its listed cities', async () => {
    const y = (await call(maker, 'GET', `/payroll/tax/years/${FY}`)).json();
    expect(y.listedCities).toContain('Mumbai');
    const body = {
      declareFrom: `${String(y0)}-04-01`,
      declareTo: `${String(y0 + 1)}-03-31`,
      proofDue: `${String(y0 + 1)}-03-31`,
      listedCities: [
        'Mumbai',
        'Delhi',
        'Kolkata',
        'Chennai',
        'Bengaluru',
        'Hyderabad',
        'Pune',
        'Ahmedabad',
      ],
    };
    expect((await call(checker, 'PUT', `/payroll/tax/years/${FY}`, body)).statusCode).toBe(403);
    expect((await call(admin, 'PUT', `/payroll/tax/years/${FY}`, body)).statusCode).toBe(200);
  });

  it('declarations: the employee’s own, with proofs; HRA by month with the landlord; one made for staff', async () => {
    const hra = (months: number, rent: string, pan?: string) => ({
      fy: FY,
      lineCode: 'HRA_RENT',
      hra: {
        months: Array.from({ length: months }, (_, k) => ({
          month: `${String(y0)}-${String(4 + k).padStart(2, '0')}`,
          rent,
        })),
        city: 'Pune',
        landlord: {
          name: 'Landlord One',
          address: '1 Test Road, Pune',
          relation: 'None',
          ...(pan ? { pan } : {}),
        },
      },
    });
    // above ₹1 lakh a year without the landlord's PAN
    expect(
      (await call(staffA, 'POST', '/payroll/me/tax/declarations', hra(6, '20000'))).statusCode,
    ).toBe(400);
    const h = await call(
      staffA,
      'POST',
      '/payroll/me/tax/declarations',
      hra(6, '20000', 'PQRST1234K'),
    );
    expect(h.statusCode).toBe(201);
    expect(h.json().amount).toBe('120000.00');
    // a proof uploaded by someone else is refused; one's own is taken
    const other = await fileOf(maker);
    expect(
      (
        await call(staffA, 'POST', '/payroll/me/tax/declarations', {
          fy: FY,
          lineCode: 'CHAPVIA_80C',
          amount: '100000',
          proofFileIds: [other],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(staffA, 'POST', '/payroll/me/tax/declarations', {
          fy: FY,
          lineCode: 'CHAPVIA_80C',
          amount: '100000',
          proofFileIds: [proof],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call(staffA, 'POST', '/payroll/me/tax/declarations', {
          fy: FY,
          lineCode: 'STD_DED',
          amount: '1',
        })
      ).statusCode,
    ).toBe(400);
    // a maker for B (no sign-in); an employee cannot declare for another
    expect(
      (
        await call(maker, 'POST', '/payroll/tax/declarations', {
          fy: FY,
          employeeId: emp.B,
          lineCode: 'CHAPVIA_80D',
          amount: '20000',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call(staffA, 'POST', '/payroll/tax/declarations', {
          fy: FY,
          employeeId: emp.B,
          lineCode: 'CHAPVIA_80D',
          amount: '20000',
        })
      ).statusCode,
    ).toBe(403);
    // C (a checker's own record) declares too
    expect(
      (
        await call(checker2, 'POST', '/payroll/me/tax/declarations', {
          fy: FY,
          lineCode: 'CHAPVIA_80C',
          amount: '50000',
        })
      ).statusCode,
    ).toBe(201);
    const mine = (await call(staffA, 'GET', `/payroll/me/tax?fy=${FY}`)).json();
    expect(mine.declarations).toHaveLength(2);
    const hraRow = mine.declarations.find((d: { lineCode: string }) => d.lineCode === 'HRA_RENT');
    expect(hraRow.detail).toMatchObject({
      city: 'Pune',
      listedCity: true,
      landlord: { panMasked: expect.any(String) },
    });
    expect(hraRow.detail.landlord.panEnc).toBeUndefined();
    // the year worked out live: the old regime, the HRA exemption, 80C with the year's PF
    expect(mine.tax.regime).toBe('OLD');
    expect(Number(mine.tax.working.hra.exempt)).toBeGreaterThan(0);
    const c80 = mine.tax.working.deductions.find((d: { code: string }) => d.code === 'CHAPVIA_80C');
    expect(Number(c80.declared)).toBeGreaterThan(100000);
    expect(mine.tax.otherRegime.regime).toBe('NEW');
    expect(mine.tax.plan).toHaveLength(12);
  });

  it('the run counts declared amounts until the proof deadline', async () => {
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month: APRIL,
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: APRIL });
    runId = (
      await call(maker, 'POST', '/payroll/runs', { month: APRIL, runType: 'REGULAR' })
    ).json().id;
    for (let i = 0; i < 10; i += 1)
      if ((await call(maker, 'POST', `/payroll/runs/${runId}/process`)).json().done) break;
    const t = await q<{ other_deductions: string; regime: string }>(
      `SELECT x.other_deductions::text, x.regime FROM payroll_record_tax x JOIN payroll_records r ON r.id = x.record_id
        WHERE r.run_id = $1 AND r.employee_id = $2`,
      [runId, emp.A],
    );
    expect(t[0]!.regime).toBe('OLD');
    expect(Number(t[0]!.other_deductions)).toBeGreaterThanOrEqual(150000);
    await call(checker, 'POST', `/payroll/runs/${runId}/approve`);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/lock`)).statusCode).toBe(201);
  });

  it('a checker verifies part, rejects with a reason, never their own; the proof opens for payroll staff', async () => {
    const list = (
      await call(maker, 'GET', `/payroll/tax/declarations?fy=${FY}&status=SUBMITTED`)
    ).json();
    expect(list.rows.length).toBe(4);
    const row = (code: string, line: string) =>
      list.rows.find(
        (r: { code: string; lineCode: string }) => r.code === `${s}${code}` && r.lineCode === line,
      );
    const a80 = row('A', 'CHAPVIA_80C').id as string;
    const aHra = row('A', 'HRA_RENT').id as string;
    const c80 = row('C', 'CHAPVIA_80C').id as string;
    expect(
      (await call(maker, 'POST', `/payroll/tax/declarations/${a80}/decide`, { action: 'verify' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker2, 'POST', `/payroll/tax/declarations/${c80}/decide`, {
          action: 'verify',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker, 'POST', `/payroll/tax/declarations/${a80}/decide`, {
          action: 'verify',
          verified: '120000',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(checker, 'POST', `/payroll/tax/declarations/${a80}/decide`, {
          action: 'verify',
          verified: '80000',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call(checker, 'POST', `/payroll/tax/declarations/${aHra}/decide`, {
          action: 'reject',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(checker, 'POST', `/payroll/tax/declarations/${aHra}/decide`, {
          action: 'reject',
          reason: 'Rent receipts missing',
        })
      ).statusCode,
    ).toBe(201);
    // a verified one stays unless reopened
    expect(
      (
        await call(staffA, 'POST', '/payroll/me/tax/declarations', {
          fy: FY,
          lineCode: 'CHAPVIA_80C',
          amount: '90000',
        })
      ).statusCode,
    ).toBe(409);
    const mine = (await call(staffA, 'GET', `/payroll/me/tax?fy=${FY}`)).json();
    expect(
      mine.declarations.find((d: { lineCode: string }) => d.lineCode === 'HRA_RENT'),
    ).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Rent receipts missing',
    });
    expect((await call(checker, 'GET', `/payroll/tax/proofs/${proof}`)).statusCode).toBe(200);
    expect((await call(staffA, 'GET', `/payroll/tax/proofs/${proof}`)).statusCode).toBe(403);
  });

  it('the earlier employer, the regime, perquisites and the final figure', async () => {
    expect(
      (
        await call(staffA, 'POST', '/payroll/me/tax/prev', {
          fy: FY,
          employerName: 'Earlier School',
          employerTan: 'ABCD12345E',
          gross: '100000',
          tds: '5000',
        })
      ).statusCode,
    ).toBe(201);
    const prev = (await call(checker, 'GET', `/payroll/tax/prev?fy=${FY}`)).json().rows[0];
    expect(
      (
        await call(checker, 'POST', `/payroll/tax/prev/${prev.id as string}/decide`, {
          action: 'verify',
        })
      ).statusCode,
    ).toBe(201);
    const sheet = (await call(checker, 'GET', `/payroll/tax/employees/${emp.A}?fy=${FY}`)).json();
    expect(sheet.sheet.prevSalary).toBe('100000.00');
    // perquisites: a maker enters, a checker verifies; it then counts
    const perq = await call(maker, 'POST', '/payroll/tax/perquisites', {
      fy: FY,
      employeeId: emp.A,
      perqType: 'EDUCATION',
      amount: '12000',
    });
    expect(perq.statusCode).toBe(201);
    expect(
      (await call(checker, 'POST', `/payroll/tax/perquisites/${perq.json().id as string}/verify`))
        .statusCode,
    ).toBe(201);
    expect(
      (await call(checker, 'GET', `/payroll/tax/employees/${emp.A}?fy=${FY}`)).json().sheet
        .perquisites,
    ).toBe('12000.00');
    // the final figure: a checker, with a reason; cleared again
    expect(
      (
        await call(checker, 'POST', '/payroll/tax/finals', {
          fy: FY,
          employeeId: emp.A,
          annual: '50000',
          reason: 'As agreed',
        })
      ).statusCode,
    ).toBe(201);
    const fin = (await call(checker, 'GET', `/payroll/tax/employees/${emp.A}?fy=${FY}`)).json();
    expect(fin.annual).toMatchObject({ inUse: '50000.00', final: { annual: '50000.00' } });
    expect(
      (await call(checker, 'POST', '/payroll/tax/finals/clear', { fy: FY, employeeId: emp.A }))
        .statusCode,
    ).toBe(201);
    // the regime: the employee in the window; the payroll admin for another
    expect(
      (await call(staffA, 'POST', '/payroll/me/tax/regime', { fy: FY, regime: 'NEW' })).statusCode,
    ).toBe(201);
    expect((await call(staffA, 'GET', `/payroll/me/tax?fy=${FY}`)).json().tax.regime).toBe('NEW');
    expect(
      (
        await call(checker, 'POST', '/payroll/tax/regime', {
          fy: FY,
          regime: 'OLD',
          employeeId: emp.B,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(admin, 'POST', '/payroll/tax/regime', {
          fy: FY,
          regime: 'OLD',
          employeeId: emp.B,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_regime_events WHERE school_id = $1`,
          [school.id],
        )
      )[0]!.n,
    ).toBe(2);
  });

  it('challans against the deducted months; the PAN check; a closed year refuses changes', async () => {
    const ch = (body: Record<string, unknown>) =>
      call(maker, 'POST', '/payroll/tax/challans', {
        fy: FY,
        quarter: 1,
        bsrCode: '0510001',
        challanNo: '12345',
        depositedOn: `${String(y0)}-05-07`,
        amount: '1000',
        months: [4],
        ...body,
      });
    expect((await ch({ months: [7] })).statusCode).toBe(400);
    const one = await ch({});
    expect(one.statusCode).toBe(201);
    expect(one.json().message).toContain('differs from the TDS deducted');
    expect((await ch({ challanNo: '12346' })).statusCode).toBe(409);
    const list = (await call(maker, 'GET', `/payroll/tax/challans?fy=${FY}`)).json();
    expect(list.rows[0].deducted).toBe(one.json().deducted);
    expect(
      (
        await call(maker, 'POST', `/payroll/tax/challans/${one.json().id as string}/remove`, {
          reason: 'Entered by mistake',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker, 'POST', `/payroll/tax/challans/${one.json().id as string}/remove`, {
          reason: 'Entered by mistake',
        })
      ).statusCode,
    ).toBe(201);
    const pan = (await call(checker, 'GET', '/payroll/tax/pan-check')).json();
    expect(pan.rows.map((r: { code: string; status: string }) => [r.code, r.status])).toEqual([
      [`${s}B`, 'MISSING'],
    ]);
    // the earlier year closed by the payroll admin
    expect((await call(checker, 'POST', `/payroll/tax/years/${PREV_FY}/freeze`)).statusCode).toBe(
      403,
    );
    expect((await call(admin, 'POST', `/payroll/tax/years/${PREV_FY}/freeze`)).statusCode).toBe(
      201,
    );
    expect(
      (
        await call(maker, 'POST', '/payroll/tax/declarations', {
          fy: PREV_FY,
          employeeId: emp.B,
          lineCode: 'CHAPVIA_80D',
          amount: '1000',
        })
      ).statusCode,
    ).toBe(409);
  });
});
