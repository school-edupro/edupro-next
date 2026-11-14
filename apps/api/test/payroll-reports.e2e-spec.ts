/**
 * Payroll reports and audit (docs/design/86, phase F): the catalogue by role; the salary register one line per employee
 * (a month's regular pay and its additional run together), held salaries apart, confidential staff hidden from makers,
 * views, columns and filters, and every file equal to the screen with PROVISIONAL while a run is approved but not
 * locked; summaries, year to date, variance, headcount; the gratuity liability and the actuary's file; the bonus by the
 * school's rule, posted once by a checker; presets (own, shared by a checker); the audit trail (seeing it recorded) for
 * checkers and the read-only auditor, and the auditor pack with its manifest; the payroll home in persons.
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
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

describe('payroll reports and audit (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  let auditor: SeededUser;
  const emp: Record<string, string> = {};
  const head: Record<string, string> = {};
  const s = stamp('PRP');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
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
  const runMonth = async (month: string, lock = true) => {
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month,
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month });
    const id = (await call(maker, 'POST', '/payroll/runs', { month, runType: 'REGULAR' })).json()
      .id as string;
    await processRun(id);
    const ap = await call(checker, 'POST', `/payroll/runs/${id}/approve`);
    expect(`${String(ap.statusCode)} ${String(ap.json().detail ?? '')}`).toBe('201 ');
    if (lock)
      expect((await call(checker, 'POST', `/payroll/runs/${id}/lock`)).statusCode).toBe(201);
    return id;
  };
  type Grid = {
    rows: Array<Record<string, string>>;
    subtotals: Array<{ label: string; row: Record<string, string> }>;
    total: Record<string, string> | null;
    provisional: string | null;
    columns: Array<{ key: string }>;
  };
  const grid = async (u: SeededUser, key: string, query: string) => {
    const r = await call(u, 'GET', `/payroll/reports/${key}?${query}`);
    expect(r.statusCode).toBe(200);
    return r.json() as Grid;
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      auditor = await seedUser(c, school, `${s}-au`, 'payroll_auditor');
      for (const [code, joined, dept, type] of [
        ['A', '2015-01-01', 'Science', 'teaching'],
        ['B', '2022-01-01', 'Office', 'non_teaching'],
        ['C', '2019-01-01', 'Office', 'non_teaching'],
        ['D', null, 'Office', 'non_teaching'],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob, gender, employee_type)
             VALUES ($1, $2, $2, 'E2E', $3, 'Teacher', $4, '1985-05-05', 'male', $5::employee_type) RETURNING id::text`,
            [school.id, `${s}${code}`, dept, joined, type],
          )
        ).rows[0]!.id;
      for (const m of ['2026-04-01', '2026-05-01', '2026-06-01'])
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
    for (const [code, h, amount] of [
      ['A', 'BASIC', '40000'],
      ['A', 'SPL_ALW', '10000'],
      ['B', 'BASIC', '20000'],
      ['C', 'BASIC', '30000'],
      ['D', 'BASIC', '15000'],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active')`,
        [school.id, emp[code], head[h], amount],
      );
    await q(
      `UPDATE payroll_settings SET confidential_employee_ids = ARRAY[$2]::bigint[] WHERE school_id = $1`,
      [school.id, emp.C],
    );
    await runMonth('2026-04');
    // May: B's salary held; A's one-off item paid by an additional run after the lock
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/holds', {
          month: '2026-05',
          employeeId: emp.B,
          mode: 'HOLD',
          reason: 'Documents pending',
        })
      ).statusCode,
    ).toBe(201);
    await runMonth('2026-05');
    expect(
      (
        await call(maker, 'POST', '/payroll/inputs/adhoc', {
          month: '2026-05',
          employeeId: emp.A,
          payHeadId: head.OTH_ARR,
          amount: '1500',
          remarks: 'Late claim',
        })
      ).statusCode,
    ).toBe(201);
    const sup = (
      await call(maker, 'POST', '/payroll/runs', {
        month: '2026-05',
        runType: 'SUPPLEMENTARY',
        employeeIds: [emp.A],
      })
    ).json().id as string;
    await processRun(sup);
    await call(checker, 'POST', `/payroll/runs/${sup}/approve`);
    await call(checker, 'POST', `/payroll/runs/${sup}/lock`);
    // June approved, not locked
    await runMonth('2026-06', false);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the register: one line per employee, held apart, confidential hidden from makers, files equal to the screen', async () => {
    const mine = (await call(maker, 'GET', '/payroll/reports')).json();
    expect(mine.reports.map((r: { key: string }) => r.key)).not.toContain('ctc');
    expect(
      (await call(checker, 'GET', '/payroll/reports'))
        .json()
        .reports.map((r: { key: string }) => r.key),
    ).toContain('ctc');
    expect((await call(maker, 'GET', '/payroll/reports/ctc?month=2026-05')).statusCode).toBe(403);
    expect((await call(maker, 'GET', '/payroll/reports/register')).statusCode).toBe(400);
    const opts = (await call(maker, 'GET', '/payroll/reports/options?month=2026-05')).json();
    expect(opts.departments).toEqual(['Office', 'Science']);
    expect(opts.employees).toHaveLength(3);
    // the checker: three people, A once (regular + additional), B held
    const g = await grid(checker, 'register', 'month=2026-05');
    expect(g.rows.map((r) => r.code)).toEqual([`${s}C`, `${s}D`, `${s}A`, `${s}B`]);
    const a = g.rows.find((r) => r.code === `${s}A`)!;
    expect(a['h:OTH_ARR']).toBe('1500.00');
    expect(g.rows.find((r) => r.code === `${s}B`)!.status).toBe('Held');
    expect(g.subtotals.map((x) => x.label)).toEqual(['Paid', 'Held']);
    const sum = (k: string) => g.rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0) / 100;
    expect(Number(g.total!.net)).toBe(sum('net'));
    expect(g.provisional).toBeNull();
    // the maker does not see C
    expect((await grid(maker, 'register', 'month=2026-05')).rows.map((r) => r.code)).toEqual([
      `${s}D`,
      `${s}A`,
      `${s}B`,
    ]);
    // a view about PF lists the PF heads only; chosen columns; a filter — and the CSV is the same rows
    const pf = await grid(checker, 'register', 'month=2026-05&view=pf');
    expect(pf.columns.map((c) => c.key)).toContain('h:PF');
    expect(pf.columns.map((c) => c.key)).not.toContain('h:BASIC');
    const cols = await grid(checker, 'register', 'month=2026-05&columns=code,name,gross,net');
    expect(cols.columns.map((c) => c.key)).toEqual(['code', 'name', 'gross', 'net']);
    const sci = await grid(checker, 'register', 'month=2026-05&department=Science&view=summary');
    expect(sci.rows).toHaveLength(1);
    const csv = (
      await call(
        checker,
        'GET',
        '/payroll/reports/register/file?month=2026-05&department=Science&view=summary&format=csv',
      )
    ).json();
    const lines = Buffer.from(csv.base64 as string, 'base64')
      .toString('utf8')
      .split('\r\n')
      .filter(Boolean);
    expect(lines.filter((l) => l.startsWith(`${s}A,`))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith(`${s}B,`))).toBe(false);
    for (const format of ['xlsx', 'pdf'] as const)
      expect(
        (
          await call(
            checker,
            'GET',
            `/payroll/reports/register/file?month=2026-05&format=${format}`,
          )
        ).statusCode,
      ).toBe(200);
    // June is approved, not locked: PROVISIONAL on the screen and in the file
    const june = await grid(checker, 'register', 'month=2026-06');
    expect(june.provisional).toContain('PROVISIONAL');
    const jcsv = (
      await call(checker, 'GET', '/payroll/reports/register/file?month=2026-06&format=csv')
    ).json();
    expect(Buffer.from(jcsv.base64 as string, 'base64').toString('utf8')).toContain('PROVISIONAL');
  });

  it('summaries, year to date, variance, headcount, the other reports', async () => {
    const dept = await grid(checker, 'group', 'month=2026-05&groupBy=department');
    expect(dept.rows.map((r) => [r.group, r.staff])).toEqual([
      ['Office', 3],
      ['Science', 1],
    ]);
    const heads = await grid(checker, 'heads', 'month=2026-05');
    expect(heads.rows.find((r) => r.code === 'OTH_ARR')).toMatchObject({
      staff: 1,
      amount: '1500.00',
    });
    const ytd = await grid(checker, 'ytd', 'fy=2026-27');
    expect(ytd.rows.find((r) => r.code === `${s}A`)!.months).toBe(3);
    const v = await grid(checker, 'variance', 'month=2026-05');
    expect(v.rows.find((r) => r.code === `${s}A` && r.head === 'OTH_ARR')).toMatchObject({
      before: '0.00',
      now: '1500.00',
      why: 'New',
    });
    const hc = await grid(checker, 'headcount', 'month=2026-05');
    expect(hc.rows).toEqual([]);
    for (const key of [
      'attendance',
      'arrears',
      'ctc',
      'tds',
      'pf',
      'esi',
      'pt',
      'lwf',
      'nps',
      'bank',
      'third_party',
    ])
      expect((await call(checker, 'GET', `/payroll/reports/${key}?month=2026-05`)).statusCode).toBe(
        200,
      );
    for (const key of ['loans', 'esi_coverage'])
      expect((await call(checker, 'GET', `/payroll/reports/${key}`)).statusCode).toBe(200);
    // the report builder's payroll datasets: persons by month, for those who see every employee
    const ds = await call(
      admin,
      'GET',
      '/reports/datasets/payroll_register/rows?from=2026-05-01&to=2026-05-31',
    );
    expect(ds.statusCode).toBe(200);
    const dsRows = (ds.json().rows ?? ds.json().data ?? []) as Array<{ employee_code: string }>;
    expect(dsRows.map((r) => r.employee_code).sort()).toEqual([`${s}A`, `${s}B`, `${s}C`, `${s}D`]);
    expect(
      (await call(maker, 'GET', '/reports/datasets/payroll_register/rows?from=2026-05-01')).statusCode,
    ).toBe(403);
    const ctc = await grid(checker, 'ctc', 'month=2026-05');
    const ca = ctc.rows.find((r) => r.code === `${s}A`)!;
    expect(Number(ca.ctc)).toBeCloseTo(
      Number(ca.gross) +
        Number(ca.epf) +
        Number(ca.eps) +
        Number(ca.edli) +
        Number(ca.esi) +
        Number(ca.nps) +
        Number(ca.lwf),
      2,
    );
  });

  it('the gratuity liability and the actuary’s file; the bonus by the school’s rule, posted once by a checker', async () => {
    const g = await grid(checker, 'gratuity', 'asOf=2026-05-31');
    const a = g.rows.find((r) => r.code === `${s}A`)!;
    // 11 years 5 months: 11 years × 40,000 × 15 / 26
    expect(a).toMatchObject({ years: 11, due: 'Yes', wage: '40000.00', payable: '253846.15' });
    expect(g.rows.find((r) => r.code === `${s}B`)).toMatchObject({
      due: 'Not yet',
      payable: '0.00',
    });
    expect(
      (g as unknown as { after: Array<{ rows: Array<{ code: string }> }> }).after[0]!.rows.map(
        (r) => r.code,
      ),
    ).toEqual([`${s}D`]);
    expect((await call(maker, 'GET', '/payroll/gratuity/actuary?asOf=2026-05-31')).statusCode).toBe(
      403,
    );
    expect(
      (await call(checker, 'GET', '/payroll/gratuity/actuary?asOf=2026-05-31')).json().filename,
    ).toMatch(/^Gratuity_actuary_data_/);
    // the bonus
    expect((await call(checker, 'GET', '/payroll/reports/bonus?fy=2026-27')).statusCode).toBe(409);
    expect(
      (await call(maker, 'PUT', '/payroll/bonus/2026-27', { kind: 'PERCENT', minDays: '0' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(maker, 'PUT', '/payroll/bonus/2026-27', {
          kind: 'PERCENT',
          rate: '0.10',
          minDays: '30',
        })
      ).statusCode,
    ).toBe(200);
    const b = await grid(checker, 'bonus', 'fy=2026-27');
    // A: 10 % of basic + DA over April–June (40,000 a month; the additional run’s arrear is not basic)
    expect(b.rows.find((r) => r.code === `${s}A`)).toMatchObject({ months: 3, bonus: '12000.00' });
    expect(
      (await call(maker, 'POST', '/payroll/bonus/2026-27/post', { month: '2026-07', dryRun: true }))
        .statusCode,
    ).toBe(403);
    const dry = (
      await call(checker, 'POST', '/payroll/bonus/2026-27/post', { month: '2026-07', dryRun: true })
    ).json();
    expect(dry).toMatchObject({ dryRun: true, count: 4 });
    const done = (
      await call(checker, 'POST', '/payroll/bonus/2026-27/post', {
        month: '2026-07',
        dryRun: false,
      })
    ).json();
    expect(done.count).toBe(4);
    expect(
      (
        await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_adhoc WHERE school_id = $1 AND ref_module = 'BONUS'`,
          [school.id],
        )
      )[0]!.n,
    ).toBe(4);
    expect(
      (
        await call(checker, 'POST', '/payroll/bonus/2026-27/post', {
          month: '2026-07',
          dryRun: false,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call(maker, 'PUT', '/payroll/bonus/2026-27', { kind: 'PERCENT', rate: '0.20' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await grid(checker, 'bonus', 'fy=2026-27')).rows.find((r) => r.code === `${s}A`)!.posted,
    ).toContain('July 2026');
  });

  it('presets: one’s own, shared only by a checker', async () => {
    const own = (
      await call(maker, 'POST', '/payroll/reports/presets', {
        report: 'register',
        name: 'My short one',
        columns: ['code', 'name', 'net'],
      })
    ).json();
    expect(
      (
        await call(maker, 'POST', '/payroll/reports/presets', {
          report: 'register',
          name: 'For all',
          columns: ['code'],
          shared: true,
        })
      ).statusCode,
    ).toBe(403);
    const shared = (
      await call(checker, 'POST', '/payroll/reports/presets', {
        report: 'register',
        name: 'For all',
        columns: ['code', 'gross'],
        shared: true,
      })
    ).json();
    const list = (await call(maker, 'GET', '/payroll/reports/presets?report=register')).json();
    expect(list.rows.map((r: { name: string }) => r.name)).toEqual(['My short one', 'For all']);
    expect(
      (await call(maker, 'POST', `/payroll/reports/presets/${shared.id as string}/delete`))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(maker, 'POST', `/payroll/reports/presets/${own.id as string}/delete`)).statusCode,
    ).toBe(201);
  });

  it('the audit trail for checkers and the auditor, seeing it recorded; the auditor pack; the payroll home in persons', async () => {
    expect((await call(maker, 'GET', '/payroll/audit')).statusCode).toBe(403);
    const reads = (await call(auditor, 'GET', '/payroll/audit?kind=Read&size=100')).json();
    expect(reads.rows.some((r: { action: string }) => r.action === 'payroll.report.view')).toBe(
      true,
    );
    expect(reads.rows.some((r: { action: string }) => r.action === 'payroll.report.download')).toBe(
      true,
    );
    const changes = (
      await call(auditor, 'GET', '/payroll/audit?kind=Change&table=payroll_bonus_rules')
    ).json();
    const one = (
      await call(auditor, 'GET', `/payroll/audit/${changes.rows[0].id as string}`)
    ).json();
    expect(one.fields.find((f: { field: string }) => f.field === 'rate')).toMatchObject({
      after: 0.1,
    });
    // seeing the trail is itself recorded
    expect(
      (await call(checker, 'GET', '/payroll/audit?action=payroll.audit.view')).json().rows.length,
    ).toBeGreaterThan(0);
    expect((await call(auditor, 'GET', '/payroll/audit/export')).json().filename).toMatch(
      /\.xlsx$/,
    );
    // the auditor reads every employee, but changes nothing and builds no pack
    expect((await grid(auditor, 'register', 'month=2026-05')).rows).toHaveLength(4);
    expect(
      (
        await call(auditor, 'POST', '/payroll/inputs/adhoc', {
          month: '2026-07',
          employeeId: emp.A,
          payHeadId: head.OTH_ARR,
          amount: '1',
          remarks: 'Not mine',
        })
      ).statusCode,
    ).toBe(403);
    expect((await call(auditor, 'GET', '/payroll/audit/pack?fy=2026-27')).statusCode).toBe(403);
    const pack = (await call(checker, 'GET', '/payroll/audit/pack?fy=2026-27')).json();
    const zip = await JSZip.loadAsync(Buffer.from(pack.base64 as string, 'base64'));
    const manifest = (await zip.file('MANIFEST.csv')!.async('string'))
      .split('\r\n')
      .filter(Boolean);
    const reg = manifest.find((l) =>
      l.startsWith('registers/2026-05/salary_register_2026-05.csv'),
    )!;
    const body = await zip
      .file('registers/2026-05/salary_register_2026-05.csv')!
      .async('nodebuffer');
    expect(reg.split(',')[2]).toBe(createHash('sha256').update(body).digest('hex'));
    expect(manifest.some((l) => l.startsWith('audit/payroll_audit_trail_2026-27.csv'))).toBe(true);
    expect(
      await zip.file('registers/2026-06/salary_register_2026-06.csv')!.async('string'),
    ).toContain('PROVISIONAL');
    // the home: persons, not records; the maker without C
    const home = (await call(checker, 'GET', '/payroll/home?month=2026-05')).json();
    expect(home.figures.staff).toBe(4);
    expect(Number(home.figures.cost)).toBeCloseTo(
      Number(home.figures.gross) + Number(home.figures.employer),
      2,
    );
    expect(home.months[0]).toMatchObject({ month: '2026-06', provisional: true });
    expect((await call(maker, 'GET', '/payroll/home?month=2026-05')).json().figures.staff).toBe(3);
  });
});
