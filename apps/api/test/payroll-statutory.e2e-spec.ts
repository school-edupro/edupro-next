/**
 * PF, ESI, profession tax and LWF (docs/design/86, phase C step 2): a month's registers from its runs — PROVISIONAL
 * while a run is only approved, a confidential employee's row hidden from a maker (the totals still count it);
 * staff without PF left out of the ECR; the ECR refused while a member's UAN is wrong; the month's regular ECR filed
 * and kept; a later supplementary run gives a file of only the member not yet filed, and a filed member's top-up is
 * listed for a revised return; the ESIC upload of the covered staff; the profession-tax register with Form IIIB's
 * figures; the LWF of a due month; a register as PDF and Excel; a filing withdrawn by the payroll admin.
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

describe('payroll statutory (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  const emp: Record<string, string> = {};
  const head: Record<string, string> = {};
  let runId = '';
  const s = stamp('PST');
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
  const processAll = async (id: string) => {
    for (let i = 0; i < 10; i += 1)
      if ((await call(maker, 'POST', `/payroll/runs/${id}/process`)).json().done) return;
    throw new Error('not done');
  };
  const recordOf = async (id: string, code: string) =>
    (await call(checker, 'GET', `/payroll/runs/${id}/records?size=100`))
      .json()
      .rows.find((r: { code: string }) => r.code === `${s}${code}`);
  const M = '2026-06';
  // the ECR takes letters, spaces and dots only
  const ecrName = (n: string) =>
    n
      .replace(/[^A-Za-z .]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      for (const [code, gender, uan, ip] of [
        ['A', 'male', '100000000001', '1000000001'],
        ['B', 'female', '100000000002', null],
        ['C', 'male', null, '1000000003'],
        ['D', 'male', '12345', '1000000004'],
        ['E', 'male', '100000000005', '1000000005'],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob,
                                    gender, profile)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', '2020-01-01', '1985-05-05', $3::gender, $4::jsonb) RETURNING id::text`,
            [school.id, `${s}${code}`, gender, JSON.stringify({ uan, esi_no: ip })],
          )
        ).rows[0]!.id;
      // C has no PF
      await c.query(
        `INSERT INTO payroll_profiles (employee_id, school_id, pf_applicable, eps_applicable) VALUES ($1, $2, false, false)`,
        [emp.C, school.id],
      );
      await c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, '2026-06-01', true)`,
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
    await q(
      `UPDATE payroll_settings SET state_code = 'MH', pf_establishment_code = 'MHABC0000001000', esi_code = '10000000000000001',
              ptrc_no = 'PTRC0001', lwf_enabled = true, confidential_employee_ids = ARRAY[$2]::bigint[]
        WHERE school_id = $1`,
      [school.id, emp.B],
    );
    for (const [code, amount] of [
      ['A', 14000],
      ['B', 30000],
      ['C', 12000],
      ['D', 9000],
      ['E', 10000],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active')`,
        [school.id, emp[code], head.BASIC, amount],
      );
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month: M,
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: M });
    // E's pay fails this month (a deduction above the pay): dropped, paid later by a supplementary run
    await call(maker, 'POST', '/payroll/inputs/adhoc', {
      month: M,
      employeeId: emp.E,
      payHeadId: head.MISC_DED,
      amount: '20000',
      remarks: 'Entered against the wrong person',
    });
    runId = (await call(maker, 'POST', '/payroll/runs', { month: M, runType: 'REGULAR' })).json()
      .id;
    await processAll(runId);
    expect(
      (
        await call(checker, 'POST', `/payroll/runs/${runId}/drop-failed`, {
          reason: 'Wrong deduction, paid in a supplementary run',
        })
      ).statusCode,
    ).toBe(201);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the registers: provisional while approved; a maker does not see a confidential row', async () => {
    const o = (await call(maker, 'GET', `/payroll/statutory?month=${M}`)).json();
    expect(o.provisional).toBe(true);
    // no PF for C: A, B, D are members
    expect(o.pf.members).toBe(3);
    expect(o.esi.covered).toBe(3);
    expect(o.pt).toMatchObject({ employees: 4, total: '775.00' });
    expect(o.lwf).toMatchObject({ employees: 4, ee: '100.00', er: '300.00' });
    const pf = (await call(maker, 'GET', `/payroll/statutory/pf?month=${M}`)).json();
    expect(pf.members.map((m: { code: string }) => m.code)).toEqual([`${s}A`, `${s}D`]);
    expect(pf.hiddenCount).toBe(1);
    expect(pf.totals.members).toBe(3);
    const a = pf.members.find((m: { code: string }) => m.code === `${s}A`);
    expect(a).toMatchObject({
      uan: '100000000001',
      gross: '14000',
      epf: '14000',
      eps: '14000',
      edli: '14000',
      ee: '1680',
      epsShare: '1166',
      diff: '514',
      ncp: '0',
    });
    expect(pf.challan).toMatchObject({
      adminMinApplied: true,
      edliMinApplied: false,
      ac2: '500.00',
      ac21: '190.00',
    });
    // the ECR waits for the lock
    expect((await call(checker, 'GET', `/payroll/statutory/pf/ecr?month=${M}`)).statusCode).toBe(
      409,
    );
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/lock`)).statusCode).toBe(201);
    expect((await call(checker, 'GET', `/payroll/statutory?month=${M}`)).json().provisional).toBe(
      false,
    );
    const pdf = (
      await call(maker, 'GET', `/payroll/statutory/register?month=${M}&kind=pf&format=pdf`)
    ).json();
    expect(pdf.filename).toBe('PF_REGISTER_2026_06.pdf');
    expect(Buffer.from(pdf.base64, 'base64').toString('latin1').startsWith('%PDF')).toBe(true);
    for (const kind of ['esi', 'pt', 'lwf'])
      expect(
        (
          await call(
            maker,
            'GET',
            `/payroll/statutory/register?month=${M}&kind=${kind}&format=xlsx`,
          )
        ).json().contentType,
      ).toContain('spreadsheetml');
  });

  it('the ECR: refused on a wrong UAN; the regular file filed and kept', async () => {
    expect((await call(maker, 'GET', `/payroll/statutory/pf/ecr?month=${M}`)).statusCode).toBe(403);
    const refused = await call(checker, 'GET', `/payroll/statutory/pf/ecr?month=${M}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toContain(`${s}D (the UAN 12345 is not 12 digits)`);
    // as a reopen and process again would: D's UAN corrected on the record
    await q(
      `UPDATE payroll_records SET uan = '100000000004' WHERE run_id = $1 AND employee_id = $2`,
      [runId, emp.D],
    );
    const f = (await call(checker, 'GET', `/payroll/statutory/pf/ecr?month=${M}`)).json();
    expect(f.filename).toBe('ECR_2026_06.txt');
    const lines = text(f).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines).toContain(
      `100000000001#~#${ecrName(`${s}A E2E`)}#~#14000#~#14000#~#14000#~#14000#~#1680#~#1166#~#514#~#0#~#0`,
    );
    expect(
      (
        await call(checker, 'POST', '/payroll/statutory/pf/ecr/filed', {
          month: M,
          ackNo: 'X',
          filedOn: '2026-07-10',
        })
      ).statusCode,
    ).toBe(400);
    const filed = (
      await call(checker, 'POST', '/payroll/statutory/pf/ecr/filed', {
        month: M,
        ackNo: 'TRRN0000001',
        filedOn: '2026-07-10',
      })
    ).json();
    expect(filed).toMatchObject({ seq: 1, members: 3 });
    expect((await call(checker, 'GET', `/payroll/statutory/pf/ecr?month=${M}`)).statusCode).toBe(
      409,
    );
    const again = (
      await call(checker, 'GET', `/payroll/statutory/returns/${filed.id as string}/file`)
    ).json();
    expect(text(again)).toBe(text(f));
  });

  it('a later run: a supplementary file of only the new member; a filed member’s top-up listed for revision', async () => {
    // E's wrong deduction removed (one-off items stay open after the lock); A gets an arrear
    const wrong = (
      await q<{ id: string }>(
        `SELECT id::text FROM payroll_adhoc WHERE employee_id = $1 AND paid_in_record_id IS NULL AND deleted_at IS NULL`,
        [emp.E],
      )
    )[0]!.id;
    expect((await call(maker, 'DELETE', `/payroll/inputs/adhoc/${wrong}`)).statusCode).toBe(200);
    await q(
      `INSERT INTO payroll_arrears (school_id, employee_id, pay_head_id, period_month, amount, pf_applicable, taxable, source)
       VALUES ($1, $2, $3, '2026-05-01', 1000, true, true, 'MANUAL')`,
      [school.id, emp.A, head.DA_ARR],
    );
    const sup = (
      await call(maker, 'POST', '/payroll/runs', {
        month: M,
        runType: 'SUPPLEMENTARY',
        employeeIds: [emp.A, emp.E],
      })
    ).json().id as string;
    await processAll(sup);
    expect(await recordOf(sup, 'E')).toMatchObject({ status: 'COMPUTED', isTopUp: false });
    expect(await recordOf(sup, 'A')).toMatchObject({ isTopUp: true });
    await call(checker, 'POST', `/payroll/runs/${sup}/approve`);
    await call(checker, 'POST', `/payroll/runs/${sup}/lock`);
    const pf = (await call(checker, 'GET', `/payroll/statutory/pf?month=${M}`)).json();
    expect(pf.ecr.next).toMatchObject({ seq: 2, kind: 'supplementary', count: 1 });
    expect(pf.ecr.next.members.map((m: { code: string }) => m.code)).toEqual([`${s}E`]);
    expect(pf.ecr.changedAfterFiling.map((m: { code: string }) => m.code)).toEqual([`${s}A`]);
    const f = (await call(checker, 'GET', `/payroll/statutory/pf/ecr?month=${M}`)).json();
    expect(f.filename).toBe('ECR_2026_06_SUPP2.txt');
    expect(text(f).split('\n')).toHaveLength(1);
    const two = (
      await call(checker, 'POST', '/payroll/statutory/pf/ecr/filed', {
        month: M,
        ackNo: 'TRRN0000002',
        filedOn: '2026-07-12',
      })
    ).json();
    // a filing recorded by mistake: the payroll admin withdraws the latest only
    const first = pf.ecr.filed[0].id as string;
    expect(
      (
        await call(checker, 'POST', `/payroll/statutory/returns/${two.id as string}/withdraw`, {
          reason: 'Filed by mistake',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(admin, 'POST', `/payroll/statutory/returns/${first}/withdraw`, {
          reason: 'Filed by mistake',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(admin, 'POST', `/payroll/statutory/returns/${two.id as string}/withdraw`, {
          reason: 'Filed by mistake',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(checker, 'GET', `/payroll/statutory/pf?month=${M}`)).json().ecr.next.seq,
    ).toBe(2);
  });

  it('ESI: the covered staff and the ESIC upload; profession tax with Form IIIB; LWF in June', async () => {
    const esi = (await call(checker, 'GET', `/payroll/statutory/esi?month=${M}`)).json();
    // B earns above the ESI limit
    expect(esi.rows.map((r: { code: string }) => r.code)).toEqual([
      `${s}A`,
      `${s}C`,
      `${s}D`,
      `${s}E`,
    ]);
    expect(esi.rows[0]).toMatchObject({ ip: '1000000001', days: 30, reason: 0 });
    expect(Number(esi.rows[0].wages)).toBeGreaterThanOrEqual(14000);
    const up = (await call(checker, 'GET', `/payroll/statutory/esi/upload?month=${M}`)).json();
    expect(up.filename).toBe('ESIC_2026_06.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(up.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('IP Number (10 Digits)');
    expect(ws.getCell('A2').value).toBe('1000000001');
    expect(ws.rowCount).toBe(5);
    expect((await call(maker, 'GET', `/payroll/statutory/esi/upload?month=${M}`)).statusCode).toBe(
      403,
    );
    const pt = (await call(maker, 'GET', `/payroll/statutory/pt?month=${M}`)).json();
    expect(pt.state).toBe('MH');
    expect(pt.rows.map((r: { rate: string; employees: number }) => [r.rate, r.employees])).toEqual([
      ['175.00', 2],
      ['200.00', 3],
    ]);
    expect(pt.formIIIB).toMatchObject({ ptrcNo: 'PTRC0001', employees: 5, totalTax: '950.00' });
    const lwf = (await call(checker, 'GET', `/payroll/statutory/lwf?month=${M}`)).json();
    expect(lwf).toMatchObject({ due: true, enabled: true, frequency: 'half_yearly' });
    expect(lwf.challan).toMatchObject({
      employees: 5,
      ee: '125.00',
      er: '375.00',
      total: '500.00',
    });
  });
});
