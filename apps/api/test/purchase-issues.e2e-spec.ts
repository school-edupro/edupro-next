/**
 * Purchase phase 2, part 8 (docs/design/84): a requisition's "from the store" lines reserve stock when
 * sent (let go when sent back); the keeper issues against the reservation (shared to the indent, the
 * earliest expiry first) and at the counter (never more than the free stock); the department
 * acknowledges (or the store records a signed slip); goods come back to the store against an issue;
 * transfers in transit until the receiving keeper receives them, or cancelled back; a blind physical
 * count, differences with reasons, approved by the school admin (not the counter) into adjustments,
 * from Excel too; returns to the vendor of rejected and defective goods, a PO reopened for the
 * replacement; and the stock reports.
 */
import ExcelJS from 'exceljs';
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

describe('purchase issues, returns, transfers and counts (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let keeper: SeededUser;
  let labKeeper: SeededUser;
  let hod: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('IS');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const bal = (store: string, item: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{ qty: string; reserved: string }>(
            `SELECT qty::text, reserved::text FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
            [store, item],
          )
        ).rows[0] ?? { qty: '0', reserved: '0' },
    );
  const batches = (store: string, item: string) =>
    withMigrator(async (c) =>
      Object.fromEntries(
        (
          await c.query<{ batch_no: string; qty_left: string }>(
            `SELECT batch_no, qty_left::text FROM stock_batches WHERE store_id = $1 AND item_id = $2 ORDER BY batch_no`,
            [store, item],
          )
        ).rows.map((b) => [b.batch_no, Number(b.qty_left)]),
      ),
    );

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-po`, 'purchase_office');
      keeper = await seedUser(c, school, `${s}-sk`, 'store_keeper');
      labKeeper = await seedUser(c, school, `${s}-lk`, 'store_keeper');
      hod = await seedUser(c, school, `${s}-hod`, 'class_teacher');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      other = await seedUser(c, school, `${s}-x`, 'subject_teacher');
      for (const [code, name, dept, u] of [
        ['O1', 'Om Office', 'Administration', office],
        ['K1', 'Kamla Keeper', 'Administration', keeper],
        ['L1', 'Lata Labkeeper', 'Science', labKeeper],
        ['H1', 'Hari Head', 'Science', hod],
        ['T1', 'Tara Teacher', 'Science', teacher],
        ['X1', 'Xavier Other', 'Science', other],
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
      const uom = async (code: string) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM purchase_uoms WHERE school_id = $1 AND code = $2`,
            [school.id, code],
          )
        ).rows[0]!.id;
      ids.NOS = await uom('NOS');
      ids.BOX = await uom('BOX');
      ids.cat = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_item_categories (school_id, code, name) VALUES ($1, 'GEN', 'General') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      for (const [code, name, unit, batch] of [
        ['PEN', 'Ball pen', ids.BOX, false],
        ['CHEM', 'Copper sulphate 500 g', ids.NOS, true],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id, tracks_batch)
             VALUES ($1, $2, $3, 'consumable', $4, $5, $6) RETURNING id::text`,
            [school.id, code, name, ids.cat, unit, batch],
          )
        ).rows[0]!.id;
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
      // an approved indent of Science waiting for its requisition: 3 boxes of pens, 6 bottles
      ids.PI = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_indents (school_id, number, department_id, raised_by, purpose, status, route)
           VALUES ($1, $2, $3, $4, 'Lab and class supplies', 'approved', 'to_requisition') RETURNING id::text`,
          [school.id, `PI/${s}/1`, ids.Science, teacher.id],
        )
      ).rows[0]!.id;
      for (const [seq, item, qty, unit] of [
        [1, ids.PEN, 3, ids.BOX],
        [2, ids.CHEM, 6, ids.NOS],
      ] as const)
        await c.query(
          `INSERT INTO purchase_indent_lines (school_id, indent_id, seq, item_id, quantity, uom_id) VALUES ($1, $2, $3, $4, $5, $6)`,
          [school.id, ids.PI, seq, item, qty, unit],
        );
      // a PO of Science for 5 boxes, made by the purchase office (returns to the vendor)
      ids.PO = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_orders (school_id, number, status, department_id, vendor_id, vendor_gst_status, taxable, total, approved_at,
                                        sent_at, created_by)
           VALUES ($1, $2, 'sent', $3, $4, 'unregistered', 500, 500, now(), now(), $5) RETURNING id::text`,
          [school.id, `PO/${s}/1`, ids.Science, ids.V1, office.id],
        )
      ).rows[0]!.id;
      ids.POL = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_order_lines (school_id, order_id, seq, item_id, description, quantity, uom_id, rate, taxable, total)
           VALUES ($1, $2, 1, $3, 'Ball pen', 5, $4, 100, 500, 500) RETURNING id::text`,
          [school.id, ids.PO, ids.PEN, ids.BOX],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    ids.main = (await call(office, 'GET', '/purchase/stores')).json().data[0].id;
    ids.lab = (
      await call(office, 'POST', '/purchase/stores', {
        code: 'LAB',
        name: 'Chemistry lab store',
        departmentId: ids.Science,
        keeperIds: [ids.L1],
      })
    ).json().id;
    await withMigrator((c) =>
      c.query(`INSERT INTO store_keepers (school_id, store_id, employee_id) VALUES ($1, $2, $3)`, [
        school.id,
        ids.main,
        ids.K1,
      ]),
    );
    expect(
      (
        await call(office, 'POST', `/purchase/stores/${ids.main!}/opening`, {
          lines: [
            { itemId: ids.PEN, qty: 100, rate: 8 },
            { itemId: ids.CHEM, qty: 10, rate: 50, batch: 'B1', expiry: '2027-01-31' },
            { itemId: ids.CHEM, qty: 5, rate: 60, batch: 'B2', expiry: '2026-12-31' },
          ],
        })
      ).statusCode,
    ).toBe(201);
    await call(admin, 'PUT', `/purchase/approvals/${ids.Science!}/requisition`, {
      levels: [{ name: 'HOD', by: 'hod' }],
    });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('a requisition’s lines from the store reserve stock when sent; sending it back lets it go', async () => {
    const pr = (
      await call(office, 'POST', '/purchase/requisitions', { indentIds: [ids.PI] })
    ).json();
    ids.PR = pr.id;
    const detail = (await call(office, 'GET', `/purchase/requisitions/${ids.PR!}`)).json();
    const [pen, chem] = detail.lineItems;
    const put = (storeId: string, penQty = 3) =>
      call(office, 'PUT', `/purchase/requisitions/${ids.PR!}`, {
        purpose: detail.purpose,
        lines: [
          { id: pen.id, quantity: penQty, fulfil: 'store', storeId },
          { id: chem.id, quantity: 6, fulfil: 'store', storeId },
        ],
      });
    // the lab store has none: not enough free stock
    expect((await put(ids.lab!)).statusCode).toBe(200);
    const short = await call(office, 'POST', `/purchase/requisitions/${ids.PR!}/submit`);
    expect(short.statusCode).toBe(409);
    expect(short.json().detail).toContain('Enough free stock');
    expect((await put(ids.main!)).statusCode).toBe(200);
    const d2 = (await call(office, 'GET', `/purchase/requisitions/${ids.PR!}`)).json();
    expect(d2.lineItems[0]).toMatchObject({
      store: 'Main store',
      stock: { perUnit: 10, inStore: 100, reserved: 0, held: 0 },
    });
    expect(
      (await call(office, 'POST', `/purchase/requisitions/${ids.PR!}/submit`)).statusCode,
    ).toBe(201);
    expect(await bal(ids.main!, ids.PEN!)).toEqual({ qty: '100.000', reserved: '30.000' });
    expect(await bal(ids.main!, ids.CHEM!)).toEqual({ qty: '15.000', reserved: '6.000' });
    await call(hod, 'POST', `/purchase/requisitions/${ids.PR!}/decide`, {
      action: 'send_back',
      note: 'Fewer pens',
    });
    expect((await bal(ids.main!, ids.PEN!)).reserved).toBe('0.000');
    expect((await put(ids.main!, 3)).statusCode).toBe(200);
    await call(office, 'POST', `/purchase/requisitions/${ids.PR!}/submit`);
    expect(
      (await call(hod, 'POST', `/purchase/requisitions/${ids.PR!}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(201);
    expect((await bal(ids.main!, ids.PEN!)).reserved).toBe('30.000');
  });

  it('the keeper issues against the reservation: to the indent, the earliest expiry first', async () => {
    expect((await call(teacher, 'GET', '/purchase/to-issue')).statusCode).toBe(403);
    expect((await call(labKeeper, 'GET', '/purchase/to-issue')).json().groups).toEqual([]);
    const to = (await call(keeper, 'GET', '/purchase/to-issue')).json();
    expect(to.groups).toHaveLength(1);
    const g = to.groups[0];
    expect(g).toMatchObject({ requisitionId: ids.PR, store: 'Main store', indents: `PI/${s}/1` });
    const [pen, chem] = g.lines;
    expect(pen).toMatchObject({ toIssue: 30, unit: 'NOS' });
    const too = await call(keeper, 'POST', '/purchase/issues', {
      kind: 'indent',
      storeId: ids.main,
      requisitionId: ids.PR,
      lines: [{ reservationId: pen.reservationId, qty: 31 }],
    });
    expect(too.json().detail).toContain('30 is left to issue');
    const r = await call(keeper, 'POST', '/purchase/issues', {
      kind: 'indent',
      storeId: ids.main,
      requisitionId: ids.PR,
      lines: [
        { reservationId: pen.reservationId, qty: 20 },
        { reservationId: chem.reservationId, qty: 6 },
      ],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().issues).toHaveLength(1);
    ids.IS1 = r.json().issues[0].id;
    expect(await bal(ids.main!, ids.PEN!)).toEqual({ qty: '80.000', reserved: '10.000' });
    expect(await bal(ids.main!, ids.CHEM!)).toEqual({ qty: '9.000', reserved: '0.000' });
    expect(await batches(ids.main!, ids.CHEM!)).toEqual({ B1: 9, B2: 0 });
    const is = (await call(keeper, 'GET', `/purchase/issues/${ids.IS1!}`)).json();
    expect(is).toMatchObject({
      kind: 'indent',
      department: 'Science',
      indent: `PI/${s}/1`,
      takenBy: 'Tara Teacher E2E',
      status: 'issued',
    });
    // the requisition cannot go back once the store has issued against it
    const re = await call(office, 'POST', `/purchase/requisitions/${ids.PR!}/reopen`, {
      reason: 'Change it',
    });
    expect(re.json().detail).toContain('issued against it');
  });

  it('a counter issue never takes the reserved stock; only a store’s keepers issue from it', async () => {
    const body = (qty: number, store = ids.main) => ({
      kind: 'counter',
      storeId: store,
      departmentId: ids.Administration,
      takenByEmployeeId: ids.H1,
      purpose: 'Exam hall',
      lines: [{ itemId: ids.PEN, qty }],
    });
    const over = await call(keeper, 'POST', '/purchase/issues', body(75));
    expect(over.statusCode).toBe(409);
    expect(over.json().detail).toContain('70 free');
    expect((await call(keeper, 'POST', '/purchase/issues', body(1, ids.lab))).statusCode).toBe(403);
    const r = await call(keeper, 'POST', '/purchase/issues', body(5));
    expect(r.statusCode).toBe(201);
    ids.IS2 = r.json().issues[0].id;
    expect(await bal(ids.main!, ids.PEN!)).toEqual({ qty: '75.000', reserved: '10.000' });
  });

  it('the department acknowledges; the store records a slip signed on paper; the slip as a PDF', async () => {
    expect((await call(teacher, 'GET', '/purchase/issues?mine=1')).json().toAcknowledge).toBe(1);
    expect((await call(other, 'GET', `/purchase/issues/${ids.IS1!}`)).statusCode).toBe(404);
    const ack = await call(teacher, 'POST', `/purchase/issues/${ids.IS1!}/acknowledge`, {
      note: 'All received',
    });
    expect(ack.statusCode).toBe(201);
    expect((await call(teacher, 'GET', `/purchase/issues/${ids.IS1!}`)).json()).toMatchObject({
      status: 'acknowledged',
      acknowledgedBy: 'Tara Teacher E2E',
    });
    // the counter issue: the keeper records the signed slip (with who signed)
    expect(
      (await call(keeper, 'POST', `/purchase/issues/${ids.IS2!}/acknowledge`, { onPaper: true }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(keeper, 'POST', `/purchase/issues/${ids.IS2!}/acknowledge`, {
          onPaper: true,
          note: 'Signed by Hari Head; slip filed',
        })
      ).statusCode,
    ).toBe(201);
    const pdf = await call(keeper, 'GET', `/purchase/issues/${ids.IS1!}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('goods come back to the store against the issue: unused into stock, damaged recorded', async () => {
    const is = (await call(keeper, 'GET', `/purchase/issues/${ids.IS1!}`)).json();
    const pen = is.lineItems.find((l: { item: string }) => l.item === 'Ball pen');
    const chem = is.lineItems.find((l: { item: string }) => l.item !== 'Ball pen');
    expect(
      (
        await call(keeper, 'POST', `/purchase/issues/${ids.IS1!}/return`, {
          lines: [{ issueLineId: pen.id, qty: 21, condition: 'unused' }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(keeper, 'POST', `/purchase/issues/${ids.IS1!}/return`, {
          lines: [{ issueLineId: chem.id, qty: 1, condition: 'damaged' }],
        })
      ).json().detail,
    ).toContain('what is wrong');
    const r = await call(keeper, 'POST', `/purchase/issues/${ids.IS1!}/return`, {
      lines: [
        { issueLineId: pen.id, qty: 5, condition: 'unused', reason: 'Not needed' },
        { issueLineId: chem.id, qty: 1, condition: 'damaged', reason: 'Bottle cracked' },
      ],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().number).toMatch(/^RTN\//);
    expect((await bal(ids.main!, ids.PEN!)).qty).toBe('80.000');
    expect((await bal(ids.main!, ids.CHEM!)).qty).toBe('9.000');
    const after = (await call(keeper, 'GET', `/purchase/issues/${ids.IS1!}`)).json();
    expect(after.lineItems.find((l: { id: string }) => l.id === pen.id)).toMatchObject({
      returned: 5,
      returnable: 15,
    });
  });

  it('a transfer is in transit until the receiving keeper receives it; one is cancelled back', async () => {
    const t = await call(keeper, 'POST', '/purchase/transfers', {
      fromStoreId: ids.main,
      toStoreId: ids.lab,
      lines: [
        { itemId: ids.PEN, qty: 10 },
        { itemId: ids.CHEM, qty: 4 },
      ],
    });
    expect(t.statusCode).toBe(201);
    ids.TR = t.json().id;
    expect(t.json().number).toMatch(/^TRF\//);
    expect((await bal(ids.main!, ids.PEN!)).qty).toBe('70.000');
    expect((await bal(ids.lab!, ids.PEN!)).qty).toBe('0');
    expect(
      (await call(labKeeper, 'GET', '/purchase/transfers?mine=1'))
        .json()
        .rows.map((x: { id: string }) => x.id),
    ).toEqual([ids.TR]);
    expect(
      (await call(keeper, 'POST', `/purchase/transfers/${ids.TR!}/receive`, {})).statusCode,
    ).toBe(403);
    expect(
      (await call(labKeeper, 'POST', `/purchase/transfers/${ids.TR!}/receive`, { note: 'OK' }))
        .statusCode,
    ).toBe(201);
    expect((await bal(ids.lab!, ids.PEN!)).qty).toBe('10.000');
    expect(await batches(ids.lab!, ids.CHEM!)).toEqual({ B1: 4 });
    const back = await call(keeper, 'POST', '/purchase/transfers', {
      fromStoreId: ids.main,
      toStoreId: ids.lab,
      lines: [{ itemId: ids.PEN, qty: 5 }],
    });
    expect(
      (
        await call(keeper, 'POST', `/purchase/transfers/${back.json().id}/cancel`, {
          note: 'Wrong store',
        })
      ).statusCode,
    ).toBe(201);
    expect((await bal(ids.main!, ids.PEN!)).qty).toBe('70.000');
  });

  it('a blind physical count, differences with reasons, approved by the school admin into adjustments', async () => {
    const r = await call(labKeeper, 'POST', '/purchase/counts', { storeId: ids.lab });
    expect(r.statusCode).toBe(201);
    ids.CNT = r.json().id;
    expect(
      (await call(labKeeper, 'POST', '/purchase/counts', { storeId: ids.lab })).statusCode,
    ).toBe(409);
    const k = (await call(labKeeper, 'GET', `/purchase/counts/${ids.CNT!}`)).json();
    expect(k.lineItems).toHaveLength(2);
    expect(k.lineItems.every((l: { book: number | null }) => l.book === null)).toBe(true);
    const pen = k.lineItems.find((l: { item: string }) => l.item === 'Ball pen');
    // the sheet from Excel: 9 pens found, the chemical as listed
    const sheet = (await call(labKeeper, 'GET', `/purchase/counts/${ids.CNT!}/sheet`)).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(sheet.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const code = String(row.getCell(1).value ?? '');
      if (code === 'PEN') row.getCell(6).value = 9;
      if (code === 'CHEM') row.getCell(6).value = 4;
    });
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const imp = await call(labKeeper, 'POST', `/purchase/counts/${ids.CNT!}/import`, { file });
    expect(imp.json()).toEqual({ counted: 2 });
    const noReason = await call(labKeeper, 'POST', `/purchase/counts/${ids.CNT!}/submit`);
    expect(noReason.json().detail).toContain('reason');
    await call(labKeeper, 'PUT', `/purchase/counts/${ids.CNT!}/lines`, {
      countedBy: 'Lata and Hari',
      lines: [{ lineId: pen.id, countedQty: 9, reason: 'One pen used for labels' }],
    });
    expect((await call(labKeeper, 'POST', `/purchase/counts/${ids.CNT!}/submit`)).statusCode).toBe(
      201,
    );
    expect(
      (await call(labKeeper, 'POST', `/purchase/counts/${ids.CNT!}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(403);
    const seen = (await call(admin, 'GET', `/purchase/counts/${ids.CNT!}`)).json();
    expect(seen.lineItems.find((l: { item: string }) => l.item === 'Ball pen')).toMatchObject({
      book: 10,
      counted: 9,
      difference: -1,
    });
    expect(seen.can.decide).toBe(true);
    const ok = await call(admin, 'POST', `/purchase/counts/${ids.CNT!}/decide`, {
      action: 'approve',
    });
    expect(ok.json()).toEqual({ status: 'approved', adjustments: 1 });
    expect((await bal(ids.lab!, ids.PEN!)).qty).toBe('9.000');
    const store = (await call(labKeeper, 'GET', `/purchase/stores/${ids.lab!}`)).json();
    expect(store.countedThisYear).toBe(true);
    const pdf = await call(admin, 'GET', `/purchase/counts/${ids.CNT!}/pdf`);
    expect(pdf.statusCode).toBe(200);
  });

  it('rejected and defective goods go back to the vendor; the PO reopens for the replacement', async () => {
    const receive = async (qty: number) =>
      (
        await call(keeper, 'POST', '/purchase/receipts', {
          orderId: ids.PO,
          receivedOn: today,
          lines: [{ orderLineId: ids.POL, receivedQty: qty }],
        })
      ).json().id as string;
    const accept = async (id: string, lines: unknown[] = []) => {
      const r = await call(hod, 'POST', `/purchase/receipts/${id}/inspect`, {
        action: 'accept',
        lines,
      });
      expect(r.statusCode).toBe(201);
      return r.json();
    };
    const a = await receive(5);
    const ga = (await call(hod, 'GET', `/purchase/receipts/${a}`)).json();
    await accept(a, [
      { lineId: ga.lineItems[0].id, acceptedQty: 4, rejectedQty: 1, reason: 'Box crushed' },
    ]);
    await accept(await receive(1));
    const po = async () => (await call(office, 'GET', `/purchase/orders/${ids.PO!}`)).json();
    expect((await po()).status).toBe('closed');
    const ret = (await call(keeper, 'GET', `/purchase/returnable/${ids.PO!}`)).json();
    const lineA = ret.lines.find((l: { rejected: number }) => l.rejected === 1);
    expect(lineA).toMatchObject({ rejectedLeft: 1, stockLeft: 4 });
    const over = await call(keeper, 'POST', '/purchase/vendor-returns', {
      orderId: ids.PO,
      lines: [
        { receiptLineId: lineA.receiptLineId, source: 'rejected', qty: 2, reason: 'Crushed' },
      ],
    });
    expect(over.statusCode).toBe(400);
    const before = Number((await bal(ids.main!, ids.PEN!)).qty);
    const r = await call(keeper, 'POST', '/purchase/vendor-returns', {
      orderId: ids.PO,
      dispatch: 'Vendor’s van, docket 77',
      lines: [
        {
          receiptLineId: lineA.receiptLineId,
          source: 'rejected',
          qty: 1,
          reason: 'Box crushed',
          replacement: false,
        },
        {
          receiptLineId: lineA.receiptLineId,
          source: 'stock',
          qty: 1,
          reason: 'Pens do not write',
          replacement: true,
        },
      ],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ reopened: true });
    expect(Number((await bal(ids.main!, ids.PEN!)).qty)).toBe(before - 10);
    const reopened = await po();
    expect(reopened).toMatchObject({ status: 'sent', receiptStatus: 'part' });
    expect(reopened.lineItems[0]).toMatchObject({ accepted: 5, returned: 1 });
    await accept(await receive(1));
    expect((await po()).status).toBe('closed');
    const note = (await call(keeper, 'GET', `/purchase/returns/${r.json().id}`)).json();
    expect(note).toMatchObject({ kind: 'to_vendor', vendor: 'Same State Traders' });
    expect((await call(keeper, 'GET', `/purchase/returns/${r.json().id}/pdf`)).statusCode).toBe(
      200,
    );
  });

  it('the stock reports: consumption, expiring, below reorder, transfers, count differences', async () => {
    const rep = async (name: string, q = '') =>
      (await call(admin, 'GET', `/purchase/reports/${name}${q}`)).json();
    const cons = await rep('consumption');
    expect(cons.rows.map((x: unknown[]) => x[0]).sort()).toEqual([
      'Administration',
      'Science',
      'Science',
    ]);
    const exp = await rep('expiring', '?status=d90');
    expect(exp.rows.map((x: unknown[]) => x[2])).toEqual(['B1', 'B1']);
    await call(office, 'PUT', `/purchase/stores/${ids.main!}/levels`, {
      lines: [{ itemId: ids.PEN, reorderLevel: 200, reorderQty: 50 }],
    });
    const low = await rep('below_reorder');
    expect(low.rows).toHaveLength(1);
    expect(low.rows[0][1]).toBe('Ball pen (PEN)');
    expect((await rep('transfers')).rows).toHaveLength(2);
    expect((await rep('transfers', '?status=in_transit')).rows).toHaveLength(0);
    const diff = await rep('count_differences');
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0][7]).toBe(-1);
    // the lab store has only received (never issued): slow-moving
    const slow = await rep('slow_moving', '?status=n90');
    expect(slow.rows.map((x: unknown[]) => x[0])).toEqual([
      'Chemistry lab store',
      'Chemistry lab store',
    ]);
  });
});
