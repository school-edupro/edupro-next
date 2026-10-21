/**
 * The circulation desk (docs/design/36-library.md, "The circulation desk"): a borrower found by
 * admission number, employee code or name, with the rule, the books held and what blocks an issue; a book
 * looked up for issue or return (an old number too); several books issued at once, all or none, with one
 * due date if given; several returned at once with their fines; the books a class or section holds.
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

describe('library circulation desk (e2e)', () => {
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
  const s = stamp('LDK');
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, employee_type, designation)
           VALUES ($1, $2, 'Meena', 'Iyer', 'teaching', 'TGT English') RETURNING id::text`,
          [school.id, `${s}-E1`],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await call(
      'POST',
      '/academics/classes',
      { code: 'VI', name: 'Class VI', displayOrder: 6 },
      admin,
    );
    ids.classId = cls.json().id as string;
    for (const [k, name, sec, first, mobile] of [
      ['a', 'A', 'secA', 'Asha', '9876517401'],
      ['b', 'B', 'secB', 'Bina', '9876517402'],
    ] as const) {
      const r = await call('POST', `/academics/classes/${ids.classId}/sections`, { name }, admin);
      ids[sec] = r.json().id as string;
      const st = await call(
        'POST',
        '/people/students',
        {
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
          enrolment: { classSectionId: ids[sec], rollNo: k === 'a' ? 7 : 3 },
        },
        admin,
      );
      expect(st.statusCode).toBe(201);
      ids[k] = st.json().id as string;
    }
    const setup = (await call('GET', '/library/books/setup')).json();
    const r = await call('POST', '/library/books', {
      title: 'Malgudi Days',
      people: [{ name: 'R. K. Narayan' }],
      materialTypeId: setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id,
      copies: { libraryId: setup.libraries[0].id, count: 6, accessionedOn: '2026-01-10' },
    });
    expect(r.json().accessionNos).toHaveLength(6);
  });
  afterAll(async () => app.close());

  it('a borrower by admission no. or code (any case), else by name; the card says what blocks an issue', async () => {
    expect(
      (await call('GET', `/library/desk/borrowers?q=${s}-a`, undefined, coordinator)).statusCode,
    ).toBe(403);
    const a = (await call('GET', `/library/desk/borrowers?q=${s.toLowerCase()}-a`)).json();
    expect(a.borrower).toMatchObject({
      kind: 'student',
      id: ids.a,
      name: 'Asha Reader',
      place: 'Class VI-A',
      rollNo: 7,
      holding: 0,
      blocked: null,
      rule: { maxBooks: 2, loanDays: 14 },
    });
    const e = (await call('GET', `/library/desk/borrowers?q=${s}-E1`)).json();
    expect(e.borrower).toMatchObject({
      kind: 'employee',
      name: 'Meena Iyer',
      place: 'TGT English',
    });
    const byName = (await call('GET', '/library/desk/borrowers?q=reader')).json();
    expect(byName.borrower).toBeNull();
    expect(byName.matches.map((m: { name: string }) => m.name)).toEqual([
      'Asha Reader',
      'Bina Reader',
    ]);
    expect((await call('GET', '/library/desk/borrowers/teacher/1')).statusCode).toBe(404);
  });

  it('issue: each book checked first; several at once, all or none; one due date for the batch', async () => {
    expect(
      (await call('GET', '/library/desk/book?accessionNo=b00001&for=issue')).json(),
    ).toMatchObject({
      book: { accessionNo: 'B00001', title: 'Malgudi Days', author: 'R. K. Narayan' },
      problem: null,
    });
    expect((await call('GET', '/library/desk/book?accessionNo=X9&for=issue')).statusCode).toBe(404);
    // three books for a rule of two: none issued, the third named
    const over = await call('POST', '/library/desk/issue', {
      borrowerKind: 'student',
      borrowerId: ids.a,
      accessionNos: ['B00001', 'B00002', 'B00003'],
    });
    expect(over.statusCode).toBe(409);
    expect(over.json().detail).toMatch(/^B00003: .*nothing was issued$/);
    expect((await call('GET', `/library/desk/borrowers/student/${ids.a!}`)).json().holding).toBe(0);
    expect(
      (
        await call('POST', '/library/desk/issue', {
          borrowerKind: 'student',
          borrowerId: ids.a,
          accessionNos: ['B00001', 'b00001'],
        })
      ).json().detail,
    ).toContain('twice');
    const ok = await call('POST', '/library/desk/issue', {
      borrowerKind: 'student',
      borrowerId: ids.a,
      accessionNos: ['B00001', 'B00002'],
      dueOn: day(21),
    });
    expect(ok.statusCode).toBe(201);
    expect(
      ok
        .json()
        .loans.map((l: { accessionNo: string; dueOn: string }) => `${l.accessionNo} ${l.dueOn}`),
    ).toEqual([`B00001 ${day(21)}`, `B00002 ${day(21)}`]);
    const card = (await call('GET', `/library/desk/borrowers/student/${ids.a!}`)).json();
    expect(card).toMatchObject({ holding: 2, blocked: 'Already holds 2 of 2 books' });
    expect(card.loans.map((l: { accessionNo: string }) => l.accessionNo)).toEqual([
      'B00001',
      'B00002',
    ]);
    expect(
      (await call('GET', '/library/desk/book?accessionNo=B00001&for=issue')).json().problem,
    ).toMatch(/^On loan to Asha Reader/);
  });

  it('return: the loan and the late fine to today; several returned at once with their fines', async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE library_loans SET issued_on = CURRENT_DATE - 20, due_on = CURRENT_DATE - 5 WHERE school_id = $1 AND returned_on IS NULL`,
        [school.id],
      ),
    );
    const look = (await call('GET', '/library/desk/book?accessionNo=B00001&for=return')).json();
    expect(look).toMatchObject({
      problem: null,
      fine: 10,
      loan: {
        borrower: 'Asha Reader',
        place: 'Class VI-A',
        rollNo: 7,
        dueOn: day(-5),
        renewalsLeft: 2,
      },
    });
    expect(
      (await call('GET', '/library/desk/book?accessionNo=B00003&for=return')).json().problem,
    ).toBe('The book is not on loan');
    const back = await call('POST', '/library/desk/return', { accessionNos: ['B00001', 'B00002'] });
    expect(back.statusCode).toBe(201);
    expect(back.json()).toMatchObject({ fines: 20 });
    expect(
      (await call('POST', '/library/desk/return', { accessionNos: ['B00001'] })).json().detail,
    ).toMatch(/^B00001: .*nothing was returned$/);
  });

  it('the books a class holds, by section', async () => {
    const sections = (await call('GET', '/library/desk/sections')).json();
    expect(sections.classes).toEqual([
      expect.objectContaining({
        id: ids.classId,
        name: 'Class VI',
        sections: [
          { id: ids.secA, name: 'A' },
          { id: ids.secB, name: 'B' },
        ],
      }),
    ]);
    // the fines are paid so both pupils may borrow
    await withMigrator((c) =>
      c.query(`UPDATE library_loans SET fine_paid_on = CURRENT_DATE WHERE school_id = $1`, [
        school.id,
      ]),
    );
    for (const [who, acc] of [
      [ids.a, 'B00003'],
      [ids.b, 'B00004'],
      [ids.b, 'B00005'],
    ] as const)
      expect(
        (
          await call('POST', '/library/desk/issue', {
            borrowerKind: 'student',
            borrowerId: who,
            accessionNos: [acc],
          })
        ).statusCode,
      ).toBe(201);
    const all = (await call('GET', `/library/desk/class-loans?classId=${ids.classId!}`)).json()
      .rows;
    expect(
      all.map((r: { place: string; accessionNo: string }) => `${r.place} ${r.accessionNo}`),
    ).toEqual(['Class VI-A B00003', 'Class VI-B B00004', 'Class VI-B B00005']);
    const b = (
      await call('GET', `/library/desk/class-loans?classId=${ids.classId!}&sectionId=${ids.secB!}`)
    ).json().rows;
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({
      student: 'Bina Reader',
      admissionNo: `${s}-b`,
      rollNo: 3,
      title: 'Malgudi Days',
    });
  });
});
