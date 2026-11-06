/**
 * Purchase phase 2, part 7 (docs/design/84): goods received against a PO and services' completion
 * certificates — the PO's maker cannot receive it; beyond the PO only within the tolerance; a batch for
 * a batch item; refused at the door with the reason; the department's HOD inspects (nobody inspects
 * what they received), accepting part and rejecting part; the accepted quantity enters the store at the
 * PO line's cost with GST and its share of freight; what came for the indent is issued at once to its
 * department; a rejected receipt; a cancelled one; the PO closes by itself when everything is accepted
 * and can then not be cancelled or amended; above the committee limit the committee signs (a changed
 * inspection signed again), serial numbers; the PDF and the reports.
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

describe('purchase receipts (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let keeper: SeededUser;
  let hod: SeededUser;
  let teacher: SeededUser;
  let m1: SeededUser;
  let m2: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('GR');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const balance = (item: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{ qty: string; value: string }>(
            `SELECT qty::text, value::text FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
            [ids.main, item],
          )
        ).rows[0],
    );
  const poLines = (po: string) =>
    withMigrator(async (c) =>
      (
        await c.query<{ seq: number; received: string; accepted: string; rejected: string }>(
          `SELECT seq, received_qty::text AS received, accepted_qty::text AS accepted, rejected_qty::text AS rejected
               FROM purchase_order_lines WHERE order_id = $1 ORDER BY seq`,
          [po],
        )
      ).rows.map((r) => [r.seq, Number(r.received), Number(r.accepted), Number(r.rejected)]),
    );
  const lineOf = (form: { lines: Array<{ id: string; seq: number }> }, seq: number) =>
    form.lines.find((l) => l.seq === seq)!.id;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-po`, 'purchase_office');
      keeper = await seedUser(c, school, `${s}-sk`, 'store_keeper');
      hod = await seedUser(c, school, `${s}-hod`, 'class_teacher');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      m1 = await seedUser(c, school, `${s}-m1`, 'class_teacher');
      m2 = await seedUser(c, school, `${s}-m2`, 'class_teacher');
      for (const [code, name, dept, u] of [
        ['O1', 'Om Office', 'Administration', office],
        ['K1', 'Kamla Keeper', 'Administration', keeper],
        ['H1', 'Hari Head', 'Science', hod],
        ['T1', 'Tara Teacher', 'Science', teacher],
        ['M1', 'Mira Member', 'Administration', m1],
        ['M2', 'Mohan Member', 'Administration', m2],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
             VALUES ($1, $2, $3, 'E2E', 'Staff', $4, $5) RETURNING id::text`,
            [school.id, `${s}${code}`, name, dept, u.id],
          )
        ).rows[0]!.id;
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(`SELECT app.purchase_seed_masters($1)`, [school.id]);
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
        `UPDATE purchase_settings SET state_code = '27', purchase_department_id = $2 WHERE school_id = $1`,
        [school.id, ids.Administration],
      );
      for (const m of [ids.M1, ids.M2])
        await c.query(
          `INSERT INTO purchase_committee_members (school_id, employee_id, role) VALUES ($1, $2, 'Member')`,
          [school.id, m],
        );
      const uom = async (code: string) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM purchase_uoms WHERE school_id = $1 AND code = $2`,
            [school.id, code],
          )
        ).rows[0]!.id;
      ids.NOS = await uom('NOS');
      ids.BOX = await uom('BOX');
      const cat = await c.query<{ id: string }>(
        `INSERT INTO purchase_item_categories (school_id, code, name) VALUES ($1, 'GEN', 'General') RETURNING id::text`,
        [school.id],
      );
      for (const [code, name, type, unit, batch] of [
        ['PEN', 'Ball pen', 'consumable', ids.BOX, false],
        ['CHEM', 'Copper sulphate 500 g', 'consumable', ids.NOS, true],
        ['LAP', 'Laptop', 'asset', ids.NOS, false],
        ['FIX', 'Plumbing repair', 'service', ids.NOS, false],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id, tracks_batch)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
            [school.id, code, name, type, cat.rows[0]!.id, unit, batch],
          )
        ).rows[0]!.id;
      // pens are bought by the box of 10 and kept as pieces
      await c.query(
        `UPDATE purchase_items SET stock_uom_id = $2, stock_per_unit = 10 WHERE id = $1`,
        [ids.PEN, ids.NOS],
      );
      ids.V1 = (
        await c.query<{ id: string }>(
          `INSERT INTO vendors (school_id, code, legal_name, gst_status, state_code, status)
           VALUES ($1, 'V1', 'Same State Traders', 'unregistered', '27', 'active') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      // an approved indent of Science: 1 box of pens, 4 bottles; on a PR that buys 5 boxes (4 for the store)
      ids.PI = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_indents (school_id, number, department_id, raised_by, purpose, status, route)
           VALUES ($1, $2, $3, $4, 'Lab and class supplies', 'approved', 'ordered') RETURNING id::text`,
          [school.id, `PI/${s}/1`, ids.Science, teacher.id],
        )
      ).rows[0]!.id;
      const pil = async (seq: number, item: string, qty: number, unit: string) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_indent_lines (school_id, indent_id, seq, item_id, quantity, uom_id) VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id::text`,
            [school.id, ids.PI, seq, item, qty, unit],
          )
        ).rows[0]!.id;
      const pilPen = await pil(1, ids.PEN!, 1, ids.BOX!);
      const pilChem = await pil(2, ids.CHEM!, 4, ids.NOS!);
      ids.PR = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_requisitions (school_id, number, department_id, purpose, status, created_by)
           VALUES ($1, $2, $3, 'Supplies', 'ordered', $4) RETURNING id::text`,
          [school.id, `PR/${s}/1`, ids.Science, office.id],
        )
      ).rows[0]!.id;
      const prl = async (seq: number, item: string, qty: number, unit: string, src: string) => {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_requisition_lines (school_id, requisition_id, seq, item_id, quantity, uom_id, vendor_id, rate)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING id::text`,
            [school.id, ids.PR, seq, item, qty, unit, ids.V1],
          )
        ).rows[0]!.id;
        await c.query(
          `INSERT INTO purchase_requisition_sources (school_id, requisition_line_id, indent_line_id, quantity) VALUES ($1, $2, $3, $4)`,
          [school.id, id, src, seq === 1 ? 1 : 4],
        );
        return id;
      };
      const prlPen = await prl(1, ids.PEN!, 5, ids.BOX!, pilPen);
      const prlChem = await prl(2, ids.CHEM!, 4, ids.NOS!, pilChem);
      const po = async (n: string, dept: string, total: number) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_orders (school_id, number, status, requisition_id, department_id, vendor_id, vendor_gst_status,
                                          taxable, total, approved_at, created_by)
             VALUES ($1, $2, 'approved', $3, $4, $5, 'unregistered', $6, $6, now(), $7) RETURNING id::text`,
            [school.id, `PO/${s}/${n}`, n === '1' ? ids.PR : null, dept, ids.V1, total, office.id],
          )
        ).rows[0]!.id;
      // PO 1 (Science): 5 boxes at ₹100 + 18% GST, 4 bottles at ₹50, a repair; ₹100 freight
      ids.PO1 = await po('1', ids.Science!, 1980);
      for (const [seq, item, prlId, desc, qty, unit, rate, gst] of [
        [1, ids.PEN, prlPen, 'Ball pen', 5, ids.BOX, 100, 90],
        [2, ids.CHEM, prlChem, 'Copper sulphate 500 g', 4, ids.NOS, 50, 0],
        [3, ids.FIX, null, 'Plumbing repair', 1, ids.NOS, 1000, 0],
      ] as const)
        await c.query(
          `INSERT INTO purchase_order_lines (school_id, order_id, seq, requisition_line_id, item_id, description, quantity, uom_id, rate,
                                             gst_rate, taxable, cgst, sgst, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)`,
          [
            school.id,
            ids.PO1,
            seq,
            prlId,
            item,
            desc,
            qty,
            unit,
            rate,
            gst ? 18 : 0,
            qty * rate,
            gst / 2,
            qty * rate + gst,
          ],
        );
      await c.query(
        `INSERT INTO purchase_order_charges (school_id, order_id, kind, amount, total) VALUES ($1, $2, 'freight', 100, 100)`,
        [school.id, ids.PO1],
      );
      // PO 2 (Administration) above the committee limit: two laptops
      ids.PO2 = await po('2', ids.Administration!, 300000);
      await c.query(
        `INSERT INTO purchase_order_lines (school_id, order_id, seq, item_id, description, quantity, uom_id, rate, taxable, total)
         VALUES ($1, $2, 1, $3, 'Laptop', 2, $4, 150000, 300000, 300000)`,
        [school.id, ids.PO2, ids.LAP, ids.NOS],
      );
    });
    app = await createApp();
    inject = injector(app);
    const stores = (await call(admin, 'GET', '/purchase/stores')).json();
    ids.main = stores.data[0].id;
    await withMigrator((c) =>
      c.query(`INSERT INTO store_keepers (school_id, store_id, employee_id) VALUES ($1, $2, $3)`, [
        school.id,
        ids.main,
        ids.K1,
      ]),
    );
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('the PO’s maker cannot receive it; the form shows what is still to come per line', async () => {
    const form = (await call(keeper, 'GET', `/purchase/receipt-form/${ids.PO1!}`)).json();
    expect(form).toMatchObject({
      madeByMe: false,
      inspection: 'department',
      tolerancePct: 0,
      mainStoreId: ids.main,
    });
    expect(form.lines).toEqual([
      expect.objectContaining({ seq: 1, ordered: 5, outstanding: 5, perUnit: 10, storeUom: 'NOS' }),
      expect.objectContaining({ seq: 2, outstanding: 4, tracksBatch: true }),
      expect.objectContaining({ seq: 3, service: true, stockTracked: false }),
    ]);
    ids.L1 = lineOf(form, 1);
    ids.L2 = lineOf(form, 2);
    ids.L3 = lineOf(form, 3);
    const body = {
      orderId: ids.PO1,
      receivedOn: today,
      lines: [{ orderLineId: ids.L1, receivedQty: 1 }],
    };
    const own = await call(office, 'POST', '/purchase/receipts', body);
    expect(own.statusCode).toBe(403);
    expect(own.json().type).toBe('purchase.self_receipt');
    expect((await call(teacher, 'POST', '/purchase/receipts', body)).statusCode).toBe(403);
    const to = (await call(keeper, 'GET', '/purchase/to-receive')).json();
    expect(to.rows.map((r: { id: string }) => r.id).sort()).toEqual([ids.PO1, ids.PO2].sort());
  });

  it('refuses the excess and asks for a batch; a receipt entered wrongly is cancelled', async () => {
    const send = (lines: unknown[], extra: Record<string, unknown> = {}) =>
      call(keeper, 'POST', '/purchase/receipts', {
        orderId: ids.PO1,
        receivedOn: today,
        challanNo: 'DC-41',
        challanDate: today,
        lines,
        ...extra,
      });
    const excess = await send([{ orderLineId: ids.L1, receivedQty: 6 }]);
    expect(excess.statusCode).toBe(400);
    expect(excess.json().detail).toContain('refuse the excess');
    const noBatch = await send([{ orderLineId: ids.L2, receivedQty: 4 }]);
    expect(noBatch.json().detail).toContain('give the batch');
    const service = await send([{ orderLineId: ids.L3, receivedQty: 1 }]);
    expect(service.json().detail).toContain('completion certificate');
    const wrong = await send([{ orderLineId: ids.L1, receivedQty: 5 }]);
    expect(wrong.statusCode).toBe(201);
    expect(wrong.json().number).toMatch(/^GRN\/\d{4}-\d{2}\/\d{4}$/);
    expect(await poLines(ids.PO1!)).toEqual([
      [1, 5, 0, 0],
      [2, 0, 0, 0],
      [3, 0, 0, 0],
    ]);
    expect(
      (
        await call(teacher, 'POST', `/purchase/receipts/${wrong.json().id}/cancel`, {
          reason: 'Wrong',
        })
      ).statusCode,
    ).toBe(404);
    const c = await call(keeper, 'POST', `/purchase/receipts/${wrong.json().id}/cancel`, {
      reason: 'Counted the boxes twice',
    });
    expect(c.statusCode).toBe(201);
    expect((await poLines(ids.PO1!))[0]).toEqual([1, 0, 0, 0]);
  });

  it('receives part with a refusal; the HOD inspects, accepts part and rejects part', async () => {
    const r = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO1,
      receivedOn: today,
      invoiceNo: 'INV-77',
      lines: [
        { orderLineId: ids.L1, receivedQty: 3, refusedQty: 1, refusedReason: 'Box crushed' },
        { orderLineId: ids.L2, receivedQty: 4, batch: 'B7', expiry: '2028-03-31' },
      ],
    });
    expect(r.statusCode).toBe(201);
    ids.G1 = r.json().id;
    const g = (await call(keeper, 'GET', `/purchase/receipts/${ids.G1!}`)).json();
    expect(g).toMatchObject({
      status: 'inspecting',
      inspection: 'department',
      store: 'Main store',
      waitingWith: 'Head of department (Hari Head E2E)',
      can: { inspect: false, cancel: true },
    });
    expect(g.deemedOn > today).toBe(true);
    const po = (await call(office, 'GET', `/purchase/orders/${ids.PO1!}`)).json();
    expect(po).toMatchObject({ receiptStatus: 'part', receipts: 1 });
    expect(po.can).toMatchObject({ cancel: false, amend: false, receive: false });
    // the HOD has it waiting; the keeper cannot inspect their own receipt
    expect(
      (await call(hod, 'GET', '/purchase/receipts?mine=1'))
        .json()
        .rows.map((x: { id: string }) => x.id),
    ).toEqual([ids.G1]);
    expect((await call(hod, 'GET', '/purchase/receipts-waiting')).json()).toEqual({ waiting: 1 });
    const self = await call(keeper, 'POST', `/purchase/receipts/${ids.G1!}/inspect`, {
      action: 'accept',
    });
    expect(self.json().type).toBe('workflow.self_approval');
    const hodView = (await call(hod, 'GET', `/purchase/receipts/${ids.G1!}`)).json();
    expect(hodView.can.inspect).toBe(true);
    const [pen, chem] = hodView.lineItems;
    const bad = await call(hod, 'POST', `/purchase/receipts/${ids.G1!}/inspect`, {
      action: 'accept',
      lines: [{ lineId: pen.id, acceptedQty: 2, rejectedQty: 1 }],
    });
    expect(bad.json().detail).toContain('say why');
    const ok = await call(hod, 'POST', `/purchase/receipts/${ids.G1!}/inspect`, {
      action: 'accept',
      lines: [
        { lineId: pen.id, acceptedQty: 2, rejectedQty: 1, reason: 'Ink leaking' },
        { lineId: chem.id, acceptedQty: 4 },
      ],
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      status: 'accepted',
      acceptedOn: today,
      decidedBy: 'Hari Head E2E',
    });
    expect(await poLines(ids.PO1!)).toEqual([
      [1, 3, 2, 1],
      [2, 4, 4, 0],
      [3, 0, 0, 0],
    ]);
  });

  it('accepted goods enter the store at the PO cost; the indent’s share is issued at once to Science', async () => {
    const g = (await call(keeper, 'GET', `/purchase/receipts/${ids.G1!}`)).json();
    // a box: ₹100 + ₹18 GST + its share of the ₹100 freight (500 of 1,700 taxable) over 5 boxes
    expect(g.lineItems[0].unitCost).toBeCloseTo(123.8824, 3);
    expect(g.lineItems[1].unitCost).toBeCloseTo(52.9412, 3);
    expect(g.issues).toEqual([
      expect.objectContaining({
        department: 'Science',
        indent: `PI/${s}/1`,
        status: 'issued',
        lines: 2,
      }),
    ]);
    expect(g.issues[0].number).toMatch(/^ISS\//);
    // 20 pens came, the indent's 10 were issued; the 4 bottles all went to Science
    expect(await balance(ids.PEN!)).toEqual({ qty: '10.000', value: '123.88' });
    expect(await balance(ids.CHEM!)).toEqual({ qty: '0.000', value: '0.00' });
    const moves = await withMigrator(
      async (c) =>
        (
          await c.query<{ kind: string; qty: string; batch_no: string | null }>(
            `SELECT kind, qty::text, batch_no FROM stock_moves WHERE store_id = $1 AND item_id = $2 ORDER BY id`,
            [ids.main, ids.CHEM],
          )
        ).rows,
    );
    expect(moves).toEqual([
      { kind: 'receipt', qty: '4.000', batch_no: 'B7' },
      { kind: 'issue', qty: '-4.000', batch_no: 'B7' },
    ]);
  });

  it('a completion certificate for the service; a rejected receipt; the PO closes when all is accepted', async () => {
    const goodsLine = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO1,
      kind: 'service',
      receivedOn: today,
      lines: [{ orderLineId: ids.L1, receivedQty: 1, workDone: 'x' }],
    });
    expect(goodsLine.json().detail).toContain('goods receipt');
    const noWords = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO1,
      kind: 'service',
      receivedOn: today,
      lines: [{ orderLineId: ids.L3, receivedQty: 1 }],
    });
    expect(noWords.json().detail).toContain('say what was done');
    const sc = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO1,
      kind: 'service',
      receivedOn: today,
      lines: [
        { orderLineId: ids.L3, receivedQty: 1, workDone: 'Lab sink pipes replaced and tested' },
      ],
    });
    expect(sc.statusCode).toBe(201);
    expect(sc.json().number).toMatch(/^SCC\//);
    expect(
      (
        await call(hod, 'POST', `/purchase/receipts/${sc.json().id}/inspect`, { action: 'accept' })
      ).json().status,
    ).toBe('accepted');
    // three more boxes come, wrong colour: rejected in full
    const wrong = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO1,
      receivedOn: today,
      lines: [{ orderLineId: ids.L1, receivedQty: 3 }],
    });
    expect(
      (
        await call(hod, 'POST', `/purchase/receipts/${wrong.json().id}/inspect`, {
          action: 'reject',
        })
      ).json().detail,
    ).toContain('reason');
    const rej = await call(hod, 'POST', `/purchase/receipts/${wrong.json().id}/inspect`, {
      action: 'reject',
      note: 'Blue pens ordered, red ones came',
    });
    expect(rej.json()).toMatchObject({ status: 'rejected' });
    expect(rej.json().lineItems[0]).toMatchObject({ accepted: 0, rejected: 3 });
    expect((await poLines(ids.PO1!))[0]).toEqual([1, 6, 2, 4]);
    // the replacement: accepted; nothing more is issued (the indent had its box)
    const last = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO1,
      receivedOn: today,
      lines: [{ orderLineId: ids.L1, receivedQty: 3 }],
    });
    const done = (
      await call(hod, 'POST', `/purchase/receipts/${last.json().id}/inspect`, { action: 'accept' })
    ).json();
    expect(done.issues).toEqual([]);
    expect(await balance(ids.PEN!)).toMatchObject({ qty: '40.000' });
    const po = (await call(office, 'GET', `/purchase/orders/${ids.PO1!}`)).json();
    expect(po).toMatchObject({
      status: 'closed',
      closedNote: 'Received and accepted in full',
      receiptStatus: 'received',
    });
    expect(po.receiptList).toHaveLength(5);
    const cancel = await call(office, 'POST', `/purchase/orders/${ids.PO1!}/cancel`, {
      reason: 'Not needed now',
    });
    expect(cancel.json().type).toBe('purchase.order_received');
  });

  it('above the committee limit the committee signs; a changed inspection is signed again; serial numbers', async () => {
    const form = (await call(keeper, 'GET', `/purchase/receipt-form/${ids.PO2!}`)).json();
    expect(form.inspection).toBe('committee');
    const line = form.lines[0].id;
    const few = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO2,
      receivedOn: today,
      lines: [{ orderLineId: line, receivedQty: 2, serials: ['SN-1'] }],
    });
    expect(few.json().detail).toContain('1 serial numbers for 2 received');
    const r = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO2,
      receivedOn: today,
      lines: [{ orderLineId: line, receivedQty: 2, serials: ['SN-1', 'SN-2'] }],
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().id;
    const g = (await call(m1, 'GET', `/purchase/receipts/${id}`)).json();
    expect(g).toMatchObject({
      inspection: 'committee',
      waitingWith: 'Purchase committee (0 signed)',
    });
    expect(g.committee).toMatchObject({ required: 2 });
    expect(g.can.inspect).toBe(true);
    expect((await call(hod, 'GET', `/purchase/receipts/${id}`)).statusCode).toBe(404);
    const lid = g.lineItems[0].id;
    // Mira rejects one (a broken screen); Mohan accepts both: the signatures start again
    await call(m1, 'POST', `/purchase/receipts/${id}/inspect`, {
      action: 'accept',
      lines: [
        {
          lineId: lid,
          acceptedQty: 1,
          rejectedQty: 1,
          reason: 'Screen broken',
          rejectedSerials: [],
        },
      ],
    }).then((x) => expect(x.json().detail).toContain('tick the serial numbers'));
    const a = await call(m1, 'POST', `/purchase/receipts/${id}/inspect`, {
      action: 'accept',
      lines: [
        {
          lineId: lid,
          acceptedQty: 1,
          rejectedQty: 1,
          reason: 'Screen broken',
          rejectedSerials: ['SN-2'],
        },
      ],
    });
    expect(a.json()).toMatchObject({
      status: 'inspecting',
      waitingWith: 'Purchase committee (1 signed)',
    });
    const b = await call(m2, 'POST', `/purchase/receipts/${id}/inspect`, { action: 'accept' });
    expect(
      b.json().committee.members.filter((m: { signedAt: string | null }) => m.signedAt),
    ).toEqual([expect.objectContaining({ name: 'Mohan Member E2E' })]);
    const c = await call(m1, 'POST', `/purchase/receipts/${id}/inspect`, { action: 'accept' });
    expect(c.json()).toMatchObject({ status: 'accepted' });
    expect(c.json().lineItems[0]).toMatchObject({
      accepted: 2,
      rejected: 0,
      serials: ['SN-1', 'SN-2'],
    });
    expect(await balance(ids.LAP!)).toEqual({ qty: '2.000', value: '300000.00' });
    // the same serial number does not come twice
    expect((await call(office, 'GET', `/purchase/orders/${ids.PO2!}`)).json().status).toBe(
      'closed',
    );
  });

  it('the GRN as a PDF; the GRN register and pending deliveries', async () => {
    const pdf = await call(keeper, 'GET', `/purchase/receipts/${ids.G1!}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const reg = (await call(admin, 'GET', '/purchase/reports/grn_register')).json();
    expect(reg.rows.length).toBe(6);
    expect(reg.rows.map((x: unknown[]) => x[9])).toContain('Rejected');
    const pend = (await call(admin, 'GET', '/purchase/reports/pending_deliveries')).json();
    expect(pend.rows).toEqual([]);
    // who inspects shows on Who approves (the HOD when nothing is set)
    const a = (await call(admin, 'GET', '/purchase/approvals')).json();
    expect(
      a.departments.find((d: { id: string }) => d.id === ids.Science).levels.inspection,
    ).toEqual([]);
  });
});
