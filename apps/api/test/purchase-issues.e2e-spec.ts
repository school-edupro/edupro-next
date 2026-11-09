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
    // the school admin is the level when the lab's department has no Physical count levels
    expect(ok.json()).toEqual({ status: 'approved' });
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

  it('an approved indent takes from the stores first: held for the keeper, only the rest bought; issued, acknowledged', async () => {
    await call(admin, 'PUT', `/purchase/approvals/${ids.Science!}/indent`, {
      levels: [{ name: 'HOD', by: 'hod' }],
    });
    const free = async (item: string) => {
      let n = 0;
      for (const st of [ids.main!, ids.lab!]) {
        const b = await bal(st, item);
        n += Number(b.qty) - Number(b.reserved);
      }
      return n;
    };
    const penFree = await free(ids.PEN!); // NOS; a box is 10
    const chemFree = Math.floor(await free(ids.CHEM!));
    expect(penFree).toBeGreaterThanOrEqual(10);
    const raise = async (lines: Array<{ itemId: string; quantity: number }>) => {
      const pi = (
        await call(teacher, 'POST', '/purchase/indents', {
          departmentId: ids.Science,
          purpose: 'Practical class',
          lines,
        })
      ).json();
      expect(
        (await call(teacher, 'POST', `/purchase/indents/${pi.id as string}/submit`)).statusCode,
      ).toBe(201);
      expect(
        (
          await call(hod, 'POST', `/purchase/indents/${pi.id as string}/decide`, {
            action: 'approve',
          })
        ).statusCode,
      ).toBe(201);
      return (await call(teacher, 'GET', `/purchase/indents/${pi.id as string}`)).json();
    };
    // a box of pens in stock, copper sulphate 2 more than the stores have
    const pi = await raise([
      { itemId: ids.PEN!, quantity: 1 },
      { itemId: ids.CHEM!, quantity: chemFree + 2 },
    ]);
    expect(pi.route).toBe('to_requisition');
    expect(pi.lineItems[0].ordered).toMatch(/^From the store: 10 NOS held in .+, to issue$/);
    expect(pi.lineItems[1].ordered).toMatch(
      new RegExp(`^From the store: ${String(chemFree)} NOS held in .+, to issue$`),
    );
    // only the rest waits for the PR
    const cand = (await call(office, 'GET', '/purchase/requisition-candidates')).json();
    const mine = cand.data.find((x: { id: string }) => x.id === pi.id);
    expect(mine.lines).toEqual([expect.objectContaining({ quantity: 2, uom: 'NOS' })]);
    // the keepers' To issue: the indent's holds, by store
    const toIssue = (await call(admin, 'GET', '/purchase/to-issue')).json();
    const groups = toIssue.indents.filter((g: { indentId: string }) => g.indentId === pi.id);
    const held = (item: string) =>
      groups
        .flatMap((g: { lines: Array<{ itemId: string; toIssue: number }> }) => g.lines)
        .filter((l: { itemId: string }) => l.itemId === item)
        .reduce((a: number, l: { toIssue: number }) => a + l.toIssue, 0);
    expect(held(ids.PEN!)).toBe(10);
    expect(held(ids.CHEM!)).toBe(chemFree);
    // the pens issued against the indent (to its raiser), then acknowledged by the raiser
    const penHold = groups
      .flatMap(
        (g: {
          storeId: string;
          lines: Array<{ itemId: string; reservationId: string; toIssue: number }>;
        }) => g.lines.map((l) => ({ ...l, storeId: g.storeId })),
      )
      .filter((l: { itemId: string }) => l.itemId === ids.PEN);
    for (const h of penHold) {
      const r = await call(admin, 'POST', '/purchase/issues', {
        kind: 'indent',
        storeId: h.storeId,
        indentId: pi.id,
        lines: [{ reservationId: h.reservationId, qty: h.toIssue }],
      });
      expect(r.statusCode).toBe(201);
    }
    const issued = (await call(teacher, 'GET', `/purchase/indents/${pi.id as string}`)).json();
    expect(issued.lineItems[0].ordered).toMatch(
      /^From the store: 10 NOS issued on ISS\/.+ · to acknowledge$/,
    );
    const waiting = (await call(teacher, 'GET', '/purchase/issues?mine=1')).json();
    expect(waiting.toAcknowledge).toBeGreaterThanOrEqual(1);
    for (const x of waiting.rows.filter(
      (r: { indent: string | null; status: string }) => r.status === 'issued',
    ))
      await call(teacher, 'POST', `/purchase/issues/${x.id as string}/acknowledge`, {});
    expect(
      (await call(teacher, 'GET', `/purchase/indents/${pi.id as string}`)).json().lineItems[0]
        .ordered,
    ).toMatch(/ · acknowledged$/);
    // the PI's line lists its issue (with the slip); the raiser's "received earlier" has it too
    const after = (await call(teacher, 'GET', `/purchase/indents/${pi.id as string}`)).json();
    // (one issue per store the pens were held in)
    expect(after.lineItems[0].issues.length).toBeGreaterThanOrEqual(1);
    for (const x of after.lineItems[0].issues as Array<{ number: string; status: string }>)
      expect(x).toMatchObject({ number: expect.stringMatching(/^ISS\//), status: 'acknowledged' });
    const earlier = (
      await call(teacher, 'GET', '/purchase/issues?received=1&status=acknowledged')
    ).json();
    expect(earlier.rows.map((x: { id: string }) => x.id)).toContain(
      after.lineItems[0].issues[0].id,
    );
    const slip = await call(
      teacher,
      'GET',
      `/purchase/issues/${after.lineItems[0].issues[0].id as string}/pdf`,
    );
    expect(slip.statusCode).toBe(200);
    expect(slip.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    // the copper sulphate is not there after all: the keeper lets it go, the whole line goes to purchase
    const chemHold = groups
      .flatMap((g: { lines: Array<{ itemId: string; reservationId: string }> }) => g.lines)
      .filter((l: { itemId: string }) => l.itemId === ids.CHEM);
    expect(
      (
        await call(
          teacher,
          'POST',
          `/purchase/to-issue/${chemHold[0].reservationId as string}/release`,
          {
            reason: 'Spoilt',
          },
        )
      ).statusCode,
    ).toBe(403);
    for (const h of chemHold)
      expect(
        (
          await call(admin, 'POST', `/purchase/to-issue/${h.reservationId as string}/release`, {
            reason: 'Spoilt in the store',
          })
        ).statusCode,
      ).toBe(201);
    const back = (await call(office, 'GET', '/purchase/requisition-candidates')).json();
    expect(back.data.find((x: { id: string }) => x.id === pi.id).lines).toEqual([
      expect.objectContaining({ quantity: chemFree + 2 }),
    ]);
    // an indent the stores give in full: "From the store", nothing for purchase
    const all = await raise([{ itemId: ids.PEN!, quantity: 1 }]);
    expect(all.route).toBe('from_store');
    expect(
      (await call(office, 'GET', '/purchase/requisition-candidates'))
        .json()
        .data.some((x: { id: string }) => x.id === all.id),
    ).toBe(false);
  });
  it('the issue and return lists filter and count; the registers; the store keeper opens the store registers only', async () => {
    const db = (sql: string, args: unknown[] = []) =>
      withMigrator(async (c) => (await c.query<{ n: number }>(sql, args)).rows[0]!.n);
    // issues: the figures over the filters, whatever the tab; the period, department, item, kind
    const all = (await call(keeper, 'GET', `/purchase/issues?from=${today}&to=${today}`)).json();
    const issued = await db(
      `SELECT count(*)::int AS n FROM stock_issues WHERE school_id = $1 AND issued_on = $2::date`,
      [school.id, today],
    );
    expect(all.figures.issues).toBe(issued);
    expect(all.total).toBe(issued);
    expect(all.figures.waiting).toBe(
      await db(
        `SELECT count(*)::int AS n FROM stock_issues WHERE school_id = $1 AND status = 'issued'`,
        [school.id],
      ),
    );
    const waiting = (await call(keeper, 'GET', `/purchase/issues?status=issued`)).json();
    expect(waiting.figures.issues).toBe(all.figures.issues);
    expect(waiting.total).toBe(all.figures.waiting);
    const sci = (await call(keeper, 'GET', `/purchase/issues?departmentId=${ids.Science!}`)).json();
    expect(sci.rows.length).toBeGreaterThan(0);
    expect(new Set(sci.rows.map((x: { department: string }) => x.department))).toEqual(
      new Set(['Science']),
    );
    expect((await call(keeper, 'GET', `/purchase/issues?itemId=${ids.CHEM!}`)).json().total).toBe(
      await db(
        `SELECT count(DISTINCT issue_id)::int AS n FROM stock_issue_lines WHERE school_id = $1 AND item_id = $2`,
        [school.id, ids.CHEM],
      ),
    );
    expect(
      (await call(keeper, 'GET', `/purchase/issues?kind=counter`))
        .json()
        .rows.every((x: { kind: string }) => x.kind === 'counter'),
    ).toBe(true);
    expect((await call(keeper, 'GET', '/purchase/issues?from=2099-01-01')).json().figures).toEqual({
      issues: 0,
      value: 0,
      waiting: 0,
      oldestWaitingDays: null,
    });
    // the to-issue queue names each group's department for the filter
    const queue = (await call(keeper, 'GET', '/purchase/to-issue')).json();
    for (const g of [...queue.groups, ...queue.indents])
      expect(g.departmentId === null || /^\d+$/.test(g.departmentId as string)).toBe(true);

    // returns: figures by kind, the reason, the period and department
    const rets = (await call(keeper, 'GET', `/purchase/returns?from=${today}`)).json();
    expect(rets.total).toBe(
      await db(`SELECT count(*)::int AS n FROM stock_returns WHERE school_id = $1`, [school.id]),
    );
    expect(rets.figures.toVendors).toBeGreaterThan(0);
    expect(rets.figures.intoStore).toBeGreaterThan(0);
    expect(rets.figures.value).toBeCloseTo(rets.figures.toVendors + rets.figures.intoStore, 2);
    const toVendor = (await call(keeper, 'GET', `/purchase/returns?kind=to_vendor`)).json();
    expect(toVendor.rows.every((x: { kind: string }) => x.kind === 'to_vendor')).toBe(true);
    expect(toVendor.figures.intoStore).toBe(rets.figures.intoStore);
    expect(
      (await call(keeper, 'GET', `/purchase/returns?departmentId=${ids.Science!}&kind=to_store`))
        .json()
        .rows.every((x: { department: string }) => x.department === 'Science'),
    ).toBe(true);
    expect((await call(keeper, 'GET', '/purchase/returns?to=2000-01-01')).json().total).toBe(0);

    // the registers: a row per line, the filters in words, the value summed
    const reg = (
      await call(admin, 'GET', `/purchase/reports/issue_register?from=${today}&to=${today}`)
    ).json();
    expect(reg.rows).toHaveLength(
      await db(
        `SELECT count(*)::int AS n FROM stock_issue_lines l JOIN stock_issues si ON si.id = l.issue_id
          WHERE si.school_id = $1 AND si.issued_on = $2::date`,
        [school.id, today],
      ),
    );
    expect(reg.totals[11]).toBeCloseTo(
      reg.rows.reduce((a: number, r: unknown[]) => a + Number(r[11]), 0),
      2,
    );
    const lab = (
      await call(admin, 'GET', `/purchase/reports/issue_register?storeId=${ids.lab!}`)
    ).json();
    expect(lab.words).toContain('Chemistry lab store');
    expect(lab.rows.every((r: unknown[]) => r[3] === 'Chemistry lab store')).toBe(true);
    const back = (
      await call(admin, 'GET', `/purchase/reports/return_register?status=to_vendor`)
    ).json();
    expect(back.rows.length).toBeGreaterThan(0);
    expect(back.rows.every((r: unknown[]) => r[2] === 'To the vendor')).toBe(true);
    const unack = (await call(admin, 'GET', '/purchase/reports/unacknowledged')).json();
    expect(unack.rows).toHaveLength(all.figures.waiting);
    expect(unack.words).toMatch(/^As on /);
    const file = (await call(admin, 'GET', `/purchase/reports/return_register?format=xlsx`)).json();
    expect(file.filename).toMatch(/return-register/i);

    // the store keeper: the store registers, not the purchase ones; the lists of the filters
    expect((await call(keeper, 'GET', '/purchase/reports/issue_register')).statusCode).toBe(200);
    expect((await call(keeper, 'GET', '/purchase/reports/po_register')).statusCode).toBe(403);
    const kf = (await call(keeper, 'GET', '/purchase/report-filters')).json();
    expect(Object.keys(kf.reports)).toContain('return_register');
    expect(Object.keys(kf.reports)).not.toContain('vendor_purchases');
    expect(kf.stores.map((x: { id: string }) => x.id)).toEqual(
      expect.arrayContaining([ids.main, ids.lab]),
    );
    expect(
      Object.keys((await call(admin, 'GET', '/purchase/report-filters')).json().reports),
    ).toContain('po_register');
    // a teacher sees neither
    expect((await call(teacher, 'GET', '/purchase/report-filters')).statusCode).toBe(403);
    expect((await call(teacher, 'GET', '/purchase/reports/issue_register')).statusCode).toBe(403);

    // where a new return starts: issues with goods not yet back (the lab keeper: the lab's only)
    const fromDept = (await call(keeper, 'GET', '/purchase/return-sources?kind=to_store')).json();
    expect(fromDept.rows.length).toBeGreaterThan(0);
    for (const x of fromDept.rows as Array<{ href: string; openLines: number }>) {
      expect(x.href).toMatch(/^\/purchase\/issues\/\d+#return$/);
      expect(x.openLines).toBeGreaterThan(0);
    }
    const labOnly = (await call(labKeeper, 'GET', '/purchase/return-sources?kind=to_store')).json();
    const labIssues = await withMigrator(async (c) =>
      (
        await c.query<{ id: string }>(
          `SELECT id::text FROM stock_issues WHERE school_id = $1 AND store_id = $2`,
          [school.id, ids.lab],
        )
      ).rows.map((x) => x.id),
    );
    expect(labOnly.rows.every((x: { id: string }) => labIssues.includes(x.id))).toBe(true);
    const toVend = (await call(admin, 'GET', '/purchase/return-sources?kind=to_vendor')).json();
    for (const x of toVend.rows as Array<{
      href: string;
      rejectedLines: number;
      stockLines: number;
    }>) {
      expect(x.href).toMatch(/^\/purchase\/returns\/new\?order=\d+$/);
      expect(x.rejectedLines + x.stockLines).toBeGreaterThan(0);
    }
    expect((await call(teacher, 'GET', '/purchase/return-sources?kind=to_vendor')).statusCode).toBe(
      403,
    );
  });
});
