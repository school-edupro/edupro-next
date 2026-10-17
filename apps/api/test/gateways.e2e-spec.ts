/**
 * Payment gateways set up by the school (0142): accounts with test / live keys (never returned), which fee
 * each gateway takes, the payer's choice and the convenience charge, and each gateway's signed answer
 * checked with the school account's own keys: PayU (hash), CCAvenue (working key), SBI ePay (AES key) and
 * Atom (response hash). A misc fee paid online writes its MF receipt.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as atom from '../src/modules/payments/adapters/atom';
import * as ccavenue from '../src/modules/payments/adapters/ccavenue';
import * as razorpay from '../src/modules/payments/adapters/razorpay';
import * as sbiepay from '../src/modules/payments/adapters/sbiepay';
import { mockResponse } from '../src/modules/payments/payu';
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

describe('payment gateways (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let parent: SeededUser;
  let child = '';
  const gw: Record<string, string> = {};
  const h = (u: SeededUser = admin, extra = '') => headersFor(`${u.sub}${extra}`, school.id);
  const SBI_KEY = Buffer.from('0123456789abcdef').toString('base64');
  const REQ_ENC = 'A4476C2062FFA58980DC8F79EB6A799E';
  const RES_DEC = '75AEF0FA1B94B3C10D4F5B268F757F11';

  beforeAll(async () => {
    const s = stamp('GWY');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(`UPDATE users SET email = $2 WHERE id = $1`, [
        parent.id,
        `${s.toLowerCase()}@example.test`,
      ]);
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'V', name: 'Class V', displayOrder: 5 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id as string}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const tui = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition', sortOrder: 1 },
    });
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    await inject({
      method: 'PUT',
      url: `/fees/structures/${cls.json().id as string}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [{ headId: tui.json().id, amount: 1000, frequency: 'monthly' }],
      },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-K`,
        firstName: 'Kid',
        lastName: 'Gateway',
        dob: '2016-01-01',
        admittedOn: '2026-04-05',
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    child = st.json().id as string;
    await inject({ method: 'POST', url: `/fees/students/${child}/demands/generate`, headers: h() });
    await withMigrator(async (c) => {
      const g = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, mobile, user_id) VALUES ($1, 'Pay', 'Parent', '9876500999', $2) RETURNING id`,
        [school.id, parent.id],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true)`,
        [school.id, child, g.rows[0]!.id],
      );
    });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('only the school admin, after a fresh strong sign-in, sets up gateways; keys are never shown again', async () => {
    const body = {
      provider: 'payu',
      label: 'PayU school',
      mode: 'test',
      config: { merchantKey: 'gwKey123' },
      secret: { salt: 'gwSalt-very-secret' },
      chargePercent: 1.5,
      chargeFlat: 5,
      active: true,
    };
    expect(
      (
        await inject({
          method: 'PUT',
          url: '/payments/gateways',
          headers: h(accountant),
          json: body,
        })
      ).statusCode,
    ).toBe(403);
    const stale = await inject({
      method: 'PUT',
      url: '/payments/gateways',
      headers: h(admin, ';mfa=false'),
      json: body,
    });
    expect(stale.statusCode).toBe(403);
    // a live gateway must have every key
    const half = await inject({
      method: 'PUT',
      url: '/payments/gateways',
      headers: h(),
      json: {
        ...body,
        provider: 'ccavenue',
        label: 'CCA',
        config: { merchantId: 'M1' },
        secret: {},
      },
    });
    expect(half.statusCode).toBe(422);
    const saved = await inject({
      method: 'PUT',
      url: '/payments/gateways',
      headers: h(),
      json: body,
    });
    expect(saved.statusCode).toBe(200);
    const row = (saved.json().data as Array<Record<string, unknown>>)[0]!;
    expect(row).toMatchObject({
      provider: 'payu',
      mode: 'test',
      secretsSaved: ['salt'],
      config: { merchantKey: 'gwKey123' },
    });
    expect(JSON.stringify(saved.json())).not.toContain('gwSalt-very-secret');
    gw.payu = row.id as string;
    for (const [provider, label, config, secret] of [
      [
        'ccavenue',
        'CCAvenue hostel',
        { merchantId: 'M77', accessCode: 'AC77' },
        { workingKey: 'WK77workingkey' },
      ],
      ['sbiepay', 'SBI ePay', { merchantId: '1000003' }, { key: SBI_KEY }],
      [
        'atom',
        'Atom',
        { login: '197', productId: 'NSE' },
        {
          password: 'Test@123',
          reqEncKey: REQ_ENC,
          resDecKey: RES_DEC,
          resHashKey: 'KEYRESP123657234',
        },
      ],
    ] as const) {
      const r = await inject({
        method: 'PUT',
        url: '/payments/gateways',
        headers: h(),
        json: {
          provider,
          label,
          mode: 'test',
          config,
          secret,
          chargePercent: 0,
          chargeFlat: 0,
          active: true,
        },
      });
      expect(r.statusCode).toBe(200);
      gw[provider] = (r.json().data as Array<{ id: string; provider: string }>).find(
        (g) => g.provider === provider,
      )!.id;
    }
    // an empty key box keeps the saved key
    const keep = await inject({
      method: 'PUT',
      url: '/payments/gateways',
      headers: h(),
      json: { ...body, id: gw.payu, secret: {} },
    });
    expect(
      (keep.json().data as Array<{ id: string; secretsSaved: string[] }>).find(
        (g) => g.id === gw.payu,
      )!.secretsSaved,
    ).toEqual(['salt']);
    // school fee by PayU, hostel by CCAvenue, misc by SBI ePay or Atom (the payer chooses)
    const routes = await inject({
      method: 'PUT',
      url: '/payments/gateways/routes',
      headers: h(),
      json: { school: [gw.payu], hostel: [gw.ccavenue], misc: [gw.sbiepay, gw.atom] },
    });
    expect(routes.statusCode).toBe(200);
  });

  it('the parent sees the gateways of a fee with the charge; PayU checks with the school account and posts the fee only', async () => {
    const opts = await inject({
      method: 'GET',
      url: '/payments/gateways/options?ledger=misc',
      headers: h(parent),
    });
    expect((opts.json().data as Array<{ label: string }>).map((o) => o.label)).toEqual([
      'SBI ePay',
      'Atom',
    ]);
    const created = await inject({
      method: 'POST',
      url: '/payments/intents/mine',
      headers: h(parent),
      json: { studentId: child, amount: 1000, ledger: 'school' },
    });
    expect(created.statusCode).toBe(201);
    const { intent, checkout } = created.json() as {
      intent: {
        id: string;
        txnId: string;
        provider: string;
        amount: string;
        charge: string;
        gatewayId: string;
      };
      checkout: { action: string; fields: Record<string, string> };
    };
    // 1.5% of 1000 + 5 = 20 on top
    expect(intent).toMatchObject({
      provider: 'payu',
      amount: '1020.00',
      charge: '20.00',
      gatewayId: gw.payu,
    });
    expect(checkout.action).toBe('https://test.payu.in/_payment');
    expect(checkout.fields.key).toBe('gwKey123');
    expect(checkout.fields.surl).toContain(`gw=${gw.payu}`);
    // a forged answer (signed with another salt) is refused; the school's salt is accepted once
    const forged = mockResponse(checkout.fields as never, 'success', 'gwKey123', 'some-other-salt');
    const bad = await inject({
      method: 'POST',
      url: `/payments/payu/return?gw=${gw.payu}`,
      headers: {},
      json: forged,
    });
    expect(bad.json().outcome).toBe('rejected');
    const good = mockResponse(
      checkout.fields as never,
      'success',
      'gwKey123',
      'gwSalt-very-secret',
    );
    const ok = await inject({
      method: 'POST',
      url: `/payments/payu/return?gw=${gw.payu}`,
      headers: {},
      json: good,
    });
    expect(ok.json()).toMatchObject({ outcome: 'applied', status: 'succeeded' });
    const pay = await withMigrator((c) =>
      c.query<{ amount: string; convenience_charge: string; mode: string }>(
        `SELECT amount::text, convenience_charge::text, mode FROM fee_payments WHERE intent_id = $1`,
        [intent.id],
      ),
    );
    expect(pay.rows[0]).toEqual({ amount: '1000.00', convenience_charge: '20.00', mode: 'online' });
  });

  it('a gateway not set up for the fee cannot be chosen; CCAvenue opens only with the school working key', async () => {
    const wrong = await inject({
      method: 'POST',
      url: '/payments/intents/mine',
      headers: h(parent),
      json: { studentId: child, amount: 500, ledger: 'school', gatewayId: gw.atom },
    });
    expect(wrong.statusCode).toBe(409);
    // a CCAvenue answer that was not encrypted with the school's working key is refused
    const fake = ccavenue.encrypt('order_id=X&order_status=Success&amount=1.00', 'another-key');
    const r = await inject({
      method: 'POST',
      url: `/payments/ccavenue/return?gw=${gw.ccavenue}`,
      headers: {},
      json: { encResp: fake },
    });
    expect(r.json().outcome).toBe('rejected');
    // a live account from this computer (localhost) would only show the gateway's own error page:
    // refused here with a clear reason, nothing is recorded
    await withMigrator((c) =>
      c.query(`UPDATE payment_gateways SET mode = 'live' WHERE id = $1`, [gw.payu]),
    );
    const live = await inject({
      method: 'POST',
      url: '/payments/intents/mine',
      headers: h(parent),
      json: { studentId: child, amount: 100, ledger: 'school', gatewayId: gw.payu },
    });
    await withMigrator((c) =>
      c.query(`UPDATE payment_gateways SET mode = 'test' WHERE id = $1`, [gw.payu]),
    );
    expect(live.json()).toMatchObject({ type: expect.stringContaining('payment.live_on_local') });
  });

  it('a misc fee is paid online in full by SBI ePay or Atom and writes its MF receipt', async () => {
    const lines = await withMigrator(async (c) => {
      const head = await c.query<{ id: string }>(
        `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order) VALUES ($1, 'TRIP', 'Trip', 'misc', 'misc', 50) RETURNING id::text`,
        [school.id],
      );
      const out: string[] = [];
      for (const title of ['Science trip', 'Sports kit']) {
        const f = await c.query<{ id: string }>(
          `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, mandatory, status, announced_at)
           VALUES ($1, $2, $3, $4, 750, CURRENT_DATE + 20, true, 'announced', now()) RETURNING id::text`,
          [school.id, school.yearId, head.rows[0]!.id, title],
        );
        const l = await c.query<{ id: string }>(
          `INSERT INTO misc_fee_students (school_id, misc_fee_id, student_id, amount) VALUES ($1, $2, $3, 750) RETURNING id::text`,
          [school.id, f.rows[0]!.id, child],
        );
        out.push(l.rows[0]!.id);
      }
      return out;
    });
    // SBI ePay
    const a = await inject({
      method: 'POST',
      url: '/payments/intents/mine/misc',
      headers: h(parent),
      json: { lineId: lines[0], gatewayId: gw.sbiepay },
    });
    expect(a.statusCode).toBe(201);
    const ai = a.json() as {
      intent: { txnId: string; amount: string };
      checkout: { action: string; fields: Record<string, string> };
    };
    expect(ai.intent.amount).toBe('750.00');
    expect(ai.checkout.action).toBe(sbiepay.SBIEPAY_URLS.test);
    expect(sbiepay.decrypt(ai.checkout.fields.EncryptTrans!, SBI_KEY)).toContain(ai.intent.txnId);
    const enc = sbiepay.mockResponse(ai.intent.txnId, '750.00', 'success', SBI_KEY);
    const ra = await inject({
      method: 'POST',
      url: `/payments/sbiepay/return?gw=${gw.sbiepay}`,
      headers: {},
      json: { encData: enc },
    });
    expect(ra.json()).toMatchObject({ outcome: 'applied', status: 'succeeded' });
    // Atom AIPAY: our server asks Atom for a token (Atom stood in for here); the browser opens Atom's checkout
    const sent: string[] = [];
    app.get(PaymentsService).gatewayFetch = (async (url: string, init?: { body?: string }) => {
      sent.push(String(url));
      const asked = atom.decrypt(
        new URLSearchParams(init?.body ?? '').get('encData') ?? '',
        REQ_ENC,
      );
      expect(asked).toContain('"api":"AUTH"');
      const answer = atom.encrypt(
        JSON.stringify({
          atomTokenId: 15000000085830,
          responseDetails: { txnStatusCode: 'OTS0000' },
        }),
        RES_DEC,
      );
      return new Response(`merchId=197&encData=${answer}`, { status: 200 });
    }) as never;
    const b = await inject({
      method: 'POST',
      url: '/payments/intents/mine/misc',
      headers: h(parent),
      json: { lineId: lines[1], gatewayId: gw.atom },
    });
    expect(b.statusCode).toBe(201);
    const bi = b.json() as {
      intent: { txnId: string };
      checkout: { kind: string; atomTokenId: string; scriptUrl: string; env: string };
    };
    expect(sent).toEqual([atom.ATOM_URLS.test]);
    expect(bi.checkout).toMatchObject({
      kind: 'atom',
      atomTokenId: '15000000085830',
      scriptUrl: atom.ATOM_SCRIPTS.test,
      env: 'uat',
    });
    // an answer signed with another hash key is refused; one that does not open with the key too
    const forged = {
      encData: atom.mockResponse(
        bi.intent.txnId,
        '750.00',
        '197',
        'success',
        RES_DEC,
        'not-the-key',
      ),
    };
    expect(
      (
        await inject({
          method: 'POST',
          url: `/payments/atom/return?gw=${gw.atom}`,
          headers: {},
          json: forged,
        })
      ).json().outcome,
    ).toBe('rejected');
    const unreadable = {
      encData: atom.mockResponse(
        bi.intent.txnId,
        '750.00',
        '197',
        'success',
        'another-key-000',
        'KEYRESP123657234',
      ),
    };
    expect(
      (
        await inject({
          method: 'POST',
          url: `/payments/atom/return?gw=${gw.atom}`,
          headers: {},
          json: unreadable,
        })
      ).json().outcome,
    ).toBe('rejected');
    const real = {
      encData: atom.mockResponse(
        bi.intent.txnId,
        '750.00',
        '197',
        'success',
        RES_DEC,
        'KEYRESP123657234',
      ),
    };
    expect(
      (
        await inject({
          method: 'POST',
          url: `/payments/atom/return?gw=${gw.atom}`,
          headers: {},
          json: real,
        })
      ).json(),
    ).toMatchObject({
      outcome: 'applied',
      status: 'succeeded',
    });
    const paid = await withMigrator((c) =>
      c.query<{ status: string; receipt: string | null; mode: string | null }>(
        `SELECT l.status, r.receipt_no AS receipt, r.mode FROM misc_fee_students l LEFT JOIN misc_receipts r ON r.misc_fee_student_id = l.id
          WHERE l.id = ANY($1::bigint[]) ORDER BY l.id`,
        [lines],
      ),
    );
    expect(paid.rows.map((r) => r.status)).toEqual(['paid', 'paid']);
    expect(paid.rows.every((r) => r.receipt && r.mode === 'online')).toBe(true);
    // a paid misc fee cannot be paid again
    const again = await inject({
      method: 'POST',
      url: '/payments/intents/mine/misc',
      headers: h(parent),
      json: { lineId: lines[0] },
    });
    expect(again.statusCode).toBe(409);
  });

  it('Razorpay is set up without a webhook secret; then no webhook is trusted, the URL is shown for the dashboard', async () => {
    const r = await inject({
      method: 'PUT',
      url: '/payments/gateways',
      headers: h(),
      json: {
        provider: 'razorpay',
        label: 'Razorpay test',
        mode: 'test',
        config: { keyId: 'rzp_test_dummy000001' },
        secret: { keySecret: 'dummy-key-secret-for-tests' },
        chargePercent: 0,
        chargeFlat: 0,
        active: true,
      },
    });
    expect(r.statusCode).toBe(200);
    const row = (
      r.json().data as Array<{
        id: string;
        provider: string;
        secretsSaved: string[];
        webhookUrl: string;
      }>
    ).find((g) => g.provider === 'razorpay')!;
    expect(row.secretsSaved).toEqual(['keySecret']);
    expect(row.webhookUrl).toMatch(new RegExp(`/api/v1/payments/razorpay/webhook\\?gw=${row.id}$`));
    // a "captured" webhook signed with the empty key is refused
    const body = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_x1', order_id: 'order_x1', status: 'captured', amount: 100 },
        },
      },
    };
    const raw = JSON.stringify(body);
    const hook = await inject({
      method: 'POST',
      url: `/payments/razorpay/webhook?gw=${row.id}`,
      headers: { 'x-razorpay-signature': razorpay.webhookSignature(raw, '') },
      json: body,
    });
    expect(JSON.stringify(hook.json())).not.toContain('"applied"');
    expect(hook.json().outcome).not.toBe('applied');
  });
});
