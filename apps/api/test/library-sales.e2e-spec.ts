/**
 * Books sold (0220, docs/design/36-library.md, "Library reports", part 4): a sale is one buyer and one or
 * more books, numbered LS-0001 on; a pupil or a staff member owes it as a misc fee announced at once (paid
 * at the fees counter); someone outside pays on a numbered misc receipt the library prints; only books on
 * the shelf, damaged or withdrawn are sold; a file of sales is checked first, its good rows sold one sale
 * a buyer; the sales between two days with what is paid, as Excel or PDF.
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

describe('library book sales (e2e)', () => {
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
  const s = stamp('LSL');
  const ids: Record<string, string> = {};
  const sell = (json: Record<string, unknown>) => call('POST', '/library/sales', json);
  const report = async (query = '') =>
    (await call('GET', `/library/sales?${query}`)).json() as {
      rows: Array<Record<string, unknown>>;
      total: number;
      totals: Record<string, number>;
    };
  const upload = (fileName: string, body: Buffer) =>
    inject({
      method: 'POST',
      url: `/library/sales/uploads?fileName=${encodeURIComponent(fileName)}`,
      headers: h(),
      raw: { contentType: 'application/octet-stream', body },
    });

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
            guardian: { firstName: 'Ravi', lastName: 'Reader', mobile: '9876517701' },
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
        count: 14,
        accessionedOn: '2026-01-10',
        price: 300,
      },
    });
    expect(r.json().accessionNos).toHaveLength(14);
    ids.title = r.json().id as string;
    // B00004 damaged, B00006 withdrawn, B00005 on loan
    await withMigrator((c) =>
      c.query(
        `UPDATE library_copies SET status = CASE accession_no WHEN 'B00004' THEN 'damaged' ELSE 'withdrawn' END::library_copy_status
          WHERE school_id = $1 AND accession_no IN ('B00004', 'B00006')`,
        [school.id],
      ),
    );
    expect(
      (
        await call('POST', '/library/loans/issue', {
          accessionNo: 'B00005',
          borrowerKind: 'student',
          borrowerId: ids.pupil,
        })
      ).statusCode,
    ).toBe(201);
  });
  afterAll(async () => app.close());

  it('a book at the sale desk: can it be sold, its price as bought', async () => {
    expect((await call('GET', '/library/sales/book?accessionNo=b00001')).json()).toMatchObject({
      canSell: true,
      problem: null,
      copy: { accessionNo: 'B00001', title: 'Malgudi Days', status: 'available', price: 300 },
    });
    expect((await call('GET', '/library/sales/book?accessionNo=B00005')).json()).toMatchObject({
      canSell: false,
      problem: 'It is on loan: return it first',
    });
    expect((await call('GET', '/library/sales/book?accessionNo=NOPE')).json()).toMatchObject({
      canSell: false,
      problem: 'No such book',
    });
    expect(
      (await call('GET', '/library/sales/book?accessionNo=B00001', undefined, coordinator))
        .statusCode,
    ).toBe(403);
  });

  it('a pupil buys two books: one sale, a misc fee at once, the copies sold', async () => {
    const r = await sell({
      buyerKind: 'student',
      buyerId: ids.pupil,
      books: [
        { accessionNo: 'B00001', price: 120 },
        { accessionNo: 'B00002', price: 100 },
      ],
      note: 'Old edition',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      saleNo: 'LS-0001',
      soldOn: day(0),
      buyer: { kind: 'student', name: 'Asha Reader', ref: `${s}-1` },
      total: 220,
      state: 'due',
      due: 220,
      receipt: null,
      books: [
        expect.objectContaining({
          accessionNo: 'B00001',
          price: 120,
          copyPrice: 300,
          fromStatus: 'available',
        }),
        expect.objectContaining({ accessionNo: 'B00002', price: 100 }),
      ],
    });
    ids.sale1 = r.json().id as string;
    const lines = (
      await call('GET', `/fees/misc-fees/student/${ids.pupil!}`, undefined, accountant)
    ).json().lines as Array<{ id: string; title: string; balance: string }>;
    const line = lines.find((l) => l.title === 'Books bought: 2 books (LS-0001)')!;
    expect(line).toMatchObject({ balance: '220.00' });
    const book = (await call('GET', `/library/books/${ids.title!}`)).json();
    expect(
      book.copies.find((c: { accessionNo: string }) => c.accessionNo === 'B00001'),
    ).toMatchObject({
      status: 'sold',
      statusReason: `Sold to Asha Reader (${s}-1), LS-0001`,
    });
    // a sold book cannot be sold again; nor one on loan
    expect(
      (
        await sell({
          buyerKind: 'student',
          buyerId: ids.pupil,
          books: [{ accessionNo: 'B00001', price: 1 }],
        })
      ).json().type,
    ).toBe('library.cannot_sell');
    expect(
      (
        await sell({
          buyerKind: 'student',
          buyerId: ids.pupil,
          books: [{ accessionNo: 'B00005', price: 1 }],
        })
      ).json().detail,
    ).toBe('B00005: It is on loan: return it first');
    // paid at the fees counter
    expect(
      (
        await call(
          'POST',
          '/fees/misc-fees/collect',
          { studentId: ids.pupil, lines: [{ lineId: line.id, amount: 220 }], mode: 'cash' },
          accountant,
        )
      ).statusCode,
    ).toBe(201);
    expect((await call('GET', `/library/sales/orders/${ids.sale1}`)).json()).toMatchObject({
      state: 'paid',
      paid: 220,
      due: 0,
    });
  });

  it('a staff member buys a damaged book: a misc fee on them', async () => {
    const r = await sell({
      buyerKind: 'employee',
      buyerId: ids.employee,
      books: [{ accessionNo: 'B00004', price: 50 }],
    });
    expect(r.json()).toMatchObject({ saleNo: 'LS-0002', state: 'due', buyer: { ref: `${s}-E1` } });
    const lines = (
      await call('GET', `/fees/misc-fees/employee/${ids.employee!}`, undefined, accountant)
    ).json().lines as Array<{ title: string; balance: string }>;
    expect(lines).toEqual([
      expect.objectContaining({ title: 'Book bought: Malgudi Days (B00004)', balance: '50.00' }),
    ]);
  });

  it('someone outside pays on a misc receipt the library prints; a book given free has none', async () => {
    expect(
      (
        await sell({
          buyerKind: 'other',
          buyerName: 'City Book Bank',
          books: [{ accessionNo: 'B00006', price: 10 }],
        })
      ).json().detail,
    ).toBe('Say how the buyer paid');
    expect(
      (await sell({ buyerKind: 'other', books: [{ accessionNo: 'B00006', price: 10 }] }))
        .statusCode,
    ).toBe(400);
    const r = await sell({
      buyerKind: 'other',
      buyerName: 'City Book Bank',
      buyerMobile: '9876543210',
      books: [
        { accessionNo: 'B00006', price: 10 },
        { accessionNo: 'B00007', price: 15 },
      ],
      mode: 'upi',
      reference: 'UPI-778',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      saleNo: 'LS-0003',
      total: 25,
      state: 'paid',
      paid: 25,
      mode: 'upi',
      buyer: { kind: 'other', name: 'City Book Bank', mobile: '9876543210' },
    });
    expect(r.json().receipt.receiptNo).toBeTruthy();
    ids.sale3 = r.json().id as string;
    const view = (await call('GET', `/library/sales/orders/${ids.sale3}/receipt`)).json();
    expect(view).toMatchObject({
      amount: '25.00',
      mode: 'UPI',
      student: { name: 'City Book Bank', kind: 'other' },
      mobiles: '9876543210',
      lines: [expect.objectContaining({ head: 'Library: book sale' })],
    });
    // the fees office sees it among the misc receipts
    const receipts = (
      await call('GET', '/fees/misc/receipts?payerKind=other', undefined, accountant)
    ).json();
    expect(JSON.stringify(receipts)).toContain('City Book Bank');
    const free = await sell({
      buyerKind: 'other',
      buyerName: 'Book drive',
      books: [{ accessionNo: 'B00008', price: 0 }],
    });
    expect(free.json()).toMatchObject({
      saleNo: 'LS-0004',
      total: 0,
      state: 'free',
      receipt: null,
    });
    expect(
      (await call('GET', `/library/sales/orders/${free.json().id as string}/receipt`)).statusCode,
    ).toBe(404);
  });

  it('the sales between two days, by buyer and payment; Excel and PDF', async () => {
    const all = await report();
    expect(all.total).toBe(6);
    expect(all.totals).toEqual({ books: 6, amount: 295, paid: 245, due: 50 });
    expect((await report('buyer=other')).rows.map((r) => r.accessionNo).sort()).toEqual([
      'B00006',
      'B00007',
      'B00008',
    ]);
    expect((await report('state=due')).rows).toEqual([
      expect.objectContaining({
        accessionNo: 'B00004',
        buyer: 'Meena Iyer',
        buyerRef: `${s}-E1`,
        fromStatus: 'damaged',
      }),
    ]);
    expect((await report('q=LS-0001')).total).toBe(2);
    expect((await report(`q=${s}-1`)).total).toBe(2);
    expect((await report(`from=${day(1)}`)).total).toBe(0);
    const x = (await call('GET', '/library/sales/export?format=xlsx')).json();
    expect(x).toMatchObject({ filename: `Library-books-sold-${day(0)}.xlsx`, rows: 6 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.base64 as string, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getRow(8).getCell(11).value).toBe(295);
    const p = (await call('GET', '/library/sales/export?format=pdf&state=paid')).json();
    expect(
      Buffer.from(p.base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });

  it('a file of sales: checked first, the good rows sold one sale a buyer, the rest listed', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sales');
    ws.addRow([
      'Accession no.',
      'Buyer',
      'Admission or employee no.',
      'Buyer name',
      'Mobile',
      'Price',
      'Pay mode',
      'Reference',
      'Remarks',
    ]);
    ws.addRow(['B00009', 'Pupil', `${s}-1`, '', '', 30, '', '', 'Spare copy']);
    ws.addRow(['B00010', 'pupil', `${s.toLowerCase()}-1`, '', '', '20', '', '', '']);
    ws.addRow(['B00011', 'Outside', '', 'Ravi Stores', '98765 43211', 10, 'Cash', '', '']);
    ws.addRow(['B00012', 'Outside', '', 'ravi stores', '9876543211', '₹15', '', '', '']);
    ws.addRow(['B00001', 'Pupil', `${s}-1`, '', '', 5, '', '', '']);
    ws.addRow(['B00013', 'Staff', 'NOBODY', '', '', 5, '', '', '']);
    ws.addRow(['B00009', 'Pupil', `${s}-1`, '', '', 5, '', '', '']);
    ws.addRow(['B00014', '', 'X1', '', '', 5, '', '', '']);
    ws.addRow(['B00014', 'Outside', '', 'Someone', '', 'ten', '', '', '']);
    const xlsx = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const up = await upload('sales.xlsx', xlsx);
    expect(up.statusCode).toBe(201);
    expect(up.json()).toMatchObject({
      status: 'checked',
      counts: { rows: 9, ok: 4, errors: 5, sales: 2, amount: 75 },
    });
    const errors = (up.json().lines as Array<{ row: number; ok: boolean; error: string | null }>)
      .filter((l) => !l.ok)
      .map((l) => `${String(l.row)}: ${l.error ?? ''}`);
    expect(errors).toEqual([
      '6: It is sold already',
      `7: No staff member with code "NOBODY"`,
      '8: The same book as row 2',
      '9: Say whether the buyer is a Pupil or Staff',
      '10: The price is not a number',
    ]);
    const applied = await call('POST', `/library/sales/uploads/${up.json().id as string}/apply`);
    expect(applied.json()).toMatchObject({
      counts: { ok: 4, sales: 2 },
      sales: [
        expect.objectContaining({ saleNo: 'LS-0005', buyer: 'Asha Reader', books: 2, total: 50 }),
        expect.objectContaining({ saleNo: 'LS-0006', buyer: 'Ravi Stores', books: 2, total: 25 }),
      ],
    });
    expect(
      (await call('POST', `/library/sales/uploads/${up.json().id as string}/apply`)).statusCode,
    ).toBe(409);
    const six = (
      await call('GET', `/library/sales/orders/${String(applied.json().sales[1].id)}`)
    ).json();
    expect(six).toMatchObject({ mode: 'cash', state: 'paid', buyer: { mobile: '9876543211' } });
    // another file discarded; a file without the headings refused
    const csv = await upload(
      'more.csv',
      Buffer.from('Accession no.,Price,Buyer,Buyer name\nB00013,5,Outside,Walk-in\n'),
    );
    expect(csv.json()).toMatchObject({ counts: { ok: 1, sales: 1 } });
    expect(
      (await call('POST', `/library/sales/uploads/${csv.json().id as string}/discard`)).json(),
    ).toMatchObject({
      status: 'discarded',
    });
    expect((await upload('bad.csv', Buffer.from('a,b\n1,2\n'))).statusCode).toBe(400);
    expect((await call('GET', '/library/sales/template')).json().filename).toBe(
      'Library-book-sales-upload.xlsx',
    );
  });
});
