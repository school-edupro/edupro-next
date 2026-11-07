/**
 * Purchase, part 1 (docs/design/83): the starter masters, the grid masters' rules (two category levels,
 * an item's sub-category under its category, one rate contract per item on a day, only an approved
 * vendor on a contract), vendors with GSTIN / PAN / Udyam checks, maker-checker for a new vendor and for
 * a bank / GSTIN / PAN change, duplicates flagged, payment terms adding up to 100%, the settings and
 * committee, who approves per department, the vendor Excel import, copying from a school of the group,
 * and the rights of the Purchase office role.
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

describe('purchase masters (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let checker: SeededUser;
  let office: SeededUser;
  const emp: Record<string, string> = {};
  const s = stamp('PU');
  const call = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    json?: unknown,
    at: SeededSchool = school,
  ) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, at.id),
      ...(json === undefined ? {} : { json }),
    });
  const row = (u: SeededUser, master: string, values: Record<string, unknown>, id?: string) =>
    call(u, 'POST', `/masters/${master}/rows`, { ...(id ? { id } : {}), values });
  // a valid GSTIN of Maharashtra (27) and one of Karnataka (29), with their PANs
  const G1 = '27AAPFU0939F1ZV';
  let pans = 0;
  const vendor = (code: string, extra: Record<string, unknown> = {}) => ({
    code,
    legalName: `${code} Traders`,
    gstStatus: 'unregistered',
    // an unregistered vendor's own PAN (a registered one's comes from its GSTIN)
    ...((extra.gstStatus ?? 'unregistered') === 'unregistered' && !('pan' in extra)
      ? { pan: `AAAPZ${String(1001 + pans++)}Q` }
      : {}),
    address: '12 MG Road, Camp',
    country: 'India',
    state: 'Maharashtra',
    city: 'Pune',
    pin: '411001',
    phone: '9822012345',
    email: `${(code || 'new').toLowerCase()}@vendors.example`,
    contacts: [{ name: 'Ravi Sales', phone: '9822012345', isMain: true }],
    ...extra,
  });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      checker = await seedUser(c, school, `${s}-chk`, 'school_admin');
      office = await seedUser(c, school, `${s}-po`, 'purchase_office');
      // both schools in one group; the admin belongs to the other school too
      const g = await c.query<{ id: string }>(
        `INSERT INTO school_groups (code, name) VALUES ($1, $1) RETURNING id::text`,
        [`${s}G`],
      );
      await c.query(`UPDATE schools SET group_id = $1 WHERE id = ANY($2::bigint[])`, [
        g.rows[0]!.id,
        [school.id, other.id],
      ]);
      await c.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, 'employee')`,
        [other.id, admin.id],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = 'school_admin'`,
        [other.id, admin.id],
      );
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      // India and its states come with the purchase masters; the cities and banks are the school's own
      await c.query(`SELECT app.purchase_seed_masters($1)`, [school.id]);
      await c.query(
        `INSERT INTO cities (school_id, state_id, name, pincode)
         SELECT $1, s.id, x.name, x.pin FROM states s
           JOIN (VALUES ('MH', 'Pune', '411001'), ('KA', 'Bengaluru', '560001')) AS x(st, name, pin) ON x.st = s.code
          WHERE s.school_id = $1`,
        [school.id],
      );
      await c.query(
        `INSERT INTO banks (school_id, code, name, ifsc) VALUES ($1, 'SBI', 'SBI', 'SBIN0000001'), ($1, 'HDFC', 'HDFC', 'HDFC0000001')`,
        [school.id],
      );
      for (const [code, name, designation, dept, user] of [
        ['HOD1', 'Hema Head', 'PGT', 'Sports', checker.id],
        ['PRN1', 'Prem Principal', 'Principal', 'Administration', admin.id],
        ['CLK1', 'Kiran Clerk', 'Office Assistant', 'Administration', null],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, department, user_id)
           VALUES ($1, $2, $3, 'E2E', $4, $5, $6) RETURNING id::text`,
          [school.id, `${s}${code}`, name, designation, dept, user],
        );
        emp[code] = e.rows[0]!.id;
      }
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('starts every school with units, a short HSN list, a payment term and the settings', async () => {
    const o = (await call(admin, 'GET', '/purchase/overview')).json();
    expect(o).toMatchObject({ vendors: 0, items: 0, paymentTerms: 1, gstinSet: false });
    expect(o.uoms).toBeGreaterThanOrEqual(15);
    expect(o.hsn).toBeGreaterThanOrEqual(5);
    const hsn = (await call(admin, 'GET', '/masters/purchase_hsn/rows?q=48202000')).json();
    expect(hsn.data[0]).toMatchObject({ code: '48202000', gst_rate: '0.00' });
    const st = (await call(admin, 'GET', '/purchase/settings')).json();
    expect(st).toMatchObject({
      directLimit: 50000,
      committeeLimit: 250000,
      committeeQuotes: 3,
      emergencyEnabled: true,
      poSignatures: ['Prepared by', 'Checked by', 'Approved by'],
    });
  });

  it('makes the HSN / SAC Excel template and export (a "/" in the title once broke the sheet name)', async () => {
    for (const url of [
      '/masters/purchase_hsn/template',
      '/masters/purchase_hsn/export?format=xlsx',
    ]) {
      const res = await call(admin, 'GET', url);
      expect(res.statusCode).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
      expect(wb.worksheets[0]!.name).toBe('HSN - SAC codes');
    }
  });

  it('keeps categories two levels deep and an item under its own category', async () => {
    expect(
      (await row(admin, 'purchase_item_categories', { code: 'STAT', name: 'Stationery' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await row(admin, 'purchase_item_categories', { code: 'IT', name: 'IT' })).statusCode,
    ).toBe(201);
    expect(
      (
        await row(admin, 'purchase_item_categories', {
          code: 'PENS',
          name: 'Pens',
          parent_id: 'STAT',
        })
      ).statusCode,
    ).toBe(201);
    // a sub-category of a sub-category is refused (the lookup offers categories only)
    expect(
      (
        await row(admin, 'purchase_item_categories', {
          code: 'GEL',
          name: 'Gel pens',
          parent_id: 'PENS',
        })
      ).statusCode,
    ).toBe(400);
    const ok = await row(admin, 'purchase_items', {
      code: 'PEN-BLUE',
      name: 'Ball pen blue',
      item_type: 'consumable',
      category_id: 'STAT',
      sub_category_id: 'PENS',
      uom_id: 'NOS',
      hsn_id: '9609',
    });
    expect(ok.statusCode).toBe(201);
    const wrong = await row(admin, 'purchase_items', {
      code: 'LAPTOP',
      name: 'Laptop',
      item_type: 'asset',
      category_id: 'IT',
      sub_category_id: 'PENS',
      uom_id: 'NOS',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().detail).toContain('Sub-category: Belongs to category STAT');
  });

  it('checks an uploaded item’s sub-category against its category before saving anything', async () => {
    // the template's drop-down says which category each sub-category is under
    const tpl = await call(admin, 'GET', '/masters/purchase_items/template');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.rawPayload as unknown as ArrayBuffer);
    const lists = wb.getWorksheet('Lists')!;
    const subs: string[] = [];
    lists.eachRow((r) => r.eachCell((cell) => subs.push(String(cell.value))));
    expect(subs).toContain('PENS · Pens (Category STAT)');
    const head = 'Item code,Item,Type,Category,Sub-category,Unit\n';
    const bad = await call(admin, 'POST', '/masters/purchase_items/imports/validate', {
      fileName: 'items.csv',
      csv: `${head}NB-1,Notebook,consumable,STAT,PENS · Pens (Category STAT),NOS\nFAN-1,Fan,asset,IT,PENS,NOS\n`,
    });
    expect(bad.json().status).toBe('failed');
    expect(bad.json().report).toEqual([
      {
        row: 3,
        column: 'Sub-category',
        message: "Belongs to category STAT, not to this row's category",
      },
    ]);
    const good = await call(admin, 'POST', '/masters/purchase_items/imports/validate', {
      fileName: 'items.csv',
      csv: `${head}NB-1,Notebook,consumable,STAT,PENS · Pens (Category STAT),NOS\n`,
    });
    expect(good.json().status).toBe('validated');
    const done = await call(
      admin,
      'POST',
      `/masters/purchase_items/imports/${good.json().id}/commit`,
    );
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ status: 'committed', insertedRows: 1 });
  });

  it('makes an item code from the category and sub-category when it is left blank', async () => {
    const save = async (values: Record<string, unknown>) => {
      const r = await row(admin, 'purchase_items', {
        item_type: 'consumable',
        uom_id: 'NOS',
        ...values,
      });
      expect(r.statusCode).toBe(201);
      return String(r.json().code);
    };
    // the preview the Add form fills in (nothing reserved), then the code given on saving
    const next = await call(
      admin,
      'GET',
      '/masters/purchase_items/next-key?category_id=STAT%20%C2%B7%20Stationery&sub_category_id=PENS',
    );
    expect(next.json()).toEqual({ value: 'STAT-PENS-0001' });
    expect(
      await save({ name: 'Gel pen black', category_id: 'STAT', sub_category_id: 'PENS' }),
    ).toBe('STAT-PENS-0001');
    expect(await save({ name: 'Gel pen blue', category_id: 'STAT', sub_category_id: 'PENS' })).toBe(
      'STAT-PENS-0002',
    );
    // a sub-category whose code already starts with its category's is not repeated
    expect(
      (
        await row(admin, 'purchase_item_categories', {
          code: 'STAT-PAPER',
          name: 'Paper',
          parent_id: 'STAT',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      await save({ name: 'A4 paper', category_id: 'STAT', sub_category_id: 'STAT-PAPER' }),
    ).toBe('STAT-PAPER-0001');
    // no sub-category: the category and a number; a code typed by hand is kept and counted
    expect(await save({ code: 'IT-0007', name: 'Mouse', category_id: 'IT' })).toBe('IT-0007');
    expect(await save({ name: 'Keyboard', category_id: 'IT' })).toBe('IT-0008');
    // an upload: blank codes are new items (never duplicates of each other), a code updates its item
    const up = await call(admin, 'POST', '/masters/purchase_items/imports/validate', {
      fileName: 'items.csv',
      csv: 'Item code,Item,Type,Category,Sub-category,Unit\n,Pen red,consumable,STAT,PENS,NOS\n,Pen green,consumable,STAT,PENS,NOS\nIT-0008,Keyboard USB,consumable,IT,,NOS\n',
    });
    expect(up.json()).toMatchObject({ status: 'validated', okRows: 3 });
    const done = await call(
      admin,
      'POST',
      `/masters/purchase_items/imports/${up.json().id}/commit`,
    );
    expect(done.json()).toMatchObject({ status: 'committed', insertedRows: 2, updatedRows: 1 });
    const pens = (
      await call(admin, 'GET', '/masters/purchase_items/rows?q=STAT-PENS&size=50')
    ).json();
    expect(pens.data.map((x: { code: string }) => x.code).sort()).toEqual([
      'STAT-PENS-0001',
      'STAT-PENS-0002',
      'STAT-PENS-0003',
      'STAT-PENS-0004',
    ]);
    // the old "Sub-category of" header of Item categories still uploads
    const cats = await call(admin, 'POST', '/masters/purchase_item_categories/imports/validate', {
      fileName: 'cats.csv',
      csv: 'Code,Category,Sub-category of\nMARK,Markers,STAT\n',
    });
    expect(cats.json()).toMatchObject({ status: 'validated', okRows: 1 });
  });

  it('checks a vendor’s GSTIN, PAN and Udyam number', async () => {
    const bad = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('V0', { gstStatus: 'regular', gstin: '27AAPFU0939F1ZA' }),
    );
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ type: 'purchase.gstin_invalid' });
    expect(bad.json().detail).toContain('mistyped');
    const pan = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('V0', { gstStatus: 'regular', gstin: G1, pan: 'ABCDE1234F' }),
    );
    expect(pan.json()).toMatchObject({ type: 'purchase.pan_mismatch' });
    const udyam = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('V0', { udyamNo: 'UDYAM-12' }),
    );
    expect(udyam.statusCode).toBe(400);
  });

  it('checks every field of a new vendor, naming the field, against the rules and the masters', async () => {
    const lists = (await call(office, 'GET', '/purchase/vendors/form-lists')).json();
    expect(lists.nextCode).toBe('V-0001');
    expect(lists.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Maharashtra', gstCode: '27', country: 'IN' }),
      ]),
    );
    expect(lists.cities).toEqual(
      expect.arrayContaining([{ name: 'Pune', state: 'MH', pincode: '411001' }]),
    );
    expect(lists.banks).toEqual(expect.arrayContaining([{ name: 'SBI', prefixes: ['SBIN'] }]));
    const bad = await call(office, 'POST', '/purchase/vendors', {
      ...vendor('V0', {
        gstStatus: 'regular',
        gstin: G1,
        state: 'Karnataka',
        city: 'Mysuru',
        pin: '01234',
        phone: '12345',
        email: '',
        msmeType: 'micro',
        contacts: [{ name: 'Ravi', phone: '', isMain: true }],
        bank: {
          bankName: 'SBI',
          ifsc: 'HDFC0000001',
          accountNo: '1234',
          accountNoConfirm: '12345',
          holder: '',
        },
      }),
    });
    expect(bad.statusCode).toBe(400);
    const paths = (bad.json().errors as Array<{ path: string }>).map((e) => e.path).sort();
    expect(paths).toEqual(
      [
        'bank.accountNo',
        'bank.accountNoConfirm',
        'bank.holder',
        'bank.ifsc',
        'city',
        'contacts.0.phone',
        'email',
        'phone',
        'pin',
        'state',
        'udyamNo',
      ].sort(),
    );
    const msg = (path: string) =>
      (bad.json().errors as Array<{ path: string; message: string }>).find((e) => e.path === path)
        ?.message;
    expect(msg('city')).toContain('not in the Cities master under Karnataka');
    expect(msg('state')).toContain('GSTIN');
    expect(msg('bank.ifsc')).toContain('not of SBI');
    // an unregistered vendor in India needs its PAN; the code left empty is made
    const noPan = await call(office, 'POST', '/purchase/vendors', vendor('', { pan: undefined }));
    expect(noPan.json().errors).toEqual([expect.objectContaining({ path: 'pan' })]);
    const made = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('', { legalName: 'Auto Coded Traders', phone: '+91 98220 11111' }),
    );
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      code: 'V-0001',
      phone: '9822011111',
      country: 'India',
      state: 'Maharashtra',
      city: 'Pune',
      stateCode: '27',
    });
  });

  it('makes a new vendor wait for a second person, never its maker', async () => {
    const r = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('V1', {
        gstStatus: 'regular',
        gstin: G1,
        msmeType: 'micro',
        udyamNo: 'UDYAM-MH-12-1234567',
        bank: {
          accountNo: '123456789012',
          ifsc: 'sbin0001234',
          bankName: 'SBI',
          holder: 'V1 Traders',
        },
      }),
    );
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pending',
      pan: 'AAPFU0939F',
      stateCode: '27',
      state: 'Maharashtra',
      bankHint: 'SBI ····9012 (SBIN0001234)',
    });
    expect(JSON.stringify(r.json())).not.toContain('123456789012');
    const id = r.json().id as string;
    // the purchase office cannot approve at all; the maker cannot approve their own
    expect(
      (await call(office, 'POST', `/purchase/vendors/${id}/decide`, { approve: true })).statusCode,
    ).toBe(403);
    const self = await call(admin, 'PATCH', `/purchase/vendors/${id}`, { city: 'Pune' });
    expect(self.statusCode).toBe(200);
    const mine = await call(admin, 'POST', `/purchase/vendors/${id}/decide`, { approve: true });
    expect(mine.statusCode).toBe(403);
    expect(mine.json()).toMatchObject({ type: 'purchase.maker_checker' });
    // the approver sees the bank account in full
    const q = (await call(checker, 'GET', '/purchase/vendor-approvals')).json();
    expect(q.vendors.find((v: { id: string }) => v.id === id).bank).toMatchObject({
      accountNo: '123456789012',
    });
    const ok = await call(checker, 'POST', `/purchase/vendors/${id}/decide`, { approve: true });
    expect(ok.json()).toMatchObject({ status: 'active', city: 'Pune' });
  });

  it('flags a duplicate GSTIN, PAN or bank account, saved only with a reason', async () => {
    const dup = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('V2', { gstStatus: 'regular', gstin: G1 }),
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ type: 'purchase.vendor_duplicate' });
    expect(dup.json().duplicates).toEqual([
      expect.objectContaining({ code: 'V1', field: 'GSTIN' }),
    ]);
    const bank = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('V3', {
        bank: {
          accountNo: '123456789012',
          ifsc: 'SBIN0001234',
          bankName: 'SBI',
          holder: 'V3 Traders',
        },
      }),
    );
    expect(bank.json().duplicates).toEqual([
      expect.objectContaining({ code: 'V1', field: 'bank account' }),
    ]);
    const saved = await call(
      office,
      'POST',
      '/purchase/vendors',
      vendor('V2', {
        gstStatus: 'regular',
        gstin: G1,
        duplicateReason: 'Second branch of the same firm',
      }),
    );
    expect(saved.statusCode).toBe(201);
  });

  it('makes a bank change of an approved vendor wait; the old account stays until approved', async () => {
    const v1 = (await call(admin, 'GET', '/purchase/vendors?q=V1'))
      .json()
      .data.find((v: { code: string }) => v.code === 'V1');
    const change = {
      bank: {
        accountNo: '999988887777',
        ifsc: 'HDFC0000001',
        bankName: 'HDFC',
        holder: 'V1 Traders',
      },
    };
    expect((await call(office, 'PATCH', `/purchase/vendors/${v1.id}`, change)).statusCode).toBe(
      400,
    ); // no reason
    const r = await call(office, 'PATCH', `/purchase/vendors/${v1.id}`, {
      ...change,
      changeReason: 'New bank',
    });
    expect(r.json()).toMatchObject({ changeWaiting: true, bankHint: 'SBI ····9012 (SBIN0001234)' });
    expect(
      (
        await call(office, 'PATCH', `/purchase/vendors/${v1.id}`, {
          ...change,
          changeReason: 'Again',
        })
      ).json().type,
    ).toBe('purchase.vendor_change_pending');
    const waiting = (await call(checker, 'GET', '/purchase/vendor-approvals')).json().changes;
    const ch = waiting.find((x: { vendorId: string }) => x.vendorId === v1.id);
    expect(ch.changes.bank).toMatchObject({ accountNo: '999988887777' });
    expect(ch.before).toMatchObject({ bankHint: 'SBI ····9012 (SBIN0001234)' });
    const done = await call(checker, 'POST', `/purchase/vendor-changes/${ch.id}/decide`, {
      approve: true,
    });
    expect(done.json()).toMatchObject({ bankHint: 'HDFC ····7777 (HDFC0000001)' });
    // plain fields change at once
    expect(
      (await call(office, 'PATCH', `/purchase/vendors/${v1.id}`, { phone: '9822099999' })).json(),
    ).toMatchObject({
      phone: '9822099999',
      changeWaiting: false,
    });
    // blacklisting needs a reason; a pending vendor is not blacklisted, it is rejected
    expect(
      (await call(office, 'PUT', `/purchase/vendors/${v1.id}/status`, { status: 'blacklisted' }))
        .statusCode,
    ).toBe(400);
  });

  it('allows one rate contract per item on a day, and only for an approved vendor', async () => {
    const base = {
      item_id: 'PEN-BLUE',
      vendor_id: 'V1',
      rate: 8.5,
      valid_from: '2026-04-01',
      valid_to: '2027-03-31',
    };
    expect((await row(admin, 'purchase_rate_contracts', base)).statusCode).toBe(201);
    const overlap = await row(admin, 'purchase_rate_contracts', {
      ...base,
      valid_from: '2026-10-01',
      valid_to: '2027-06-30',
    });
    expect(overlap.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(overlap.json())).toContain('already has a rate contract');
    // V2 is still pending: the lookup does not offer it
    const pending = await row(admin, 'purchase_rate_contracts', {
      ...base,
      vendor_id: 'V2',
      valid_from: '2027-04-01',
      valid_to: '2028-03-31',
    });
    expect(pending.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('keeps payment terms in instalments adding up to 100%', async () => {
    const bad = await call(office, 'POST', '/purchase/payment-terms', {
      code: 'ADV50',
      name: 'Half in advance',
      lines: [
        { pct: 50, dueOn: 'advance' },
        { pct: 40, dueOn: 'delivery', days: 15 },
      ],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toContain('90%');
    const ok = await call(office, 'POST', '/purchase/payment-terms', {
      code: 'ADV50',
      name: 'Half in advance',
      isDefault: true,
      lines: [
        { pct: 50, dueOn: 'advance', days: 10 },
        { pct: 50, dueOn: 'delivery', days: 15 },
      ],
    });
    expect(ok.json()).toMatchObject({
      words: '50% in advance, 50% 15 days after delivery',
      longestDays: 15,
      isDefault: true,
    });
    const list = (await call(office, 'GET', '/purchase/payment-terms')).json().data;
    expect(list.filter((t: { isDefault: boolean }) => t.isDefault)).toHaveLength(1);
  });

  it('filters payment terms, gives them as Excel and PDF, and loads them from Excel', async () => {
    const codes = async (q: string) =>
      (
        (await call(office, 'GET', `/purchase/payment-terms?${q}`)).json().data as Array<{
          code: string;
        }>
      )
        .map((t) => t.code)
        .sort();
    expect(await codes('kind=advance')).toEqual(['ADV50']);
    expect(await codes('kind=invoice')).toEqual(['NET30']);
    expect(await codes('q=net')).toEqual(['NET30']);
    expect(await codes('status=inactive')).toEqual([]);
    expect(await codes('over45=1')).toEqual([]);
    for (const format of ['xlsx', 'pdf']) {
      const f = (
        await call(office, 'GET', `/purchase/payment-terms/export?format=${format}&kind=advance`)
      ).json();
      expect(f.filename).toContain('Purchase-payment-terms');
      expect(f.rows).toBe(1);
    }
    // the format comes filled with the school's terms, one row per term
    const t = (await call(office, 'GET', '/purchase/payment-terms/template')).json();
    const tpl = new ExcelJS.Workbook();
    await tpl.xlsx.load(Buffer.from(t.base64 as string, 'base64') as unknown as ArrayBuffer);
    const ws0 = tpl.worksheets[0]!;
    const heads = (ws0.getRow(1).values as unknown[]).slice(1).map(String);
    expect(heads).toEqual(
      expect.arrayContaining([
        'Code *',
        'Payment term *',
        'Instalment 1 % *',
        'Instalment 1 due *',
        'Instalment 4 days',
      ]),
    );
    const adv = (ws0.getSheetValues() as unknown[][]).find((r) => r?.[1] === 'ADV50')!;
    expect(adv.slice(1, 12)).toEqual([
      'ADV50',
      'Half in advance',
      '',
      'yes',
      'active',
      50,
      'advance',
      '',
      50,
      'delivery',
      15,
    ]);
    // an upload: a new term, an update, three rows refused (sum, due on, an advance with days)
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Payment terms');
    ws.addRow([
      'Code *',
      'Payment term *',
      'Default',
      'Instalment 1 % *',
      'Instalment 1 due *',
      'Instalment 1 days',
      'Instalment 2 %',
      'Instalment 2 due',
      'Instalment 2 days',
    ]);
    ws.addRow(['NET60', 'Within 60 days of the invoice', '', 100, 'invoice', 60]);
    ws.addRow(['ADV50', 'Part in advance', '', 30, 'advance', '', 70, 'delivery', 20]);
    ws.addRow(['BAD1', 'Short of 100', '', 60, 'invoice', 30, 30, 'delivery', 10]);
    ws.addRow(['BAD2', 'Wrong due', '', 100, 'later']);
    ws.addRow(['ADV100', 'All in advance', '', 100, 'advance', 5]);
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(office, 'POST', '/purchase/payment-terms/import', { file, dryRun: true })
    ).json();
    expect(dry).toMatchObject({ rows: 5, good: 2, saved: 0 });
    expect(dry.results[0]).toMatchObject({ ok: true, action: 'new' });
    expect(dry.results[1]).toMatchObject({ ok: true, action: 'update' });
    expect(dry.results[2].error).toContain('90%');
    expect(dry.results[3].error).toContain('advance, delivery or invoice');
    expect(dry.results[4].error).toContain('an advance has no days');
    expect(await codes('')).toEqual(['ADV50', 'NET30']);
    const done = (
      await call(office, 'POST', '/purchase/payment-terms/import', { file, dryRun: false })
    ).json();
    expect(done).toMatchObject({ saved: 2 });
    expect(await codes('over45=1')).toEqual(['NET60']);
    const updated = (await call(office, 'GET', '/purchase/payment-terms?q=ADV50')).json().data[0];
    expect(updated).toMatchObject({
      name: 'Part in advance',
      words: '30% in advance, 70% 20 days after delivery',
      isDefault: true,
    });
  });

  it('says who may approve a vendor: the roles with the right and their people', async () => {
    const va = (await call(office, 'GET', '/purchase/vendor-approvers')).json();
    expect(va.roles.map((r: { code: string }) => r.code)).toEqual(
      expect.arrayContaining(['group_admin', 'school_admin']),
    );
    expect(va.roles.map((r: { code: string }) => r.code)).not.toContain('purchase_office');
    // the admin and the checker are school admins; the purchase office is not listed
    expect(va.people.length).toBeGreaterThanOrEqual(2);
    expect(va.people.every((p: { roles: string }) => !p.roles.includes('Purchase Office'))).toBe(
      true,
    );
  });

  it('keeps the settings and the purchase committee (school admin only)', async () => {
    const st = (await call(admin, 'GET', '/purchase/settings')).json();
    const body = {
      ...st,
      gstin: '27AAPFU0939F1ZA',
      // the billing address in parts, from the school's masters
      billingLine: '1 School Road, Camp',
      billingCountry: 'India',
      billingState: 'Maharashtra',
      billingCity: 'Pune',
      billingPin: '411001',
      deliverySame: true,
    };
    for (const k of [
      'state',
      'stateCode',
      'updatedAt',
      'committee',
      'billingAddress',
      'deliveryAddress',
    ])
      delete body[k];
    expect((await call(office, 'PUT', '/purchase/settings', body)).statusCode).toBe(403);
    expect((await call(admin, 'PUT', '/purchase/settings', body)).json().type).toBe(
      'purchase.gstin_invalid',
    );
    expect(
      (
        await call(admin, 'PUT', '/purchase/settings', {
          ...body,
          gstin: G1,
          committeeSignatures: 2,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call(admin, 'POST', '/purchase/committee', { employeeId: emp.HOD1, role: 'Chair' }))
        .statusCode,
    ).toBe(201);
    expect(
      (await call(admin, 'POST', '/purchase/committee', { employeeId: emp.CLK1 })).statusCode,
    ).toBe(201);
    expect(
      (
        await call(admin, 'PUT', '/purchase/settings', {
          ...body,
          gstin: G1,
          committeeSignatures: 2,
        })
      ).statusCode,
    ).toBe(200);
    expect((await call(admin, 'GET', '/purchase/settings')).json()).toMatchObject({
      gstin: G1,
      state: 'Maharashtra',
      committeeSignatures: 2,
      billingAddress: '1 School Road, Camp, Pune 411001, Maharashtra, India',
      deliverySame: true,
      deliveryAddress: '1 School Road, Camp, Pune 411001, Maharashtra, India',
      committee: [
        expect.objectContaining({ name: expect.stringContaining('Hema') }),
        expect.anything(),
      ],
    });
    expect((await call(admin, 'GET', '/purchase/overview')).json()).toMatchObject({
      gstinSet: true,
      committee: 2,
    });
  });

  it('checks every settings field, naming the field; the addresses from the masters', async () => {
    const st = (await call(admin, 'GET', '/purchase/settings')).json();
    const base = { ...st };
    for (const k of [
      'state',
      'stateCode',
      'updatedAt',
      'committee',
      'billingAddress',
      'deliveryAddress',
    ])
      delete base[k];
    const bad = await call(admin, 'PUT', '/purchase/settings', {
      ...base,
      gstin: G1,
      billingLine: 'x',
      billingState: 'Karnataka',
      billingCity: 'Mysuru',
      billingPin: '0123',
      deliverySame: false,
      deliveryLine: '2 Store Lane',
      deliveryCountry: 'India',
      deliveryState: 'Karnataka',
      deliveryCity: 'Bengaluru',
      deliveryPin: '',
      prPrefix: base.piPrefix,
      purchaseDepartmentId: '999999999',
    });
    expect(bad.statusCode).toBe(400);
    const paths = (bad.json().errors as Array<{ path: string }>).map((e) => e.path).sort();
    expect(paths).toEqual(
      [
        'billingCity',
        'billingLine',
        'billingPin',
        'billingState',
        'deliveryPin',
        'prPrefix',
        'purchaseDepartmentId',
      ].sort(),
    );
    // a delivery address of its own, in another state: kept in parts and printed whole
    const ok = await call(admin, 'PUT', '/purchase/settings', {
      ...base,
      deliverySame: false,
      deliveryLine: '2 Store Lane',
      deliveryCountry: 'India',
      deliveryState: 'Karnataka',
      deliveryCity: 'Bengaluru',
      deliveryPin: '560001',
    });
    expect(ok.statusCode).toBe(200);
    expect((await call(admin, 'GET', '/purchase/settings')).json()).toMatchObject({
      deliverySame: false,
      deliveryCity: 'Bengaluru',
      deliveryAddress: '2 Store Lane, Bengaluru 560001, Karnataka, India',
      billingAddress: '1 School Road, Camp, Pune 411001, Maharashtra, India',
    });
    expect(
      (await call(admin, 'PUT', '/purchase/settings', { ...base, deliverySame: true })).statusCode,
    ).toBe(200);
  });

  it('keeps who approves each department’s PIs, PRs and POs, and its bypass rules', async () => {
    const a = (await call(admin, 'GET', '/purchase/approvals')).json();
    const sports = a.departments.find((d: { name: string }) => d.name === 'Sports');
    expect(sports).toMatchObject({ hod: null, levels: { indent: [], requisition: [], order: [] } });
    const levels = [
      { name: 'HOD', by: 'hod' },
      { name: 'Principal', by: 'designation', designation: 'Principal', slaHours: 48 },
      { name: 'Clerk', by: 'employees', employeeIds: [emp.CLK1] },
    ];
    const r = await call(admin, 'PUT', `/purchase/approvals/${sports.id}/indent`, { levels });
    expect(r.json().warnings).toEqual([
      expect.stringContaining('has no HOD'),
      expect.stringContaining('none of these employees can sign in'),
    ]);
    expect(
      (
        await call(admin, 'PUT', `/purchase/approvals/${sports.id}/indent`, {
          levels: [{ name: 'X', by: 'employees' }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(admin, 'PUT', `/purchase/approvals/${sports.id}/rules`, {
          bypassLimit: 10000,
          rateContractBypass: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(office, 'PUT', `/purchase/approvals/${sports.id}/rules`, {
          bypassLimit: 1,
          rateContractBypass: false,
        })
      ).statusCode,
    ).toBe(403);
    const after = (await call(admin, 'GET', '/purchase/approvals'))
      .json()
      .departments.find((d: { id: string }) => d.id === sports.id);
    expect(after).toMatchObject({ rules: { bypassLimit: 10000, rateContractBypass: true } });
    expect(after.levels.indent).toHaveLength(3);
  });

  it('imports vendors from Excel: every row checked first, the good ones saved pending', async () => {
    const t = (await call(office, 'GET', '/purchase/vendors/template')).json();
    expect(t.filename).toBe('vendors-format.xlsx');
    // the format: required columns marked, drop-downs from the masters
    const tpl = new ExcelJS.Workbook();
    await tpl.xlsx.load(Buffer.from(t.base64 as string, 'base64') as unknown as ArrayBuffer);
    const heads = (tpl.worksheets[0]!.getRow(1).values as unknown[]).slice(1).map(String);
    expect(heads).toEqual(
      expect.arrayContaining([
        'Code',
        'Country *',
        'State *',
        'City *',
        'Mobile *',
        'Bank',
        'IFSC',
      ]),
    );
    const listed: string[] = [];
    tpl
      .getWorksheet('Lists')!
      .eachRow((r) => r.eachCell((cell) => listed.push(String(cell.value))));
    expect(listed).toEqual(expect.arrayContaining(['Pune · Maharashtra', 'Maharashtra', 'SBI']));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Vendors');
    const head = [
      'Code',
      'Legal name',
      'Trade name',
      'Kind',
      'GST status',
      'GSTIN',
      'PAN',
      'MSME',
      'Udyam no',
      'Address',
      'Country',
      'State',
      'City',
      'PIN',
      'Mobile',
      'E-mail',
      'Contact name',
      'Contact mobile',
      'Contact e-mail',
      'Payment term',
      'Bank',
      'IFSC',
      'Account no',
      'Account holder',
    ];
    ws.addRow(head.map((h, k) => (k === 1 ? `${h} *` : h)));
    const line = (x: Record<string, string>) => head.map((h) => x[h] ?? '');
    const good = {
      'Legal name': 'Ten Supplies',
      Kind: 'dealer',
      'GST status': 'unregistered',
      PAN: 'AAAPT1010Q',
      Address: '4 Station Road',
      State: 'Maharashtra',
      City: 'Pune · Maharashtra',
      PIN: '411001',
      Mobile: '9822010101',
      'E-mail': 'ten@vendors.example',
      'Contact name': 'Tara',
      'Contact mobile': '9822010102',
    };
    ws.addRow(line({ ...good, Code: 'V10', 'Payment term': 'ADV50 · Half in advance' }));
    ws.addRow(
      line({ ...good, Code: 'V11', 'GST status': 'regular', GSTIN: '27AAPFU0939F1ZA', PAN: '' }),
    );
    ws.addRow(line({ ...good, Code: 'V1', PAN: 'AAAPT1011Q' }));
    ws.addRow(
      line({
        ...good,
        PAN: 'AAAPT1012Q',
        Bank: 'HDFC',
        IFSC: 'HDFC0000009',
        'Account no': '50100200300',
        'Account holder': 'Ten Supplies',
      }),
    );
    ws.addRow(
      line({ ...good, Code: 'V12', PAN: 'AAAPT1013Q', City: 'Nagpur', 'Contact mobile': '' }),
    );
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(office, 'POST', '/purchase/vendors/import', { file, dryRun: true })
    ).json();
    expect(dry).toMatchObject({ rows: 5, good: 2, saved: 0 });
    expect(dry.results[1].error).toContain('mistyped');
    expect(dry.results[2].error).toContain('taken');
    expect(dry.results[3]).toMatchObject({ ok: true, code: '(next code)' });
    // the problems say their column, like the form says its field
    expect(dry.results[4].error).toContain(
      'City: Nagpur is not in the Cities master under Maharashtra',
    );
    expect(dry.results[4].error).toContain('Contact mobile: ');
    const done = (
      await call(office, 'POST', '/purchase/vendors/import', { file, dryRun: false })
    ).json();
    expect(done).toMatchObject({ saved: 2 });
    expect(done.results[3]).toMatchObject({ ok: true, code: 'V-0002' });
    const v10 = (await call(office, 'GET', '/purchase/vendors?q=V10')).json().data[0];
    expect(v10).toMatchObject({
      code: 'V10',
      status: 'pending',
      // the upload test before renamed ADV50
      paymentTerm: 'Part in advance',
      city: 'Pune',
      state: 'Maharashtra',
    });
    const banked = (await call(office, 'GET', '/purchase/vendors?q=V-0002')).json().data[0];
    expect(banked).toMatchObject({ bankHint: 'HDFC ····0300 (HDFC0000009)' });
  });

  it('copies masters from another school of the group; vendors arrive pending', async () => {
    await withMigrator(async (c) => {
      await c.query(`SELECT app.purchase_seed_masters($1)`, [other.id]);
      await c.query(
        `INSERT INTO purchase_item_categories (school_id, code, name) VALUES ($1, 'FURN', 'Furniture')`,
        [other.id],
      );
      await c.query(
        `INSERT INTO purchase_items (school_id, code, name, item_type, category_id, uom_id)
         SELECT $1, 'DESK-2', 'Dual desk', 'asset', c.id, u.id FROM purchase_item_categories c, purchase_uoms u
          WHERE c.school_id = $1 AND c.code = 'FURN' AND u.school_id = $1 AND u.code = 'NOS'`,
        [other.id],
      );
      await c.query(
        `INSERT INTO vendors (school_id, code, legal_name, gst_status, state_code, status) VALUES ($1, 'W1', 'Wood Works', 'unregistered', '27', 'active')`,
        [other.id],
      );
    });
    const src = (await call(admin, 'GET', '/purchase/copy-sources')).json().data;
    expect(src.map((x: { id: string }) => x.id)).toEqual([other.id]);
    expect(
      (await call(office, 'POST', '/purchase/copy-from', { schoolId: other.id, parts: ['items'] }))
        .statusCode,
    ).toBe(403);
    const r = (
      await call(admin, 'POST', '/purchase/copy-from', {
        schoolId: other.id,
        parts: ['items', 'vendors'],
      })
    ).json();
    expect(r.copied).toMatchObject({ categories: 1, items: 1, vendors: 1 });
    const w1 = (await call(admin, 'GET', '/purchase/vendors?q=W1')).json().data[0];
    expect(w1).toMatchObject({ code: 'W1', status: 'pending' });
    const desk = (await call(admin, 'GET', '/masters/purchase_items/rows?q=DESK-2')).json().data[0];
    expect(desk).toMatchObject({ code: 'DESK-2', category_id: expect.stringContaining('FURN') });
  });

  it('shows a vendor with its details and documents; anyone who sees the vendor opens them', async () => {
    const v1 = (await call(office, 'GET', '/purchase/vendors?q=V1'))
      .json()
      .data.find((x: { code: string }) => x.code === 'V1');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const slot = await call(office, 'POST', '/platform/files', {
      fileName: 'pan.png',
      contentType: 'image/png',
      sizeBytes: png.length,
    });
    expect(slot.statusCode).toBe(201);
    expect(
      (
        await inject({
          method: 'PUT',
          url: slot.json().upload.url,
          headers: {},
          raw: { body: png, contentType: 'image/png' },
        } as never)
      ).statusCode,
    ).toBe(200);
    const added = await call(office, 'POST', `/purchase/vendors/${v1.id as string}/documents`, {
      kind: 'pan_card',
      fileId: slot.json().file.id,
    });
    expect(added.statusCode).toBe(201);
    const detail = (await call(checker, 'GET', `/purchase/vendors/${v1.id as string}`)).json();
    expect(detail.documents).toEqual([expect.objectContaining({ kind: 'pan_card' })]);
    expect(Array.isArray(detail.categories)).toBe(true);
    const docId = detail.documents[0].id as string;
    // it opens in the browser, or saves a copy
    const view = await call(
      checker,
      'GET',
      `/purchase/vendors/${v1.id as string}/documents/${docId}/file`,
    );
    expect(view.statusCode).toBe(200);
    expect(view.headers['content-type']).toContain('image/png');
    expect(String(view.headers['content-disposition'])).toMatch(/^inline/);
    const save = await call(
      checker,
      'GET',
      `/purchase/vendors/${v1.id as string}/documents/${docId}/file?save=1`,
    );
    expect(String(save.headers['content-disposition'])).toMatch(/^attachment/);
    // someone with no purchase right (and no vendor approver) does not
    const t = await withMigrator((c) => seedUser(c, school, `${s}-teach`, 'teacher'));
    expect(
      (await call(t, 'GET', `/purchase/vendors/${v1.id as string}/documents/${docId}/file`))
        .statusCode,
    ).toBe(403);
    // another vendor's document number is not found
    const v2 = (await call(office, 'GET', '/purchase/vendors?q=V2')).json().data[0];
    expect(
      (await call(checker, 'GET', `/purchase/vendors/${v2.id as string}/documents/${docId}/file`))
        .statusCode,
    ).toBe(404);
  });

  it('lets the school name its vendor approvers; then only they approve', async () => {
    // the header's approvals: what each one may decide (never what they entered)
    const mine = async (u: SeededUser) =>
      (await call(u, 'GET', '/purchase/vendor-approvals?mine=1')).json() as {
        canApprove: boolean;
        rows: Array<{ title: string; detail: string; kind: string }>;
      };
    const before = await mine(admin);
    expect(before.canApprove).toBe(true);
    expect(before.rows.map((r) => r.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('V10')]),
    );
    expect(before.rows.find((r) => r.title.startsWith('V10'))).toMatchObject({
      kind: 'vendor',
      detail: 'New vendor',
    });
    // W1 was copied in by the admin: not theirs to decide
    expect(before.rows.some((r) => r.title.startsWith('W1'))).toBe(false);
    expect(await mine(office)).toEqual({ rows: [], canApprove: false });
    expect(
      (await call(office, 'POST', '/purchase/vendor-approvers', { employeeId: emp.HOD1 }))
        .statusCode,
    ).toBe(403);
    const noLogin = await call(admin, 'POST', '/purchase/vendor-approvers', {
      employeeId: emp.CLK1,
    });
    expect(noLogin.statusCode).toBe(400);
    expect(noLogin.json().detail).toContain('does not sign in');
    expect(
      (await call(admin, 'POST', '/purchase/vendor-approvers', { employeeId: emp.HOD1 }))
        .statusCode,
    ).toBe(201);
    const va = (await call(admin, 'GET', '/purchase/vendor-approvers')).json();
    expect(va).toMatchObject({
      mode: 'named',
      named: [expect.objectContaining({ name: 'Hema Head E2E', signsIn: true })],
    });
    // the admin holds the right but is not named now; the checker (Hema) is
    const v10 = (await call(office, 'GET', '/purchase/vendors?q=V10')).json().data[0];
    expect((await call(admin, 'GET', '/purchase/vendor-approvals')).json().canApprove).toBe(false);
    expect((await call(checker, 'GET', '/purchase/vendor-approvals')).json().canApprove).toBe(true);
    expect(await mine(admin)).toEqual({ rows: [], canApprove: false });
    expect((await mine(checker)).rows.map((r) => r.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('V10'), expect.stringContaining('W1')]),
    );
    const refused = await call(admin, 'POST', `/purchase/vendors/${v10.id}/decide`, {
      approve: true,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().type).toBe('purchase.not_vendor_approver');
    const done = await call(checker, 'POST', `/purchase/vendors/${v10.id}/decide`, {
      approve: true,
    });
    expect(done.json()).toMatchObject({ status: 'active' });
    // nobody named again: the right decides
    expect(
      (await call(admin, 'DELETE', `/purchase/vendor-approvers/${va.named[0].id as string}`))
        .statusCode,
    ).toBe(200);
    expect((await call(admin, 'GET', '/purchase/vendor-approvers')).json().mode).toBe('role');
    expect((await call(admin, 'GET', '/purchase/vendor-approvals')).json().canApprove).toBe(true);
  });
});
