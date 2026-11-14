/**
 * Bank batches (docs/design/86, phase C step 1): the school's bank accounts with a file layout each (the payroll
 * admin; a layout tried on made-up payments); a bank file from an approved run is provisional — the bank gets it only
 * after the lock; one live file a salary; a file cancelled before upload; a salary in a file is not held, and the run
 * is neither unapproved nor reopened; uploaded, confirmed with the UTR — the salaries paid; a payment the bank
 * returned: the salary held, the account corrected on the employee record, released and paid to the new account; a
 * cash salary marked paid with its voucher number; the run paid when nothing is left.
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

describe('payroll bank batches (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let maker: SeededUser;
  let checker: SeededUser;
  const emp: Record<string, string> = {};
  let runId = '';
  const s = stamp('PBK');
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
  const recordOf = async (code: string) =>
    (await call(checker, 'GET', `/payroll/runs/${runId}/records?size=100`))
      .json()
      .rows.find((r: { code: string }) => r.code === `${s}${code}`);
  const text = (f: { base64: string }) => Buffer.from(f.base64, 'base64').toString('utf8');
  const layout = {
    columns: [
      { field: 'account', header: 'Beneficiary account' },
      { field: 'amount', format: '0', header: 'Amount' },
      { field: 'ifsc', header: 'IFSC' },
      { value: 'NEFT', header: 'Mode' },
      { field: 'name', header: 'Name' },
      { field: 'date', format: 'DD/MM/YYYY', header: 'Date' },
      { field: 'debit_account', header: 'Debit account' },
    ],
    header: true,
    delimiter: '|',
    extension: 'txt',
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      maker = await seedUser(c, school, `${s}-mk`, 'payroll_maker');
      checker = await seedUser(c, school, `${s}-ck`, 'payroll_checker');
      for (const [code, ifsc, account] of [
        ['A', 'ABCD0001234', '111100001111'],
        ['B', 'WXYZ0000777', '222200002222'],
        ['C', 'ABCD0005678', '333300003333'],
        ['D', null, null],
      ] as const)
        emp[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, joined_on, dob,
                                    secure, profile)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', '2020-01-01', '1985-05-05', $3::jsonb, $4::jsonb) RETURNING id::text`,
            [
              school.id,
              `${s}${code}`,
              JSON.stringify(account ? { bank_account_no: encryptField(account) } : {}),
              JSON.stringify(
                ifsc ? { bank_ifsc: ifsc, bank_name: `Bank ${ifsc.slice(0, 4)}` } : {},
              ),
            ],
          )
        ).rows[0]!.id;
      // D is paid in cash
      await c.query(
        `INSERT INTO payroll_profiles (employee_id, school_id, pay_mode) VALUES ($1, $2, 'CASH')`,
        [emp.D, school.id],
      );
      await c.query(
        `INSERT INTO staff_month_locks (school_id, month, locked) VALUES ($1, '2026-06-01', true)`,
        [school.id],
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
    for (const [code, amount] of [
      ['A', 30000],
      ['B', 20000],
      ['C', 25000],
      ['D', 12000],
    ] as const)
      await q(
        `INSERT INTO payroll_structures (school_id, employee_id, pay_head_id, amount, effective_from, status)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active')`,
        [school.id, emp[code], basic, amount],
      );
    await call(checker, 'POST', '/payroll/inputs/attendance/mark-present', {
      month: '2026-06',
      reason: 'Full month',
      dryRun: false,
    });
    await call(checker, 'POST', '/payroll/inputs/attendance/finalise', { month: '2026-06' });
    runId = (
      await call(maker, 'POST', '/payroll/runs', { month: '2026-06', runType: 'REGULAR' })
    ).json().id;
    for (let i = 0; i < 10; i += 1)
      if ((await call(maker, 'POST', `/payroll/runs/${runId}/process`)).json().done) break;
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/approve`)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the school’s bank accounts: a layout each, set by the payroll admin, tried first', async () => {
    expect((await call(maker, 'GET', '/payroll/bank/accounts')).statusCode).toBe(403);
    const tried = await call(admin, 'POST', '/payroll/bank/layout/check', { layout });
    expect(tried.statusCode).toBe(201);
    expect(tried.json().text.split('\n')).toEqual([
      'Beneficiary account|Amount|IFSC|Mode|Name|Date|Debit account',
      '000000001234|30160|ABCD0001234|NEFT|Employee One|31/07/2026|000000009999',
      '000000005678|18251|ABCD0005678|NEFT|Employee, Two|31/07/2026|000000009999',
    ]);
    // a format only a date or an amount takes
    expect(
      (
        await call(admin, 'POST', '/payroll/bank/layout/check', {
          layout: { columns: [{ field: 'name', format: '0' }] },
        })
      ).statusCode,
    ).toBe(400);
    const account = {
      bankCode: 'abcd',
      bankName: 'Bank ABCD',
      branch: 'Main branch',
      accountNo: '900000000001',
      fileFormat: 'CUSTOM_CSV',
      layout,
    };
    expect((await call(checker, 'POST', '/payroll/bank/accounts', account)).statusCode).toBe(403);
    expect(
      (await call(admin, 'POST', '/payroll/bank/accounts', { ...account, layout: null }))
        .statusCode,
    ).toBe(400);
    expect((await call(admin, 'POST', '/payroll/bank/accounts', account)).statusCode).toBe(201);
    expect((await call(admin, 'POST', '/payroll/bank/accounts', account)).statusCode).toBe(409);
    const list = (await call(checker, 'GET', '/payroll/bank/accounts')).json();
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ bankCode: 'ABCD', fileFormat: 'CUSTOM_CSV' });
    expect(list.can.manage).toBe(false);
  });

  it('a file from the approved run is provisional: cancelled before upload; nothing changes under it', async () => {
    expect((await call(maker, 'GET', `/payroll/runs/${runId}/bank`)).statusCode).toBe(403);
    const pre = (await call(checker, 'GET', `/payroll/runs/${runId}/bank`)).json();
    expect(pre.run.provisional).toBe(true);
    expect(
      pre.groups.map((g: { bankCode: string; count: number; accountSet: boolean }) => [
        g.bankCode,
        g.count,
        g.accountSet,
      ]),
    ).toEqual([
      ['ABCD', 2, true],
      ['WXYZ', 1, false],
    ]);
    expect(pre.cash.map((r: { code: string }) => r.code)).toEqual([`${s}D`]);
    const made = await call(checker, 'POST', `/payroll/runs/${runId}/bank`, {
      bankCode: 'ABCD',
      valueDate: '2026-07-01',
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ seq: 1, txnCount: 2, provisional: true });
    expect(made.json().message).toContain('lock it before the file goes to the bank');
    const batch = made.json().id as string;
    // one live file a salary
    expect(
      (await call(checker, 'POST', `/payroll/runs/${runId}/bank`, { bankCode: 'ABCD' })).statusCode,
    ).toBe(409);
    const f = (await call(checker, 'GET', `/payroll/bank/batches/${batch}/file`)).json();
    expect(f.filename).toBe('BANK_2026_06_REGULAR1_1.txt');
    const lines = text(f).split('\n');
    expect(lines[0]).toBe('Beneficiary account|Amount|IFSC|Mode|Name|Date|Debit account');
    expect(lines.slice(1).map((l) => l.split('|')[0])).toEqual(['111100001111', '333300003333']);
    expect(lines[1]).toContain('|01/07/2026|900000000001');
    // a re-download is the same file
    expect((await call(checker, 'GET', `/payroll/bank/batches/${batch}/file`)).json().base64).toBe(
      f.base64,
    );
    // the bank letter, Excel and PDF
    const pdf = (await call(checker, 'GET', `/payroll/bank/batches/${batch}/file?as=pdf`)).json();
    expect(pdf.filename).toBe('BANK_LETTER_2026_06_REGULAR1_1.pdf');
    expect(Buffer.from(pdf.base64, 'base64').toString('latin1').startsWith('%PDF')).toBe(true);
    expect(
      (await call(checker, 'GET', `/payroll/bank/batches/${batch}/file?as=letter`)).json()
        .contentType,
    ).toContain('spreadsheetml');
    // not to the bank while the run is only approved
    expect(
      (await call(checker, 'POST', `/payroll/bank/batches/${batch}/uploaded`)).statusCode,
    ).toBe(409);
    // the salary in the file is not held; the run is not unapproved under it
    const a = await recordOf('A');
    expect(
      (
        await call(checker, 'POST', `/payroll/runs/${runId}/records/${a.id as string}/hold`, {
          reason: 'Query on account',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await call(admin, 'POST', `/payroll/runs/${runId}/unapprove`, { comment: 'Recheck' }))
        .statusCode,
    ).toBe(409);
    // cancelled before upload, with a reason: the salaries can go in a new file
    expect(
      (await call(checker, 'POST', `/payroll/bank/batches/${batch}/cancel`, { reason: 'Wrong' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(checker, 'POST', `/payroll/bank/batches/${batch}/cancel`, {
          reason: 'Value date was wrong',
        })
      ).statusCode,
    ).toBe(201);
    expect((await call(checker, 'GET', `/payroll/bank/batches/${batch}/file`)).statusCode).toBe(
      409,
    );
    const again = (await call(checker, 'GET', `/payroll/runs/${runId}/bank`)).json();
    expect(again.groups.find((g: { bankCode: string }) => g.bankCode === 'ABCD').count).toBe(2);
    expect((await call(checker, 'POST', `/payroll/runs/${runId}/lock`)).statusCode).toBe(201);
  });

  it('after the lock: confirmed with the UTR; a returned payment paid again to the corrected account; the run paid', async () => {
    const abcd = (
      await call(checker, 'POST', `/payroll/runs/${runId}/bank`, { bankCode: 'ABCD' })
    ).json();
    expect(abcd).toMatchObject({ seq: 2, txnCount: 2, provisional: false });
    const wxyz = (
      await call(checker, 'POST', `/payroll/runs/${runId}/bank`, { bankCode: 'WXYZ' })
    ).json();
    // no account of its own: the generic file
    const g = (
      await call(checker, 'GET', `/payroll/bank/batches/${wxyz.id as string}/file`)
    ).json();
    expect(g.filename).toBe('BANK_2026_06_REGULAR1_3.csv');
    expect(text(g)).toMatch(
      new RegExp(`^${s}B E2E,222200002222,WXYZ0000777,\\d+\\.\\d{2},SALARY 2026-06$`),
    );
    // the bank has the file: the run is not reopened
    expect(
      (await call(admin, 'POST', `/payroll/runs/${runId}/reopen`, { comment: 'Too late now' }))
        .statusCode,
    ).toBe(409);
    const id = abcd.id as string;
    expect(
      (await call(checker, 'POST', `/payroll/bank/batches/${id}/confirm`, { utr: 'UTR0001' }))
        .statusCode,
    ).toBe(409);
    expect((await call(checker, 'POST', `/payroll/bank/batches/${id}/uploaded`)).statusCode).toBe(
      201,
    );
    expect(
      (await call(checker, 'POST', `/payroll/bank/batches/${id}/confirm`, { utr: '' })).statusCode,
    ).toBe(400);
    const ok = (
      await call(checker, 'POST', `/payroll/bank/batches/${id}/confirm`, { utr: 'UTR0001' })
    ).json();
    expect(ok).toMatchObject({ paid: 2, runPaid: false });
    expect(await recordOf('A')).toMatchObject({ status: 'PAID' });
    // a line of a file not yet uploaded is not "returned": the file is cancelled instead
    const wLines = (
      await call(checker, 'GET', `/payroll/bank/batches/${wxyz.id as string}`)
    ).json();
    expect(
      (
        await call(checker, 'POST', `/payroll/bank/lines/${wLines.lines[0].id as string}/reject`, {
          reason: 'Account closed',
        })
      ).statusCode,
    ).toBe(409);
    await call(checker, 'POST', `/payroll/bank/batches/${wxyz.id as string}/uploaded`);
    await call(checker, 'POST', `/payroll/bank/batches/${wxyz.id as string}/confirm`, {
      utr: 'UTR0002',
    });
    // the cash salary: only a checker, in its own mode, with the voucher number
    const d = await recordOf('D');
    const paidUrl = `/payroll/runs/${runId}/records/${d.id as string}/paid`;
    expect(
      (await call(maker, 'POST', paidUrl, { mode: 'CASH', reference: 'V-12' })).statusCode,
    ).toBe(403);
    expect(
      (await call(checker, 'POST', paidUrl, { mode: 'CHEQUE', reference: 'V-12' })).statusCode,
    ).toBe(409);
    expect(
      (await call(checker, 'POST', paidUrl, { mode: 'CASH', reference: 'V-12' })).json(),
    ).toMatchObject({ runPaid: true });
    expect((await call(checker, 'GET', `/payroll/runs/${runId}`)).json().run.stage).toBe('PAID');
    // the bank returns A's payment: held, paid no more; the run is open again
    const lines = (await call(checker, 'GET', `/payroll/bank/batches/${id}`)).json().lines;
    const aLine = lines.find((l: { code: string }) => l.code === `${s}A`);
    const back = await call(checker, 'POST', `/payroll/bank/lines/${aLine.id as string}/reject`, {
      reason: 'Account closed',
    });
    expect(back.statusCode).toBe(201);
    const a = await recordOf('A');
    expect(a.status).toBe('HELD');
    expect((await call(checker, 'GET', `/payroll/runs/${runId}`)).json().run.stage).toBe('LOCKED');
    // the account corrected on the employee record, the salary released: the next file pays the new account
    await q(
      `UPDATE employees SET secure = $2::jsonb, profile = profile || '{"bank_ifsc": "ABCD0009999"}'::jsonb WHERE id = $1`,
      [emp.A, JSON.stringify({ bank_account_no: encryptField('444400004444') })],
    );
    expect(
      (
        await call(checker, 'POST', `/payroll/runs/${runId}/records/${a.id as string}/release`, {
          reason: 'Account corrected',
        })
      ).statusCode,
    ).toBe(201);
    const pre = (await call(checker, 'GET', `/payroll/runs/${runId}/bank`)).json();
    expect(pre.payable).toHaveLength(1);
    expect(pre.payable[0]).toMatchObject({ code: `${s}A`, reissue: true, ifsc: 'ABCD0009999' });
    const re = (
      await call(checker, 'POST', `/payroll/runs/${runId}/bank`, { bankCode: 'ABCD' })
    ).json();
    expect(re.txnCount).toBe(1);
    const rf = text(
      (await call(checker, 'GET', `/payroll/bank/batches/${re.id as string}/file`)).json(),
    );
    expect(rf.split('\n')[1]!.startsWith('444400004444|')).toBe(true);
    // the first file is as it was sent
    const first = text((await call(checker, 'GET', `/payroll/bank/batches/${id}/file`)).json());
    expect(first).toContain('111100001111|');
    await call(checker, 'POST', `/payroll/bank/batches/${re.id as string}/uploaded`);
    expect(
      (
        await call(checker, 'POST', `/payroll/bank/batches/${re.id as string}/confirm`, {
          utr: 'UTR0003',
        })
      ).json(),
    ).toMatchObject({ paid: 1, runPaid: true });
    const paid = await q<{ payment_ref: string; bank_ifsc: string }>(
      `SELECT payment_ref, bank_ifsc FROM payroll_records WHERE id = $1`,
      [a.id],
    );
    expect(paid[0]).toMatchObject({ payment_ref: 'UTR0003', bank_ifsc: 'ABCD0009999' });
    const audit = await q<{ action: string }>(
      `SELECT action FROM audit_logs WHERE school_id = $1 AND action LIKE 'payroll.bank.%' ORDER BY id`,
      [school.id],
    );
    expect(audit.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'payroll.bank.generate',
        'payroll.bank.download',
        'payroll.bank.return',
      ]),
    );
  });
});
