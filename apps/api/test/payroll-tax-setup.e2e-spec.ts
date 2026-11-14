/**
 * Changing a year's income-tax set-up (docs/design/86, "Income tax set-up"): the payroll admin saves a regime's slabs,
 * rules and surcharges with a reason (checked: from nil, meeting, the last open); a year an approved run used changes
 * only with a tick; lines are added, changed and removed (not the computation's own, not one a declaration uses); a
 * year copies the group limits; a year nothing uses is removed, one in use is not. A checker cannot change it.
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

describe('payroll income-tax set-up (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let checker: SeededUser;
  let emp = '';
  const s = stamp('PTX');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const q = <T>(sql: string, args: unknown[] = []) =>
    withMigrator((c) => c.query<T & Record<string, unknown>>(sql, args)).then((r) => r.rows);
  const regime = {
    slabs: [
      { from: '0', to: '400000', rate: '0' },
      { from: '400000', to: '800000', rate: '0.05' },
      { from: '800000', to: '1200000', rate: '0.1' },
      { from: '1200000', to: null, rate: '0.3' },
    ],
    rules: {
      standardDeduction: '100000',
      rebateIncomeLimit: '1200000',
      rebateMax: '60000',
      cessRate: '0.04',
      panAbsentRate: '0.2',
      marginalRelief: true,
    },
    surcharges: [
      { incomeFrom: '5000000', rate: '0.1' },
      { incomeFrom: '10000000', rate: '0.15' },
    ],
    reason: 'Budget 2026: standard deduction raised',
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      emp = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name) VALUES ($1, $2, 'Asha', 'E2E') RETURNING id::text`,
          [school.id, `${s}A`],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    await call(admin, 'GET', '/payroll/setup');
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('a regime is saved whole, checked, and only by the payroll admin', async () => {
    expect(
      (await call(checker, 'PUT', '/payroll/tax/2026-27/regimes/NEW', regime)).statusCode,
    ).toBe(403);
    const bad = async (slabs: unknown, word: string) => {
      const r = await call(admin, 'PUT', '/payroll/tax/2026-27/regimes/NEW', { ...regime, slabs });
      expect(r.statusCode).toBe(400);
      expect(r.json().detail).toContain(word);
    };
    await bad([{ from: '100', to: null, rate: '0' }], 'starts at ₹0');
    await bad(
      [
        { from: '0', to: '400000', rate: '0' },
        { from: '500000', to: null, rate: '0.1' },
      ],
      'must meet',
    );
    await bad(
      [
        { from: '0', to: null, rate: '0' },
        { from: '400000', to: null, rate: '0.1' },
      ],
      'Only the last slab is open',
    );
    expect(
      (await call(admin, 'PUT', '/payroll/tax/2026-27/regimes/NEW', { ...regime, reason: 'short' }))
        .statusCode,
    ).toBe(400);
    const ok = await call(admin, 'PUT', '/payroll/tax/2026-27/regimes/NEW', regime);
    expect(ok.statusCode).toBe(200);
    const slabs = await q<{ slab_from: string; slab_to: string | null; rate: string }>(
      `SELECT slab_from::text, slab_to::text, rate::text FROM payroll_tds_slabs s WHERE school_id = $1 AND fy = '2026-27' AND regime = 'NEW' ORDER BY s.slab_from`,
      [school.id],
    );
    expect(slabs.map((x) => [x.slab_from, x.slab_to, x.rate])).toEqual([
      ['0.00', '400000.00', '0.0000'],
      ['400000.00', '800000.00', '0.0500'],
      ['800000.00', '1200000.00', '0.1000'],
      ['1200000.00', null, '0.3000'],
    ]);
    const cfg = await q<{ standard_deduction: string }>(
      `SELECT standard_deduction::text FROM payroll_tds_config WHERE school_id = $1 AND fy = '2026-27' AND regime = 'NEW'`,
      [school.id],
    );
    expect(cfg[0]!.standard_deduction).toBe('100000.00');
    const sur = await q(
      `SELECT 1 FROM payroll_tds_surcharges WHERE school_id = $1 AND fy = '2026-27' AND regime = 'NEW'`,
      [school.id],
    );
    expect(sur).toHaveLength(2);
    const ev = await q(
      `SELECT 1 FROM audit_logs WHERE school_id = $1 AND action = 'payroll.tax.regime' AND entity_id = '2026-27/NEW'`,
      [school.id],
    );
    expect(ev).toHaveLength(1);
  });

  it('a year an approved run used changes only with a tick', async () => {
    await q(
      `INSERT INTO payroll_runs (school_id, month, run_type, seq, stage) VALUES ($1, '2026-06-01', 'REGULAR', 1, 'APPROVED')`,
      [school.id],
    );
    const d = (await call(admin, 'GET', '/payroll/tax?fy=2026-27')).json();
    expect(d.inUse).toEqual(['2026-06']);
    expect(d.blockers.join(' ')).toContain('pay runs');
    const no = await call(admin, 'PUT', '/payroll/tax/2026-27/regimes/OLD', {
      ...regime,
      rules: { ...regime.rules, standardDeduction: '50000' },
    });
    expect(no.statusCode).toBe(409);
    expect(no.json().detail).toContain('tick to confirm');
    const yes = await call(admin, 'PUT', '/payroll/tax/2026-27/regimes/OLD', {
      ...regime,
      rules: { ...regime.rules, standardDeduction: '50000' },
      confirm: true,
    });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().message).toContain('keep their TDS');
  });

  it('lines: added, changed, removed — not the computation’s own, not one a declaration uses', async () => {
    const line = {
      lineCode: 'chapvia_80eeb',
      label: 'Interest on an electric-vehicle loan',
      appliesTo: 'OLD',
      capAmount: '150000',
      capGroup: null,
      declarable: true,
      reason: 'A deduction staff claim this year',
      confirm: true,
    };
    expect((await call(admin, 'POST', '/payroll/tax/2026-27/lines', line)).statusCode).toBe(201);
    expect((await call(admin, 'POST', '/payroll/tax/2026-27/lines', line)).statusCode).toBe(409);
    // a group limit must be a line with a cap staff do not declare
    expect(
      (
        await call(admin, 'PUT', '/payroll/tax/2026-27/lines/CHAPVIA_80EEB', {
          ...line,
          capGroup: 'CHAPVIA_80D',
        })
      ).statusCode,
    ).toBe(400);
    const g = await call(admin, 'PUT', '/payroll/tax/2026-27/lines/G80C', {
      label: 'Limit of 80C, 80CCC and 80CCD(1) together',
      appliesTo: 'OLD',
      capAmount: '200000',
      capGroup: null,
      declarable: false,
      reason: 'The 80C limit was raised',
      confirm: true,
    });
    expect(g.statusCode).toBe(200);
    const year = (await call(admin, 'GET', '/payroll/tax?fy=2026-27')).json();
    const g80c = year.labels.find((l: { lineCode: string }) => l.lineCode === 'G80C');
    expect(g80c).toEqual(expect.objectContaining({ capAmount: '200000.00', builtIn: true }));
    // the computation's own lines stay; an added one used by a declaration stays
    expect(
      (
        await call(admin, 'POST', '/payroll/tax/2026-27/lines/G80C/remove', {
          reason: 'Not needed any more',
        })
      ).statusCode,
    ).toBe(409);
    await q(
      `INSERT INTO payroll_declarations (school_id, employee_id, fy, line_code, declared) VALUES ($1, $2, '2026-27', 'CHAPVIA_80EEB', 1000)`,
      [school.id, emp],
    );
    expect(
      (
        await call(admin, 'POST', '/payroll/tax/2026-27/lines/CHAPVIA_80EEB/remove', {
          reason: 'Added by mistake',
        })
      ).statusCode,
    ).toBe(409);
    await q(`DELETE FROM payroll_declarations WHERE school_id = $1`, [school.id]);
    expect(
      (
        await call(admin, 'POST', '/payroll/tax/2026-27/lines/CHAPVIA_80EEB/remove', {
          reason: 'Added by mistake',
        })
      ).statusCode,
    ).toBe(201);
  });

  it('a new year keeps the group limits; a year nothing uses is removed, one in use is not', async () => {
    expect(
      (await call(admin, 'POST', '/payroll/tax/years', { fy: '2028-29', copyFrom: '2026-27' }))
        .statusCode,
    ).toBe(201);
    const grp = await q<{ cap_group: string | null }>(
      `SELECT cap_group FROM payroll_tax_labels WHERE school_id = $1 AND fy = '2028-29' AND line_code = 'CHAPVIA_80C'`,
      [school.id],
    );
    expect(grp[0]!.cap_group).toBe('G80C');
    expect(
      (
        await call(admin, 'POST', '/payroll/tax/years/2028-29/remove', {
          reason: 'Added a year too early',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await q(`SELECT 1 FROM payroll_tds_slabs WHERE school_id = $1 AND fy = '2028-29'`, [
          school.id,
        ])
      ).length,
    ).toBe(0);
    const no = await call(admin, 'POST', '/payroll/tax/years/2026-27/remove', {
      reason: 'Added a year too early',
    });
    expect(no.statusCode).toBe(409);
    expect(no.json().detail).toMatch(/pay runs|the running year/);
  });
});
