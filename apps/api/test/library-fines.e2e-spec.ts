/**
 * Late fines at the fees counter and the Fines page (0217, docs/design/36-library.md, "Library reports",
 * part 1): a late return announces its fine as a misc fee at once; a fine waived at the desk needs its
 * reason and is kept with who and when; a fine at the counter is waived through the fees office; old
 * fines (before 0217) are sent to the counter or waived; the tabs outstanding, collected and waived by
 * day, borrower and search, with totals; the tab and the lost and damaged charges as Excel or PDF.
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

describe('library fines at the fees counter (e2e)', () => {
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
  const s = stamp('LFN');
  const ids: Record<string, string> = {};
  const issue = (acc: string, kind: 'student' | 'employee', who: string) =>
    call('POST', '/library/loans/issue', { accessionNo: acc, borrowerKind: kind, borrowerId: who });
  /** The open loan of a copy made due `days` ago. */
  const late = (acc: string, days = 10) =>
    withMigrator((c) =>
      c.query(
        `UPDATE library_loans SET issued_on = CURRENT_DATE - $3::int - 14, due_on = CURRENT_DATE - $3::int
          WHERE returned_on IS NULL AND copy_id = (SELECT id FROM library_copies WHERE school_id = $1 AND accession_no = $2)`,
        [school.id, acc, days],
      ),
    );
  const tab = async (name: string, query = '') =>
    (await call('GET', `/library/fines/report?tab=${name}${query}`)).json() as {
      rows: Array<Record<string, unknown>>;
      total: number;
      totals: { rows: number; amount: number };
    };
  const linesOf = async (kind: 'student' | 'employee', id: string) =>
    (await call('GET', `/fees/misc-fees/${kind}/${id}`, undefined, accountant)).json()
      .lines as Array<{ id: string; title: string; balance: string }>;
  const pay = (who: Record<string, string>, lineId: string, amount: number) =>
    call(
      'POST',
      '/fees/misc-fees/collect',
      { ...who, lines: [{ lineId, amount }], mode: 'upi' },
      accountant,
    );

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
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
    const sec = await call(
      'POST',
      `/academics/classes/${ids.classId}/sections`,
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
            guardian: { firstName: 'Ravi', lastName: 'Reader', mobile: '9876517501' },
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
        count: 8,
        accessionedOn: '2026-01-10',
        price: 300,
      },
    });
    expect(r.json().accessionNos).toHaveLength(8);
    // staff are fined ₹1 a day here (a new school's staff rule has no fine)
    await withMigrator((c) =>
      c.query(
        `UPDATE library_borrow_rules SET fine_per_day = 1 WHERE school_id = $1 AND applies_to = 'Employee'`,
        [school.id],
      ),
    );
  });
  afterAll(async () => app.close());

  it('a late return: its fine announced as a misc fee at once; the library takes no fine money', async () => {
    expect((await issue('B00001', 'student', ids.pupil!)).statusCode).toBe(201);
    await late('B00001');
    const ret = await call('POST', '/library/loans/return', { accessionNo: 'B00001' });
    expect(ret.statusCode).toBe(201);
    // the Student rule of a new school: ₹2 a day, no grace days
    expect(ret.json()).toMatchObject({ fineAmount: '20.00', fineWaived: '0.00' });
    const line = (await linesOf('student', ids.pupil!)).find((l) =>
      l.title.startsWith('Late fine'),
    )!;
    expect(line).toMatchObject({ title: 'Late fine: Malgudi Days (B00001)', balance: '20.00' });
    // no more books until it is paid at the counter
    expect((await issue('B00002', 'student', ids.pupil!)).json().type).toBe('library.charge_due');
    const collect = await call('POST', `/library/loans/${ret.json().id as string}/fine`, {
      action: 'collect',
      reference: 'R-1',
    });
    expect(collect.json().type).toBe('library.fines_at_counter');
    const out = await tab('outstanding');
    expect(out.rows).toEqual([
      expect.objectContaining({
        day: day(0),
        borrower: 'Asha Reader',
        ref: `${s}-1`,
        place: 'Class VI-A',
        accessionNo: 'B00001',
        dueOn: day(-10),
        daysLate: 10,
        fine: 20,
        due: 20,
        how: 'counter',
        state: 'Due at the fees counter',
      }),
    ]);
    expect(out.totals).toEqual({ rows: 1, amount: 20 });
    // the late fine is not on the lost and damaged charges list
    expect((await call('GET', '/library/charges?status=all')).json().rows).toEqual([]);
    expect(
      (await call('GET', '/library/fines/report?tab=outstanding', undefined, coordinator))
        .statusCode,
    ).toBe(403);
    // paid at the counter: collected, with the receipt
    expect((await pay({ studentId: ids.pupil! }, line.id, 20)).statusCode).toBe(201);
    expect((await tab('outstanding')).rows).toEqual([]);
    const got = await tab('collected');
    expect(got.rows).toEqual([
      expect.objectContaining({
        day: day(0),
        accessionNo: 'B00001',
        amount: 20,
        mode: 'upi',
        how: 'counter',
        state: 'Paid at the fees counter',
      }),
    ]);
    expect(got.rows[0]!.receiptNo).toBeTruthy();
    expect(got.totals).toEqual({ rows: 1, amount: 20 });
  });

  it('waived at the desk: the reason is needed, who and when are kept; nothing goes to the counter', async () => {
    expect((await issue('B00002', 'student', ids.pupil!)).statusCode).toBe(201);
    await late('B00002', 5);
    const noWhy = await call('POST', '/library/loans/return', {
      accessionNo: 'B00002',
      waiveFine: true,
    });
    expect(noWhy.statusCode).toBe(400);
    expect(noWhy.json().detail).toBe('Say why the fine is waived');
    const ok = await call('POST', '/library/loans/return', {
      accessionNo: 'B00002',
      waiveFine: true,
      waiveReason: 'Was in hospital',
    });
    expect(ok.json()).toMatchObject({ fineAmount: '10.00', fineWaived: '10.00' });
    expect((await linesOf('student', ids.pupil!)).map((l) => l.title)).not.toContain(
      'Late fine: Malgudi Days (B00002)',
    );
    const w = await tab('waived');
    expect(w.rows).toEqual([
      expect.objectContaining({
        day: day(0),
        accessionNo: 'B00002',
        fine: 10,
        amount: 10,
        reason: 'Was in hospital',
        how: 'library',
        state: 'Waived at the library',
      }),
    ]);
    expect(w.rows[0]!.by).toBeTruthy();
  });

  it('a fine at the counter waived in part through the fees office', async () => {
    expect((await issue('B00003', 'employee', ids.employee!)).statusCode).toBe(201);
    await late('B00003', 8);
    const ret = await call('POST', '/library/loans/return', { accessionNo: 'B00003' });
    const fine = Number(ret.json().fineAmount);
    expect(fine).toBeGreaterThan(5);
    const row = (await tab('outstanding', '&borrower=employee')).rows[0]!;
    expect(row).toMatchObject({ borrower: 'Meena Iyer', place: 'TGT English', due: fine });
    const noWhy = await call('POST', `/library/charges/${row.chargeId as string}/waive-request`, {
      amount: 5,
    });
    expect(noWhy.statusCode).toBe(400);
    const ask = await call('POST', `/library/charges/${row.chargeId as string}/waive-request`, {
      amount: 5,
      reason: 'Away on election duty',
    });
    expect(ask.statusCode).toBe(201);
    expect(ask.json()).toMatchObject({ waive: 5 });
    expect((await tab('outstanding', '&borrower=employee')).rows[0]).toMatchObject({
      state: 'The fees office is deciding a waiver',
    });
    expect(
      (
        await call('POST', `/library/charges/${row.chargeId as string}/waive-request`, {
          reason: 'Again',
        })
      ).json().type,
    ).toBe('misc.request_open');
    const decided = await call(
      'POST',
      `/fees/misc-fees/requests/${ask.json().requestId as string}/decide`,
      { outcome: 'approved' },
      admin,
    );
    expect(decided.statusCode).toBe(200);
    expect((await tab('outstanding', '&borrower=employee')).rows[0]).toMatchObject({
      due: fine - 5,
      state: 'Due at the fees counter',
    });
    const w = (await tab('waived', '&borrower=employee')).rows;
    expect(w).toEqual([
      expect.objectContaining({
        accessionNo: 'B00003',
        amount: 5,
        reason: 'Away on election duty',
        how: 'counter',
        state: 'Waived by the fees office',
      }),
    ]);
  });

  it('old fines (before 0217): sent to the counter, waived at the library, or collected there once', async () => {
    // three books returned the old way: their fines left at the library
    for (const acc of ['B00004', 'B00005', 'B00006']) {
      expect((await issue(acc, 'student', ids.pupil!)).statusCode).toBe(201);
      expect((await call('POST', '/library/loans/return', { accessionNo: acc })).statusCode).toBe(
        201,
      );
    }
    await withMigrator((c) =>
      c.query(
        `UPDATE library_loans l SET fine_amount = 30, due_on = l.returned_on - 15,
                fine_paid_on = CASE WHEN x.accession_no = 'B00006' THEN l.returned_on END,
                note = CASE WHEN x.accession_no = 'B00006' THEN 'paid · R-OLD-9' END
           FROM library_copies x WHERE x.id = l.copy_id AND l.school_id = $1 AND x.accession_no IN ('B00004', 'B00005', 'B00006')`,
        [school.id],
      ),
    );
    const out = (await tab('outstanding', '&borrower=student')).rows;
    expect(out.map((r) => [r.accessionNo, r.how, r.state])).toEqual([
      ['B00005', 'library', 'Not sent to the fees counter (an old fine)'],
      ['B00004', 'library', 'Not sent to the fees counter (an old fine)'],
    ]);
    // an old fine stops issues as before
    expect((await issue('B00007', 'student', ids.pupil!)).json().type).toBe('library.fine_pending');
    const b4 = out.find((r) => r.accessionNo === 'B00004')!;
    const b5 = out.find((r) => r.accessionNo === 'B00005')!;
    expect(
      (
        await call('POST', `/library/loans/${b4.loanId as string}/fine`, {
          action: 'waive',
          note: 'x',
        })
      ).statusCode,
    ).toBe(400);
    const waived = await call('POST', `/library/loans/${b4.loanId as string}/fine`, {
      action: 'waive',
      note: 'Book came back the day after the holidays',
    });
    expect(waived.json()).toMatchObject({ fineWaived: '30.00' });
    const sent = await call('POST', '/library/fines/send', { loanIds: [b5.loanId] });
    expect(sent.json()).toEqual({ sent: 1, total: 30 });
    expect((await call('POST', '/library/fines/send', {})).json()).toEqual({ sent: 0, total: 0 });
    expect(
      (await linesOf('student', ids.pupil!)).find(
        (l) => l.title === 'Late fine: Malgudi Days (B00005)',
      ),
    ).toMatchObject({ balance: '30.00' });
    // now at the counter: the library may not waive it itself
    expect(
      (
        await call('POST', `/library/loans/${b5.loanId as string}/fine`, {
          action: 'waive',
          note: 'Book came back late',
        })
      ).json().type,
    ).toBe('library.fines_at_counter');
    expect((await issue('B00007', 'student', ids.pupil!)).json().type).toBe('library.charge_due');
    const got = (await tab('collected', '&q=B00006')).rows;
    expect(got).toEqual([
      expect.objectContaining({
        accessionNo: 'B00006',
        amount: 30,
        receiptNo: 'R-OLD-9',
        how: 'library',
        state: 'Collected at the library (an old fine)',
      }),
    ]);
  });

  it('the tabs by day and search; each tab and the charges as Excel or PDF', async () => {
    expect((await tab('collected', `&from=${day(1)}`)).rows).toEqual([]);
    expect((await tab('collected', `&from=${day(0)}&to=${day(0)}`)).total).toBe(2);
    expect((await tab('waived', '&q=Meena')).total).toBe(1);
    expect((await tab('waived', '&q=Asha')).total).toBe(2);
    expect((await tab('waived', `&classId=${ids.classId!}`)).total).toBe(2);
    expect((await call('GET', '/library/fines/report?tab=waived&from=22-10-2026')).statusCode).toBe(
      400,
    );
    const x = await call('GET', '/library/fines/export?tab=waived&format=xlsx');
    expect(x.statusCode).toBe(200);
    expect(x.json()).toMatchObject({
      filename: `Library-fines-waived-${day(0)}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rows: 3,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe('Waived on');
    expect(ws.getRow(1).getCell(8).value).toBe('Reason');
    // three rows and the totals: ₹10 + ₹5 + ₹30
    expect(ws.rowCount).toBe(5);
    expect(ws.getRow(5).getCell(7).value).toBe(45);
    expect(wb.getWorksheet('About this report')!.getRow(5).getCell(2).value).toBe('3');
    const pdf = await call('GET', '/library/fines/export?tab=outstanding&format=pdf');
    expect(pdf.json().filename).toBe(`Library-fines-outstanding-${day(0)}.pdf`);
    expect(
      Buffer.from(pdf.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    // the lost and damaged charges, by the day paid, and their file (the staff member's fine paid first)
    const owed = (await linesOf('employee', ids.employee!)).find((l) =>
      l.title.startsWith('Late fine'),
    )!;
    expect(
      (await pay({ employeeId: ids.employee! }, owed.id, Number(owed.balance))).statusCode,
    ).toBe(201);
    expect((await issue('B00008', 'employee', ids.employee!)).statusCode).toBe(201);
    const charged = await call('POST', '/library/charges', { accessionNo: 'B00008', kind: 'lost' });
    expect(charged.statusCode).toBe(201);
    const line = (await linesOf('employee', ids.employee!)).find((l) =>
      l.title.startsWith('Lost book'),
    )!;
    expect(
      (await pay({ employeeId: ids.employee! }, line.id, Number(line.balance))).statusCode,
    ).toBe(201);
    const paid = (
      await call('GET', `/library/charges?status=paid&from=${day(0)}&to=${day(0)}`)
    ).json();
    expect(paid.rows).toEqual([
      expect.objectContaining({ accessionNo: 'B00008', state: 'paid', paidOn: day(0) }),
    ]);
    expect(paid.totals).toMatchObject({ paid: Number(line.balance), due: 0 });
    expect((await call('GET', `/library/charges?status=paid&from=${day(1)}`)).json().rows).toEqual(
      [],
    );
    const cx = (await call('GET', '/library/charges/export?status=paid&format=xlsx')).json();
    expect(cx).toMatchObject({ filename: `Library-charges-paid-${day(0)}.xlsx`, rows: 1 });
    const cwb = new ExcelJS.Workbook();
    await cwb.xlsx.load(Buffer.from(cx.base64 as string, 'base64') as unknown as ArrayBuffer);
    expect(cwb.worksheets[0]!.getRow(2).getCell(14).value).toBeTruthy();
    const cp = (await call('GET', '/library/charges/export?status=all&format=pdf')).json();
    expect(cp.filename).toBe(`Library-charges-all-${day(0)}.pdf`);
  });
});
