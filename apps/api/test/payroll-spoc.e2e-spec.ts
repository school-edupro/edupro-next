/**
 * The Payroll SPOC (docs/design/86, "Payroll SPOC"; migration 0379): one person runs the payroll month alone. The role
 * holds every payroll right, the payroll admin's included, the leave reports and the narrow right to lock a month that
 * is over in the staff attendance register; not the leave office, not the go-live countersign. Locking: the SPOC and
 * the leave office lock, a payroll checker does not, and only the leave office unlocks. The month alone: attendance
 * marked and finalised, the run created, processed, approved by the same person — marked "self-approved" in the
 * payroll audit trail — and locked.
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

describe('payroll SPOC (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let spoc: SeededUser;
  let checker: SeededUser;
  let office: SeededUser;
  let emp = '';
  let runId = '';
  const s = stamp('PSP');
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
      spoc = await seedUser(c, school, `${s}-sp`, 'payroll_spoc');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      emp = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, gender, dob)
           VALUES ($1, $2, 'Asha', 'E2E', 'Science', 'Teacher', '2020-01-01', 'female', '1985-05-05') RETURNING id::text`,
          [school.id, `${s}A`],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    await call(spoc, 'GET', '/payroll/setup');
    const basic = (
      await q<{ id: string }>(
        `SELECT id::text FROM payroll_pay_heads WHERE school_id = $1 AND code = 'BASIC'`,
        [school.id],
      )
    )[0]!.id;
    await q(`UPDATE payroll_settings SET state_code = 'MH' WHERE school_id = $1`, [school.id]);
    await q(
      `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
       VALUES ($1, $2, $3, 30000, '2026-04-01', 'active')`,
      [school.id, emp, basic],
    );
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the role: every payroll right and the attendance lock; not the leave office or the countersign', async () => {
    const me = (await call(spoc, 'GET', '/me')).json();
    const perms = new Set<string>(me.permissions);
    for (const p of [
      'payroll.setup.view',
      'payroll.setup.manage',
      'payroll.setup.approve',
      'payroll.run.view',
      'payroll.run.manage',
      'payroll.run.approve',
      'payroll.profile.reveal',
      'payroll.settings.manage',
      'payroll.audit.view',
      'leave.report.view',
      'leave.month.lock',
    ])
      expect(perms.has(p)).toBe(true);
    expect(perms.has('leave.office.manage')).toBe(false);
    expect(perms.has('payroll.golive.countersign')).toBe(false);
    // the leave office keeps locking through the new right
    const off = new Set<string>((await call(office, 'GET', '/me')).json().permissions);
    expect(off.has('leave.month.lock')).toBe(true);
    expect((await call(spoc, 'GET', '/leave-reports/dashboard')).statusCode).toBe(200);
  });

  it('locks a month that is over for payroll; a checker does not; only the leave office unlocks', async () => {
    const before = (
      await call(spoc, 'GET', '/payroll/inputs/attendance?month=2026-06&size=25&page=1')
    ).json();
    expect(before.register.unlocked).toEqual(['2026-06']);
    expect(before.register.canLock).toBe(true);
    expect(before.register.openMissing).toBe(0);
    expect(
      (await call(checker, 'GET', '/payroll/inputs/attendance?month=2026-06&size=25&page=1')).json()
        .register.canLock,
    ).toBe(false);
    expect(
      (await call(checker, 'POST', '/staff-attendance/lock', { month: '2026-06' })).statusCode,
    ).toBe(403);
    expect(
      (await call(spoc, 'POST', '/staff-attendance/lock', { month: '2026-06' })).statusCode,
    ).toBe(201);
    expect(
      (
        await call(spoc, 'POST', '/staff-attendance/unlock', {
          month: '2026-06',
          reason: 'A correction came late',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(office, 'POST', '/staff-attendance/unlock', {
          month: '2026-06',
          reason: 'A correction came late',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(spoc, 'POST', '/staff-attendance/lock', { month: '2026-06' })).statusCode,
    ).toBe(201);
    const after = (
      await call(spoc, 'GET', '/payroll/inputs/attendance?month=2026-06&size=25&page=1')
    ).json();
    expect(after.register.locked).toEqual(['2026-06']);
    expect(after.register.unlocked).toEqual([]);
  });

  it('runs the month alone: its own run approved, marked self-approved in the audit trail, locked', async () => {
    expect(
      (
        await call(spoc, 'POST', '/payroll/inputs/attendance/mark-present', {
          month: '2026-06',
          reason: 'Full month',
          dryRun: false,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(spoc, 'POST', '/payroll/inputs/attendance/finalise', { month: '2026-06' }))
        .statusCode,
    ).toBe(201);
    const r = await call(spoc, 'POST', '/payroll/runs', { month: '2026-06', runType: 'REGULAR' });
    expect(r.statusCode).toBe(201);
    runId = r.json().id;
    for (let i = 0; i < 10; i += 1) {
      const p = await call(spoc, 'POST', `/payroll/runs/${runId}/process`);
      expect(p.statusCode).toBe(201);
      if (p.json().done) break;
    }
    expect((await call(spoc, 'GET', `/payroll/runs/${runId}`)).json().run.stage).toBe('REVIEW');
    expect((await call(spoc, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(201);
    const ev = await q<{ after: { selfApproved?: boolean } | null }>(
      `SELECT after FROM audit_logs WHERE school_id = $1 AND action = 'payroll.run.approve' AND entity_id = $2`,
      [school.id, runId],
    );
    expect(ev[0]!.after?.selfApproved).toBe(true);
    const trail = (
      await call(spoc, 'GET', '/payroll/audit?page=1&size=25&contains=selfApproved')
    ).json();
    expect(
      trail.rows.some(
        (x: { action: string; entity_id: string; self: boolean }) =>
          x.action === 'payroll.run.approve' && x.entity_id === runId && x.self,
      ),
    ).toBe(true);
    expect((await call(spoc, 'POST', `/payroll/runs/${runId}/lock`)).statusCode).toBe(201);
  });

  it('a checker who is not the payroll admin cannot approve their own run; the SPOC does, unmarked', async () => {
    expect(
      (await call(spoc, 'POST', '/staff-attendance/lock', { month: '2026-07' })).statusCode,
    ).toBe(201);
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
          month: '2026-07',
          reason: 'Full month',
          dryRun: false,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: '2026-07' }))
        .statusCode,
    ).toBe(201);
    const r = await call(checker, 'POST', '/payroll/runs', {
      month: '2026-07',
      runType: 'REGULAR',
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    for (let i = 0; i < 10; i += 1) {
      const p = await call(checker, 'POST', `/payroll/runs/${id}/process`);
      expect(p.statusCode).toBe(201);
      if (p.json().done) break;
    }
    expect((await call(checker, 'GET', `/payroll/runs/${id}`)).json().run.stage).toBe('REVIEW');
    expect((await call(checker, 'POST', `/payroll/runs/${id}/approve`)).statusCode).toBe(403);
    expect((await call(spoc, 'POST', `/payroll/runs/${id}/approve`)).statusCode).toBe(201);
    const ev = await q<{ after: { selfApproved?: boolean } | null }>(
      `SELECT after FROM audit_logs WHERE school_id = $1 AND action = 'payroll.run.approve' AND entity_id = $2`,
      [school.id, id],
    );
    expect(ev[0]!.after?.selfApproved).toBeUndefined();
  });
});
