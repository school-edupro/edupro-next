/**
 * Lost and damaged books charged to the pupil (0215, docs/design/36-library.md, part 3 of the register
 * work): the charge worked out (price, processing fee, late fine; a share of the price for damage), a
 * changed amount needing its reason, the misc fee announced at once, new issues stopped until the fees
 * counter takes it, a lost book found again bringing the charge down through the fees office, the old
 * ways of marking a pupil's book lost pointing here, staff left for misc fees for staff.
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

describe('library lost and damaged charges (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let librarian: SeededUser;
  let accountant: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? librarian).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const day = (n: number) =>
    new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  const s = stamp('LCH');
  const ids: Record<string, string> = {};
  const issue = (acc: string, kind: 'student' | 'employee', who: string) =>
    call('POST', '/library/loans/issue', { accessionNo: acc, borrowerKind: kind, borrowerId: who });
  /** The loan of a copy made 25 days old, due 10 days ago. */
  const late = (acc: string) =>
    withMigrator((c) =>
      c.query(
        `UPDATE library_loans SET issued_on = CURRENT_DATE - 25, due_on = CURRENT_DATE - 10
          WHERE returned_on IS NULL AND copy_id = (SELECT id FROM library_copies WHERE school_id = $1 AND accession_no = $2)`,
        [school.id, acc],
      ),
    );
  const charges = async (status = 'all') =>
    (await call('GET', `/library/charges?status=${status}`)).json() as {
      rows: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, employee_type)
           VALUES ($1, $2, 'Meena', 'teaching') RETURNING id::text`,
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
            guardian: { firstName: 'Ravi', lastName: 'Reader', mobile: '9876517301' },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
      admin,
    );
    expect(st.statusCode).toBe(201);
    ids.pupil = st.json().id as string;
    const setup = (await call('GET', '/library/books/setup')).json();
    const r = await call('POST', '/library/books', {
      title: 'Malgudi Days',
      people: [{ name: 'R. K. Narayan' }],
      materialTypeId: setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id,
      copies: {
        libraryId: setup.libraries[0].id,
        count: 6,
        accessionedOn: '2026-01-10',
        price: 300,
      },
    });
    expect(r.json().accessionNos).toEqual([
      'B00001',
      'B00002',
      'B00003',
      'B00004',
      'B00005',
      'B00006',
    ]);
  });
  afterAll(async () => app.close());

  it('a lost book: the charge worked out, a changed amount needs its reason, the misc fee announced at once', async () => {
    expect((await issue('B00001', 'student', ids.pupil!)).statusCode).toBe(201);
    await late('B00001');
    const p = await call('GET', '/library/charges/preview?accessionNo=B00001&kind=lost');
    expect(p.statusCode).toBe(200);
    // the Student rule of a new school: ₹2 a day, no grace days
    expect(p.json()).toMatchObject({
      borrower: 'Asha Reader',
      price: 300,
      processingFee: 50,
      lateFine: 20,
      daysLate: 10,
      suggested: 370,
      canCharge: true,
    });
    expect(
      (
        await call(
          'GET',
          '/library/charges/preview?accessionNo=B00001&kind=lost',
          undefined,
          coordinator,
        )
      ).statusCode,
    ).toBe(403);
    const noReason = await call('POST', '/library/charges', {
      accessionNo: 'B00001',
      kind: 'lost',
      amount: 350,
    });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().detail).toContain('give the reason');
    const ok = await call('POST', '/library/charges', {
      accessionNo: 'B00001',
      kind: 'lost',
      amount: 350,
      reason: 'Late fine left out: the pupil reported it at once',
    });
    expect(ok.statusCode).toBe(201);
    const fee = (
      await call('GET', `/fees/misc-fees/${ok.json().miscFeeId as string}`, undefined, admin)
    ).json();
    expect(fee.fee).toMatchObject({
      status: 'announced',
      amount: '350.00',
      mandatory: true,
      title: 'Lost book: Malgudi Days (B00001)',
      head: 'Library: lost or damaged book',
    });
    expect(fee.lines).toEqual([
      expect.objectContaining({ student: 'Asha Reader', balance: '350.00' }),
    ]);
    // the copy is lost, the loan closed without a library fine
    const loans = (await call('GET', '/library/loans?status=returned&size=10')).json().data;
    expect(loans[0]).toMatchObject({ accessionNo: 'B00001', fineAmount: '0.00' });
    const list = await charges('due');
    expect(list.counts).toMatchObject({ due: 1, dueAmount: 350 });
    expect(list.rows[0]).toMatchObject({
      kind: 'lost',
      state: 'due',
      due: 350,
      price: 300,
      lateFine: 20,
    });
  });

  it('an unpaid charge stops new issues until the fees counter takes it', async () => {
    const stopped = await issue('B00002', 'student', ids.pupil!);
    expect(stopped.statusCode).toBe(409);
    expect(stopped.json().type).toBe('library.charge_due');
    const line = (
      (await call('GET', `/fees/misc-fees/student/${ids.pupil!}`, undefined, accountant)).json()
        .lines as Array<{ id: string; title: string }>
    ).find((l) => l.title.startsWith('Lost book'))!;
    const paid = await call(
      'POST',
      '/fees/misc-fees/collect',
      { studentId: ids.pupil, lines: [{ lineId: line.id, amount: 350 }], mode: 'cash' },
      accountant,
    );
    expect(paid.statusCode).toBe(201);
    expect((await charges('paid')).rows[0]).toMatchObject({ state: 'paid', due: 0, paid: 350 });
    expect((await issue('B00002', 'student', ids.pupil!)).statusCode).toBe(201);
  });

  it('a damaged book: a share of the price suggested, what is damaged said; the late fine stays a library fine', async () => {
    await late('B00002');
    const p = (
      await call('GET', '/library/charges/preview?accessionNo=B00002&kind=damaged')
    ).json();
    expect(p).toMatchObject({ suggested: 75, sharePct: 25, processingFee: 0 });
    expect(
      (await call('POST', '/library/charges', { accessionNo: 'B00002', kind: 'damaged' }))
        .statusCode,
    ).toBe(400);
    const r = await call('POST', '/library/charges', {
      accessionNo: 'B00002',
      kind: 'damaged',
      reason: 'Cover torn, pages 40–60 wet',
    });
    expect(r.json()).toMatchObject({ amount: 75 });
    const loans = (await call('GET', '/library/loans?status=fines&size=10')).json().data;
    expect(loans[0]).toMatchObject({ accessionNo: 'B00002', fineAmount: '20.00' });
    expect((await charges('due')).rows[0]).toMatchObject({ kind: 'damaged', due: 75 });
  });

  it('a lost book found again before it is paid: the fees office brings the charge down to the late fine', async () => {
    // pay what is due first so the pupil may borrow again
    const due = (
      await call('GET', `/fees/misc-fees/student/${ids.pupil!}`, undefined, accountant)
    ).json().lines as Array<{ id: string; title: string; balance: string }>;
    const dmg = due.find((l) => l.title.startsWith('Damaged book'))!;
    await call(
      'POST',
      '/fees/misc-fees/collect',
      { studentId: ids.pupil, lines: [{ lineId: dmg.id, amount: 75 }], mode: 'cash' },
      accountant,
    );
    const loan = (await call('GET', '/library/loans?status=fines&size=10')).json().data[0];
    await call('POST', `/library/loans/${loan.id as string}/fine`, {
      action: 'collect',
      reference: 'R-1',
    });
    expect((await issue('B00003', 'student', ids.pupil!)).statusCode).toBe(201);
    await late('B00003');
    expect(
      (await call('POST', '/library/charges', { accessionNo: 'B00003', kind: 'lost' })).json(),
    ).toMatchObject({
      amount: 370,
    });
    const copy = (
      await withMigrator((c) =>
        c.query<{ id: string; title_id: string }>(
          `SELECT id::text, title_id::text FROM library_copies WHERE school_id = $1 AND accession_no = 'B00003'`,
          [school.id],
        ),
      )
    ).rows[0]!;
    const found = await call('POST', `/library/copies/${copy.id}/status`, {
      status: 'found',
      on: day(0),
      reason: 'Found behind the shelf',
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().charge).toBe(
      'The charge comes down to ₹20.00 once the fees office approves',
    );
    const row = (await charges('due')).rows.find((x) => x.accessionNo === 'B00003')!;
    expect(row).toMatchObject({ state: 'found_pending', due: 370 });
    const reqs = (
      await call('GET', '/fees/misc-fees/requests?status=pending', undefined, admin)
    ).json() as Array<{
      id: string;
      kind: string;
    }>;
    const req = reqs.find((x) => x.kind === 'pupil_change')!;
    expect(
      (
        await call(
          'POST',
          `/fees/misc-fees/requests/${req.id}/decide`,
          { outcome: 'approved' },
          admin,
        )
      ).statusCode,
    ).toBe(200);
    expect((await charges('due')).rows.find((x) => x.accessionNo === 'B00003')).toMatchObject({
      state: 'due',
      due: 20,
      charged: 370,
    });
  });

  it('the old ways of marking a pupil’s book lost point here; staff wait for misc fees for staff', async () => {
    // the pupil owes ₹20: issue to staff instead
    expect((await issue('B00004', 'employee', ids.employee!)).statusCode).toBe(201);
    const staff = await call('GET', '/library/charges/preview?accessionNo=B00004&kind=lost');
    expect(staff.json().canCharge).toBe(false);
    expect(
      (await call('POST', '/library/charges', { accessionNo: 'B00004', kind: 'lost' })).json().type,
    ).toBe('library.staff_charge');
    await withMigrator((c) =>
      c.query(
        `UPDATE library_loans SET borrower_kind = 'student', borrower_id = $2
          WHERE returned_on IS NULL AND copy_id = (SELECT id FROM library_copies WHERE school_id = $1 AND accession_no = 'B00004')`,
        [school.id, ids.pupil],
      ),
    );
    const ret = await call('POST', '/library/loans/return', {
      accessionNo: 'B00004',
      condition: 'lost',
    });
    expect(ret.json().type).toBe('library.use_charges');
    const copy = (
      await withMigrator((c) =>
        c.query<{ id: string }>(
          `SELECT id::text FROM library_copies WHERE school_id = $1 AND accession_no = 'B00004'`,
          [school.id],
        ),
      )
    ).rows[0]!;
    const mark = await call('POST', `/library/copies/${copy.id}/status`, {
      status: 'lost',
      on: day(0),
      reason: 'Not returned',
    });
    expect(mark.statusCode).toBe(409);
    expect(mark.json().detail).toContain('Lost and damaged books');
    expect(
      (await call('GET', '/library/charges/preview?accessionNo=B00006&kind=lost')).json().type,
    ).toBe('library.not_on_loan');
  });
});
