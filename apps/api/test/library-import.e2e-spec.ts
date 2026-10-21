/**
 * Library, part 4 (0210, docs/design/36-library.md): books from Excel or CSV. The legacy layout as it is
 * (BookCode, BookName, Author, ... one row per copy): rows of one title grouped, a copy of a title already
 * there, an accession number already there updating only the cells given (or no change), the legacy
 * Booktype, donation and borrowable columns, prices like "Rs.199", bad ISBNs and dates left out with a
 * warning, refused rows (the same accession number twice, an unknown library, no title); the masters it
 * adds (authors, publishers, subjects and their sub-subjects, languages, shelves and racks; a vendor by
 * its name); the import in batches; the series moved past the numbers that came in; our template; a
 * discarded upload; the rows not imported as a file.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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

const LEGACY = [
  'S.No',
  'Library',
  'Class',
  'ClassNo',
  'BookCode (Accession No)',
  'Booktype',
  'Category',
  'Subject',
  'Subject Subcategory',
  'BookName',
  'SubTitle',
  'Author',
  'Author 2',
  'Editors',
  'Publisher',
  'Publisher Place',
  'Publication Year',
  'Call No',
  'Keyword',
  'Vendor/Source',
  'Source Name',
  'Source Code',
  'Procurement Type',
  'DonatedBook (Yes/No)',
  'IsBorrowable (Yes/No)',
  'Book No',
  'Location',
  'ShelfRack',
  'ShelfRow',
  'Language',
  'ISBNNo',
  'Date of Accession (YYYY-MM-DD)',
  'BillDate (YYYY-MM-DD)',
  'BillNo',
  'PurchaseOrderNo',
  'EditionNo',
  'Volume',
  'Pages',
  'Price',
  'Copy/Set',
  'Barcode',
  'Remarks',
];

describe('library import from Excel and the legacy layout (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? admin).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const upload = (name: string, body: Buffer, contentType: string, u?: SeededUser) =>
    inject({
      method: 'POST',
      url: `/library/imports?fileName=${encodeURIComponent(name)}`,
      headers: h(u),
      raw: { body, contentType },
    });
  const s = stamp('LIM');
  const ids: Record<string, string> = {};
  /** A legacy row: the columns named, the rest empty. */
  const row = (cells: Record<string, string>) =>
    LEGACY.map((c) => {
      const v = cells[c] ?? '';
      return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',');
  const book = { Library: 'Main library', Booktype: 'BOOK' };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.main = setup.libraries[0].id;
    ids.book = setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id;
    await call('POST', '/masters/library_vendors/rows', {
      values: { code: 'BH', name: 'Book House' },
    });
    // a title already there, with two copies
    const malgudi = await call('POST', '/library/books', {
      title: 'Malgudi Days',
      people: [{ name: 'R. K. Narayan' }],
      materialTypeId: ids.book,
      publisher: 'Penguin',
      copies: { libraryId: ids.main, count: 2 },
    });
    expect(malgudi.json().accessionNos).toEqual(['B00001', 'B00002']);
    ids.malgudi = malgudi.json().id;
  });
  afterAll(async () => app.close());

  it('a legacy file is checked: titles grouped, copies matched, updates and no change found, rows refused, warnings', async () => {
    const csv = [
      LEGACY.join(','),
      row({
        ...book,
        'S.No': '1',
        'BookCode (Accession No)': 'b0101',
        BookName: 'Swami and Friends',
        Author: 'R. K. Narayan',
        Subject: 'Fiction',
        'Subject Subcategory': 'Novels',
        Publisher: 'Indian Thought',
        'Publication Year': '1935',
        'Vendor/Source': 'book house',
        'Procurement Type': 'Purchase',
        BillNo: 'INV-1',
        'Date of Accession (YYYY-MM-DD)': '2024-06-01',
        ShelfRack: 'a3',
        ShelfRow: 'R1',
        Price: 'Rs.199',
        ISBNNo: '12345',
        Location: 'Cell 4',
      }),
      row({
        ...book,
        'S.No': '2',
        'BookCode (Accession No)': 'B0102',
        BookName: 'Swami and Friends',
        Author: 'R. K. Narayan',
        Price: '199',
        ShelfRack: 'A3',
        ShelfRow: 'R2',
      }),
      row({
        Library: 'MAIN',
        Booktype: 'Text',
        'BookCode (Accession No)': 'T0001',
        BookName: 'Godaan',
        Author: 'Premchand',
        Language: 'Hindi',
        'DonatedBook (Yes/No)': 'Yes',
        'Source Name': 'Old students',
        'IsBorrowable (Yes/No)': 'No',
        'Date of Accession (YYYY-MM-DD)': '31-02-2024',
        'Publication Year': 'abc',
      }),
      row({
        ...book,
        'BookCode (Accession No)': 'B00001',
        BookName: 'Malgudi Days',
        Publisher: 'Penguin India',
        ShelfRack: 'A4',
      }),
      row({ ...book, 'BookCode (Accession No)': 'B00002', BookName: 'Malgudi Days' }),
      row({ ...book, 'BookCode (Accession No)': 'B0101', BookName: 'Again' }),
      row({ Library: 'Junior library', 'BookCode (Accession No)': 'J1', BookName: 'Nowhere' }),
      row({ ...book, 'BookCode (Accession No)': 'B0103' }),
    ].join('\n');
    expect((await upload('legacy.csv', Buffer.from(csv), 'text/csv', coordinator)).statusCode).toBe(
      403,
    );
    const r = await upload('legacy.csv', Buffer.from(csv), 'text/csv');
    expect(r.statusCode).toBe(201);
    ids.legacy = r.json().id;
    const v = (await call('GET', `/library/imports/${ids.legacy}`)).json();
    expect(v).toMatchObject({ layout: 'legacy', status: 'checked', total: 8 });
    expect(v.summary).toMatchObject({
      rows: 8,
      newTitles: 2,
      newCopies: 3,
      updates: 1,
      unchanged: 1,
      errors: 3,
      masters: { authors: 1, publishers: 2, subjects: 1, languages: 0, vendors: 0, shelves: 2 },
    });
    const byLine = Object.fromEntries(
      (
        v.rows as Array<{
          line: number;
          kind: string;
          errors: string[];
          warnings: string[];
          changes: string[];
        }>
      ).map((x) => [x.line, x]),
    );
    expect(byLine[2]).toMatchObject({
      kind: 'new_title',
      warnings: ['ISBN “12345” is not a valid ISBN: left out'],
    });
    expect(byLine[3]).toMatchObject({ kind: 'new_copy' });
    expect(byLine[4]!.kind).toBe('new_title');
    expect(byLine[4]!.warnings).toEqual(
      expect.arrayContaining(['Year “abc” left out', 'Date of accession “31-02-2024” left out']),
    );
    expect(byLine[5]).toMatchObject({ kind: 'update', changes: ['Publisher', 'Shelf'] });
    expect(byLine[6]).toMatchObject({ kind: 'unchanged' });
    expect(byLine[7]!.errors).toEqual(['Accession number also on row 2']);
    expect(byLine[8]!.errors).toEqual(['Library “Junior library” is not in Library setup']);
    expect(byLine[9]!.errors).toEqual(['No title']);
    const errors = (await call('GET', `/library/imports/${ids.legacy}?kind=error`)).json();
    expect(errors.page.total).toBe(3);
  });

  it('the import runs in batches; the masters fill; the series move past the numbers that came in', async () => {
    const run = await call('POST', `/library/imports/${ids.legacy!}/run`);
    expect(run.json()).toMatchObject({ status: 'done', pending: 0, done: 4, failed: 0 });
    expect(run.json().series).toEqual(
      expect.arrayContaining([
        { prefix: 'B', next: 'B00103' },
        { prefix: 'T', next: 'T00002' },
      ]),
    );
    expect((await call('POST', `/library/imports/${ids.legacy!}/run`)).statusCode).toBe(409);
    const swami = (await call('GET', '/library/books?q=swami')).json().data;
    expect(swami).toEqual([
      expect.objectContaining({ title: 'Swami and Friends', copies: 2, subject: 'Fiction' }),
    ]);
    const v = (await call('GET', `/library/books/${swami[0].id as string}`)).json();
    expect(v).toMatchObject({
      publisher: 'Indian Thought',
      year: 1935,
      isbn: null,
      subSubject: 'Novels',
    });
    expect(v.people).toEqual([{ name: 'R. K. Narayan', role: 'Author' }]);
    expect(v.copies.map((x: { accessionNo: string }) => x.accessionNo)).toEqual(['B0101', 'B0102']);
    expect(v.copies[0]).toMatchObject({
      shelf: 'A3',
      rack: 'R1',
      vendor: 'Book House',
      billNo: 'INV-1',
      price: '199.00',
      acquisition: 'Purchase',
      accessionedOn: '2024-06-01',
      remarks: 'Location: Cell 4',
    });
    const godaan = (await call('GET', '/library/books?q=godaan')).json().data[0];
    const g = (await call('GET', `/library/books/${godaan.id as string}`)).json();
    expect(g).toMatchObject({
      material: 'Textbook',
      language: 'Hindi',
      isReference: true,
      year: null,
    });
    expect(g.copies[0]).toMatchObject({
      accessionNo: 'T0001',
      acquisition: 'Donation',
      donor: 'Old students',
    });
    const m = (await call('GET', `/library/books/${ids.malgudi!}`)).json();
    expect(m.publisher).toBe('Penguin India');
    expect(m.copies.find((x: { accessionNo: string }) => x.accessionNo === 'B00001')).toMatchObject(
      { shelf: 'A4' },
    );
    expect(m.events[0]).toMatchObject({
      what: 'edited',
      reason: 'Updated from legacy.csv: Publisher, Shelf',
    });
    // the shelf has both racks; one vendor still; the subject has its sub-subject
    const shelves = (await call('GET', '/masters/library_shelves/rows')).json().data;
    expect(
      String(shelves.find((x: { code: string }) => x.code === 'A3').racks).replace(/\s/g, ''),
    ).toBe('R1,R2');
    expect((await call('GET', '/masters/library_vendors/rows')).json().data).toHaveLength(1);
    const setup = (await call('GET', '/library/books/setup')).json();
    expect(setup.subjects.find((x: { name: string }) => x.name === 'Fiction').subSubjects).toEqual([
      'Novels',
    ]);
    // the next copy added continues the series
    const next = await call('POST', `/library/books/${ids.malgudi!}/copies`, {
      libraryId: ids.main,
      count: 1,
    });
    expect(next.json().accessionNos).toEqual(['B00103']);
    // the rows not imported, as a file to correct
    const p = (await call('GET', `/library/imports/${ids.legacy!}/problems`)).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(p.base64, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.rowCount).toBe(4);
    expect(wb.worksheets[0]!.getRow(2).values).toEqual([
      undefined,
      7,
      'B0101',
      'Again',
      'Accession number also on row 2',
    ]);
  });

  it('our template round trip; a discarded upload is not imported', async () => {
    const t = (await call('GET', '/library/imports/template')).json();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(t.base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Books')!;
    const head = (ws.getRow(1).values as string[]).slice(1);
    expect(head.slice(0, 3)).toEqual(['Accession no. *', 'Library', 'Title *']);
    const col = (name: string) => head.findIndex((x) => x.replace(' *', '') === name) + 1;
    const r = ws.getRow(2);
    r.getCell(col('Accession no.')).value = 'R-77';
    r.getCell(col('Title')).value = 'Oxford Atlas';
    r.getCell(col('Material type')).value = 'Reference';
    r.getCell(col('Authors')).value = 'Oxford; Editors of OUP';
    r.getCell(col('Date of accession')).value = new Date('2025-03-04T00:00:00Z');
    r.getCell(col('Status')).value = 'Damaged';
    const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const up = await upload('ours.xlsx', bytes, xlsx);
    expect(up.statusCode).toBe(201);
    const v = (await call('GET', `/library/imports/${up.json().id as string}`)).json();
    expect(v).toMatchObject({ layout: 'edupro', summary: { newTitles: 1, errors: 0 } });
    expect((await call('POST', `/library/imports/${up.json().id as string}/run`)).json().done).toBe(
      1,
    );
    const atlas = (await call('GET', '/library/books?q=atlas')).json().data[0];
    const a = (await call('GET', `/library/books/${atlas.id as string}`)).json();
    expect(a).toMatchObject({ material: 'Reference' });
    expect(a.people.map((p: { name: string }) => p.name)).toEqual(['Oxford', 'Editors of OUP']);
    expect(a.copies[0]).toMatchObject({
      accessionNo: 'R-77',
      status: 'damaged',
      statusReason: 'Imported',
      accessionedOn: '2025-03-04',
    });
    // a file checked and then discarded
    const again = await upload('again.xlsx', bytes, xlsx);
    const id = again.json().id as string;
    expect((await call('GET', `/library/imports/${id}`)).json().summary).toMatchObject({
      updates: 0,
      unchanged: 1,
    });
    expect((await call('POST', `/library/imports/${id}/discard`)).json()).toEqual({
      status: 'discarded',
    });
    expect((await call('POST', `/library/imports/${id}/run`)).statusCode).toBe(409);
    expect(
      (await call('GET', '/library/imports')).json().data.map((x: { status: string }) => x.status),
    ).toEqual(['discarded', 'done', 'done']);
    // a file without the two needed columns is refused
    const bad = await upload('bad.csv', Buffer.from('Name,Price\nX,1'), 'text/csv');
    expect(bad.statusCode).toBe(400);
  });

  it('a big file goes in batches; a title made in one batch takes the copies of the next', async () => {
    const lines = ['Accession no.,Title,Authors'];
    for (let i = 1; i <= 650; i += 1)
      lines.push(
        `BIG${String(i).padStart(4, '0')},Big Book ${String(Math.ceil(i / 325))},Author ${String(Math.ceil(i / 325))}`,
      );
    const up = await upload('big.csv', Buffer.from(lines.join('\n')), 'text/csv');
    const id = up.json().id as string;
    expect((await call('GET', `/library/imports/${id}`)).json().summary).toMatchObject({
      newTitles: 2,
      newCopies: 650,
    });
    const runs: Array<{ status: string; pending: number; done: number }> = [];
    for (let i = 0; i < 5; i += 1) {
      const r = (await call('POST', `/library/imports/${id}/run`)).json();
      runs.push(r);
      if (r.status === 'done') break;
    }
    expect(runs.map((r) => [r.status, r.pending, r.done])).toEqual([
      ['importing', 350, 300],
      ['importing', 50, 600],
      ['done', 0, 650],
    ]);
    const big = (await call('GET', '/library/books?q=big%20book&sort=title')).json().data;
    expect(big.map((b: { title: string; copies: number }) => [b.title, b.copies])).toEqual([
      ['Big Book 1', 325],
      ['Big Book 2', 325],
    ]);
  }, 120_000);
});
