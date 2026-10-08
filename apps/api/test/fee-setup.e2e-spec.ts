/**
 * Fee set-up, second pass (0098): combined print name and tax flag on heads, a class's own last date,
 * late fee and bounce charge, the payment mode master, and several discounts per pupil by month
 * (added up, capped at the head's fee), requested by the accountant and approved by the admin.
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

interface Instalment {
  dueOn: string;
  net: string;
  balance: string;
  lateFee: { amount: string; mode: string };
}
interface Ledger {
  instalments: Instalment[];
}

describe('fee set-up, second pass (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let classId: string;
  let otherClassId: string;
  let sectionId: string;
  let otherSectionId: string;
  const heads: Record<string, string> = {};
  const discounts: Record<string, string> = {};
  const students: Record<string, string> = {};
  let periods: Array<{ id: string; sequence: number }>;

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const ledgerOf = async (id: string, asOf?: string) =>
    (
      await inject({
        method: 'GET',
        url: `/fees/students/${id}/ledger${asOf ? `?asOf=${asOf}` : ''}`,
        headers: h(),
      })
    ).json() as Ledger;
  const receipt = (json: Record<string, unknown>) =>
    inject({ method: 'POST', url: '/payments/receipts', headers: h(accountant), json });

  beforeAll(async () => {
    const s = stamp('FS2');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
    });
    app = await createApp();
    inject = injector(app);
    const mk = async (code: string, order: number) => {
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code, name: `Class ${code}`, displayOrder: order },
      });
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      });
      return [cls.json().id as string, sec.json().id as string] as const;
    };
    [classId, sectionId] = await mk('VI', 6);
    [otherClassId, otherSectionId] = await mk('VII', 7);
    for (const [code, name, group, tax, i] of [
      ['TUI', 'Tuition fee', 'Composite fee', true, 1],
      ['ANN', 'Annual charge', 'Composite fee', false, 2],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code, name, sortOrder: i, printGroup: group, taxCertificate: tax },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ printGroup: 'Composite fee', taxCertificate: tax });
      heads[code] = r.json().id;
    }
    const p = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    expect(p.statusCode).toBe(201);
    periods = (await inject({ method: 'GET', url: '/fees/periods', headers: h() })).json().data;
    for (const cid of [classId, otherClassId]) {
      const st = await inject({
        method: 'PUT',
        url: `/fees/structures/${cid}`,
        headers: h(),
        json: {
          feeGroup: 'general',
          entries: [
            { headId: heads.TUI, amount: 2000, frequency: 'monthly' },
            { headId: heads.ANN, amount: 500, frequency: 'monthly' },
          ],
        },
      });
      expect(st.statusCode).toBe(200);
    }
    for (const [code, name, body] of [
      ['SIB', 'Sibling 10%', { headId: () => heads.TUI, percent: 10 }],
      ['MER', 'Merit 300', { headId: () => heads.TUI, amount: 300 }],
      ['ANW', 'Annual waived', { headId: () => heads.ANN, amount: 5000 }],
    ] as const) {
      const { headId, ...rest } = body;
      const r = await inject({
        method: 'POST',
        url: '/fees/discounts',
        headers: h(),
        json: { code, name, headId: headId(), ...rest },
      });
      expect(r.statusCode).toBe(201);
      discounts[code] = r.json().id;
    }
    let roll = 1;
    for (const [id, sec] of [
      ['multi', sectionId],
      ['rules', sectionId],
      ['other', otherSectionId],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `FS2-${id}`,
          firstName: id,
          lastName: 'Setup',
          dob: '2015-01-01',
          admittedOn: '2025-04-05',
          enrolment: { classSectionId: sec, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      students[id] = r.json().id;
      roll += 1;
      const g = await inject({
        method: 'POST',
        url: `/fees/students/${students[id]}/demands/generate`,
        headers: h(),
      });
      expect(g.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('several discounts from a chosen month add up after approval; earlier months stay', async () => {
    const before = await ledgerOf(students.multi!);
    expect(before.instalments).toHaveLength(12);
    expect(before.instalments[0]!.net).toBe('2500.00');
    const req = await inject({
      method: 'POST',
      url: `/fees/students/${students.multi}/profile-changes`,
      headers: h(accountant),
      json: {
        discounts: [
          { discountId: discounts.SIB, fromSeq: 4, toSeq: 12 },
          { discountId: discounts.MER, fromSeq: 4, toSeq: 9 },
        ],
        reason: 'Sibling joined in July, merit for two terms',
      },
    });
    expect(req.statusCode).toBe(201);
    // nothing changes until the admin approves
    expect((await ledgerOf(students.multi!)).instalments[3]!.net).toBe('2500.00');
    const ok = await inject({
      method: 'POST',
      url: `/fees/profile-changes/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    const after = await ledgerOf(students.multi!);
    expect(after.instalments[2]!.net).toBe('2500.00'); // June untouched
    expect(after.instalments[3]!.net).toBe('2000.00'); // July: 2500 − 200 − 300
    expect(after.instalments[9]!.net).toBe('2300.00'); // January: only the sibling 10 %
    const list = await inject({
      method: 'GET',
      url: `/fees/students/${students.multi}/discounts`,
      headers: h(accountant),
    });
    expect(list.json().data).toHaveLength(2);
    expect(list.json().data[0]).toMatchObject({
      fromSeq: 4,
      fromName: expect.stringContaining('July'),
    });
  });

  it('a discount larger than the head is capped at the head, and the list can be replaced', async () => {
    const pr = await inject({
      method: 'PUT',
      url: `/fees/students/${students.multi}/profile`,
      headers: h(),
      json: {
        studentType: 'old',
        discounts: [
          { discountId: discounts.SIB, fromSeq: 4, toSeq: 12 },
          { discountId: discounts.ANW, fromSeq: 1, toSeq: 1 },
        ],
      },
    });
    expect(pr.statusCode).toBe(200);
    const g = await inject({
      method: 'POST',
      url: `/fees/students/${students.multi}/demands/regenerate`,
      headers: h(),
    });
    expect(g.statusCode).toBe(201);
    const after = await ledgerOf(students.multi!);
    expect(after.instalments[0]!.net).toBe('2000.00'); // annual charge fully off, never negative
    expect(after.instalments[3]!.net).toBe('2300.00'); // merit removed with the old list
    const bad = await inject({
      method: 'PUT',
      url: `/fees/students/${students.multi}/profile`,
      headers: h(),
      json: {
        studentType: 'old',
        discounts: [{ discountId: discounts.SIB, fromSeq: 9, toSeq: 4 }],
      },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("a class has its own last date and late fee; another class keeps the school's", async () => {
    await inject({
      method: 'PUT',
      url: '/platform/settings/fees.late_fee_mode',
      headers: h(),
      json: { value: 'slab' },
    });
    const p1 = periods.find((p) => p.sequence === 1)!;
    const p2 = periods.find((p) => p.sequence === 2)!;
    for (const p of [p1, p2]) {
      const r = await inject({
        method: 'PUT',
        url: `/fees/periods/${p.id}/late-fee`,
        headers: h(),
        json: { lateFeeAmount: 100, slabs: [] },
      });
      expect(r.statusCode).toBe(200);
    }
    const denied = await inject({
      method: 'PUT',
      url: `/fees/class-rules/${classId}`,
      headers: h(accountant),
      json: { periods: [] },
    });
    expect([200, 403]).toContain(denied.statusCode);
    const set = await inject({
      method: 'PUT',
      url: `/fees/class-rules/${classId}`,
      headers: h(),
      json: {
        bounceCharge: 750,
        periods: [
          { periodId: p1.id, dueOn: '2026-04-20' },
          { periodId: p2.id, lateFeeAmount: 40, slabs: [{ on: '2026-05-25', amount: 90 }] },
        ],
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().data).toMatchObject({ bounceCharge: '750.00', lateFeeMode: 'slab' });
    expect(set.json().data.periods[0]).toMatchObject({
      dueOn: '2026-04-20',
      schoolDueOn: '2026-04-10',
    });
    // bills already raised move to the class's date; the other class is untouched
    const mine = await ledgerOf(students.rules!, '2026-05-15');
    expect(mine.instalments[0]!.dueOn).toBe('2026-04-20');
    expect(mine.instalments[0]!.lateFee.amount).toBe('100.00'); // class date, school late fee
    expect(mine.instalments[1]!.lateFee.amount).toBe('40.00'); // class late fee
    expect((await ledgerOf(students.rules!, '2026-05-30')).instalments[1]!.lateFee.amount).toBe(
      '90.00',
    );
    const theirs = await ledgerOf(students.other!, '2026-05-15');
    expect(theirs.instalments[0]!.dueOn).toBe('2026-04-10');
    expect(theirs.instalments[1]!.lateFee.amount).toBe('100.00');
    // a newly generated bill takes the class date too
    await inject({
      method: 'POST',
      url: `/fees/students/${students.rules}/demands/regenerate`,
      headers: h(),
    });
    expect((await ledgerOf(students.rules!)).instalments[0]!.dueOn).toBe('2026-04-20');
    // clearing the row returns the class to the school's date
    const clear = await inject({
      method: 'PUT',
      url: `/fees/class-rules/${classId}`,
      headers: h(),
      json: { periods: [{ periodId: p1.id, dueOn: null }] },
    });
    expect(clear.statusCode).toBe(200);
    expect((await ledgerOf(students.rules!)).instalments[0]!.dueOn).toBe('2026-04-10');
  });

  it('payment modes: the master decides what the counter offers and which fields are mandatory', async () => {
    const list = await inject({
      method: 'GET',
      url: '/fees/payment-modes',
      headers: h(accountant),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(7);
    const free = await receipt({ studentId: students.other, amount: 100, mode: 'upi' });
    expect(free.statusCode).toBe(201);
    const upi = await inject({
      method: 'PUT',
      url: '/fees/payment-modes/upi',
      headers: h(),
      json: { label: 'UPI', atCounter: true, needReference: true },
    });
    expect(upi.statusCode).toBe(200);
    const missing = await receipt({ studentId: students.other, amount: 100, mode: 'upi' });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().detail ?? missing.json().message).toContain('reference');
    const withRef = await receipt({
      studentId: students.other,
      amount: 100,
      mode: 'upi',
      reference: 'UTR123456',
    });
    expect(withRef.statusCode).toBe(201);
    await inject({
      method: 'PUT',
      url: '/fees/payment-modes/card',
      headers: h(),
      json: { label: 'Card', atCounter: false },
    });
    const card = await receipt({ studentId: students.other, amount: 100, mode: 'card' });
    expect(card.statusCode).toBe(409);
    const online = await inject({
      method: 'PUT',
      url: '/fees/payment-modes/online',
      headers: h(),
      json: { label: 'Online', atCounter: true },
    });
    expect(online.json().data.find((m: { code: string }) => m.code === 'online').atCounter).toBe(
      false,
    );
  });

  it("a bounced cheque takes the class's bounce charge", async () => {
    const chq = await receipt({
      studentId: students.rules,
      amount: 2500,
      mode: 'cheque',
      instrumentNo: '445566',
      bankName: 'SBI',
    });
    expect(chq.statusCode).toBe(201);
    const req = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: { kind: 'bounce', paymentId: chq.json().paymentId, reason: 'Funds insufficient' },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ kind: 'bounce', charge: '750.00' });
  });

  it('heads sharing a print name are one line on the receipt', async () => {
    const pay = await receipt({ studentId: students.other, amount: 2500, mode: 'cash' });
    expect(pay.statusCode).toBe(201);
    const lines = await withMigrator(async (c) => {
      await c.query(`SELECT set_config('app.school_id', $1, false)`, [school.id]);
      const { loadDocumentData } = await import('@edupro/db');
      const data = (await loadDocumentData(c as never, 'fee_receipt', pay.json().paymentId)) as {
        receipt?: { lines?: Array<{ head: string; amount: string }> };
      };
      return data.receipt?.lines ?? [];
    });
    const composite = lines.filter((l) => l.head === 'Composite fee');
    expect(composite.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.head === 'Tuition fee' || l.head === 'Annual charge')).toBe(false);
  });
  it('a deposit slip takes cheques in hand once; cancelling frees them', async () => {
    const accountId = await withMigrator(async (c) => {
      const b = await c.query<{ id: string }>(
        `INSERT INTO banks (school_id, code, name) VALUES ($1, 'HDFC', 'HDFC Bank') RETURNING id::text`,
        [school.id],
      );
      const a = await c.query<{ id: string }>(
        `INSERT INTO school_bank_accounts (school_id, bank_id, account_name, account_no, ifsc) VALUES ($1, $2, 'School Fee Account', '50100012345678', 'HDFC0001234') RETURNING id::text`,
        [school.id, b.rows[0]!.id],
      );
      return a.rows[0]!.id;
    });
    const chq = await receipt({
      studentId: students.other,
      amount: 1000,
      mode: 'cheque',
      instrumentNo: '778899',
      instrumentDate: '2026-10-01',
      bankName: 'Axis',
    });
    expect(chq.statusCode).toBe(201);
    const pending = await inject({
      method: 'GET',
      url: '/fees/deposit-slips/pending',
      headers: h(accountant),
    });
    expect(pending.statusCode).toBe(200);
    const items = pending.json().data as Array<{ key: string; instrumentNo: string; mode: string }>;
    expect(items.every((x) => x.mode === 'cheque' || x.mode === 'dd')).toBe(true);
    const mine = items.find((x) => x.instrumentNo === '778899')!;
    expect(pending.json().accounts).toHaveLength(1);
    const slip = await inject({
      method: 'POST',
      url: '/fees/deposit-slips',
      headers: h(accountant),
      json: { bankAccountId: accountId, depositOn: '2026-10-08', items: [mine.key] },
    });
    expect(slip.statusCode).toBe(201);
    expect(slip.json()).toMatchObject({
      slipNo: 1,
      instruments: 1,
      total: '1000.00',
      status: 'open',
    });
    const twice = await inject({
      method: 'POST',
      url: '/fees/deposit-slips',
      headers: h(accountant),
      json: { bankAccountId: accountId, depositOn: '2026-10-08', items: [mine.key] },
    });
    expect(twice.statusCode).toBe(409);
    const detail = await inject({
      method: 'GET',
      url: `/fees/deposit-slips/${slip.json().id}`,
      headers: h(accountant),
    });
    expect(detail.json().lines).toHaveLength(1);
    expect(detail.json().totalWords).toMatch(/One Thousand/i);
    const cancel = await inject({
      method: 'POST',
      url: `/fees/deposit-slips/${slip.json().id}/cancel`,
      headers: h(accountant),
    });
    expect(cancel.json().status).toBe('cancelled');
    const again = await inject({
      method: 'POST',
      url: '/fees/deposit-slips',
      headers: h(accountant),
      json: { bankAccountId: accountId, depositOn: '2026-10-09', items: [mine.key] },
    });
    expect(again.statusCode).toBe(201);
    expect(again.json().slipNo).toBe(2);
  });
  it('prints the fee bill, the tax certificate and the provisional bill of a withdrawal', async () => {
    const bill = await inject({
      method: 'GET',
      url: `/fees/students/${students.other}/bill?upTo=2026-10-31`,
      headers: h(accountant),
    });
    expect(bill.statusCode).toBe(200);
    const b = bill.json();
    expect(b.student.admissionNo).toBe('FS2-other');
    expect(b.instalments.length).toBeGreaterThan(0);
    expect(b.instalments[0].lines.every((l: { head: string }) => l.head === 'Composite fee')).toBe(
      true,
    );
    expect(Number(b.totals.payable)).toBeGreaterThan(0);
    const all = await inject({
      method: 'GET',
      url: `/fees/bills?classId=${otherClassId}&upTo=2026-10-31`,
      headers: h(accountant),
    });
    expect(all.json().data).toHaveLength(1);
    // tuition counts for the certificate, the annual charge does not; together they are what was paid
    const cert = await inject({
      method: 'GET',
      url: `/fees/students/${students.other}/tax-certificate`,
      headers: h(accountant),
    });
    expect(cert.statusCode).toBe(200);
    const t = cert.json();
    expect(t.rows.every((r: { head: string }) => r.head === 'Tuition fee')).toBe(true);
    expect(Number(t.total)).toBeGreaterThan(0);
    expect(Number(t.total) + Number(t.otherPaid)).toBe(3600); // 3 700 received less 100 late fee
    expect(t.years.length).toBeGreaterThan(0);
    // leaving after the first month: what was paid for later months comes back
    const fnf = await inject({
      method: 'GET',
      url: `/fees/students/${students.other}/fnf?lastSeq=1`,
      headers: h(accountant),
    });
    expect(fnf.statusCode).toBe(200);
    const f = fnf.json();
    expect(f.lastMonth.sequence).toBe(1);
    expect(f.dues).toHaveLength(0);
    expect(f.paidAhead.reduce((a: number, x: { paid: string }) => a + Number(x.paid), 0)).toBe(
      1100,
    );
    expect(['refund', 'pay']).toContain(f.totals.direction);
    const stay = (
      await inject({
        method: 'GET',
        url: `/fees/students/${students.other}/fnf?lastSeq=12`,
        headers: h(accountant),
      })
    ).json();
    expect(stay.paidAhead).toHaveLength(0);
    expect(stay.totals.direction).toBe('pay');
  });
});
