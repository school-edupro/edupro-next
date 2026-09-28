/**
 * Sprint 13: collect and pay. Cashier receipts through app.post_receipt (principal, late fee, advance,
 * partial and settling receipts), concurrent receipt numbering, refunds with approval, Razorpay and CCAvenue
 * adapters (signatures, orders, webhooks), settlement matching, the family's ledger and online payment,
 * transport requests (direct and through the workflow), vehicle logs, department dashboards and report centres.
 */
import { createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as ccavenue from '../src/modules/payments/adapters/ccavenue';
import { checkoutSignature } from '../src/modules/payments/adapters/razorpay';
import { PaymentsService } from '../src/modules/payments/payments.service';
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
  paid: string;
  balance: string;
  status: string;
  visible: boolean;
  lateFee: { amount: string; posted: string; outstanding: string };
}
interface Ledger {
  instalments: Instalment[];
  totals: {
    balance: string;
    lateFee: string;
    lateFeePosted: string;
    lateFeeOutstanding: string;
    payable: string;
  };
  payments: Array<{
    id: string;
    receiptNo: string | null;
    amount: string;
    lateFee: string;
    refunded: string;
    status: string;
    unallocated: string;
    mode: string;
    settled: boolean;
  }>;
  refunds: Array<{ id: string; amount: string; status: string }>;
}
interface Receipt {
  paymentId: string;
  receiptNo: string;
  principal: string;
  lateFee: string;
  advance: string;
  instalments: number;
}

const RAZORPAY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? 'dev-razorpay-secret';
const RAZORPAY_WEBHOOK = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'dev-razorpay-webhook-secret';
const CCAVENUE_KEY = process.env.CCAVENUE_WORKING_KEY ?? 'dev-ccavenue-working-key';

describe('collect and pay (e2e, Sprint 13)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let classId: string;
  let sectionId: string;
  let routeId: string;
  let stopId: string;
  let vehicleId: string;
  let uid: string;
  const students = {} as Record<'full' | 'partial' | 'short' | 'many' | 'child' | 'refund', string>;

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const ledgerOf = async (id: string, asOf: string) =>
    (
      await inject({ method: 'GET', url: `/fees/students/${id}/ledger?asOf=${asOf}`, headers: h() })
    ).json() as Ledger;
  const receipt = async (json: Record<string, unknown>, user: SeededUser = accountant) =>
    inject({ method: 'POST', url: '/payments/receipts', headers: h(user), json });
  const setSetting = async (key: string, value: unknown) => {
    const r = await inject({
      method: 'PUT',
      url: `/platform/settings/${key}`,
      headers: h(),
      json: { value },
    });
    expect([200, 201]).toContain(r.statusCode);
  };

  beforeAll(async () => {
    const s = stamp('F13');
    uid = s.replace(/[^A-Za-z0-9]/g, '');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(`UPDATE users SET email = $2 WHERE id = $1`, [parent.id, `${s}@example.test`]);
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classId = cls.json().id;
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${classId}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    const heads: Record<string, string> = {};
    for (const [code, name, kind, i] of [
      ['TUI', 'Tuition fee', 'regular', 1],
      ['DEV', 'Development fee', 'regular', 2],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code, name, kind, sortOrder: i },
      });
      expect(r.statusCode).toBe(201);
      heads[code] = r.json().id;
    }
    const p = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    expect(p.statusCode).toBe(201);
    const st = await inject({
      method: 'PUT',
      url: `/fees/structures/${classId}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [
          { headId: heads.TUI, amount: 2000, frequency: 'monthly' },
          { headId: heads.DEV, amount: 1200, frequency: 'quarterly' },
        ],
      },
    });
    expect(st.statusCode).toBe(200);
    await setSetting('fees.late_fee_mode', 'daywise');
    await setSetting('fees.late_fee_per_day', '10.00');
    let roll = 1;
    for (const id of ['full', 'partial', 'short', 'many', 'child', 'refund'] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `F13-${id}`,
          firstName: id,
          lastName: 'Collect',
          dob: '2015-01-01',
          admittedOn: '2026-04-05',
          enrolment: { classSectionId: sectionId, rollNo: roll },
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
    // the parent is the guardian of "child"
    await withMigrator(async (c) => {
      const g = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, mobile, user_id) VALUES ($1, 'Suresh', 'Collect', '9876500013', $2) RETURNING id`,
        [school.id, parent.id],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true)`,
        [school.id, students.child, g.rows[0]!.id],
      );
    });
    // a route with a stop and a vehicle for the transport tests
    const route = await inject({
      method: 'POST',
      url: '/transport/routes',
      headers: h(),
      json: { code: 'R1', name: 'Kothrud' },
    });
    expect(route.statusCode).toBe(201);
    routeId = route.json().id;
    const stops = await inject({
      method: 'PUT',
      url: `/transport/routes/${routeId}/stops`,
      headers: h(),
      json: { stops: [{ name: 'Karve Nagar', pickupTime: '07:20', dropTime: '14:40' }] },
    });
    expect(stops.statusCode).toBe(200);
    stopId = (stops.json().data as Array<{ id: string }>)[0]!.id;
    const veh = await inject({
      method: 'POST',
      url: '/transport/vehicles',
      headers: h(),
      json: { regNo: 'MH12F1300', capacity: 40 },
    });
    expect(veh.statusCode).toBe(201);
    vehicleId = veh.json().id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- receipts ----------------------------------------------------------------------------------
  it('posts a receipt that settles an instalment and its late fee in one transaction', async () => {
    // April instalment 7200 due 10 Apr; paid 20 Apr = 10 days x 10 late fee
    const r = await receipt({
      studentId: students.full,
      amount: 7300,
      mode: 'cash',
      receivedOn: '2026-04-20',
    });
    expect(r.statusCode).toBe(201);
    const out = r.json() as Receipt;
    expect(out).toMatchObject({
      receiptNo: 'TF/FY2026-27/000001',
      principal: '7200.00',
      lateFee: '100.00',
      advance: '0.00',
      instalments: 1,
    });
    const ledger = await ledgerOf(students.full, '2026-04-25');
    expect(ledger.instalments[0]).toMatchObject({
      status: 'paid',
      lateFee: { amount: '100.00', posted: '100.00', outstanding: '0.00' },
    });
    expect(ledger.totals).toMatchObject({
      lateFeePosted: '100.00',
      lateFeeOutstanding: '0.00',
      payable: '21600.00',
    });
    expect(ledger.payments[0]).toMatchObject({
      receiptNo: 'TF/FY2026-27/000001',
      lateFee: '100.00',
      status: 'posted',
      unallocated: '0.00',
    });
  });

  it('a partial receipt pays principal only; the settling receipt collects the late fee', async () => {
    const first = await receipt({
      studentId: students.partial,
      amount: 5000,
      mode: 'upi',
      reference: 'UPI-13',
      receivedOn: '2026-04-15',
    });
    expect(first.json()).toMatchObject({
      principal: '5000.00',
      lateFee: '0.00',
      advance: '0.00',
      instalments: 1,
    });
    const mid = await ledgerOf(students.partial, '2026-04-15');
    expect(mid.instalments[0]).toMatchObject({
      status: 'overdue',
      balance: '2200.00',
      lateFee: { amount: '50.00', posted: '0.00', outstanding: '50.00' },
    });
    const second = await receipt({
      studentId: students.partial,
      amount: 2300,
      mode: 'cash',
      receivedOn: '2026-04-20',
    });
    expect(second.json()).toMatchObject({
      principal: '2200.00',
      lateFee: '100.00',
      advance: '0.00',
    });
    const after = await ledgerOf(students.partial, '2026-05-01');
    expect(after.instalments[0]).toMatchObject({
      status: 'paid',
      lateFee: { amount: '100.00', posted: '100.00', outstanding: '0.00' },
    });
  });

  it('a receipt short of the late fee leaves the rest outstanding until the next receipt', async () => {
    const r = await receipt({
      studentId: students.short,
      amount: 7250,
      mode: 'cash',
      receivedOn: '2026-04-20',
    });
    expect(r.json()).toMatchObject({ principal: '7200.00', lateFee: '50.00', advance: '0.00' });
    const mid = await ledgerOf(students.short, '2026-04-20');
    expect(mid.instalments[0]!.lateFee).toMatchObject({
      amount: '100.00',
      posted: '50.00',
      outstanding: '50.00',
    });
    expect(mid.totals.payable).toBe('21650.00');
    const rest = await receipt({
      studentId: students.short,
      amount: 50,
      mode: 'cash',
      receivedOn: '2026-04-21',
    });
    expect(rest.json()).toMatchObject({
      principal: '0.00',
      lateFee: '50.00',
      advance: '0.00',
      instalments: 1,
    });
    const after = await ledgerOf(students.short, '2026-04-21');
    expect(after.instalments[0]!.lateFee.outstanding).toBe('0.00');
    expect(after.totals.payable).toBe('21600.00');
  });

  it('validates the instrument and the caller', async () => {
    const cheque = await receipt({
      studentId: students.many,
      amount: 100,
      mode: 'cheque',
      receivedOn: '2026-04-20',
    });
    expect(cheque.statusCode).toBe(400);
    expect(cheque.json().type).toBe('fees.instrument_required');
    const ok = await receipt({
      studentId: students.many,
      amount: 100,
      mode: 'cheque',
      instrumentNo: '004512',
      instrumentDate: '2026-04-18',
      bankName: 'SBI',
      receivedOn: '2026-04-20',
    });
    expect(ok.statusCode).toBe(201);
    const denied = await receipt({ studentId: students.many, amount: 100, mode: 'cash' }, teacher);
    expect(denied.statusCode).toBe(403);
  });

  it('numbers twenty concurrent receipts without a gap or a duplicate', async () => {
    const before = (await ledgerOf(students.many, '2026-04-20')).payments.length;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        receipt({
          studentId: students.many,
          amount: 10 + i,
          mode: 'cash',
          receivedOn: '2026-04-20',
          remarks: `c${i}`,
        }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(201);
    const numbers = results.map((r) => (r.json() as Receipt).receiptNo).sort();
    expect(new Set(numbers).size).toBe(20);
    const serials = numbers.map((n) => Number(n.split('/').pop())).sort((a, b) => a - b);
    expect(serials[serials.length - 1]! - serials[0]!).toBe(19);
    expect((await ledgerOf(students.many, '2026-04-20')).payments.length).toBe(before + 20);
  });

  // ---- refunds -----------------------------------------------------------------------------------
  it('refunds reopen the demand after approval; limits and single open request are enforced', async () => {
    const paid = await receipt({
      studentId: students.refund,
      amount: 7200,
      mode: 'bank',
      reference: 'NEFT-1',
      receivedOn: '2026-04-09',
    });
    const paymentId = (paid.json() as Receipt).paymentId;
    const tooMuch = await inject({
      method: 'POST',
      url: `/payments/receipts/${paymentId}/refunds`,
      headers: h(accountant),
      json: { amount: 9000, reason: 'Left the school', mode: 'bank' },
    });
    expect(tooMuch.statusCode).toBe(409);
    const req = await inject({
      method: 'POST',
      url: `/payments/receipts/${paymentId}/refunds`,
      headers: h(accountant),
      json: { amount: 500, reason: 'Transport charged twice', mode: 'bank' },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json().status).toBe('requested');
    const again = await inject({
      method: 'POST',
      url: `/payments/receipts/${paymentId}/refunds`,
      headers: h(accountant),
      json: { amount: 100, reason: 'again', mode: 'cash' },
    });
    expect(again.statusCode).toBe(409);
    const notAllowed = await inject({
      method: 'POST',
      url: `/payments/refunds/${req.json().id}/decide`,
      headers: h(accountant),
      json: { outcome: 'approved' },
    });
    expect(notAllowed.statusCode).toBe(403);
    const approved = await inject({
      method: 'POST',
      url: `/payments/refunds/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved', reference: 'UTR-77', note: 'verified' },
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toMatchObject({ status: 'paid', reference: 'UTR-77' });
    const ledger = await ledgerOf(students.refund, '2026-04-09');
    expect(ledger.payments[0]).toMatchObject({ refunded: '500.00', status: 'partly_refunded' });
    expect(ledger.instalments[0]).toMatchObject({ balance: '500.00', paid: '6700.00' });
    expect(ledger.refunds[0]).toMatchObject({ amount: '500.00', status: 'paid' });
  });

  // ---- family ledger and Razorpay ----------------------------------------------------------------
  it('a guardian sees the visible instalments of their child and pays through Razorpay', async () => {
    const mine = await inject({ method: 'GET', url: '/fees/mine', headers: h(parent) });
    expect(mine.statusCode).toBe(200);
    const child = (
      mine.json().children as Array<{
        student: { id: string };
        instalments: Instalment[];
        payableNow: string;
        hidden: number;
      }>
    )[0]!;
    expect(child.student.id).toBe(students.child);
    expect(child.instalments.every((i) => i.visible)).toBe(true);
    expect(child.hidden).toBeGreaterThan(0);
    const staffOnly = await inject({
      method: 'GET',
      url: `/fees/students/${students.child}/ledger`,
      headers: h(parent),
    });
    expect(staffOnly.statusCode).toBe(403);

    await setSetting('payments.gateway', 'razorpay');
    const payments = app.get(PaymentsService);
    const orders: unknown[] = [];
    payments.gatewayFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      orders.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: `order_${uid}`,
          amount: 720000,
          currency: 'INR',
          receipt: 'x',
          status: 'created',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const tooMuch = await inject({
      method: 'POST',
      url: '/payments/intents/mine',
      headers: h(parent),
      json: { studentId: students.child, amount: 99999 },
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().type).toBe('payments.amount_exceeds_dues');
    const notMine = await inject({
      method: 'POST',
      url: '/payments/intents/mine',
      headers: h(parent),
      json: { studentId: students.full, amount: 100 },
    });
    expect(notMine.statusCode).toBe(403);

    const created = await inject({
      method: 'POST',
      url: '/payments/intents/mine',
      headers: h(parent),
      json: { studentId: students.child, amount: 7200 },
    });
    expect(created.statusCode).toBe(201);
    const { intent, checkout } = created.json() as {
      intent: { id: string; txnId: string; provider: string };
      checkout: { kind: string; orderId: string; amount: number; callbackUrl: string };
    };
    expect(intent.provider).toBe('razorpay');
    expect(checkout).toMatchObject({ kind: 'razorpay', orderId: `order_${uid}`, amount: 720000 });
    expect(checkout.callbackUrl).toContain('/api/payments/return?provider=razorpay');
    expect(orders[0]).toMatchObject({ amount: 720000, receipt: intent.txnId });

    // forged checkout signature
    const forged = await inject({
      method: 'POST',
      url: '/payments/razorpay/return',
      headers: {},
      json: {
        razorpay_order_id: `order_${uid}`,
        razorpay_payment_id: `pay_${uid}`,
        razorpay_signature: 'deadbeefdeadbeef',
      },
    });
    expect(forged.json().outcome).toBe('rejected');
    // genuine
    const ok = await inject({
      method: 'POST',
      url: '/payments/razorpay/return',
      headers: {},
      json: {
        razorpay_order_id: `order_${uid}`,
        razorpay_payment_id: `pay_${uid}`,
        razorpay_signature: checkoutSignature(`order_${uid}`, `pay_${uid}`, RAZORPAY_SECRET),
      },
    });
    expect(ok.json()).toMatchObject({ outcome: 'applied', status: 'succeeded' });
    // the webhook for the same payment is a duplicate, with a raw-body signature
    const event = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${uid}`,
            order_id: `order_${uid}`,
            amount: 720000,
            status: 'captured',
          },
        },
      },
    };
    const raw = JSON.stringify(event);
    const hook = await inject({
      method: 'POST',
      url: '/payments/razorpay/webhook',
      headers: {
        'x-razorpay-signature': createHmac('sha256', RAZORPAY_WEBHOOK).update(raw).digest('hex'),
      },
      json: event,
    });
    expect(hook.json().outcome).toBe('duplicate');
    const badHook = await inject({
      method: 'POST',
      url: '/payments/razorpay/webhook',
      headers: { 'x-razorpay-signature': 'nope' },
      json: event,
    });
    expect(['rejected', 'duplicate']).toContain(badHook.json().outcome);

    const ledger = await ledgerOf(students.child, '2026-04-09');
    expect(ledger.payments[0]).toMatchObject({ mode: 'online', amount: '7200.00' });
    expect(ledger.payments[0]!.receiptNo).toMatch(/^TF\/FY2026-27\//);
    const mineIntents = await inject({
      method: 'GET',
      url: '/payments/intents/mine',
      headers: h(parent),
    });
    expect((mineIntents.json().data as Array<{ status: string }>)[0]!.status).toBe('succeeded');
  });

  it('CCAvenue: the encrypted response must decrypt and match the order and amount', async () => {
    await setSetting('payments.gateway', 'ccavenue');
    const created = await inject({
      method: 'POST',
      url: '/payments/intents/fee',
      headers: h(accountant),
      json: {
        studentId: students.full,
        amount: 7200,
        payerName: 'Desk',
        payerEmail: 'desk@example.test',
        payerMobile: '9876500099',
      },
    });
    expect(created.statusCode).toBe(201);
    const { intent, form } = created.json() as {
      intent: { txnId: string; provider: string };
      form: { kind: string; fields: { encRequest: string; access_code: string } };
    };
    expect(intent.provider).toBe('ccavenue');
    expect(form.kind).toBe('form');
    expect(ccavenue.decrypt(form.fields.encRequest, CCAVENUE_KEY)).toContain(
      `order_id=${intent.txnId}`,
    );
    const tampered = await inject({
      method: 'POST',
      url: '/payments/ccavenue/return',
      headers: {},
      json: {
        encResp: ccavenue.mockResponse(
          {
            order_id: intent.txnId,
            order_status: 'Success',
            amount: '1.00',
            tracking_id: `Tbad${uid}`,
          },
          CCAVENUE_KEY,
        ),
      },
    });
    expect(tampered.json().outcome).toBe('mismatch');
    const foreign = await inject({
      method: 'POST',
      url: '/payments/ccavenue/return',
      headers: {},
      json: { encResp: 'abcdef0123456789abcdef' },
    });
    expect(foreign.json().outcome).toBe('rejected');
    const ok = await inject({
      method: 'POST',
      url: '/payments/ccavenue/return',
      headers: {},
      json: {
        encResp: ccavenue.mockResponse(
          {
            order_id: intent.txnId,
            order_status: 'Success',
            amount: '7200.00',
            tracking_id: `Tok${uid}`,
          },
          CCAVENUE_KEY,
        ),
      },
    });
    expect(ok.json()).toMatchObject({ outcome: 'applied', status: 'succeeded' });
    await setSetting('payments.gateway', 'mock');
  });

  // ---- settlements -------------------------------------------------------------------------------
  it('matches a settlement file to intents and flags mismatches, unknowns and duplicates', async () => {
    const csv = [
      'payment_id,order_id,amount,fee,tax,type',
      `pay_${uid},order_${uid},7200.00,141.60,25.49,payment`,
      'pay_unknown,,500.00,0,0,payment',
      `Tok${uid},,7100.00,0,0,payment`,
      `rfnd_${uid},,500.00,0,0,refund`,
    ].join('\n');
    const up = await inject({
      method: 'POST',
      url: '/payments/settlements',
      headers: h(accountant),
      json: {
        provider: 'razorpay',
        settlementRef: `setl_${uid}_1`,
        settledOn: '2026-04-12',
        utr: 'UTR13',
        csv,
      },
    });
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({ rows: 4, matched: 1, unmatched: 2, mismatched: 0 });
    const lines = up.json().lines as Array<{ providerRef: string; status: string }>;
    expect(lines.find((l) => l.providerRef === `pay_${uid}`)!.status).toBe('matched');
    expect(lines.find((l) => l.providerRef === `Tok${uid}`)!.status).toBe('unmatched'); // a CCAvenue payment in a Razorpay file
    expect(lines.find((l) => l.providerRef === `rfnd_${uid}`)!.status).toBe('refund');
    const ledger = await ledgerOf(students.child, '2026-04-12');
    expect(ledger.payments[0]!.settled).toBe(true);
    const dup = await inject({
      method: 'POST',
      url: '/payments/settlements',
      headers: h(accountant),
      json: { provider: 'razorpay', settlementRef: `setl_${uid}_1`, settledOn: '2026-04-12', csv },
    });
    expect(dup.statusCode).toBe(409);
    const second = await inject({
      method: 'POST',
      url: '/payments/settlements',
      headers: h(accountant),
      json: {
        provider: 'razorpay',
        settlementRef: `setl_${uid}_2`,
        settledOn: '2026-04-13',
        csv: `payment_id,amount\npay_${uid},7200.00\n`,
      },
    });
    expect((second.json().lines as Array<{ status: string }>)[0]!.status).toBe('duplicate');
    const cc = await inject({
      method: 'POST',
      url: '/payments/settlements',
      headers: h(accountant),
      json: {
        provider: 'ccavenue',
        settlementRef: `CC${uid}`,
        settledOn: '2026-04-13',
        csv: `tracking_id,amount\nTok${uid},7100.00\n`,
      },
    });
    expect((cc.json().lines as Array<{ status: string }>)[0]!.status).toBe('amount_mismatch');
    const list = await inject({ method: 'GET', url: '/payments/settlements', headers: h(teacher) });
    expect(list.statusCode).toBe(403);
  });

  // ---- transport ---------------------------------------------------------------------------------
  it('a family asks for a bus seat; the office decides directly or through the workflow', async () => {
    const mine0 = await inject({
      method: 'GET',
      url: '/transport/requests/mine',
      headers: h(parent),
    });
    expect(mine0.statusCode).toBe(200);
    expect(mine0.json().routes[0]).toMatchObject({ code: 'R1' });
    const leaveFirst = await inject({
      method: 'POST',
      url: '/transport/requests/mine',
      headers: h(parent),
      json: { studentId: students.child, kind: 'leave' },
    });
    expect(leaveFirst.statusCode).toBe(409); // not riding yet
    const join = await inject({
      method: 'POST',
      url: '/transport/requests/mine',
      headers: h(parent),
      json: { studentId: students.child, kind: 'join', routeId, stopId, note: 'From July' },
    });
    expect(join.statusCode).toBe(201);
    expect(join.json()).toMatchObject({
      status: 'pending',
      routeCode: 'R1',
      stopName: 'Karve Nagar',
      workflowInstanceId: null,
    });
    const twice = await inject({
      method: 'POST',
      url: '/transport/requests/mine',
      headers: h(parent),
      json: { studentId: students.child, kind: 'join', routeId },
    });
    expect(twice.statusCode).toBe(409);
    const list = await inject({
      method: 'GET',
      url: '/transport/requests?status=pending',
      headers: h(),
    });
    expect((list.json().data as Array<{ id: string }>).map((r) => r.id)).toContain(join.json().id);
    const denied = await inject({
      method: 'POST',
      url: `/transport/requests/${join.json().id}/decide`,
      headers: h(teacher),
      json: { outcome: 'approved' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await inject({
      method: 'POST',
      url: `/transport/requests/${join.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved', note: 'Seat available' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('approved');
    const riders = await inject({
      method: 'GET',
      url: `/transport/routes/${routeId}/students`,
      headers: h(),
    });
    expect(
      riders.json().data as Array<{ studentId: string; stopName: string; pickupTime: string }>,
    ).toContainEqual(
      expect.objectContaining({
        studentId: students.child,
        stopName: 'Karve Nagar',
        pickupTime: '07:20',
      }),
    );
    // with the default workflow installed, the request waits in the inbox and the completion applies it
    const defaults = await inject({
      method: 'POST',
      url: '/workflow/definitions/defaults',
      headers: h(),
    });
    expect(defaults.statusCode).toBe(201);
    const leave = await inject({
      method: 'POST',
      url: '/transport/requests/mine',
      headers: h(parent),
      json: { studentId: students.child, kind: 'leave', note: 'Moving house' },
    });
    expect(leave.statusCode).toBe(201);
    expect(leave.json().workflowInstanceId).not.toBeNull();
    const direct = await inject({
      method: 'POST',
      url: `/transport/requests/${leave.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(direct.statusCode).toBe(409);
    const step = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM workflow_steps WHERE instance_id = $1 AND status = 'pending' ORDER BY level LIMIT 1`,
        [leave.json().workflowInstanceId],
      );
      return r.rows[0]!.id;
    });
    const approve = await inject({
      method: 'POST',
      url: `/workflow/steps/${step}/approve`,
      headers: h(),
      json: { note: 'ok' },
    });
    expect([200, 201]).toContain(approve.statusCode);
    const mine = await inject({
      method: 'GET',
      url: '/transport/requests/mine',
      headers: h(parent),
    });
    const child = (
      mine.json().children as Array<{
        assignment: unknown;
        requests: Array<{ status: string; kind: string }>;
      }>
    )[0]!;
    expect(child.assignment).toBeNull();
    expect(child.requests[0]).toMatchObject({ kind: 'leave', status: 'approved' });
  });

  it('records vehicle logs per day and lists them', async () => {
    const bad = await inject({
      method: 'PUT',
      url: `/transport/vehicles/${vehicleId}/logs`,
      headers: h(),
      json: { logDate: '2026-04-20', odometerStart: 1000, odometerEnd: 900 },
    });
    expect(bad.statusCode).toBe(400);
    const log = await inject({
      method: 'PUT',
      url: `/transport/vehicles/${vehicleId}/logs`,
      headers: h(),
      json: {
        logDate: '2026-04-20',
        routeId,
        odometerStart: 1000,
        odometerEnd: 1046,
        fuelLitres: 12.5,
        fuelCost: 1150,
        trips: 2,
      },
    });
    expect(log.statusCode).toBe(200);
    expect(log.json()).toMatchObject({ regNo: 'MH12F1300', km: 46, routeCode: 'R1' });
    const again = await inject({
      method: 'PUT',
      url: `/transport/vehicles/${vehicleId}/logs`,
      headers: h(),
      json: {
        logDate: '2026-04-20',
        odometerStart: 1000,
        odometerEnd: 1050,
        incident: 'Flat tyre',
      },
    });
    expect(again.json()).toMatchObject({ km: 50, incident: 'Flat tyre' });
    const list = await inject({
      method: 'GET',
      url: `/transport/vehicles/${vehicleId}/logs?from=2026-04-01`,
      headers: h(accountant),
    });
    expect(list.statusCode).toBe(403);
    const ok = await inject({
      method: 'GET',
      url: `/transport/vehicles/${vehicleId}/logs?from=2026-04-01`,
      headers: h(),
    });
    expect(ok.json().data).toHaveLength(1);
  });

  // ---- department dashboards ---------------------------------------------------------------------
  it('opens department dashboards by module permission and lists their reports', async () => {
    const refresh = await inject({ method: 'POST', url: '/insights/marts/refresh', headers: h() });
    expect(refresh.statusCode).toBe(201);
    const all = await inject({ method: 'GET', url: '/insights/departments', headers: h() });
    expect(all.statusCode).toBe(200);
    expect((all.json().data as Array<{ allowed: boolean }>).every((d) => d.allowed)).toBe(true);
    const acc = await inject({
      method: 'GET',
      url: '/insights/departments',
      headers: h(accountant),
    });
    const cards = acc.json().data as Array<{
      department: string;
      allowed: boolean;
      reports: number;
    }>;
    expect(cards.find((d) => d.department === 'fees')).toMatchObject({ allowed: true });
    expect(cards.find((d) => d.department === 'academics')!.allowed).toBe(false);
    const forbidden = await inject({
      method: 'GET',
      url: '/insights/departments/academics',
      headers: h(accountant),
    });
    expect(forbidden.statusCode).toBe(403);
    const fees = await inject({
      method: 'GET',
      url: '/insights/departments/fees?date=2026-04-20',
      headers: h(accountant),
    });
    expect(fees.statusCode).toBe(200);
    const body = fees.json() as {
      dues: { dueTillDate: string; collectedTillDate: string };
      collection: { today: string };
      byMode30d: unknown[];
      refunds: Array<{ status: string }>;
    };
    expect(Number(body.dues.dueTillDate)).toBeGreaterThan(0);
    expect(Number(body.dues.collectedTillDate)).toBeGreaterThan(0);
    expect(Number(body.collection.today)).toBeGreaterThan(0);
    expect(body.refunds.some((r) => r.status === 'paid')).toBe(true);
    for (const dept of [
      'academics',
      'attendance',
      'admissions',
      'transport',
      'communication',
      'hr',
    ]) {
      const r = await inject({ method: 'GET', url: `/insights/departments/${dept}`, headers: h() });
      expect(r.statusCode).toBe(200);
      expect(r.json().department).toBe(dept);
    }
    const transport = await inject({
      method: 'GET',
      url: '/insights/departments/transport?date=2026-04-20',
      headers: h(),
    });
    expect((transport.json().logs30d as Array<{ regNo: string; km: number }>)[0]).toMatchObject({
      regNo: 'MH12F1300',
      km: 50,
    });
    const unknown = await inject({
      method: 'GET',
      url: '/insights/departments/canteen',
      headers: h(),
    });
    expect(unknown.statusCode).toBe(404);
    const reports = await inject({
      method: 'GET',
      url: '/insights/departments/fees/reports',
      headers: h(accountant),
    });
    const ids = reports.json().data as Array<{ id: string; allowed: boolean }>;
    expect(ids.find((d) => d.id === 'fee_receipts')).toMatchObject({ allowed: true });
    expect(ids.find((d) => d.id === 'settlement_lines')).toMatchObject({ allowed: true });
    const exp = await inject({
      method: 'POST',
      url: '/reports/exports',
      headers: h(accountant),
      json: { dataset: 'fee_receipts', format: 'csv', params: { from: '2026-04-01' } },
    });
    expect(exp.statusCode).toBe(201);
  });
});
