/**
 * Payroll's monthly inputs (docs/design/86, phase B step 1): attendance pulled from the attendance register —
 * refused until a month over is locked there; loss of pay from absence, half days, loss-of-pay leave, part-pay
 * leave; days before joining and after leaving; a joiner after the month not on the roster; corrected by hand,
 * marked present (a checker), finalised (a checker), the register month kept locked while finalised,
 * un-finalised by the payroll admin; salary hold (a checker); a typed month's tax; loans with their schedule,
 * held and foreclosed; one-off items (refused for heads payroll works out and for an earning on the
 * structure); fee recovery from a linked child's dues; recurring deductions (no duplicate) and payees; claims
 * decided by a checker who did not enter them; overtime at the dated rate, replaced and within the limit.
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

describe('payroll monthly inputs (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  let checker2: SeededUser;
  const emp: Record<string, string> = {};
  const head: Record<string, string> = {};
  let student = '';
  const s = stamp('PI');
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
  const row = async (code: string, month = '2026-06') =>
    (await call(checker, 'GET', `/payroll/inputs/attendance?month=${month}&size=100`))
      .json()
      .rows.find((r: { employee: { id: string } }) => r.employee.id === emp[code]);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      checker2 = await seedUser(c, school, `${s}-c2`, 'payroll_checker');
      await c.query(`SELECT app.staff_leave_seed_all($1)`, [school.id]);
      const add = async (
        code: string,
        joined: string,
        left: string | null,
        status = 'active',
        mobile: string | null = null,
      ) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, left_on,
                                    status, mobile, profile)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', $3, $4, $5::row_status, $6, '{"staff_type": "Teaching Regular"}')
             RETURNING id::text`,
            [school.id, `${s}${code}`, joined, left, status, mobile],
          )
        ).rows[0]!.id;
      emp.A = await add('A', '2020-01-01', null, 'active', '9876501234');
      emp.B = await add('B', '2026-06-11', null);
      emp.C = await add('C', '2019-04-01', '2026-06-20', 'inactive');
      emp.D = await add('D', '2026-07-05', null);
      emp.E = await add('E', '2021-01-01', '2026-05-31', 'inactive');
      const lt = async (code: string) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM staff_leave_types WHERE school_id = $1 AND code = $2`,
            [school.id, code],
          )
        ).rows[0]!.id;
      const day = (
        e: string,
        d: string,
        type: string,
        leave: string | null = null,
        portion: number | null = null,
      ) =>
        c.query(
          `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, leave_type_id, leave_portion, source, manual)
           VALUES ($1, $2, $3::date, $4, $5, $6, 'manual', true)`,
          [school.id, e, d, type, leave, portion],
        );
      await c.query(
        `UPDATE staff_leave_types SET pay_percent = 50 WHERE school_id = $1 AND code = 'HPL'`,
        [school.id],
      );
      for (let d = 1; d <= 30; d += 1) {
        const dd = `2026-06-${String(d).padStart(2, '0')}`;
        if (d === 2) await day(emp.A!, dd, 'A');
        else if (d === 3) await day(emp.A!, dd, 'HD');
        else if (d === 4) await day(emp.A!, dd, 'LV', await lt('CL'), 1);
        else if (d === 5) await day(emp.A!, dd, 'LV', await lt('LOP'), 1);
        else if (d === 8) await day(emp.A!, dd, 'LV', await lt('HPL'), 1);
        else if (d === 7 || d === 14 || d === 21 || d === 28) await day(emp.A!, dd, 'WO');
        else if (d !== 30) await day(emp.A!, dd, 'P');
      }
      // a child of A by the guardian's mobile, with fees due
      student = (
        await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, 'Kid', 'E2E') RETURNING id::text`,
          [school.id, `${s}-S1`],
        )
      ).rows[0]!.id;
      const g = (
        await c.query<{ id: string }>(
          `INSERT INTO guardians (school_id, first_name, mobile) VALUES ($1, 'Parent', '+91 98765 01234') RETURNING id::text`,
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
         VALUES ($1, $2, $3, $4, $5, 4500, 4500, 1000, 'partial', '2026-04-10', 'school')`,
        [school.id, student, school.yearId, per, fh],
      );
    });
    app = await createApp();
    inject = injector(app);
    // the school's payroll defaults (pay heads …)
    await call(admin, 'GET', '/payroll/setup');
    for (const r of await q<{ id: string; code: string }>(
      `SELECT id::text, code FROM payroll_pay_heads WHERE school_id = $1`,
      [school.id],
    ))
      head[r.code] = r.id;
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('attendance: pulled only from a locked register month; loss of pay, joiners and leavers', async () => {
    const refused = await call(maker, 'POST', '/payroll/inputs/attendance/pull', {
      month: '2026-06',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toContain('Lock June 2026 in the attendance register');
    await q(
      `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, '2026-06-01', true)`,
      [school.id],
    );
    expect(
      (await call(checker, 'POST', '/payroll/inputs/attendance/pull', { month: '2026-06' }))
        .statusCode,
    ).toBe(201);
    const r = (
      await call(maker, 'POST', '/payroll/inputs/attendance/pull', { month: '2026-06' })
    ).json();
    // A, B and C are on June's roster; D joins in July and E left in May
    expect(r.pulled).toBe(3);
    const m = (await call(maker, 'GET', '/payroll/inputs/attendance?month=2026-06')).json();
    expect(m.figures).toMatchObject({ staff: 3, pulled: 3, missing: 0, finalised: 0 });
    expect(m.register.locked).toEqual(['2026-06']);
    const a = (await row('A')).attendance;
    // absent 1 + half day 0.5 + loss-of-pay leave 1 + half of half-pay leave 0.5; the 30th unmarked counts present
    expect(a).toMatchObject({
      monthDays: '30.0',
      lopDays: '3.00',
      paidDays: '27.00',
      paidLeaveDays: '1.50',
      unmarkedDays: 1,
    });
    expect(Number(a.warnings)).toBe(1);
    expect((await row('B')).attendance).toMatchObject({ preJoinDays: '10.00', paidDays: '20.00' });
    expect((await row('C')).attendance).toMatchObject({
      postLeaveDays: '10.00',
      paidDays: '20.00',
    });
    const ex = (
      await call(maker, 'GET', `/payroll/inputs/attendance/${emp.A!}?month=2026-06`)
    ).json();
    expect(ex.attendance.detail.leave.HPL).toEqual({ days: '1.00', paid: '0.50', lop: '0.50' });
    expect(ex.attendance.detail.lop).toMatchObject({
      absent: '1.00',
      halfDay: '0.50',
      lossOfPayLeave: '1.00',
    });
  });

  it('attendance: by hand, marked present by a checker, finalised, un-finalised by the admin', async () => {
    const bad = await call(maker, 'PUT', `/payroll/inputs/attendance/${emp.B!}`, {
      month: '2026-06',
      lopDays: '25',
      reason: 'too many',
    });
    expect(bad.json().detail).toContain('more than the 20.00 day(s) employed');
    const ok = await call(maker, 'PUT', `/payroll/inputs/attendance/${emp.B!}`, {
      month: '2026-06',
      lopDays: '2',
      otHours: '6',
      reason: 'Two days absent, confirmed by the HOD',
    });
    expect(ok.json()).toMatchObject({ paidDays: '18.00', source: 'manual', otHours: '6.00' });
    expect(
      (
        await call(maker, 'POST', '/payroll/inputs/attendance/mark-present', {
          month: '2026-06',
          reason: 'Quick fill',
        })
      ).statusCode,
    ).toBe(403);
    const dry = (
      await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
        month: '2026-06',
        reason: 'Everyone present but C',
        exceptions: [{ employeeId: emp.C, lopDays: '1' }],
      })
    ).json();
    expect(dry).toMatchObject({ dryRun: true, presentWholeMonth: 2, exceptions: 1 });
    expect((await row('B')).attendance.paidDays).toBe('18.00');
    expect(
      (await call(maker, 'POST', '/payroll/inputs/attendance/finalise', { month: '2026-06' }))
        .statusCode,
    ).toBe(403);
    const f = (
      await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: '2026-06' })
    ).json();
    expect(f.finalised).toBe(3);
    const locked = await call(maker, 'PUT', `/payroll/inputs/attendance/${emp.B!}`, {
      month: '2026-06',
      lopDays: '0',
      reason: 'again',
    });
    expect(locked.statusCode).toBe(409);
    // the register cannot unlock June while payroll has it finalised
    await expect(
      q(
        `UPDATE staff_month_locks SET locked = false WHERE school_id = $1 AND month = '2026-06-01'`,
        [school.id],
      ),
    ).rejects.toThrow('payroll.month_finalised');
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/attendance/unfinalise', {
          month: '2026-06',
          reason: 'Correction',
        })
      ).statusCode,
    ).toBe(403);
    const un = (
      await call(admin, 'POST', '/payroll/inputs/attendance/unfinalise', {
        month: '2026-06',
        reason: 'A late correction',
      })
    ).json();
    expect(un.unfinalised).toBe(3);
  });

  it('the attendance sheet: checked, then saved', async () => {
    const f = (await call(maker, 'GET', '/payroll/inputs/attendance/format?month=2026-06')).json();
    expect(f.filename).toBe('payroll-attendance-2026-06.xlsx');
    const csv = [
      'Employee code,Loss of pay days,Paid leave days,OT hours,Reason',
      `${s}A,4,1.5,,Corrected`,
      `${s}D,0,,,Not on the roster`,
      `${s}A,1,,,Twice`,
    ].join('\n');
    const file = Buffer.from(csv).toString('base64');
    const dry = (
      await call(maker, 'POST', '/payroll/inputs/attendance/import', {
        month: '2026-06',
        file,
        reason: 'Sheet',
        dryRun: true,
      })
    ).json();
    expect(dry.counts).toEqual({ ok: 1, error: 2 });
    expect(dry.rows.map((r: { error: string | null }) => r.error)).toEqual([
      null,
      'Not an employee on this month’s roster',
      'The employee is in the file twice',
    ]);
    expect((await row('A')).attendance.lopDays).toBe('3.00');
    const saved = (
      await call(maker, 'POST', '/payroll/inputs/attendance/import', {
        month: '2026-06',
        file,
        reason: 'Sheet',
        dryRun: false,
      })
    ).json();
    expect(saved.saved).toBe(1);
    expect((await row('A')).attendance).toMatchObject({
      lopDays: '4.00',
      paidDays: '26.00',
      source: 'import',
    });
  });

  it('salary hold and a typed month’s tax', async () => {
    expect(
      (
        await call(maker, 'POST', '/payroll/inputs/holds', {
          month: '2026-06',
          employeeId: emp.A,
          mode: 'HOLD',
          reason: 'Inquiry',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/holds', {
          month: '2026-06',
          employeeId: emp.C,
          mode: 'SKIP',
          reason: 'Settled in full and final',
        })
      ).statusCode,
    ).toBe(201);
    const h = (await call(maker, 'GET', '/payroll/inputs/holds?month=2026-06')).json();
    expect(h.rows).toEqual([
      expect.objectContaining({ employeeId: emp.C, mode: 'SKIP', active: true }),
    ]);
    expect(
      (await call(maker, 'GET', '/payroll/inputs/attendance?month=2026-06')).json().figures.skipped,
    ).toBe(1);
    expect(
      (
        await call(checker, 'POST', `/payroll/inputs/holds/${h.rows[0].id as string}/lift`, {
          reason: 'Paid with the month after all',
        })
      ).statusCode,
    ).toBe(201);
    const t = await call(maker, 'PUT', '/payroll/inputs/tds', {
      month: '2026-06',
      employeeId: emp.A,
      itAmount: '2500',
      cessAmount: '100',
      reason: 'As agreed with the employee',
    });
    expect(t.statusCode).toBe(200);
    expect((await call(maker, 'GET', '/payroll/inputs/tds?month=2026-06')).json().rows).toEqual([
      expect.objectContaining({ itAmount: '2500.00', cessAmount: '100.00' }),
    ]);
  });

  it('loans: the schedule, held by a maker, foreclosed by a checker', async () => {
    const pre = (
      await call(maker, 'POST', '/payroll/inputs/loans/schedule', {
        principal: '10000',
        emi: '1500',
        rate: '12',
        method: 'REDUCING',
        startMonth: '2026-07',
      })
    ).json();
    expect(pre.months[0]).toEqual({
      month: '2026-07',
      opening: '10000.00',
      interest: '100.00',
      emi: '1500.00',
      principal: '1400.00',
      closing: '8600.00',
    });
    expect(pre.count).toBe(7);
    expect(
      (
        await call(maker, 'POST', '/payroll/inputs/loans/schedule', {
          principal: '10000',
          emi: '100',
          rate: '12',
          method: 'FLAT',
          startMonth: '2026-07',
        })
      ).json().detail,
    ).toContain('does not cover the month');
    const add = (
      await call(maker, 'POST', '/payroll/inputs/loans', {
        employeeId: emp.A,
        loanType: 'festival',
        principal: '6000',
        emi: '2000',
        startMonth: '2026-07',
      })
    ).json();
    expect(add).toMatchObject({ months: 3, lastMonth: '2026-09' });
    expect(
      (
        await call(maker, 'POST', `/payroll/inputs/loans/${add.id as string}/status`, {
          status: 'HOLD',
          reason: 'On leave',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call(maker, 'POST', `/payroll/inputs/loans/${add.id as string}/status`, {
          status: 'CLOSED',
          reason: 'Paid back',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker, 'POST', `/payroll/inputs/loans/${add.id as string}/status`, {
          status: 'CLOSED',
          reason: 'Paid back in cash',
        })
      ).statusCode,
    ).toBe(201);
    const l = (await call(maker, 'GET', `/payroll/inputs/loans/${add.id as string}`)).json();
    expect(l.loan).toMatchObject({ status: 'CLOSED', balance: '0.00', loanType: 'FESTIVAL' });
    expect(l.remaining).toEqual([]);
  });

  it('one-off items: never a head payroll works out, never an earning on the structure', async () => {
    await q(
      `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
       VALUES ($1, $2, $3, 30000, '2026-04-01', 'active')`,
      [school.id, emp.A, head.BASIC],
    );
    const pf = await call(maker, 'POST', '/payroll/inputs/adhoc', {
      month: '2026-06',
      employeeId: emp.A,
      payHeadId: head.PF,
      amount: '100',
      remarks: 'not allowed',
    });
    expect(pf.json().detail).toContain('PF is worked out by payroll');
    const basic = await call(maker, 'POST', '/payroll/inputs/adhoc', {
      month: '2026-06',
      employeeId: emp.A,
      payHeadId: head.BASIC,
      amount: '100',
      remarks: 'not allowed',
    });
    expect(basic.json().detail).toContain('on this employee’s salary structure');
    const ok = await call(maker, 'POST', '/payroll/inputs/adhoc', {
      month: '2026-06',
      employeeId: emp.A,
      payHeadId: head.MISC_DED,
      amount: '250',
      remarks: 'Library book lost',
    });
    expect(ok.statusCode).toBe(201);
    const list = (await call(maker, 'GET', '/payroll/inputs/adhoc?month=2026-06')).json();
    expect(list.figures).toEqual({ earnings: '0.00', deductions: '250.00', count: 1 });
    expect(
      (await call(maker, 'DELETE', `/payroll/inputs/adhoc/${ok.json().id as string}`)).statusCode,
    ).toBe(200);
  });

  it('fee recovery: a child found by mobile, linked by a checker, the dues deducted once', async () => {
    const w = (await call(maker, 'GET', `/payroll/inputs/wards?employeeId=${emp.A!}`)).json();
    expect(w.found).toEqual([expect.objectContaining({ studentId: student })]);
    expect(w.wardFeeHeadId).toBe(head.WARDFEE);
    expect(
      (
        await call(maker, 'POST', '/payroll/inputs/wards', {
          employeeId: emp.A,
          studentId: student,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(checker, 'POST', '/payroll/inputs/wards', {
          employeeId: emp.A,
          studentId: student,
        })
      ).statusCode,
    ).toBe(201);
    const d = (await call(maker, 'GET', `/payroll/inputs/wards?employeeId=${emp.A!}`)).json();
    expect(d.linked).toEqual([
      expect.objectContaining({ studentId: student, source: 'mobile', active: true }),
    ]);
    expect(d.dues).toEqual([
      expect.objectContaining({ dueOn: '2026-04-10', outstanding: '3500.00', staged: false }),
    ]);
    const body = {
      month: '2026-06',
      employeeId: emp.A,
      payHeadId: head.WARDFEE,
      items: [{ studentId: student, dueOn: '2026-04-10' }],
    };
    expect((await call(maker, 'POST', '/payroll/inputs/fee-recovery', body)).json()).toMatchObject({
      staged: 1,
      skipped: 0,
    });
    expect((await call(maker, 'POST', '/payroll/inputs/fee-recovery', body)).json()).toMatchObject({
      staged: 0,
      skipped: 1,
    });
    const a = (await call(maker, 'GET', '/payroll/inputs/adhoc?month=2026-06')).json().rows;
    expect(a).toEqual([
      expect.objectContaining({
        headCode: 'WARDFEE',
        amount: '3500.00',
        refModule: 'FEE',
        receiptPending: true,
      }),
    ]);
  });

  it('recurring deductions and payees; claims; overtime', async () => {
    const payee = (
      await call(maker, 'POST', '/payroll/inputs/payees', { name: `${s} LIC`, partyType: 'LIC' })
    ).json().id;
    const rd = {
      employeeId: emp.A,
      payHeadId: head.LIC,
      payeeId: payee,
      amount: '1200',
      referenceNo: 'POL-1',
      startMonth: '2026-04',
    };
    expect((await call(maker, 'POST', '/payroll/inputs/recurring', rd)).statusCode).toBe(201);
    expect((await call(maker, 'POST', '/payroll/inputs/recurring', rd)).statusCode).toBe(409);
    expect(
      (await call(maker, 'POST', '/payroll/inputs/recurring', { ...rd, referenceNo: 'POL-2' }))
        .statusCode,
    ).toBe(201);
    const payout = (await call(checker, 'GET', '/payroll/inputs/payout?month=2026-06')).json();
    expect(payout.rows).toEqual([
      expect.objectContaining({ payee: `${s} LIC`, deductions: 2, amount: '2400.00' }),
    ]);

    // claims on a reimbursement head
    const reimb = (
      await q<{ id: string }>(
        `INSERT INTO payroll_pay_heads (school_id, code, name, head_type, category, print_order) VALUES ($1, 'MED_RE', 'Medical reimbursement', 'EARNING', 'REIMB', 60) RETURNING id::text`,
        [school.id],
      )
    )[0]!.id;
    await q(
      `INSERT INTO payroll_pay_head_versions (school_id, pay_head_id, calc_type, is_taxable, pf_wage, esi_wage, pt_wage, prorate_on_lop, rounding, effective_from, status)
       VALUES ($1, $2, 'MANUAL', false, false, false, false, false, 'NONE', '2026-04-01', 'active')`,
      [school.id, reimb],
    );
    const claim = (
      await call(checker, 'POST', '/payroll/inputs/claims', {
        employeeId: emp.A,
        payHeadId: reimb,
        amountClaimed: '1800',
        description: 'Spectacles',
      })
    ).json().id as string;
    const own = await call(checker, 'POST', `/payroll/inputs/claims/${claim}/decide`, {
      decision: 'APPROVED',
      amountApproved: '1500',
      payMonth: '2026-06',
    });
    expect(own.statusCode).toBe(403);
    expect(
      (
        await call(checker2, 'POST', `/payroll/inputs/claims/${claim}/decide`, {
          decision: 'APPROVED',
          amountApproved: '2000',
          payMonth: '2026-06',
        })
      ).json().detail,
    ).toContain('More is approved than was claimed');
    expect(
      (
        await call(checker2, 'POST', `/payroll/inputs/claims/${claim}/decide`, {
          decision: 'APPROVED',
          amountApproved: '1500',
          payMonth: '2026-06',
        })
      ).statusCode,
    ).toBe(201);
    const items = (await call(maker, 'GET', '/payroll/inputs/adhoc?month=2026-06')).json();
    expect(items.figures.earnings).toBe('1500.00');
    const claimLine = items.rows.find((r: { refModule: string }) => r.refModule === 'CLAIM');
    expect(
      (await call(maker, 'DELETE', `/payroll/inputs/adhoc/${claimLine.id as string}`)).statusCode,
    ).toBe(409);

    // overtime at the dated rate of the employee's type
    await q(
      `INSERT INTO payroll_ot_rates (school_id, employee_type, daily_amount, hourly_amount, effective_from, status)
       VALUES ($1, 'Teaching Regular', 800, 150, '2026-04-01', 'active')`,
      [school.id],
    );
    const ot = { month: '2026-06', employeeId: emp.A, basis: 'HOUR', qty: '10' };
    expect((await call(maker, 'PUT', '/payroll/inputs/overtime', ot)).json()).toMatchObject({
      amount: '1500.00',
      derived: '1500.00',
    });
    expect(
      (await call(maker, 'PUT', '/payroll/inputs/overtime', { ...ot, qty: '800' })).json().detail,
    ).toContain('monthly limit');
    expect(
      (
        await call(maker, 'PUT', '/payroll/inputs/overtime', { ...ot, qty: '4', amount: '700' })
      ).json().detail,
    ).toContain('Say why the amount differs');
    const second = await call(maker, 'PUT', '/payroll/inputs/overtime', {
      ...ot,
      basis: 'DAY',
      qty: '2',
    });
    expect(second.json()).toMatchObject({ amount: '1600.00' });
    // replaced, not added: one entry and one OT line
    const third = await call(maker, 'PUT', '/payroll/inputs/overtime', {
      ...ot,
      basis: 'DAY',
      qty: '1',
    });
    expect(third.statusCode).toBe(200);
    const o = (await call(maker, 'GET', '/payroll/inputs/overtime?month=2026-06')).json();
    expect(o.rows).toHaveLength(1);
    expect(o.total).toBe('800.00');
    expect(
      (
        await call(maker, 'POST', '/payroll/inputs/adhoc', {
          month: '2026-06',
          employeeId: emp.A,
          payHeadId: head.OT,
          amount: '100',
          remarks: 'extra',
        })
      ).json().detail,
    ).toContain('already entered on the Overtime tab');
    expect(
      (await call(maker, 'DELETE', `/payroll/inputs/overtime/${o.rows[0].id as string}`))
        .statusCode,
    ).toBe(200);
  });
});
