/**
 * Purchase phase 2, part 6 (docs/design/84): stores and the stock ledger — the main store made on first
 * use, sub-stores under it with their keepers; opening stock (once per store and item, batches for an
 * item kept by batch, from Excel with a check first); the weighted average, moves out at the average,
 * the earliest expiry first, never below nothing; the ledger never changed; units fixed once stock has
 * moved; stock in hand with reorder levels, as Excel and PDF; an item's stock register; and who may
 * do what.
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

describe('purchase stores and stock (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let office: SeededUser;
  let keeper: SeededUser;
  let teacher: SeededUser;
  const ids: Record<string, string> = {};
  const s = stamp('ST');
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

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      office = await seedUser(c, school, `${s}-po`, 'purchase_office');
      keeper = await seedUser(c, school, `${s}-sk`, 'store_keeper');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      for (const [code, name, u] of [
        ['K1', 'Kamla Keeper', keeper],
        ['T1', 'Tara Teacher', teacher],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
             VALUES ($1, $2, $3, 'E2E', 'Lab assistant', 'Science', $4) RETURNING id::text`,
            [school.id, `${s}${code}`, name, u.id],
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
      ids.cat = cat.rows[0]!.id;
      for (const [code, name, type, unit, extra] of [
        ['PEN', 'Ball pen', 'consumable', ids.BOX, {}],
        ['CHEM', 'Copper sulphate 500 g', 'consumable', ids.NOS, { tracks_batch: true }],
        ['FIX', 'Plumbing repair', 'service', ids.NOS, {}],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id, tracks_batch)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
            [school.id, code, name, type, ids.cat, unit, 'tracks_batch' in extra],
          )
        ).rows[0]!.id;
      // pens are bought by the box of 10 and kept as pieces
      await c.query(
        `UPDATE purchase_items SET stock_uom_id = $2, stock_per_unit = 10 WHERE id = $1`,
        [ids.PEN, ids.NOS],
      );
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('makes the main store on first use; a sub-store sits under it with its keepers', async () => {
    const list = (await call(office, 'GET', '/purchase/stores')).json();
    expect(list.data).toEqual([
      expect.objectContaining({ code: 'MAIN', kind: 'main', status: 'active' }),
    ]);
    ids.main = list.data[0].id;
    expect((await call(teacher, 'GET', '/purchase/stores')).statusCode).toBe(403);
    expect(
      (await call(keeper, 'POST', '/purchase/stores', { code: 'LAB', name: 'Chemistry lab store' }))
        .statusCode,
    ).toBe(403);
    const r = await call(office, 'POST', '/purchase/stores', {
      code: 'lab',
      name: 'Chemistry lab store',
      departmentId: ids.science,
      location: 'Science block, room 12',
      keeperIds: [ids.K1],
    });
    expect(r.statusCode).toBe(201);
    ids.lab = r.json().id;
    expect(
      (await call(office, 'POST', '/purchase/stores', { code: 'LAB', name: 'Again' })).statusCode,
    ).toBe(409);
    const lab = (await call(keeper, 'GET', `/purchase/stores/${ids.lab!}`)).json();
    expect(lab).toMatchObject({
      code: 'LAB',
      kind: 'sub',
      parent: 'Main store',
      mine: true,
      can: { operate: true, manage: false },
    });
    expect(lab.keepers).toEqual([expect.objectContaining({ name: 'Kamla Keeper E2E' })]);
    expect((await call(keeper, 'GET', `/purchase/stores/${ids.main!}`)).json().can.operate).toBe(
      false,
    );
    expect(
      (
        await call(office, 'PUT', `/purchase/stores/${ids.main!}`, {
          code: 'MAIN',
          name: 'Main store',
          status: 'inactive',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('opening stock once per store and item; batches for an item kept by batch; services refused', async () => {
    const r = await call(office, 'POST', `/purchase/stores/${ids.main!}/opening`, {
      lines: [
        { itemId: ids.PEN, qty: 100, rate: 8 },
        { itemId: ids.CHEM, qty: 10, rate: 50, batch: 'B1', expiry: '2027-01-31' },
        { itemId: ids.CHEM, qty: 5, rate: 60, batch: 'B2', expiry: '2026-12-31' },
      ],
    });
    expect(r.statusCode).toBe(201);
    expect(await balance(ids.main!, ids.PEN!)).toEqual({
      qty: '100.000',
      value: '800.00',
      avg_rate: '8.0000',
    });
    expect(await balance(ids.main!, ids.CHEM!)).toMatchObject({ qty: '15.000', value: '800.00' });
    const again = await call(office, 'POST', `/purchase/stores/${ids.main!}/opening`, {
      lines: [{ itemId: ids.PEN, qty: 1, rate: 8 }],
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().detail).toContain('correct it with a count');
    expect(
      (
        await call(office, 'POST', `/purchase/stores/${ids.lab!}/opening`, {
          lines: [{ itemId: ids.FIX, qty: 1, rate: 1 }],
        })
      ).json().detail,
    ).toContain('not kept in stock');
    expect(
      (
        await call(office, 'POST', `/purchase/stores/${ids.lab!}/opening`, {
          lines: [{ itemId: ids.CHEM, qty: 1, rate: 1 }],
        })
      ).json().detail,
    ).toContain('give the batch');
    // the keeper works their own store, not the main store
    expect(
      (
        await call(keeper, 'POST', `/purchase/stores/${ids.main!}/opening`, {
          lines: [{ itemId: ids.PEN, qty: 1, rate: 8 }],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(keeper, 'POST', `/purchase/stores/${ids.lab!}/opening`, {
          lines: [{ itemId: ids.PEN, qty: 20, rate: 9 }],
        })
      ).statusCode,
    ).toBe(201);
  });

  it('weighted average in, the average out, earliest expiry first, never below nothing; the ledger is never changed', async () => {
    await withMigrator(async (c) => {
      await c.query(`SELECT app.stock_post($1, $2, 'receipt', 100, 10)`, [ids.main, ids.PEN]);
      expect(await balance(ids.main!, ids.PEN!)).toEqual({
        qty: '200.000',
        value: '1800.00',
        avg_rate: '9.0000',
      });
      await c.query(`SELECT app.stock_post($1, $2, 'issue', -50, 0)`, [ids.main, ids.PEN]);
      expect(await balance(ids.main!, ids.PEN!)).toEqual({
        qty: '150.000',
        value: '1350.00',
        avg_rate: '9.0000',
      });
      await c.query(`SELECT app.stock_post($1, $2, 'issue', -7, 0)`, [ids.main, ids.CHEM]);
      const batches = await c.query<{ batch_no: string; qty_left: string }>(
        `SELECT batch_no, qty_left::text FROM stock_batches WHERE store_id = $1 AND item_id = $2 ORDER BY batch_no`,
        [ids.main, ids.CHEM],
      );
      expect(batches.rows).toEqual([
        { batch_no: 'B1', qty_left: '8.000' },
        { batch_no: 'B2', qty_left: '0.000' },
      ]);
      await expect(
        c.query(`SELECT app.stock_post($1, $2, 'issue', -1000, 0)`, [ids.main, ids.PEN]),
      ).rejects.toThrow(/stock.insufficient/);
      await expect(
        c.query(`UPDATE stock_moves SET qty = 1 WHERE store_id = $1`, [ids.main]),
      ).rejects.toThrow(/not changed/);
      await expect(
        c.query(`UPDATE purchase_items SET stock_per_unit = 5 WHERE id = $1`, [ids.PEN]),
      ).rejects.toThrow(/units cannot change/);
      // the last of it out takes the value left
      await c.query(`SELECT app.stock_post($1, $2, 'issue', -150, 0)`, [ids.main, ids.PEN]);
      expect(await balance(ids.main!, ids.PEN!)).toMatchObject({ qty: '0.000', value: '0.00' });
      await c.query(`SELECT app.stock_post($1, $2, 'receipt', 30, 11)`, [ids.main, ids.PEN]);
    });
  });

  it('stock in hand with reorder levels, as Excel and PDF; the item’s stock register', async () => {
    expect(
      (
        await call(office, 'PUT', `/purchase/stores/${ids.main!}/levels`, {
          lines: [{ itemId: ids.PEN, reorderLevel: 50, reorderQty: 100, maxQty: 200 }],
        })
      ).statusCode,
    ).toBe(200);
    const st = (await call(keeper, 'GET', '/purchase/stock')).json();
    const pen = st.data.find(
      (x: { storeId: string; code: string }) => x.storeId === ids.main && x.code === 'PEN',
    );
    expect(pen).toMatchObject({
      qty: 30,
      unit: 'NOS',
      value: 330,
      avgRate: 11,
      reorderLevel: 50,
      below: true,
    });
    expect(st.below).toBe(1);
    expect((await call(office, 'GET', '/purchase/stock?below=1')).json().data).toHaveLength(1);
    expect(
      (await call(office, 'GET', `/purchase/stock?storeId=${ids.lab!}`))
        .json()
        .data.map((x: { code: string }) => x.code),
    ).toEqual(['PEN']);
    for (const format of ['xlsx', 'pdf'])
      expect(
        (await call(office, 'GET', `/purchase/stock?format=${format}`)).json().filename,
      ).toMatch(new RegExp(`\\.${format}$`));
    const reg = (
      await call(office, 'GET', `/purchase/stock/items/${ids.PEN!}?storeId=${ids.main!}`)
    ).json();
    expect(reg.item).toMatchObject({ code: 'PEN', unit: 'NOS', purchaseUnit: 'BOX', perUnit: 10 });
    expect(
      reg.moves.map((m: { kind: string; balanceQty: number }) => [m.kind, m.balanceQty]),
    ).toEqual([
      ['opening', 100],
      ['receipt', 200],
      ['issue', 150],
      ['issue', 0],
      ['receipt', 30],
    ]);
    expect(
      (await call(office, 'GET', `/purchase/stock/items/${ids.CHEM!}`)).json().batches,
    ).toEqual([expect.objectContaining({ batch: 'B1', qty: 8 })]);
    expect((await call(teacher, 'GET', '/purchase/stock')).statusCode).toBe(403);
  });

  it('opening stock from Excel: every row checked first, then the good rows posted', async () => {
    expect(
      (await call(keeper, 'GET', `/purchase/stores/${ids.lab!}/opening-template`)).json().filename,
    ).toMatch(/\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Opening stock');
    ws.addRow(['Item code *', 'Quantity *', 'Rate *', 'Batch', 'Expiry']);
    ws.addRow(['CHEM', 4, 55, 'B9', '31-03-2027']);
    ws.addRow(['NOPE', 1, 1, '', '']);
    ws.addRow(['PEN', 5, 9, '', '']);
    const file = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64');
    const dry = (
      await call(keeper, 'POST', `/purchase/stores/${ids.lab!}/opening-import`, { file })
    ).json();
    expect(dry).toMatchObject({ dryRun: true, good: 1, bad: 2, posted: 0 });
    expect(dry.rows.find((r: { code: string }) => r.code === 'PEN').error).toContain(
      'already has its opening',
    );
    const done = (
      await call(keeper, 'POST', `/purchase/stores/${ids.lab!}/opening-import`, {
        file,
        dryRun: false,
      })
    ).json();
    expect(done).toMatchObject({ posted: 1 });
    expect(await balance(ids.lab!, ids.CHEM!)).toMatchObject({ qty: '4.000', value: '220.00' });
  });
});
