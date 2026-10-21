/**
 * Library, part 2 (0207, docs/design/36-library.md): the book master. A title with its people in order
 * and its links (new author and publisher names added to the masters); copies numbered from the series
 * of their library and material type under a lock (a number already typed is skipped), or typed; where a
 * copy is and how it came, checked; a copy moved; copy status with the reason (lost while on loan closes
 * the loan, lost and paid with the amount, found again, withdrawn); a reference type not issued; the
 * list's search and filters; a duplicate title found.
 */
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

describe('library book master (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? admin).sub, school.id);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const master = (m: string, values: Record<string, unknown>) =>
    call('POST', `/masters/${m}/rows`, { values });
  const s = stamp('LBK');
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const ids: Record<string, string> = {};
  const ISBN = '978-0-306-40615-7';

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, employee_type) VALUES ($1, 'E1', 'Mira', 'non_teaching') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.main = setup.libraries.find((l: { code: string }) => l.code === 'MAIN').id;
    for (const m of setup.materialTypes as Array<{ id: string; code: string }>) ids[m.code] = m.id;
    expect(setup.series).toEqual(
      expect.arrayContaining([{ libraryId: ids.main, materialTypeId: ids.BOOK, next: 'B00001' }]),
    );
    expect(
      (
        await master('library_shelves', {
          library_id: 'MAIN',
          code: 'A3',
          name: 'Fiction',
          racks: 'R1, R2',
        })
      ).statusCode,
    ).toBe(201);
    expect((await master('library_vendors', { code: 'BH', name: 'Book House' })).statusCode).toBe(
      201,
    );
    expect(
      (await master('library_subjects', { name: 'Fiction', sub_subjects: 'Short stories, Novels' }))
        .statusCode,
    ).toBe(201);
    const again = (await call('GET', '/library/books/setup')).json();
    ids.shelf = again.shelves[0].id;
    ids.vendor = again.vendors[0].id;
    ids.fiction = again.subjects.find((x: { name: string }) => x.name === 'Fiction').id;
    ids.english = again.languages.find((x: { name: string }) => x.name === 'English').id;
  });
  afterAll(async () => app.close());

  const book = (over: Record<string, unknown> = {}) => ({
    title: 'Malgudi Days',
    people: [{ name: 'R. K. Narayan' }, { name: 'Jhumpa Lahiri', role: 'Editor' }],
    materialTypeId: ids.BOOK,
    subjectId: ids.fiction,
    subSubject: 'Short stories',
    publisher: 'Penguin India',
    year: 2006,
    isbn: ISBN,
    languageId: ids.english,
    price: 250,
    ...over,
  });
  const purchase = {
    libraryId: '',
    count: 3,
    shelfId: '',
    rack: 'R2',
    acquisition: 'Purchase',
    vendorId: '',
    billNo: 'INV-1',
    billDate: today,
  };

  it('a title with its people and links, and three copies numbered from the series', async () => {
    const r = await call('POST', '/library/books', {
      ...book(),
      copies: { ...purchase, libraryId: ids.main, shelfId: ids.shelf, vendorId: ids.vendor },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().accessionNos).toEqual(['B00001', 'B00002', 'B00003']);
    ids.title = r.json().id;
    const v = (await call('GET', `/library/books/${ids.title}`)).json();
    expect(v).toMatchObject({
      title: 'Malgudi Days',
      material: 'Book',
      subject: 'Fiction',
      subSubject: 'Short stories',
      publisher: 'Penguin India',
      language: 'English',
      isbn: '9780306406157',
      people: [
        { name: 'R. K. Narayan', role: 'Author' },
        { name: 'Jhumpa Lahiri', role: 'Editor' },
      ],
    });
    expect(v.copies).toHaveLength(3);
    expect(v.copies[0]).toMatchObject({
      accessionNo: 'B00001',
      library: 'Main library (MAIN)',
      shelf: 'A3 · Fiction',
      rack: 'R2',
      acquisition: 'Purchase',
      vendor: 'Book House',
      billNo: 'INV-1',
      price: '250.00',
      status: 'available',
    });
    expect(v.events.filter((e: { what: string }) => e.what === 'accessioned')).toHaveLength(3);
    // the new names are in the masters; the series moved on
    const authors = (await call('GET', '/masters/library_authors/rows')).json().data;
    expect(authors.map((a: { name: string }) => a.name).sort()).toEqual([
      'Jhumpa Lahiri',
      'R. K. Narayan',
    ]);
    const setup = (await call('GET', '/library/books/setup')).json();
    expect(
      setup.series.find((x: { materialTypeId: string }) => x.materialTypeId === ids.BOOK).next,
    ).toBe('B00004');
  });

  it('what a title and a copy hold is checked; the same book is found before it is entered twice', async () => {
    const copies = {
      ...purchase,
      libraryId: ids.main,
      shelfId: ids.shelf,
      vendorId: ids.vendor,
      count: 1,
    };
    const bad = async (over: Record<string, unknown>, copyOver: Record<string, unknown> = {}) =>
      (
        await call('POST', '/library/books', {
          ...book({ title: 'Another' }),
          ...over,
          copies: { ...copies, ...copyOver },
        })
      ).statusCode;
    expect(await bad({ isbn: '978-0-306-40615-8' })).toBe(400);
    expect(await bad({ subSubject: 'Poetry' })).toBe(400);
    expect(await bad({}, { rack: 'R9' })).toBe(400);
    expect(await bad({}, { donor: 'Old students' })).toBe(400);
    expect(await bad({}, { barcode: 'X1', count: 2 })).toBe(400);
    expect(await bad({}, { accessionNos: ['b 00002'] })).toBe(409);
    expect(await bad({ materialTypeId: '999999' })).toBe(400);
    expect((await call('POST', '/library/books', book(), coordinator)).statusCode).toBe(403);
    // the same ISBN, or the title word for word: already in the catalogue
    const byIsbn = (
      await call('GET', `/library/books/match?isbn=${encodeURIComponent('9780306406157')}`)
    ).json();
    expect(byIsbn.data).toEqual([
      expect.objectContaining({ id: ids.title, copies: 3, by: 'isbn' }),
    ]);
    const byTitle = (await call('GET', '/library/books/match?title=malgudi%20days')).json();
    expect(byTitle.data[0]).toMatchObject({ id: ids.title, by: 'title' });
    expect(
      (await call('GET', `/library/books/match?title=malgudi%20days&except=${ids.title}`)).json()
        .data,
    ).toEqual([]);
    const names = (await call('GET', '/library/books/suggest?kind=author&q=nar')).json();
    expect(names.names).toEqual(['R. K. Narayan']);
  });

  it('more copies typed or from the series (a typed number skipped); a copy moved; the title changed', async () => {
    const donated = await call('POST', `/library/books/${ids.title}/copies`, {
      libraryId: ids.main,
      accessionNos: ['b00005'],
      acquisition: 'Donation',
      donor: 'Old students',
    });
    expect(donated.json()).toEqual({ accessionNos: ['B00005'] });
    const more = await call('POST', `/library/books/${ids.title}/copies`, {
      libraryId: ids.main,
      count: 2,
    });
    expect(more.json()).toEqual({ accessionNos: ['B00004', 'B00006'] });
    const v = (await call('GET', `/library/books/${ids.title}`)).json();
    const b1 = v.copies.find((x: { accessionNo: string }) => x.accessionNo === 'B00001');
    ids.b1 = b1.id;
    ids.b2 = v.copies.find((x: { accessionNo: string }) => x.accessionNo === 'B00002').id;
    expect(v.copies.find((x: { accessionNo: string }) => x.accessionNo === 'B00005')).toMatchObject(
      {
        acquisition: 'Donation',
        donor: 'Old students',
        price: '250.00',
      },
    );
    const moved = await call('PUT', `/library/copies/${ids.b1}`, {
      libraryId: ids.main,
      shelfId: ids.shelf,
      rack: 'R1',
      acquisition: 'Purchase',
      vendorId: ids.vendor,
      billNo: 'INV-1',
      barcode: '8901234',
    });
    expect(moved.statusCode).toBe(200);
    expect(
      (await call('PUT', `/library/copies/${ids.b2}`, { libraryId: ids.main, barcode: '8901234' }))
        .statusCode,
    ).toBe(409);
    const after = (await call('GET', `/library/books/${ids.title}`)).json();
    expect(after.copies.find((x: { id: string }) => x.id === ids.b1)).toMatchObject({
      rack: 'R1',
      barcode: '8901234',
    });
    expect(after.events[0]).toMatchObject({ what: 'moved', accessionNo: 'B00001' });
    // the title changed: the people again, in a new order; other screens show the new name
    expect(
      (
        await call(
          'PUT',
          `/library/books/${ids.title}`,
          book({
            people: [{ name: 'r. k. narayan' }, { name: 'R. K. Laxman', role: 'Illustrator' }],
          }),
        )
      ).statusCode,
    ).toBe(200);
    const cat = (await call('GET', '/library/catalogue?q=Malgudi')).json();
    expect(cat.data[0]).toMatchObject({
      author: 'R. K. Narayan',
      publisher: 'Penguin India',
      category: 'Fiction',
    });
  });

  it('copy status: withdrawn needs it back; lost on loan goes to Lost and damaged books; lost and paid with the amount; found again', async () => {
    const issue = await call('POST', '/library/loans/issue', {
      accessionNo: 'B00001',
      borrowerKind: 'employee',
      borrowerId: ids.employee,
    });
    expect(issue.statusCode).toBe(201);
    const status = (copy: string, json: Record<string, unknown>) =>
      call('POST', `/library/copies/${copy}/status`, {
        on: today,
        reason: 'Checked by the librarian',
        ...json,
      });
    expect((await status(ids.b1!, { status: 'withdrawn' })).json().type).toBe(
      'library.status_not_allowed',
    );
    expect((await status(ids.b1!, { status: 'lost_paid' })).statusCode).toBe(400);
    expect((await status(ids.b1!, { status: 'lost', amount: 10 })).statusCode).toBe(400);
    // a book on loan is charged to its borrower at Lost and damaged books (part 3 of the register work)
    const onLoan = await status(ids.b1!, {
      status: 'lost_paid',
      amount: 300,
      reason: 'Lost by the borrower; paid the price',
    });
    expect(onLoan.json().detail).toContain('Lost and damaged books');
    expect(
      (await call('POST', '/library/loans/return', { accessionNo: 'B00001' })).statusCode,
    ).toBe(201);
    const lost = await status(ids.b1!, {
      status: 'lost_paid',
      amount: 300,
      reason: 'Lost from the shelf; the finder paid the price',
    });
    expect(lost.json()).toEqual({ id: ids.b1, status: 'lost' });
    const loans = (await call('GET', '/library/loans?status=open')).json();
    expect(loans.data.some((l: { accessionNo: string }) => l.accessionNo === 'B00001')).toBe(false);
    expect((await status(ids.b1!, { status: 'available' })).statusCode).toBe(409);
    expect(
      (await status(ids.b1!, { status: 'found', reason: 'Found in the staff room' })).json().status,
    ).toBe('available');
    expect(
      (await status(ids.b2!, { status: 'withdrawn', reason: 'Torn pages' })).json().status,
    ).toBe('withdrawn');
    const v = (await call('GET', `/library/books/${ids.title}`)).json();
    expect(v.copies.find((x: { id: string }) => x.id === ids.b2)).toMatchObject({
      status: 'withdrawn',
      statusReason: 'Torn pages',
      statusOn: today,
    });
    expect(v.events.find((e: { what: string }) => e.what === 'lost_paid')).toMatchObject({
      fromStatus: 'available',
      toStatus: 'lost',
      amount: '300.00',
    });
    expect(v.loans[0]).toMatchObject({ accessionNo: 'B00001', returnedOn: today });
  });

  it('a reference type is not issued; the list searches and filters, counting copies on the shelf and out', async () => {
    const ref = await call('POST', '/library/books', {
      ...book({
        title: 'Oxford Atlas',
        people: [],
        isbn: undefined,
        subSubject: undefined,
        materialTypeId: ids.REF,
      }),
      copies: { libraryId: ids.main, count: 1 },
    });
    expect(ref.json().accessionNos).toEqual(['R00001']);
    const no = await call('POST', '/library/loans/issue', {
      accessionNo: 'R00001',
      borrowerKind: 'employee',
      borrowerId: ids.employee,
    });
    expect(no.json().type).toBe('library.reference_only');
    await call('POST', '/library/loans/issue', {
      accessionNo: 'B00003',
      borrowerKind: 'employee',
      borrowerId: ids.employee,
    });
    const list = async (q: string) => (await call('GET', `/library/books?${q}`)).json();
    const all = await list('');
    expect(all.page.total).toBe(2);
    expect(all.data.find((x: { id: string }) => x.id === ids.title)).toMatchObject({
      copies: 5,
      available: 4,
      issued: 1,
      material: 'Book',
      subject: 'Fiction',
    });
    expect((await list('q=narayan')).data.map((x: { title: string }) => x.title)).toEqual([
      'Malgudi Days',
    ]);
    expect((await list('q=B00006')).data).toHaveLength(1);
    expect((await list(`q=${encodeURIComponent(ISBN)}`)).data).toHaveLength(1);
    expect((await list('q=8901234')).data).toHaveLength(1);
    expect(
      (await list(`materialTypeId=${ids.REF!}`)).data.map((x: { title: string }) => x.title),
    ).toEqual(['Oxford Atlas']);
    expect((await list('status=withdrawn')).data).toHaveLength(1);
    expect((await list('status=lost')).data).toHaveLength(0);
    expect((await list(`libraryId=${ids.main!}&status=issued`)).data).toHaveLength(1);
  });
});
