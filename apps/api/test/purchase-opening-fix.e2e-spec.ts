/**
 * Opening stock corrected, rate corrections and the count's reasons (docs/design/84, "As built — opening
 * stock corrections; the count rebuilt", 9 Nov 2026): the opening checked before it posts (values, a ₹0
 * rate, a rate far from the last purchase, the assets an asset item makes); while an item has not moved
 * since, its opening changed (reversed exactly, the right lines posted, its assets keeping their tags)
 * or removed, and a whole upload undone; once it has moved, a rate correction the school admin (not who
 * asked) approves; assets made for an older opening; a count with reasons from a list, excess and
 * shortage, as Excel and PDF; the opening stock statement; and who may do what.
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

describe('purchase opening stock corrections, rate corrections and the count (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let keeper: SeededUser;
  let teacher: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('OF');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const balance = (store: string, item: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{ qty: string; value: string; avg_rate: string }>(
            `SELECT qty::text, value::text, avg_rate::text FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
            [store, item],
          )
        ).rows[0],
    );
  const moves = (store: string, item: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{ kind: string; qty: string; value: string }>(
            `SELECT kind, qty::text, value::text FROM stock_moves WHERE store_id = $1 AND item_id = $2 ORDER BY id`,
            [store, item],
          )
        ).rows,
    );
  const assets = (item: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{ tag: string; cost: string; status: string }>(
            `SELECT tag, cost::text, status FROM assets WHERE item_id = $1 ORDER BY tag`,
            [item],
          )
        ).rows,
    );
  const opening = (store: string, body: unknown) =>
    call(office, 'POST', `/purchase/stores/${store}/opening`, body);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-po`, 'purchase_office');
      keeper = await seedUser(c, school, `${s}-sk`, 'store_keeper');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      for (const [code, u] of [
        ['K1', keeper],
        ['H1', teacher],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
             VALUES ($1, $2, $3, 'E2E', 'Staff', 'Science', $4) RETURNING id::text`,
            [school.id, `${s}${code}`, code, u.id],
          )
        ).rows[0]!.id;
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      await c.query(`SELECT app.purchase_seed_masters($1)`, [school.id]);
      ids.science = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM departments WHERE school_id = $1 AND name = 'Science'`,
          [school.id],
        )
      ).rows[0]!.id;
      const nos = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM purchase_uoms WHERE school_id = $1 AND code = 'NOS'`,
          [school.id],
        )
      ).rows[0]!.id;
      const cat = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_item_categories (school_id, code, name) VALUES ($1, 'GEN', 'General') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      for (const [code, name, type, batch, last] of [
        ['PEN', 'Ball pen', 'consumable', false, 10],
        ['CHEM', 'Copper sulphate 500 g', 'consumable', true, null],
        ['PROJ', 'Projector', 'asset', false, null],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id, tracks_batch, last_purchase_rate)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
            [school.id, code, name, type, cat, nos, batch, last],
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
        departmentId: ids.science,
        keeperIds: [ids.K1],
      })
    ).json().id;
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('checks before it posts: values, a ₹0 rate, a rate far from the last purchase, the assets; then posts', async () => {
    const lines = [
      { itemId: ids.PEN, qty: 100, rate: 1 },
      { itemId: ids.PROJ, qty: 5, rate: 0 },
      { itemId: ids.CHEM, qty: 10, rate: 50, batch: 'B1', expiry: '2027-03-31' },
    ];
    const dry = (await opening(ids.main!, { dryRun: true, lines })).json();
    expect(dry).toMatchObject({ dryRun: true, posted: 0, value: 600 });
    const by = (code: string) =>
      dry.lines.find((l: { code: string }) => l.code === code) as {
        warnings: string[];
        assets: number;
        value: number;
      };
    expect(by('PEN').warnings[0]).toContain('far from the last purchase (₹10)');
    expect(by('PROJ').warnings[0]).toContain('Rate ₹0');
    expect(by('PROJ').assets).toBe(5);
    expect(by('CHEM').warnings).toEqual([]);
    expect(await balance(ids.main!, ids.PEN!)).toBeUndefined();
    const half = (
      await opening(ids.main!, { lines: [{ itemId: ids.PROJ, qty: 2.5, rate: 1 }] })
    ).json();
    expect(half.detail).toContain('whole');
    const r = await opening(ids.main!, { lines });
    expect(r.statusCode).toBe(201);
    const o = (await call(office, 'GET', `/purchase/stores/${ids.main!}/openings`)).json();
    expect(o.postings).toHaveLength(1);
    expect(o.postings[0]).toMatchObject({ source: 'hand', value: 600, canUndo: true, lines: 3 });
    expect(o.lines.find((l: { itemId: string }) => l.itemId === ids.PROJ)).toMatchObject({
      canChange: true,
      why: null,
    });
    const made = await assets(ids.PROJ!);
    expect(made).toHaveLength(5);
    expect(made.every((a) => a.cost === '0.00' && a.status === 'in_store')).toBe(true);
    ids.tags = made.map((a) => a.tag).join(',');
  });

  it('an untouched opening is changed: reversed exactly, the right lines posted, its assets keep their tags', async () => {
    // a count being counted takes the new book quantity
    ids.CNT1 = (await call(office, 'POST', '/purchase/counts', { storeId: ids.main })).json().id;
    const noWhy = await call(office, 'POST', `/purchase/stores/${ids.main!}/opening-fix`, {
      itemId: ids.PROJ,
      lines: [{ qty: 4, rate: 45000 }],
    });
    expect(noWhy.statusCode).toBe(400);
    const r = await call(office, 'POST', `/purchase/stores/${ids.main!}/opening-fix`, {
      itemId: ids.PROJ,
      lines: [{ qty: 4, rate: 45000 }],
      reason: 'The rate was left at 0; one was counted twice',
    });
    expect(r.statusCode).toBe(201);
    expect(await balance(ids.main!, ids.PROJ!)).toEqual({
      qty: '4.000',
      value: '180000.00',
      avg_rate: '45000.0000',
    });
    expect((await moves(ids.main!, ids.PROJ!)).map((m) => `${m.kind} ${m.qty} ${m.value}`)).toEqual(
      ['opening 5.000 0.00', 'opening_undo -5.000 0.00', 'opening 4.000 180000.00'],
    );
    const now = await assets(ids.PROJ!);
    expect(now).toHaveLength(4);
    expect(now.every((a) => a.cost === '45000.00')).toBe(true);
    expect(now.every((a) => ids.tags!.split(',').includes(a.tag))).toBe(true);
    const o = (await call(office, 'GET', `/purchase/stores/${ids.main!}/openings`)).json();
    expect(o.postings[0]).toMatchObject({
      source: 'correction',
      reason: expect.stringContaining('left at 0'),
    });
    const old = (
      await call(
        office,
        'GET',
        `/purchase/stores/${ids.main!}/openings?posting=${o.postings[1].id as string}&status=reversed`,
      )
    ).json();
    expect(old.lines.map((l: { itemId: string }) => l.itemId)).toEqual([ids.PROJ]);
    const book = await withMigrator(
      async (c) =>
        (
          await c.query<{ b: string }>(
            `SELECT book_qty::text AS b FROM stock_count_lines WHERE count_id = $1 AND item_id = $2`,
            [ids.CNT1, ids.PROJ],
          )
        ).rows[0]!.b,
    );
    expect(book).toBe('4.000');
    // a batch item: its batches as they should have been
    expect(
      (
        await call(office, 'POST', `/purchase/stores/${ids.main!}/opening-fix`, {
          itemId: ids.CHEM,
          lines: [
            { qty: 8, rate: 55, batch: 'B1', expiry: '2027-03-31' },
            { qty: 2, rate: 60, batch: 'B2', expiry: '2026-12-31' },
          ],
          reason: 'Two batches on the shelf',
        })
      ).statusCode,
    ).toBe(201);
    expect(await balance(ids.main!, ids.CHEM!)).toMatchObject({ qty: '10.000', value: '560.00' });
    await call(office, 'POST', `/purchase/counts/${ids.CNT1!}/cancel`, { note: 'Recount later' });
  });

  it('removes a wrong item and opens it again; undoes a whole upload', async () => {
    const rm = await call(office, 'POST', `/purchase/stores/${ids.main!}/opening-fix`, {
      itemId: ids.PEN,
      lines: [],
      reason: 'Pens belong to the lab store',
    });
    expect(rm.json()).toMatchObject({ removed: true });
    expect(await balance(ids.main!, ids.PEN!)).toMatchObject({ qty: '0.000', value: '0.00' });
    expect(
      (await opening(ids.main!, { lines: [{ itemId: ids.PEN, qty: 100, rate: 10 }] })).statusCode,
    ).toBe(201);
    // the lab keeper's upload, undone at once
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Opening stock');
    ws.addRow(['Item code *', 'Quantity *', 'Rate *', 'Batch', 'Expiry']);
    ws.addRow(['PEN', 20, 10, '', '']);
    ws.addRow(['CHEM', 3, 50, 'B5', '31-03-2027']);
    const file = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64');
    const dry = (
      await call(keeper, 'POST', `/purchase/stores/${ids.lab!}/opening-import`, { file })
    ).json();
    expect(dry).toMatchObject({ good: 2, value: 350, warned: 0 });
    expect(dry.rows[0]).toMatchObject({ name: 'Ball pen', qty: 20, rate: 10, value: 200 });
    await call(keeper, 'POST', `/purchase/stores/${ids.lab!}/opening-import`, {
      file,
      fileName: 'lab-opening.xlsx',
      dryRun: false,
    });
    const lab = (await call(keeper, 'GET', `/purchase/stores/${ids.lab!}/openings`)).json();
    expect(lab.postings[0]).toMatchObject({
      source: 'excel',
      fileName: 'lab-opening.xlsx',
      canUndo: true,
    });
    const noWhy = await call(
      keeper,
      'POST',
      `/purchase/openings/${lab.postings[0].id as string}/undo`,
      {
        reason: '',
      },
    );
    expect(noWhy.statusCode).toBe(400);
    const undo = await call(
      keeper,
      'POST',
      `/purchase/openings/${lab.postings[0].id as string}/undo`,
      {
        reason: 'The main store sheet was uploaded here',
      },
    );
    expect(undo.json()).toEqual({ undone: 2 });
    expect(await balance(ids.lab!, ids.CHEM!)).toMatchObject({ qty: '0.000', value: '0.00' });
    const after = (await call(keeper, 'GET', `/purchase/stores/${ids.lab!}/openings`)).json();
    expect(after.postings[0]).toMatchObject({
      canUndo: false,
      undoReason: expect.stringContaining('main store'),
    });
    expect(
      (
        await call(keeper, 'POST', `/purchase/openings/${lab.postings[0].id as string}/undo`, {
          reason: 'Again',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('a moved item is settled: the rate corrected once the school admin (not who asked) approves', async () => {
    const issue = await call(office, 'POST', '/purchase/issues', {
      kind: 'counter',
      storeId: ids.main,
      departmentId: ids.science,
      takenByEmployeeId: ids.H1,
      purpose: 'Exams',
      lines: [{ itemId: ids.PEN, qty: 5 }],
    });
    expect(issue.statusCode).toBe(201);
    const settled = await call(office, 'POST', `/purchase/stores/${ids.main!}/opening-fix`, {
      itemId: ids.PEN,
      lines: [{ qty: 100, rate: 12 }],
      reason: 'Rate',
    });
    expect(settled.statusCode).toBe(409);
    expect(settled.json().detail).toContain('moved since');
    const pen = (
      await call(office, 'GET', `/purchase/stores/${ids.main!}/openings?q=Ball&status=settled`)
    ).json();
    expect(pen.lines[0]).toMatchObject({
      itemId: ids.PEN,
      canChange: false,
      why: expect.stringContaining('moved since'),
    });
    // an untouched item: change its opening instead
    const untouched = await call(office, 'POST', `/purchase/stores/${ids.main!}/revaluations`, {
      itemId: ids.CHEM,
      newRate: 60,
      reason: 'Rate',
    });
    expect(untouched.json().detail).toContain('change the opening instead');
    const ask = await call(office, 'POST', `/purchase/stores/${ids.main!}/revaluations`, {
      itemId: ids.PEN,
      newRate: 12,
      reason: 'Pens cost 12 each, not 10',
    });
    expect(ask.statusCode).toBe(201);
    expect(ask.json().number).toMatch(/^RVL\//);
    expect(
      (
        await call(office, 'POST', `/purchase/stores/${ids.main!}/revaluations`, {
          itemId: ids.PEN,
          newRate: 13,
          reason: 'Again',
        })
      ).statusCode,
    ).toBe(409);
    const rv = ask.json().id as string;
    const list = (await call(admin, 'GET', '/purchase/revaluations?status=submitted')).json();
    expect(list.rows[0]).toMatchObject({ id: rv, qty: 95, oldRate: 10, newRate: 12, change: 190 });
    expect(list.rows[0].can.decide).toBe(true);
    expect(
      (await call(office, 'POST', `/purchase/revaluations/${rv}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(keeper, 'POST', `/purchase/revaluations/${rv}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call(admin, 'POST', `/purchase/revaluations/${rv}/decide`, { action: 'approve' })
      ).json(),
    ).toEqual({ status: 'approved' });
    expect(await balance(ids.main!, ids.PEN!)).toEqual({
      qty: '95.000',
      value: '1140.00',
      avg_rate: '12.0000',
    });
    expect((await moves(ids.main!, ids.PEN!)).slice(-2).map((m) => m.kind)).toEqual([
      'revalue',
      'revalue',
    ]);
  });

  it('makes the assets an older opening did not', async () => {
    await withMigrator((c) => c.query(`DELETE FROM assets WHERE item_id = $1`, [ids.PROJ]));
    const o = (await call(office, 'GET', `/purchase/stores/${ids.main!}/openings`)).json();
    expect(o.missingAssets).toEqual([
      expect.objectContaining({ itemId: ids.PROJ, units: 4, assets: 0, canMake: true }),
    ]);
    expect(
      (await call(office, 'POST', `/purchase/stores/${ids.main!}/opening-assets`)).json(),
    ).toEqual({ made: 4 });
    expect((await assets(ids.PROJ!)).every((a) => a.cost === '45000.00')).toBe(true);
    expect(
      (await call(office, 'GET', `/purchase/stores/${ids.main!}/openings`)).json().missingAssets,
    ).toEqual([]);
  });

  it('the count: reasons from a list, excess and shortage, Excel and PDF, the reason on the adjustment', async () => {
    const id = (await call(office, 'POST', '/purchase/counts', { storeId: ids.main })).json()
      .id as string;
    const k = (await call(office, 'GET', `/purchase/counts/${id}`)).json();
    const line = (code: string, batch: string | null = null) =>
      k.lineItems.find(
        (l: { itemCode: string; batch: string | null }) => l.itemCode === code && l.batch === batch,
      ).id as string;
    await call(office, 'PUT', `/purchase/counts/${id}/lines`, {
      countedBy: 'Om, Kamla',
      lines: [
        { lineId: line('PEN'), countedQty: 95 },
        { lineId: line('CHEM', 'B1'), countedQty: 8 },
        { lineId: line('CHEM', 'B2'), countedQty: 1, reasonCode: 'expired', reason: 'Thrown away' },
        { lineId: line('PROJ'), countedQty: 5, reasonCode: 'other' },
      ],
    });
    const noNote = await call(office, 'POST', `/purchase/counts/${id}/submit`);
    expect(noNote.json().detail).toContain('note for Other');
    await call(office, 'PUT', `/purchase/counts/${id}/lines`, {
      lines: [
        { lineId: line('PROJ'), countedQty: 5, reasonCode: 'other', reason: 'Found in the hall' },
      ],
    });
    const seen = (await call(office, 'GET', `/purchase/counts/${id}`)).json();
    expect(seen.figures).toMatchObject({
      lines: 4,
      counted: 4,
      excess: 1,
      excessValue: 45000,
      shortage: 1,
      // at the item's average (₹560 for 10), as the adjustment posts
      shortageValue: -56,
      net: 44944,
      noReason: 0,
    });
    expect(
      seen.lineItems.find((l: { itemCode: string }) => l.itemCode === 'PROJ').reasonWords,
    ).toBe('Other: Found in the hall');
    expect((await call(office, 'POST', `/purchase/counts/${id}/submit`)).statusCode).toBe(201);
    // the count as Excel: book, counted, excess, shortage, value, reason
    const x = (await call(office, 'GET', `/purchase/counts/${id}/statement`)).json();
    expect(x.filename).toMatch(/\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.base64 as string, 'base64') as unknown as ArrayBuffer);
    const cells = wb.worksheets[0]!.getSheetValues().flat().map(String);
    expect(cells).toEqual(expect.arrayContaining(['Excess', 'Shortage', 'Expired: Thrown away']));
    const pdf = await call(office, 'GET', `/purchase/counts/${id}/pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await call(admin, 'POST', `/purchase/counts/${id}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(201);
    const notes = await withMigrator(async (c) =>
      (
        await c.query<{ note: string }>(
          `SELECT note FROM stock_moves WHERE doc_type = 'stock_count' AND doc_id = $1 ORDER BY id`,
          [id],
        )
      ).rows.map((r) => r.note),
    );
    expect(notes.some((n) => n.includes('Expired: Thrown away'))).toBe(true);
    const report = (await call(admin, 'GET', '/purchase/reports/count_differences')).json();
    expect(report.rows.flat()).toEqual(expect.arrayContaining(['Expired: Thrown away']));
  });

  it('the opening stock statement as PDF and Excel; who may do what', async () => {
    const pdf = await call(keeper, 'GET', `/purchase/stores/${ids.main!}/opening-statement`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const xl = (
      await call(keeper, 'GET', `/purchase/stores/${ids.main!}/opening-statement?format=xlsx`)
    ).json();
    expect(xl.filename).toMatch(/Opening-stock-MAIN.*\.xlsx$/);
    expect((await call(teacher, 'GET', `/purchase/stores/${ids.main!}/openings`)).statusCode).toBe(
      403,
    );
    expect(
      (
        await call(teacher, 'POST', `/purchase/stores/${ids.main!}/opening-fix`, {
          itemId: ids.CHEM,
          lines: [],
          reason: 'Nope',
        })
      ).statusCode,
    ).toBe(403);
    // the lab keeper does not keep the main store
    expect(
      (
        await call(keeper, 'POST', `/purchase/stores/${ids.main!}/opening-fix`, {
          itemId: ids.CHEM,
          lines: [],
          reason: 'Not mine',
        })
      ).statusCode,
    ).toBe(403);
    // outside the stores: only those one is on the approval of — none here
    expect((await call(teacher, 'GET', '/purchase/revaluations')).json().rows).toEqual([]);
  });
  it('the Physical count and Rate correction levels on Who approves decide who approves; pages and filters', async () => {
    // the lab store belongs to Science: its counts and rate corrections go to the named teacher
    for (const doc of ['count', 'revaluation'])
      expect(
        (
          await call(admin, 'PUT', `/purchase/approvals/${ids.science!}/${doc}`, {
            levels: [{ name: 'Store in-charge', by: 'employees', employeeIds: [ids.H1] }],
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (await opening(ids.lab!, { lines: [{ itemId: ids.PEN, qty: 6, rate: 10 }] })).statusCode,
    ).toBe(201);
    const k = (await call(keeper, 'POST', '/purchase/counts', { storeId: ids.lab })).json()
      .id as string;
    const before = (await call(keeper, 'GET', `/purchase/counts/${k}?page=1&size=25`)).json();
    expect(before.approval).toMatchObject({ department: 'Science', levels: ['Store in-charge'] });
    expect(before.show).toBe('all');
    const pen = before.lineItems.find((l: { itemCode: string }) => l.itemCode === 'PEN');
    await call(keeper, 'PUT', `/purchase/counts/${k}/lines`, {
      lines: [{ lineId: pen.id, countedQty: 5, reasonCode: 'damaged' }],
    });
    expect((await call(keeper, 'POST', `/purchase/counts/${k}/submit`)).statusCode).toBe(201);
    const sent = (await call(admin, 'GET', `/purchase/counts/${k}?page=1&size=25`)).json();
    expect(sent.show).toBe('diff');
    expect(sent.found).toBe(1);
    expect(sent.approval.steps).toEqual([
      expect.objectContaining({ level: 1, name: 'Store in-charge', status: 'pending' }),
    ]);
    expect(sent.approval.steps[0].assignees).toHaveLength(1);
    expect(sent.can.decide).toBe(false);
    expect(
      (await call(admin, 'POST', `/purchase/counts/${k}/decide`, { action: 'approve' })).statusCode,
    ).toBe(403);
    // the teacher sees it (not of the stores, but on its approval) and approves it
    expect(
      (await call(teacher, 'GET', '/purchase/counts?mine=1'))
        .json()
        .rows.map((x: { id: string }) => x.id),
    ).toEqual([k]);
    expect((await call(teacher, 'GET', `/purchase/counts/${k}`)).json().can.decide).toBe(true);
    expect((await call(teacher, 'GET', '/purchase/counts')).statusCode).toBe(403);
    expect(
      (await call(teacher, 'POST', `/purchase/counts/${k}/decide`, { action: 'approve' })).json(),
    ).toEqual({ status: 'approved' });
    expect(await balance(ids.lab!, ids.PEN!)).toMatchObject({ qty: '5.000' });
    // a rate correction of the lab: with the teacher too
    await call(keeper, 'POST', '/purchase/issues', {
      kind: 'counter',
      storeId: ids.lab,
      departmentId: ids.science,
      takenByEmployeeId: ids.H1,
      purpose: 'Lab',
      lines: [{ itemId: ids.PEN, qty: 1 }],
    });
    const rv = (
      await call(keeper, 'POST', `/purchase/stores/${ids.lab!}/revaluations`, {
        itemId: ids.PEN,
        newRate: 11,
        reason: 'Pens are 11 now',
      })
    ).json().id as string;
    const waiting = (
      await call(keeper, 'GET', `/purchase/revaluations?storeId=${ids.lab!}`)
    ).json();
    expect(waiting.rows[0]).toMatchObject({
      id: rv,
      waitingWith: expect.stringContaining('Store in-charge'),
    });
    expect(
      (await call(admin, 'POST', `/purchase/revaluations/${rv}/decide`, { action: 'approve' }))
        .statusCode,
    ).toBe(403);
    expect((await call(teacher, 'GET', '/purchase/revaluations')).json().rows[0].can.decide).toBe(
      true,
    );
    expect(
      (
        await call(teacher, 'POST', `/purchase/revaluations/${rv}/decide`, { action: 'approve' })
      ).json(),
    ).toEqual({ status: 'approved' });
    expect(await balance(ids.lab!, ids.PEN!)).toMatchObject({ qty: '4.000', value: '44.00' });
    // the stock a page at a time, one item, and the opening lines paged
    const page = (
      await call(office, 'GET', `/purchase/stock?storeId=${ids.main!}&page=1&size=25`)
    ).json();
    expect(page).toMatchObject({ page: 1, size: 25 });
    expect(page.data.length).toBe(Math.min(25, page.total as number));
    const one = (
      await call(office, 'GET', `/purchase/stock?storeId=${ids.main!}&itemId=${ids.PROJ!}&page=1`)
    ).json();
    expect(one.data.map((x: { itemId: string }) => x.itemId)).toEqual([ids.PROJ]);
    const lines = (
      await call(
        office,
        'GET',
        `/purchase/stores/${ids.main!}/openings?page=1&size=25&status=standing`,
      )
    ).json();
    expect(lines.lines.every((l: { reversed: boolean }) => !l.reversed)).toBe(true);
    expect(Object.keys(lines.itemLines)).toEqual(
      expect.arrayContaining(lines.lines.map((l: { itemId: string }) => l.itemId)),
    );
    const store = (await call(office, 'GET', `/purchase/stores/${ids.main!}?stock=0`)).json();
    expect(store.stock).toEqual([]);
  });
});
