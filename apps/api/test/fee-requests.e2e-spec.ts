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

  it('a late fee already paid is adjusted in fee after approval; the receipt keeps its number', async () => {
    const mk = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'FRQ-late',
        firstName: 'late',
        lastName: 'Request',
        dob: '2015-01-01',
        admittedOn: '2025-04-05',
        enrolment: {
          classSectionId: await withMigrator(async (c) => {
            const r = await c.query<{ id: string }>(
              `SELECT class_section_id::text AS id FROM enrolments WHERE student_id = $1 LIMIT 1`,
              [students.a],
            );
            return r.rows[0]!.id;
          }),
          rollNo: 44,
        },
      },
    });
    expect(mk.statusCode).toBe(201);
    const sid = mk.json().id as string;
    await inject({ method: 'POST', url: `/fees/students/${sid}/demands/generate`, headers: h() });
    // April: fee 1000 and late fee 200; the parent pays both
    const paid = await receipt({ studentId: sid, amount: 1200, mode: 'cash' });
    expect(paid.statusCode).toBe(201);
    expect(paid.json()).toMatchObject({ lateFee: '200.00' });
    const tooMuch = await ask({
      kind: 'late_fee_to_fee',
      receiptNo: paid.json().receiptNo,
      amount: 500,
      reason: 'too much',
    });
    expect(tooMuch.statusCode).toBe(409);
    const req = await ask({
      kind: 'late_fee_to_fee',
      receiptNo: paid.json().receiptNo,
      amount: 200,
      reason: 'Principal agreed to take the late fee as fee',
    });
    expect(req.statusCode).toBe(201);
    const ok = await decide(req.json().id, 'approved');
    expect(ok.statusCode).toBe(201);
    expect(ok.json().result).toMatchObject({ movedToFee: '200.00', keptAsAdvance: '0.00' });
    const view = await inject({
      method: 'GET',
      url: `/fees/payments/${paid.json().paymentId}/receipt-view`,
      headers: h(),
    });
    expect(view.json()).toMatchObject({
      receiptNo: paid.json().receiptNo,
      amount: '1200.00',
      lateFee: '0.00',
    });
    const l = await ledgerOf(sid);
    // April is settled with no late fee asked again; 200 went to May
    expect(l.instalments[0]).toMatchObject({ balance: '0.00' });
    expect(l.instalments[0]!.lateFee).toMatchObject({ amount: '0.00', overridden: true });
    expect(l.instalments[1]!.balance).toBe('800.00');
  });

  it('a refund names the fee heads it gives back; the fee is cancelled or stays due; a voucher is numbered', async () => {
    const sectionId = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT class_section_id::text AS id FROM enrolments WHERE student_id = $1 LIMIT 1`,
        [students.a],
      );
      return r.rows[0]!.id;
    });
    const mk = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'FRQ-refund',
        firstName: 'refund',
        lastName: 'Request',
        dob: '2015-01-01',
        admittedOn: '2025-04-05',
        enrolment: { classSectionId: sectionId, rollNo: 45 },
      },
    });
    const sid = mk.json().id as string;
    await inject({ method: 'POST', url: `/fees/students/${sid}/demands/generate`, headers: h() });
    // April 1000 + its late fee 200, May 1000, June 1000
    const paid = await receipt({ studentId: sid, amount: 3200, mode: 'cash' });
    expect(paid.statusCode).toBe(201);
    const can = (
      await inject({
        method: 'GET',
        url: `/payments/receipts/${paid.json().paymentId}/refundable`,
        headers: h(),
      })
    ).json() as {
      lateFee: string;
      advance: string;
      lines: Array<{ demandId: string; sequence: number; paid: string }>;
    };
    expect(can.lines.map((l) => l.sequence)).toEqual([1, 2, 3]);
    expect(can.lateFee).toBe('200.00');
    const line = (seq: number) => can.lines.find((l) => l.sequence === seq)!;
    const ask2 = (json: Record<string, unknown>) =>
      inject({
        method: 'POST',
        url: `/payments/receipts/${paid.json().paymentId}/refunds`,
        headers: h(accountant),
        json,
      });
    const tooMuch = await ask2({
      lines: [{ part: 'fee', demandId: line(3).demandId, amount: 5000 }],
      mode: 'bank',
      reason: 'too much',
    });
    expect(tooMuch.statusCode).toBe(409);
    // June is given back and cancelled: the pupil stops a service
    const req = await ask2({
      lines: [{ part: 'fee', demandId: line(3).demandId, amount: 1000 }],
      feeAction: 'cancel',
      mode: 'bank',
      reference: 'UTR-RF-1',
      reason: 'Service stopped from June',
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({
      status: 'requested',
      amount: '1000.00',
      feeAction: 'cancel',
    });
    const decideRefund = (id: string) =>
      inject({
        method: 'POST',
        url: `/payments/refunds/${id}/decide`,
        headers: h(),
        json: { outcome: 'approved' },
      });
    const ok = await decideRefund(req.json().id);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('paid');
    expect(ok.json().voucherNo).toMatch(/^RF\/.+\/000001$/);
    let l = await ledgerOf(sid);
    expect(l.instalments[2]).toMatchObject({ balance: '0.00' }); // June: not asked again
    expect(l.payments[0]).toMatchObject({ status: 'partly_refunded' });
    // May is given back and stays due: a wrong payment
    const req2 = await ask2({
      lines: [{ part: 'fee', demandId: line(2).demandId, amount: 1000 }],
      feeAction: 'due',
      mode: 'cash',
      reason: 'Paid twice by mistake',
    });
    expect(req2.statusCode).toBe(201);
    expect((await decideRefund(req2.json().id)).json().voucherNo).toMatch(/000002$/);
    l = await ledgerOf(sid);
    expect(l.instalments[1]).toMatchObject({ balance: '1000.00' });
    // June was cancelled by mistake: the school makes it due again; the refund itself stays
    const dueAgain = await inject({
      method: 'POST',
      url: `/payments/refunds/${req.json().id}/fee-due`,
      headers: h(),
      json: { reason: 'Sent with the wrong choice' },
    });
    expect(dueAgain.statusCode).toBe(201);
    expect(dueAgain.json()).toMatchObject({ status: 'paid', feeAction: 'due' });
    expect((await ledgerOf(sid)).instalments[2]).toMatchObject({ balance: '1000.00' });
    const twice = await inject({
      method: 'POST',
      url: `/payments/refunds/${req.json().id}/fee-due`,
      headers: h(),
      json: { reason: 'again' },
    });
    expect(twice.statusCode).toBe(409);
    const voucher = await inject({
      method: 'GET',
      url: `/payments/refunds/${req.json().id}/voucher`,
      headers: h(),
    });
    expect(voucher.json()).toMatchObject({ amount: '1000.00', feeAction: 'due', mode: 'bank' });
    expect(voucher.json().lines).toHaveLength(1);
    const file = await inject({
      method: 'GET',
      url: `/payments/refunds/${req.json().id}/voucher-file`,
      headers: h(),
    });
    expect(file.json().base64.startsWith('JVBER')).toBe(true);
  });

  it("last year's advance is refunded without a receipt and the advance reduces", async () => {
    const sectionId = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT class_section_id::text AS id FROM enrolments WHERE student_id = $1 LIMIT 1`,
        [students.a],
      );
      return r.rows[0]!.id;
    });
    const mk = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'FRQ-adv',
        firstName: 'adv',
        lastName: 'Request',
        dob: '2015-01-01',
        admittedOn: '2025-04-05',
        enrolment: { classSectionId: sectionId, rollNo: 46 },
      },
    });
    const sid = mk.json().id as string;
    const opb = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'OPB', name: 'Opening balance', kind: 'opening_balance', sortOrder: 0 },
    });
    expect(opb.statusCode).toBe(201);
    const prof = await inject({
      method: 'PUT',
      url: `/fees/students/${sid}/profile`,
      headers: h(),
      json: { feeGroup: 'general', openingBalance: -1500 },
    });
    expect(prof.statusCode).toBe(200);
    const gen = await inject({
      method: 'POST',
      url: `/fees/students/${sid}/demands/generate`,
      headers: h(),
    });
    expect(gen.statusCode).toBe(201);
    const left = () =>
      inject({ method: 'GET', url: `/payments/refunds/opening-advance/${sid}`, headers: h() });
    expect((await left()).json()).toMatchObject({ available: '1500.00', open: false });
    const over = await inject({
      method: 'POST',
      url: '/payments/refunds/opening-advance',
      headers: h(accountant),
      json: { studentId: sid, amount: 2000, mode: 'bank', reason: 'too much' },
    });
    expect(over.statusCode).toBe(409);
    const req = await inject({
      method: 'POST',
      url: '/payments/refunds/opening-advance',
      headers: h(accountant),
      json: {
        studentId: sid,
        amount: 500,
        mode: 'cheque',
        reference: '000123',
        reason: 'Parent asked',
      },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ kind: 'opening_advance', paymentId: null });
    expect((await left()).json().open).toBe(true);
    const ok = await inject({
      method: 'POST',
      url: `/payments/refunds/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'paid' });
    expect(ok.json().voucherNo).toMatch(/^RF\//);
    expect((await left()).json()).toMatchObject({ available: '1000.00', open: false });
    const after = await inject({
      method: 'GET',
      url: `/fees/students/${sid}/profile`,
      headers: h(),
    });
    expect(Number(after.json().openingBalance)).toBe(-1000);
  });

  it('opening balances from Excel are checked, approved, then written to the pupils and their bills', async () => {
    const classId = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT cs.class_id::text AS id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id WHERE e.student_id = $1 LIMIT 1`,
        [students.a],
      );
      return r.rows[0]!.id;
    });
    const format = await inject({
      method: 'GET',
      url: `/fees/opening/format.xlsx?classId=${classId}`,
      headers: h(accountant),
    });
    expect(format.statusCode).toBe(200);
    expect(format.headers['content-type']).toContain('spreadsheetml');
    const file = await sheet(
      ['Admission no.', 'Amount', 'Dr / Cr'],
      [
        ['FRQ-a', 500, 'Dr'],
        ['FRQ-b', 300, 'Cr'],
        ['NOBODY', 100, 'Dr'],
        ['FRQ-c', 100, ''],
        ['FRQ-a', 10, 'Dr'],
      ],
    );
    const up = await inject({
      method: 'POST',
      url: '/fees/opening/uploads',
      headers: h(accountant),
      json: { fileBase64: file, fileName: 'opening.xlsx' },
    });
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({
      status: 'draft',
      totalRows: 5,
      goodRows: 2,
      totalDr: '500.00',
      totalCr: '300.00',
    });
    const errors = (up.json().rows as Array<{ admissionNo: string; error: string | null }>)
      .filter((r) => r.error)
      .map((r) => r.error);
    expect(errors).toEqual([
      'No pupil with this admission number',
      'Choose Dr (dues) or Cr (advance)',
      'The pupil is in the file twice',
    ]);
    const openingOf = async (id: string) =>
      Number(
        (await inject({ method: 'GET', url: `/fees/students/${id}/profile`, headers: h() })).json()
          .openingBalance,
      );
    const beforeB = await openingOf(students.b);
    const noReason = await inject({
      method: 'POST',
      url: `/fees/opening/uploads/${up.json().id}/submit`,
      headers: h(accountant),
      json: { action: 'submit' },
    });
    expect(noReason.statusCode).toBe(422);
    const sent = await inject({
      method: 'POST',
      url: `/fees/opening/uploads/${up.json().id}/submit`,
      headers: h(accountant),
      json: { action: 'submit', reason: 'Figures from the old software' },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().status).toBe('pending');
    expect(await openingOf(students.b)).toBe(beforeB); // nothing until approved
    const denied = await inject({
      method: 'POST',
      url: `/fees/opening/uploads/${up.json().id}/decide`,
      headers: h(accountant),
      json: { outcome: 'approved' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await inject({
      method: 'POST',
      url: `/fees/opening/uploads/${up.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'applied' });
    expect(ok.json().result).toMatchObject({ applied: 2 });
    expect(await openingOf(students.a)).toBe(500);
    expect(await openingOf(students.b)).toBe(-300);
  });

  it('the opening balance of one pupil changes through the fee change request, not directly', async () => {
    const direct = await inject({
      method: 'PUT',
      url: `/fees/students/${students.c}/profile`,
      headers: h(accountant),
      json: { feeGroup: 'general', openingBalance: 250 },
    });
    expect(direct.statusCode).toBe(403);
    const req = await inject({
      method: 'POST',
      url: `/fees/students/${students.c}/profile-changes`,
      headers: h(accountant),
      json: { openingBalance: 250, reason: 'Dues of last year found in the old register' },
    });
    expect(req.statusCode).toBe(201);
    const ok = await inject({
      method: 'POST',
      url: `/fees/profile-changes/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    const profile = await inject({
      method: 'GET',
      url: `/fees/students/${students.c}/profile`,
      headers: h(),
    });
    expect(Number(profile.json().openingBalance)).toBe(250);
  });

  it('a refund is kept as a draft, printed, changed, and only then sent for approval', async () => {
    const sectionId = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT class_section_id::text AS id FROM enrolments WHERE student_id = $1 LIMIT 1`,
        [students.a],
      );
      return r.rows[0]!.id;
    });
    const mk = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'FRQ-draft',
        firstName: 'draft',
        lastName: 'Request',
        dob: '2015-01-01',
        admittedOn: '2025-04-05',
        enrolment: { classSectionId: sectionId, rollNo: 47 },
      },
    });
    const sid = mk.json().id as string;
    await inject({ method: 'POST', url: `/fees/students/${sid}/demands/generate`, headers: h() });
    const paid = await receipt({ studentId: sid, amount: 2200, mode: 'cash' });
    const pid = paid.json().paymentId as string;
    const can = (
      await inject({ method: 'GET', url: `/payments/receipts/${pid}/refundable`, headers: h() })
    ).json() as { lines: Array<{ demandId: string; sequence: number }> };
    const may = can.lines.find((l) => l.sequence === 2)!;
    const save = (amount: number) =>
      inject({
        method: 'POST',
        url: `/payments/receipts/${pid}/refunds`,
        headers: h(accountant),
        json: {
          draft: true,
          lines: [{ part: 'fee', demandId: may.demandId, amount }],
          mode: 'bank',
          reason: 'Parent asked for May back',
        },
      });
    const first = await save(400);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      status: 'draft',
      amount: '400.00',
      workflowInstanceId: null,
    });
    // nothing on the receipt or the ledger changes for a draft, and the family does not see it
    let l = await ledgerOf(sid);
    expect(l.instalments[1]).toMatchObject({ balance: '0.00' });
    expect((l as unknown as { refunds: unknown[] }).refunds).toHaveLength(0);
    // saved again: the draft is replaced, not doubled
    const second = await save(600);
    expect(second.json()).toMatchObject({ status: 'draft', amount: '600.00' });
    const draft = await inject({
      method: 'GET',
      url: `/payments/receipts/${pid}/refund-draft`,
      headers: h(accountant),
    });
    expect(draft.json().draft).toMatchObject({ id: second.json().id, amount: '600.00' });
    const voucher = await inject({
      method: 'GET',
      url: `/payments/refunds/${second.json().id}/voucher`,
      headers: h(),
    });
    expect(voucher.json()).toMatchObject({ status: 'draft', amount: '600.00', voucherNo: null });
    // a draft cannot be approved
    const early = await inject({
      method: 'POST',
      url: `/payments/refunds/${second.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(early.statusCode).toBe(409);
    const sent = await inject({
      method: 'POST',
      url: `/payments/refunds/${second.json().id}/send`,
      headers: h(accountant),
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ status: 'requested', amount: '600.00' });
    const ok = await inject({
      method: 'POST',
      url: `/payments/refunds/${second.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.json()).toMatchObject({ status: 'paid' });
    l = await ledgerOf(sid);
    expect(l.instalments[1]).toMatchObject({ balance: '600.00' }); // stays due by default
    // another draft can be dropped
    const third = await save(100);
    const gone = await inject({
      method: 'POST',
      url: `/payments/refunds/${third.json().id}/discard`,
      headers: h(accountant),
    });
    expect(gone.statusCode).toBe(201);
    expect(
      (
        await inject({
          method: 'GET',
          url: `/payments/receipts/${pid}/refund-draft`,
          headers: h(accountant),
        })
      ).json().draft,
    ).toBeNull();
  });

  it('one refund for a pupil over three receipts: one draft, one approval, one voucher number', async () => {
    const sectionId = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT class_section_id::text AS id FROM enrolments WHERE student_id = $1 LIMIT 1`,
        [students.a],
      );
      return r.rows[0]!.id;
    });
    const mk = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'FRQ-pupil',
        firstName: 'pupil',
        lastName: 'Request',
        dob: '2015-01-01',
        admittedOn: '2025-04-05',
        enrolment: { classSectionId: sectionId, rollNo: 48 },
      },
    });
    const sid = mk.json().id as string;
    await inject({ method: 'POST', url: `/fees/students/${sid}/demands/generate`, headers: h() });
    const pids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const paid = await receipt({ studentId: sid, amount: 1100, mode: 'cash' });
      expect(paid.statusCode).toBe(201);
      pids.push(paid.json().paymentId as string);
    }
    interface Can {
      receipts: Array<{ paymentId: string; waiting: boolean }>;
      lines: Array<{ demandId: string; paid: string; receipts: string[] }>;
      advance: string;
      lateFee: string;
      draft: { id: string; amount: string; receipts: number } | null;
    }
    const canNow = async () =>
      (
        await inject({
          method: 'GET',
          url: `/payments/refunds/student/${sid}/refundable`,
          headers: h(accountant),
        })
      ).json() as Can;
    const can = await canNow();
    expect(can.receipts).toHaveLength(3);
    expect(can.draft).toBeNull();
    const feePaid = can.lines.reduce((a, l) => a + Number(l.paid), 0);
    expect(feePaid + Number(can.advance) + Number(can.lateFee)).toBeCloseTo(3300, 2);
    const save = (lines: Array<{ demandId: string; amount: number }>, all: boolean, draft = true) =>
      inject({
        method: 'POST',
        url: `/payments/refunds/student/${sid}`,
        headers: h(accountant),
        json: {
          draft,
          lines,
          lateFee: all ? Number(can.lateFee) : 0,
          advance: all ? Number(can.advance) : 0,
          mode: 'bank',
          reason: 'Family is moving; fee paid ahead goes back',
        },
      });
    // more than was paid on a line is refused
    const over = await save([{ demandId: can.lines[0]!.demandId, amount: 99999 }], false);
    expect(over.statusCode).toBe(409);
    expect(over.json().type).toBe('fees.refund_line_exceeds');
    // a small draft sits on one receipt only
    const small = await save([{ demandId: can.lines[0]!.demandId, amount: 100 }], false);
    expect(small.statusCode).toBe(201);
    expect(small.json()).toMatchObject({ status: 'draft', amount: '100.00' });
    expect((await canNow()).draft).toMatchObject({ amount: '100.00', receipts: 1 });
    // saved again with everything: the draft is replaced and spreads over the three receipts
    const full = await save(
      can.lines.map((l) => ({ demandId: l.demandId, amount: Number(l.paid) })),
      true,
    );
    expect(full.statusCode).toBe(201);
    const draft = (await canNow()).draft!;
    expect(draft).toMatchObject({ amount: '3300.00', receipts: 3 });
    const voucher = await inject({
      method: 'GET',
      url: `/payments/refunds/${draft.id}/voucher`,
      headers: h(),
    });
    expect(voucher.json()).toMatchObject({
      status: 'draft',
      amount: '3300.00',
      voucherNo: null,
      pupil: true,
    });
    // while the pupil draft is open, a receipt in it cannot get its own refund
    const single = await inject({
      method: 'POST',
      url: `/payments/receipts/${pids[0]}/refunds`,
      headers: h(accountant),
      json: { amount: 50, mode: 'cash', reason: 'single receipt refund' },
    });
    expect(single.statusCode).toBe(409);
    expect(single.json().type).toBe('fees.refund_in_pupil_draft');
    // nothing has changed in the books yet
    let l = await ledgerOf(sid);
    expect((l as unknown as { refunds: unknown[] }).refunds).toHaveLength(0);
    const sent = await inject({
      method: 'POST',
      url: `/payments/refunds/${draft.id}/send`,
      headers: h(accountant),
    });
    expect(sent.statusCode).toBe(201);
    const rows = async () =>
      (
        await inject({
          method: 'GET',
          url: `/payments/refunds?studentId=${sid}`,
          headers: h(),
        })
      ).json().data as Array<{
        id: string;
        status: string;
        voucherNo: string | null;
        batchId: string;
        amount: string;
      }>;
    let all = await rows();
    expect(all).toHaveLength(3);
    expect(new Set(all.map((r) => r.status))).toEqual(new Set(['requested']));
    expect(new Set(all.map((r) => r.batchId)).size).toBe(1);
    // the receipts wait: a second pupil refund finds nothing to use
    expect((await canNow()).receipts.every((r) => r.waiting)).toBe(true);
    // one approval decides the three together and they carry one voucher number
    const ok = await inject({
      method: 'POST',
      url: `/payments/refunds/${all[0]!.id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.json()).toMatchObject({ status: 'paid' });
    all = await rows();
    expect(new Set(all.map((r) => r.status))).toEqual(new Set(['paid']));
    const numbers = new Set(all.map((r) => r.voucherNo));
    expect(numbers.size).toBe(1);
    expect([...numbers][0]).toMatch(/^RF\//);
    expect(all.reduce((a, r) => a + Number(r.amount), 0)).toBeCloseTo(3300, 2);
    const paper = await inject({
      method: 'GET',
      url: `/payments/refunds/${all[0]!.id}/voucher`,
      headers: h(),
    });
    expect(paper.json()).toMatchObject({ amount: '3300.00', voucherNo: [...numbers][0] });
    // the fee stays due by default: what was paid is owed again
    l = await ledgerOf(sid);
    expect(Number(l.instalments[0]!.balance)).toBeGreaterThan(0);
    const after = await canNow();
    expect(after.lines).toHaveLength(0);
    // the register shows it as one refund over three receipts, and filters and files follow
    const reg = await inject({
      method: 'GET',
      url: '/payments/refunds/register?q=FRQ-pupil&kind=pupil&status=paid',
      headers: h(),
    });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().page.total).toBe(1);
    expect(reg.json().data[0]).toMatchObject({
      origin: 'pupil',
      parts: 3,
      amount: '3300.00',
      voucherNo: [...numbers][0],
    });
    expect(reg.json().data[0].receipts).toHaveLength(3);
    expect(reg.json().totals.paid).toBe('3300.00');
    expect(
      (
        await inject({
          method: 'GET',
          url: '/payments/refunds/register?q=FRQ-pupil&kind=receipt',
          headers: h(),
        })
      ).json().page.total,
    ).toBe(0);
    for (const url of [
      '/payments/refunds/register/file?format=pdf&q=FRQ-pupil',
      '/fees/adjustments/register/file?format=xlsx',
      '/fees/profile-changes/register/file?format=pdf',
    ]) {
      const f = await inject({ method: 'GET', url, headers: h() });
      expect(f.statusCode).toBe(200);
      expect(Buffer.from(f.json().base64, 'base64').length).toBeGreaterThan(800);
    }
    // a fee report comes back as a file at once, with no worker; the Tally file still goes to the queue
    for (const format of ['xlsx', 'csv', 'pdf']) {
      const f = await inject({
        method: 'POST',
        url: '/reports/exports/instant',
        headers: h(),
        json: { dataset: 'fee_day_book', format, params: { from: '2020-01-01', to: '2035-12-31' } },
      });
      expect(f.statusCode).toBe(201);
      expect(f.json().filename).toBe(`fee-day-book.${format}`);
      expect(Buffer.from(f.json().base64, 'base64').length).toBeGreaterThan(200);
    }
    const xml = await inject({
      method: 'POST',
      url: '/reports/exports/instant',
      headers: h(),
      json: { dataset: 'fee_tally_vouchers', format: 'xml', params: {} },
    });
    expect(xml.statusCode).toBe(409);
    expect(xml.json().type).toBe('reports.not_instant');
    // the MIS reports: a table with totals, and the same as Excel and PDF
    for (const report of [
      'mode_daywise',
      'head_receipts',
      'cheque_bounce',
      'daybook_grouped',
      'period_headwise',
      'yearly_projection',
    ]) {
      const t = await inject({
        method: 'GET',
        url: `/fees/mis/${report}?from=2020-01-01&to=2035-12-31`,
        headers: h(),
      });
      expect(t.statusCode).toBe(200);
      expect(t.json().columns.length).toBeGreaterThan(5);
      expect(t.json().rows.some((r: { kind: string }) => r.kind === 'total')).toBe(true);
      const f = await inject({
        method: 'GET',
        url: `/fees/mis/${report}/file?from=2020-01-01&to=2035-12-31&format=${report === 'mode_daywise' ? 'pdf' : 'xlsx'}`,
        headers: h(),
      });
      expect(f.statusCode).toBe(200);
      expect(Buffer.from(f.json().base64, 'base64').length).toBeGreaterThan(800);
    }
    // by day and mode: what the modes add up to is the day's final amount, and the pupil refund shows as Dr
    const byMode = (
      await inject({
        method: 'GET',
        url: '/fees/mis/mode_daywise?from=2020-01-01&to=2035-12-31',
        headers: h(),
      })
    ).json() as { rows: Array<{ kind: string; cells: Record<string, number> }> };
    const sumRow = byMode.rows.find((r) => r.kind === 'total')!.cells;
    expect(sumRow.final).toBeCloseTo(sumRow.final2!, 2);
    expect(sumRow.final).toBeCloseTo(sumRow.paid! + sumRow.late! - sumRow.dr!, 2);
    expect(sumRow.dr).toBeGreaterThanOrEqual(3300);
    // by head: every counted receipt is fee heads plus fine plus what is kept as advance or went back
    const byHead = (
      await inject({
        method: 'GET',
        url: '/fees/mis/head_receipts?from=2020-01-01&to=2035-12-31',
        headers: h(),
      })
    ).json() as { rows: Array<{ kind: string; cells: Record<string, number | string> }> };
    expect(byHead.rows.filter((r) => r.kind === 'row').length).toBeGreaterThan(3);
    expect(Number(byHead.rows.find((r) => r.kind === 'total')!.cells.total)).toBeGreaterThan(0);
    expect(
      (await inject({ method: 'GET', url: '/fees/mis/nothing', headers: h() })).statusCode,
    ).toBe(404);
    const adj = await inject({
      method: 'GET',
      url: '/fees/adjustments/register?size=1&status=approved',
      headers: h(),
    });
    expect(adj.statusCode).toBe(200);
    expect(adj.json().data.length).toBeLessThanOrEqual(1);
    expect(adj.json().totals).toHaveProperty('waived');
    const bad = await inject({
      method: 'GET',
      url: '/fees/adjustments/register?from=12-10-2026',
      headers: h(),
    });
    expect(bad.statusCode).toBe(400);
  });
});
