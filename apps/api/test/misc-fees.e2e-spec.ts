/**
 * Misc fees announced to pupils (0131): announce through approval, a pupil's own amount, limited seats
 * taken by paying, an optional fee closing on its last date, and a receipt cancelled or refunded.
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

describe('misc fees announced to pupils (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let classId: string;
  let headId: string;
  const pupils: string[] = [];

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const day = (plus: number) => new Date(Date.now() + plus * 86400000).toISOString().slice(0, 10);
  const post = (url: string, json: unknown, u: SeededUser = accountant) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const get = async (url: string) => (await inject({ method: 'GET', url, headers: h() })).json();
  /** Decides the waiting request of a fee (or receipt) on the page. */
  const approve = async (feeId: string, outcome: 'approved' | 'rejected' = 'approved') => {
    const fee = await get(`/fees/misc-fees/${feeId}`);
    const open = (fee.requests as Array<{ id: string; status: string }>).find(
      (r) => r.status === 'pending',
    )!;
    const r = await post(`/fees/misc-fees/requests/${open.id}/decide`, { outcome }, admin);
    expect(r.statusCode).toBe(200);
    return r.json();
  };
  const linesOf = async (studentId: string) =>
    (await get(`/fees/misc-fees/student/${studentId}`)) as {
      lines: Array<{
        id: string;
        title: string;
        balance: string;
        status: string;
        blocked: string | null;
      }>;
      receipts: Array<{ id: string; receiptNo: string; status: string; refunded: string }>;
    };

  beforeAll(async () => {
    const s = stamp('MSF');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post(
      '/academics/classes',
      { code: 'VI', name: 'Class VI', displayOrder: 6 },
      admin,
    );
    classId = cls.json().id;
    const sec = await post(`/academics/classes/${classId}/sections`, { name: 'A' }, admin);
    const head = await post(
      '/fees/heads',
      { code: 'TRIP', name: 'Trips', kind: 'misc', ledger: 'misc', sortOrder: 9 },
      admin,
    );
    expect(head.statusCode).toBe(201);
    headId = head.json().id;
    for (let i = 1; i <= 3; i++) {
      const st = await post(
        '/people/students',
        {
          admissionNo: `MSF-${String(i)}`,
          firstName: `Pupil${String(i)}`,
          lastName: 'Misc',
          dob: '2015-01-01',
          admittedOn: '2025-04-05',
          enrolment: { classSectionId: sec.json().id, rollNo: i },
        },
        admin,
      );
      expect(st.statusCode).toBe(201);
      pupils.push(st.json().id);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('a fee is announced to a class, one pupil with their own amount, and waits for approval', async () => {
    const r = await post('/fees/misc-fees', {
      headId,
      title: 'Science fair kit',
      amount: 300,
      lastDate: day(20),
      mandatory: true,
      classIds: [classId],
      rows: [{ admissionNo: 'msf-2', amount: 150 }],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'pending', pupils: 3, billed: '750.00' });
    const id = r.json().id as string;
    // nothing to pay until it is approved
    expect((await linesOf(pupils[0]!)).lines).toHaveLength(0);
    // the one who asked cannot decide without the right
    const self = await post(
      `/fees/misc-fees/requests/${(await get(`/fees/misc-fees/${id}`)).requests[0].id}/decide`,
      { outcome: 'approved' },
    );
    expect(self.statusCode).toBe(403);
    await approve(id);
    expect((await get(`/fees/misc-fees/${id}`)).fee.status).toBe('announced');
    expect((await linesOf(pupils[1]!)).lines[0]).toMatchObject({
      balance: '150.00',
      blocked: null,
    });
  });

  it('an unknown admission number in the sheet stops the announcement', async () => {
    const r = await post('/fees/misc-fees', {
      headId,
      title: 'Wrong sheet',
      amount: 100,
      lastDate: day(5),
      rows: [{ admissionNo: 'NOPE-1' }],
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().detail ?? r.json().message).toContain('NOPE-1');
  });

  it('counter collection, part payment, then a pupil change and an extension by approval', async () => {
    const mine = await linesOf(pupils[0]!);
    const line = mine.lines.find((l) => l.title === 'Science fair kit')!;
    const part = await post('/fees/misc-fees/collect', {
      studentId: pupils[0],
      lines: [{ lineId: line.id, amount: 100 }],
      mode: 'cash',
    });
    expect(part.statusCode).toBe(201);
    expect(part.json().receipts[0].receiptNo).toBeTruthy();
    const over = await post('/fees/misc-fees/collect', {
      studentId: pupils[0],
      lines: [{ lineId: line.id, amount: 500 }],
      mode: 'cash',
    });
    expect(over.statusCode).toBe(409);
    const feeId = (await get('/fees/misc-fees?q=science')).rows[0].id as string;
    // below what is paid is refused
    const low = await post(`/fees/misc-fees/${feeId}/changes`, {
      kind: 'pupil_change',
      lineId: line.id,
      amount: 50,
      reason: 'Concession',
    });
    expect(low.statusCode).toBe(409);
    const change = await post(`/fees/misc-fees/${feeId}/changes`, {
      kind: 'pupil_change',
      lineId: line.id,
      amount: 100,
      lastDate: day(40),
      reason: 'Concession',
    });
    expect(change.statusCode).toBe(201);
    await approve(feeId);
    expect((await linesOf(pupils[0]!)).lines.find((l) => l.id === line.id)).toMatchObject({
      balance: '0.00',
      status: 'paid',
    });
    const ext = await post(`/fees/misc-fees/${feeId}/changes`, {
      kind: 'extend',
      lastDate: day(60),
      reason: 'Fair postponed',
    });
    expect(ext.statusCode).toBe(201);
    // the same request twice is refused while one waits
    const again = await post(`/fees/misc-fees/${feeId}/changes`, {
      kind: 'extend',
      lastDate: day(61),
      reason: 'Fair postponed',
    });
    expect(again.statusCode).toBe(409);
    await approve(feeId);
    expect((await get(`/fees/misc-fees/${feeId}`)).fee.lastDate).toBe(day(60));
  });

  it('limited seats go to those who pay first; a cancelled receipt gives the seat back', async () => {
    const r = await post('/fees/misc-fees', {
      headId,
      title: 'Zoo trip',
      amount: 500,
      lastDate: day(10),
      mandatory: false,
      seats: 1,
      studentIds: pupils,
    });
    const feeId = r.json().id as string;
    await approve(feeId);
    const lineOf = async (i: number) =>
      (await linesOf(pupils[i]!)).lines.find((l) => l.title === 'Zoo trip')!;
    const part = await post('/fees/misc-fees/collect', {
      studentId: pupils[0],
      lines: [{ lineId: (await lineOf(0)).id, amount: 200 }],
      mode: 'cash',
    });
    expect(part.statusCode).toBe(409); // a seat is paid in full
    const first = await post('/fees/misc-fees/collect', {
      studentId: pupils[0],
      lines: [{ lineId: (await lineOf(0)).id, amount: 500 }],
      mode: 'upi',
      reference: 'UPI-1',
    });
    expect(first.statusCode).toBe(201);
    expect((await lineOf(1)).blocked).toBe('All seats are taken');
    const second = await post('/fees/misc-fees/collect', {
      studentId: pupils[1],
      lines: [{ lineId: (await lineOf(1)).id, amount: 500 }],
      mode: 'cash',
    });
    expect(second.statusCode).toBe(409);
    // cancel the first receipt: by approval, then the seat is free
    const receiptId = first.json().receipts[0].id as string;
    const bounce = await post(`/fees/misc-fees/receipts/${receiptId}/request`, {
      kind: 'receipt_bounce',
      reason: 'Not a cheque',
    });
    expect(bounce.statusCode).toBe(409);
    const cancel = await post(`/fees/misc-fees/receipts/${receiptId}/request`, {
      kind: 'receipt_cancel',
      reason: 'Wrong pupil',
    });
    expect(cancel.statusCode).toBe(201);
    expect((await lineOf(1)).blocked).toBe('All seats are taken'); // until approved
    await approve(feeId);
    expect((await linesOf(pupils[0]!)).receipts.find((x) => x.id === receiptId)!.status).toBe(
      'reversed',
    );
    expect((await lineOf(0)).status).toBe('open');
    const now = await post('/fees/misc-fees/collect', {
      studentId: pupils[1],
      lines: [{ lineId: (await lineOf(1)).id, amount: 500 }],
      mode: 'cash',
    });
    expect(now.statusCode).toBe(201);

    // part refund, then the rest: a voucher each, the fee is unpaid again
    const rid = now.json().receipts[0].id as string;
    const tooMuch = await post(`/fees/misc-fees/receipts/${rid}/request`, {
      kind: 'receipt_refund',
      reason: 'Trip shortened',
      amount: 600,
      mode: 'cash',
    });
    expect(tooMuch.statusCode).toBe(409);
    await post(`/fees/misc-fees/receipts/${rid}/request`, {
      kind: 'receipt_refund',
      reason: 'Trip shortened',
      amount: 200,
      mode: 'cash',
    });
    const done = await approve(feeId);
    expect(done.voucherNo).toBeTruthy();
    expect((await linesOf(pupils[1]!)).receipts.find((x) => x.id === rid)).toMatchObject({
      status: 'posted',
      refunded: '200.00',
    });
    expect((await lineOf(1)).balance).toBe('200.00');
  });

  it('a fee that is not mandatory closes on its last date; a rejected announcement never opens', async () => {
    const feeId = (await get('/fees/misc-fees?q=zoo')).rows[0].id as string;
    await withMigrator(async (c) => {
      await c.query(`UPDATE misc_fees SET last_date = CURRENT_DATE - 1 WHERE id = $1`, [feeId]);
    });
    const line = (await linesOf(pupils[2]!)).lines.find((l) => l.title === 'Zoo trip')!;
    expect(line.blocked).toBe('The last date has passed');
    const late = await post('/fees/misc-fees/collect', {
      studentId: pupils[2],
      lines: [{ lineId: line.id, amount: 500 }],
      mode: 'cash',
    });
    expect(late.statusCode).toBe(409);
    const r = await post('/fees/misc-fees', {
      headId,
      title: 'Never',
      amount: 10,
      lastDate: day(3),
      studentIds: [pupils[0]],
    });
    await approve(r.json().id as string, 'rejected');
    expect((await get(`/fees/misc-fees/${r.json().id as string}`)).fee.status).toBe('rejected');
    expect((await linesOf(pupils[0]!)).lines.some((l) => l.title === 'Never')).toBe(false);
  });

  it('the dues report lists every pupil of every fee; a reminder goes only to those who can still pay', async () => {
    const rep = (await get('/fees/mis/misc_dues')) as {
      rows: Array<{ kind: string; cells: Record<string, string | number> }>;
    };
    const lines = rep.rows.filter((r) => r.kind === 'row');
    expect(lines).toHaveLength(6);
    expect(lines.filter((r) => r.cells.pay_status === 'Closed')).toHaveLength(3);
    expect(rep.rows.find((r) => r.kind === 'total')!.cells).toMatchObject({
      due: 100 + 150 + 300 + 1500,
      paid: 100 + 300,
    });
    const due = await get('/fees/mis/misc_dues?pay=due');
    expect(due.rows.filter((r: { kind: string }) => r.kind === 'row')).toHaveLength(5);
    const file = await inject({
      method: 'GET',
      url: '/fees/mis/misc_dues/file?format=xlsx&pay=due',
      headers: h(),
    });
    expect(file.statusCode).toBe(200);
    const made = await post(
      '/comms/templates',
      {
        code: 'misc_fee',
        channel: 'email',
        name: 'Misc fee',
        subject: '{{fee_name}}',
        body: 'Dear {{recipient_name}}, {{fee_name}} of Rs. {{fee_due}} for {{student_name}} is to be paid by {{last_date}}.',
      },
      admin,
    );
    expect(made.statusCode).toBe(201);
    const t = { id: made.json().id as string };
    const preview = await post(
      '/fees/reminders/preview',
      { channels: [{ channel: 'email', templateId: t.id }], to: 'father', misc: { pay: 'due' } },
      admin,
    );
    expect(preview.statusCode).toBe(200);
    // the two still open on the science kit; the closed trip is not asked for (and nobody has a parent here)
    expect(preview.json()).toMatchObject({ listed: 2, noContact: 2, pupils: 0 });
    const everyone = await post(
      '/fees/reminders/preview',
      { channels: [{ channel: 'email', templateId: t.id }], to: 'father', misc: { pay: 'all' } },
      admin,
    );
    expect(everyone.json().listed).toBe(6);
  });

  it('the day book lists the cancelled misc receipt (not counted) and the misc refund as a minus line', async () => {
    const book = (await get('/fees/mis/day_book')) as {
      rows: Array<{ kind: string; cells: Record<string, string | number> }>;
    };
    const lines = book.rows.filter((r) => r.kind === 'row');
    const misc = lines.filter((r) => r.cells.kind === 'Misc receipt');
    // 100 on the science kit, the cancelled 500 and the 500 that was part refunded
    expect(misc.map((r) => [r.cells.amount, r.cells.status]).sort()).toEqual(
      [
        [100, 'Posted'],
        [500, 'Cancelled (not counted)'],
        [500, 'Posted'],
      ].sort(),
    );
    const refund = lines.filter((r) => r.cells.kind === 'Misc refund');
    expect(refund).toHaveLength(1);
    expect(refund[0]!.cells).toMatchObject({ amount: -200, status: 'Refund paid', mode: 'cash' });
    expect(String(refund[0]!.cells.receipt_no)).toMatch(/^RF/);
    expect(book.rows.find((r) => r.kind === 'total')!.cells.amount).toBe(100 + 500 - 200);
  });

  it('with approval levels set, the request goes through My approvals', async () => {
    expect((await post('/workflow/definitions/defaults', {}, admin)).statusCode).toBe(201);
    const r = await post('/fees/misc-fees', {
      headId,
      title: 'Annual day dress',
      amount: 800,
      lastDate: day(15),
      mandatory: true,
      studentIds: [pupils[2]],
    });
    expect(r.statusCode).toBe(201);
    const fee = await get(`/fees/misc-fees/${r.json().id as string}`);
    const req = fee.requests[0] as { id: string; workflowInstanceId: string };
    expect(req.workflowInstanceId).toBeTruthy();
    const onPage = await post(
      `/fees/misc-fees/requests/${req.id}/decide`,
      { outcome: 'approved' },
      admin,
    );
    expect(onPage.statusCode).toBe(409);
    for (let i = 0; i < 3; i++) {
      const step = await withMigrator(async (c) => {
        const x = await c.query<{ id: string }>(
          `SELECT id::text FROM workflow_steps WHERE instance_id = $1 AND status = 'pending' ORDER BY level LIMIT 1`,
          [req.workflowInstanceId],
        );
        return x.rows[0];
      });
      if (!step) break;
      const ok = await post(`/workflow/steps/${step.id}/approve`, { note: 'ok' }, admin);
      expect([200, 201]).toContain(ok.statusCode);
    }
    expect((await get(`/fees/misc-fees/${r.json().id as string}`)).fee.status).toBe('announced');
  });
});
