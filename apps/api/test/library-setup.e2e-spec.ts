/**
 * Library, part 1 (0206, docs/design/36-library.md): the set-up masters on the shared masters grid (a
 * school starts with a Main library, material types and their accession prefixes, languages and three
 * borrowing rules; names unique regardless of case; fields checked), and the borrowing rules at the issue
 * desk (a class rule, a hostel rule, a staff group with no borrowing, all staff; renewals, fine with grace
 * days and a highest fine).
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

describe('library set-up and borrowing rules (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? admin).sub, school.id);
  const save = (master: string, values: Record<string, unknown>, who?: SeededUser) =>
    inject({ method: 'POST', url: `/masters/${master}/rows`, headers: h(who), json: { values } });
  const rows = async (master: string) =>
    (await inject({ method: 'GET', url: `/masters/${master}/rows`, headers: h() })).json()
      .data as Array<Record<string, unknown>>;
  const s = stamp('LIB');
  const people: Record<string, string> = {};
  const day = (n: number) =>
    new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    // the library opened once: the set-up's starting rows
    expect(
      (await inject({ method: 'GET', url: '/library/catalogue', headers: h() })).statusCode,
    ).toBe(200);
  });
  afterAll(async () => app.close());

  it('a school starts with a Main library, material types with prefixes, languages and three rules', async () => {
    const list = (await inject({ method: 'GET', url: '/masters', headers: h() })).json();
    const library = (list.data ?? list) as Array<{ id: string; group: string }>;
    const ids = library.filter((m) => m.group === 'library').map((m) => m.id);
    expect(ids.slice(0, 11)).toEqual([
      'library_libraries',
      'library_material_types',
      'library_accession_series',
      'library_subjects',
      'library_authors',
      'library_languages',
      'library_publishers',
      'library_periodicals',
      'library_shelves',
      'library_vendors',
      'library_borrow_rules',
    ]);
    expect(await rows('library_libraries')).toEqual([
      expect.objectContaining({ code: 'MAIN', name: 'Main library', status: 'active' }),
    ]);
    const types = await rows('library_material_types');
    // the grid gives every value as text
    expect(types.map((t) => [t.code, String(t.issuable)])).toEqual([
      ['BOOK', 'true'],
      ['TEXT', 'true'],
      ['REF', 'false'],
      ['MAG', 'true'],
      ['AV', 'true'],
      ['MAP', 'false'],
    ]);
    const series = await rows('library_accession_series');
    expect(series).toHaveLength(6);
    const book = series.find((x) => String(x.material_type_id).startsWith('BOOK'))!;
    expect([book.prefix, String(book.digits), String(book.next_no)]).toEqual(['B', '5', '1']);
    expect((await rows('library_languages')).map((l) => l.name)).toEqual(
      expect.arrayContaining(['English', 'Hindi', 'Sanskrit']),
    );
    expect(
      (await rows('library_borrow_rules')).map((r) => [
        r.applies_to,
        String(r.max_books),
        String(r.loan_days),
      ]),
    ).toEqual([
      ['Student', '2', '14'],
      ['Hostel student', '2', '14'],
      ['Employee', '5', '30'],
    ]);
  });

  it('names are unique regardless of case; codes, GSTIN, ISSN and racks are checked', async () => {
    expect((await save('library_authors', { name: 'R. K. Narayan' })).statusCode).toBe(201);
    // the same name in other case is the same author (an upload updates it)
    expect(
      (await save('library_authors', { name: 'r. k. narayan', note: 'Malgudi' })).statusCode,
    ).toBe(201);
    expect(await rows('library_authors')).toEqual([
      expect.objectContaining({ name: 'R. K. Narayan', note: 'Malgudi' }),
    ]);
    expect(
      (
        await save('library_subjects', {
          name: 'Mathematics',
          class_no: '510',
          sub_subjects: 'Algebra, Geometry',
        })
      ).statusCode,
    ).toBe(201);
    expect((await rows('library_subjects'))[0]).toMatchObject({
      name: 'Mathematics',
      sub_subjects: expect.stringContaining('Geometry'),
    });
    const vendor = { code: 'BOOKHOUSE', name: 'Book House', mobile: '9876500011' };
    expect((await save('library_vendors', { ...vendor, gstin: '07AABCU9603R1Z' })).statusCode).toBe(
      400,
    );
    expect((await save('library_vendors', { ...vendor, code: 'book house' })).statusCode).toBe(400);
    expect(
      (await save('library_vendors', { ...vendor, gstin: '07AABCU9603R1ZX' })).statusCode,
    ).toBe(201);
    expect(
      (await save('library_publishers', { name: 'Penguin India', place: 'Gurugram' })).statusCode,
    ).toBe(201);
    expect(
      (
        await save('library_periodicals', {
          name: 'Science Reporter',
          issn: '0036-8512',
          frequency: 'Monthly',
          language_id: 'English',
          vendor_id: 'BOOKHOUSE',
        })
      ).statusCode,
    ).toBe(201);
    expect((await save('library_periodicals', { name: 'Bad', issn: '12345678' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await save('library_shelves', {
          library_id: 'MAIN',
          code: 'A3',
          name: 'Science',
          racks: 'R1, R2, R3',
        })
      ).statusCode,
    ).toBe(201);
    expect((await save('library_shelves', { library_id: 'NOPE', code: 'A4' })).statusCode).toBe(
      400,
    );
    expect(
      (
        await save('library_accession_series', {
          library_id: 'MAIN',
          material_type_id: 'BOOK',
          prefix: 'b ',
        })
      ).statusCode,
    ).toBe(400);
    // the academic coordinator sees the set-up but does not change it
    expect((await save('library_authors', { name: 'Ruskin Bond' }, coordinator)).statusCode).toBe(
      403,
    );
  });

  it('the issue desk follows the rules: class, hostel, staff group; renewals; fine after grace days, up to the highest', async () => {
    // a class with a section, two students (one in the hostel), two employees
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id as string}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    for (const [k, first, mobile] of [
      ['day', 'Asha', '9876517101'],
      ['hostel', 'Bina', '9876517102'],
    ] as const) {
      const st = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${k}`,
          firstName: first,
          lastName: 'Reader',
          guardians: [
            {
              guardian: { firstName: 'Ravi', lastName: 'Reader', mobile },
              relation: 'father',
              isPrimary: true,
            },
          ],
          enrolment: { classSectionId: sec.json().id, rollNo: k === 'day' ? 1 : 2 },
        },
      });
      expect(st.statusCode).toBe(201);
      people[k] = st.json().id as string;
    }
    await withMigrator(async (c) => {
      const hostel = await c.query<{ id: string }>(
        `INSERT INTO hostels (school_id, name, code) VALUES ($1, 'Girls hostel', 'GH') RETURNING id::text`,
        [school.id],
      );
      const type = await c.query<{ id: string }>(
        `INSERT INTO hostel_room_types (school_id, name, seater) VALUES ($1, 'Double', 2) RETURNING id::text`,
        [school.id],
      );
      const room = await c.query<{ id: string }>(
        `INSERT INTO hostel_rooms (school_id, hostel_id, room_no, room_type_id) VALUES ($1, $2, '101', $3) RETURNING id::text`,
        [school.id, hostel.rows[0]!.id, type.rows[0]!.id],
      );
      const bed = await c.query<{ id: string }>(
        `INSERT INTO hostel_beds (school_id, room_id, label) VALUES ($1, $2, 'A') RETURNING id::text`,
        [school.id, room.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO hostel_allotments (school_id, student_id, bed_id, from_date) VALUES ($1, $2, $3, CURRENT_DATE - 10)`,
        [school.id, people.hostel, bed.rows[0]!.id],
      );
      for (const [k, code, type_] of [
        ['teacher', 'T1', 'teaching'],
        ['clerk', 'N1', 'non_teaching'],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, employee_type) VALUES ($1, $2, 'Staff', $3) RETURNING id::text`,
          [school.id, code, type_],
        );
        people[k] = e.rows[0]!.id;
      }
    });
    // Class VI: one book for 7 days, no renewal, ₹5 a day after 2 grace days, at most ₹20; hostel
    // students: three books for 21 days; teaching staff: none
    expect(
      (
        await save('library_borrow_rules', {
          applies_to: 'Student',
          class_id: 'VI',
          max_books: 1,
          loan_days: 7,
          renewals: 0,
          fine_per_day: 5,
          max_fine: 20,
          grace_days: 2,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await save('library_borrow_rules', {
          applies_to: 'Hostel student',
          max_books: 3,
          loan_days: 21,
          renewals: 1,
          fine_per_day: 1,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await save('library_borrow_rules', {
          applies_to: 'Employee',
          staff_group: 'Teaching',
          max_books: 0,
          loan_days: 30,
        })
      ).statusCode,
    ).toBe(201);
    // a class on a staff rule is cleared, not refused
    expect(
      (
        await save('library_borrow_rules', {
          applies_to: 'Employee',
          class_id: 'VI',
          staff_group: 'Visiting',
          max_books: 1,
          loan_days: 10,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await rows('library_borrow_rules')).find((r) => r.staff_group === 'Visiting'),
    ).toMatchObject({ class_id: null });
    const title = await save('library_titles', { code: `${s}-T`, title: 'Swami and Friends' });
    expect(title.statusCode).toBe(201);
    const acc = (n: number) => `${s}-${String(n)}`;
    await inject({
      method: 'POST',
      url: '/library/copies',
      headers: h(),
      json: { titleId: title.json().id, accessionNos: [1, 2, 3, 4, 5, 6, 7, 8].map(acc) },
    });
    const issue = (n: number, kind: 'student' | 'employee', who: string) =>
      inject({
        method: 'POST',
        url: '/library/loans/issue',
        headers: h(),
        json: { accessionNo: acc(n), borrowerKind: kind, borrowerId: who },
      });
    // the day scholar: one book for 7 days, no renewal
    const a = await issue(1, 'student', people.day!);
    expect(a.statusCode).toBe(201);
    expect(a.json().dueOn).toBe(day(7));
    const more = await issue(2, 'student', people.day!);
    expect(more.json()).toMatchObject({ type: 'library.limit' });
    expect(more.json().detail).toContain('Student · Class VI');
    const renew = await inject({
      method: 'POST',
      url: '/library/loans/renew',
      headers: h(),
      json: { accessionNo: acc(1) },
    });
    expect(renew.json()).toMatchObject({ type: 'library.renew_limit' });
    // back 10 days late: (10 − 2) × ₹5 = ₹40, held at ₹20
    const back = await inject({
      method: 'POST',
      url: '/library/loans/return',
      headers: h(),
      json: { accessionNo: acc(1), returnedOn: day(17) },
    });
    expect(Number(back.json().fineAmount)).toBe(20);
    // the hostel student: the hostel rule (three for 21 days), not the class rule
    for (const n of [3, 4, 5]) {
      const r = await issue(n, 'student', people.hostel!);
      expect(r.statusCode).toBe(201);
      expect(r.json().dueOn).toBe(day(21));
    }
    expect((await issue(6, 'student', people.hostel!)).json().type).toBe('library.limit');
    // a teacher may not borrow; a clerk has the all-staff rule (five for 30 days)
    const t = await issue(7, 'employee', people.teacher!);
    expect(t.json()).toMatchObject({ type: 'library.not_allowed' });
    const n = await issue(7, 'employee', people.clerk!);
    expect(n.statusCode).toBe(201);
    expect(n.json().dueOn).toBe(day(30));
  });
});
