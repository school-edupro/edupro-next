/**
 * Fee changes that wait for approval (0101): late-fee waiver, a receipt moved to a sibling, receipt and
 * settlement date corrections (one, and many from Excel), and bulk collection from Excel posted only
 * after the school admin approves.
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

async function sheet(headers: string[], rows: Array<Array<string | number>>): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

interface Ledger {
  instalments: Array<{
    balance: string;
    lateFee: { amount: string; overridden: boolean; periodId: string };
  }>;
  totals: { balance: string };
  payments: Array<{
    id: string;
    receiptNo: string | null;
    amount: string;
    status: string;
    receivedOn: string;
  }>;
}

describe('fee changes that wait for approval (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  const students: Record<'a' | 'b' | 'c', string> = {} as never;

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const ledgerOf = async (id: string) =>
    (
      await inject({ method: 'GET', url: `/fees/students/${id}/ledger`, headers: h() })
    ).json() as Ledger;
  const receipt = (json: Record<string, unknown>) =>
    inject({ method: 'POST', url: '/payments/receipts', headers: h(accountant), json });
  const ask = (json: Record<string, unknown>, u: SeededUser = accountant) =>
    inject({ method: 'POST', url: '/fees/requests', headers: h(u), json });
  const decide = (id: string, outcome: 'approved' | 'rejected', u: SeededUser = admin) =>
    inject({
      method: 'POST',
      url: `/fees/requests/${id}/decide`,
      headers: h(u),
      json: { outcome },
    });

  beforeAll(async () => {
    const s = stamp('FRQ');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition fee', sortOrder: 1 },
    });
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    await inject({
      method: 'PUT',
      url: `/fees/structures/${cls.json().id}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [{ headId: head.json().id, amount: 1000, frequency: 'monthly' }],
      },
    });
    await inject({
      method: 'PUT',
      url: '/platform/settings/fees.late_fee_mode',
      headers: h(),
      json: { value: 'slab' },
    });
    const periods = (await inject({ method: 'GET', url: '/fees/periods', headers: h() })).json()
      .data as Array<{ id: string; sequence: number }>;
    await inject({
      method: 'PUT',
      url: `/fees/periods/${periods.find((p) => p.sequence === 1)!.id}/late-fee`,
      headers: h(),
      json: { lateFeeAmount: 200, slabs: [] },
    });
    let roll = 1;
    for (const id of ['a', 'b', 'c'] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `FRQ-${id}`,
          firstName: id,
          lastName: 'Request',
          dob: '2015-01-01',
          admittedOn: '2025-04-05',
          enrolment: { classSectionId: sec.json().id, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      students[id] = r.json().id;
      roll += 1;
      await inject({
        method: 'POST',
        url: `/fees/students/${students[id]}/demands/generate`,
        headers: h(),
      });
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('a late-fee waiver by the accounts desk waits for the approver', async () => {
    const before = await ledgerOf(students.a);
    expect(before.instalments[0]!.lateFee.amount).toBe('200.00');
    const periodId = before.instalments[0]!.lateFee.periodId;
    const direct = await inject({
      method: 'PUT',
      url: `/fees/students/${students.a}/late-fee`,
      headers: h(accountant),
      json: { periodId, amount: 0, reason: 'trying it directly' },
    });
    expect(direct.statusCode).toBe(403);
    expect(direct.json().type).toBe('fees.approval_required');
    expect(
      (await ask({ kind: 'late_fee', periodId, amount: 50, reason: 'x' }, teacher)).statusCode,
    ).toBe(403);
    const req = await ask({
      kind: 'late_fee',
      admissionNo: 'frq-a',
      periodId,
      amount: 50,
      reason: 'Father hospitalised in April',
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ kind: 'late_fee', status: 'pending', amount: '50.00' });
    const again = await ask({
      kind: 'late_fee',
      studentId: students.a,
      periodId,
      amount: 0,
      reason: 'again',
    });
    expect(again.statusCode).toBe(409);
    expect((await ledgerOf(students.a)).instalments[0]!.lateFee.amount).toBe('200.00');
    expect((await decide(req.json().id, 'approved', accountant)).statusCode).toBe(403);
    const ok = await decide(req.json().id, 'approved');
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('approved');
    expect((await ledgerOf(students.a)).instalments[0]!.lateFee).toMatchObject({
      amount: '50.00',
      overridden: true,
    });
    expect((await decide(req.json().id, 'rejected')).statusCode).toBe(409);
  });

  it('a receipt paid into the wrong child moves to the sibling after approval', async () => {
    const wrong = await receipt({
      studentId: students.a,
      amount: 1000,
      mode: 'upi',
      reference: 'UTR-77',
    });
    expect(wrong.statusCode).toBe(201);
    const balanceA = (await ledgerOf(students.a)).totals.balance;
    const req = await ask({
      kind: 'transfer',
      receiptNo: wrong.json().receiptNo,
      toAdmissionNo: 'FRQ-b',
      reason: 'Parent paid twice for A; this one was meant for B',
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ kind: 'transfer', toAdmissionNo: 'FRQ-b' });
    const same = await ask({
      kind: 'transfer',
      receiptNo: wrong.json().receiptNo,
      toAdmissionNo: 'FRQ-a',
      reason: 'same pupil',
    });
    expect(same.statusCode).toBe(422);
    const ok = await decide(req.json().id, 'approved');
    expect(ok.statusCode).toBe(201);
    expect(ok.json().result.newReceiptNo).toBeTruthy();
    const a = await ledgerOf(students.a);
    expect(a.payments.find((p) => p.id === wrong.json().paymentId)!.status).toBe('reversed');
    expect(Number(a.totals.balance)).toBeGreaterThan(Number(balanceA));
    const b = await ledgerOf(students.b);
    expect(b.payments).toHaveLength(1);
    expect(b.payments[0]).toMatchObject({ amount: '1000.00', status: 'posted' });
    expect(b.payments[0]!.receiptNo).toBe(ok.json().result.newReceiptNo);
  });

  it('a receipt date and a settlement date are corrected after approval, within the financial year', async () => {
    const r = await receipt({
      studentId: students.c,
      amount: 500,
      mode: 'cash',
      receivedOn: '2026-10-05',
    });
    expect(r.statusCode).toBe(201);
    const other = await ask({
      kind: 'date_change',
      receiptNo: r.json().receiptNo,
      newReceivedOn: '2026-03-01',
      reason: 'wrong year',
    });
    expect(other.statusCode).toBe(422);
    const future = await ask({
      kind: 'date_change',
      receiptNo: r.json().receiptNo,
      newReceivedOn: '2027-01-01',
      reason: 'future',
    });
    expect(future.statusCode).toBe(422);
    const req = await ask({
      kind: 'date_change',
      receiptNo: r.json().receiptNo,
      newReceivedOn: '2026-10-01',
      newClearedOn: '2026-10-06',
      reason: 'Entered on the 5th, received on the 1st',
    });
    expect(req.statusCode).toBe(201);
    expect((await ledgerOf(students.c)).payments[0]!.receivedOn).toBe('2026-10-05');
    expect((await decide(req.json().id, 'approved')).statusCode).toBe(201);
    expect((await ledgerOf(students.c)).payments[0]!.receivedOn).toBe('2026-10-01');
    const list = await inject({
      method: 'GET',
      url: '/fees/requests?kind=date_change',
      headers: h(accountant),
    });
    expect(list.json().data[0]).toMatchObject({ status: 'approved', newClearedOn: '2026-10-06' });
  });

  it('settlement dates from Excel: good rows wait as one batch, bad rows come back with the reason', async () => {
    const fmt = await inject({
      method: 'GET',
      url: '/fees/requests/settlement-format.xlsx',
      headers: h(accountant),
    });
    expect(fmt.statusCode).toBe(200);
    const c = await ledgerOf(students.c);
    const b = await ledgerOf(students.b);
    const file = await sheet(
      ['Receipt no.', 'Settlement date', 'New receipt date'],
      [
        [c.payments[0]!.receiptNo!, '07-10-2026', ''],
        [b.payments[0]!.receiptNo!, '2026-10-08', ''],
        ['NO-SUCH-RECEIPT', '07-10-2026', ''],
        [c.payments[0]!.receiptNo!, 'someday', ''],
      ],
    );
    const up = await inject({
      method: 'POST',
      url: '/fees/requests/settlement-upload',
      headers: h(accountant),
      json: { fileBase64: file, reason: 'Bank statement of the first week' },
    });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ rows: 4, good: 2 });
    expect(up.json().bad).toHaveLength(2);
    const batch = await inject({
      method: 'POST',
      url: `/fees/requests/batches/${up.json().batchId}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(batch.statusCode).toBe(201);
    expect(batch.json().decided).toBe(2);
    const cleared = await withMigrator((m) =>
      m.query<{ cleared_on: string }>(
        `SELECT cleared_on::text FROM fee_payments WHERE receipt_no = $1 AND school_id = $2`,
        [c.payments[0]!.receiptNo, school.id],
      ),
    );
    expect(cleared.rows[0]!.cleared_on).toBe('2026-10-07');
  });

  it('collection from Excel is checked, sent for approval, and posted as receipts only then', async () => {
    const headers = [
      'Admission no.',
      'Amount',
      'Mode',
      'Date',
      'Fee type',
      'Reference no.',
      'Cheque / DD no.',
      'Cheque date',
      'Bank',
      'Remarks',
    ];
    const bad = await inject({
      method: 'POST',
      url: '/fees/requests/collections',
      headers: h(accountant),
      json: {
        fileName: 'bank.xlsx',
        fileBase64: await sheet(headers, [
          ['FRQ-a', 1000, 'cash', '06-10-2026', '', '', '', '', '', ''],
          ['NOBODY', 500, 'cash', '06-10-2026', '', '', '', '', '', ''],
          ['FRQ-c', 700, 'cheque', '06-10-2026', '', '', '', '', '', ''],
        ]),
      },
    });
    expect(bad.statusCode).toBe(201);
    expect(bad.json()).toMatchObject({ status: 'draft', totalRows: 3, goodRows: 1 });
    expect(bad.json().rows[1].error).toContain('not found');
    expect(bad.json().rows[2].error).toContain('cheque');
    const refuse = await inject({
      method: 'POST',
      url: `/fees/requests/collections/${bad.json().id}/submit`,
      headers: h(accountant),
      json: { action: 'submit', reason: 'bank file' },
    });
    expect(refuse.statusCode).toBe(409);
    const good = await inject({
      method: 'POST',
      url: '/fees/requests/collections',
      headers: h(accountant),
      json: {
        fileName: 'bank.xlsx',
        fileBase64: await sheet(headers, [
          ['FRQ-a', 1000, 'cash', '06-10-2026', '', '', '', '', '', 'Bank counter'],
          ['FRQ-c', 700, 'cheque', '06-10-2026', 'regular', '', '112233', '05-10-2026', 'SBI', ''],
        ]),
      },
    });
    expect(good.json()).toMatchObject({ totalRows: 2, goodRows: 2, totalAmount: '1700.00' });
    const before = (await ledgerOf(students.c)).payments.length;
    const sent = await inject({
      method: 'POST',
      url: `/fees/requests/collections/${good.json().id}/submit`,
      headers: h(accountant),
      json: { action: 'submit', reason: 'Bank collection of 6 October' },
    });
    expect(sent.json().status).toBe('pending');
    expect((await ledgerOf(students.c)).payments).toHaveLength(before);
    const denied = await inject({
      method: 'POST',
      url: `/fees/requests/collections/${good.json().id}/decide`,
      headers: h(accountant),
      json: { outcome: 'approved' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await inject({
      method: 'POST',
      url: `/fees/requests/collections/${good.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('posted');
    expect(ok.json().receipts).toHaveLength(2);
    const after = await ledgerOf(students.c);
    expect(after.payments).toHaveLength(before + 1);
    expect(after.payments.some((p) => p.amount === '700.00' && p.receivedOn === '2026-10-06')).toBe(
      true,
    );
    const twice = await inject({
      method: 'POST',
      url: `/fees/requests/collections/${good.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(twice.statusCode).toBe(409);
  });
});
