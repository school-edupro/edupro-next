/**
 * The Books page's lists as the Employees list (docs/design/36-library.md): the fields of the copies and
 * the titles, a page of rows for a view (any field as a column or a filter, the search, a status, the
 * sort in the natural accession order), the school's counts, the view as Excel or PDF, and Customise
 * export on the list's filters.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
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

describe('library register (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let librarian: SeededUser;
  let outsider: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? librarian).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const grid = (level: 'copies' | 'titles', view: Record<string, unknown>, u?: SeededUser) =>
    call('POST', `/library/register/${level}`, { size: 25, page: 1, ...view }, u);
  const accs = (r: { json: () => { rows: Array<Record<string, unknown>> } }) =>
    r.json().rows.map((x) => x.accession_no);
  const s = stamp('LRG');
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      outsider = await seedUser(c, school, `${s}-acc`, 'accountant');
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, employee_type)
         VALUES ($1, $2, 'Meena', 'teaching') RETURNING id::text`,
        [school.id, `${s}-E1`],
      );
      ids.employee = e.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    const book = setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id as string;
    const add = async (title: string, author: string, count: number, price?: number) => {
      const r = await call('POST', '/library/books', {
        title,
        people: [{ name: author }],
        materialTypeId: book,
        publisher: 'Penguin India',
        year: 2001,
        copies: {
          libraryId: setup.libraries[0].id,
          count,
          accessionedOn: '2026-01-10',
          ...(price ? { price } : {}),
        },
      });
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string; accessionNos: string[] };
    };
    const a = await add('Malgudi Days', 'R. K. Narayan', 9, 250);
    const b = await add('Matilda', 'Roald Dahl', 3, 400);
    ids.malgudi = a.id;
    ids.matilda = b.id;
    // a title with no copies
    expect(
      (
        await call('POST', '/library/books', {
          title: 'Wings of Fire',
          people: [{ name: 'A. P. J. Abdul Kalam' }],
          materialTypeId: book,
        })
      ).statusCode,
    ).toBe(201);
    // B00010 (Matilda's first) issued and overdue, B00002 damaged, B00003 withdrawn
    expect(
      (
        await call('POST', '/library/loans/issue', {
          accessionNo: 'B00010',
          borrowerKind: 'employee',
          borrowerId: ids.employee,
        })
      ).statusCode,
    ).toBe(201);
    await withMigrator((c) =>
      c.query(
        `UPDATE library_loans SET issued_on = CURRENT_DATE - 40, due_on = CURRENT_DATE - 10 WHERE school_id = $1`,
        [school.id],
      ),
    );
    const v = (await call('GET', `/library/books/${ids.malgudi}`)).json();
    const copy = (acc: string) =>
      v.copies.find((x: { accessionNo: string }) => x.accessionNo === acc).id as string;
    for (const [acc, status] of [
      ['B00002', 'damaged'],
      ['B00003', 'withdrawn'],
    ] as const)
      expect(
        (
          await call('POST', `/library/copies/${copy(acc)}/status`, {
            status,
            on: '2026-02-01',
            reason: 'Checked on the shelf',
          })
        ).statusCode,
      ).toBe(200);
  });
  afterAll(async () => app.close());

  it('the fields of each list, by section, with the filters’ suggestions', async () => {
    const copies = (await call('GET', '/library/register/copies/fields')).json();
    const keys = copies.fields.map((f: { key: string }) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['accession_no', 'library', 'issued_to', 'copy_price']),
    );
    expect(keys).not.toContain('on_shelf');
    expect(copies.fields.find((f: { key: string }) => f.key === 'copy_status').options).toEqual([
      'On the shelf',
      'Issued',
      'Damaged',
      'Lost',
      'Withdrawn',
      'Sold',
    ]);
    const titles = (await call('GET', '/library/register/titles/fields')).json();
    expect(titles.fields.map((f: { key: string }) => f.key)).toEqual(
      expect.arrayContaining(['title', 'copies', 'on_shelf', 'value']),
    );
    expect(titles.fields.map((f: { key: string }) => f.key)).not.toContain('accession_no');
    expect((await call('GET', '/library/register/shelves/fields')).statusCode).toBe(404);
    expect(
      (await call('GET', '/library/register/copies/fields', undefined, outsider)).statusCode,
    ).toBe(403);
  });

  it('copies: columns, natural accession order, the status, filters on any field, the counts', async () => {
    const all = await grid('copies', {
      columns: [{ key: 'issued_to' }, { key: 'due_on', label: 'Return by' }, { key: 'copy_price' }],
    });
    expect(all.statusCode).toBe(200);
    const page = all.json();
    expect(page.total).toBe(12);
    expect(page.columns).toEqual([
      { key: 'issued_to', header: 'Issued to', type: 'text' },
      { key: 'due_on', header: 'Return by', type: 'date' },
      { key: 'copy_price', header: 'Copy price (₹)', type: 'number' },
    ]);
    expect(accs(all).slice(8, 10)).toEqual(['B00009', 'B00010']);
    expect(page.rows[9]).toMatchObject({
      accession_no: 'B00010',
      title: 'Matilda',
      copy_status: 'Issued',
      __status: 'issued',
      issued_to: 'Meena',
      copy_price: 400,
    });
    expect(page.stats).toEqual({
      total: 12,
      available: 9,
      issued: 1,
      overdue: 1,
      damaged: 1,
      lost: 0,
      withdrawn: 1,
    });
    expect(accs(await grid('copies', { status: 'overdue' }))).toEqual(['B00010']);
    expect((await grid('copies', { status: 'in_stock' })).json().total).toBe(11);
    expect(
      accs(await grid('copies', { sort: [{ key: 'accession_no', dir: 'desc' }] })).slice(0, 2),
    ).toEqual(['B00012', 'B00011']);
    const f = (filters: unknown[], more: Record<string, unknown> = {}) =>
      grid('copies', { filters, ...more }).then((r) => r.json());
    expect(
      (await f([{ key: 'copy_status', op: 'in', values: ['damaged', 'withdrawn'] }])).total,
    ).toBe(2);
    expect((await f([{ key: 'title', op: 'contains', values: ['malgudi'] }])).total).toBe(9);
    expect((await f([{ key: 'copy_price', op: 'gte', values: ['300'] }])).total).toBe(3);
    expect((await f([{ key: 'due_on', op: 'not_empty' }])).total).toBe(1);
    expect(
      (await f([{ key: 'accessioned_on', op: 'between', values: ['01-01-2026', '2026-01-31'] }]))
        .total,
    ).toBe(12);
    expect((await f([{ key: 'shelf', op: 'empty' }])).total).toBe(12);
    expect(
      (await f([], { search: 'b00011' })).rows.map((r: { accession_no: string }) => r.accession_no),
    ).toEqual(['B00011']);
    const bad = await grid('copies', {
      filters: [{ key: 'copy_price', op: 'gte', values: ['ten'] }],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toContain('is not a number');
    expect((await grid('copies', { columns: [{ key: 'on_shelf' }] })).statusCode).toBe(400);
    expect((await grid('copies', { status: 'none' })).statusCode).toBe(400);
  });

  it('titles: the copies counted, the status by copies on the shelf', async () => {
    const r = await grid('titles', {
      columns: [{ key: 'copies' }, { key: 'on_shelf' }, { key: 'value' }],
    });
    expect(r.json().stats).toEqual({ total: 3, available: 2, out: 0, none: 1 });
    expect(r.json().rows.map((x: { title: string }) => x.title)).toEqual([
      'Malgudi Days',
      'Matilda',
      'Wings of Fire',
    ]);
    expect(r.json().rows[0]).toMatchObject({ copies: 8, on_shelf: 7, value: 2000 });
    expect((await grid('titles', { status: 'none' })).json().rows[0]).toMatchObject({
      title: 'Wings of Fire',
      copies: 0,
    });
    expect(
      (
        await grid('titles', { filters: [{ key: 'authors', op: 'starts', values: ['roald'] }] })
      ).json().total,
    ).toBe(1);
  });

  it('the view as Excel and PDF; Customise export on the list’s filters', async () => {
    const x = await call('POST', '/library/register/copies/export', {
      format: 'xlsx',
      status: 'all',
      filters: [{ key: 'title', op: 'eq', values: ['Matilda'] }],
      columns: [{ key: 'issued_to' }, { key: 'accessioned_on' }],
    });
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.json().base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Copies')!;
    expect(ws.getRow(1).values).toEqual([
      undefined,
      'Accession no.',
      'Issued to',
      'Date of accession',
      'Status',
    ]);
    expect(ws.rowCount).toBe(4);
    expect(ws.getRow(2).getCell(1).value).toBe('B00010');
    expect(String(wb.getWorksheet('About this export')!.getRow(5).getCell(2).value)).toContain(
      'Title is Matilda',
    );
    const p = await call('POST', '/library/register/titles/export', { format: 'pdf', columns: [] });
    expect(p.json().filename).toMatch(/^Library-titles-.*\.pdf$/);
    expect((await PDFDocument.load(Buffer.from(p.json().base64, 'base64'))).getPageCount()).toBe(1);
    const many = Array.from(
      { length: 30 },
      (_, i) =>
        [
          'subtitle',
          'authors',
          'others',
          'catalogue_code',
          'material',
          'subject',
          'sub_subject',
          'call_no',
          'for_class',
          'keywords',
          'reference_only',
          'title_notes',
          'publisher',
          'place',
          'year',
          'edition',
          'volume',
          'pages',
          'isbn',
          'language',
          'printed_price',
          'library',
          'shelf',
          'rack',
          'barcode',
          'status_on',
          'status_reason',
          'last_checked',
          'remarks',
          'donor',
        ][i]!,
    ).map((key) => ({ key }));
    expect(
      (await call('POST', '/library/register/copies/export', { format: 'pdf', columns: many }))
        .statusCode,
    ).toBe(400);
    const custom = await call('POST', '/library/books/export', {
      level: 'copy',
      columns: ['copy.accession', 'copy.status'],
      view: { status: 'issued', filters: [] },
    });
    expect(custom.statusCode).toBe(200);
    expect(custom.json().rows).toBe(1);
  });
});
