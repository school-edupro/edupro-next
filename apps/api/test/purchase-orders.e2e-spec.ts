/**
 * Purchase, part 4 (docs/design/83): the Purchase Order — approving a requisition drafts one PO per
 * chosen vendor; GST by state (CGST + SGST, IGST, none from an unregistered vendor), reverse charge paid
 * by the school, the MSME 45-day warning; no PO to a pending or blacklisted vendor; changing a PO
 * (discount, freight, a rate-contract rate only with a reason); the maker's level passes on; approval
 * updates the item's last rate and the requisition; the PDF; e-mail to the vendor, logged; amending
 * (R1 approved again, R0 superseded); cancelling needs its right; closing; an emergency purchase
 * ratified by the Principal; the indent's rate-contract bypass drafts its PO at once.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import { gstinCheckChar } from '../src/modules/purchase/gstin';
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

describe('purchase orders (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let teacher: SeededUser;
  let hod: SeededUser;
  let principal: SeededUser;
  const ids: Record<string, string> = {};
  /** the draft POs by their vendor's code */
  const orders: Record<string, string> = {};
  const s = stamp('PO');
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
  const get = async (u: SeededUser, id: string) =>
    (await call(u, 'GET', `/purchase/orders/${id}`)).json();
  const approve = async (id: string, ...who: SeededUser[]) => {
    for (const u of who) {
      const r = await call(u, 'POST', `/purchase/orders/${id}/decide`, { action: 'approve' });
      expect(r.statusCode).toBe(201);
    }
  };
  const gstin = (state: string, body: string) => {
    const g = `${state}${body}`;
    return `${g}${gstinCheckChar(g)}`;
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-po`, 'purchase_office');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      // the HOD also works in the purchase office: a PO they make passes their level on
      hod = await seedUser(c, school, `${s}-hod`, 'purchase_office');
      principal = await seedUser(c, school, `${s}-pr`, 'class_teacher');
      for (const [code, name, designation, dept, u] of [
        ['O1', 'Om Office', 'Purchase Officer', 'Administration', office],
        ['T1', 'Tara Teacher', 'TGT', 'Science', teacher],
        ['H1', 'Hari Head', 'PGT', 'Science', hod],
        ['P1', 'Prem Principal', 'Principal', 'Administration', principal],
      ] as const) {
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
             VALUES ($1, $2, $3, 'E2E', $4, $5, $6) RETURNING id::text`,
            [school.id, `${s}${code}`, name, designation, dept, u.id],
          )
        ).rows[0]!.id;
      }
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(`SELECT app.purchase_seed_masters($1)`, [school.id]);
      // these tests follow a direct PR through its approval levels: no approval by the system
      await c.query(`UPDATE purchase_settings SET direct_pr_limit = 0 WHERE school_id = $1`, [
        school.id,
      ]);
      for (const d of ['Science', 'Administration'])
        ids[d] = (
          await c.query<{ id: string }>(
            `SELECT id::text FROM departments WHERE school_id = $1 AND name = $2`,
            [school.id, d],
          )
        ).rows[0]!.id;
      await c.query(`UPDATE departments SET hod_employee_id = $2 WHERE id = $1`, [
        ids.Science,
        ids.H1,
      ]);
      await c.query(
        `UPDATE purchase_settings SET state_code = '27', delivery_address = 'Main gate store, School Road', billing_address = 'The school office',
                po_terms = 'Goods must match the specification.', purchase_department_id = $2 WHERE school_id = $1`,
        [school.id, ids.Administration],
      );
      ids.NOS = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM purchase_uoms WHERE school_id = $1 AND code = 'NOS'`,
          [school.id],
        )
      ).rows[0]!.id;
      const hsn = async (code: string, kind: string, gst: number, rc: boolean) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_hsn (school_id, code, kind, description, gst_rate, reverse_charge) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (school_id, code) DO UPDATE SET gst_rate = EXCLUDED.gst_rate, reverse_charge = EXCLUDED.reverse_charge RETURNING id::text`,
            [school.id, code, kind, `Test ${code}`, gst, rc],
          )
        ).rows[0]!.id;
      const furniture = await hsn('9403', 'HSN', 18, false);
      const legal = await hsn('998211', 'SAC', 18, true);
      const cat = await c.query<{ id: string }>(
        `INSERT INTO purchase_item_categories (school_id, code, name) VALUES ($1, 'GEN', 'General') RETURNING id::text`,
        [school.id],
      );
      for (const [code, name, h] of [
        ['CHAIR', 'Student chair', furniture],
        ['TABLE', 'Lab table', furniture],
        ['LEGAL', 'Legal opinion', legal],
        ['PEN', 'Ball pen', null],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id, hsn_id)
             VALUES ($1, $2, $3, 'consumable', $4, $5, $6) RETURNING id::text`,
            [school.id, code, name, cat.rows[0]!.id, ids.NOS, h],
          )
        ).rows[0]!.id;
      ids.net60 = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_payment_terms (school_id, code, name) VALUES ($1, 'NET60', 'Net 60') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO purchase_payment_term_lines (school_id, term_id, seq, pct, due_on, days) VALUES ($1, $2, 1, 100, 'invoice', 60)`,
        [school.id, ids.net60],
      );
      for (const [code, name, gs, g, state, status, msme, term] of [
        [
          'V1',
          'Same State Traders',
          'regular',
          gstin('27', 'AAPFU0939F1Z'),
          '27',
          'active',
          null,
          null,
        ],
        [
          'V2',
          'Other State Supplies',
          'regular',
          gstin('29', 'AABCT1332L1Z'),
          '29',
          'active',
          null,
          null,
        ],
        ['V3', 'Local Advocate', 'unregistered', null, '27', 'active', 'micro', ids.net60],
        ['V4', 'Waiting Vendor', 'unregistered', null, '27', 'pending', null, null],
        ['V5', 'Blacklisted Vendor', 'unregistered', null, '27', 'blacklisted', null, null],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO vendors (school_id, code, legal_name, gst_status, gstin, state_code, status, msme_type, payment_term_id, email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`,
            [
              school.id,
              code,
              name,
              gs,
              g,
              state,
              status,
              msme,
              term,
              `${code.toLowerCase()}@vendor.example.test`,
            ],
          )
        ).rows[0]!.id;
      await c.query(
        `INSERT INTO purchase_rate_contracts (school_id, vendor_id, item_id, rate, valid_from, valid_to)
         VALUES ($1, $2, $3, 8.50, CURRENT_DATE - 30, CURRENT_DATE + 300)`,
        [school.id, ids.V1, ids.PEN],
      );
      ids.bill = (
        await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
           VALUES ($1, 'test', $2, 'application/pdf', 1200, 'bill.pdf', 'ready', $3) RETURNING id::text`,
          [school.id, `${s}/bill.pdf`, office.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    for (const [doc, levels] of [
      ['indent', [{ name: 'HOD', by: 'hod' }]],
      ['requisition', [{ name: 'HOD', by: 'hod' }]],
      [
        'order',
        [
          { name: 'HOD', by: 'hod' },
          { name: 'Principal', by: 'designation', designation: 'Principal' },
        ],
      ],
    ] as const)
      expect(
        (await call(admin, 'PUT', `/purchase/approvals/${ids.Science!}/${doc}`, { levels }))
          .statusCode,
      ).toBe(200);
    await call(admin, 'PUT', `/purchase/approvals/${ids.Science!}/rules`, {
      bypassLimit: 0,
      rateContractBypass: true,
    });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('approving a requisition drafts one PO per chosen vendor, with the GST each vendor charges', async () => {
    const pr = (
      await call(office, 'POST', '/purchase/requisitions', {
        departmentId: ids.Science,
        purpose: 'Lab furniture and a legal opinion',
        lines: [
          { itemId: ids.CHAIR, quantity: 4, estRate: 1000 },
          { itemId: ids.TABLE, quantity: 1, estRate: 5000 },
          { itemId: ids.LEGAL, quantity: 1, estRate: 25000 },
        ],
      })
    ).json();
    ids.pr = pr.id;
    const detail = (await call(office, 'GET', `/purchase/requisitions/${ids.pr!}`)).json();
    await call(office, 'PUT', `/purchase/requisitions/${ids.pr!}/choices`, {
      lines: detail.lineItems.map((l: { id: string }, i: number) => ({
        lineId: l.id,
        vendorId: [ids.V1, ids.V2, ids.V3][i],
        rate: [1000, 5000, 25000][i],
      })),
    });
    await call(office, 'PUT', `/purchase/requisitions/${ids.pr!}/certificate`, {
      text: detail.certificateText,
    });
    expect(
      (await call(office, 'POST', `/purchase/requisitions/${ids.pr!}/submit`)).statusCode,
    ).toBe(201);
    expect(
      (await call(hod, 'POST', `/purchase/requisitions/${ids.pr!}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(201);
    const drafts = (await call(office, 'GET', '/purchase/orders?status=draft')).json();
    expect(drafts.data).toHaveLength(3);
    for (const d of drafts.data) orders[d.vendorCode] = d.id;
    const v1 = await get(office, orders.V1!);
    expect(v1).toMatchObject({
      supply: 'intra',
      requisition: pr.number,
      createdBy: 'Om Office E2E',
    });
    expect(v1.totals).toMatchObject({ taxable: 4000, cgst: 360, sgst: 360, igst: 0, total: 4720 });
    expect(v1.lineItems[0]).toMatchObject({ hsnCode: '9403', gstRate: 18, maxQuantity: 4 });
    const v2 = await get(office, orders.V2!);
    expect(v2).toMatchObject({ supply: 'inter' });
    expect(v2.totals).toMatchObject({ cgst: 0, igst: 900, total: 5900 });
    // the advocate: unregistered, the SAC under reverse charge — the school pays the GST; a micro vendor on 60 days
    const v3 = await get(office, orders.V3!);
    expect(v3.totals).toMatchObject({ cgst: 0, igst: 0, rcm: 4500, total: 25000 });
    expect(v3.msmeWarning).toContain('45 days');
    expect(v3.paymentText).toBe('100% 60 days after the invoice');
    expect(v3.words).toBe('twenty five thousand');
  });

  it('no PO to a pending or blacklisted vendor; To order is empty once drafted', async () => {
    const lines = (await call(office, 'GET', `/purchase/requisitions/${ids.pr!}`)).json().lineItems;
    for (const v of [ids.V4, ids.V5]) {
      const r = await call(office, 'POST', '/purchase/orders', {
        requisitionId: ids.pr,
        lineIds: [lines[0].id],
        vendorId: v,
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().type).toBe('purchase.vendor_not_active');
    }
    expect((await call(office, 'GET', '/purchase/to-order')).json().data).toHaveLength(0);
    expect((await call(teacher, 'GET', '/purchase/to-order')).statusCode).toBe(403);
  });

  it('changes a draft: a discount and freight; the quantity no more than the requisition’s', async () => {
    const po = await get(office, orders.V1!);
    const body = (over: Record<string, unknown> = {}) => ({
      quoteRef: 'Q-11',
      deliveryDate: null,
      deliveryAddress: po.deliveryAddress,
      paymentTermId: po.paymentTermId,
      validityDays: 30,
      terms: po.terms,
      freightTerms: 'Free delivery at the school',
      vendorNote: 'Deliver before the exams',
      lines: [
        {
          id: po.lineItems[0].id,
          description: 'Student chair, steel frame',
          hsnCode: '9403',
          quantity: 4,
          rate: 1000,
          discountPct: 10,
          gstRate: 18,
          make: 'Steelcase',
          model: 'CH-12',
          ...over,
        },
      ],
      charges: [{ kind: 'freight', amount: 500, gstRate: 18 }],
    });
    expect(
      (await call(office, 'PUT', `/purchase/orders/${orders.V1!}`, body({ quantity: 5 })))
        .statusCode,
    ).toBe(400);
    const r = await call(office, 'PUT', `/purchase/orders/${orders.V1!}`, body());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ taxable: 4100, cgst: 369, sgst: 369, total: 4838 });
    // printed on the PO: the freight terms, the note, the make and model
    const saved = await get(office, orders.V1!);
    expect(saved).toMatchObject({
      freightTerms: 'Free delivery at the school',
      vendorNote: 'Deliver before the exams',
    });
    expect(saved.lineItems[0]).toMatchObject({ make: 'Steelcase', model: 'CH-12' });
    expect((await call(teacher, 'PUT', `/purchase/orders/${orders.V1!}`, body())).statusCode).toBe(
      403,
    );
  });

  it('the maker’s level passes on; approval updates the item’s last rate and the requisition', async () => {
    // the HOD (also in the purchase office) sends the PO they made: their HOD level passes to the Principal
    const mine = await call(hod, 'POST', '/purchase/orders', {
      requisitionId: ids.pr,
      lineIds: [],
      vendorId: ids.V1,
    });
    expect(mine.statusCode).toBe(400);
    expect((await call(office, 'POST', `/purchase/orders/${orders.V1!}/submit`)).statusCode).toBe(
      201,
    );
    await approve(orders.V1!, hod, principal);
    expect((await get(office, orders.V1!)).status).toBe('approved');
    const chair = await withMigrator((c) =>
      c.query<{ rate: string }>(
        `SELECT last_purchase_rate::text AS rate FROM purchase_items WHERE id = $1`,
        [ids.CHAIR],
      ),
    );
    expect(chair.rows[0]!.rate).toBe('1000.00');
    expect((await call(office, 'GET', `/purchase/requisitions/${ids.pr!}`)).json().status).toBe(
      'part_ordered',
    );
    // V2's PO sent by the HOD-in-the-office: HOD's level passes on, the Principal decides
    expect((await call(hod, 'POST', `/purchase/orders/${orders.V2!}/submit`)).statusCode).toBe(201);
    const v2 = await get(hod, orders.V2!);
    expect(v2.steps[0]).toMatchObject({
      status: 'skipped',
      note: expect.stringContaining('nobody approves their own'),
    });
    expect(
      (await call(hod, 'POST', `/purchase/orders/${orders.V2!}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(403);
    await approve(orders.V2!, principal);
  });

  it('the PDF; the e-mail to the vendor carries it and is logged', async () => {
    const pdf = await call(office, 'GET', `/purchase/orders/${orders.V1!}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call(office, 'GET', `/purchase/orders/${orders.V3!}/pdf`)).statusCode).toBe(200);
    expect(
      (
        await call(office, 'POST', `/purchase/orders/${orders.V3!}/send`, {
          to: 'v3@vendor.example.test',
        })
      ).statusCode,
    ).toBe(409);
    const r = await call(office, 'POST', `/purchase/orders/${orders.V1!}/send`, {
      to: 'V1@vendor.example.test',
    });
    expect(r.statusCode).toBe(201);
    const po = await get(office, orders.V1!);
    expect(po.status).toBe('sent');
    expect(po.sends[0]).toMatchObject({
      to: 'v1@vendor.example.test',
      messageStatus: expect.any(String),
    });
    const msg = await withMigrator((c) =>
      c.query<{
        subject: string;
        attachments: Array<{ fileId: string; contentType: string }>;
        recipient_address: string;
      }>(`SELECT subject, attachments, recipient_address FROM comms_messages WHERE id = $1`, [
        r.json().messageId,
      ]),
    );
    expect(msg.rows[0]!.subject).toContain(po.label);
    expect(msg.rows[0]!.attachments).toEqual([
      expect.objectContaining({ contentType: 'application/pdf' }),
    ]);
  });

  it('amends an approved PO: R1 is approved again and R0 superseded; cancelling needs its right; closing', async () => {
    const a = await call(office, 'POST', `/purchase/orders/${orders.V1!}/amend`, {
      reason: 'Two more chairs',
    });
    expect(a.statusCode).toBe(201);
    ids.r1 = a.json().id;
    expect(a.json().label).toMatch(/-R1$/);
    expect((await get(office, orders.V1!)).can.amend).toBe(false);
    const r1 = await get(office, ids.r1!);
    expect(r1).toMatchObject({ status: 'draft', revision: 1, amendReason: 'Two more chairs' });
    expect(r1.lineItems[0].maxQuantity).toBe(4);
    await call(office, 'POST', `/purchase/orders/${ids.r1!}/submit`);
    await approve(ids.r1!, hod, principal);
    expect((await get(office, orders.V1!)).status).toBe('superseded');
    expect((await get(office, ids.r1!)).revisions.map((x: { status: string }) => x.status)).toEqual(
      ['superseded', 'approved'],
    );
    // the purchase office cannot cancel an approved PO; the school admin can
    expect(
      (
        await call(office, 'POST', `/purchase/orders/${orders.V2!}/cancel`, {
          reason: 'Vendor cannot deliver',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(admin, 'POST', `/purchase/orders/${orders.V2!}/cancel`, {
          reason: 'Vendor cannot deliver',
        })
      ).statusCode,
    ).toBe(201);
    // its line is to order again
    expect((await call(office, 'GET', '/purchase/to-order')).json().data[0].lines[0].item).toBe(
      'Lab table',
    );
    expect(
      (
        await call(office, 'POST', `/purchase/orders/${ids.r1!}/close`, {
          reason: 'All chairs received',
        })
      ).statusCode,
    ).toBe(201);
    expect((await get(office, ids.r1!)).status).toBe('closed');
  });

  it('an emergency purchase is recorded with the bill and ratified by the Principal', async () => {
    const body = {
      vendorId: ids.V3,
      reason: 'Pipe burst in the junior block on Sunday night',
      billFileId: ids.bill,
      billRef: 'B-77',
      lines: [{ description: 'Plumbing repair', quantity: 1, uomId: ids.NOS, rate: 8000 }],
    };
    expect((await call(teacher, 'POST', '/purchase/emergency-purchases', body)).statusCode).toBe(
      403,
    );
    // a file the user did not upload is not the bill
    const noBill = await call(office, 'POST', '/purchase/emergency-purchases', {
      ...body,
      billFileId: '999999999999',
    });
    expect([noBill.statusCode, noBill.json().detail]).toEqual([
      400,
      expect.stringContaining('bill'),
    ]);
    const r = await call(office, 'POST', '/purchase/emergency-purchases', body);
    expect(r.statusCode).toBe(201);
    ids.em = r.json().id;
    expect((await call(office, 'POST', `/purchase/orders/${ids.em!}/submit`)).statusCode).toBe(201);
    const em = await get(office, ids.em!);
    expect(em).toMatchObject({
      emergency: true,
      department: 'Administration',
      can: { send: false },
    });
    expect(em.waitingWith).toContain('Prem Principal');
    await approve(ids.em!, principal);
    const list = (await call(office, 'GET', '/purchase/orders?emergency=1')).json();
    expect(list.data.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([
      [ids.em, 'approved'],
    ]);
    // switched off: none recorded
    await withMigrator((c) =>
      c.query(`UPDATE purchase_settings SET emergency_enabled = false WHERE school_id = $1`, [
        school.id,
      ]),
    );
    expect((await call(office, 'POST', '/purchase/emergency-purchases', body)).json().type).toBe(
      'purchase.emergency_off',
    );
  });

  it('an indent on rate contract drafts its PO at once; the contract rate changes only with a reason', async () => {
    const pi = (
      await call(teacher, 'POST', '/purchase/indents', {
        purpose: 'Exam pens',
        lines: [{ itemId: ids.PEN, quantity: 100 }],
      })
    ).json();
    await call(teacher, 'POST', `/purchase/indents/${pi.id as string}/submit`);
    expect(
      (
        await call(hod, 'POST', `/purchase/indents/${pi.id as string}/decide`, {
          action: 'approve',
        })
      ).json(),
    ).toMatchObject({
      route: 'to_order',
      bypassRule: 'rate_contract',
    });
    const draft = (await call(office, 'GET', '/purchase/orders?status=draft'))
      .json()
      .data.find(
        (x: { vendorCode: string; requisitionId: string | null }) =>
          x.vendorCode === 'V1' && x.requisitionId,
      );
    const po = await get(office, draft.id);
    expect(po.lineItems[0]).toMatchObject({ rate: 8.5, contractRate: 8.5, quantity: 100 });
    expect(po.createdBy).toBeNull();
    const change = (reason?: string) =>
      call(office, 'PUT', `/purchase/orders/${draft.id as string}`, {
        validityDays: 30,
        lines: [
          {
            id: po.lineItems[0].id,
            description: 'Ball pen',
            quantity: 100,
            rate: 9,
            gstRate: 0,
            ...(reason ? { rateChangeReason: reason } : {}),
          },
        ],
      });
    const no = await change();
    expect(no.statusCode).toBe(400);
    expect(no.json().type).toBe('purchase.contract_rate');
    expect((await change('The contract rate excludes the new refill')).statusCode).toBe(200);
  });

  it('the reports and the dashboard match what was done; every report as Excel and PDF', async () => {
    const rep = async (name: string, qs = '') => {
      const r = await call(office, 'GET', `/purchase/reports/${name}${qs}`);
      expect(r.statusCode).toBe(200);
      return r.json() as {
        rows: unknown[][];
        columns: Array<{ label: string }>;
        totals?: unknown[];
      };
    };
    const col = (r: { columns: Array<{ label: string }> }, label: string) =>
      r.columns.findIndex((c) => c.label === label);
    expect((await call(teacher, 'GET', '/purchase/reports/po_register')).statusCode).toBe(403);
    expect((await call(office, 'GET', '/purchase/reports/nonsense')).statusCode).toBe(404);
    const po = await rep('po_register');
    expect(po.rows).toHaveLength(6);
    const ov = await rep('overrides');
    expect(new Set(ov.rows.map((r) => r[0]))).toEqual(
      new Set([
        'PR skipped: rate contract',
        'Emergency purchase',
        'Order cancelled after approval',
        'Order amended',
        'Contract rate changed',
      ]),
    );
    expect((await rep('overrides', '?status=emergency')).rows).toHaveLength(1);
    // spend counts placed orders: R1 (closed) and the emergency purchase (ratified)
    const vend = await rep('vendor_purchases');
    expect(vend.rows.map((r) => [r[0], r[4], r[7]])).toEqual([
      ['V3', 1, 8000],
      ['V1', 1, 4838],
    ]);
    const msme = await rep('msme_vendors');
    expect(msme.rows[0]!.slice(0, 3)).toEqual(['V3', 'Local Advocate', 'Micro']);
    expect(msme.rows[0]![col(msme, 'Over 45 days')]).toBe('Yes');
    const gst = await rep('gst_summary');
    expect(gst.rows.find((r) => r[0] === '9403')!.slice(3, 5)).toEqual([3600, 324]);
    expect(gst.rows.find((r) => r[0] === 'Other charges')!.slice(3, 5)).toEqual([500, 45]);
    expect((await rep('tracker')).rows[0]![0]).toMatch(/^PI\//);
    expect((await rep('pr_register')).rows).toHaveLength(2);
    expect((await rep('item_history')).rows).toHaveLength(2);
    const dash = (await call(office, 'GET', '/purchase/dashboard')).json();
    expect(dash.figures).toMatchObject({
      pending: 0,
      toOrder: 1,
      ordersThisMonth: 2,
      ordersThisMonthValue: 12838,
    });
    expect(dash.figures.toOrder).toBe(
      (await call(office, 'GET', '/purchase/to-order'))
        .json()
        .data.reduce((a: number, g: { lines: unknown[] }) => a + g.lines.length, 0),
    );
    expect(dash.largest[0]).toMatchObject({ total: 8000 });
    for (const name of [
      'pi_register',
      'pr_register',
      'po_register',
      'tracker',
      'pending',
      'overrides',
      'department_spend',
      'vendor_purchases',
      'item_history',
      'comparative',
      'gst_summary',
      'msme_vendors',
    ])
      for (const format of ['xlsx', 'pdf']) {
        const f = await call(office, 'GET', `/purchase/reports/${name}?format=${format}`);
        expect([name, format, f.statusCode]).toEqual([name, format, 200]);
        expect(f.json().filename).toMatch(new RegExp(`\\.${format}$`));
      }
  });
  it('the orders list filters by vendor, department and dates; its file (Excel with the lines, PDF)', async () => {
    const list = async (qs: string) =>
      (await call(office, 'GET', `/purchase/orders?${qs}`)).json().data as Array<{
        vendorId: string;
      }>;
    const v1 = await list(`vendorId=${ids.V1!}`);
    expect(v1.length).toBeGreaterThan(0);
    expect(v1.every((x) => x.vendorId === ids.V1)).toBe(true);
    expect(await list('from=2099-01-01')).toEqual([]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect((await list(`from=${today}&to=${today}`)).length).toBeGreaterThan(0);
    const x = await call(office, 'GET', `/purchase/orders/export?format=xlsx&vendorId=${ids.V1!}`);
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(x.json().base64 as string, 'base64') as unknown as ExcelJS.Buffer,
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Purchase Orders', 'Lines']);
    const pdf = (await call(office, 'GET', '/purchase/orders/export?format=pdf')).json();
    expect(
      Buffer.from(pdf.base64 as string, 'base64')
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });
});
