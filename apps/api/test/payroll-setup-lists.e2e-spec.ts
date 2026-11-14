/**
 * The payroll set-up's lists (docs/design/86, "Set-up lists"): each list pages and filters on the server; a download
 * is every row the filters leave, as Excel or PDF, recorded in the payroll audit trail; PAN and bank stay masked in a
 * file as on the screen and confidential staff stay out of a maker's file; the bank list is a checker's; the comparison
 * with the old payroll pages in the database; the Set-up book holds the whole set-up a sheet each.
 */
import { encryptField } from '@edupro/db';
import ExcelJS from 'exceljs';
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

describe('payroll set-up lists (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  const emp: Record<string, string> = {};
  const s = stamp('PSL');
  const call = (u: SeededUser, url: string) =>
    inject({ method: 'GET', url, headers: headersFor(u.sub, school.id) });
  const q = <T>(sql: string, args: unknown[] = []) =>
    withMigrator((c) => c.query<T & Record<string, unknown>>(sql, args)).then((r) => r.rows);
  const sheet = async (base64: string) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as ArrayBuffer);
    return wb;
  };
  const text = (ws: ExcelJS.Worksheet) => {
    const out: string[] = [];
    ws.eachRow((r) => out.push((r.values as unknown[]).map((v) => String(v ?? '')).join('|')));
    return out.join('\n');
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      for (const [code, dept] of [
        ['A', 'Science'],
        ['B', 'Science'],
        ['C', 'Accounts'],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, secure)
             VALUES ($1, $2, $2, 'E2E', $3, 'Teacher', $4::jsonb) RETURNING id::text`,
            [
              school.id,
              `${s}${code}`,
              dept,
              JSON.stringify(code === 'B' ? {} : { pan: encryptField('ABCDE1234F') }),
            ],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    await call(admin, '/payroll/setup');
    // C is confidential: a maker never sees C's pay details
    await q(
      `UPDATE payroll_settings SET confidential_employee_ids = $2::bigint[] WHERE school_id = $1`,
      [school.id, [emp.C]],
    );
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('a list filters and pages on the server; an unknown list or a missing id is refused', async () => {
    const all = (await call(checker, '/payroll/setup-lists/heads')).json();
    expect(all.total).toBeGreaterThan(10);
    expect(all.filters.map((f: { key: string }) => f.key)).toEqual([
      'q',
      'type',
      'category',
      'calc',
      'status',
      'drafts',
    ]);
    const ded = (await call(checker, '/payroll/setup-lists/heads?type=DEDUCTION&size=25')).json();
    expect(ded.total).toBeLessThan(all.total);
    expect(ded.rows.every((r: { headType: string }) => r.headType === 'DEDUCTION')).toBe(true);
    expect(ded.applied).toEqual({ type: 'DEDUCTION' });
    const p2 = (await call(checker, '/payroll/setup-lists/heads?size=25&page=2')).json();
    expect(p2.page).toBe(2);
    expect(p2.rows).toHaveLength(Math.min(25, all.total - 25));
    // the search finds a head by code
    expect((await call(checker, '/payroll/setup-lists/heads?q=BASIC')).json().rows[0].code).toBe(
      'BASIC',
    );
    expect((await call(checker, '/payroll/setup-lists/nope')).statusCode).toBe(404);
    expect((await call(checker, '/payroll/setup-lists/head-versions')).statusCode).toBe(400);
    // a rate tab: in force on a date, and its own filters
    const da = (
      await call(checker, '/payroll/setup-lists/config?kind=rates&q=DA_RATE&on=2026-02-01')
    ).json();
    expect(da.rows).toHaveLength(1);
    expect(da.rows[0].rateValue).toBe('0.600000');
    expect(
      (await call(checker, '/payroll/setup-lists/config?kind=pt'))
        .json()
        .filters.map((f: { key: string }) => f.key),
    ).toEqual(['state', 'status', 'on']);
  });

  it('a file is every filtered row, recorded; PAN masked; confidential staff out of a maker’s file', async () => {
    const x = (
      await call(checker, '/payroll/setup-lists/heads/file?format=xlsx&type=DEDUCTION')
    ).json();
    expect(x.filename).toBe('Pay_heads.xlsx');
    const ws = (await sheet(x.base64)).worksheets[0]!;
    const t = text(ws);
    expect(t).toContain('Filters: Type: Deductions');
    expect(t).not.toContain('|BASIC|');
    const pdf = (await call(checker, '/payroll/setup-lists/heads/file?format=pdf')).json();
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    const ev = await q<{ after: { format: string; rows: number } }>(
      `SELECT after FROM audit_logs WHERE school_id = $1 AND action = 'payroll.setup.download' AND entity_id = 'heads' ORDER BY id`,
      [school.id],
    );
    expect(ev.map((e) => e.after.format)).toEqual(['xlsx', 'pdf']);
    // profiles: masked for everyone; the maker's file leaves the confidential employee out
    const ck = text(
      (
        await sheet(
          (await call(checker, '/payroll/setup-lists/profiles/file?format=xlsx')).json().base64,
        )
      ).worksheets[0]!,
    );
    expect(ck).toContain(`${s}C`);
    expect(ck).not.toContain('ABCDE1234F');
    expect(ck).toMatch(/X{4,}234F|\*{4,}234F|234F/);
    const mk = text(
      (
        await sheet(
          (await call(maker, '/payroll/setup-lists/profiles/file?format=xlsx')).json().base64,
        )
      ).worksheets[0]!,
    );
    expect(mk).toContain(`${s}A`);
    expect(mk).not.toContain(`${s}C`);
    // the missing-PAN filter and the department filter
    const nopan = (await call(checker, '/payroll/setup-lists/profiles?missing=pan')).json();
    expect(nopan.rows.map((r: { code: string }) => r.code)).toEqual([`${s}B`]);
    const acc = (await call(checker, '/payroll/setup-lists/profiles?department=Accounts')).json();
    expect(acc.rows.map((r: { code: string }) => r.code)).toEqual([`${s}C`]);
  });

  it('rights: the bank list is a checker’s; the comparison pages in the database', async () => {
    expect((await call(maker, '/payroll/setup-lists/bank-accounts')).statusCode).toBe(403);
    expect((await call(checker, '/payroll/setup-lists/bank-accounts')).statusCode).toBe(200);
    // a comparison of two months with three results
    const b = (
      await q<{ id: string }>(
        `INSERT INTO payroll_parity_batches (school_id, kind, months, engine_version)
         VALUES ($1, 'REPLAY', ARRAY['2026-04-01','2026-05-01']::date[], 'test') RETURNING id::text`,
        [school.id],
      )
    )[0]!.id;
    for (const [m, comp, st, diff] of [
      ['2026-04-01', 'BASIC', 'MATCH', '0'],
      ['2026-04-01', 'NET', 'OPEN', '12.50'],
      ['2026-05-01', 'NET', 'OPEN', '3.00'],
    ] as const)
      await q(
        `INSERT INTO payroll_parity_results (school_id, batch_id, employee_id, month, component, legacy, ours, diff, status)
         VALUES ($1, $2, $3, $4::date, $5, 100, 100 + $6::numeric, $6::numeric, $7)`,
        [school.id, b, emp.A, m, comp, diff, st],
      );
    const open = (
      await call(checker, `/payroll/setup-lists/parity?batchId=${b}&status=OPEN&size=25`)
    ).json();
    expect(open.total).toBe(2);
    expect(open.all).toBe(3);
    expect(open.filters.find((f: { key: string }) => f.key === 'month').options).toHaveLength(2);
    const may = (
      await call(checker, `/payroll/setup-lists/parity?batchId=${b}&status=OPEN&month=2026-05`)
    ).json();
    expect(may.rows.map((r: { diff: string }) => r.diff)).toEqual(['3.00']);
    const f = text(
      (
        await sheet(
          (
            await call(
              checker,
              `/payroll/setup-lists/parity/file?format=xlsx&batchId=${b}&status=OPEN`,
            )
          ).json().base64,
        )
      ).worksheets[0]!,
    );
    expect(f).toContain('Filters: Status: Open');
    expect(f).not.toContain('The same');
  });

  it('overtime rates are by the employee types of the staff master', async () => {
    await q(`SELECT app.staff_masters_seed($1)`, [school.id]);
    const ot = (await call(maker, '/payroll/config/ot?status=all')).json();
    expect(ot.employeeTypes).toEqual(
      expect.arrayContaining(['Teaching Regular', 'Visiting Faculty']),
    );
    const post = (employeeType: string) =>
      inject({
        method: 'POST',
        url: '/payroll/config/ot',
        headers: headersFor(maker.sub, school.id),
        json: {
          employeeType,
          dailyAmount: '500',
          hourlyAmount: '80',
          effectiveFrom: '2026-12-01',
          changeReason: 'Overtime by type',
        },
      });
    const no = await post('teaching');
    expect(no.statusCode).toBe(400);
    expect(no.json().detail).toContain('not an employee type of the staff master');
    expect((await post('teaching regular')).statusCode).toBe(201);
    const rows = await q<{ employee_type: string }>(
      `SELECT employee_type FROM payroll_ot_rates WHERE school_id = $1`,
      [school.id],
    );
    expect(rows.map((r) => r.employee_type)).toEqual(['Teaching Regular']);
    const list = (await call(checker, '/payroll/setup-lists/config?kind=ot')).json();
    expect(list.filters.find((f: { key: string }) => f.key === 'employeeType').options).toEqual([
      { value: 'Teaching Regular', label: 'Teaching Regular' },
    ]);
  });

  it('the Set-up book: a sheet each, recorded; the PDF in one piece', async () => {
    const x = (await call(checker, '/payroll/setup-book?format=xlsx')).json();
    const wb = await sheet(x.base64);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Settings',
      'Pay heads',
      'Rates',
      'PF',
      'ESI',
      'Profession tax',
      'LWF',
      'Overtime rates',
      'Pay matrix',
      'Templates',
      'Tax slabs',
      'Tax lines',
      'Bank accounts',
    ]);
    // a maker's book has no bank accounts
    const m = await sheet((await call(maker, '/payroll/setup-book?format=xlsx')).json().base64);
    expect(m.worksheets.map((w) => w.name)).not.toContain('Bank accounts');
    const pdf = (await call(checker, '/payroll/setup-book?format=pdf')).json();
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(
      (
        await q(
          `SELECT 1 FROM audit_logs WHERE school_id = $1 AND action = 'payroll.setup.download' AND entity_id = 'book'`,
          [school.id],
        )
      ).length,
    ).toBe(3);
  });
});
