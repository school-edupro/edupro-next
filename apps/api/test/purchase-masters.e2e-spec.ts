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
  const vendor = (code: string, extra: Record<string, unknown> = {}) => ({
    code,
    legalName: `${code} Traders`,
    gstStatus: 'unregistered',
    stateCode: '27',
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
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(wrong.json())).toContain('does not belong');
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

  it('keeps the settings and the purchase committee (school admin only)', async () => {
    const st = (await call(admin, 'GET', '/purchase/settings')).json();
    const body = { ...st, gstin: '27AAPFU0939F1ZA' };
    for (const k of ['state', 'stateCode', 'updatedAt', 'committee']) delete body[k];
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
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Vendors');
    ws.addRow([
      'Code',
      'Legal name',
      'Trade name',
      'Kind',
      'GST status',
      'GSTIN',
      'PAN',
      'State code',
      'MSME',
      'Udyam no',
      'Address',
      'City',
      'PIN',
      'Phone',
      'E-mail',
      'Payment term',
    ]);
    ws.addRow([
      'V10',
      'Ten Supplies',
      '',
      'dealer',
      'unregistered',
      '',
      '',
      '27',
      '',
      '',
      '',
      'Pune',
      '411001',
      '',
      '',
      'ADV50 · Half in advance',
    ]);
    ws.addRow([
      'V11',
      'Eleven Co',
      '',
      'dealer',
      'regular',
      '27AAPFU0939F1ZA',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    ws.addRow([
      'V1',
      'Taken code',
      '',
      '',
      'unregistered',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const dry = (
      await call(office, 'POST', '/purchase/vendors/import', { file, dryRun: true })
    ).json();
    expect(dry).toMatchObject({ rows: 3, good: 1, saved: 0 });
    expect(dry.results[1].error).toContain('mistyped');
    expect(dry.results[2].error).toContain('taken');
    const done = (
      await call(office, 'POST', '/purchase/vendors/import', { file, dryRun: false })
    ).json();
    expect(done).toMatchObject({ saved: 1 });
    const v10 = (await call(office, 'GET', '/purchase/vendors?q=V10')).json().data[0];
    expect(v10).toMatchObject({ code: 'V10', status: 'pending', paymentTerm: 'Half in advance' });
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
});
