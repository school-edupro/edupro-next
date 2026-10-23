/**
 * Stock verification in cycles (0219, docs/design/36-library.md, "Library reports", part 3): a cycle over
 * the libraries, shelves and material types chosen, never two open cycles on one copy; copies verified by
 * scan (old numbers and any case found; numbers outside the cycle or unknown kept), by a file checked
 * before it is applied, or by hand (and taken back); the lists by state and the numbers outside, as Excel
 * or PDF; the copies register's stock columns and statuses; the close (missing copies marked lost if
 * asked, books on loan counted) and a cycle cancelled.
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

describe('library stock verification in cycles (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let librarian: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? librarian).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const day = (n: number) =>
    new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  const s = stamp('LST');
  const ids: Record<string, string> = {};
  const upload = (cycle: string, fileName: string, body: Buffer) =>
    inject({
      method: 'POST',
      url: `/library/stock/cycles/${cycle}/uploads?fileName=${encodeURIComponent(fileName)}`,
      headers: h(),
      raw: { contentType: 'application/octet-stream', body },
    });
  const items = async (cycle: string, query: string) =>
    (await call('GET', `/library/stock/cycles/${cycle}/items?${query}`)).json() as {
      rows: Array<Record<string, unknown>>;
      total: number;
    };
  const nos = (r: { rows: Array<Record<string, unknown>> }) =>
    r.rows.map((x) => x.accessionNo ?? x.typed);
  const register = async (status: string) =>
    (
      await call('POST', '/library/register/copies', {
        size: 50,
        page: 1,
        status,
        columns: [{ key: 'stock_state' }, { key: 'stock_cycle' }, { key: 'stock_verified_by' }],
      })
    ).json() as { rows: Array<Record<string, unknown>> };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.main = setup.libraries[0].id as string;
    const type = (code: string) =>
      setup.materialTypes.find((x: { code: string }) => x.code === code).id as string;
    ids.book = type('BOOK');
    ids.mag = type('MAG');
    ids.ref = type('REF');
    await withMigrator(async (c) => {
      const shelf = async (code: string) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO library_shelves (school_id, library_id, code) VALUES ($1, $2, $3) RETURNING id::text`,
            [school.id, ids.main, code],
          )
        ).rows[0]!.id;
      ids.s1 = await shelf('S1');
      ids.s2 = await shelf('S2');
      ids.junior = (
        await c.query<{ id: string }>(
          `INSERT INTO library_libraries (school_id, code, name) VALUES ($1, 'JR', 'Junior library') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO library_accession_series (school_id, library_id, material_type_id, prefix) VALUES ($1, $2, $3, 'JB')`,
        [school.id, ids.junior, ids.book],
      );
    });
    const add = async (
      title: string,
      type: string,
      library: string,
      count: number,
      shelf?: string,
    ) => {
      const r = await call('POST', '/library/books', {
        title,
        people: [{ name: 'R. K. Narayan' }],
        materialTypeId: type,
        copies: { libraryId: library, shelfId: shelf, count, accessionedOn: '2026-01-10' },
      });
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string; accessionNos: string[] };
    };
    const malgudi = await add('Malgudi Days', ids.book, ids.main, 4, ids.s1);
    ids.malgudi = malgudi.id;
    expect(malgudi.accessionNos).toEqual(['B00001', 'B00002', 'B00003', 'B00004']);
    expect((await add('Swami and Friends', ids.book, ids.main, 2, ids.s2)).accessionNos).toEqual([
      'B00005',
      'B00006',
    ]);
    expect((await add('Tinkle', ids.mag!, ids.main!, 2, ids.s2)).accessionNos).toEqual([
      'M00001',
      'M00002',
    ]);
    expect((await add('Panchatantra', ids.book!, ids.junior!, 2)).accessionNos).toEqual([
      'JB00001',
      'JB00002',
    ]);
    // B00002 was renumbered from 2-OLD; B00006 has a barcode of its own
    await withMigrator(async (c) => {
      const copy = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM library_copies WHERE school_id = $1 AND accession_no = 'B00002'`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO library_accession_changes (school_id, copy_id, old_no, new_no, reason, changed_by_name)
         VALUES ($1, $2, '2-OLD', 'B00002', 'test', 'Test')`,
        [school.id, copy],
      );
      await c.query(
        `UPDATE library_copies SET barcode = '8901234567890' WHERE school_id = $1 AND accession_no = 'B00006'`,
        [school.id],
      );
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, employee_type)
           VALUES ($1, $2, 'Meena', 'Iyer', 'teaching') RETURNING id::text`,
          [school.id, `${s}-E1`],
        )
      ).rows[0]!.id;
    });
  });
  afterAll(async () => app.close());

  it('a cycle over the shelves, libraries or types chosen; never two open cycles on one copy', async () => {
    expect(
      (await call('POST', '/library/stock/cycles', { name: 'Nope' }, coordinator)).statusCode,
    ).toBe(403);
    const s1 = await call('POST', '/library/stock/cycles', {
      name: 'Shelf S1 — October',
      shelfIds: [ids.s1],
    });
    expect(s1.statusCode).toBe(201);
    ids.c1 = s1.json().id as string;
    expect(s1.json()).toMatchObject({
      status: 'open',
      startedBy: expect.any(String),
      counts: { total: 4, verified: 0, pending: 4, onLoan: 0, missing: 0 },
      done: 0,
    });
    expect(s1.json().scope.words).toBe('Every library · shelves S1 · every material type');
    // the whole Main library takes S1's copies too
    const clash = await call('POST', '/library/stock/cycles', {
      name: 'Main library',
      libraryIds: [ids.main],
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().detail).toContain(
      '4 of these copies are in the open cycle "Shelf S1 — October"',
    );
    const junior = await call('POST', '/library/stock/cycles', {
      name: 'Junior library',
      libraryIds: [ids.junior],
    });
    expect(junior.json()).toMatchObject({ counts: { total: 2 } });
    ids.c2 = junior.json().id as string;
    const mags = await call('POST', '/library/stock/cycles', {
      name: 'Magazines',
      materialTypeIds: [ids.mag],
    });
    expect(mags.json()).toMatchObject({ counts: { total: 2 } });
    ids.c3 = mags.json().id as string;
    expect(
      (
        await call('POST', '/library/stock/cycles', { name: 'Ref', materialTypeIds: [ids.ref] })
      ).json().type,
    ).toBe('library.stock_empty');
    expect(
      (await call('POST', '/library/stock/cycles', { name: 'X', libraryIds: ['999999999'] }))
        .statusCode,
    ).toBe(400);
    const list = (await call('GET', '/library/stock/cycles')).json().data;
    expect(list.map((x: { name: string }) => x.name)).toEqual(
      expect.arrayContaining(['Shelf S1 — October', 'Junior library', 'Magazines']),
    );
  });

  it('scanned: any case, an old number or a barcode; outside the cycle, unknown and repeated kept apart', async () => {
    const r = await call('POST', `/library/stock/cycles/${ids.c1!}/verify`, {
      accessionNos: ['B00001', '2-old', 'B00005', 'NOPE', 'b00001'],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      verified: [
        expect.objectContaining({ no: 'B00001', accessionNo: 'B00001', title: 'Malgudi Days' }),
        expect.objectContaining({ no: '2-old', accessionNo: 'B00002' }),
      ],
      already: [],
      outside: [expect.objectContaining({ no: 'B00005', accessionNo: 'B00005', shelf: 'S2' })],
      unknown: [expect.objectContaining({ no: 'NOPE' })],
      repeated: [expect.objectContaining({ no: 'b00001' })],
      cycle: { counts: { verified: 2, pending: 2, outside: 1, unknown: 1 }, done: 50 },
    });
    expect(
      (
        await call('POST', `/library/stock/cycles/${ids.c1!}/verify`, { accessionNos: ['B00001'] })
      ).json().already,
    ).toEqual([expect.objectContaining({ accessionNo: 'B00001' })]);
    // a barcode works in the magazines' cycle? B00006 is a book: outside it
    expect(
      (
        await call('POST', `/library/stock/cycles/${ids.c3!}/verify`, {
          accessionNos: ['8901234567890'],
        })
      ).json().outside,
    ).toEqual([expect.objectContaining({ accessionNo: 'B00006' })]);
    // a book issued during the cycle is counted as on loan
    expect(
      (
        await call('POST', '/library/loans/issue', {
          accessionNo: 'B00003',
          borrowerKind: 'employee',
          borrowerId: ids.employee,
        })
      ).statusCode,
    ).toBe(201);
    const c1 = (await call('GET', `/library/stock/cycles/${ids.c1!}`)).json();
    expect(c1.counts).toMatchObject({ verified: 2, pending: 1, onLoan: 1 });
    expect(c1.done).toBe(75);
    const copies = (await call('GET', `/library/titles/${ids.malgudi!}/copies`)).json().data;
    expect(
      copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00001').lastVerifiedOn,
    ).toBe(day(0));
  });

  it('a file of book numbers is checked first, then applied (or discarded)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Scanner');
    ws.addRow(['Stock check of shelf S1']);
    ws.addRow(['Sr', 'Accession No', 'Remarks']);
    ws.addRow([1, 'B00004', 'Spine torn']);
    ws.addRow([2, 'B00002', '']);
    ws.addRow([3, 'ZZ9', 'not ours']);
    ws.addRow([4, '', '']);
    const xlsx = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const up = await upload(ids.c1!, 'shelf-s1.xlsx', xlsx);
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({
      fileName: 'shelf-s1.xlsx',
      status: 'checked',
      numbers: 3,
      counts: { verify: 1, already: 1, outside: 0, unknown: 1, repeated: 0 },
      lists: {
        verify: [expect.objectContaining({ row: 3, no: 'B00004' })],
        already: [expect.objectContaining({ no: 'B00002' })],
        unknown: [expect.objectContaining({ row: 5, no: 'ZZ9' })],
      },
    });
    // nothing is verified until applied
    expect((await call('GET', `/library/stock/cycles/${ids.c1!}`)).json().counts.verified).toBe(2);
    const applied = await call('POST', `/library/stock/uploads/${up.json().id as string}/apply`);
    expect(applied.json()).toMatchObject({
      counts: { verify: 1, already: 1, unknown: 1 },
      cycle: { counts: { verified: 3, pending: 0, onLoan: 1, unknown: 2 } },
    });
    expect(
      (await call('POST', `/library/stock/uploads/${up.json().id as string}/apply`)).statusCode,
    ).toBe(409);
    expect(
      (await call('GET', `/library/stock/uploads/${up.json().id as string}`)).json(),
    ).toMatchObject({ status: 'applied', counts: { verify: 1 } });
    // a scanner's text file: one number a line, no heading; discarded
    const txt = await upload(ids.c2!, 'scan.txt', Buffer.from('JB00001\r\nJB00002\r\n\r\n'));
    expect(txt.json()).toMatchObject({ numbers: 2, counts: { verify: 2 } });
    expect(
      (await call('POST', `/library/stock/uploads/${txt.json().id as string}/discard`)).json(),
    ).toMatchObject({ status: 'discarded' });
    expect((await call('GET', `/library/stock/cycles/${ids.c2!}`)).json().counts.verified).toBe(0);
    expect((await upload(ids.c2!, 'scan.pdf', Buffer.from('%PDF'))).statusCode).toBe(400);
    expect((await upload(ids.c2!, 'empty.csv', Buffer.from('\n\n'))).statusCode).toBe(400);
    const tpl = (await call('GET', '/library/stock/template')).json();
    expect(tpl.filename).toBe('Stock-check-upload.xlsx');
  });

  it('the lists by state and the numbers outside; a copy verified by hand or taken back; Excel and PDF', async () => {
    const verified = await items(ids.c1!, 'state=verified');
    expect(nos(verified)).toEqual(['B00001', 'B00002', 'B00004']);
    expect(verified.rows.find((x) => x.accessionNo === 'B00004')).toMatchObject({
      state: 'verified',
      method: 'excel',
      remark: 'Spine torn',
      foundOn: day(0),
      shelf: 'S1',
    });
    expect((await items(ids.c1!, 'state=on_loan')).rows).toEqual([
      expect.objectContaining({
        accessionNo: 'B00003',
        borrower: 'Meena Iyer',
        borrowerRef: `${s}-E1`,
      }),
    ]);
    const extras = await items(ids.c1!, 'state=extras');
    expect(extras.rows.map((x) => `${String(x.extra)} ${String(x.typed)}`).sort()).toEqual([
      'outside B00005',
      'unknown NOPE',
      'unknown ZZ9',
    ]);
    // verified by mistake: back to pending; then by hand with a remark
    expect(
      (
        await call(
          'POST',
          `/library/stock/cycles/${ids.c1!}/items/${String(verified.rows[1]!.copyId)}/unverify`,
        )
      ).json().counts,
    ).toMatchObject({ verified: 2, pending: 1 });
    expect(nos(await items(ids.c1!, 'state=pending'))).toEqual(['B00002']);
    expect(
      (
        await call(
          'POST',
          `/library/stock/cycles/${ids.c1!}/items/${String(verified.rows[1]!.copyId)}/unverify`,
        )
      ).statusCode,
    ).toBe(409);
    const jr = await items(ids.c2!, 'state=pending');
    const byHand = await call(
      'POST',
      `/library/stock/cycles/${ids.c2!}/items/${String(jr.rows[0]!.copyId)}/verify`,
      { remark: 'On the display table' },
    );
    expect(byHand.json().counts).toMatchObject({ verified: 1, pending: 1 });
    expect((await items(ids.c2!, 'state=verified')).rows[0]).toMatchObject({
      method: 'manual',
      remark: 'On the display table',
    });
    expect((await items(ids.c1!, 'state=all&q=b0000')).total).toBe(4);
    const x = await call(
      'GET',
      `/library/stock/cycles/${ids.c1!}/items/export?state=verified&format=xlsx`,
    );
    expect(x.json()).toMatchObject({ filename: `Stock-check-verified-${day(0)}.xlsx`, rows: 2 });
    const p = await call(
      'GET',
      `/library/stock/cycles/${ids.c1!}/items/export?state=extras&format=pdf`,
    );
    expect(
      Buffer.from(p.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });

  it('the copies register shows each copy in its latest cycle, and lists verified, pending or missing', async () => {
    const v = await register('stock_verified');
    expect(v.rows.map((r) => r.accession_no)).toEqual(['B00001', 'B00004', 'JB00001']);
    expect(v.rows[0]).toMatchObject({
      stock_state: 'Verified',
      stock_cycle: 'Shelf S1 — October',
      stock_verified_by: expect.any(String),
    });
    expect((await register('stock_pending')).rows.map((r) => r.accession_no)).toEqual([
      'B00002',
      'JB00002',
      'M00001',
      'M00002',
    ]);
    const fields = (await call('GET', '/library/register/copies/fields')).json();
    expect(fields.fields.find((f: { key: string }) => f.key === 'stock_state').options).toContain(
      'Not in a cycle',
    );
  });

  it('closed: not found is missing (marked lost if asked), on loan is counted; a cycle cancelled', async () => {
    // closing is its own right (0223): the librarian scans, the in-charge / admin closes
    const refused = await call('POST', `/library/stock/cycles/${ids.c1!}/close`, {
      markMissingLost: true,
    });
    expect(refused.statusCode).toBe(403);
    const closed = await call(
      'POST',
      `/library/stock/cycles/${ids.c1!}/close`,
      { markMissingLost: true, note: 'Shelf S1 done' },
      admin,
    );
    expect(closed.json()).toMatchObject({
      status: 'closed',
      finishedOn: day(0),
      missingMarkedLost: true,
      counts: { verified: 2, missing: 1, onLoan: 1, pending: 0 },
    });
    const copies = (await call('GET', `/library/books/${ids.malgudi!}`)).json().copies;
    expect(copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00002')).toMatchObject({
      status: 'lost',
      statusReason: 'Missing at the stock check "Shelf S1 — October"',
    });
    expect((await register('stock_missing')).rows.map((r) => r.accession_no)).toEqual(['B00002']);
    expect(
      (
        await call('POST', `/library/stock/cycles/${ids.c1!}/verify`, { accessionNos: ['B00002'] })
      ).json().type,
    ).toBe('library.stock_closed');
    // the shelf's copies are free again: the whole Main library (B00002 is lost now; magazines still open)
    const main = await call('POST', '/library/stock/cycles', {
      name: 'Main books',
      libraryIds: [ids.main],
      materialTypeIds: [ids.book],
    });
    expect(main.json()).toMatchObject({ counts: { total: 5 } });
    expect(
      (
        await call(
          'POST',
          `/library/stock/cycles/${main.json().id as string}/cancel`,
          { reason: 'x' },
          admin,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/library/stock/cycles/${main.json().id as string}/cancel`, {
          reason: 'Started on the wrong day',
        })
      ).statusCode,
    ).toBe(403);
    const cancelled = await call(
      'POST',
      `/library/stock/cycles/${main.json().id as string}/cancel`,
      { reason: 'Started on the wrong day' },
      admin,
    );
    expect(cancelled.json()).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Started on the wrong day',
    });
    // a cancelled cycle is not the copies' latest
    expect((await register('stock_verified')).rows.map((r) => r.accession_no)).toEqual([
      'B00001',
      'B00004',
      'JB00001',
    ]);
  });

  it('check a book: a copy by number shows where it is, who has it and its history; the dashboard adds up', async () => {
    // a lost copy found by its number: status, the stock check in its history, the other copies
    const found = (await call('GET', '/library/check?q=b00002')).json();
    expect(found).toMatchObject({ kind: 'copy' });
    const lost = (await call('GET', `/library/check/copies/${found.copyId as string}`)).json();
    expect(lost.copy).toMatchObject({ accessionNo: 'B00002', status: 'lost' });
    expect(lost.title.title).toBe('Malgudi Days');
    expect(lost.history.map((h: { what: string }) => h.what)).toEqual(
      expect.arrayContaining(['stock check', 'lost']),
    );
    expect(lost.others.length).toBeGreaterThan(0);
    // the copy on loan: who has it and since when
    const out = (await call('GET', '/library/check?q=B00003')).json();
    const onLoan = (await call('GET', `/library/check/copies/${out.copyId as string}`)).json();
    expect(onLoan.loan).toMatchObject({ borrowerKind: 'employee', daysLate: 0, fineSoFar: 0 });
    expect(onLoan.history.map((h: { what: string }) => h.what)).toEqual(
      expect.arrayContaining(['issued', 'stock check']),
    );
    // a title search lists the books with copies on the shelf and out
    const titles = (await call('GET', '/library/check?q=malgudi')).json();
    expect(titles.kind).toBe('titles');
    expect(titles.titles[0]).toMatchObject({ title: 'Malgudi Days' });
    expect(titles.titles[0].copies).toBeGreaterThan(0);
    expect((await call('GET', '/library/check?q=zz-no-such-book')).json().titles).toEqual([]);
    // the dashboard
    const d = (await call('GET', '/library/dashboard')).json();
    expect(d.months).toHaveLength(6);
    expect(d.figures.lost).toBeGreaterThanOrEqual(1);
    expect(d.figures.onLoan).toBeGreaterThanOrEqual(1);
    expect(d.figures.issuedToday).toBeGreaterThanOrEqual(1);
    expect(d.months.at(-1).issued).toBeGreaterThanOrEqual(1);
    const one = (await call('GET', `/library/dashboard?libraryId=${ids.main!}`)).json();
    expect(one.libraryId).toBe(ids.main);
    expect(one.figures.copies).toBeLessThanOrEqual(d.figures.copies);
  });

  it('reopened: by the close right, with a reason, within the days; lost copies restored; then closed again', async () => {
    // the librarian may not; a reason is needed
    expect(
      (
        await call('POST', `/library/stock/cycles/${ids.c1!}/reopen`, {
          reason: 'Recount shelf S1',
        })
      ).statusCode,
    ).toBe(403);
    const before = (await call('GET', `/library/stock/cycles/${ids.c1!}`, undefined, admin)).json();
    expect(before.reopen).toMatchObject({ allowed: true });
    const done = await call(
      'POST',
      `/library/stock/cycles/${ids.c1!}/reopen`,
      { reason: 'Recount shelf S1: books were in the reading room' },
      admin,
    );
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ status: 'open', finishedOn: null, reopened: 1 });
    expect(done.json().reopenLog[0]).toMatchObject({
      restored: 1,
      reason: expect.stringContaining('Recount'),
    });
    expect(done.json().counts.missing).toBe(0);
    // B00002 marked lost by the close is back on the shelf, with the event in its history
    const copy = (await call('GET', '/library/check?q=B00002')).json();
    const b2 = (await call('GET', `/library/check/copies/${copy.copyId as string}`)).json();
    expect(b2.copy.status).toBe('available');
    expect(b2.history.map((h: { what: string }) => h.what)).toContain('available');
    // closed again; a closed cycle older than the school's days cannot be reopened
    const again = await call(
      'POST',
      `/library/stock/cycles/${ids.c1!}/close`,
      { markMissingLost: false },
      admin,
    );
    expect(again.json()).toMatchObject({ status: 'closed', reopened: 1 });
    await withMigrator((c) =>
      c.query(`UPDATE library_stock_checks SET finished_on = CURRENT_DATE - 30 WHERE id = $1`, [
        ids.c1,
      ]),
    );
    const late = await call(
      'POST',
      `/library/stock/cycles/${ids.c1!}/reopen`,
      { reason: 'Too late now' },
      admin,
    );
    expect(late.statusCode).toBe(409);
    expect(late.json().detail).toContain('Start a new cycle');
  });
});
