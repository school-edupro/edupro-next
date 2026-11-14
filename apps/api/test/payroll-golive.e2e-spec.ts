/**
 * The payroll go-live (docs/design/86, phase G): the old payroll's rows (as the reader puts them in the holding area)
 * previewed with nothing kept, prepared by the payroll admin and committed by a second person — profiles, structures,
 * loans, nominees, challans, attendance and the locked runs as read-only history; parity replays the old months through
 * EduPro's engine to the paisa, a difference open until explained, the explanation kept on a re-run; the parallel months
 * (EduPro to Approved only, no lock, no bank file), compared with what the old payroll paid; signed by a checker and
 * countersigned by the principal; the switch (EduPro refuses the old months; its parallel runs removed), a rollback
 * until the first live lock; the parallel months brought as history; the older years as an archive file.
 */
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

describe('payroll go-live (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  let principal: SeededUser;
  const emp: Record<string, string> = {};
  const s = stamp('PGL');
  const call = (u: SeededUser, method: 'GET' | 'POST', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const q = <T>(sql: string, args: unknown[] = []) =>
    withMigrator((c) => c.query<T & Record<string, unknown>>(sql, args)).then((r) => r.rows);
  const code = (x: string) => `${s}${x}`;
  let srno = 1000;
  const stage = async (tbl: string, payload: Record<string, unknown>) => {
    srno += 1;
    const id = String(payload.srno ?? srno);
    await q(
      `INSERT INTO payroll_legacy_rows (school_id, tbl, legacy_id, payload, read_id) VALUES ($1, $2, $3, $4::jsonb, 1)
       ON CONFLICT (school_id, tbl, legacy_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [school.id, tbl, id, JSON.stringify({ srno: Number(id), isTrash: 0, Status: 1, ...payload })],
    );
    return id;
  };
  /** an old run of a month with its records: each record a basic pay and, perhaps, more lines */
  const oldRun = async (
    runSrno: number,
    month: string,
    people: Array<{
      who: string;
      basic: number;
      extra?: Array<[string, 'EARNING' | 'DEDUCTION', number]>;
    }>,
  ) => {
    const [y, m] = month.split('-').map(Number);
    let gross = 0;
    let ded = 0;
    for (const p of people) {
      const rec = await stage('payroll_salary_record', {
        srno: runSrno * 100 + people.indexOf(p),
        RunSrno: runSrno,
        EmpId: code(p.who),
        PayYear: y,
        PayMonth: m,
        EmpName: `${code(p.who)} E2E`,
        Department: 'Science',
        MonthDays: 30,
        PaidDays: 30,
        LopDays: 0,
        LopAmount: 0,
        RecStatus: 'PAID',
        PayMode: 'BANK',
        ItAmount: 0,
        CessAmount: 0,
        EsiWage: 0,
        PtAmount: 0,
        ...(() => {
          const e =
            p.basic +
            (p.extra ?? []).filter((x) => x[1] === 'EARNING').reduce((t, x) => t + x[2], 0);
          const d = (p.extra ?? [])
            .filter((x) => x[1] === 'DEDUCTION')
            .reduce((t, x) => t + x[2], 0);
          gross += e;
          ded += d;
          return { GrossFixed: e, GrossEarned: e, TotalDeductions: d, NetPay: e - d };
        })(),
      });
      await stage('payroll_salary_record_line', {
        RecordSrno: Number(rec),
        HeadCode: 'BASIC',
        HeadName: 'Basic Pay',
        HeadType: 'EARNING',
        RateAmount: p.basic,
        EarnedAmount: p.basic,
        IsArrear: 0,
        IsStructure: 1,
        PrintOrder: 1,
      });
      for (const [h, t, amt] of p.extra ?? [])
        await stage('payroll_salary_record_line', {
          RecordSrno: Number(rec),
          HeadCode: h,
          HeadName: h,
          HeadType: t,
          RateAmount: amt,
          EarnedAmount: amt,
          IsArrear: h.endsWith('ARR') ? 1 : 0,
          IsStructure: 0,
          PrintOrder: 5,
        });
      await stage('payroll_attendance_summary', {
        EmpId: code(p.who),
        PayYear: y,
        PayMonth: m,
        MonthDays: 30,
        PresentDays: 30,
        PaidLeaveDays: 0,
        LopDays: 0,
        PaidDays: 30,
        OtHours: 0,
        Finalised: 1,
      });
    }
    await stage('payroll_run', {
      srno: runSrno,
      PayYear: y,
      PayMonth: m,
      RunType: 'REGULAR',
      RunSeq: 1,
      RunStage: 'LOCKED',
      GrossTotal: gross,
      DeductionTotal: ded,
      NetTotal: gross - ded,
    });
  };
  const runMonth = async (month: string, upTo: 'APPROVED' | 'LOCKED') => {
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month,
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month });
    const r = await call(maker, 'POST', '/payroll/runs', { month, runType: 'REGULAR' });
    expect(`${String(r.statusCode)} ${String(r.json().detail ?? '')}`).toBe('201 ');
    const id = r.json().id as string;
    for (let i = 0; i < 10; i += 1)
      if ((await call(maker, 'POST', `/payroll/runs/${id}/process`)).json().done) break;
    expect((await call(checker, 'POST', `/payroll/runs/${id}/approve`)).statusCode).toBe(201);
    if (upTo === 'LOCKED')
      expect((await call(checker, 'POST', `/payroll/runs/${id}/lock`)).statusCode).toBe(201);
    return id;
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      principal = await seedUser(c, school, `${s}-pr`, 'school_admin');
      for (const x of ['A', 'B'])
        emp[x] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob, gender)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', '2020-01-01', '1985-05-05', 'male') RETURNING id::text`,
            [school.id, code(x)],
          )
        ).rows[0]!.id;
      for (const m of ['2026-06-01', '2026-07-01', '2026-08-01'])
        await c.query(
          `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, $2::date, true)`,
          [school.id, m],
        );
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

  it('the old payroll previewed, prepared by the admin, committed by a second person; its history read-only', async () => {
    expect((await call(maker, 'GET', '/payroll/golive')).statusCode).toBe(403);
    expect((await call(checker, 'POST', '/payroll/golive/start', {})).statusCode).toBe(403);
    expect(
      (await call(admin, 'POST', '/payroll/golive/start', { historyFrom: '2025-04-01' }))
        .statusCode,
    ).toBe(201);
    expect((await call(admin, 'POST', '/payroll/golive/read')).statusCode).toBe(201);
    // what the reader puts in the holding area
    await stage('payroll_pay_head', {
      srno: 1,
      Code: 'BASIC',
      Name: 'Basic Pay',
      HeadType: 'EARNING',
    });
    for (const [who, tds] of [
      ['A', 'MANUAL'],
      ['B', 'MANUAL'],
      ['X', 'MANUAL'],
    ] as const)
      await stage('payroll_employee_profile', {
        EmpId: code(who),
        PfApplicable: 0,
        EpsApplicable: 0,
        EsiApplicable: 0,
        PtApplicable: 0,
        NpsApplicable: 0,
        TaxRegime: 'NEW',
        TdsMode: tds,
        PayrollStatus: 'ACTIVE',
        PayMode: 'BANK',
      });
    await stage('payroll_structure', {
      EmpId: code('A'),
      PayHeadSrno: 1,
      Amount: 30000,
      EffectiveFrom: '2025-04-01',
      ApprovalStatus: 'ACTIVE',
    });
    await stage('payroll_structure', {
      EmpId: code('B'),
      PayHeadSrno: 1,
      Amount: 20000,
      EffectiveFrom: '2025-04-01',
      ApprovalStatus: 'ACTIVE',
    });
    await stage('payroll_structure', {
      EmpId: code('B'),
      PayHeadSrno: 1,
      Amount: 99999,
      EffectiveFrom: '2027-04-01',
      ApprovalStatus: 'DRAFT',
    });
    await stage('payroll_loan', {
      EmpId: code('A'),
      LoanType: 'Salary advance',
      Principal: 10000,
      Emi: 1000,
      InterestMethod: 'NONE',
      Balance: 5000,
      StartYear: 2026,
      StartMonth: 1,
      LoanStatus: 'ACTIVE',
    });
    await stage('payroll_nominee', {
      EmpId: code('A'),
      Name: 'Nominee E2E',
      Relation: 'Spouse',
      SharePercent: 100,
      Purpose: 'GRATUITY',
    });
    await stage('payroll_tds_challan', {
      Fy: '2025-26',
      Quarter: 4,
      ChallanNo: '12345',
      BsrCode: '0001234',
      DepositDate: '2026-04-07',
      Amount: 1000,
      Interest: 0,
      MonthsCovered: '[3]',
    });
    // April and May paid by the old payroll: B with a profession tax EduPro does not charge here; an older year too
    await oldRun(10, '2026-04', [
      { who: 'A', basic: 30000, extra: [['ADV', 'DEDUCTION', 1000]] },
      { who: 'B', basic: 20000, extra: [['PT', 'DEDUCTION', 200]] },
    ]);
    await oldRun(11, '2026-05', [
      { who: 'A', basic: 30000, extra: [['ADV', 'DEDUCTION', 1000]] },
      { who: 'B', basic: 20000, extra: [['PT', 'DEDUCTION', 200]] },
    ]);
    await oldRun(9, '2024-06', [{ who: 'A', basic: 25000 }]);
    await q(`UPDATE payroll_cutover SET read_at = now(), read_id = 1 WHERE school_id = $1`, [
      school.id,
    ]);

    const pre = (await call(checker, 'GET', '/payroll/golive/preview')).json();
    expect(pre.counts).toMatchObject({
      profiles: 2,
      structures: 2,
      loans: 1,
      nominees: 1,
      challans: 1,
      runs: 2,
      records: 4,
      attendance: 4,
    });
    expect(pre.problems.map((p: { what: string }) => p.what)).toContain(
      'No employee here with this code: their payroll is left out',
    );
    expect(
      (
        await q<{ n: number }>(`SELECT count(*)::int AS n FROM payroll_runs WHERE school_id = $1`, [
          school.id,
        ])
      )[0]!.n,
    ).toBe(0);
    expect((await call(admin, 'POST', '/payroll/golive/commit')).statusCode).toBe(409);
    expect((await call(admin, 'POST', '/payroll/golive/prepare')).statusCode).toBe(201);
    expect((await call(admin, 'POST', '/payroll/golive/commit')).statusCode).toBe(403);
    const done = (await call(checker, 'POST', '/payroll/golive/commit')).json();
    expect(done.counts).toMatchObject({ runs: 2, records: 4 });
    expect((await call(checker, 'POST', '/payroll/golive/commit')).statusCode).toBe(409);
    const runs = await q<{ id: string; stage: string; imported: boolean }>(
      `SELECT id::text, stage, imported FROM payroll_runs WHERE school_id = $1 ORDER BY month`,
      [school.id],
    );
    expect(runs.map((r) => [r.stage, r.imported])).toEqual([
      ['LOCKED', true],
      ['LOCKED', true],
    ]);
    // brought history does not change, and EduPro runs nothing until the parallel months
    expect(
      (
        await call(admin, 'POST', `/payroll/runs/${runs[0]!.id}/reopen`, {
          comment: 'Trying to reopen',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call(maker, 'POST', '/payroll/runs', { month: '2026-06', runType: 'REGULAR' }))
        .statusCode,
    ).toBe(409);
    const lines = await q<{ code: string; amount: string }>(
      `SELECT l.code, l.amount::text FROM payroll_record_lines l JOIN payroll_records r ON r.id = l.record_id
        WHERE r.employee_id = $1 AND r.month = '2026-04-01' ORDER BY l.code`,
      [emp.B],
    );
    expect(lines).toEqual([
      { code: 'BASIC', amount: '20000.00' },
      { code: 'PT', amount: '200.00' },
    ]);
    const zip = await JSZip.loadAsync(
      Buffer.from(
        (await call(checker, 'GET', '/payroll/golive/archive')).json().base64 as string,
        'base64',
      ),
    );
    expect(await zip.file('payroll_run.csv')!.async('string')).toContain('2024');
  });

  it('parity: the old months replayed to the paisa, a difference open until explained, kept on a re-run', async () => {
    const r1 = (
      await call(checker, 'POST', '/payroll/golive/parity/replay', {
        months: ['2026-04', '2026-05'],
      })
    ).json();
    expect(r1).toMatchObject({ records: 4 });
    // B: profession tax, deductions and net differ in each month
    expect(r1.open).toBe(6);
    const open = (
      await call(checker, 'GET', `/payroll/golive/parity/${r1.batchId as string}?status=OPEN`)
    ).json();
    expect(open.rows.map((x: { component: string }) => x.component).sort()).toEqual([
      'DEDUCTIONS',
      'DEDUCTIONS',
      'NET',
      'NET',
      'PT',
      'PT',
    ]);
    expect(
      open.scoreboard.find((x: { component: string }) => x.component === 'BASIC'),
    ).toMatchObject({ open: 0, match: 4 });
    expect(
      (
        await call(checker, 'POST', `/payroll/golive/parity/${r1.batchId as string}/explain`, {
          resultIds: open.rows.map((x: { id: string }) => x.id),
          code: 'LEGACY_DEFECT',
          note: 'Charged PT to a staff member exempt from it',
        })
      ).statusCode,
    ).toBe(400);
    const ok = (
      await call(checker, 'POST', `/payroll/golive/parity/${r1.batchId as string}/explain`, {
        resultIds: open.rows.map((x: { id: string }) => x.id),
        code: 'SETUP_GAP',
        note: 'The old payroll charged profession tax; set PT on the profile here',
      })
    ).json();
    expect(ok.explained).toBe(6);
    const r2 = (
      await call(checker, 'POST', '/payroll/golive/parity/replay', {
        months: ['2026-04', '2026-05'],
      })
    ).json();
    expect(r2).toMatchObject({ open: 0, explained: 6 });
  });

  it('the parallel months: EduPro to Approved only, compared, signed, countersigned; the switch and its rollback', async () => {
    expect(
      (
        await call(admin, 'POST', '/payroll/golive/parallel-months', {
          months: ['2026-06', '2026-08'],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(admin, 'POST', '/payroll/golive/parallel-months', {
          months: ['2026-06', '2026-07'],
        })
      ).statusCode,
    ).toBe(201);
    const june = await runMonth('2026-06', 'APPROVED');
    expect((await call(checker, 'POST', `/payroll/runs/${june}/lock`)).statusCode).toBe(409);
    expect(
      (await call(checker, 'POST', `/payroll/runs/${june}/bank`, { bankAccountId: '1' }))
        .statusCode,
    ).toBeGreaterThanOrEqual(400);
    await runMonth('2026-07', 'APPROVED');
    // the old payroll paid June and July: July has A's arrear EduPro did not pay
    await oldRun(12, '2026-06', [
      { who: 'A', basic: 30000, extra: [['ADV', 'DEDUCTION', 1000]] },
      { who: 'B', basic: 20000 },
    ]);
    await oldRun(13, '2026-07', [
      {
        who: 'A',
        basic: 30000,
        extra: [
          ['ADV', 'DEDUCTION', 1000],
          ['OTH_ARR', 'EARNING', 500],
        ],
      },
      { who: 'B', basic: 20000 },
    ]);
    const cmp = (await call(checker, 'POST', '/payroll/golive/parity/parallel')).json();
    expect(cmp.open).toBe(3);
    expect(
      (await call(checker, 'POST', `/payroll/golive/parity/${cmp.batchId as string}/sign`))
        .statusCode,
    ).toBe(409);
    const open = (
      await call(checker, 'GET', `/payroll/golive/parity/${cmp.batchId as string}?status=OPEN`)
    ).json();
    await call(checker, 'POST', `/payroll/golive/parity/${cmp.batchId as string}/explain`, {
      resultIds: open.rows.map((x: { id: string }) => x.id),
      code: 'MISSING_INPUT',
      note: 'An arrear the old payroll paid in July; it is not entered here',
    });
    const sign = (
      await call(checker, 'POST', `/payroll/golive/parity/${cmp.batchId as string}/sign`)
    ).json();
    expect(sign.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (await call(checker, 'POST', `/payroll/golive/signoffs/${sign.id as string}/countersign`))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(principal, 'POST', `/payroll/golive/signoffs/${sign.id as string}/countersign`))
        .statusCode,
    ).toBe(201);
    // the switch: not before the parallel months end
    expect(
      (await call(admin, 'POST', '/payroll/golive/switch', { month: '2026-07' })).statusCode,
    ).toBe(400);
    expect(
      (await call(admin, 'POST', '/payroll/golive/switch', { month: '2026-08' })).statusCode,
    ).toBe(201);
    expect(
      (
        await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_runs WHERE school_id = $1 AND NOT imported AND deleted_at IS NULL`,
          [school.id],
        )
      )[0]!.n,
    ).toBe(0);
    expect(
      (await call(maker, 'POST', '/payroll/runs', { month: '2026-07', runType: 'REGULAR' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call(admin, 'POST', '/payroll/golive/rollback', { reason: 'Trying the switch back' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call(admin, 'POST', '/payroll/golive/switch', { month: '2026-08' })).statusCode,
    ).toBe(201);
  });

  it('the parallel months brought as history; EduPro pays from the switch month; no rollback after the first lock', async () => {
    expect((await call(admin, 'POST', '/payroll/golive/prepare')).statusCode).toBe(201);
    const done = (await call(checker, 'POST', '/payroll/golive/commit')).json();
    expect(done.counts).toMatchObject({ runs: 2 });
    expect(
      (
        await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM payroll_runs WHERE school_id = $1 AND imported`,
          [school.id],
        )
      )[0]!.n,
    ).toBe(4);
    await runMonth('2026-08', 'LOCKED');
    expect(
      (await call(admin, 'POST', '/payroll/golive/rollback', { reason: 'Trying the switch back' }))
        .statusCode,
    ).toBe(409);
    const view = (await call(principal, 'GET', '/payroll/golive')).json();
    expect(view.cutover).toMatchObject({ status: 'SWITCHED', switch_month: '2026-08' });
  });
});
