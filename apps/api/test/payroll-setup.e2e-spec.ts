/**
 * Payroll set-up (docs/design/86, phase A): a school's defaults on first use; the settings (payroll admin);
 * the dated rate registry — a draft by a maker, approved by a checker who did not make it (a payroll admin may
 * approve their own), the previous ACTIVE row given an end date and kept, back-dating and a second row on the
 * same date refused, a row ended by hand; pay heads and versions — the formula checked for its pass, its
 * heads and cycles, saved tests run on save and on approval; the formula check and try; the pay matrix (a
 * checker; a cell in use is kept); payroll profiles on the employee master — made, changed with their history,
 * the level / cell checked, PAN revealed by a checker with a reason, confidential staff hidden from makers,
 * nominees making 100 %; salary structures — drafts, approval all or nothing per employee, the previous row
 * ended, the as-of view; the structure sheet; income tax by year.
 */
import ExcelJS from 'exceljs';
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

describe('payroll set-up (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  const emp: Record<string, string> = {};
  const s = stamp('PR');
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

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      for (const code of ['A', 'B', 'C'])
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, secure)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', $3::jsonb) RETURNING id::text`,
            [school.id, `${s}${code}`, JSON.stringify({ pan: encryptField('ABCDE1234F') })],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('a school starts with the legacy defaults; the overview says what is missing', async () => {
    const o = (await call(maker, 'GET', '/payroll/setup')).json();
    expect(o.figures).toMatchObject({
      staff: 3,
      profiles: 0,
      heads: 22,
      headsUnversioned: 0,
      matrixCells: 538,
    });
    expect(o.checks.map((x: { text: string }) => x.text).join(' | ')).toContain(
      'The state is not set',
    );
    expect(o.can).toEqual({ manage: true, approve: false, admin: false, reveal: false });
    // a second look adds nothing
    await call(maker, 'GET', '/payroll/setup');
    expect(
      (
        await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_pay_heads WHERE school_id = $1`,
          [school.id],
        )
      )[0]!.n,
    ).toBe(22);
  });

  it('settings: a payroll admin only', async () => {
    const cur = (await call(admin, 'GET', '/payroll/settings')).json().settings;
    const body = {
      stateCode: 'MH',
      pfEstablishmentCode: 'MHBAN0012345000',
      tan: 'abcd12345e',
      ptrcNo: null,
      esiCode: null,
      lwfEnabled: false,
      epsStopAge: 58,
      pfCeilingProrate: true,
      matrixCode: cur.matrixCode,
      payCycleFromDay: null,
      otHoursLimit: 744,
      payslipPassword: '{EMPID}',
      bankFileFormat: 'GENERIC_CSV',
      confidentialEmployeeIds: [emp.C],
      formulaAttributes: [
        { code: 'IS_PERMANENT', field: 'nature_of_appointment', value: 'Permanent' },
      ],
      regimeCutoffMonth: 12,
    };
    expect((await call(maker, 'PUT', '/payroll/settings', body)).statusCode).toBe(403);
    expect((await call(admin, 'PUT', '/payroll/settings', body)).statusCode).toBe(200);
    const after = (await call(maker, 'GET', '/payroll/settings')).json();
    expect(after.settings).toMatchObject({
      stateCode: 'MH',
      tan: 'ABCD12345E',
      confidentialEmployeeIds: [emp.C],
    });
    expect(after.confidential).toEqual([expect.objectContaining({ id: emp.C })]);
    expect(
      (await call(maker, 'GET', '/payroll/setup'))
        .json()
        .checks.map((x: { text: string }) => x.text)
        .join(' | '),
    ).not.toContain('The state is not set');
  });

  it('the rate registry: drafts, approval by another person, the previous row ended and kept', async () => {
    const draft = (
      await call(maker, 'POST', '/payroll/config/rates', {
        rateCode: 'DA_RATE',
        rateValue: '0.62',
        source: 'govt',
        effectiveFrom: '2026-07-01',
        changeReason: 'DA 62 % from July 2026',
      })
    ).json();
    expect(draft.status).toBe('draft');
    // a maker cannot approve; a checker cannot approve their own draft; an admin may
    expect(
      (await call(maker, 'POST', `/payroll/config/rates/${draft.id as string}/approve`)).statusCode,
    ).toBe(403);
    const own = (
      await call(checker, 'POST', '/payroll/config/rates', {
        rateCode: 'CCA_RATE',
        rateValue: '0.05',
        effectiveFrom: '2026-04-01',
      })
    ).json();
    const selfApprove = await call(
      checker,
      'POST',
      `/payroll/config/rates/${own.id as string}/approve`,
    );
    expect(selfApprove.statusCode).toBe(403);
    expect(selfApprove.json().detail).toContain('cannot approve your own draft');
    expect(
      (await call(admin, 'POST', `/payroll/config/rates/${own.id as string}/approve`)).statusCode,
    ).toBe(201);
    // the checker approves the maker's DA: 60 % now ends on 30 June 2026 and stays ACTIVE
    const ok = (
      await call(checker, 'POST', `/payroll/config/rates/${draft.id as string}/approve`)
    ).json();
    expect(ok.message).toContain('2026-06-30');
    const da = await q<{ rate_value: string; effective_to: string | null; status: string }>(
      `SELECT rate_value::text, effective_to::text, status FROM payroll_rates WHERE school_id = $1 AND rate_code = 'DA_RATE' ORDER BY effective_from`,
      [school.id],
    );
    expect(da.map((r) => [r.rate_value, r.effective_to, r.status])).toEqual([
      ['0.550000', '2025-06-30', 'active'],
      ['0.580000', '2025-12-31', 'active'],
      ['0.600000', '2026-06-30', 'active'],
      ['0.620000', null, 'active'],
    ]);
    // back-dating behind a later ACTIVE row, and a second row on the same date, are refused
    const back = (
      await call(maker, 'POST', '/payroll/config/rates', {
        rateCode: 'DA_RATE',
        rateValue: '0.61',
        effectiveFrom: '2026-05-01',
      })
    ).json();
    const backApproved = await call(
      checker,
      'POST',
      `/payroll/config/rates/${back.id as string}/approve`,
    );
    expect(backApproved.statusCode).toBe(409);
    expect(backApproved.json().detail).toContain('starting later');
    expect(
      (
        await call(maker, 'POST', '/payroll/config/rates', {
          rateCode: 'DA_RATE',
          rateValue: '0.62',
          effectiveFrom: '2026-07-01',
        })
      ).statusCode,
    ).toBe(409);
    // a draft is changed and deleted by its maker; ACTIVE history is not deleted; a row is ended by hand
    expect(
      (
        await call(maker, 'PUT', `/payroll/config/rates/${back.id as string}`, {
          rateCode: 'DA_RATE',
          rateValue: '0.61',
          effectiveFrom: '2026-09-01',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(maker, 'DELETE', `/payroll/config/rates/${back.id as string}`)).statusCode,
    ).toBe(200);
    expect(
      (await call(maker, 'DELETE', `/payroll/config/rates/${draft.id as string}`)).statusCode,
    ).toBe(409);
    expect(
      (
        await call(checker, 'POST', `/payroll/config/rates/${own.id as string}/end`, {
          effectiveTo: '2026-12-31',
          reason: 'CCA withdrawn',
        })
      ).statusCode,
    ).toBe(201);
    const list = (await call(maker, 'GET', '/payroll/config/rates?status=ended')).json();
    expect(list.rows).toEqual([
      expect.objectContaining({ rateCode: 'CCA_RATE', effectiveTo: '2026-12-31', status: 'ended' }),
    ]);
  });

  it('statutory rows are checked', async () => {
    expect(
      (
        await call(maker, 'POST', '/payroll/config/pt', {
          stateCode: 'KA',
          gender: 'ANY',
          wageFrom: '25000',
          wageTo: '15000',
          monthlyAmount: '200',
          effectiveFrom: '2026-04-01',
        })
      ).json().detail,
    ).toContain('ends before it starts');
    expect(
      (
        await call(maker, 'POST', '/payroll/config/lwf', {
          stateCode: 'KA',
          eeFlat: '20',
          frequency: 'half_yearly',
          effectiveFrom: '2026-04-01',
        })
      ).json().detail,
    ).toContain('months');
    expect(
      (
        await call(maker, 'POST', '/payroll/config/pt', {
          stateCode: 'KA',
          gender: 'ANY',
          wageFrom: '25000',
          monthlyAmount: '200',
          monthOverrides: { '2': '300' },
          effectiveFrom: '2026-04-01',
        })
      ).statusCode,
    ).toBe(201);
    expect((await call(maker, 'GET', '/payroll/config/pt?status=draft')).json().rows).toEqual([
      expect.objectContaining({ stateCode: 'KA', monthOverrides: { '2': '300' }, status: 'draft' }),
    ]);
    expect((await call(maker, 'GET', '/payroll/config/bogus')).statusCode).toBe(400);
  });

  it('pay heads: the formula checked, saved tests run, versions approved', async () => {
    const heads = (await call(maker, 'GET', '/payroll/heads')).json().heads;
    expect(heads.find((h: { code: string }) => h.code === 'DA')).toMatchObject({
      calcType: 'FORMULA',
      formula: 'ROUND([BASIC]*DA_RATE)',
      liveFrom: '2025-04-01',
    });
    const version = (formula: string, from = '2026-04-01') => ({
      calcType: 'FORMULA',
      formula,
      dependsOn: null,
      isTaxable: true,
      pfWage: false,
      esiWage: true,
      ptWage: true,
      prorateOnLop: true,
      rounding: 'NEAREST_1',
      effectiveFrom: from,
    });
    const head = (code: string, formula: string) => ({
      code,
      name: code,
      headType: 'EARNING',
      category: 'ALLOWANCE',
      printOrder: 45,
      version: version(formula),
    });
    expect(
      (await call(maker, 'POST', '/payroll/heads', head('CCA', '[BASIC] + GROSS_EARNED'))).json()
        .detail,
    ).toContain('pass-2 variable');
    expect(
      (await call(maker, 'POST', '/payroll/heads', head('CCA', 'ROUND([XYZ]*2)'))).json().detail,
    ).toContain('do not exist: XYZ');
    expect(
      (await call(maker, 'POST', '/payroll/heads', head('CCA', 'ROUND([BASIC]*'))).json().detail,
    ).toContain('ends unexpectedly');
    const cca = (
      await call(maker, 'POST', '/payroll/heads', head('CCA', 'ROUND([BASIC]*CCA_RATE)'))
    ).json();
    expect(cca.versionId).toBeDefined();
    // a cycle among earnings is refused
    await call(maker, 'POST', '/payroll/heads', head('XA', '[CCA] + 1'));
    expect(
      (
        await call(
          maker,
          'POST',
          `/payroll/heads/${cca.id as string}/versions`,
          version('[XA] + 1', '2026-05-01'),
        )
      ).json().detail,
    ).toContain('Dependency cycle');
    // DA's saved tests refuse a version that breaks them
    const da = heads.find((h: { code: string }) => h.code === 'DA');
    const broken = await call(maker, 'POST', `/payroll/heads/${da.id as string}/versions`, {
      ...version('ROUND([BASIC]*DA_RATE*2)'),
      pfWage: true,
    });
    expect(broken.statusCode).toBe(409);
    expect(broken.json().detail).toContain('DA 58 % of 52,000');
    // the checker approves CCA; it is in force from April 2026
    expect(
      (await call(checker, 'POST', `/payroll/head-versions/${cca.versionId as string}/approve`))
        .statusCode,
    ).toBe(201);
    const one = (await call(maker, 'GET', `/payroll/heads/${cca.id as string}`)).json();
    expect(one.versions).toEqual([
      expect.objectContaining({ status: 'active', formula: 'ROUND([BASIC]*CCA_RATE)' }),
    ]);
    // a saved test and its run
    expect(
      (
        await call(maker, 'POST', `/payroll/heads/${cca.id as string}/tests`, {
          name: 'CCA 5 % of 40,000',
          inputs: { BASIC: '40000', CCA_RATE: '0.05' },
          expected: '2000',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(maker, 'POST', `/payroll/heads/${cca.id as string}/tests/run`)).json().failing,
    ).toEqual([]);
  });

  it('the formula check: errors, unknown names, a value', async () => {
    const r = (
      await call(maker, 'POST', '/payroll/formula/check', {
        formula: 'ROUND([BASIC]*DA_RATE) + NOPE',
        pass: 1,
        inputs: { BASIC: '52000', DA_RATE: '0.58', NOPE: '0' },
      })
    ).json();
    expect(r).toMatchObject({
      ok: true,
      headsUsed: ['BASIC'],
      varsUsed: ['DA_RATE', 'NOPE'],
      result: { ok: true, value: '30160.00' },
    });
    expect(r.warnings).toEqual([
      'NOPE is not a rate in the registry, a formula attribute or a system variable',
    ]);
    expect(
      (await call(maker, 'POST', '/payroll/formula/check', { formula: '1 = 1' })).json(),
    ).toMatchObject({ ok: false, errors: ["Invalid '=' at position 2 — use '==' to compare."] });
  });

  it('the pay matrix: a checker changes it; a cell in use is kept', async () => {
    const m = (await call(maker, 'GET', '/payroll/matrix')).json();
    expect(m.levels).toHaveLength(17);
    expect(m.levels[0]).toMatchObject({
      level: '1',
      cells: expect.arrayContaining([expect.objectContaining({ cell: 1, basic: '18000.00' })]),
    });
    const cell = {
      matrixCode: m.code,
      payLevel: '1',
      levelOrder: 1,
      cellNo: 41,
      basic: '99999',
      effectiveFrom: '2016-01-01',
    };
    expect((await call(maker, 'PUT', '/payroll/matrix/cell', cell)).statusCode).toBe(403);
    expect((await call(checker, 'PUT', '/payroll/matrix/cell', cell)).statusCode).toBe(200);
    expect(
      (await call(checker, 'DELETE', `/payroll/matrix/${m.code as string}/1?cell=41`)).statusCode,
    ).toBe(200);
  });

  it('profiles: made, changed with history, level checked, PAN revealed with a reason, confidential staff hidden', async () => {
    const sync = (await call(maker, 'POST', '/payroll/profiles/sync', { dryRun: true })).json();
    // C is confidential: the maker does not see them
    expect(sync.candidates.map((x: { id: string }) => x.id).sort()).toEqual([emp.A, emp.B].sort());
    expect(
      (await call(checker, 'POST', '/payroll/profiles/sync', { dryRun: true })).json().candidates,
    ).toHaveLength(3);
    expect(
      (await call(maker, 'POST', '/payroll/profiles/sync', { dryRun: false })).json().added,
    ).toBe(2);
    expect((await call(maker, 'GET', `/payroll/profiles/${emp.C!}`)).statusCode).toBe(404);
    const list = (await call(maker, 'GET', '/payroll/profiles')).json();
    expect(list.figures).toMatchObject({ staff: 2, profiles: 2, missing: 0 });
    expect(list.rows[0]).toMatchObject({ hasProfile: true, panMasked: 'XXXXXX234F' });
    const p = (await call(maker, 'GET', `/payroll/profiles/${emp.A!}`)).json();
    expect(p).toMatchObject({ exists: true, statutory: { panMasked: 'XXXXXX234F' } });
    const body = {
      ...Object.fromEntries(Object.entries(p.profile).filter(([k]) => k !== 'updatedAt')),
      vpfValue: String(p.profile.vpfValue),
      npsEeRate: String(p.profile.npsEeRate),
      npsErRate: String(p.profile.npsErRate),
      taxRegime: 'OLD',
      payLevel: '5',
      payCell: 3,
      changesFrom: '2026-04-01',
    };
    expect(
      (await call(maker, 'PUT', `/payroll/profiles/${emp.A!}`, { ...body, payCell: 59 })).json()
        .detail,
    ).toContain('not in the pay matrix');
    expect((await call(maker, 'PUT', `/payroll/profiles/${emp.A!}`, body)).json()).toMatchObject({
      saved: true,
      changed: 3,
    });
    const after = (await call(maker, 'GET', `/payroll/profiles/${emp.A!}`)).json();
    expect(after.changes.map((x: { field: string }) => x.field).sort()).toEqual([
      'payCell',
      'payLevel',
      'taxRegime',
    ]);
    // a cell a profile is on is kept
    expect((await call(checker, 'DELETE', `/payroll/matrix/PM_2016/5?cell=3`)).statusCode).toBe(
      409,
    );
    // the full PAN: a checker, with a reason
    expect(
      (
        await call(maker, 'POST', `/payroll/profiles/${emp.A!}/reveal`, {
          field: 'pan',
          reason: 'Form 16 check',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker, 'POST', `/payroll/profiles/${emp.A!}/reveal`, {
          field: 'pan',
          reason: 'Form 16 check',
        })
      ).json(),
    ).toEqual({ field: 'pan', value: 'ABCDE1234F' });
    // nominees make 100 % per purpose
    const nominee = { name: 'N1', relation: 'Spouse', sharePercent: '60', purpose: 'GRATUITY' };
    expect(
      (
        await call(maker, 'PUT', `/payroll/profiles/${emp.A!}/nominees`, { nominees: [nominee] })
      ).json().detail,
    ).toContain('must make 100 %');
    expect(
      (
        await call(maker, 'PUT', `/payroll/profiles/${emp.A!}/nominees`, {
          nominees: [nominee, { ...nominee, name: 'N2', sharePercent: '40' }],
        })
      ).statusCode,
    ).toBe(200);
  });

  it('structures: drafts, approval all or nothing per employee, the previous row ended', async () => {
    const heads = new Map<string, string>(
      (await call(maker, 'GET', '/payroll/heads'))
        .json()
        .heads.map((h: { code: string; id: string }) => [h.code, h.id]),
    );
    const save = (employeeId: string, from: string, lines: Array<[string, string]>) =>
      call(maker, 'POST', `/payroll/structures/${employeeId}`, {
        effectiveFrom: from,
        changeReason: 'Joining structure',
        lines: lines.map(([code, amount]) => ({ payHeadId: heads.get(code), amount })),
      });
    expect((await save(emp.A!, '2026-04-01', [['PF', '1800']])).json().detail).toContain(
      'worked out by payroll itself',
    );
    expect(
      (
        await save(emp.A!, '2026-04-01', [
          ['BASIC', '52000'],
          ['TA', '3600'],
        ])
      ).json(),
    ).toEqual({ saved: 2 });
    expect((await save(emp.B!, '2026-04-01', [['BASIC', '40000']])).json()).toEqual({ saved: 1 });
    const drafts = (await call(checker, 'GET', '/payroll/structures/drafts')).json().rows;
    expect(drafts.map((d: { id: string; lines: number }) => [d.id, d.lines])).toEqual(
      expect.arrayContaining([
        [emp.A, 2],
        [emp.B, 1],
      ]),
    );
    expect(
      (
        await call(checker, 'POST', '/payroll/structures/approve', { employeeIds: [emp.A, emp.B] })
      ).json(),
    ).toEqual({ approved: 2, refused: [] });
    // a raise from July; B's draft dated before its ACTIVE row is refused — A's goes through
    await save(emp.A!, '2026-07-01', [['BASIC', '53600']]);
    await save(emp.B!, '2026-03-01', [['BASIC', '39000']]);
    const r = (
      await call(checker, 'POST', '/payroll/structures/approve', { employeeIds: [emp.A, emp.B] })
    ).json();
    expect(r.approved).toBe(1);
    expect(r.refused).toEqual([
      { employeeId: emp.B, reason: expect.stringContaining('starting later') },
    ]);
    const may = (await call(maker, 'GET', `/payroll/structures/${emp.A!}?asOf=2026-05-15`)).json()
      .heads;
    const aug = (await call(maker, 'GET', `/payroll/structures/${emp.A!}?asOf=2026-08-01`)).json();
    expect(may.find((h: { code: string }) => h.code === 'BASIC').liveAmount).toBe('52000.00');
    expect(aug.heads.find((h: { code: string }) => h.code === 'BASIC').liveAmount).toBe('53600.00');
    expect(aug.heads.find((h: { code: string }) => h.code === 'TA').liveAmount).toBe('3600.00');
    expect(
      aug.timeline.find(
        (t: { code: string; effectiveFrom: string }) =>
          t.code === 'BASIC' && t.effectiveFrom === '2026-04-01',
      ),
    ).toMatchObject({ effectiveTo: '2026-06-30', status: 'active' });
    // templates: a payroll admin only
    expect(
      (
        await call(maker, 'POST', '/payroll/templates', {
          name: 'PRT',
          description: null,
          lines: { BASIC: '35400' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(admin, 'POST', '/payroll/templates', {
          name: 'PRT',
          description: null,
          lines: { BASIC: '35400', PF: '1' },
        })
      ).json().detail,
    ).toContain('PF');
    expect(
      (
        await call(admin, 'POST', '/payroll/templates', {
          name: 'PRT',
          description: null,
          staffTypes: ['Teaching'],
          lines: { BASIC: '35400' },
        })
      ).statusCode,
    ).toBe(201);
    // B's refused draft is deleted by the maker
    expect(
      (
        await call(maker, 'POST', '/payroll/structures/drafts/delete', { employeeIds: [emp.B] })
      ).json(),
    ).toEqual({ deleted: 1 });
  });

  it('the structure sheet: the amounts in force, checked, then drafts', async () => {
    const f = (await call(maker, 'GET', '/payroll/structures/format')).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(f.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const rows: string[][] = [];
    ws.eachRow((row, n) => {
      if (n > 1)
        rows.push([
          String(row.getCell(1).value),
          String(row.getCell(2).value),
          String(row.getCell(3).value),
        ]);
    });
    // in force today: A's July raise, A's TA base, B's basic
    expect(rows).toEqual([
      [`${s}A`, 'BASIC', '53600'],
      [`${s}A`, 'TA', '3600'],
      [`${s}B`, 'BASIC', '40000'],
    ]);
    // fill a raise for B and two wrong rows
    ws.getRow(2).getCell(4).value = new Date(Date.UTC(2026, 9, 1));
    ws.addRow([`${s}B`, 'BASIC', 41200, new Date(Date.UTC(2026, 9, 1))]);
    ws.addRow(['NOPE', 'BASIC', 1, new Date(Date.UTC(2026, 9, 1))]);
    ws.addRow([`${s}B`, 'TDS', 1, new Date(Date.UTC(2026, 9, 1))]);
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(maker, 'POST', '/payroll/structures/import', { file, dryRun: true })
    ).json();
    expect(dry.counts.error).toBe(2 + rows.length - 1);
    expect(
      dry.rows
        .filter((r: { status: string }) => r.status === 'error')
        .map((r: { error: string }) => r.error),
    ).toEqual(
      expect.arrayContaining([
        `NOPE is not on the active staff list`,
        'TDS is worked out by payroll itself',
      ]),
    );
    const saved = (
      await call(maker, 'POST', '/payroll/structures/import', { file, dryRun: false })
    ).json();
    expect(saved.saved).toBe(dry.counts.ok);
    expect(
      (await call(checker, 'GET', '/payroll/structures/drafts'))
        .json()
        .rows.map((d: { id: string }) => d.id),
    ).toContain(emp.B);
  });

  it('income tax by financial year: the defaults, a year copied by an admin', async () => {
    const t = (await call(maker, 'GET', '/payroll/tax?fy=2026-27')).json();
    expect(t.slabs).toHaveLength(11);
    expect(t.config).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regime: 'NEW',
          standardDeduction: '75000.00',
          rebateMax: '60000.00',
        }),
      ]),
    );
    expect(t.labels.find((l: { lineCode: string }) => l.lineCode === 'CERT_FORM_TITLE').label).toBe(
      'FORM NO. 130',
    );
    expect(
      (await call(maker, 'POST', '/payroll/tax/years', { fy: '2027-28', copyFrom: '2026-27' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(admin, 'POST', '/payroll/tax/years', { fy: '2027-28', copyFrom: '2026-27' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call(admin, 'POST', '/payroll/tax/years', { fy: '2027-28', copyFrom: '2026-27' }))
        .statusCode,
    ).toBe(409);
    expect((await call(maker, 'GET', '/payroll/tax?fy=2027-28')).json().slabs).toHaveLength(11);
  });
});
