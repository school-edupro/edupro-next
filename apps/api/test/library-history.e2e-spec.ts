/**
 * Circulation and borrowers' history (0218, docs/design/36-library.md, "Library reports", part 2):
 * issues, returns and renewals between two days (each renewal now kept with its day and due dates), the
 * books out and overdue now, by pupils or staff, class or section and a search; pupils or staff with what
 * they borrowed, returned and hold; one borrower's books between two days with the fine and how the loan
 * ended; each as Excel or PDF.
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

describe('library circulation and borrowers history (e2e)', () => {
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
  const s = stamp('LHS');
  const ids: Record<string, string> = {};
  const issue = (acc: string, kind: 'student' | 'employee', who: string) =>
    call('POST', '/library/loans/issue', { accessionNo: acc, borrowerKind: kind, borrowerId: who });
  /** A loan's days set (issued, due, returned) as if it happened then. */
  const dates = (acc: string, issued: string, due: string, returned?: string) =>
    withMigrator((c) =>
      c.query(
        `UPDATE library_loans SET issued_on = $3::date, due_on = $4::date, returned_on = COALESCE($5::date, returned_on)
          WHERE copy_id = (SELECT id FROM library_copies WHERE school_id = $1 AND accession_no = $2)`,
        [school.id, acc, issued, due, returned ?? null],
      ),
    );
  type Circ = {
    rows: Array<Record<string, unknown>>;
    total: number;
    counts: Record<string, number>;
  };
  const circ = async (query: string) =>
    (await call('GET', `/library/history/circulation?${query}`)).json() as Circ;
  const fileOf = async (url: string) => {
    const r = await call('GET', url);
    expect(r.statusCode).toBe(200);
    return r.json() as { filename: string; contentType: string; base64: string; rows: number };
  };
  const sheet = async (base64: string) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as ArrayBuffer);
    return wb.worksheets[0]!;
  };

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
    for (const [k, name, first, mobile, roll] of [
      ['a', 'A', 'Asha', '9876517601', 4],
      ['b', 'B', 'Bina', '9876517602', 2],
    ] as const) {
      const sec = await call('POST', `/academics/classes/${ids.classId}/sections`, { name }, admin);
      ids[`sec${name}`] = sec.json().id as string;
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
          enrolment: { classSectionId: ids[`sec${name}`], rollNo: roll },
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
      copies: { libraryId: setup.libraries[0].id, count: 6, accessionedOn: '2026-01-05' },
    });
    expect(r.json().accessionNos).toHaveLength(6);
    // January: Bina borrowed B00005 and brought it back on time
    expect((await issue('B00005', 'student', ids.b!)).statusCode).toBe(201);
    expect(
      (await call('POST', '/library/loans/return', { accessionNo: 'B00005' })).statusCode,
    ).toBe(201);
    await dates('B00005', '2026-01-10', '2026-01-24', '2026-01-20');
    // Asha: B00001 issued 20 days ago, due 6 days ago, back today (₹2 a day: ₹12)
    expect((await issue('B00001', 'student', ids.a!)).statusCode).toBe(201);
    await dates('B00001', day(-20), day(-6));
    expect(
      (await call('POST', '/library/loans/return', { accessionNo: 'B00001' })).statusCode,
    ).toBe(201);
    // the late fine of B00001 is paid at the fees counter, so Asha may borrow again
    await withMigrator((c) =>
      c.query(`UPDATE misc_fee_students SET paid = amount, status = 'paid' WHERE school_id = $1`, [
        school.id,
      ]),
    );
    // Asha: B00002 today, renewed today
    expect((await issue('B00002', 'student', ids.a!)).statusCode).toBe(201);
    // Bina: B00003 issued 30 days ago, due 16 days ago, still out
    expect((await issue('B00003', 'student', ids.b!)).statusCode).toBe(201);
    await dates('B00003', day(-30), day(-16));
    // Meena: B00004 today
    expect((await issue('B00004', 'employee', ids.employee!)).statusCode).toBe(201);
  });
  afterAll(async () => app.close());

  it('each renewal is kept with its day and the due dates before and after', async () => {
    const r = await call('POST', '/library/loans/renew', { accessionNo: 'B00002' });
    expect(r.statusCode).toBe(201);
    const renewed = await circ('what=renewed');
    expect(renewed.rows).toEqual([
      expect.objectContaining({
        day: day(0),
        what: 'renewed',
        accessionNo: 'B00002',
        borrower: 'Asha Reader',
        fromDue: day(14),
        toDue: day(28),
        renewed: 1,
      }),
    ]);
    expect(renewed.rows[0]!.by).toBeTruthy();
  });

  it('circulation between two days; out and overdue now; by borrowers, class, section and search', async () => {
    const all = await circ('what=all');
    expect(all.total).toBe(8);
    expect(all.counts).toEqual({ issued: 5, returned: 2, renewed: 1, out: 3, overdue: 1 });
    const today = await circ(`what=all&from=${day(0)}&to=${day(0)}`);
    expect(today.rows.map((r) => `${String(r.what)} ${String(r.accessionNo)}`).sort()).toEqual([
      'issued B00002',
      'issued B00004',
      'renewed B00002',
      'returned B00001',
    ]);
    expect(today.counts).toEqual({ issued: 2, returned: 1, renewed: 1, out: 3, overdue: 1 });
    const back = (await circ(`what=returned&from=${day(0)}&to=${day(0)}`)).rows[0]!;
    expect(back).toMatchObject({
      accessionNo: 'B00001',
      issuedOn: day(-20),
      dueOn: day(-6),
      returnedOn: day(0),
      daysLate: 6,
      fine: 12,
      place: 'Class VI-A',
      title: 'Malgudi Days',
      author: 'R. K. Narayan',
    });
    // overdue is now: the days do not apply
    const overdue = await circ(`what=overdue&from=${day(0)}&to=${day(0)}`);
    expect(overdue.rows).toEqual([
      expect.objectContaining({ accessionNo: 'B00003', borrower: 'Bina Reader', daysLate: 16 }),
    ]);
    expect((await circ('what=issued&borrower=employee')).rows).toEqual([
      expect.objectContaining({ accessionNo: 'B00004', place: 'TGT English', ref: `${s}-E1` }),
    ]);
    expect((await circ(`what=issued&classId=${ids.classId!}`)).total).toBe(4);
    expect((await circ(`what=issued&sectionId=${ids.secB!}`)).total).toBe(2);
    expect((await circ('what=all&q=meena')).total).toBe(1);
    expect((await circ('what=issued&from=2026-01-01&to=2026-01-31')).rows).toEqual([
      expect.objectContaining({ accessionNo: 'B00005', day: '2026-01-10' }),
    ]);
    expect(
      (await call('GET', '/library/history/circulation?what=all', undefined, coordinator))
        .statusCode,
    ).toBe(403);
    expect((await call('GET', '/library/history/circulation?what=lent')).statusCode).toBe(400);
  });

  it('pupils and staff: borrowed, returned, holding and overdue; between two days; sorted', async () => {
    const pupils = (await call('GET', '/library/history/borrowers?kind=student')).json();
    // by class-section, then roll no.
    expect(pupils.rows).toEqual([
      expect.objectContaining({
        name: 'Asha Reader',
        place: 'Class VI-A',
        rollNo: 4,
        borrowed: 2,
        returned: 1,
        late: 1,
        holding: 1,
        overdue: 0,
        fines: 12,
        ever: 2,
        lastIssued: day(0),
      }),
      expect.objectContaining({ name: 'Bina Reader', borrowed: 2, holding: 1, overdue: 1 }),
    ]);
    expect(pupils.totals).toEqual({ borrowed: 4, returned: 2, holding: 2, overdue: 1, fines: 12 });
    const today = (
      await call('GET', `/library/history/borrowers?kind=student&from=${day(0)}&to=${day(0)}`)
    ).json();
    expect(today.rows).toEqual([
      expect.objectContaining({ name: 'Asha Reader', borrowed: 1, returned: 1, fines: 12 }),
      // nothing between the days, but she holds a book: still listed
      expect.objectContaining({ name: 'Bina Reader', borrowed: 0, returned: 0, holding: 1 }),
    ]);
    expect(
      (await call('GET', '/library/history/borrowers?kind=student&show=overdue')).json().rows,
    ).toEqual([expect.objectContaining({ name: 'Bina Reader' })]);
    expect(
      (
        await call(
          'GET',
          '/library/history/borrowers?kind=student&from=2026-02-01&to=2026-02-28&show=active&sectionId=' +
            ids.secA!,
        )
      ).json().rows,
    ).toEqual([expect.objectContaining({ name: 'Asha Reader', borrowed: 0, holding: 1 })]);
    const staff = (await call('GET', '/library/history/borrowers?kind=employee')).json();
    expect(staff.rows).toEqual([
      expect.objectContaining({
        name: 'Meena Iyer',
        ref: `${s}-E1`,
        place: 'TGT English',
        holding: 1,
      }),
    ]);
    expect((await call('GET', '/library/history/borrowers')).statusCode).toBe(400);
  });

  it('one borrower: the books held between two days, how each ended and its fine', async () => {
    const asha = (await call('GET', `/library/history/borrowers/student/${ids.a!}`)).json();
    expect(asha.borrower).toEqual({
      kind: 'student',
      id: ids.a,
      name: 'Asha Reader',
      ref: `${s}-a`,
      place: 'Class VI-A',
    });
    expect(asha.rows).toEqual([
      expect.objectContaining({ accessionNo: 'B00002', outcome: 'Out', renewed: 1, fine: 0 }),
      expect.objectContaining({
        accessionNo: 'B00001',
        outcome: 'Returned',
        daysLate: 6,
        fine: 12,
        fineState: 'Paid at the fees counter',
      }),
    ]);
    expect(asha.totals).toEqual({ loans: 2, out: 1, late: 1, fines: 12 });
    const jan = (
      await call(
        'GET',
        `/library/history/borrowers/student/${ids.b!}?from=2026-01-01&to=2026-01-31`,
      )
    ).json();
    expect(jan.rows).toEqual([
      expect.objectContaining({
        accessionNo: 'B00005',
        outcome: 'Returned',
        returnedOn: '2026-01-20',
      }),
    ]);
    // a book still out was held in every range since it was issued
    expect(
      (await call('GET', `/library/history/borrowers/student/${ids.b!}?from=${day(-1)}`)).json()
        .rows,
    ).toEqual([expect.objectContaining({ accessionNo: 'B00003', outcome: 'Overdue' })]);
    expect((await call('GET', `/library/history/borrowers/teacher/${ids.a!}`)).statusCode).toBe(
      404,
    );
    expect((await call('GET', `/library/history/borrowers/employee/${ids.a!}`)).statusCode).toBe(
      404,
    );
  });

  it('each list as Excel or PDF', async () => {
    const all = await fileOf('/library/history/circulation/export?what=all&format=xlsx');
    expect(all).toMatchObject({ filename: `Library-circulation-all-${day(0)}.xlsx`, rows: 8 });
    const ws = await sheet(all.base64);
    expect(ws.getRow(1).getCell(2).value).toBe('What');
    expect(ws.rowCount).toBe(9);
    const od = await fileOf('/library/history/circulation/export?what=overdue&format=pdf');
    expect(od.filename).toBe(`Library-circulation-overdue-${day(0)}.pdf`);
    expect(Buffer.from(od.base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    const pupils = await fileOf('/library/history/borrowers/export?kind=student&format=xlsx');
    expect(pupils).toMatchObject({ filename: `Library-pupils-books-${day(0)}.xlsx`, rows: 2 });
    const ps = await sheet(pupils.base64);
    expect(ps.getRow(1).getCell(1).value).toBe('Pupil');
    // the totals: borrowed 4, holding 2
    expect(ps.getRow(4).getCell(5).value).toBe(4);
    expect(ps.getRow(4).getCell(8).value).toBe(2);
    const staff = await fileOf('/library/history/borrowers/export?kind=employee&format=pdf');
    expect(staff.filename).toBe(`Library-staff-books-${day(0)}.pdf`);
    const one = await fileOf(`/library/history/borrowers/student/${ids.a!}/export?format=xlsx`);
    expect(one).toMatchObject({ filename: `Library-history-${s}-a-${day(0)}.xlsx`, rows: 2 });
    const os = await sheet(one.base64);
    expect(os.getRow(3).getCell(11).value).toBe('Paid at the fees counter');
  });
});
