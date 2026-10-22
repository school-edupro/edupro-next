/**
 * Library staff (0221, docs/design/36-library.md, "Library round 3", part 3): each library names its
 * staff; a user named on a library works only there (its copies, shelves and set-up; the desk, stock,
 * sales and reports of it), a user named on none in every library; a book of another library is taken
 * back at any desk and its history says so; only someone working in every library names the staff.
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

describe('library staff working in their own libraries (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let librarian: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? librarian).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const s = stamp('LSF');
  const ids: Record<string, string> = {};
  const copies = async (u: SeededUser) =>
    (await call('POST', '/library/register/copies', { size: 50, page: 1, status: 'all' }, u))
      .json()
      .rows.map((r: { accession_no: string }) => r.accession_no) as string[];

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      // the librarian's employee record signs in as the librarian
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, employee_type, designation, user_id)
           VALUES ($1, $2, 'Lata', 'Librarian', 'non_teaching', 'Librarian', $3) RETURNING id::text`,
          [school.id, `${s}-E1`, librarian.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup', undefined, admin)).json();
    ids.main = setup.libraries[0].id as string;
    ids.book = setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id as string;
    await withMigrator(async (c) => {
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
    const add = async (title: string, library: string, count: number) => {
      const r = await call(
        'POST',
        '/library/books',
        {
          title,
          people: [{ name: 'R. K. Narayan' }],
          materialTypeId: ids.book,
          copies: { libraryId: library, count, accessionedOn: '2026-01-10', price: 100 },
        },
        admin,
      );
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string; accessionNos: string[] };
    };
    const main = await add('Malgudi Days', ids.main!, 3);
    ids.malgudi = main.id;
    expect(main.accessionNos).toEqual(['B00001', 'B00002', 'B00003']);
    expect((await add('Panchatantra', ids.junior!, 2)).accessionNos).toEqual(['JB00001', 'JB00002']);
    const cls = await call(
      'POST',
      '/academics/classes',
      { code: 'VI', name: 'Class VI', displayOrder: 6 },
      admin,
    );
    const sec = await call(
      'POST',
      `/academics/classes/${cls.json().id as string}/sections`,
      { name: 'A' },
      admin,
    );
    const st = await call(
      'POST',
      '/people/students',
      {
        admissionNo: `${s}-1`,
        firstName: 'Asha',
        lastName: 'Reader',
        guardians: [
          {
            guardian: { firstName: 'Ravi', lastName: 'Reader', mobile: '9876517801' },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
      admin,
    );
    ids.pupil = st.json().id as string;
  });
  afterAll(async () => app.close());

  it('the admin names the librarian on the Junior library; only someone working in every library may', async () => {
    const list = (await call('GET', '/library/staff', undefined, admin)).json();
    expect(list).toMatchObject({ canManage: true, mine: null });
    expect(list.libraries.map((l: { name: string }) => l.name)).toEqual([
      'Junior library',
      'Main library',
    ]);
    expect(list.employees.map((e: { id: string }) => e.id)).toContain(ids.employee);
    expect((await call('GET', '/library/staff', undefined, coordinator)).statusCode).toBe(403);
    const add = await call(
      'POST',
      '/library/staff',
      { libraryId: ids.junior, employeeId: ids.employee },
      admin,
    );
    expect(add.json()).toMatchObject({
      added: true,
      library: 'Junior library',
      employee: 'Lata Librarian',
    });
    expect((await call('GET', '/library/staff/me')).json()).toEqual({
      mine: [{ id: ids.junior, name: 'Junior library' }],
    });
    expect((await call('GET', '/library/staff/me', undefined, admin)).json()).toEqual({
      mine: null,
    });
    const own = (await call('GET', '/library/staff')).json();
    expect(own).toMatchObject({ canManage: false, employees: [] });
    expect(own.libraries).toEqual([
      expect.objectContaining({
        name: 'Junior library',
        staff: [
          expect.objectContaining({
            employeeId: ids.employee,
            name: 'Lata Librarian',
            signsIn: true,
          }),
        ],
      }),
    ]);
    const refused = await call('POST', '/library/staff', {
      libraryId: ids.junior,
      employeeId: ids.employee,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().type).toBe('library.staff_limited');
  });

  it('the librarian sees only the Junior library: its copies, set-up and books', async () => {
    expect(await copies(librarian)).toEqual(['JB00001', 'JB00002']);
    expect(await copies(admin)).toEqual(['B00001', 'B00002', 'B00003', 'JB00001', 'JB00002']);
    const setup = (await call('GET', '/library/books/setup')).json();
    expect(setup.libraries.map((l: { name: string }) => l.name)).toEqual(['Junior library']);
    const rows = (await call('GET', '/masters/library_libraries/rows')).json().data;
    expect(rows.map((r: { name: string }) => r.name)).toEqual(['Junior library']);
    // a title is shared; its copies of other libraries are not shown
    expect((await call('GET', `/library/books/${ids.malgudi!}`)).json().copies).toEqual([]);
    // nor may copies be added to another library
    const away = await call('POST', `/library/books/${ids.malgudi!}/copies`, {
      libraryId: ids.main,
      count: 1,
    });
    expect(away.statusCode).toBe(400);
    expect(away.json().detail).toBe('Library: not found or switched off');
  });

  it('the desk: issues only Junior books; takes back a book of any library, its history says so', async () => {
    const look = (await call('GET', '/library/desk/book?accessionNo=B00001&for=issue')).json();
    expect(look).toMatchObject({ problem: 'It belongs to Main library: issue it there' });
    expect(
      (
        await call('POST', '/library/loans/issue', {
          accessionNo: 'B00002',
          borrowerKind: 'student',
          borrowerId: ids.pupil,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', '/library/desk/issue', {
          borrowerKind: 'student',
          borrowerId: ids.pupil,
          accessionNos: ['JB00001'],
        })
      ).statusCode,
    ).toBe(201);
    // the admin issues a Main book; the pupil brings it to the Junior desk
    expect(
      (
        await call(
          'POST',
          '/library/loans/issue',
          { accessionNo: 'B00003', borrowerKind: 'student', borrowerId: ids.pupil },
          admin,
        )
      ).statusCode,
    ).toBe(201);
    const card = (await call('GET', `/library/desk/borrowers/student/${ids.pupil!}`)).json();
    expect(card.loans.map((l: { accessionNo: string }) => l.accessionNo).sort()).toEqual([
      'B00003',
      'JB00001',
    ]);
    expect(
      (await call('GET', '/library/desk/book?accessionNo=B00003&for=return')).json(),
    ).toMatchObject({
      problem: null,
      loan: { accessionNo: 'B00003' },
    });
    const back = await call('POST', '/library/desk/return', { accessionNos: ['B00003'] });
    expect(back.statusCode).toBe(201);
    const book = (await call('GET', `/library/books/${ids.malgudi!}`, undefined, admin)).json();
    expect(book.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accessionNo: 'B00003',
          what: 'returned elsewhere',
          reason: 'Taken back at Junior library, not at Main library: to be sent back there',
        }),
      ]),
    );
    // the Junior circulation shows its own books only
    const circ = (await call('GET', '/library/history/circulation?what=all')).json();
    expect(circ.rows.map((r: { accessionNo: string }) => r.accessionNo)).toEqual(['JB00001']);
    expect(
      (await call('GET', '/library/history/circulation?what=all', undefined, admin)).json().total,
    ).toBe(3);
  });

  it('stock and sales: a cycle over the Junior library only; another library’s book named as such', async () => {
    const mains = await call(
      'POST',
      '/library/stock/cycles',
      { name: 'Main check', libraryIds: [ids.main] },
      admin,
    );
    expect(mains.statusCode).toBe(201);
    const mine = await call('POST', '/library/stock/cycles', { name: 'Junior check' });
    expect(mine.statusCode).toBe(201);
    expect(mine.json()).toMatchObject({
      scope: { words: 'Junior library · every shelf · every material type' },
      counts: { total: 2 },
    });
    expect(
      (await call('POST', '/library/stock/cycles', { name: 'Main too', libraryIds: [ids.main] }))
        .statusCode,
    ).toBe(400);
    const listed = (await call('GET', '/library/stock/cycles')).json().data;
    expect(listed.map((x: { name: string }) => x.name)).toEqual(['Junior check']);
    expect(
      (await call('GET', `/library/stock/cycles/${mains.json().id as string}`)).statusCode,
    ).toBe(404);
    const scan = (
      await call('POST', `/library/stock/cycles/${mine.json().id as string}/verify`, {
        accessionNos: ['JB00002', 'B00001'],
      })
    ).json();
    expect(scan).toMatchObject({
      verified: [expect.objectContaining({ accessionNo: 'JB00002' })],
      outside: [expect.objectContaining({ accessionNo: 'B00001', library: 'Main library' })],
    });
    expect((await call('GET', '/library/sales/book?accessionNo=B00001')).json()).toMatchObject({
      canSell: false,
      problem: 'It belongs to Main library: sell it there',
    });
  });

  it('taken off the library, the librarian works in every library again', async () => {
    expect(
      (
        await call(
          'POST',
          '/library/staff/remove',
          { libraryId: ids.junior, employeeId: ids.employee },
          admin,
        )
      ).json(),
    ).toEqual({ removed: true });
    expect((await call('GET', '/library/staff/me')).json()).toEqual({ mine: null });
    expect(await copies(librarian)).toHaveLength(5);
  });
});
