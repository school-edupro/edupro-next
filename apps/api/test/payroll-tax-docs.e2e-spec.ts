/**
 * Income-tax papers (docs/design/86, phase D step 4), on 2025-26's last quarter: the return refused until every month
 * is locked and every month's TDS has its challan (amounts equal); the challans, Annexure I and Annexure II files; the
 * declaration (Form 12BB that year); Part A from TRACES matched by the PAN in its file name; the certificates made
 * from the locked year, locked with the payslip password, Part A before Part B; released in My tax; e-mailed only to
 * those with an address.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { encryptField } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { PDFDocument } from 'pdf-lib';
import { STORAGE_DRIVER } from '../src/modules/files/storage';
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

const FY = '2025-26';
const MONTHS = ['2026-01', '2026-02', '2026-03'];

describe('payroll tax papers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  let staffA: SeededUser;
  const emp: Record<string, string> = {};
  const runs: string[] = [];
  const s = stamp('PTD');
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
    runs.push(id);
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      staffA = await seedUser(c, school, `${s}-st`);
      for (const [code, user, pan, email] of [
        ['A', staffA.id, 'ABCDE1234F', `${s.toLowerCase()}a@example.test`],
        ['B', null, null, null],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob,
                                    gender, user_id, email, secure)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', '2020-01-01', '1985-05-05', 'male', $3, $4, $5::jsonb) RETURNING id::text`,
            [
              school.id,
              `${s}${code}`,
              user,
              email,
              JSON.stringify(pan ? { pan: encryptField(pan) } : {}),
            ],
          )
        ).rows[0]!.id;
      for (const m of MONTHS)
        await c.query(
          `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)`,
          [school.id, `${m}-01`],
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
      `UPDATE payroll_settings SET payslip_password = '{EMPID}', tan = 'ABCD12345E' WHERE school_id = $1`,
      [school.id],
    );
    for (const [code, amount] of [
      ['A', 500000],
      ['B', 450000],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2025-04-01', 'active')`,
        [school.id, emp[code], basic, amount],
      );
    // A declares 80C (made by a maker; verified by the checker)
    const d = await call(maker, 'POST', '/payroll/tax/declarations', {
      fy: FY,
      employeeId: emp.A,
      lineCode: 'CHAPVIA_80C',
      amount: '100000',
    });
    await call(checker, 'POST', `/payroll/tax/declarations/${d.json().id as string}/decide`, {
      action: 'verify',
    });
    await runMonth(MONTHS[0]!);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the return waits for every month locked and each month’s challan', async () => {
    const r = await call(checker, 'GET', `/payroll/tax/returns?fy=${FY}&quarter=4&file=challans`);
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toContain('2026-02, 2026-03');
    await runMonth(MONTHS[1]!);
    await runMonth(MONTHS[2]!);
    const noChallan = await call(
      checker,
      'GET',
      `/payroll/tax/returns?fy=${FY}&quarter=4&file=challans`,
    );
    expect(noChallan.statusCode).toBe(409);
    expect(noChallan.json().detail).toContain('has TDS and no challan');
    const months = (await call(maker, 'GET', `/payroll/tax/challans?fy=${FY}`)).json()
      .months as Array<{
      month: number;
      deducted: string;
    }>;
    for (const [i, m] of [1, 2, 3].entries())
      expect(
        (
          await call(maker, 'POST', '/payroll/tax/challans', {
            fy: FY,
            quarter: 4,
            bsrCode: '0510001',
            challanNo: String(100 + i),
            depositedOn: `2026-0${String(m + 1)}-07`,
            amount: months.find((x) => x.month === m)!.deducted,
            months: [m],
          })
        ).statusCode,
      ).toBe(201);
    expect(
      (await call(maker, 'GET', `/payroll/tax/returns?fy=${FY}&quarter=4&file=challans`))
        .statusCode,
    ).toBe(403);
    const ch = (
      await call(checker, 'GET', `/payroll/tax/returns?fy=${FY}&quarter=4&file=challans`)
    ).json();
    expect(ch.filename).toBe(`FORM24_${FY}_Q4_CHALLANS.csv`);
    const lines = text(ch).split('\n');
    expect(lines[0]).toBe(`Form,24Q,FY,${FY},Quarter,Q4,File,CHALLANS`);
    expect(lines).toHaveLength(2 + 3);
    const a1 = text(
      (await call(checker, 'GET', `/payroll/tax/returns?fy=${FY}&quarter=4&file=annexure1`)).json(),
    ).split('\n');
    // two staff, three months, each with tax
    expect(a1).toHaveLength(2 + 6);
    expect(a1.some((l) => l.includes('ABCDE1234F'))).toBe(true);
    expect(a1.some((l) => l.includes('PANNOTAVBL') && l.endsWith(',C'))).toBe(true);
    const a2 = text(
      (await call(checker, 'GET', `/payroll/tax/returns?fy=${FY}&quarter=4&file=annexure2`)).json(),
    ).split('\n');
    expect(a2).toHaveLength(2 + 2);
    expect(
      (await call(checker, 'GET', `/payroll/tax/returns?fy=${FY}&quarter=3&file=annexure2`))
        .statusCode,
    ).toBe(400);
  });

  it('the declaration form, for the employee and for payroll staff', async () => {
    const mine = (await call(staffA, 'GET', `/payroll/me/tax/declaration-form?fy=${FY}`)).json();
    expect(mine.filename).toBe(`Form_12BB_${s}A_${FY}.pdf`);
    expect(Buffer.from(mine.base64, 'base64').toString('latin1').startsWith('%PDF')).toBe(true);
    expect(
      (await call(maker, 'GET', `/payroll/tax/declaration-form/${emp.A}?fy=${FY}`)).statusCode,
    ).toBe(200);
  });

  it('certificates: Part A by PAN, made locked from the locked year, released, e-mailed', async () => {
    // a one-page Part A as TRACES would give it, named with the PAN
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const bytes = Buffer.from(await doc.save());
    const storage = app.get<StorageDriver>(STORAGE_DRIVER);
    const key = `${s}/parta-${String(Date.now())}.pdf`;
    await storage.write(key, bytes, 'application/pdf');
    const file = (
      await q<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, storage_driver, created_by)
         VALUES ($1, $2, $3, 'application/pdf', $4, 'ABCDE1234F_Q4_2025-26.pdf', 'ready', $5, $6) RETURNING id::text`,
        [school.id, storage.bucket, key, bytes.length, storage.name, checker.id],
      )
    )[0]!.id;
    const unknown = (
      await q<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
         VALUES ($1, 'test', $2, 'application/pdf', 10, 'ZZZZZ9999Z.pdf', 'ready', $3) RETURNING id::text`,
        [school.id, `${s}/unknown`, checker.id],
      )
    )[0]!.id;
    const pa = (
      await call(checker, 'POST', '/payroll/tax/certificates/part-a', {
        fy: FY,
        fileIds: [file, unknown],
      })
    ).json();
    expect(pa).toEqual({ matched: [`${s}A`], unmatched: ['ZZZZZ9999Z.pdf'] });
    expect((await call(staffA, 'GET', `/payroll/me/tax/certificate?fy=${FY}`)).statusCode).toBe(
      404,
    );
    const made = (await call(checker, 'POST', '/payroll/tax/certificates/make', { fy: FY })).json();
    expect(made).toMatchObject({ made: 2, noPartA: [`${s}B`], unlocked: [] });
    const a = (
      await call(checker, 'GET', `/payroll/tax/certificates/${emp.A}/file?fy=${FY}`)
    ).json();
    const raw = Buffer.from(a.base64, 'base64');
    expect(raw.toString('latin1')).toContain('/Encrypt');
    // not released yet: the employee does not see it
    expect((await call(staffA, 'GET', `/payroll/me/tax/certificate?fy=${FY}`)).statusCode).toBe(
      404,
    );
    expect(
      (await call(checker, 'POST', '/payroll/tax/certificates/release', { fy: FY })).json(),
    ).toEqual({ released: 2 });
    expect((await call(staffA, 'GET', `/payroll/me/tax/certificate?fy=${FY}`)).statusCode).toBe(
      200,
    );
    const sent = (await call(checker, 'POST', '/payroll/tax/certificates/send', { fy: FY })).json();
    expect(sent).toEqual({ queued: 1, noEmail: [`${s}B`] });
    const list = (await call(checker, 'GET', `/payroll/tax/certificates?fy=${FY}`)).json();
    expect(list.title).toBe('FORM NO. 16');
    expect(list.rows.find((r: { code: string }) => r.code === `${s}A`)).toMatchObject({
      partA: true,
    });
    // an open run of the year stops the certificates
    await q(`UPDATE payroll_runs SET stage = 'APPROVED' WHERE id = $1`, [runs[2]]);
    expect(
      (await call(checker, 'POST', '/payroll/tax/certificates/make', { fy: FY })).statusCode,
    ).toBe(409);
    await q(`UPDATE payroll_runs SET stage = 'LOCKED' WHERE id = $1`, [runs[2]]);
  });
});
