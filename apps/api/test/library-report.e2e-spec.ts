/**
 * Library, part 3 (0209, docs/design/36-library.md): the book list's filters (author, publisher,
 * language, year, shelf and rack, purchase or donation, vendor, accession numbers and dates, copy status,
 * stock check) and sorting, the register of copies, and the Excel export (one row per copy or per title;
 * every field or those picked in order; layouts the school keeps and each user's last choice; audited).
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

describe('library book list, register and export (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? admin).sub, school.id);
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    json?: unknown,
    u?: SeededUser,
  ) => inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const s = stamp('LRP');
  const ids: Record<string, string> = {};
  const titles = async (q: string) =>
    ((await call('GET', `/library/books?${q}`)).json().data as Array<{ title: string }>).map(
      (x) => x.title,
    );
  const copies = async (q: string) =>
    (
      (await call('GET', `/library/books/copies?${q}`)).json().data as Array<{
        accessionNo: string;
      }>
    ).map((x) => x.accessionNo);
  const workbook = async (json: unknown, u?: SeededUser) => {
    const r = await call('POST', '/library/books/export', json, u);
    expect(r.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(r.json().base64, 'base64') as unknown as ArrayBuffer);
    return { j: r.json(), wb };
  };
  const head = (ws: ExcelJS.Worksheet) => (ws.getRow(1).values as string[]).slice(1);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, employee_type) VALUES ($1, 'E7', 'Kavya', 'teaching') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    await call('GET', '/library/books/setup');
    const m = (master: string, values: Record<string, unknown>) =>
      call('POST', `/masters/${master}/rows`, { values });
    await m('library_shelves', { library_id: 'MAIN', code: 'A3', racks: 'R1, R2' });
    await m('library_vendors', { code: 'BH', name: 'Book House' });
    await m('library_subjects', { name: 'Fiction' });
    await m('library_subjects', { name: 'Science' });
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.main = setup.libraries[0].id;
    ids.book = setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id;
    ids.shelf = setup.shelves[0].id;
    ids.vendor = setup.vendors[0].id;
    for (const x of setup.subjects as Array<{ id: string; name: string }>) ids[x.name] = x.id;
    for (const x of setup.languages as Array<{ id: string; name: string }>) ids[x.name] = x.id;
    const add = async (body: Record<string, unknown>) => {
      const r = await call('POST', '/library/books', { materialTypeId: ids.book, ...body });
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string; accessionNos: string[] };
    };
    const malgudi = await add({
      title: 'Malgudi Days',
      people: [{ name: 'R. K. Narayan' }],
      subjectId: ids.Fiction,
      publisher: 'Penguin India',
      year: 2006,
      languageId: ids.English,
      price: 250,
      copies: {
        libraryId: ids.main,
        count: 3,
        shelfId: ids.shelf,
        rack: 'R1',
        acquisition: 'Purchase',
        vendorId: ids.vendor,
        billNo: 'INV-9',
        accessionedOn: '2024-06-01',
      },
    });
    expect(malgudi.accessionNos).toEqual(['B00001', 'B00002', 'B00003']);
    const hawking = await add({
      title: 'A Brief History of Time',
      people: [{ name: 'Stephen Hawking' }],
      subjectId: ids.Science,
      publisher: 'Bantam',
      year: 1988,
      languageId: ids.English,
      copies: {
        libraryId: ids.main,
        count: 2,
        acquisition: 'Donation',
        donor: 'Old students',
        price: 400,
        accessionedOn: '2025-01-10',
      },
    });
    expect(hawking.accessionNos).toEqual(['B00004', 'B00005']);
    const godaan = await add({
      title: 'Godaan',
      people: [{ name: 'Premchand' }],
      subjectId: ids.Fiction,
      year: 1936,
      languageId: ids.Hindi,
      copies: { libraryId: ids.main, accessionNos: ['B00100'], acquisition: 'Purchase' },
    });
    ids.malgudi = malgudi.id;
    ids.godaan = godaan.id;
    // one copy lost, one out on loan
    const v = (await call('GET', `/library/books/${malgudi.id}`)).json();
    await call('POST', `/library/copies/${v.copies[2].id as string}/status`, {
      status: 'lost',
      on: '2026-01-05',
      reason: 'Missing at the stock check',
    });
    expect(
      (
        await call('POST', '/library/loans/issue', {
          accessionNo: 'B00001',
          borrowerKind: 'employee',
          borrowerId: ids.employee,
        })
      ).statusCode,
    ).toBe(201);
  });
  afterAll(async () => app.close());

  it('the list filters by the title’s links and the copies’ place, source, status and dates, and sorts', async () => {
    expect(await titles('author=hawk')).toEqual(['A Brief History of Time']);
    expect(await titles('publisher=peng')).toEqual(['Malgudi Days']);
    expect(await titles(`languageId=${ids.Hindi!}`)).toEqual(['Godaan']);
    expect(await titles(`subjectId=${ids.Fiction!}&sort=title&dir=desc`)).toEqual([
      'Malgudi Days',
      'Godaan',
    ]);
    expect(await titles('yearFrom=1980&yearTo=2000')).toEqual(['A Brief History of Time']);
    expect(await titles('acquisition=Donation')).toEqual(['A Brief History of Time']);
    expect(await titles(`vendorId=${ids.vendor!}`)).toEqual(['Malgudi Days']);
    expect(await titles(`shelfId=${ids.shelf!}&rack=R1`)).toEqual(['Malgudi Days']);
    expect(await titles('status=lost')).toEqual(['Malgudi Days']);
    expect(await titles('accessionedFrom=2025-01-01&accessionedTo=2025-12-31')).toEqual([
      'A Brief History of Time',
    ]);
    expect(await titles('stock=checked')).toEqual([]);
    expect((await titles('stock=never')).length).toBe(3);
    expect(await titles('sort=author&dir=asc')).toEqual([
      'Godaan',
      'Malgudi Days',
      'A Brief History of Time',
    ]);
    // the counts are of the copies that match
    const lib = (
      await call('GET', `/library/books?libraryId=${ids.main!}&status=available`)
    ).json();
    expect(lib.data.find((x: { title: string }) => x.title === 'Malgudi Days')).toMatchObject({
      copies: 1,
      available: 1,
      issued: 0,
    });
    expect(
      (await call('GET', '/library/books?accessionFrom=B00001&accessionTo=T00003')).statusCode,
    ).toBe(400);
  });

  it('the register of copies: accession numbers in their order, a range, who has a copy', async () => {
    expect(await copies('sort=accession&dir=asc')).toEqual([
      'B00001',
      'B00002',
      'B00003',
      'B00004',
      'B00005',
      'B00100',
    ]);
    expect(await copies('sort=accession&dir=desc')).toEqual([
      'B00100',
      'B00005',
      'B00004',
      'B00003',
      'B00002',
      'B00001',
    ]);
    expect(await copies('accessionFrom=b00002&accessionTo=B00004&sort=accession')).toEqual([
      'B00002',
      'B00003',
      'B00004',
    ]);
    const out = (await call('GET', '/library/books/copies?status=issued')).json();
    expect(out.data).toEqual([
      expect.objectContaining({
        accessionNo: 'B00001',
        title: 'Malgudi Days',
        borrower: expect.stringContaining('Kavya'),
      }),
    ]);
    expect(out.page.total).toBe(1);
  });

  it('Excel: every field per copy or per title, as filtered and sorted, with an About sheet', async () => {
    const { j, wb } = await workbook({ sort: 'accession' });
    expect(j.filename).toMatch(/^Library-accession-register-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Copies', 'About this export']);
    const ws = wb.getWorksheet('Copies')!;
    const cols = head(ws);
    for (const c of [
      'Accession no.',
      'Title',
      'Authors',
      'Library',
      'Status',
      'Vendor',
      'Issued to',
      'Date of accession',
    ])
      expect(cols).toContain(c);
    expect(ws.rowCount).toBe(7);
    const first = ws.getRow(2);
    expect(first.getCell(cols.indexOf('Accession no.') + 1).value).toBe('B00001');
    expect(first.getCell(cols.indexOf('Status') + 1).value).toBe('Issued');
    expect(first.getCell(cols.indexOf('Date of accession') + 1).value).toBeInstanceOf(Date);
    expect(String(first.getCell(cols.indexOf('Issued to') + 1).value)).toContain('Kavya');
    const about = wb.getWorksheet('About this export')!;
    expect(about.getCell('B4').value).toBe('6 (one per copy)');
    // per title, its copies counted; a filter
    const t = await workbook({ level: 'title', subjectId: ids.Fiction });
    const tw = t.wb.getWorksheet('Titles')!;
    const tc = head(tw);
    expect(tc).toEqual(
      expect.arrayContaining([
        'Title',
        'Copies',
        'On the shelf',
        'Issued',
        'Lost',
        'Value of the copies (₹)',
      ]),
    );
    expect(tc).not.toContain('Accession no.');
    expect(tw.rowCount).toBe(3);
    const malgudi = [2, 3]
      .map((i) => tw.getRow(i))
      .find((r) => r.getCell(tc.indexOf('Title') + 1).value === 'Malgudi Days')!;
    expect(malgudi.getCell(tc.indexOf('Copies') + 1).value).toBe(3);
    expect(malgudi.getCell(tc.indexOf('Lost') + 1).value).toBe(1);
    expect(malgudi.getCell(tc.indexOf('Value of the copies (₹)') + 1).value).toBe(500);
    expect(t.wb.getWorksheet('About this export')!.getCell('B5').value).toBe('Subject: Fiction');
  });

  it('the fields picked, in order, for the level; my last choice kept; layouts are the school’s', async () => {
    const setup = (await call('GET', '/library/books/export/setup', undefined, coordinator)).json();
    expect(setup.levels.map((x: { value: string }) => x.value)).toEqual(['copy', 'title']);
    expect(setup.groups.find((g: { id: string }) => g.id === 'counts').levels).toEqual(['title']);
    expect(setup.last).toBeNull();
    const columns = ['copy.accession', 'title.title', 'count.copies', 'loan.due', 'nothing.here'];
    const { wb } = await workbook(
      { columns, sort: 'accession', layout: 'Shelf list' },
      coordinator,
    );
    // a count is not a column of a copy row; an unknown key is left out
    expect(head(wb.getWorksheet('Copies')!)).toEqual(['Accession no.', 'Title', 'Due on']);
    expect(wb.getWorksheet('About this export')!.getCell('B6').value).toBe(
      '3 picked (layout: Shelf list)',
    );
    const again = (await call('GET', '/library/books/export/setup', undefined, coordinator)).json();
    expect(again.last).toEqual({
      columns: ['copy.accession', 'title.title', 'loan.due'],
      sheets: [],
      level: 'copy',
    });
    expect((await call('GET', '/library/books/export/setup')).json().last).toBeNull();
    expect(
      (await call('POST', '/library/books/export', { columns: ['nothing.here'] })).statusCode,
    ).toBe(400);
    // layouts: saved by anyone who may see the books; changed or removed by their maker or the manager
    const mine = await call(
      'POST',
      '/library/books/export/layouts',
      { name: 'Stock list', columns: ['title.title', 'count.copies'], level: 'title' },
      coordinator,
    );
    expect(mine.json()).toMatchObject({ updated: false });
    const list = (await call('GET', '/library/books/export/setup')).json().layouts;
    expect(list).toEqual([
      expect.objectContaining({
        name: 'Stock list',
        columns: ['title.title', 'count.copies'],
        level: 'title',
        canEdit: true,
      }),
    ]);
    const theirs = await call('POST', '/library/books/export/layouts', {
      name: 'Office list',
      columns: ['title.title'],
    });
    expect(
      (
        await call(
          'POST',
          '/library/books/export/layouts',
          { name: 'office LIST', columns: ['title.code'] },
          coordinator,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          'DELETE',
          `/library/books/export/layouts/${theirs.json().id as string}`,
          undefined,
          coordinator,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/library/books/export/layouts/${mine.json().id as string}`))
        .statusCode,
    ).toBe(200);
    const audit = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE school_id = $1 AND action = 'library.export'`,
        [school.id],
      ),
    );
    expect(audit.rows[0]!.n).toBe(3);
  });
});
