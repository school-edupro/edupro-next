/**
 * Books updated from Excel by accession number (docs/design/36-library.md, "Library round 3", part 2): a
 * template filled with the copies chosen and the columns ticked; the file checked row by row with the
 * book form's rules (each row tried and undone): old against new, unknown and repeated numbers, a list
 * name not in Library setup, a shelf of another library, a vendor without a purchase, one title given two
 * values; a title change reaching every copy (said); applied all together; CLEAR empties a field.
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

describe('library books updated from Excel (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let librarian: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? librarian).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const s = stamp('LBU');
  const ids: Record<string, string> = {};
  const upload = (fileName: string, body: Buffer) =>
    inject({
      method: 'POST',
      url: `/library/books/update?fileName=${encodeURIComponent(fileName)}`,
      headers: h(),
      raw: { contentType: 'application/octet-stream', body },
    });
  const xlsx = async (rows: unknown[][]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Books');
    for (const r of rows) ws.addRow(r);
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  };
  type Summary = {
    id: string;
    status: string;
    totalRows: number;
    readyRows: number;
    unchangedRows: number;
    rejectedRows: number;
    applied: number;
    problems: Array<{ row: number; accessionNo?: string; column: string; message: string }>;
    changes: Array<{
      row: number;
      accessionNo: string;
      title: string;
      changes: Array<{ field: string; label: string; from: string; to: string }>;
    }>;
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.main = setup.libraries[0].id as string;
    ids.book = setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id as string;
    await withMigrator(async (c) => {
      const one = async (sql: string, args: unknown[]) =>
        (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
      ids.s1 = await one(
        `INSERT INTO library_shelves (school_id, library_id, code) VALUES ($1, $2, 'S1') RETURNING id::text`,
        [school.id, ids.main],
      );
      ids.junior = await one(
        `INSERT INTO library_libraries (school_id, code, name) VALUES ($1, 'JR', 'Junior library') RETURNING id::text`,
        [school.id],
      );
      await one(
        `INSERT INTO library_shelves (school_id, library_id, code) VALUES ($1, $2, 'J1') RETURNING id::text`,
        [school.id, ids.junior],
      );
      await c.query(
        `INSERT INTO library_accession_series (school_id, library_id, material_type_id, prefix) VALUES ($1, $2, $3, 'JB')`,
        [school.id, ids.junior, ids.book],
      );
      await one(
        `INSERT INTO library_vendors (school_id, code, name) VALUES ($1, 'BH', 'Book House') RETURNING id::text`,
        [school.id],
      );
    });
    const add = async (title: string, count: number, people: unknown[]) => {
      const r = await call('POST', '/library/books', {
        title,
        people,
        materialTypeId: ids.book,
        copies: { libraryId: ids.main, count, accessionedOn: '2026-01-10', price: 300 },
      });
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string; accessionNos: string[] };
    };
    const a = await add('Malgudi Days', 3, [
      { name: 'R. K. Narayan' },
      { name: 'E. Editor', role: 'Editor' },
    ]);
    ids.malgudi = a.id;
    expect(a.accessionNos).toEqual(['B00001', 'B00002', 'B00003']);
    const b = await add('Swami and Friends', 3, [{ name: 'R. K. Narayan' }]);
    ids.swami = b.id;
    expect(b.accessionNos).toEqual(['B00004', 'B00005', 'B00006']);
  });
  afterAll(async () => app.close());

  it('the template: the copies chosen, the columns ticked, filled with what they have now', async () => {
    const fields = (await call('GET', '/library/books/update/fields')).json();
    expect(fields.sections.map((x: { id: string }) => x.id)).toEqual([
      'book',
      'publication',
      'copy',
      'source',
    ]);
    expect(fields.fields.find((x: { key: string }) => x.key === 'shelf')).toMatchObject({
      label: 'Shelf',
      level: 'copy',
    });
    expect(
      (await call('GET', '/library/books/update/fields', undefined, coordinator)).statusCode,
    ).toBe(403);
    const t = await call(
      'GET',
      `/library/books/update/template?fields=authors,shelf,copy_price&libraryId=${ids.main!}`,
    );
    expect(t.statusCode).toBe(200);
    expect(t.json().rows).toBe(6);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(t.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Books')!;
    expect(ws.getRow(1).values).toEqual([
      undefined,
      'Accession No.',
      'Title (not changed)',
      'Authors',
      'Shelf',
      'Copy price (₹)',
    ]);
    expect(ws.getRow(2).values).toEqual([
      undefined,
      'B00001',
      'Malgudi Days',
      'R. K. Narayan',
      undefined,
      '300',
    ]);
    expect(
      (await call('GET', '/library/books/update/template?fields=nope')).json().detail,
    ).toContain('Unknown field');
  });

  it('checked row by row, old against new; the problems listed; nothing saved yet', async () => {
    const file = await xlsx([
      ['Accession No.', 'Title', 'Authors', 'Library', 'Shelf', 'Copy price (₹)', 'Reference only'],
      ['B00001', '', '', '', 'S1', 250, ''],
      ['B00002', 'Malgudi Days (Stories)', '', '', '', '', ''],
      ['B00003', 'Malgudi', '', '', '', '', ''],
      ['b00004', '', 'R. K. Narayan; A. N. Other', 'Junior library', '', '', ''],
      ['B00005', '', '', '', '', 'abc', ''],
      ['B00006', '', '', '', 'J1', '', 'CLEAR'],
      ['NOPE', '', '', '', '', '', ''],
      ['B00001', '', '', '', '', 1, ''],
    ]);
    const r = await upload('update.xlsx', file);
    expect(r.statusCode).toBe(201);
    const x = r.json() as Summary;
    expect(x).toMatchObject({ status: 'validated', totalRows: 8, readyRows: 3, rejectedRows: 5 });
    const said = x.problems.map((p) => `${String(p.row)} ${p.column}: ${p.message}`);
    expect(said).toEqual(
      expect.arrayContaining([
        '4 Title: row 3 gives this title "Malgudi Days (Stories)"',
        '6 Copy price (₹): a number',
        `7 Shelf: no shelf "J1" in this copy's library`,
        '7 Reference only: cannot be emptied',
        '8 Accession No.: no copy with this number',
        '9 Accession No.: the same copy as row 2',
        '0 Title: "Malgudi Days": the book fields change all 3 copies of the title',
      ]),
    );
    expect(x.changes).toEqual([
      expect.objectContaining({
        accessionNo: 'B00001',
        changes: [
          expect.objectContaining({ label: 'Shelf', from: '', to: 'S1' }),
          expect.objectContaining({ label: 'Copy price (₹)', from: '300', to: '250' }),
        ],
      }),
      expect.objectContaining({
        accessionNo: 'B00002',
        changes: [
          expect.objectContaining({
            label: 'Title',
            from: 'Malgudi Days',
            to: 'Malgudi Days (Stories)',
          }),
        ],
      }),
      expect.objectContaining({
        accessionNo: 'B00004',
        changes: [
          expect.objectContaining({ label: 'Library', from: 'Main library', to: 'Junior library' }),
          expect.objectContaining({
            label: 'Authors',
            from: 'R. K. Narayan',
            to: 'R. K. Narayan; A. N. Other',
          }),
        ],
      }),
    ]);
    ids.check1 = x.id;
    // nothing saved by the check
    const book = (await call('GET', `/library/books/${ids.malgudi!}`)).json();
    expect(book.title).toBe('Malgudi Days');
    expect(
      book.copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00001').shelf,
    ).toBeNull();
  });

  it('applied all together: the title reaches every copy, the other people kept, copies moved', async () => {
    const r = await call('POST', `/library/books/update/${ids.check1!}/apply`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'committed', applied: 3 });
    expect((await call('POST', `/library/books/update/${ids.check1!}/apply`)).statusCode).toBe(409);
    const m = (await call('GET', `/library/books/${ids.malgudi!}`)).json();
    expect(m.title).toBe('Malgudi Days (Stories)');
    expect(m.people).toEqual([
      { name: 'R. K. Narayan', role: 'Author' },
      { name: 'E. Editor', role: 'Editor' },
    ]);
    expect(m.copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00001')).toMatchObject(
      {
        shelf: 'S1',
        price: '250.00',
      },
    );
    const sw = (await call('GET', `/library/books/${ids.swami!}`)).json();
    expect(sw.people.map((p: { name: string }) => p.name)).toEqual([
      'R. K. Narayan',
      'A. N. Other',
    ]);
    expect(sw.copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00004').library).toBe(
      'Junior library (JR)',
    );
    const list = (await call('GET', '/library/books/update')).json().data;
    expect(list[0]).toMatchObject({ id: ids.check1, status: 'committed', applied: 3 });
  });

  it('a vendor needs a purchase (the form’s rule); dates; CLEAR empties a field', async () => {
    const csv = [
      'Accession No.,Remarks,Date of accession,Purchase or donation,Vendor,Bill no.,Bill date',
      'B00002,Spine taped,15-01-2026,Purchase,Book House,BL-9,12/01/2026',
      'B00003,,,,Book House,,',
      'B00005,,31-02-2026,,,,',
    ].join('\n');
    const r = (await upload('more.csv', Buffer.from(csv))).json() as Summary;
    expect(r).toMatchObject({ readyRows: 1, rejectedRows: 2 });
    expect(r.problems.map((p) => `${String(p.row)} ${p.column}: ${p.message}`)).toEqual([
      '3 Row: Vendor and bill: for a purchase only',
      '4 Date of accession: a date as DD-MM-YYYY',
    ]);
    expect((await call('POST', `/library/books/update/${r.id}/apply`)).statusCode).toBe(200);
    const after = (await call('GET', `/library/books/${ids.malgudi!}`)).json();
    expect(
      after.copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00002'),
    ).toMatchObject({
      remarks: 'Spine taped',
      accessionedOn: '2026-01-15',
      acquisition: 'Purchase',
      vendor: 'Book House',
      billNo: 'BL-9',
      billDate: '2026-01-12',
    });
    const clear = (
      await upload(
        'clear.csv',
        Buffer.from('Accession No.,Remarks,Bill no.\nB00002,CLEAR,\nB00001,,\n'),
      )
    ).json() as Summary;
    expect(clear).toMatchObject({ readyRows: 1, unchangedRows: 1, rejectedRows: 0 });
    expect(clear.changes[0]!.changes).toEqual([
      expect.objectContaining({ label: 'Remarks', from: 'Spine taped', to: '' }),
    ]);
    await call('POST', `/library/books/update/${clear.id}/apply`);
    const cleared = (await call('GET', `/library/books/${ids.malgudi!}`)).json();
    expect(
      cleared.copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00002'),
    ).toMatchObject({
      remarks: null,
      billNo: 'BL-9',
    });
    expect((await upload('x.csv', Buffer.from('Title,Price\nA,1\n'))).json().detail).toContain(
      'Accession No.',
    );
  });
});
