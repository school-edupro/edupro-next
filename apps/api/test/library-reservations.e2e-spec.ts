/**
 * The library in the portals and reservations (0222, docs/design/36-library.md, "Library round 3", part
 * 4): a parent sees each child's books, a staff member their own; the catalogue says whether a copy is on
 * the shelf and when one is due back, never who has it; a book with every copy out is reserved (once, up
 * to the school's number, not when it is held or on the shelf, never a reference book); a renewal waits
 * while others do; a copy coming back is kept for the first in line (the desk is told and issues it to them
 * only), collected on issue, lapsing after the hold days to the next; cancelled by the borrower or the
 * library.
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

describe('library in the portals, and reservations (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let librarian: SeededUser;
  let parent: SeededUser;
  let teacher: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? librarian).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const day = (n: number) =>
    new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  const s = stamp('LRV');
  const ids: Record<string, string> = {};
  const issue = (acc: string, kind: 'student' | 'employee', who: string) =>
    call('POST', '/library/loans/issue', { accessionNo: acc, borrowerKind: kind, borrowerId: who });
  const reserve = (u: SeededUser, kind: 'student' | 'employee', who: string, titleId: string) =>
    call(
      'POST',
      '/library/portal/reservations',
      { borrowerKind: kind, borrowerId: who, titleId },
      u,
    );
  const mine = async (u: SeededUser, kind: string, who: string) =>
    (await call('GET', `/library/portal/borrowers/${kind}/${who}`, undefined, u)).json();
  const find = async (u: SeededUser, q: string) =>
    (await call('GET', `/library/portal/catalogue?q=${encodeURIComponent(q)}`, undefined, u)).json()
      .rows[0] as Record<string, unknown>;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      teacher = await seedUser(c, school, `${s}-teach`, 'class_teacher');
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, employee_type, designation, user_id)
           VALUES ($1, $2, 'Meena', 'Iyer', 'teaching', 'TGT English', $3) RETURNING id::text`,
          [school.id, `${s}-E1`, teacher.id],
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
    const sec = await call(
      'POST',
      `/academics/classes/${cls.json().id as string}/sections`,
      { name: 'A' },
      admin,
    );
    for (const [k, first, mobile] of [
      ['a', 'Asha', '9876517901'],
      ['b', 'Bina', '9876517902'],
    ] as const) {
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
          enrolment: { classSectionId: sec.json().id, rollNo: k === 'a' ? 1 : 2 },
        },
        admin,
      );
      expect(st.statusCode).toBe(201);
      ids[k] = st.json().id as string;
    }
    // the parent signs in as the guardian of both
    await withMigrator((c) =>
      c.query(
        `UPDATE guardians SET user_id = $1 WHERE school_id = $2 AND mobile IN ('9876517901', '9876517902')`,
        [parent.id, school.id],
      ),
    );
    const setup = (await call('GET', '/library/books/setup')).json();
    const type = (code: string) =>
      setup.materialTypes.find((x: { code: string }) => x.code === code).id as string;
    const add = async (title: string, code: string, count: number) => {
      const r = await call('POST', '/library/books', {
        title,
        people: [{ name: 'R. K. Narayan' }],
        materialTypeId: type(code),
        copies: { libraryId: setup.libraries[0].id, count, accessionedOn: '2026-01-10' },
      });
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string; accessionNos: string[] };
    };
    const m = await add('Malgudi Days', 'BOOK', 2);
    ids.malgudi = m.id;
    expect(m.accessionNos).toEqual(['B00001', 'B00002']);
    const sw = await add('Swami and Friends', 'BOOK', 1);
    ids.swami = sw.id;
    ids.atlas = (await add('School Atlas', 'REF', 1)).id;
  });
  afterAll(async () => app.close());

  it('the portals: a parent sees each child, a staff member themself; the catalogue says what is on the shelf', async () => {
    const fam = (await call('GET', '/library/portal/summary', undefined, parent)).json();
    expect(
      fam.people.map((p: { name: string; holding: number }) => `${p.name} ${String(p.holding)}`),
    ).toEqual(['Asha Reader 0', 'Bina Reader 0']);
    const staff = (await call('GET', '/library/portal/summary', undefined, teacher)).json();
    expect(staff.people).toEqual([
      expect.objectContaining({
        kind: 'employee',
        id: ids.employee,
        name: 'Meena Iyer',
        place: 'TGT English',
      }),
    ]);
    expect(await find(parent, 'malgudi')).toMatchObject({
      copies: 2,
      onShelf: 2,
      canReserve: false,
      nextBack: null,
    });
    expect(await find(teacher, 'atlas')).toMatchObject({ reference: true, canReserve: false });
    // a parent may not open another family's child
    expect(
      (await call('GET', `/library/portal/borrowers/employee/${ids.employee!}`, undefined, parent))
        .statusCode,
    ).toBe(404);
  });

  it('every copy out: reserved once each, in order; never when held, on the shelf, a reference book or past the limit', async () => {
    expect((await issue('B00001', 'student', ids.b!)).statusCode).toBe(201);
    expect((await issue('B00002', 'student', ids.b!)).statusCode).toBe(201);
    const book = await find(parent, 'malgudi');
    expect(book).toMatchObject({ onShelf: 0, canReserve: true, nextBack: day(14), queue: 0 });
    // nobody is named
    expect(
      JSON.stringify(
        await call('GET', '/library/portal/catalogue?q=malgudi', undefined, parent).then((r) =>
          r.json(),
        ),
      ),
    ).not.toContain('Bina');
    const a = await reserve(parent, 'student', ids.a!, ids.malgudi!);
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ status: 'waiting', place: 1, title: 'Malgudi Days' });
    const t = await reserve(teacher, 'employee', ids.employee!, ids.malgudi!);
    expect(t.json()).toMatchObject({ status: 'waiting', place: 2 });
    expect((await reserve(parent, 'student', ids.a!, ids.malgudi!)).json().type).toBe(
      'library.reserved_already',
    );
    expect((await reserve(parent, 'student', ids.b!, ids.malgudi!)).json().type).toBe(
      'library.holding',
    );
    expect((await reserve(parent, 'student', ids.a!, ids.swami!)).json().type).toBe(
      'library.on_shelf',
    );
    expect((await reserve(parent, 'student', ids.a!, ids.atlas!)).json().type).toBe(
      'library.reference_only',
    );
    expect((await reserve(parent, 'employee', ids.employee!, ids.swami!)).statusCode).toBe(404);
    expect((await find(parent, 'malgudi')).queue).toBe(2);
    // the school allows one at a time: Swami out too, the teacher may not take a second
    await withMigrator((c) =>
      c.query(
        `INSERT INTO school_settings (school_id, key, value) VALUES ($1, 'library.reservations_per_borrower', '1'::jsonb)`,
        [school.id],
      ),
    );
    expect((await issue('B00003', 'employee', ids.employee!)).statusCode).toBe(201);
    expect((await reserve(teacher, 'employee', ids.employee!, ids.swami!)).json().type).toBe(
      'library.holding',
    );
    expect((await reserve(parent, 'student', ids.a!, ids.swami!)).json().type).toBe(
      'library.reservation_limit',
    );
    // others wait: Bina's book is not renewed
    expect(
      (await call('POST', '/library/loans/renew', { accessionNo: 'B00001' })).json().type,
    ).toBe('library.reserved');
  });

  it('a copy back: kept for the first in line, the desk told; issued to them only, collected', async () => {
    const back = await call('POST', '/library/desk/return', { accessionNos: ['B00001'] });
    expect(back.statusCode).toBe(201);
    expect(back.json().loans[0].hold).toMatchObject({
      borrower: 'Asha Reader',
      ref: `${s}-a`,
      until: day(3),
    });
    const asha = await mine(parent, 'student', ids.a!);
    expect(asha.reservations[0]).toMatchObject({
      status: 'ready',
      readyUntil: day(3),
      accessionNo: 'B00001',
    });
    const home = (await call('GET', '/library/portal/summary', undefined, parent)).json();
    expect(home.people[0].ready).toEqual([
      expect.objectContaining({ title: 'Malgudi Days', until: day(3) }),
    ]);
    expect(
      (
        await call(
          'GET',
          `/library/desk/book?accessionNo=B00001&for=issue&borrowerKind=student&borrowerId=${ids.b!}`,
        )
      ).json().problem,
    ).toMatch(/^Kept for Asha Reader .*, who reserved it, until /);
    expect(
      (
        await call(
          'GET',
          `/library/desk/book?accessionNo=B00001&for=issue&borrowerKind=student&borrowerId=${ids.a!}`,
        )
      ).json().problem,
    ).toBeNull();
    expect((await issue('B00001', 'student', ids.b!)).json().type).toBe('library.copy_held');
    expect((await issue('B00001', 'student', ids.a!)).statusCode).toBe(201);
    const after = await mine(parent, 'student', ids.a!);
    expect(after.reservations[0]).toMatchObject({ status: 'collected' });
    expect(after.now.map((x: { accessionNo: string }) => x.accessionNo)).toEqual(['B00001']);
  });

  it('a hold not collected lapses; the borrower and the library cancel; the library’s list', async () => {
    // B00002 comes back: kept for the teacher, who does not come
    const back = (await call('POST', '/library/desk/return', { accessionNos: ['B00002'] })).json();
    expect(back.loans[0].hold).toMatchObject({ borrower: 'Meena Iyer' });
    await withMigrator((c) =>
      c.query(
        `UPDATE library_reservations SET ready_until = CURRENT_DATE - 1 WHERE school_id = $1 AND status = 'ready'`,
        [school.id],
      ),
    );
    const t = await mine(teacher, 'employee', ids.employee!);
    expect(t.reservations[0]).toMatchObject({ status: 'lapsed' });
    expect(t.reservations[0].endReason).toMatch(/^Not collected by /);
    expect(await find(teacher, 'malgudi')).toMatchObject({ onShelf: 1, canReserve: false });
    // out again; the teacher reserves and cancels; then reserves and the library cancels
    expect((await issue('B00002', 'student', ids.b!)).statusCode).toBe(201);
    await withMigrator((c) =>
      c.query(
        `DELETE FROM school_settings WHERE school_id = $1 AND key = 'library.reservations_per_borrower'`,
        [school.id],
      ),
    );
    const r1 = (await reserve(teacher, 'employee', ids.employee!, ids.malgudi!)).json();
    expect(r1).toMatchObject({ status: 'waiting', place: 1 });
    expect(
      (
        await call(
          'POST',
          `/library/portal/reservations/${r1.id as string}/cancel`,
          undefined,
          parent,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          'POST',
          `/library/portal/reservations/${r1.id as string}/cancel`,
          undefined,
          teacher,
        )
      ).json(),
    ).toMatchObject({ status: 'cancelled' });
    const r2 = (await reserve(teacher, 'employee', ids.employee!, ids.malgudi!)).json();
    const open = (await call('GET', '/library/reservations?status=open')).json();
    expect(open.counts).toEqual({ waiting: 1, ready: 0 });
    expect(open.rows).toEqual([
      expect.objectContaining({
        id: r2.id,
        borrower: 'Meena Iyer',
        title: 'Malgudi Days',
        place: 1,
      }),
    ]);
    expect(
      (await call('POST', `/library/reservations/${r2.id as string}/cancel`, { reason: 'x' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/library/reservations/${r2.id as string}/cancel`, {
          reason: 'Book withdrawn soon',
        })
      ).json(),
    ).toMatchObject({ status: 'cancelled' });
    const ended = (await call('GET', '/library/reservations?status=ended')).json().rows;
    expect(ended.map((x: { status: string }) => x.status).sort()).toEqual([
      'cancelled',
      'cancelled',
      'collected',
      'lapsed',
    ]);
    expect((await call('GET', '/library/reservations', undefined, parent)).statusCode).toBe(403);
  });

  it('my library: figures and the history filtered, paged and as Excel; only my own borrowers', async () => {
    const get = (kind: string, who: string, q: string, u: SeededUser) =>
      call('GET', `/library/portal/borrowers/${kind}/${who}/history?${q}`, undefined, u);
    // every child of the family with any loan: all = out + returned
    let tested = 0;
    for (const who of [ids.a!, ids.b!]) {
      const all = (await get('student', who, 'status=all', parent)).json();
      expect(all.stats.months).toHaveLength(6);
      expect(all.borrower.id).toBe(who);
      if (!all.total) continue;
      tested += 1;
      const out = (await get('student', who, 'status=out', parent)).json();
      const back = (await get('student', who, 'status=returned', parent)).json();
      expect(out.total + back.total).toBe(all.total);
      expect(all.stats.readEver).toBe(all.total);
      expect(all.stats.holding).toBe(out.total);
      // a search narrows, a date range in the past finds nothing
      expect((await get('student', who, 'q=malgudi', parent)).json().total).toBeLessThanOrEqual(
        all.total,
      );
      expect(
        (await get('student', who, 'from=2001-01-01&to=2001-12-31', parent)).json().total,
      ).toBe(0);
      const x = await get('student', who, 'status=all&format=xlsx', parent);
      expect(
        (
          await call(
            'GET',
            `/library/portal/borrowers/student/${who}/history/export?format=xlsx`,
            undefined,
            parent,
          )
        ).json(),
      ).toMatchObject({ contentType: expect.stringContaining('spreadsheet') });
      expect(x.statusCode).toBe(200);
    }
    expect(tested).toBeGreaterThan(0);
    // the staff member sees their own; the parent may not open a staff member's
    const mineStaff = await get('employee', ids.employee!, 'status=all', teacher);
    expect(mineStaff.statusCode).toBe(200);
    expect((await get('employee', ids.employee!, 'status=all', parent)).statusCode).toBe(404);
    expect(
      (
        await call(
          'GET',
          `/library/portal/borrowers/employee/${ids.employee!}/history/export?format=pdf`,
          undefined,
          teacher,
        )
      ).json(),
    ).toMatchObject({ contentType: 'application/pdf' });
  });
});
