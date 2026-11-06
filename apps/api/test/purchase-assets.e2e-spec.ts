/**
 * Purchase phase 2, part 9 (docs/design/84): accepted units of an asset item join the asset register
 * (one bought for an indent goes straight to its department and raiser); custody changes wait for the
 * new custodian; repair and lost; assets follow issues, returns and transfers; existing assets from
 * Excel; the yearly depreciation by category (straight line catching up earlier years; never an earlier
 * year after a later one); reorder drafts an indent; condemnation holds the stock, the committee signs,
 * the school admin (not its maker) writes it off and the disposal is recorded; labels, the record and
 * the reports.
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

describe('purchase assets, depreciation, reorder and condemnation (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let keeper: SeededUser;
  let labKeeper: SeededUser;
  let hod: SeededUser;
  let teacher: SeededUser;
  let m1: SeededUser;
  let m2: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('AS');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const assetsOf = (item: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{
            id: string;
            tag: string;
            status: string;
            store_id: string | null;
            custodian: string | null;
            serial_no: string | null;
          }>(
            `SELECT id::text, tag, status, store_id::text, custodian_employee_id::text AS custodian, serial_no
               FROM assets WHERE school_id = $1 AND item_id = $2 ORDER BY id`,
            [school.id, item],
          )
        ).rows,
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
      m1 = await seedUser(c, school, `${s}-m1`, 'class_teacher');
      m2 = await seedUser(c, school, `${s}-m2`, 'class_teacher');
      for (const [code, name, dept, u] of [
        ['O1', 'Om Office', 'Administration', office],
        ['K1', 'Kamla Keeper', 'Administration', keeper],
        ['L1', 'Lata Labkeeper', 'Science', labKeeper],
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
      const uom = async (code: string) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM purchase_uoms WHERE school_id = $1 AND code = $2`,
            [school.id, code],
          )
        ).rows[0]!.id;
      ids.NOS = await uom('NOS');
      ids.BOX = await uom('BOX');
      for (const [code, name, method, life, rate] of [
        ['FURN', 'Furniture', 'slm', 10, null],
        ['IT', 'IT equipment', 'wdv', null, 40],
        ['GEN', 'General', null, null, null],
      ] as const)
        ids[`cat${code}`] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_item_categories (school_id, code, name, dep_method, useful_life_years, salvage_pct, wdv_rate_pct)
             VALUES ($1, $2, $3, $4, $5, 5, $6) RETURNING id::text`,
            [school.id, code, name, method, life, rate],
          )
        ).rows[0]!.id;
      for (const [code, name, type, cat, unit, batch] of [
        ['LAP', 'Laptop', 'asset', ids.catIT, ids.NOS, false],
        ['CHAIR', 'Student chair', 'asset', ids.catFURN, ids.NOS, false],
        ['PEN', 'Ball pen', 'consumable', ids.catGEN, ids.BOX, false],
        ['CHEM', 'Copper sulphate 500 g', 'consumable', ids.catGEN, ids.NOS, true],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id, tracks_batch)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
            [school.id, code, name, type, cat, unit, batch],
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
      for (const m of [ids.M1, ids.M2])
        await c.query(
          `INSERT INTO condemnation_committee_members (school_id, employee_id, role) VALUES ($1, $2, 'Member')`,
          [school.id, m],
        );
      // Science asked for 1 laptop; the PR and PO buy 2 (one for the store)
      ids.PI = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_indents (school_id, number, department_id, raised_by, purpose, status, route)
           VALUES ($1, $2, $3, $4, 'A laptop for the lab', 'approved', 'ordered') RETURNING id::text`,
          [school.id, `PI/${s}/1`, ids.Science, teacher.id],
        )
      ).rows[0]!.id;
      const pil = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_indent_lines (school_id, indent_id, seq, item_id, quantity, uom_id) VALUES ($1, $2, 1, $3, 1, $4) RETURNING id::text`,
          [school.id, ids.PI, ids.LAP, ids.NOS],
        )
      ).rows[0]!.id;
      const pr = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_requisitions (school_id, number, department_id, purpose, status, created_by)
           VALUES ($1, $2, $3, 'Laptops', 'ordered', $4) RETURNING id::text`,
          [school.id, `PR/${s}/1`, ids.Science, office.id],
        )
      ).rows[0]!.id;
      const prl = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_requisition_lines (school_id, requisition_id, seq, item_id, quantity, uom_id, vendor_id, rate)
           VALUES ($1, $2, 1, $3, 2, $4, $5, 50000) RETURNING id::text`,
          [school.id, pr, ids.LAP, ids.NOS, ids.V1],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO purchase_requisition_sources (school_id, requisition_line_id, indent_line_id, quantity) VALUES ($1, $2, $3, 1)`,
        [school.id, prl, pil],
      );
      ids.PO = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_orders (school_id, number, status, requisition_id, department_id, vendor_id, vendor_gst_status,
                                        taxable, total, approved_at, created_by)
           VALUES ($1, $2, 'approved', $3, $4, $5, 'unregistered', 100000, 100000, now(), $6) RETURNING id::text`,
          [school.id, `PO/${s}/1`, pr, ids.Science, ids.V1, office.id],
        )
      ).rows[0]!.id;
      ids.POL = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_order_lines (school_id, order_id, seq, requisition_line_id, item_id, description, quantity, uom_id, rate,
                                             taxable, total)
           VALUES ($1, $2, 1, $3, $4, 'Laptop', 2, $5, 50000, 100000, 100000) RETURNING id::text`,
          [school.id, ids.PO, prl, ids.LAP, ids.NOS],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    ids.main = (await call(office, 'GET', '/purchase/stores')).json().data[0].id;
    ids.lab = (
      await call(office, 'POST', '/purchase/stores', {
        code: 'LAB',
        name: 'Lab store',
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
    await call(office, 'POST', `/purchase/stores/${ids.main!}/opening`, {
      lines: [
        { itemId: ids.PEN, qty: 30, rate: 8 },
        { itemId: ids.CHEM, qty: 5, rate: 60, batch: 'B1', expiry: '2026-12-31' },
      ],
    });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('accepted laptops join the register; the one bought for the indent goes to Science with its raiser', async () => {
    const r = await call(keeper, 'POST', '/purchase/receipts', {
      orderId: ids.PO,
      receivedOn: today,
      lines: [{ orderLineId: ids.POL, receivedQty: 2, serials: ['SN-A', 'SN-B'] }],
    });
    expect(r.statusCode).toBe(201);
    const ok = await call(hod, 'POST', `/purchase/receipts/${r.json().id}/inspect`, {
      action: 'accept',
    });
    expect(ok.json().status).toBe('accepted');
    const laps = await assetsOf(ids.LAP!);
    expect(laps).toHaveLength(2);
    expect(laps[0]).toMatchObject({ status: 'in_use', custodian: ids.T1, serial_no: 'SN-A' });
    expect(laps[1]).toMatchObject({ status: 'in_store', store_id: ids.main, serial_no: 'SN-B' });
    expect(laps[0]!.tag).toMatch(/^AST\/\d{4}-\d{2}\/\d{4}$/);
    ids.LAP1 = laps[0]!.id;
    ids.LAP2 = laps[1]!.id;
    const a = (await call(office, 'GET', `/purchase/assets/${ids.LAP1!}`)).json();
    expect(a).toMatchObject({
      cost: 50000,
      bookValue: 50000,
      department: 'Science',
      custodian: 'Tara Teacher E2E',
    });
    expect(a.movements.map((m: { kind: string }) => m.kind)).toEqual(['received', 'issued']);
    // the teacher sees what is in her care; she cannot see the whole register
    expect((await call(teacher, 'GET', '/purchase/assets-mine')).json().rows).toHaveLength(1);
    expect((await call(teacher, 'GET', '/purchase/assets')).statusCode).toBe(403);
  });

  it('custody waits for the new custodian; repair and lost are recorded', async () => {
    const mv = await call(office, 'POST', `/purchase/assets/${ids.LAP1!}/move`, {
      kind: 'custody',
      custodianId: ids.H1,
      location: 'HOD room',
      note: 'For the HOD',
    });
    expect(mv.json()).toEqual({ pending: true });
    const mine = (await call(hod, 'GET', '/purchase/assets-mine')).json();
    expect(mine.pending).toHaveLength(1);
    const movementId = mine.pending[0].movementId;
    expect(
      (await call(teacher, 'POST', `/purchase/asset-movements/${movementId}/acknowledge`, {}))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(hod, 'POST', `/purchase/asset-movements/${movementId}/acknowledge`, {
          note: 'Received',
        })
      ).statusCode,
    ).toBe(201);
    expect((await call(office, 'GET', `/purchase/assets/${ids.LAP1!}`)).json()).toMatchObject({
      custodian: 'Hari Head E2E',
      location: 'HOD room',
    });
    expect(
      (await call(office, 'POST', `/purchase/assets/${ids.LAP1!}/move`, { kind: 'repair_out' }))
        .statusCode,
    ).toBe(400);
    await call(office, 'POST', `/purchase/assets/${ids.LAP1!}/move`, {
      kind: 'repair_out',
      vendorId: ids.V1,
      note: 'Screen flickers',
    });
    expect((await call(office, 'GET', `/purchase/assets/${ids.LAP1!}`)).json().status).toBe(
      'under_repair',
    );
    await call(office, 'POST', `/purchase/assets/${ids.LAP1!}/move`, {
      kind: 'repair_back',
      cost: 1200,
    });
    expect((await call(office, 'GET', `/purchase/assets/${ids.LAP1!}`)).json().status).toBe(
      'in_use',
    );
    expect(
      (await call(office, 'GET', `/purchase/assets-of-employee/${ids.H1!}`))
        .json()
        .rows.map((x: { id: string }) => x.id),
    ).toEqual([ids.LAP1]);
  });

  it('assets follow issues, returns and store transfers', async () => {
    const iss = await call(keeper, 'POST', '/purchase/issues', {
      kind: 'counter',
      storeId: ids.main,
      departmentId: ids.Administration,
      takenByEmployeeId: ids.O1,
      purpose: 'Office laptop',
      lines: [{ itemId: ids.LAP, qty: 1 }],
    });
    expect(iss.statusCode).toBe(201);
    expect((await assetsOf(ids.LAP!))[1]).toMatchObject({ status: 'in_use', custodian: ids.O1 });
    const is = (await call(keeper, 'GET', `/purchase/issues/${iss.json().issues[0].id}`)).json();
    await call(keeper, 'POST', `/purchase/issues/${is.id}/return`, {
      lines: [
        { issueLineId: is.lineItems[0].id, qty: 1, condition: 'unused', reason: 'Not needed' },
      ],
    });
    expect((await assetsOf(ids.LAP!))[1]).toMatchObject({
      status: 'in_store',
      store_id: ids.main,
      custodian: null,
    });
    const t = await call(keeper, 'POST', '/purchase/transfers', {
      fromStoreId: ids.main,
      toStoreId: ids.lab,
      lines: [{ itemId: ids.LAP, qty: 1 }],
    });
    expect((await assetsOf(ids.LAP!))[1]!.status).toBe('in_transit');
    await call(labKeeper, 'POST', `/purchase/transfers/${t.json().id}/receive`, {});
    expect((await assetsOf(ids.LAP!))[1]).toMatchObject({ status: 'in_store', store_id: ids.lab });
  });

  it('existing assets from Excel: every row checked, the good ones saved', async () => {
    const f = (await call(office, 'GET', '/purchase/assets-format')).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(f.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const row = (n: number, v: Array<string | number>) =>
      v.forEach((x, i) => (ws.getRow(n).getCell(i + 1).value = x));
    row(2, [
      'CHAIR',
      'OLD-001',
      'Chair',
      'Godrej',
      '',
      '',
      2000,
      '2023-06-01',
      '',
      '',
      'Science',
      'Room 4',
      `${s}T1`,
      'good',
    ]);
    row(3, [
      'CHAIR',
      'OLD-002',
      'Chair',
      'Godrej',
      '',
      '',
      2000,
      '01-06-2023',
      '',
      'MAIN',
      '',
      '',
      '',
      'poor',
    ]);
    row(4, ['DESK', '', 'Desk', '', '', '', 1500, '2023-06-01', '', 'MAIN']);
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(office, 'POST', '/purchase/assets-import', { file, dryRun: true })
    ).json();
    expect(dry.rows.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, false]);
    expect(dry.rows[2].error).toContain('no asset item has the code DESK');
    const done = (
      await call(office, 'POST', '/purchase/assets-import', { file, dryRun: false })
    ).json();
    expect(done.saved).toBe(2);
    const chairs = await assetsOf(ids.CHAIR!);
    expect(chairs.map((x) => [x.tag, x.status])).toEqual([
      ['OLD-001', 'in_use'],
      ['OLD-002', 'in_store'],
    ]);
    ids.CH1 = chairs[0]!.id;
    ids.CH2 = chairs[1]!.id;
  });

  it('depreciation by category: straight line catching up earlier years, never an earlier year again', async () => {
    const dry = (
      await call(office, 'POST', '/purchase/depreciation', { fy: '2025-26', dryRun: true })
    ).json();
    expect(dry).toMatchObject({ fy: '2025-26', assets: 2, earlierYears: 4, saved: false });
    const run = (
      await call(office, 'POST', '/purchase/depreciation', { fy: '2025-26', dryRun: false })
    ).json();
    expect(run).toMatchObject({ saved: true, total: 380 });
    const ch = (await call(office, 'GET', `/purchase/assets/${ids.CH1!}`)).json();
    // (2,000 − 5%) / 10 = 190 a year; 2023-24 from 1 June: 305 of 366 days
    expect(
      ch.depreciation.map((d: { fy: string; depreciation: number }) => [d.fy, d.depreciation]),
    ).toEqual([
      ['2023-24', 158.33],
      ['2024-25', 190],
      ['2025-26', 190],
    ]);
    expect(ch.bookValue).toBe(1461.67);
    const again = await call(office, 'POST', '/purchase/depreciation', {
      fy: '2024-25',
      dryRun: false,
    });
    expect(again.statusCode).toBe(409);
    const fa = (
      await call(admin, 'GET', '/purchase/reports/fixed_assets?from=2025-04-01&to=2026-03-31')
    ).json();
    const furn = fa.rows.find((r: unknown[]) => r[0] === 'Furniture');
    expect(furn).toEqual(['Furniture', 3303.34, 0, 380, 0, 2923.34, 2]);
  });

  it('reorder lists what is low and drafts an indent for the store’s department', async () => {
    await call(office, 'PUT', `/purchase/stores/${ids.main!}/levels`, {
      lines: [{ itemId: ids.PEN, reorderLevel: 50, reorderQty: 100 }],
    });
    const list = (await call(keeper, 'GET', '/purchase/reorder')).json();
    expect(list.rows).toEqual([
      expect.objectContaining({
        code: 'PEN',
        free: 30,
        reorderLevel: 50,
        suggest: 10,
        purchaseUnit: 'BOX',
        mine: true,
      }),
    ]);
    const r = await call(keeper, 'POST', '/purchase/reorder/indent', {
      storeId: ids.main,
      lines: [{ itemId: ids.PEN, quantity: 10 }],
    });
    expect(r.statusCode).toBe(201);
    const pi = (await call(keeper, 'GET', `/purchase/indents/${r.json().id}`)).json();
    expect(pi).toMatchObject({ status: 'draft', department: 'Administration' });
    expect((await call(keeper, 'GET', '/purchase/reorder')).json().rows[0].indents).toBe('a draft');
  });

  it('condemnation: stock held, the committee signs, the admin writes it off, the disposal recorded', async () => {
    const r = await call(office, 'POST', '/purchase/condemnations', {
      title: 'Broken chairs and expired chemicals',
      lines: [
        { kind: 'asset', assetId: ids.CH2, reasonKind: 'unserviceable', reason: 'Legs broken' },
        {
          kind: 'stock',
          storeId: ids.main,
          itemId: ids.CHEM,
          batch: 'B1',
          qty: 2,
          reasonKind: 'expired',
        },
      ],
    });
    expect(r.statusCode).toBe(201);
    ids.CDN = r.json().id;
    expect(r.json().number).toMatch(/^CDN\//);
    // the chemicals are held: a counter issue cannot take them
    const take = await call(keeper, 'POST', '/purchase/issues', {
      kind: 'counter',
      storeId: ids.main,
      departmentId: ids.Science,
      takenByEmployeeId: ids.T1,
      purpose: 'Lab',
      lines: [{ itemId: ids.CHEM, qty: 4 }],
    });
    expect(take.json().detail).toContain('3 free');
    expect(
      (await call(office, 'POST', `/purchase/condemnations/${ids.CDN!}/submit`)).statusCode,
    ).toBe(201);
    expect(
      (await call(teacher, 'POST', `/purchase/condemnations/${ids.CDN!}/sign`)).statusCode,
    ).toBe(403);
    expect(
      (await call(m1, 'POST', `/purchase/condemnations/${ids.CDN!}/sign`)).json(),
    ).toMatchObject({
      status: 'committee',
    });
    expect(
      (await call(m2, 'POST', `/purchase/condemnations/${ids.CDN!}/sign`)).json(),
    ).toMatchObject({
      status: 'approval',
    });
    expect(
      (
        await call(office, 'POST', `/purchase/condemnations/${ids.CDN!}/decide`, {
          action: 'approve',
        })
      ).statusCode,
    ).toBe(403);
    const ok = await call(admin, 'POST', `/purchase/condemnations/${ids.CDN!}/decide`, {
      action: 'approve',
    });
    expect(ok.json()).toEqual({ status: 'written_off' });
    const k = (await call(admin, 'GET', `/purchase/condemnations/${ids.CDN!}`)).json();
    expect(k).toMatchObject({ status: 'written_off', value: 1581.67 });
    expect((await assetsOf(ids.CHAIR!))[1]!.status).toBe('written_off');
    const chem = await withMigrator(
      async (c) =>
        (
          await c.query<{ qty: string; reserved: string }>(
            `SELECT qty::text, reserved::text FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
            [ids.main, ids.CHEM],
          )
        ).rows[0],
    );
    expect(chem).toEqual({ qty: '3.000', reserved: '0.000' });
    expect(
      (
        await call(office, 'POST', `/purchase/condemnations/${ids.CDN!}/dispose`, {
          method: 'scrap',
          disposedOn: today,
          amount: 300,
        })
      ).json().detail,
    ).toContain('Name the buyer');
    const d = await call(office, 'POST', `/purchase/condemnations/${ids.CDN!}/dispose`, {
      method: 'scrap',
      disposedOn: today,
      party: 'Local scrap dealer',
      amount: 300,
    });
    expect(d.json()).toEqual({ status: 'disposed' });
    expect((await assetsOf(ids.CHAIR!))[1]!.status).toBe('disposed');
    expect((await call(admin, 'GET', `/purchase/condemnations/${ids.CDN!}/pdf`)).statusCode).toBe(
      200,
    );
  });

  it('labels and the reports: asset register, fixed assets, condemnations', async () => {
    const lab = await call(office, 'GET', `/purchase/asset-labels?ids=${ids.LAP1!},${ids.LAP2!}`);
    expect(lab.statusCode).toBe(200);
    expect(lab.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const reg = (await call(admin, 'GET', '/purchase/reports/asset_register?status=held')).json();
    expect(reg.rows.map((x: unknown[]) => x[0]).sort()).toHaveLength(3);
    const cdn = (await call(admin, 'GET', '/purchase/reports/condemnations')).json();
    expect(cdn.rows).toHaveLength(1);
    expect(cdn.rows[0][8]).toBe('scrap');
  });
});
